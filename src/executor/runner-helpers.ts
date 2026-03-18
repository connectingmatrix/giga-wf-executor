import { ExecuteNodeStepOptions, ExecuteWorkflowOptions, WorkflowDefinition, WorkflowNodeModel, WorkflowNodeStatusEnum, WorkflowRunLogEvent } from '../types';
import { WorkflowEventSink } from '../node-core/log';

const BI_DIRECTIONAL_PORT_TYPE = 'bi-directional';

export const toRunnerRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
export const toPortsOut = (node: WorkflowNodeModel): Record<string, unknown> => (node.ports?.out && typeof node.ports.out === 'object' ? node.ports.out : {});
export const toPortsIn = (node: WorkflowNodeModel): Record<string, Record<string, unknown>> => (node.ports?.in && typeof node.ports.in === 'object' ? node.ports.in : {});
export const isNodeEnabled = (node: WorkflowNodeModel): boolean => (typeof node.runtime?.enabled === 'boolean' ? node.runtime.enabled : true);

export const toRuntimeError = (node: WorkflowNodeModel): string | null => {
    const runtime = node.runtime;
    if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return null;
    const candidate = (runtime as Record<string, unknown>).error;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
};

export const normalizeNodeStatus = (node: WorkflowNodeModel, status: string): WorkflowNodeModel => {
    if (node.status === status && node.runtime?.status === status) return node;
    return { ...node, status: status as WorkflowNodeStatusEnum, runtime: { ...(node.runtime ?? {}), status } };
};

const parsePortName = (handle: string | undefined, fallbackPort: string): string => {
    if (!handle) return fallbackPort;
    const [, parsedPort] = handle.split(':');
    return parsedPort?.trim() ? parsedPort : fallbackPort;
};

const getPortType = (
    workflow: WorkflowDefinition,
    nodeId: string,
    handle: string | undefined,
    direction: 'inputs' | 'outputs',
    fallbackPort: string
): string | undefined => {
    const node = workflow.nodes.find((item) => item.id === nodeId);
    if (!node) return undefined;
    const schema = workflow.nodeModels?.[node.modelId];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
    const ports = (schema[direction] && typeof schema[direction] === 'object' && !Array.isArray(schema[direction]) ? schema[direction] : {}) as Record<string, { portType?: unknown }>;
    const portName = parsePortName(handle, Object.keys(ports)[0] ?? fallbackPort);
    return ports[portName]?.portType as string | undefined;
};

const isBiConnection = (workflow: WorkflowDefinition, connection: WorkflowDefinition['connections'][number]): boolean =>
    getPortType(workflow, connection.from, connection.sourceHandle, 'outputs', 'output') === BI_DIRECTIONAL_PORT_TYPE &&
    getPortType(workflow, connection.to, connection.targetHandle, 'inputs', 'input') === BI_DIRECTIONAL_PORT_TYPE;

const getBiOutputPortIds = (workflow: WorkflowDefinition, node: WorkflowNodeModel): string[] => {
    const schema = workflow.nodeModels?.[node.modelId];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
    const outputs = (schema.outputs && typeof schema.outputs === 'object' && !Array.isArray(schema.outputs) ? schema.outputs : {}) as Record<string, { portType?: unknown }>;
    return Object.entries(outputs)
        .filter(([, rules]) => rules?.portType === BI_DIRECTIONAL_PORT_TYPE)
        .map(([portId]) => portId);
};

export const publishBiControlState = (workflow: WorkflowDefinition, node: WorkflowNodeModel): WorkflowNodeModel => {
    const biOutputPortIds = getBiOutputPortIds(workflow, node);
    if (biOutputPortIds.length === 0) return node;
    const nextPortsOut = toRunnerRecord(node.ports?.out);
    const controlState = { nodeId: node.id, nodeName: node.name, modelId: node.modelId, status: node.status, runtime: toRunnerRecord(node.runtime), output: nextPortsOut.output ?? null };
    biOutputPortIds.forEach((portId) => {
        const existingPortValue = toRunnerRecord(nextPortsOut[portId]);
        nextPortsOut[portId] = { ...existingPortValue, STATE: controlState };
    });
    return { ...node, ports: { in: toPortsIn(node), out: nextPortsOut } };
};

export const getBiPeerNodeIds = (workflow: WorkflowDefinition, nodeId: string): string[] => {
    const peers = new Set<string>();
    workflow.connections.forEach((connection) => {
        if (!isBiConnection(workflow, connection)) return;
        if (connection.from === nodeId) peers.add(connection.to);
        if (connection.to === nodeId) peers.add(connection.from);
    });
    peers.delete(nodeId);
    return [...peers];
};

export const createEventCollector = (
    options: Pick<ExecuteWorkflowOptions | ExecuteNodeStepOptions, 'onEvent'>
): { events: WorkflowRunLogEvent[]; sink: WorkflowEventSink } => {
    const events: WorkflowRunLogEvent[] = [];
    const sink: WorkflowEventSink = (event) => {
        const withTimestamp: WorkflowRunLogEvent = { ...event, timestamp: new Date().toISOString() };
        events.push(withTimestamp);
        options.onEvent?.(withTimestamp);
    };
    return { events, sink };
};
