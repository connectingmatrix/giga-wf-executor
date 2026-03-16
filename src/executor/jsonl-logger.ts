import { WorkflowLogger, WorkflowRunLogEvent } from '../types';

export interface JsonlLogger extends WorkflowLogger {
    toJsonl: () => string;
}

export const createJsonlLogger = (onPush?: (event: WorkflowRunLogEvent) => void): JsonlLogger => {
    const entries: WorkflowRunLogEvent[] = [];
    const push = (event: Omit<WorkflowRunLogEvent, 'timestamp'>): void => {
        const nextEvent: WorkflowRunLogEvent = {
            timestamp: new Date().toISOString(),
            ...event
        };
        entries.push(nextEvent);
        onPush?.(nextEvent);
    };

    return {
        entries,
        push,
        toJsonl: (): string => entries.map((entry) => JSON.stringify(entry)).join('\n')
    };
};
