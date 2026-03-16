import { buildNodeInputContext } from '../node-core/run-context';
import { createRunId, logNodeFailed, logNodeFinished, logNodeStarted } from '../node-core/log';
import { buildCompletedNodeState, buildFailedNodeState, buildRunningNodeState, replaceNodeById } from '../node-core/state';
import { ExecuteNodeStepOptions, WorkflowDefinition, WorkflowExecutorAdapters, WorkflowExecutorMode, WorkflowNodeHandlerResult, WorkflowNodeModel, WorkflowNodeStatusEnum, WorkflowStepExecutorResult } from '../types';

export interface WorkflowStepRunnerContext {
    mode: WorkflowExecutorMode;
    adapters: WorkflowExecutorAdapters;
}

export const executeNodeStepWithContext = async (
    runtime: WorkflowStepRunnerContext,
    options: ExecuteNodeStepOptions
): Promise<WorkflowStepExecutorResult> => {
    // Build single-step run context.
    const runId = createRunId('step');
    let workingWorkflow: WorkflowDefinition = { ...options.workflow };
    const outputsByNode = new Map(workingWorkflow.nodes.map((item) => [item.id, item.output]));
    const executionStack = new Set<string>();

    const executeNodeById = async (
        targetNodeId: string,
        overrideInput?: Record<string, unknown>,
        nestedOverrides?: ExecuteNodeStepOptions['overrides']
    ): Promise<{ node: WorkflowNodeModel; result: WorkflowNodeHandlerResult }> => {
        if (executionStack.has(targetNodeId)) throw new Error(`Circular node invocation detected for "${targetNodeId}".`);
        const node = workingWorkflow.nodes.find((item) => item.id === targetNodeId);
        if (!node) throw new Error(`Node "${targetNodeId}" not found for step execution.`);
        if (node.properties?.enabled === false) {
            const disabledNode = { ...node, status: WorkflowNodeStatusEnum.Stopped, properties: { ...(node.properties ?? {}), status: WorkflowNodeStatusEnum.Stopped } };
            workingWorkflow = replaceNodeById(workingWorkflow, disabledNode);
            return { node: disabledNode, result: { output: node.output ?? null, status: WorkflowNodeStatusEnum.Stopped, logs: ['Node is disabled.'] } };
        }

        executionStack.add(targetNodeId);
        const schema = runtime.adapters.resolveNodeSchema(node.modelId, workingWorkflow.nodeModels);
        const handler = runtime.adapters.getNodeHandler(node.modelId);
        const runtimeOverrides = targetNodeId === options.nodeId ? options.overrides : nestedOverrides;
        const runningNode = buildRunningNodeState(node, {
            properties: { ...(node.properties ?? {}), ...(runtimeOverrides?.properties ?? {}) },
            inspector: node.inspector
                ? { ...node.inspector, code: runtimeOverrides?.code ?? node.inspector.code, markdown: runtimeOverrides?.markdown ?? node.inspector.markdown }
                : node.inspector
        });
        workingWorkflow = replaceNodeById(workingWorkflow, runningNode);
        const input = overrideInput ?? buildNodeInputContext(workingWorkflow, targetNodeId, outputsByNode, runningNode.input ?? {});
        logNodeStarted(options.logger, options.workflow.metadata.id, runId, runningNode);
        const startedAtMs = performance.now();

        try {
            const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
            if (!canRunLocally && options.executeNodeRemotely) {
                const remoteExecution = await options.executeNodeRemotely({
                    workflow: workingWorkflow,
                    nodeId: runningNode.id,
                    settings: options.settings,
                    overrides: runtimeOverrides,
                    hostContext: options.hostContext
                });
                workingWorkflow = remoteExecution.workflow;
                outputsByNode.set(runningNode.id, remoteExecution.result.output ?? null);
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                logNodeFinished(options.logger, options.workflow.metadata.id, runId, runningNode.id, remoteExecution.result, durationMs);
                return { node: remoteExecution.node, result: remoteExecution.result };
            }
            if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);

            // Execute host node handler for single-step run.
            const result = await handler({
                node: { ...runningNode, input },
                workflow: workingWorkflow,
                settings: options.settings,
                input,
                signal: options.signal,
                hostContext: options.hostContext,
                invokeConnectedNode: async ({ nodeId, input: connectedInput, overrides }) => executeNodeById(nodeId, connectedInput, overrides)
            });
            // Persist completed node runtime state.
            const completedNode = buildCompletedNodeState(runningNode, schema, input, result);
            workingWorkflow = replaceNodeById(workingWorkflow, completedNode);
            outputsByNode.set(runningNode.id, result.output ?? null);
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            logNodeFinished(options.logger, options.workflow.metadata.id, runId, targetNodeId, result, durationMs);
            return { node: completedNode, result };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Step execution failed.';
            const failedNode = buildFailedNodeState(runningNode, message);
            workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
            outputsByNode.set(runningNode.id, failedNode.output);
            logNodeFailed(options.logger, options.workflow.metadata.id, runId, targetNodeId, message);
            return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [message] } };
        } finally {
            executionStack.delete(targetNodeId);
        }
    };

    // Execute requested node and return updated workflow snapshot.
    const outcome = await executeNodeById(options.nodeId);
    return { workflow: workingWorkflow, node: outcome.node, result: outcome.result };
};
