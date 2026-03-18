import {
    WorkerExecuteHelpers,
    WorkflowDefinition,
    WorkflowInvokeConnectedNodeArgs,
    WorkflowNodeHandlerContext,
    WorkflowNodeHandlerResult
} from '../types';

export interface GlobalWorkerHelpers {
    __WF_EXECUTE_HELPERS__?: Record<string, WorkerExecuteHelpers>;
}

export const globalWorkerHelpers = globalThis as typeof globalThis & GlobalWorkerHelpers;

const buildWorkerContext = (context: WorkflowNodeHandlerContext): WorkflowNodeHandlerContext => ({
    node: context.node,
    workflow: context.workflow,
    input: context.input,
    settings: context.settings,
    signal: context.signal,
    hostContext: context.hostContext,
    invokeConnectedNode: context.invokeConnectedNode
});

export const createExecuteBackendHelper = (
    executeHelpers: WorkerExecuteHelpers | undefined,
    context: WorkflowNodeHandlerContext
): ((...workerArgs: unknown[]) => Promise<WorkflowNodeHandlerResult>) | undefined => {
    if (!executeHelpers?.executeBackend) return undefined;
    return async (...workerArgs: unknown[]) =>
        executeHelpers.executeBackend!({
            context: buildWorkerContext(context),
            descriptor:
                workerArgs.length > 0 &&
                typeof workerArgs[0] === 'object' &&
                workerArgs[0] !== null &&
                !Array.isArray(workerArgs[0]) &&
                typeof (workerArgs[0] as Record<string, unknown>).service === 'string' &&
                typeof (workerArgs[0] as Record<string, unknown>).function === 'string'
                    ? ((workerArgs[0] as unknown) as { service: string; function: string; description?: string })
                    : undefined,
            payload: workerArgs.length > 1 ? workerArgs[1] : undefined,
            args: workerArgs
        });
};

export const createInvokeConnectedNodeHelper = (
    executeHelpers: WorkerExecuteHelpers | undefined,
    context: WorkflowNodeHandlerContext
): ((...workerArgs: unknown[]) => Promise<{ node: WorkflowNodeHandlerContext['node']; result: WorkflowNodeHandlerResult }>) | undefined => {
    if (executeHelpers?.invokeConnectedNode) {
        return async (...workerArgs: unknown[]) =>
            executeHelpers.invokeConnectedNode!({
                context: buildWorkerContext(context),
                payload: (workerArgs[0] ?? undefined) as WorkflowInvokeConnectedNodeArgs | undefined,
                args: workerArgs
            });
    }
    if (!context.invokeConnectedNode) return undefined;
    return async (...workerArgs: unknown[]) =>
        context.invokeConnectedNode!((workerArgs[0] ?? undefined) as WorkflowInvokeConnectedNodeArgs | undefined);
};

export const createUpdateNodeHelper = (
    executeHelpers: WorkerExecuteHelpers | undefined,
    context: WorkflowNodeHandlerContext,
    toRecord: (value: unknown) => Record<string, unknown>
): ((workflow: unknown, nodeId: unknown, patch: unknown) => Promise<void> | void) | undefined => {
    if (!executeHelpers?.updateNode) return undefined;
    return async (workflow: unknown, nodeId: unknown, patch: unknown) =>
        executeHelpers.updateNode!({
            workflow: toRecord(workflow).nodes ? (workflow as WorkflowDefinition) : context.workflow,
            nodeId: typeof nodeId === 'string' ? nodeId : context.node.id,
            patch: toRecord(patch)
        });
};
