import { WorkflowLogLevelEnum, WorkflowNodeModel, WorkflowNodeStatusEnum, WorkflowRunLogEvent } from '../types';

export type WorkflowEventSink = (event: Omit<WorkflowRunLogEvent, 'timestamp'>) => void;

export const createRunId = (prefix: string): string => `${prefix}_${Date.now()}`;

const resolveLogLevelFromStatus = (status: WorkflowNodeStatusEnum | string): WorkflowLogLevelEnum => {
    if (status === WorkflowNodeStatusEnum.Failed) return WorkflowLogLevelEnum.Error;
    if (status === WorkflowNodeStatusEnum.Warning || status === WorkflowNodeStatusEnum.Stopped) return WorkflowLogLevelEnum.Warn;
    return WorkflowLogLevelEnum.Info;
};

export const emitNodeStarted = (sink: WorkflowEventSink, workflowId: string, runId: string, node: WorkflowNodeModel): void => {
    sink({ workflowId, runId, nodeId: node.id, event: 'node.started', level: WorkflowLogLevelEnum.Info, message: `Running ${node.name}` });
};

export const emitNodeFinished = (sink: WorkflowEventSink, workflowId: string, runId: string, nodeId: string, status: string, durationMs: number, logs?: string[]): void => {
    sink({ workflowId, runId, nodeId, event: 'node.finished', level: resolveLogLevelFromStatus(status), data: { status, durationMs } });
    (logs ?? []).forEach((line) => sink({ workflowId, runId, nodeId, event: 'node.log', level: WorkflowLogLevelEnum.Info, message: line }));
};

export const emitNodeFailed = (sink: WorkflowEventSink, workflowId: string, runId: string, nodeId: string, message: string): void => {
    sink({ workflowId, runId, nodeId, event: 'node.failed', level: WorkflowLogLevelEnum.Error, message });
};

export const emitWorkflowStopped = (sink: WorkflowEventSink, workflowId: string, runId: string): void => {
    sink({ workflowId, runId, event: 'workflow.stopped', level: WorkflowLogLevelEnum.Warn, message: 'Workflow execution was stopped by user.' });
};

export const emitWorkflowCompleted = (sink: WorkflowEventSink, workflowId: string, runId: string): void => {
    sink({ workflowId, runId, event: 'workflow.completed', level: WorkflowLogLevelEnum.Info });
};

export const emitWorkflowValidationFailed = (sink: WorkflowEventSink, workflowId: string, runId: string, message: string): void => {
    sink({ workflowId, runId, event: 'workflow.validation_failed', level: WorkflowLogLevelEnum.Error, message });
};
