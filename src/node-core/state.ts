import { WorkflowDefinition, WorkflowNodeHandlerResult, WorkflowNodeModel, WorkflowNodeSchema, WorkflowNodeStatusEnum } from '../types';
import { buildViewersForOutput } from './viewers';

const createNowIsoTimestamp = (): string => new Date().toISOString();

export const replaceNodeById = (workflow: WorkflowDefinition, nextNode: WorkflowNodeModel): WorkflowDefinition => ({
    ...workflow,
    nodes: workflow.nodes.map((item) => (item.id === nextNode.id ? nextNode : item))
});

export const buildRunningNodeState = (node: WorkflowNodeModel, overrides?: Partial<WorkflowNodeModel>): WorkflowNodeModel => {
    const properties = {
        ...(node.properties ?? {}),
        ...(overrides?.properties ?? {}),
        status: WorkflowNodeStatusEnum.Running,
        timestamp: createNowIsoTimestamp()
    };

    return {
        ...node,
        ...overrides,
        status: WorkflowNodeStatusEnum.Running,
        properties,
        inspector: node.inspector
            ? {
                  ...node.inspector,
                  ...(overrides?.inspector ?? {}),
                  properties: { ...(node.inspector.properties ?? {}), ...properties, status: WorkflowNodeStatusEnum.Running }
              }
            : node.inspector
    };
};

export const buildCompletedNodeState = (
    node: WorkflowNodeModel,
    schema: WorkflowNodeSchema,
    input: Record<string, unknown>,
    result: WorkflowNodeHandlerResult
): WorkflowNodeModel => {
    const status = result.status ?? WorkflowNodeStatusEnum.Passed;
    const properties = { ...(node.properties ?? {}), status, timestamp: createNowIsoTimestamp() };
    return {
        ...node,
        input,
        output: result.output,
        status,
        properties,
        inspector: node.inspector
            ? {
                  ...node.inspector,
                  input,
                  properties: { ...(node.inspector.properties ?? {}), ...properties, status },
                  viewers: buildViewersForOutput(schema, node.inspector.viewers, result.output)
              }
            : node.inspector
    };
};

export const buildFailedNodeState = (node: WorkflowNodeModel, message: string): WorkflowNodeModel => ({
    ...node,
    status: WorkflowNodeStatusEnum.Failed,
    output: { error: message },
    properties: { ...(node.properties ?? {}), status: WorkflowNodeStatusEnum.Failed, timestamp: createNowIsoTimestamp() }
});

export const markRunningNodesAsStopped = (workflow: WorkflowDefinition): WorkflowDefinition => ({
    ...workflow,
    nodes: workflow.nodes.map((node) => (node.status === WorkflowNodeStatusEnum.Running ? { ...node, status: WorkflowNodeStatusEnum.Stopped } : node))
});
