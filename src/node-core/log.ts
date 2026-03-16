import { WorkflowLogLevelEnum, WorkflowLogger, WorkflowNodeHandlerResult, WorkflowNodeModel, WorkflowNodeStatus, WorkflowNodeStatusEnum } from '../types';

const resolveLogLevelFromStatus = (status: WorkflowNodeStatus): `${WorkflowLogLevelEnum}` => {
    if (status === WorkflowNodeStatusEnum.Failed) return WorkflowLogLevelEnum.Error;
    if (status === WorkflowNodeStatusEnum.Warning || status === WorkflowNodeStatusEnum.Stopped) return WorkflowLogLevelEnum.Warn;
    return WorkflowLogLevelEnum.Info;
};

export const createRunId = (prefix: 'run' | 'step'): string => `${prefix}_${Date.now()}`;

export const logNodeStarted = (logger: WorkflowLogger, workflowId: string, runId: string, node: WorkflowNodeModel): void => {
    logger.push({ workflowId, runId, nodeId: node.id, event: 'node.started', level: WorkflowLogLevelEnum.Info, message: `Running ${node.name}` });
};

export const logNodeFinished = (
    logger: WorkflowLogger,
    workflowId: string,
    runId: string,
    nodeId: string,
    result: WorkflowNodeHandlerResult,
    durationMs?: number
): void => {
    const status = result.status ?? WorkflowNodeStatusEnum.Passed;
    logger.push({ workflowId, runId, nodeId, event: 'node.finished', level: resolveLogLevelFromStatus(status), data: { status, durationMs } });
    (result.logs ?? []).forEach((line) => {
        logger.push({ workflowId, runId, nodeId, event: 'node.log', level: WorkflowLogLevelEnum.Info, message: line });
    });
};

export const logNodeFailed = (logger: WorkflowLogger, workflowId: string, runId: string, nodeId: string, message: string): void => {
    logger.push({ workflowId, runId, nodeId, event: 'node.failed', level: WorkflowLogLevelEnum.Error, message });
};

export const logWorkflowStopped = (logger: WorkflowLogger, workflowId: string, runId: string): void => {
    logger.push({ workflowId, runId, event: 'workflow.stopped', level: WorkflowLogLevelEnum.Warn, message: 'Workflow execution was stopped by user.' });
};

export const logWorkflowCompleted = (logger: WorkflowLogger, workflowId: string, runId: string): void => {
    logger.push({ workflowId, runId, event: 'workflow.completed', level: WorkflowLogLevelEnum.Info });
};

export const logWorkflowValidationFailed = (logger: WorkflowLogger, workflowId: string, runId: string, message: string): void => {
    logger.push({ workflowId, runId, event: 'workflow.validation_failed', level: WorkflowLogLevelEnum.Error, message });
};
