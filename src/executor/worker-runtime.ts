import {
    WorkflowDefinition,
    WorkflowNodeHandler,
    WorkflowNodeHandlerContext,
    WorkflowNodeHandlerResult,
    WorkflowNodeModel,
    WorkflowNodeStatusEnum
} from '../types';

type WorkerModule = {
    validate: (payload: Record<string, unknown>) => Promise<unknown>;
    init: (payload: Record<string, unknown>) => Promise<unknown>;
    onUpdate: (payload: Record<string, unknown>) => Promise<unknown>;
    execute: (payload: Record<string, unknown>) => Promise<unknown>;
};

type WorkerValidateResult = {
    ok: boolean;
    errors: string[];
    warnings: string[];
};

type WorkerUpdateResult = {
    ok: boolean;
    error?: string;
};

interface WorkerExecuteHelpers {
    executeBackend?: (...args: unknown[]) => Promise<WorkflowNodeHandlerResult>;
    updateNode?: (...args: unknown[]) => Promise<void> | void;
}

interface GlobalWorkerHelpers {
    __WF_EXECUTE_HELPERS__?: Record<string, WorkerExecuteHelpers>;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
const globalWorkerHelpers = globalThis as typeof globalThis & GlobalWorkerHelpers;
const MAX_ON_UPDATE_REENTRY = 6;

const toRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

const toBase64 = (source: string): string => {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(source, 'utf8').toString('base64');
    }

    const bytes = utf8Encoder.encode(source);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
};

const fromBase64 = (encoded: string): string => {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(encoded, 'base64').toString('utf8');
    }

    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return utf8Decoder.decode(bytes);
};

const normalizeStatus = (status: unknown): WorkflowNodeStatusEnum => {
    if (status === WorkflowNodeStatusEnum.Failed) return WorkflowNodeStatusEnum.Failed;
    if (status === WorkflowNodeStatusEnum.Warning) return WorkflowNodeStatusEnum.Warning;
    if (status === WorkflowNodeStatusEnum.Running) return WorkflowNodeStatusEnum.Running;
    if (status === WorkflowNodeStatusEnum.Stopped) return WorkflowNodeStatusEnum.Stopped;
    return WorkflowNodeStatusEnum.Passed;
};

const normalizeWorkerResult = (result: unknown): WorkflowNodeHandlerResult => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return {
            output: result ?? null,
            status: WorkflowNodeStatusEnum.Passed,
            logs: []
        };
    }

    const record = result as Record<string, unknown>;
    const logs = Array.isArray(record.logs)
        ? record.logs.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
        : [];

    return {
        output: Object.prototype.hasOwnProperty.call(record, 'output') ? record.output : record,
        status: normalizeStatus(record.status),
        logs
    };
};

const normalizeValidationResult = (result: unknown): WorkerValidateResult => {
    if (result === true || typeof result === 'undefined') {
        return { ok: true, errors: [], warnings: [] };
    }

    if (result === false) {
        return {
            ok: false,
            errors: ['Worker validation failed.'],
            warnings: []
        };
    }

    const record = toRecord(result);
    return {
        ok: typeof record.ok === 'boolean' ? record.ok : true,
        errors: Array.isArray(record.errors)
            ? record.errors.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
            : [],
        warnings: Array.isArray(record.warnings)
            ? record.warnings.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
            : []
    };
};

const normalizeUpdateResult = (result: unknown): WorkerUpdateResult => {
    if (result === false) {
        return {
            ok: false,
            error: 'Worker onUpdate returned false.'
        };
    }

    if (result === true || typeof result === 'undefined') {
        return { ok: true };
    }

    const record = toRecord(result);
    return {
        ok: typeof record.ok === 'boolean' ? record.ok : true,
        error: typeof record.error === 'string' ? record.error : undefined
    };
};

const buildFailureResult = (message: string, logs: string[] = []): WorkflowNodeHandlerResult => ({
    output: { error: message },
    status: WorkflowNodeStatusEnum.Failed,
    logs: [...logs, message]
});

const toNodePortsFacade = (node: WorkflowNodeModel): Record<string, unknown> => {
    const portsIn = toRecord(node.ports?.in);
    const portsOut = toRecord(node.ports?.out);
    const facade: Record<string, unknown> = {
        IN: portsIn,
        OUT: portsOut
    };

    Object.entries(portsIn).forEach(([portId, value]) => {
        facade[portId.toUpperCase()] = value;
    });

    return facade;
};

const toNodeFacade = (node: WorkflowNodeModel): Record<string, unknown> => ({
    ...node,
    PORTS: toNodePortsFacade(node),
    PROPERTIES: toRecord(node.runtime),
    OUTPUT: toRecord(node.ports?.out).output ?? null
});

const buildWorkerPayload = (context: WorkflowNodeHandlerContext, scope: Record<string, unknown>, outputValue: unknown): Record<string, unknown> => ({
    workflow: context.workflow,
    NODE_SCOPE: scope,
    NODE: toNodeFacade(context.node),
    self: {
        status: context.node.status,
        PORTS: context.node.ports,
        OUTPUT: outputValue
    }
});

const rewriteWorkerSource = (source: string, executeModuleSpecifier: string): string => {
    return source
        .replace(/from\s+['"]@workflow\/execute['"]/g, `from '${executeModuleSpecifier}'`)
        .replace(/import\(\s*['"]@workflow\/execute['"]\s*\)/g, `import('${executeModuleSpecifier}')`);
};

const createVirtualExecuteModuleSource = (helperId: string): string => `
const helpers = (globalThis.__WF_EXECUTE_HELPERS__ || {})[${JSON.stringify(helperId)}] || {};
export const executeBackend = async (NODE) => {
  if (typeof helpers.executeBackend !== 'function') {
    throw new Error('executeBackend helper is not available in worker runtime.');
  }
  return helpers.executeBackend(NODE);
};
export const updateNode = async (...args) => {
  if (typeof helpers.updateNode !== 'function') {
    return null;
  }
  return helpers.updateNode(...args);
};
`;

export const createNodeExecutorSignature = (modelId: string, source: string): string => {
    let hash = 5381;
    const input = `${modelId}:${source}`;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
    }
    return `wf-sign-v1-${(hash >>> 0).toString(16)}`;
};

const loadWorkerModule = async (params: {
    modelId: string;
    workflow: WorkflowDefinition;
    helperId: string;
}): Promise<WorkerModule> => {
    const encodedSource = params.workflow.NODE_EXECUTORS?.[params.modelId];
    if (typeof encodedSource !== 'string' || encodedSource.trim().length === 0) {
        throw new Error(`Missing NODE_EXECUTORS entry for model "${params.modelId}".`);
    }

    const source = fromBase64(encodedSource);
    const expectedSignature = params.workflow.NODE_EXECUTOR_SIGNATURES?.[params.modelId];
    const computedSignature = createNodeExecutorSignature(params.modelId, source);

    if (typeof expectedSignature !== 'string' || expectedSignature.trim().length === 0) {
        throw new Error(`Missing NODE_EXECUTOR_SIGNATURES entry for model "${params.modelId}".`);
    }
    if (expectedSignature !== computedSignature) {
        throw new Error(`Worker signature mismatch for model "${params.modelId}".`);
    }

    const executeModuleSpecifier = `data:text/javascript;base64,${toBase64(createVirtualExecuteModuleSource(params.helperId))}`;
    const rewrittenSource = rewriteWorkerSource(source, executeModuleSpecifier);
    const workerSpecifier = `data:text/javascript;base64,${toBase64(rewrittenSource)}`;

    const workerModule = (await import(workerSpecifier)) as Partial<WorkerModule>;
    if (typeof workerModule.validate !== 'function') throw new Error(`Worker validate export is missing for model "${params.modelId}".`);
    if (typeof workerModule.init !== 'function') throw new Error(`Worker init export is missing for model "${params.modelId}".`);
    if (typeof workerModule.onUpdate !== 'function') throw new Error(`Worker onUpdate export is missing for model "${params.modelId}".`);
    if (typeof workerModule.execute !== 'function') throw new Error(`Worker execute export is missing for model "${params.modelId}".`);

    return workerModule as WorkerModule;
};

export const createWorkerNodeHandler = (args: {
    modelId: string;
    executeHelpers?: WorkerExecuteHelpers;
}): WorkflowNodeHandler => {
    return async (context) => {
        const workflowId = String(context.workflow.metadata.id || 'workflow');
        const helperId = `${workflowId}:${context.node.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;

        const executeBackendHelper = args.executeHelpers?.executeBackend
            ? async () =>
                  args.executeHelpers!.executeBackend!({
                      node: context.node,
                      workflow: context.workflow,
                      input: context.input,
                      settings: context.settings,
                      signal: context.signal,
                      hostContext: context.hostContext,
                      invokeConnectedNode: context.invokeConnectedNode
                  })
            : undefined;

        const updateNodeHelper = args.executeHelpers?.updateNode
            ? async (workflow: unknown, nodeId: unknown, patch: unknown) =>
                  args.executeHelpers!.updateNode!({
                      workflow: toRecord(workflow).nodes ? (workflow as WorkflowDefinition) : context.workflow,
                      nodeId: typeof nodeId === 'string' ? nodeId : context.node.id,
                      patch: toRecord(patch)
                  })
            : undefined;

        globalWorkerHelpers.__WF_EXECUTE_HELPERS__ = {
            ...(globalWorkerHelpers.__WF_EXECUTE_HELPERS__ ?? {}),
            [helperId]: {
                executeBackend: executeBackendHelper,
                updateNode: updateNodeHelper
            }
        };

        try {
            const module = await loadWorkerModule({
                modelId: args.modelId,
                workflow: context.workflow,
                helperId
            });
            const nodeScope: Record<string, unknown> = {};
            const initPayload = buildWorkerPayload(context, nodeScope, null);

            await module.init(initPayload);
            await module.onUpdate(initPayload);

            const validationResult = normalizeValidationResult(await module.validate(buildWorkerPayload(context, nodeScope, null)));
            if (!validationResult.ok) {
                const firstError = validationResult.errors[0] ?? `Worker validation failed for node "${context.node.name}".`;
                return buildFailureResult(firstError, validationResult.warnings);
            }

            const preUpdateResult = normalizeUpdateResult(await module.onUpdate(buildWorkerPayload(context, nodeScope, null)));
            if (!preUpdateResult.ok) {
                const message = preUpdateResult.error ?? `Worker onUpdate rejected node "${context.node.name}" before execute.`;
                return buildFailureResult(message);
            }

            let attempts = 0;
            let result: WorkflowNodeHandlerResult = buildFailureResult('Worker execution did not produce a result.');

            while (attempts < MAX_ON_UPDATE_REENTRY) {
                attempts += 1;
                result = normalizeWorkerResult(await module.execute(buildWorkerPayload(context, nodeScope, result.output ?? null)));
                const postUpdateResult = normalizeUpdateResult(await module.onUpdate(buildWorkerPayload(context, nodeScope, result.output ?? null)));
                if (postUpdateResult.ok) {
                    break;
                }
                if (attempts >= MAX_ON_UPDATE_REENTRY) {
                    return buildFailureResult(`Worker execute reentry limit (${MAX_ON_UPDATE_REENTRY}) reached for node "${context.node.name}".`);
                }
            }

            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Worker execution failed.';
            return buildFailureResult(message);
        } finally {
            const helpers = globalWorkerHelpers.__WF_EXECUTE_HELPERS__ ?? {};
            delete helpers[helperId];
            globalWorkerHelpers.__WF_EXECUTE_HELPERS__ = helpers;
        }
    };
};
