import { WorkflowNodeModel, WorkflowNodeStatus } from '../types';

export interface WorkflowNodeExecutionTiming {
    nodeId: string;
    name: string;
    status: WorkflowNodeStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
}

export type WorkflowNodeExecutionTimingMap = Record<string, WorkflowNodeExecutionTiming>;

export const createNodeExecutionTiming = (
    node: WorkflowNodeModel,
    status: WorkflowNodeStatus,
    startedAt: string,
    finishedAt: string,
    durationMs: number
): WorkflowNodeExecutionTiming => ({
    nodeId: node.id,
    name: node.name,
    status,
    startedAt,
    finishedAt,
    durationMs
});

export const buildWorkflowSummaryInput = (
    runId: string,
    outputsByNode: Map<string, unknown>,
    timingsByNode: WorkflowNodeExecutionTimingMap,
    logs: unknown[] = []
): Record<string, unknown> => ({
    runId,
    outputsByNode: Object.fromEntries(outputsByNode.entries()),
    nodeExecutionTimings: timingsByNode,
    totalDurationMs: Object.values(timingsByNode).reduce((total, item) => total + item.durationMs, 0),
    logs
});
