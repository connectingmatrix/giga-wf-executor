import { WorkflowDefinition, WorkflowNodeHandlerResult, WorkflowNodeModel, WorkflowNodeStatusEnum } from '../types';

const nowIso = (): string => new Date().toISOString();

const toRuntimeMap = (runtime: WorkflowNodeModel['runtime'] | undefined): Record<string, unknown> => {
    return runtime && typeof runtime === 'object' && !Array.isArray(runtime) ? { ...runtime } : {};
};

const toPorts = (ports: WorkflowNodeModel['ports'] | undefined): WorkflowNodeModel['ports'] => ({
    in: ports?.in && typeof ports.in === 'object' ? { ...ports.in } : {},
    out: ports?.out && typeof ports.out === 'object' ? { ...ports.out } : {}
});

const buildOutputPorts = (output: unknown): Record<string, unknown> => {
    const portsOut: Record<string, unknown> = { output };
    if (output && typeof output === 'object' && !Array.isArray(output)) {
        const record = output as Record<string, unknown>;
        if (Array.isArray(record.__activeOutputs)) portsOut.__activeOutputs = record.__activeOutputs;
        if (Array.isArray(record.__activeConnectionIds)) portsOut.__activeConnectionIds = record.__activeConnectionIds;
        Object.entries(record).forEach(([key, value]) => {
            if (key.endsWith('Branch') && value && typeof value === 'object' && !Array.isArray(value)) {
                const branch = value as { outputPort?: unknown; value?: unknown };
                if (typeof branch.outputPort === 'string' && branch.outputPort.trim()) {
                    portsOut[branch.outputPort] = branch.value;
                }
            }
        });
    }
    return portsOut;
};

export const replaceNodeById = (workflow: WorkflowDefinition, nextNode: WorkflowNodeModel): WorkflowDefinition => ({
    ...workflow,
    nodes: workflow.nodes.map((item) => (item.id === nextNode.id ? nextNode : item))
});

export const buildRunningNodeState = (node: WorkflowNodeModel, overrides?: Partial<WorkflowNodeModel>): WorkflowNodeModel => {
    const runtime = { ...toRuntimeMap(node.runtime), ...toRuntimeMap(overrides?.runtime), status: WorkflowNodeStatusEnum.Running, timestamp: nowIso() };
    const ports = toPorts(overrides?.ports ?? node.ports);
    return { ...node, ...overrides, status: WorkflowNodeStatusEnum.Running, runtime, ports };
};

export const buildCompletedNodeState = (node: WorkflowNodeModel, input: Record<string, Record<string, unknown>>, result: WorkflowNodeHandlerResult): WorkflowNodeModel => {
    const status = result.status ?? WorkflowNodeStatusEnum.Passed;
    const runtime = { ...toRuntimeMap(node.runtime), status, timestamp: nowIso() };
    const ports = toPorts(node.ports);
    ports.in = input;
    ports.out = buildOutputPorts(result.output);
    return { ...node, status, runtime, ports };
};

export const buildFailedNodeState = (node: WorkflowNodeModel, message: string): WorkflowNodeModel => {
    const runtime = { ...toRuntimeMap(node.runtime), status: WorkflowNodeStatusEnum.Failed, timestamp: nowIso(), error: message };
    const ports = toPorts(node.ports);
    ports.out = { error: { message } };
    return { ...node, status: WorkflowNodeStatusEnum.Failed, runtime, ports };
};

export const markRunningNodesAsStopped = (workflow: WorkflowDefinition): WorkflowDefinition => ({
    ...workflow,
    nodes: workflow.nodes.map((node) => {
        if (node.status !== WorkflowNodeStatusEnum.Running) return node;
        return { ...node, status: WorkflowNodeStatusEnum.Stopped, runtime: { ...toRuntimeMap(node.runtime), status: WorkflowNodeStatusEnum.Stopped, timestamp: nowIso() } };
    })
});
