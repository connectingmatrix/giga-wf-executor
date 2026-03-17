import { WorkflowNodeHandlerResult, WorkflowNodeModel, WorkflowNodeStatusEnum } from '../types';

export const WORKFLOW_FAILURE_MITIGATION_STOP = 'stop-workflow';
export const WORKFLOW_FAILURE_MITIGATION_RETRY = 'retry-node';
export const WORKFLOW_MIN_RETRY_COUNT = 1;
export const WORKFLOW_MAX_RETRY_COUNT = 6;

const parseRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const parseFailureMitigationMode = (value: unknown): string => {
    return value === WORKFLOW_FAILURE_MITIGATION_RETRY ? WORKFLOW_FAILURE_MITIGATION_RETRY : WORKFLOW_FAILURE_MITIGATION_STOP;
};

export const parseFailureRetryCount = (value: unknown): number => {
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isFinite(parsed)) return WORKFLOW_MIN_RETRY_COUNT;
    const rounded = Math.round(parsed);
    if (rounded < WORKFLOW_MIN_RETRY_COUNT) return WORKFLOW_MIN_RETRY_COUNT;
    if (rounded > WORKFLOW_MAX_RETRY_COUNT) return WORKFLOW_MAX_RETRY_COUNT;
    return rounded;
};

export const resolveFailureRetryLimit = (node: WorkflowNodeModel): number => {
    const runtime = parseRecord(node.runtime);
    const mitigation = parseFailureMitigationMode(runtime.failureMitigation);
    if (mitigation !== WORKFLOW_FAILURE_MITIGATION_RETRY) return 0;
    return parseFailureRetryCount(runtime.retryCount);
};

export const resolveResultStatus = (result: WorkflowNodeHandlerResult, fallbackStatus: WorkflowNodeStatusEnum = WorkflowNodeStatusEnum.Passed): string => {
    return typeof result.status === 'string' ? result.status : fallbackStatus;
};

export const resolveFailureMessageFromResult = (result: WorkflowNodeHandlerResult, fallbackMessage = 'Node execution failed.'): string => {
    const output = parseRecord(result.output);
    const candidate = output.error ?? output.message;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
    }
    return fallbackMessage;
};

export const buildRetryAttemptLog = (attemptNumber: number, retryLimit: number, errorMessage: string): string =>
    `Attempt ${attemptNumber} failed: ${errorMessage}. Retrying (${attemptNumber}/${retryLimit})...`;

