import { ExecuteWorkflowOptions, WorkflowDefinition, WorkflowExecutorAdapters, WorkflowExecutorMode, WorkflowExecutorResult, WorkflowNodeModel, WorkflowNodeStatusEnum, WorkflowRunLogEvent, WorkflowStepOverrides } from '../types';
import { buildNodeInputContext, collectReachableNodeIdsFromStartNodes, shouldExecuteNodeInCurrentRun, sortWorkflowNodesTopologically } from '../node-core/run-context';
import { createRunId, emitNodeFailed, emitNodeFinished, emitNodeStarted, emitWorkflowCompleted, emitWorkflowStopped, emitWorkflowValidationFailed, WorkflowEventSink } from '../node-core/log';
import { buildCompletedNodeState, buildFailedNodeState, buildRunningNodeState, markRunningNodesAsStopped, replaceNodeById } from '../node-core/state';
import { buildWorkflowSummaryInput, createNodeExecutionTiming, WorkflowNodeExecutionTimingMap } from '../node-core/summary';

const START_MODEL_ID = 'start';
const END_MODEL_ID = 'respond-end';

export interface WorkflowRunnerContext {
    mode: WorkflowExecutorMode;
    adapters: WorkflowExecutorAdapters;
}

const isNodeEnabled = (node: WorkflowNodeModel): boolean => (typeof node.runtime?.enabled === 'boolean' ? node.runtime.enabled : true);
const shouldForwardLogs = (workflow: WorkflowDefinition): boolean => workflow.nodes.some((node) => node.modelId === START_MODEL_ID && node.runtime?.forwardSessionLogs === true);
const toPortsOut = (node: WorkflowNodeModel): Record<string, unknown> => (node.ports?.out && typeof node.ports.out === 'object' ? node.ports.out : {});
const toPortsIn = (node: WorkflowNodeModel): Record<string, Record<string, unknown>> => (node.ports?.in && typeof node.ports.in === 'object' ? node.ports.in : {});

const createEventCollector = (options: ExecuteWorkflowOptions): { events: WorkflowRunLogEvent[]; sink: WorkflowEventSink } => {
    const events: WorkflowRunLogEvent[] = [];
    const sink: WorkflowEventSink = (event) => {
        const withTimestamp: WorkflowRunLogEvent = { ...event, timestamp: new Date().toISOString() };
        events.push(withTimestamp);
        options.onEvent?.(withTimestamp);
    };
    return { events, sink };
};

/** Purpose: executes the whole DAG once using canonical runtime+ports state and emits lifecycle events via callback. */
export const executeWorkflowWithContext = async (runtime: WorkflowRunnerContext, workflow: WorkflowDefinition, options: ExecuteWorkflowOptions): Promise<WorkflowExecutorResult> => {
    const runId = createRunId('run');
    let currentWorkflow: WorkflowDefinition = { ...workflow };
    const { events, sink } = createEventCollector(options);
    const startNodeIds = currentWorkflow.nodes.filter((node) => node.modelId === START_MODEL_ID).map((node) => node.id);
    const hasEndNode = currentWorkflow.nodes.some((node) => node.modelId === END_MODEL_ID);
    if (startNodeIds.length === 0 || !hasEndNode) {
        const missing = [startNodeIds.length === 0 ? 'Start node' : null, !hasEndNode ? 'Respond/End node' : null].filter((item): item is string => Boolean(item));
        emitWorkflowValidationFailed(sink, workflow.metadata.id, runId, `Workflow execution requires ${missing.join(' and ')}.`);
        return { workflow: currentWorkflow, stopped: false, events };
    }

    const includeLogsInSummary = shouldForwardLogs(currentWorkflow);
    const reachableNodeIds = collectReachableNodeIdsFromStartNodes(currentWorkflow, startNodeIds);
    const orderedIds = sortWorkflowNodesTopologically(currentWorkflow).filter((nodeId) => reachableNodeIds.has(nodeId));
    const outputsByNode = new Map<string, Record<string, unknown>>();
    currentWorkflow.nodes.forEach((node) => outputsByNode.set(node.id, toPortsOut(node)));
    const nodeExecutionTimings: WorkflowNodeExecutionTimingMap = {};
    const invocationStack = new Set<string>();

    const executeConnectedNodeById = async (connectedNodeId: string, overrideInput?: Record<string, Record<string, unknown>>, overrides?: WorkflowStepOverrides) => {
        if (invocationStack.has(connectedNodeId)) throw new Error(`Circular invocation detected for node "${connectedNodeId}".`);
        const connectedNode = currentWorkflow.nodes.find((item) => item.id === connectedNodeId);
        if (!connectedNode) throw new Error(`Connected node "${connectedNodeId}" was not found.`);
        if (!isNodeEnabled(connectedNode)) {
            const disabledNode = { ...connectedNode, status: WorkflowNodeStatusEnum.Stopped, runtime: { ...(connectedNode.runtime ?? {}), status: WorkflowNodeStatusEnum.Stopped } };
            currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
            outputsByNode.set(disabledNode.id, toPortsOut(disabledNode));
            return { node: disabledNode, result: { output: toPortsOut(connectedNode).output ?? null, status: WorkflowNodeStatusEnum.Stopped, logs: ['Node is disabled.'] } };
        }

        invocationStack.add(connectedNodeId);
        const runningNode = buildRunningNodeState(connectedNode, { runtime: { ...(connectedNode.runtime ?? {}), ...(overrides?.runtime ?? {}), ...(overrides?.properties ?? {}) } });
        currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
        options.onNodeStart?.(runningNode.id);
        emitNodeStarted(sink, workflow.metadata.id, runId, runningNode);
        const handler = runtime.adapters.getNodeHandler(runningNode.modelId);
        const input = overrideInput ?? buildNodeInputContext(currentWorkflow, runningNode.id, outputsByNode, toPortsIn(runningNode));
        const startedAt = new Date().toISOString();
        const startedAtMs = performance.now();

        try {
            const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
            if (!canRunLocally && options.executeNodeRemotely) {
                const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, overrides, hostContext: options.hostContext });
                currentWorkflow = remoteExecution.workflow;
                outputsByNode.set(remoteExecution.node.id, toPortsOut(remoteExecution.node));
                (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => undefined));
                const finishedAt = new Date().toISOString();
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(remoteExecution.node, remoteExecution.node.status, startedAt, finishedAt, durationMs);
                emitNodeFinished(sink, workflow.metadata.id, runId, runningNode.id, remoteExecution.result.status ?? WorkflowNodeStatusEnum.Passed, durationMs, remoteExecution.result.logs);
                options.onNodeFinish?.(remoteExecution.node);
                return { node: remoteExecution.node, result: remoteExecution.result };
            }
            if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);

            const result = await handler({ node: { ...runningNode, ports: { ...runningNode.ports, in: input } }, workflow: currentWorkflow, settings: options.settings, input, signal: options.signal, hostContext: options.hostContext, invokeConnectedNode: async ({ nodeId, input: nextInput, overrides: nextOverrides }) => executeConnectedNodeById(nodeId, nextInput, nextOverrides) });
            const completedNode = buildCompletedNodeState(runningNode, input, result);
            currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
            outputsByNode.set(completedNode.id, toPortsOut(completedNode));
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, finishedAt, durationMs);
            emitNodeFinished(sink, workflow.metadata.id, runId, runningNode.id, completedNode.status, durationMs, result.logs);
            options.onNodeFinish?.(completedNode);
            return { node: completedNode, result };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Node execution failed.';
            const failedNode = buildFailedNodeState(runningNode, message);
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            outputsByNode.set(failedNode.id, toPortsOut(failedNode));
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, finishedAt, durationMs);
            emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
            options.onNodeFinish?.(failedNode);
            return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [message] } };
        } finally {
            invocationStack.delete(connectedNodeId);
        }
    };

    for (const nodeId of orderedIds) {
        if (options.signal?.aborted) {
            currentWorkflow = markRunningNodesAsStopped(currentWorkflow);
            emitWorkflowStopped(sink, workflow.metadata.id, runId);
            return { workflow: currentWorkflow, stopped: true, events };
        }
        const node = currentWorkflow.nodes.find((item) => item.id === nodeId);
        if (!node || !shouldExecuteNodeInCurrentRun(currentWorkflow, node.id, outputsByNode)) continue;
        if (!isNodeEnabled(node)) {
            const disabledNode = { ...node, status: WorkflowNodeStatusEnum.Stopped, runtime: { ...(node.runtime ?? {}), status: WorkflowNodeStatusEnum.Stopped } };
            currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
            outputsByNode.set(node.id, toPortsOut(disabledNode));
            options.onNodeFinish?.(disabledNode);
            continue;
        }
        if (node.status === WorkflowNodeStatusEnum.Passed && Object.keys(toPortsOut(node)).length > 0) continue;

        const runningNode = buildRunningNodeState(node);
        currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
        options.onNodeStart?.(node.id);
        emitNodeStarted(sink, workflow.metadata.id, runId, runningNode);
        const handler = runtime.adapters.getNodeHandler(node.modelId);
        let input = buildNodeInputContext(currentWorkflow, node.id, outputsByNode, toPortsIn(runningNode));
        if (runningNode.modelId === END_MODEL_ID) input = { ...input, __workflow: buildWorkflowSummaryInput(runId, new Map(outputsByNode.entries()), nodeExecutionTimings, includeLogsInSummary ? events : []) };
        const startedAt = new Date().toISOString();
        const startedAtMs = performance.now();

        try {
            const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
            if (!canRunLocally && options.executeNodeRemotely) {
                const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, hostContext: options.hostContext });
                currentWorkflow = remoteExecution.workflow;
                outputsByNode.set(node.id, toPortsOut(remoteExecution.node));
                (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => undefined));
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                nodeExecutionTimings[node.id] = createNodeExecutionTiming(remoteExecution.node, remoteExecution.node.status, startedAt, new Date().toISOString(), durationMs);
                emitNodeFinished(sink, workflow.metadata.id, runId, node.id, remoteExecution.result.status ?? WorkflowNodeStatusEnum.Passed, durationMs, remoteExecution.result.logs);
                options.onNodeFinish?.(remoteExecution.node);
                continue;
            }
            if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);

            const result = await handler({ node: { ...runningNode, ports: { ...runningNode.ports, in: input } }, workflow: currentWorkflow, settings: options.settings, input, signal: options.signal, hostContext: options.hostContext, invokeConnectedNode: async ({ nodeId, input: nextInput, overrides }) => executeConnectedNodeById(nodeId, nextInput, overrides) });
            const completedNode = buildCompletedNodeState(runningNode, input, result);
            currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
            outputsByNode.set(node.id, toPortsOut(completedNode));
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[node.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, new Date().toISOString(), durationMs);
            emitNodeFinished(sink, workflow.metadata.id, runId, node.id, completedNode.status, durationMs, result.logs);
            options.onNodeFinish?.(completedNode);
            if (completedNode.status === WorkflowNodeStatusEnum.Stopped) {
                emitWorkflowStopped(sink, workflow.metadata.id, runId);
                return { workflow: currentWorkflow, stopped: true, events };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Node execution failed.';
            const failedNode = buildFailedNodeState(runningNode, message);
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, new Date().toISOString(), Number((performance.now() - startedAtMs).toFixed(2)));
            emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
            options.onNodeFinish?.(failedNode);
        }
    }

    emitWorkflowCompleted(sink, workflow.metadata.id, runId);
    return { workflow: currentWorkflow, stopped: false, events };
};
