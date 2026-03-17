import {
    WorkerExecuteResult,
    WorkerModuleExports,
    WorkerPayload,
    WorkerRuntimeEnvironment,
    WorkerRuntimeEnvironmentEnum,
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

type TypeScriptModuleLoader = () => Promise<unknown>;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
const globalWorkerHelpers = globalThis as typeof globalThis & GlobalWorkerHelpers;
const MAX_ON_UPDATE_REENTRY = 6;
const compiledWorkerSourceBySignature = new Map<string, string>();
const WORKER_NODE_BUILTIN_STUB_SPECIFIER = '@workflow/node-builtin-stub';
const NODE_BUILTIN_MODULES = new Set<string>([
    'assert',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'diagnostics_channel',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'timers',
    'tls',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'wasi',
    'worker_threads',
    'zlib'
]);

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
    runtimeEnvironment: WorkerRuntimeEnvironment,
    nodeOverride?: WorkflowNodeModel
): WorkerPayload => {
    const node = nodeOverride ?? context.node;
    return {
        workflow: context.workflow,
        ENVIRONMENT: runtimeEnvironment,
        EXECUTOR: {
            environment: runtimeEnvironment
        },
        NODE_SCOPE: scope,
        NODE: toNodeFacade(node),
        self: {
            status: node.status,
            PORTS: node.ports,
            OUTPUT: outputValue
        } satisfies WorkerSelfState
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const unwrapModuleDefault = (moduleRef: unknown): unknown => {
    let current: unknown = moduleRef;
    for (let index = 0; index < 4; index += 1) {
        if (!isRecord(current)) return current;
        if (typeof current.transpileModule === 'function') return current;
        if (!Object.prototype.hasOwnProperty.call(current, 'default')) return current;
        current = current.default;
    }
    return current;
};

const resolveTypescriptModuleApi = (moduleRef: unknown): TypeScriptModuleApi => {
    const resolved = unwrapModuleDefault(moduleRef);
    if (!isRecord(resolved) || typeof resolved.transpileModule !== 'function') {
        throw new Error('TypeScript module is missing transpileModule.');
    }
    return resolved as TypeScriptModuleApi;
};

const getTypescriptModule = async (moduleLoader?: TypeScriptModuleLoader): Promise<TypeScriptModuleApi> => {
    try {
        const moduleRef = moduleLoader ? await moduleLoader() : await import('typescript');
        return resolveTypescriptModuleApi(moduleRef);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown TypeScript bootstrap error.';
        throw new Error(`Worker TypeScript compiler bootstrap failed: ${message}`);
    }
};

const resolveEnumNumber = (enumSource: unknown, key: string, fallback: number): number => {
    if (!isRecord(enumSource)) return fallback;
    const value = enumSource[key];
    return typeof value === 'number' ? value : fallback;
};

const resolveCompilerOptions = (tsModule: TypeScriptModuleApi): Record<string, number | boolean> => ({
    target: resolveEnumNumber((tsModule as unknown as Record<string, unknown>).ScriptTarget, 'ES2022', 9),
    module: resolveEnumNumber((tsModule as unknown as Record<string, unknown>).ModuleKind, 'ESNext', 99),
    moduleResolution: resolveEnumNumber((tsModule as unknown as Record<string, unknown>).ModuleResolutionKind, 'Bundler', 100),
    importsNotUsedAsValues: resolveEnumNumber((tsModule as unknown as Record<string, unknown>).ImportsNotUsedAsValues, 'Remove', 0),
    isolatedModules: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    strict: true
});

const formatCompileDiagnostics = (tsModule: TypeScriptModuleApi, diagnostics: unknown[] | undefined): string[] => {
    if (!diagnostics || diagnostics.length === 0) return [];

    const flattenDiagnosticMessageText: (messageText: unknown, newLine: string) => string =
        typeof tsModule.flattenDiagnosticMessageText === 'function'
            ? (messageText, newLine) => tsModule.flattenDiagnosticMessageText(messageText as import('typescript').DiagnosticMessageChain | string | undefined, newLine)
            : (messageText) => String(messageText ?? '');

    return diagnostics.map((diagnostic) => {
        const diagnosticRecord = toRecord<Record<string, unknown>>(diagnostic);
        const message = flattenDiagnosticMessageText(diagnosticRecord.messageText, '\n');
        const file = toRecord<Record<string, unknown>>(diagnosticRecord.file);
        const getLineAndCharacterOfPosition = file.getLineAndCharacterOfPosition;
        if (typeof getLineAndCharacterOfPosition !== 'function') return message;

        try {
            const lineAndCharacter = toRecord(getLineAndCharacterOfPosition(diagnosticRecord.start ?? 0));
            const line = Number(lineAndCharacter.line ?? 0) + 1;
            const character = Number(lineAndCharacter.character ?? 0) + 1;
            const fileName = typeof file.fileName === 'string' ? file.fileName : '<worker>';
            return `${fileName}:${line}:${character} ${message}`;
        } catch {
            return message;
        }
    });
};

const normalizeNodeBuiltinSpecifier = (specifier: string): string =>
    specifier.startsWith('node:') ? specifier.slice(5) : specifier;

const isNodeBuiltinSpecifier = (specifier: string): boolean =>
    NODE_BUILTIN_MODULES.has(normalizeNodeBuiltinSpecifier(specifier));

const parseNamedBindings = (namedSection: string): Array<{ imported: string; local: string }> => {
    return namedSection
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => part.replace(/^type\s+/, '').trim())
        .filter((part) => part.length > 0)
        .map((part) => {
            const [left, right] = part.split(/\s+as\s+/);
            const imported = (left ?? '').trim();
            const local = (right ?? left ?? '').trim();
            return { imported, local };
        })
        .filter((entry) => entry.imported.length > 0 && entry.local.length > 0);
};

const rewriteNodeBuiltinImportsForBrowser = (source: string): string => {
    let importCounter = 0;
    let rewritten = source;

    rewritten = rewritten.replace(/(^|\n)([ \t]*)import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\4\s*;?/gm, (match, prefix, indent, clauseRaw, _quote, rawSpecifier) => {
        const specifier = String(rawSpecifier ?? '').trim();
        if (!isNodeBuiltinSpecifier(specifier)) return match;

        const clause = String(clauseRaw ?? '').trim();
        const namedOnlyMatch = clause.match(/^\{([\s\S]*)\}$/);
        const namespaceOnlyMatch = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
        const defaultAndRestMatch = clause.match(/^([A-Za-z_$][\w$]*)\s*,\s*([\s\S]+)$/);
        const defaultOnlyMatch = clause.match(/^([A-Za-z_$][\w$]*)$/);

        let defaultBinding: string | null = null;
        let namespaceBinding: string | null = null;
        let namedBindings: Array<{ imported: string; local: string }> = [];

        if (namedOnlyMatch) {
            namedBindings = parseNamedBindings(namedOnlyMatch[1] ?? '');
        } else if (namespaceOnlyMatch) {
            namespaceBinding = namespaceOnlyMatch[1] ?? null;
        } else if (defaultAndRestMatch) {
            defaultBinding = defaultAndRestMatch[1] ?? null;
            const rest = (defaultAndRestMatch[2] ?? '').trim();
            const restNamedMatch = rest.match(/^\{([\s\S]*)\}$/);
            const restNamespaceMatch = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
            if (restNamedMatch) {
                namedBindings = parseNamedBindings(restNamedMatch[1] ?? '');
            } else if (restNamespaceMatch) {
                namespaceBinding = restNamespaceMatch[1] ?? null;
            }
        } else if (defaultOnlyMatch) {
            defaultBinding = defaultOnlyMatch[1] ?? null;
        } else {
            return `${prefix}${indent}/* Node builtin import "${specifier}" is ignored in browser runtime. */`;
        }

        const tempBinding = `__wfBuiltin_${normalizeNodeBuiltinSpecifier(specifier).replace(/[^a-zA-Z0-9_$]/g, '_')}_${importCounter}`;
        importCounter += 1;
        const importBinding = defaultBinding ?? namespaceBinding ?? tempBinding;
        const lines: string[] = [`${indent}import ${importBinding} from '${WORKER_NODE_BUILTIN_STUB_SPECIFIER}';`];

        if (namespaceBinding && namespaceBinding !== importBinding) {
            lines.push(`${indent}const ${namespaceBinding} = ${importBinding};`);
        }

        namedBindings.forEach(({ imported, local }) => {
            lines.push(`${indent}const ${local} = ${importBinding}.${imported};`);
        });

        return `${prefix}${lines.join('\n')}`;
    });

    rewritten = rewritten.replace(/(^|\n)([ \t]*)import\s+(['"])([^'"]+)\3\s*;?/gm, (match, prefix, indent, _quote, rawSpecifier) => {
        const specifier = String(rawSpecifier ?? '').trim();
        if (!isNodeBuiltinSpecifier(specifier)) return match;
        return `${prefix}${indent}/* Node builtin side-effect import "${specifier}" is ignored in browser runtime. */`;
    });

    rewritten = rewritten.replace(/import\(\s*(['"])([^'"]+)\1\s*\)/g, (match, _quote, rawSpecifier) => {
        const specifier = String(rawSpecifier ?? '').trim();
        if (!isNodeBuiltinSpecifier(specifier)) return match;
        return `import('${WORKER_NODE_BUILTIN_STUB_SPECIFIER}').then((module) => module.default ?? module)`;
    });

    return rewritten;
};

const compileWorkerSource = async (modelId: string, source: string, moduleLoader?: TypeScriptModuleLoader): Promise<string> => {
    const tsModule = await getTypescriptModule(moduleLoader);
    const transpileResult = tsModule.transpileModule(source, {
        fileName: `${modelId}.worker.ts`,
        reportDiagnostics: true,
        compilerOptions: resolveCompilerOptions(tsModule)
    });

    const diagnostics = Array.isArray(transpileResult.diagnostics) ? transpileResult.diagnostics : [];
    const errorCategory = resolveEnumNumber((tsModule as unknown as Record<string, unknown>).DiagnosticCategory, 'Error', 1);
    const hasError = diagnostics.some((diagnostic) => Number(toRecord<Record<string, unknown>>(diagnostic).category ?? -1) === errorCategory);
    if (hasError) {
        const formatted = formatCompileDiagnostics(tsModule, diagnostics);
        throw new Error(`Worker TypeScript compile failed for model "${modelId}": ${formatted.join(' | ')}`);
    }

    if (typeof transpileResult.outputText !== 'string') {
        throw new Error(`Worker TypeScript compile failed for model "${modelId}": transpile output was not generated.`);
    }

    return transpileResult.outputText;
};

const rewriteWorkerSource = (
    source: string,
    executeModuleSpecifier: string,
    executorModuleSpecifier: string,
    builtinStubSpecifier?: string
): string => {
    let rewritten = source
        .replace(/from\s+['"]@workflow\/execute['"]/g, `from '${executeModuleSpecifier}'`)
        .replace(/import\(\s*['"]@workflow\/execute['"]\s*\)/g, `import('${executeModuleSpecifier}')`)
        .replace(/from\s+['"]@workflow\/executor['"]/g, `from '${executorModuleSpecifier}'`)
        .replace(/import\(\s*['"]@workflow\/executor['"]\s*\)/g, `import('${executorModuleSpecifier}')`);

    if (builtinStubSpecifier) {
        rewritten = rewritten
            .replace(/from\s+['"]@workflow\/node-builtin-stub['"]/g, `from '${builtinStubSpecifier}'`)
            .replace(/import\(\s*['"]@workflow\/node-builtin-stub['"]\s*\)/g, `import('${builtinStubSpecifier}')`);
    }

    return rewritten;
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

const createBrowserNodeBuiltinStubSource = (): string => `
const createStub = () => {
  let proxy;
  const fn = () => undefined;
  const handler = {
    get: (_target, key) => (key === 'then' ? undefined : proxy),
    apply: () => undefined,
    construct: () => ({})
  };
  proxy = new Proxy(fn, handler);
  return proxy;
};
const stub = createStub();
export default stub;
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
    runtimeEnvironment: WorkerRuntimeEnvironment;
    typescriptModuleLoader?: TypeScriptModuleLoader;
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

    const sourceForCompile =
        params.runtimeEnvironment === WorkerRuntimeEnvironmentEnum.Browser
            ? rewriteNodeBuiltinImportsForBrowser(source)
            : source;
    const compileCacheKey = `${params.runtimeEnvironment}:${params.modelId}:${expectedSignature}`;
    let compiledSource = compiledWorkerSourceBySignature.get(compileCacheKey);
    if (!compiledSource) {
        compiledSource = await compileWorkerSource(params.modelId, sourceForCompile, params.typescriptModuleLoader);
        compiledWorkerSourceBySignature.set(compileCacheKey, compiledSource);
    }

    const executeModuleSpecifier = `data:text/javascript;base64,${toBase64(createVirtualExecuteModuleSource(params.helperId))}`;
    const executorModuleSpecifier = `data:text/javascript;base64,${toBase64(createVirtualExecutorModuleSource())}`;
    const builtinStubSpecifier =
        params.runtimeEnvironment === WorkerRuntimeEnvironmentEnum.Browser
            ? `data:text/javascript;base64,${toBase64(createBrowserNodeBuiltinStubSource())}`
            : undefined;
    const rewrittenSource = rewriteWorkerSource(compiledSource, executeModuleSpecifier, executorModuleSpecifier, builtinStubSpecifier);
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
    runtimeEnvironment?: WorkerRuntimeEnvironment;
    typescriptModuleLoader?: TypeScriptModuleLoader;
}): WorkflowNodeHandler => {
    return async (context) => {
        const workflowId = String(context.workflow.metadata.id || 'workflow');
        const helperId = `${workflowId}:${context.node.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
        const runtimeEnvironment = args.runtimeEnvironment ?? WorkerRuntimeEnvironmentEnum.Node;

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
                helperId,
                runtimeEnvironment,
                typescriptModuleLoader: args.typescriptModuleLoader
            });
            const nodeScope: WorkerScope = {};
            const initPayload = buildWorkerPayload(context, nodeScope, null, runtimeEnvironment);

            await module.init(initPayload);
            await module.onUpdate(initPayload);

            const validationResult = normalizeValidationResult(await module.validate(buildWorkerPayload(context, nodeScope, null, runtimeEnvironment)));
            if (!validationResult.ok) {
                const firstError = validationResult.errors[0] ?? `Worker validation failed for node "${context.node.name}".`;
                return toErrorResult(firstError, validationResult.warnings ?? []);
            }

            const executionNode = toRuntimePatchedNode(context.node, validationResult.normalizedRuntime);
            const warningLogs = (validationResult.warnings ?? []).map((entry) => `WARN ${entry}`);

            const preUpdateResult = normalizeUpdateResult(await module.onUpdate(buildWorkerPayload(context, nodeScope, null, runtimeEnvironment, executionNode)));
            if (!preUpdateResult.ok) {
                const message = preUpdateResult.error ?? `Worker onUpdate rejected node "${context.node.name}" before execute.`;
                return toErrorResult(message, warningLogs);
            }

            let attempts = 0;
            let result: WorkerExecuteResult = toErrorResult('Worker execution did not produce a result.', warningLogs);

            while (attempts < MAX_ON_UPDATE_REENTRY) {
                attempts += 1;
                result = normalizeResult(await module.execute(buildWorkerPayload(context, nodeScope, result.output ?? null, runtimeEnvironment, executionNode)));
                const postUpdateResult = normalizeUpdateResult(await module.onUpdate(buildWorkerPayload(context, nodeScope, result.output ?? null, runtimeEnvironment, executionNode)));
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
