import { WorkflowConnectionModel, WorkflowDefinition } from '../types';

const parseTargetInputPortName = (connection: WorkflowConnectionModel): string => {
    const [, parsedPort] = (connection.targetHandle ?? '').split(':');
    return parsedPort?.trim() ? parsedPort : 'input';
};

const parseSourceOutputPortName = (connection: WorkflowConnectionModel): string => {
    const [, parsedPort] = (connection.sourceHandle ?? '').split(':');
    return parsedPort?.trim() ? parsedPort : 'output';
};

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

/** Purpose: builds a deterministic per-port input map from upstream ports.out values for a node execution. */
export const buildNodeInputContext = (workflow: WorkflowDefinition, nodeId: string, outputsByNodeId: Map<string, Record<string, unknown>>, fallbackInput: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> => {
    const incoming = workflow.connections.filter((connection) => connection.to === nodeId);
    if (!incoming.length) return fallbackInput;
    return incoming.reduce<Record<string, Record<string, unknown>>>((acc, connection) => {
        const sourcePortsOut = outputsByNodeId.get(connection.from);
        if (!sourcePortsOut) return acc;
        if (!isConnectionActiveForExecution(connection, sourcePortsOut)) return acc;
        const sourceOutput = resolveSourceOutputValue(sourcePortsOut, connection);
        if (typeof sourceOutput === 'undefined') return acc;
        const inputPortName = parseTargetInputPortName(connection);
        if (!acc[inputPortName]) acc[inputPortName] = {};
        acc[inputPortName][connection.from] = sourceOutput;
        return acc;
    }, {});
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
