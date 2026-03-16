import { WorkflowConnectionModel, WorkflowDefinition } from '../types';

const parseTargetInputPortName = (connection: WorkflowConnectionModel): string => {
    const targetHandle = connection.targetHandle;
    if (!targetHandle) return 'input';
    const [, parsedPort] = targetHandle.split(':');
    return parsedPort?.trim() ? parsedPort : 'input';
};

const parseSourceOutputPortName = (connection: WorkflowConnectionModel): string => {
    const sourceHandle = connection.sourceHandle;
    if (!sourceHandle) return 'output';
    const [, parsedPort] = sourceHandle.split(':');
    return parsedPort?.trim() ? parsedPort : 'output';
};

const parseActiveOutputPorts = (sourceOutput: unknown): string[] | null => {
    if (!sourceOutput || typeof sourceOutput !== 'object' || Array.isArray(sourceOutput)) return null;
    const activeOutputs = (sourceOutput as { __activeOutputs?: unknown }).__activeOutputs;
    if (!Array.isArray(activeOutputs)) return null;
    return activeOutputs.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

const parseActiveConnectionIds = (sourceOutput: unknown): string[] | null => {
    if (!sourceOutput || typeof sourceOutput !== 'object' || Array.isArray(sourceOutput)) return null;
    const activeConnectionIds = (sourceOutput as { __activeConnectionIds?: unknown }).__activeConnectionIds;
    if (!Array.isArray(activeConnectionIds)) return null;
    return activeConnectionIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

const isConnectionActiveForExecution = (connection: WorkflowConnectionModel, outputsByNodeId: Map<string, unknown>): boolean => {
    const sourceOutput = outputsByNodeId.get(connection.from);
    if (typeof sourceOutput === 'undefined') return false;
    const activeConnectionIds = parseActiveConnectionIds(sourceOutput);
    if (activeConnectionIds && activeConnectionIds.length > 0) return activeConnectionIds.includes(connection.id);
    const activeOutputPorts = parseActiveOutputPorts(sourceOutput);
    if (!activeOutputPorts || activeOutputPorts.length === 0) return true;
    const sourcePortName = parseSourceOutputPortName(connection);
    return activeOutputPorts.includes(sourcePortName);
};

export const buildNodeInputContext = (
    workflow: WorkflowDefinition,
    nodeId: string,
    outputsByNodeId: Map<string, unknown>,
    fallbackInput: Record<string, unknown>
): Record<string, unknown> => {
    // Collect all inbound edges that feed this node.
    const incoming = workflow.connections.filter((connection) => connection.to === nodeId);
    // If there are no inbound edges, preserve existing input state.
    if (!incoming.length) return fallbackInput;

    // Group inputs by target port name and source node id.
    const nextInput = incoming.reduce<Record<string, unknown>>((acc, connection) => {
        // Skip branch edges that are inactive for this run.
        if (!isConnectionActiveForExecution(connection, outputsByNodeId)) return acc;
        // Resolve upstream output from previously completed nodes.
        const sourceOutput = outputsByNodeId.get(connection.from);
        if (typeof sourceOutput === 'undefined') return acc;
        // Resolve port key from the incoming handle id.
        const inputPortName = parseTargetInputPortName(connection);
        if (!acc[inputPortName]) acc[inputPortName] = {};
        (acc[inputPortName] as Record<string, unknown>)[connection.from] = sourceOutput;
        return acc;
    }, {});

    // Keep the previous node input under `current` for compatibility.
    if (Object.keys(fallbackInput ?? {}).length > 0) nextInput.current = fallbackInput;
    return nextInput;
};

export const shouldExecuteNodeInCurrentRun = (workflow: WorkflowDefinition, nodeId: string, outputsByNodeId: Map<string, unknown>): boolean => {
    const incoming = workflow.connections.filter((connection) => connection.to === nodeId);
    if (incoming.length === 0) return true;
    return incoming.some((connection) => isConnectionActiveForExecution(connection, outputsByNodeId));
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

export const sortWorkflowNodesTopologically = (workflow: WorkflowDefinition): string[] => {
    // Keep a stable node order fallback for cyclic graphs.
    const nodeIds = workflow.nodes.map((node) => node.id);
    // Track incoming edge counts for each node.
    const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
    // Track outgoing edges by source node id.
    const outgoing = new Map<string, string[]>();

    // Build indegree and adjacency from all workflow edges.
    workflow.connections.forEach((connection) => {
        indegree.set(connection.to, (indegree.get(connection.to) || 0) + 1);
        const list = outgoing.get(connection.from) || [];
        list.push(connection.to);
        outgoing.set(connection.from, list);
    });

    // Seed queue with nodes that have no prerequisites.
    const queue = nodeIds.filter((id) => (indegree.get(id) || 0) === 0);
    // Store sorted execution ids.
    const ordered: string[] = [];

    // Run Kahn algorithm to resolve dependency order.
    while (queue.length > 0) {
        const current = queue.shift() as string;
        ordered.push(current);
        (outgoing.get(current) || []).forEach((target) => {
            const nextDegree = (indegree.get(target) || 0) - 1;
            indegree.set(target, nextDegree);
            if (nextDegree === 0) queue.push(target);
        });
    }

    // Fallback to declaration order when cycles are present.
    if (ordered.length !== nodeIds.length) return nodeIds;
    return ordered;
};
