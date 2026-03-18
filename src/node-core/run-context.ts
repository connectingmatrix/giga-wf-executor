import { WorkflowConnectionModel, WorkflowDefinition, WorkflowNodeSchema } from '../types';

const BI_DIRECTIONAL_PORT_TYPE = 'bi-directional';

const parseTargetInputPortName = (connection: WorkflowConnectionModel): string => {
    const [, parsedPort] = (connection.targetHandle ?? '').split(':');
    return parsedPort?.trim() ? parsedPort : 'input';
};

const parseSourceOutputPortName = (connection: WorkflowConnectionModel): string => {
    const [, parsedPort] = (connection.sourceHandle ?? '').split(':');
    return parsedPort?.trim() ? parsedPort : 'output';
};

const toRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const parseStringArray = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    const next = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return next.length > 0 ? next : null;
};

const isConnectionActiveForExecution = (connection: WorkflowConnectionModel, sourcePortsOut: Record<string, unknown>): boolean => {
    const activeConnectionIds = parseStringArray(sourcePortsOut.__activeConnectionIds);
    if (activeConnectionIds) return activeConnectionIds.includes(connection.id);
    const activeOutputPorts = parseStringArray(sourcePortsOut.__activeOutputs);
    if (!activeOutputPorts) return true;
    return activeOutputPorts.includes(parseSourceOutputPortName(connection));
};

const resolveSourceOutputValue = (sourcePortsOut: Record<string, unknown>, connection: WorkflowConnectionModel): unknown => {
    const sourcePortName = parseSourceOutputPortName(connection);
    if (Object.prototype.hasOwnProperty.call(sourcePortsOut, sourcePortName)) return sourcePortsOut[sourcePortName];
    return sourcePortsOut.output;
};

const getNodeSchema = (workflow: WorkflowDefinition, nodeId: string): WorkflowNodeSchema | null => {
    const node = workflow.nodes.find((item) => item.id === nodeId);
    if (!node) return null;
    const schema = workflow.nodeModels?.[node.modelId];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
    return schema;
};

const getSourcePortType = (workflow: WorkflowDefinition, connection: WorkflowConnectionModel): string | undefined => {
    const schema = getNodeSchema(workflow, connection.from);
    if (!schema || typeof schema.outputs !== 'object' || !schema.outputs) return undefined;
    const sourcePortName = parseSourceOutputPortName(connection);
    return (schema.outputs as Record<string, { portType?: unknown }>)[sourcePortName]?.portType as string | undefined;
};

const getTargetPortType = (workflow: WorkflowDefinition, connection: WorkflowConnectionModel): string | undefined => {
    const schema = getNodeSchema(workflow, connection.to);
    if (!schema || typeof schema.inputs !== 'object' || !schema.inputs) return undefined;
    const targetPortName = parseTargetInputPortName(connection);
    return (schema.inputs as Record<string, { portType?: unknown }>)[targetPortName]?.portType as string | undefined;
};

const isBiConnection = (workflow: WorkflowDefinition, connection: WorkflowConnectionModel): boolean => {
    const sourcePortType = getSourcePortType(workflow, connection);
    const targetPortType = getTargetPortType(workflow, connection);
    return sourcePortType === BI_DIRECTIONAL_PORT_TYPE && targetPortType === BI_DIRECTIONAL_PORT_TYPE;
};

const resolveBiState = (sourcePortsOut: Record<string, unknown>, sourcePortName: string): unknown => {
    const sourcePortValue = sourcePortsOut[sourcePortName];
    if (!sourcePortValue || typeof sourcePortValue !== 'object' || Array.isArray(sourcePortValue)) return undefined;
    const sourcePortRecord = sourcePortValue as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(sourcePortRecord, 'STATE')) return sourcePortRecord.STATE;
    return sourcePortRecord;
};

const ensureBiPortBucket = (inputContext: Record<string, Record<string, unknown>>, inputPortName: string): { IN: Record<string, unknown>; STATE: Record<string, unknown> } => {
    const current = toRecord(inputContext[inputPortName]);
    const incoming = toRecord(current.IN);
    const state = toRecord(current.STATE);
    const next = { ...current, IN: incoming, STATE: state };
    inputContext[inputPortName] = next;
    return next as { IN: Record<string, unknown>; STATE: Record<string, unknown> };
};

/** Purpose: builds a deterministic per-port input map from upstream ports.out values for a node execution. */
export const buildNodeInputContext = (workflow: WorkflowDefinition, nodeId: string, outputsByNodeId: Map<string, Record<string, unknown>>, fallbackInput: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> => {
    const relevantConnections = workflow.connections.filter((connection) => connection.to === nodeId || (connection.from === nodeId && isBiConnection(workflow, connection)));
    if (!relevantConnections.length) return fallbackInput;

    const resolvedContext = relevantConnections.reduce<Record<string, Record<string, unknown>>>((acc, connection) => {
        const connectionIsBi = isBiConnection(workflow, connection);
        if (connection.from === nodeId && connectionIsBi) {
            const peerPortsOut = outputsByNodeId.get(connection.to);
            if (!peerPortsOut) return acc;
            const localPortName = parseSourceOutputPortName(connection);
            const peerOutputPortName = parseTargetInputPortName(connection);
            const bucket = ensureBiPortBucket(acc, localPortName);
            const peerPortValue = Object.prototype.hasOwnProperty.call(peerPortsOut, peerOutputPortName) ? peerPortsOut[peerOutputPortName] : peerPortsOut.output;
            if (typeof peerPortValue !== 'undefined') {
                bucket.IN[connection.to] = peerPortValue;
            }
            const peerState = resolveBiState(peerPortsOut, peerOutputPortName);
            if (typeof peerState !== 'undefined') {
                bucket.STATE[connection.to] = peerState;
            }
            return acc;
        }

        if (connection.to !== nodeId) return acc;
        const sourcePortsOut = outputsByNodeId.get(connection.from);
        if (!sourcePortsOut) return acc;
        if (!isConnectionActiveForExecution(connection, sourcePortsOut)) return acc;
        const sourceOutput = resolveSourceOutputValue(sourcePortsOut, connection);
        if (typeof sourceOutput === 'undefined') return acc;
        const inputPortName = parseTargetInputPortName(connection);
        if (connectionIsBi) {
            const sourcePortName = parseSourceOutputPortName(connection);
            const bucket = ensureBiPortBucket(acc, inputPortName);
            bucket.IN[connection.from] = sourceOutput;
            const peerState = resolveBiState(sourcePortsOut, sourcePortName);
            if (typeof peerState !== 'undefined') {
                bucket.STATE[connection.from] = peerState;
            }
            return acc;
        }
        if (!acc[inputPortName]) acc[inputPortName] = {};
        acc[inputPortName][connection.from] = sourceOutput;
        return acc;
    }, {});

    if (Object.keys(resolvedContext).length === 0) return fallbackInput;
    return resolvedContext;
};

export const shouldExecuteNodeInCurrentRun = (workflow: WorkflowDefinition, nodeId: string, outputsByNodeId: Map<string, Record<string, unknown>>): boolean => {
    const incoming = workflow.connections.filter((connection) => connection.to === nodeId);
    if (incoming.length === 0) return true;
    return incoming.some((connection) => {
        const sourcePortsOut = outputsByNodeId.get(connection.from);
        return sourcePortsOut ? isConnectionActiveForExecution(connection, sourcePortsOut) : false;
    });
};

export const collectReachableNodeIdsFromStartNodes = (workflow: WorkflowDefinition, startNodeIds: string[]): Set<string> => {
    const reachableNodeIds = new Set<string>(startNodeIds);
    const queue = [...startNodeIds];
    while (queue.length > 0) {
        const currentNodeId = queue.shift() as string;
        const downstream = workflow.connections.filter((connection) => connection.from === currentNodeId).map((connection) => connection.to);
        downstream.forEach((downstreamNodeId) => {
            if (reachableNodeIds.has(downstreamNodeId)) return;
            reachableNodeIds.add(downstreamNodeId);
            queue.push(downstreamNodeId);
        });
    }
    return reachableNodeIds;
};

/** Purpose: computes a stable topological execution order for workflow nodes, with declaration-order fallback on cycles. */
export const sortWorkflowNodesTopologically = (workflow: WorkflowDefinition): string[] => {
    const nodeIds = workflow.nodes.map((node) => node.id);
    const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>();
    workflow.connections.forEach((connection) => {
        indegree.set(connection.to, (indegree.get(connection.to) || 0) + 1);
        const list = outgoing.get(connection.from) || [];
        list.push(connection.to);
        outgoing.set(connection.from, list);
    });
    const queue = nodeIds.filter((id) => (indegree.get(id) || 0) === 0);
    const ordered: string[] = [];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        ordered.push(current);
        (outgoing.get(current) || []).forEach((target) => {
            const nextDegree = (indegree.get(target) || 0) - 1;
            indegree.set(target, nextDegree);
            if (nextDegree === 0) queue.push(target);
        });
    }
    return ordered.length === nodeIds.length ? ordered : nodeIds;
};
