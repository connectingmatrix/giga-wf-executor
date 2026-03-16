import { buildNodeInputContext } from '../node-core/run-context';
import { createRunId, emitNodeFailed, emitNodeFinished, emitNodeStarted, WorkflowEventSink } from '../node-core/log';
import { buildCompletedNodeState, buildFailedNodeState, buildRunningNodeState, replaceNodeById } from '../node-core/state';
import { ExecuteNodeStepOptions, WorkflowDefinition, WorkflowExecutorAdapters, WorkflowExecutorMode, WorkflowNodeHandlerResult, WorkflowNodeModel, WorkflowNodeStatusEnum, WorkflowRunLogEvent, WorkflowStepExecutorResult } from '../types';

export interface WorkflowStepRunnerContext {
    mode: WorkflowExecutorMode;
    adapters: WorkflowExecutorAdapters;
}

const toPortsOut = (node: WorkflowNodeModel): Record<string, unknown> => (node.ports?.out && typeof node.ports.out === 'object' ? node.ports.out : {});
const toPortsIn = (node: WorkflowNodeModel): Record<string, Record<string, unknown>> => (node.ports?.in && typeof node.ports.in === 'object' ? node.ports.in : {});
const isNodeEnabled = (node: WorkflowNodeModel): boolean => (typeof node.runtime?.enabled === 'boolean' ? node.runtime.enabled : true);

const createEventCollector = (options: ExecuteNodeStepOptions): { events: WorkflowRunLogEvent[]; sink: WorkflowEventSink } => {
    const events: WorkflowRunLogEvent[] = [];
    const sink: WorkflowEventSink = (event) => {
        const withTimestamp: WorkflowRunLogEvent = { ...event, timestamp: new Date().toISOString() };
        events.push(withTimestamp);
        options.onEvent?.(withTimestamp);
    };
    return { events, sink };
};

/** Purpose: executes a single workflow node with upstream ports context and returns updated canonical workflow state. */
export const executeNodeStepWithContext = async (runtime: WorkflowStepRunnerContext, options: ExecuteNodeStepOptions): Promise<WorkflowStepExecutorResult> => {
    const runId = createRunId('step');
    let workingWorkflow: WorkflowDefinition = { ...options.workflow };
    const { events, sink } = createEventCollector(options);
    const outputsByNode = new Map<string, Record<string, unknown>>();
    workingWorkflow.nodes.forEach((item) => outputsByNode.set(item.id, toPortsOut(item)));
    const executionStack = new Set<string>();

    /** Purpose: recursively executes one node (and optionally connected nodes) while guarding against cycles in step mode. */
    const executeNodeById = async (targetNodeId: string, overrideInput?: Record<string, Record<string, unknown>>, nestedOverrides?: ExecuteNodeStepOptions['overrides']): Promise<{ node: WorkflowNodeModel; result: WorkflowNodeHandlerResult }> => {
        if (executionStack.has(targetNodeId)) throw new Error(`Circular node invocation detected for "${targetNodeId}".`);
        const node = workingWorkflow.nodes.find((item) => item.id === targetNodeId);
        if (!node) throw new Error(`Node "${targetNodeId}" not found for step execution.`);
        if (!isNodeEnabled(node)) {
            const disabledNode = { ...node, status: WorkflowNodeStatusEnum.Stopped, runtime: { ...(node.runtime ?? {}), status: WorkflowNodeStatusEnum.Stopped } };
            workingWorkflow = replaceNodeById(workingWorkflow, disabledNode);
            return { node: disabledNode, result: { output: toPortsOut(node).output ?? null, status: WorkflowNodeStatusEnum.Stopped, logs: ['Node is disabled.'] } };
        }

        executionStack.add(targetNodeId);
        const runtimeOverrides = targetNodeId === options.nodeId ? options.overrides : nestedOverrides;
        const runningNode = buildRunningNodeState(node, { runtime: { ...(node.runtime ?? {}), ...(runtimeOverrides?.runtime ?? {}), ...(runtimeOverrides?.properties ?? {}) } });
        workingWorkflow = replaceNodeById(workingWorkflow, runningNode);
        const input = overrideInput ?? buildNodeInputContext(workingWorkflow, targetNodeId, outputsByNode, toPortsIn(runningNode));
        emitNodeStarted(sink, options.workflow.metadata.id, runId, runningNode);
        const startedAtMs = performance.now();

        try {
            const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
            if (!canRunLocally && options.executeNodeRemotely) {
                const remoteExecution = await options.executeNodeRemotely({ workflow: workingWorkflow, nodeId: runningNode.id, settings: options.settings, overrides: runtimeOverrides, hostContext: options.hostContext });
                workingWorkflow = remoteExecution.workflow;
                outputsByNode.set(runningNode.id, toPortsOut(remoteExecution.node));
                (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => undefined));
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                emitNodeFinished(sink, options.workflow.metadata.id, runId, runningNode.id, remoteExecution.result.status ?? WorkflowNodeStatusEnum.Passed, durationMs, remoteExecution.result.logs);
                return { node: remoteExecution.node, result: remoteExecution.result };
            }
            if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);

            const handler = runtime.adapters.getNodeHandler(runningNode.modelId);
            const result = await handler({ node: { ...runningNode, ports: { ...runningNode.ports, in: input } }, workflow: workingWorkflow, settings: options.settings, input, signal: options.signal, hostContext: options.hostContext, invokeConnectedNode: async ({ nodeId, input: connectedInput, overrides }) => executeNodeById(nodeId, connectedInput, overrides) });
            const completedNode = buildCompletedNodeState(runningNode, input, result);
            workingWorkflow = replaceNodeById(workingWorkflow, completedNode);
            outputsByNode.set(runningNode.id, toPortsOut(completedNode));
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            emitNodeFinished(sink, options.workflow.metadata.id, runId, targetNodeId, completedNode.status, durationMs, result.logs);
            return { node: completedNode, result };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Step execution failed.';
            const failedNode = buildFailedNodeState(runningNode, message);
            workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
            outputsByNode.set(runningNode.id, toPortsOut(failedNode));
            emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
            return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [message] } };
        } finally {
            executionStack.delete(targetNodeId);
        }
    };

    const outcome = await executeNodeById(options.nodeId);
    return { workflow: workingWorkflow, node: outcome.node, result: outcome.result, events };
};
