import {
    ExecuteWorkflowOptions,
    WorkflowDefinition,
    WorkflowExecutorAdapters,
    WorkflowExecutorMode,
    WorkflowExecutorResult,
    WorkflowNodeModel,
    WorkflowNodeStatusEnum
} from '../types';
import { buildNodeInputContext, collectReachableNodeIdsFromStartNodes, shouldExecuteNodeInCurrentRun, sortWorkflowNodesTopologically } from '../node-core/run-context';
import { createRunId, logNodeFailed, logNodeFinished, logNodeStarted, logWorkflowCompleted, logWorkflowStopped, logWorkflowValidationFailed } from '../node-core/log';
import { buildCompletedNodeState, buildFailedNodeState, buildRunningNodeState, markRunningNodesAsStopped, replaceNodeById } from '../node-core/state';
import { buildWorkflowSummaryInput, createNodeExecutionTiming, WorkflowNodeExecutionTimingMap } from '../node-core/summary';

const START_MODEL_ID = 'start';
const END_MODEL_ID = 'respond-end';

export interface WorkflowRunnerContext {
    mode: WorkflowExecutorMode;
    adapters: WorkflowExecutorAdapters;
}

export const executeWorkflowWithContext = async (
    runtime: WorkflowRunnerContext,
    workflow: WorkflowDefinition,
    options: ExecuteWorkflowOptions
): Promise<WorkflowExecutorResult> => {
    // Start a deterministic run id and keep mutable workflow state per node.
    const runId = createRunId('run');
    let currentWorkflow: WorkflowDefinition = { ...workflow };
    // Validate required start/end topology before entering the DAG loop.
    const startNodeIds = currentWorkflow.nodes.filter((node) => node.modelId === START_MODEL_ID).map((node) => node.id);
    const hasEndNode = currentWorkflow.nodes.some((node) => node.modelId === END_MODEL_ID);
    if (startNodeIds.length === 0 || !hasEndNode) {
        const missing = [startNodeIds.length === 0 ? 'Start node' : null, !hasEndNode ? 'Respond/End node' : null].filter((item): item is string => Boolean(item));
        logWorkflowValidationFailed(options.logger, workflow.metadata.id, runId, `Workflow execution requires ${missing.join(' and ')}.`);
        return { workflow: currentWorkflow, logs: [...(workflow.metadata.runtime?.sessionLogs ?? []), ...options.logger.entries], stopped: false };
    }

    // Build dependency-safe traversal order constrained to reachable nodes.
    const reachableNodeIds = collectReachableNodeIdsFromStartNodes(currentWorkflow, startNodeIds);
    const orderedIds = sortWorkflowNodesTopologically(currentWorkflow).filter((nodeId) => reachableNodeIds.has(nodeId));
    // Cache outputs and timings for branch gating and end-node summary.
    const outputsByNode = new Map<string, unknown>();
    const nodeExecutionTimings: WorkflowNodeExecutionTimingMap = {};
    const invocationStack = new Set<string>();

    const executeConnectedNodeById = async (
        connectedNodeId: string,
        overrideInput?: Record<string, unknown>,
        overrides?: ExecuteWorkflowOptions['executeNodeRemotely'] extends (...args: any[]) => any ? Parameters<NonNullable<ExecuteWorkflowOptions['executeNodeRemotely']>>[0]['overrides'] : never
    ) => {
        if (invocationStack.has(connectedNodeId)) throw new Error(`Circular invocation detected for node "${connectedNodeId}".`);
        const connectedNode = currentWorkflow.nodes.find((item) => item.id === connectedNodeId);
        if (!connectedNode) throw new Error(`Connected node "${connectedNodeId}" was not found.`);
        if (connectedNode.properties?.enabled === false) {
            const disabledNode = { ...connectedNode, status: WorkflowNodeStatusEnum.Stopped, properties: { ...(connectedNode.properties ?? {}), status: WorkflowNodeStatusEnum.Stopped } };
            currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
            return { node: disabledNode, result: { output: connectedNode.output ?? null, status: WorkflowNodeStatusEnum.Stopped, logs: ['Node is disabled.'] } };
        }

        invocationStack.add(connectedNodeId);
        const runningNode = buildRunningNodeState(connectedNode, {
            properties: { ...(connectedNode.properties ?? {}), ...(overrides?.properties ?? {}) },
            inspector: connectedNode.inspector
                ? { ...connectedNode.inspector, code: overrides?.code ?? connectedNode.inspector.code, markdown: overrides?.markdown ?? connectedNode.inspector.markdown }
                : connectedNode.inspector
        });
        currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
        options.onNodeStart?.(runningNode.id);
        logNodeStarted(options.logger, workflow.metadata.id, runId, runningNode);
        const schema = runtime.adapters.resolveNodeSchema(runningNode.modelId, currentWorkflow.nodeModels);
        const handler = runtime.adapters.getNodeHandler(runningNode.modelId);
        const input = overrideInput ?? buildNodeInputContext(currentWorkflow, runningNode.id, outputsByNode, runningNode.input ?? {});
        const startedAt = new Date().toISOString();
        const startedAtMs = performance.now();

        try {
            const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
            if (!canRunLocally && options.executeNodeRemotely) {
                const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, overrides, hostContext: options.hostContext });
                currentWorkflow = remoteExecution.workflow;
                outputsByNode.set(remoteExecution.node.id, remoteExecution.result.output ?? null);
                const finishedAt = new Date().toISOString();
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(remoteExecution.node, remoteExecution.node.status, startedAt, finishedAt, durationMs);
                logNodeFinished(options.logger, workflow.metadata.id, runId, runningNode.id, remoteExecution.result, durationMs);
                options.onNodeFinish?.(remoteExecution.node);
                return { node: remoteExecution.node, result: remoteExecution.result };
            }
            if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);

            const result = await handler({
                node: { ...runningNode, input },
                workflow: currentWorkflow,
                settings: options.settings,
                input,
                signal: options.signal,
                hostContext: options.hostContext,
                invokeConnectedNode: async ({ nodeId, input: nextInput, overrides: nextOverrides }) => executeConnectedNodeById(nodeId, nextInput, nextOverrides)
            });
            const completedNode = buildCompletedNodeState(runningNode, schema, input, result);
            currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
            outputsByNode.set(completedNode.id, result.output ?? null);
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, finishedAt, durationMs);
            logNodeFinished(options.logger, workflow.metadata.id, runId, runningNode.id, result, durationMs);
            options.onNodeFinish?.(completedNode);
            return { node: completedNode, result };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Node execution failed.';
            const failedNode = buildFailedNodeState(runningNode, message);
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            outputsByNode.set(failedNode.id, failedNode.output);
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, finishedAt, durationMs);
            logNodeFailed(options.logger, workflow.metadata.id, runId, runningNode.id, message);
            options.onNodeFinish?.(failedNode);
            return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [message] } };
        } finally {
            invocationStack.delete(connectedNodeId);
        }
    };

    // Iterate over DAG order and execute each eligible node exactly once.
    for (const nodeId of orderedIds) {
        // Exit early when caller aborts run execution.
        if (options.signal?.aborted) {
            currentWorkflow = markRunningNodesAsStopped(currentWorkflow);
            logWorkflowStopped(options.logger, workflow.metadata.id, runId);
            return { workflow: currentWorkflow, logs: [...(workflow.metadata.runtime?.sessionLogs ?? []), ...options.logger.entries], stopped: true };
        }

        const node = currentWorkflow.nodes.find((item) => item.id === nodeId);
        if (!node) continue;
        if (!shouldExecuteNodeInCurrentRun(currentWorkflow, node.id, outputsByNode)) continue;
        if (node.properties?.enabled === false) {
            const disabledNode = { ...node, status: WorkflowNodeStatusEnum.Stopped, properties: { ...(node.properties ?? {}), status: WorkflowNodeStatusEnum.Stopped } };
            currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
            outputsByNode.set(node.id, node.output ?? null);
            options.onNodeFinish?.(disabledNode);
            continue;
        }
        if (outputsByNode.has(node.id)) continue;

        // Transition node into running state and log start lifecycle event.
        const runningNode = buildRunningNodeState(node);
        currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
        options.onNodeStart?.(node.id);
        logNodeStarted(options.logger, workflow.metadata.id, runId, runningNode);
        const schema = runtime.adapters.resolveNodeSchema(node.modelId, currentWorkflow.nodeModels);
        const handler = runtime.adapters.getNodeHandler(node.modelId);
        let input = buildNodeInputContext(currentWorkflow, node.id, outputsByNode, runningNode.input ?? {});
        if (runningNode.modelId === END_MODEL_ID) {
            input = { ...input, __workflow: buildWorkflowSummaryInput(runId, outputsByNode, nodeExecutionTimings, options.logger.entries) };
        }
        const startedAt = new Date().toISOString();
        const startedAtMs = performance.now();

        try {
            const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
            if (!canRunLocally && options.executeNodeRemotely) {
                const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, hostContext: options.hostContext });
                const finishedAt = new Date().toISOString();
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                currentWorkflow = remoteExecution.workflow;
                outputsByNode.set(node.id, remoteExecution.result.output ?? null);
                nodeExecutionTimings[node.id] = createNodeExecutionTiming(remoteExecution.node, remoteExecution.node.status, startedAt, finishedAt, durationMs);
                logNodeFinished(options.logger, workflow.metadata.id, runId, node.id, remoteExecution.result, durationMs);
                options.onNodeFinish?.(remoteExecution.node);
                continue;
            }
            if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);

            // Execute host-provided handler with resolved workflow context.
            const result = await handler({
                node: { ...runningNode, input },
                workflow: currentWorkflow,
                settings: options.settings,
                input,
                signal: options.signal,
                hostContext: options.hostContext,
                invokeConnectedNode: async ({ nodeId, input: nextInput, overrides }) => executeConnectedNodeById(nodeId, nextInput, overrides)
            });
            // Persist completed state, outputs, timings and node logs.
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            const completedNode = buildCompletedNodeState(runningNode, schema, input, result);
            currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
            outputsByNode.set(node.id, result.output ?? null);
            nodeExecutionTimings[node.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, finishedAt, durationMs);
            logNodeFinished(options.logger, workflow.metadata.id, runId, node.id, result, durationMs);
            options.onNodeFinish?.(completedNode);
            if (completedNode.status === WorkflowNodeStatusEnum.Stopped) {
                logWorkflowStopped(options.logger, workflow.metadata.id, runId);
                return { workflow: currentWorkflow, logs: [...(workflow.metadata.runtime?.sessionLogs ?? []), ...options.logger.entries], stopped: true };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Node execution failed.';
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            const failedNode = buildFailedNodeState(runningNode, message);
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, finishedAt, durationMs);
            logNodeFailed(options.logger, workflow.metadata.id, runId, node.id, message);
            options.onNodeFinish?.(failedNode);
        }
    }

    // Complete workflow run and append final completion event.
    logWorkflowCompleted(options.logger, workflow.metadata.id, runId);
    return { workflow: currentWorkflow, logs: [...(workflow.metadata.runtime?.sessionLogs ?? []), ...options.logger.entries], stopped: false };
};
