import { WorkflowDefinition, WorkflowNodeModel, WorkflowNodeStatusEnum, WorkflowRuntimeSettings } from '../types';

const VARIABLE_TOKEN_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;
const FULL_TOKEN_REGEX = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

const parseRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const normalizePath = (path: string): string => path.replace(/\[(\d+)\]/g, '.$1').trim();

const resolvePath = (path: string, context: Record<string, unknown>): unknown => {
    const normalized = normalizePath(path);
    if (!normalized) return undefined;
    const segments = normalized.split('.').filter(Boolean);
    let current: unknown = context;
    for (const segment of segments) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
};

const toReplacementString = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value === null) return 'null';
    if (typeof value === 'undefined') return '';
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const cloneValue = <T>(value: T): T => {
    if (typeof value === 'undefined') return value;
    try {
        return JSON.parse(JSON.stringify(value)) as T;
    } catch {
        return value;
    }
};

const resolveStringValue = (source: string, context: Record<string, unknown>): { value: unknown; unresolvedPaths: string[] } => {
    const fullTokenMatch = source.match(FULL_TOKEN_REGEX);
    if (fullTokenMatch) {
        const fullPath = String(fullTokenMatch[1] ?? '').trim();
        if (!fullPath) {
            return { value: source, unresolvedPaths: [] };
        }
        const resolved = resolvePath(fullPath, context);
        if (typeof resolved === 'undefined') {
            return { value: source, unresolvedPaths: [fullPath] };
        }
        if (typeof resolved === 'number' || typeof resolved === 'boolean' || resolved === null) {
            return { value: String(resolved), unresolvedPaths: [] };
        }
        return { value: cloneValue(resolved), unresolvedPaths: [] };
    }

    const unresolvedPaths: string[] = [];
    const value = source.replace(VARIABLE_TOKEN_REGEX, (token, rawPath) => {
        const path = String(rawPath ?? '').trim();
        if (!path) return token;
        const resolved = resolvePath(path, context);
        if (typeof resolved === 'undefined') {
            unresolvedPaths.push(path);
            return token;
        }
        return toReplacementString(resolved);
    });

    return { value, unresolvedPaths };
};

const containsVariableToken = (value: unknown): value is string => typeof value === 'string' && /\{\{\s*[^}]+?\s*\}\}/.test(value);

const resolveValue = (value: unknown, context: Record<string, unknown>): { value: unknown; unresolvedPaths: string[] } => {
    if (typeof value === 'string') {
        return resolveStringValue(value, context);
    }

    if (Array.isArray(value)) {
        const unresolvedPaths: string[] = [];
        const nextValue = value.map((entry) => {
            const next = resolveValue(entry, context);
            unresolvedPaths.push(...next.unresolvedPaths);
            return next.value;
        });
        return { value: nextValue, unresolvedPaths };
    }

    if (value && typeof value === 'object') {
        const unresolvedPaths: string[] = [];
        const nextValue = Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, entry]) => {
            const next = resolveValue(entry, context);
            unresolvedPaths.push(...next.unresolvedPaths);
            acc[key] = next.value;
            return acc;
        }, {});
        return { value: nextValue, unresolvedPaths };
    }

    return { value, unresolvedPaths: [] };
};

const buildInputVariableContext = (input: Record<string, Record<string, unknown>>): Record<string, unknown> => {
    const bySourceNode = Object.entries(input).reduce<Record<string, unknown>>((acc, [portKey, sourceMap]) => {
        const normalizedSourceMap = parseRecord(sourceMap);
        Object.entries(normalizedSourceMap).forEach(([sourceNodeId, sourceValue]) => {
            const existing = parseRecord(acc[sourceNodeId]);
            acc[sourceNodeId] = {
                ...existing,
                output: cloneValue(sourceValue),
                [portKey]: cloneValue(sourceValue)
            };
        });
        return acc;
    }, {});

    return {
        ...input,
        ...bySourceNode
    };
};

const buildWorkflowVariableContext = (workflow: WorkflowDefinition, settings?: WorkflowRuntimeSettings): Record<string, unknown> => {
    const metadata = cloneValue(workflow.metadata) as Record<string, unknown>;
    const metadataRuntime = parseRecord(metadata.runtime);
    const runtimeSettings = cloneValue(
        Object.keys(parseRecord(settings as unknown)).length > 0 ? parseRecord(settings as unknown) : parseRecord(metadataRuntime.settings)
    );

    metadata.runtime = {
        ...metadataRuntime,
        settings: runtimeSettings
    };

    return {
        metadata,
        nodes: cloneValue(workflow.nodes),
        connections: cloneValue(workflow.connections),
        status: WorkflowNodeStatusEnum.Running,
        runtime: {
            ...parseRecord(metadata.runtime),
            settings: runtimeSettings
        },
        settings: runtimeSettings
    };
};

const resolveFieldAllowVariables = (workflow: WorkflowDefinition, node: WorkflowNodeModel, fieldKey: string): boolean => {
    const schema = node.modelId ? workflow.nodeModels?.[node.modelId] : undefined;
    if (!schema) return true;
    const fields = parseRecord(schema.fields);
    const field = parseRecord(fields[fieldKey]);
    if (Object.keys(field).length === 0) return true;
    if (typeof field.allowVariables === 'boolean') return field.allowVariables;

    const normalizedKey = fieldKey.trim().toLowerCase();
    if (normalizedKey === 'status' || normalizedKey === 'source' || normalizedKey === 'timestamp' || normalizedKey === 'nodelibraryid') return false;
    if (field.hidden === true || field.auto === true) return false;
    if (field.type === 'boolean' || field.type === 'number' || field.type === 'timestamp' || field.type === 'file' || field.type === 'file-list') return false;
    return field.editable !== false;
};

export interface WorkflowVariableFailure {
    field: string;
    tokenPath: string;
    reason: 'unresolved' | 'disallowed';
}

export interface WorkflowNodeVariableResolutionResult {
    ok: boolean;
    runtime: Record<string, unknown>;
    failures: WorkflowVariableFailure[];
}

export const resolveNodeRuntimeVariables = (
    workflow: WorkflowDefinition,
    node: WorkflowNodeModel,
    input: Record<string, Record<string, unknown>>,
    settings?: WorkflowRuntimeSettings
): WorkflowNodeVariableResolutionResult => {
    const runtime = parseRecord(node.runtime);
    const context: Record<string, unknown> = {
        input: buildInputVariableContext(input),
        properties: runtime,
        runtime,
        node: {
            id: node.id,
            name: node.name,
            modelId: node.modelId,
            status: node.status
        },
        workflow: buildWorkflowVariableContext(workflow, settings)
    };

    const failures: WorkflowVariableFailure[] = [];
    const nextRuntime = Object.entries(runtime).reduce<Record<string, unknown>>((acc, [field, value]) => {
        const hasVariable = containsVariableToken(value) || (Array.isArray(value) ? value.some((item) => containsVariableToken(item)) : false);
        const allowVariables = resolveFieldAllowVariables(workflow, node, field);

        if (!allowVariables && hasVariable) {
            const unresolved = resolveValue(value, context).unresolvedPaths;
            if (unresolved.length > 0) {
                unresolved.forEach((tokenPath) => failures.push({ field, tokenPath, reason: 'disallowed' }));
            } else if (typeof value === 'string') {
                for (const match of value.matchAll(VARIABLE_TOKEN_REGEX)) {
                    const tokenPath = String(match[1] ?? '').trim();
                    if (tokenPath) failures.push({ field, tokenPath, reason: 'disallowed' });
                }
            }
            acc[field] = value;
            return acc;
        }

        if (!allowVariables) {
            acc[field] = value;
            return acc;
        }

        const resolved = resolveValue(value, context);
        resolved.unresolvedPaths.forEach((tokenPath) => failures.push({ field, tokenPath, reason: 'unresolved' }));
        acc[field] = resolved.value;
        return acc;
    }, {});

    return {
        ok: failures.length === 0,
        runtime: nextRuntime,
        failures
    };
};

export const formatVariableFailureMessage = (failures: WorkflowVariableFailure[], nodeName: string): string => {
    const unique = Array.from(new Set(failures.map((failure) => `${failure.field}:${failure.tokenPath}:${failure.reason}`)));
    const reasons = unique
        .slice(0, 6)
        .map((entry) => {
            const [field, tokenPath, reason] = entry.split(':');
            if (reason === 'disallowed') {
                return `Field "${field}" does not allow variable token "${tokenPath}".`;
            }
            return `Unable to resolve variable token "${tokenPath}" in field "${field}".`;
        });
    const overflow = unique.length > reasons.length ? ` (+${unique.length - reasons.length} more)` : '';
    return `Variable resolution failed for node "${nodeName}": ${reasons.join(' ')}${overflow}`.trim();
};
