import {
    WorkerExecuteResult,
    WorkerModuleExports,
    WorkerPayload,
    WorkerScope,
    WorkerSelfState,
    WorkerUpdateResult,
    WorkerValidateResult,
    WorkflowDefinition,
    WorkflowNodeHandler,
    WorkflowNodeHandlerContext,
    WorkflowNodeHandlerResult,
    WorkflowNodeModel,
    WorkflowNodePorts,
    WorkflowNodeStatusEnum
} from '../types';

type TypeScriptModuleApi = typeof import('typescript');

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
const compiledWorkerSourceBySignature = new Map<string, string>();

export const toRecord = <T = Record<string, unknown>>(value: unknown): T =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as T)
        : ({} as T);

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

export const normalizeResult = (result: unknown): WorkflowNodeHandlerResult => {
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

export const toErrorResult = (message: unknown, logs: string[] = []): WorkflowNodeHandlerResult => ({
    output: { error: String(message) },
    status: WorkflowNodeStatusEnum.Failed,
    logs: [...logs, String(message)]
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

const toNodeFacade = (node: WorkflowNodeModel): WorkerPayload['NODE'] => ({
    ...node,
    PORTS: toNodePortsFacade(node),
    PROPERTIES: toRecord(node.runtime),
    OUTPUT: toRecord(node.ports?.out).output ?? null
});

export const toNode = (payload: unknown): WorkerPayload['NODE'] => {
    const root = toRecord(payload);
    return toRecord<WorkerPayload['NODE']>(root.NODE);
};

const buildWorkerPayload = (
    context: WorkflowNodeHandlerContext,
    scope: WorkerScope,
    outputValue: unknown,
    nodeOverride?: WorkflowNodeModel
): WorkerPayload => {
    const node = nodeOverride ?? context.node;
    return {
        workflow: context.workflow,
        NODE_SCOPE: scope,
        NODE: toNodeFacade(node),
        self: {
            status: node.status,
            PORTS: node.ports,
            OUTPUT: outputValue
        } satisfies WorkerSelfState
    };
};

const getTypescriptModule = async (): Promise<TypeScriptModuleApi> => {
    const moduleRef = (await import('typescript')) as TypeScriptModuleApi & { default?: TypeScriptModuleApi };
    return (moduleRef.default ?? moduleRef) as TypeScriptModuleApi;
};

const formatCompileDiagnostics = (tsModule: TypeScriptModuleApi, diagnostics: readonly import('typescript').Diagnostic[] | undefined): string[] => {
    if (!diagnostics || diagnostics.length === 0) return [];

    return diagnostics.map((diagnostic) => {
        const message = tsModule.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        if (!diagnostic.file) return message;

        const lineAndCharacter = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        const line = lineAndCharacter.line + 1;
        const character = lineAndCharacter.character + 1;
        return `${diagnostic.file.fileName}:${line}:${character} ${message}`;
    });
};

const compileWorkerSource = async (modelId: string, source: string): Promise<string> => {
    const tsModule = await getTypescriptModule();
    const transpileResult = tsModule.transpileModule(source, {
        fileName: `${modelId}.worker.ts`,
        reportDiagnostics: true,
        compilerOptions: {
            target: tsModule.ScriptTarget.ES2022,
            module: tsModule.ModuleKind.ESNext,
            moduleResolution: tsModule.ModuleResolutionKind.Bundler,
            importsNotUsedAsValues: tsModule.ImportsNotUsedAsValues.Remove,
            isolatedModules: true,
            skipLibCheck: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            resolveJsonModule: true,
            strict: true
        }
    });

    const diagnostics = transpileResult.diagnostics ?? [];
    const hasError = diagnostics.some((diagnostic) => diagnostic.category === tsModule.DiagnosticCategory.Error);
    if (hasError) {
        const formatted = formatCompileDiagnostics(tsModule, diagnostics);
        throw new Error(`Worker TypeScript compile failed for model "${modelId}": ${formatted.join(' | ')}`);
    }

    return transpileResult.outputText;
};

const rewriteWorkerSource = (
    source: string,
    executeModuleSpecifier: string,
    executorModuleSpecifier: string
): string => {
    return source
        .replace(/from\s+['"]@workflow\/execute['"]/g, `from '${executeModuleSpecifier}'`)
        .replace(/import\(\s*['"]@workflow\/execute['"]\s*\)/g, `import('${executeModuleSpecifier}')`)
        .replace(/from\s+['"]@workflow\/executor['"]/g, `from '${executorModuleSpecifier}'`)
        .replace(/import\(\s*['"]@workflow\/executor['"]\s*\)/g, `import('${executorModuleSpecifier}')`);
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

const createVirtualExecutorModuleSource = (): string => `
const toRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const normalizeStatus = (status) => {
  if (status === 'failed') return 'failed';
  if (status === 'warning') return 'warning';
  if (status === 'running') return 'running';
  if (status === 'stopped') return 'stopped';
  return 'passed';
};
export const normalizeResult = (result) => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { output: result ?? null, status: 'passed', logs: [] };
  }
  const record = result;
  const logs = Array.isArray(record.logs)
    ? record.logs.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
    : [];
  return {
    output: Object.prototype.hasOwnProperty.call(record, 'output') ? record.output : record,
    status: normalizeStatus(record.status),
    logs
  };
};
export const toErrorResult = (message, logs = []) => ({
  output: { error: String(message) },
  status: 'failed',
  logs: [...logs, String(message)]
});
export const toNode = (payload) => toRecord(toRecord(payload).NODE);
export { toRecord };
`;

export const createNodeExecutorSignature = (modelId: string, source: string): string => {
    let hash = 5381;
    const input = `${modelId}:${source}`;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
    }
    return `wf-sign-v1-${(hash >>> 0).toString(16)}`;
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
            : [],
        normalizedRuntime: toRecord(record.normalizedRuntime)
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

const toRuntimePatchedNode = (node: WorkflowNodeModel, normalizedRuntime?: Record<string, unknown>): WorkflowNodeModel => {
    if (!normalizedRuntime || Object.keys(normalizedRuntime).length === 0) return node;
    return {
        ...node,
        runtime: {
            ...(node.runtime ?? {}),
            ...normalizedRuntime
        }
    };
};

const loadWorkerModule = async (params: {
    modelId: string;
    workflow: WorkflowDefinition;
    helperId: string;
}): Promise<WorkerModuleExports> => {
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

    const compileCacheKey = `${params.modelId}:${expectedSignature}`;
    let compiledSource = compiledWorkerSourceBySignature.get(compileCacheKey);
    if (!compiledSource) {
        compiledSource = await compileWorkerSource(params.modelId, source);
        compiledWorkerSourceBySignature.set(compileCacheKey, compiledSource);
    }

    const executeModuleSpecifier = `data:text/javascript;base64,${toBase64(createVirtualExecuteModuleSource(params.helperId))}`;
    const executorModuleSpecifier = `data:text/javascript;base64,${toBase64(createVirtualExecutorModuleSource())}`;
    const rewrittenSource = rewriteWorkerSource(compiledSource, executeModuleSpecifier, executorModuleSpecifier);
    const workerSpecifier = `data:text/javascript;base64,${toBase64(rewrittenSource)}`;

    let workerModule: Partial<WorkerModuleExports>;
    try {
        workerModule = (await import(workerSpecifier)) as Partial<WorkerModuleExports>;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load worker module.';
        throw new Error(`Unable to load worker module for model "${params.modelId}": ${message}`);
    }

    if (typeof workerModule.validate !== 'function') throw new Error(`Worker validate export is missing for model "${params.modelId}".`);
    if (typeof workerModule.init !== 'function') throw new Error(`Worker init export is missing for model "${params.modelId}".`);
    if (typeof workerModule.onUpdate !== 'function') throw new Error(`Worker onUpdate export is missing for model "${params.modelId}".`);
    if (typeof workerModule.execute !== 'function') throw new Error(`Worker execute export is missing for model "${params.modelId}".`);

    return workerModule as WorkerModuleExports;
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
            const nodeScope: WorkerScope = {};
            const initPayload = buildWorkerPayload(context, nodeScope, null);

            await module.init(initPayload);
            await module.onUpdate(initPayload);

            const validationResult = normalizeValidationResult(await module.validate(buildWorkerPayload(context, nodeScope, null)));
            if (!validationResult.ok) {
                const firstError = validationResult.errors[0] ?? `Worker validation failed for node "${context.node.name}".`;
                return toErrorResult(firstError, validationResult.warnings ?? []);
            }

            const executionNode = toRuntimePatchedNode(context.node, validationResult.normalizedRuntime);
            const warningLogs = (validationResult.warnings ?? []).map((entry) => `WARN ${entry}`);

            const preUpdateResult = normalizeUpdateResult(await module.onUpdate(buildWorkerPayload(context, nodeScope, null, executionNode)));
            if (!preUpdateResult.ok) {
                const message = preUpdateResult.error ?? `Worker onUpdate rejected node "${context.node.name}" before execute.`;
                return toErrorResult(message, warningLogs);
            }

            let attempts = 0;
            let result: WorkerExecuteResult = toErrorResult('Worker execution did not produce a result.', warningLogs);

            while (attempts < MAX_ON_UPDATE_REENTRY) {
                attempts += 1;
                result = normalizeResult(await module.execute(buildWorkerPayload(context, nodeScope, result.output ?? null, executionNode)));
                const postUpdateResult = normalizeUpdateResult(await module.onUpdate(buildWorkerPayload(context, nodeScope, result.output ?? null, executionNode)));
                if (postUpdateResult.ok) {
                    break;
                }
                if (attempts >= MAX_ON_UPDATE_REENTRY) {
                    return toErrorResult(`Worker execute reentry limit (${MAX_ON_UPDATE_REENTRY}) reached for node "${context.node.name}".`, warningLogs);
                }
            }

            return {
                ...result,
                logs: [...warningLogs, ...(result.logs ?? [])]
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Worker execution failed.';
            return toErrorResult(message);
        } finally {
            const helpers = globalWorkerHelpers.__WF_EXECUTE_HELPERS__ ?? {};
            delete helpers[helperId];
            globalWorkerHelpers.__WF_EXECUTE_HELPERS__ = helpers;
        }
    };
};
