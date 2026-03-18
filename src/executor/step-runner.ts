import { buildNodeInputContext } from '../node-core/run-context';
import { createRunId, emitNodeFailed, emitNodeFinished, emitNodeLogs, emitNodeStarted } from '../node-core/log';
import { buildCompletedNodeState, buildFailedNodeState, buildRunningNodeState, replaceNodeById } from '../node-core/state';
import { ExecuteNodeStepOptions, WorkflowDefinition, WorkflowExecutorAdapters, WorkflowExecutorMode, WorkflowNodeHandlerResult, WorkflowNodeStatusEnum, WorkflowStepExecutorResult } from '../types';
import { buildRetryAttemptLog, resolveFailureMessageFromResult, resolveFailureRetryLimit, resolveResultStatus } from './failure-mitigation';
import { createEventCollector, getBiPeerNodeIds, isNodeEnabled, normalizeNodeStatus, publishBiControlState, toPortsIn, toPortsOut, toRunnerRecord as toRecord, toRuntimeError } from './runner-helpers';
import { formatVariableFailureMessage, resolveNodeRuntimeVariables } from './variables';
import { validateWorkflowConnectionCompatibility } from './port-compatibility';

export interface WorkflowStepRunnerContext {
    mode: WorkflowExecutorMode;
    adapters: WorkflowExecutorAdapters;
}

/** Purpose: executes a single workflow node with upstream ports context and returns updated canonical workflow state. */
export const executeNodeStepWithContext = async (runtime: WorkflowStepRunnerContext, options: ExecuteNodeStepOptions): Promise<WorkflowStepExecutorResult> => {
    const runId = createRunId('step');
    let workingWorkflow: WorkflowDefinition = {
        ...options.workflow,
        metadata: {
            ...(options.workflow.metadata ?? {}),
            runtime: {
                ...toRecord(options.workflow.metadata?.runtime),
                settings: { ...options.settings }
            }
        }
    };

    const { events, sink } = createEventCollector(options);
    const outputsByNode = new Map<string, Record<string, unknown>>();
    workingWorkflow.nodes.forEach((item) => outputsByNode.set(item.id, toPortsOut(item)));
    const executionStack = new Set<string>();

    const compatibilityViolations = validateWorkflowConnectionCompatibility(workingWorkflow);
    if (compatibilityViolations.length > 0) {
        const details = compatibilityViolations.map((item) => item.message).join(' ');
        const message = `Workflow has incompatible connection(s): ${details}`;
        const targetNode = workingWorkflow.nodes.find((item) => item.id === options.nodeId);
        if (!targetNode) {
            throw new Error(`Node "${options.nodeId}" not found for step execution.`);
        }
        const failedNode = publishBiControlState(workingWorkflow, buildFailedNodeState(targetNode, message));
        workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
        emitNodeFailed(sink, options.workflow.metadata.id, runId, options.nodeId, message);
        emitNodeLogs(sink, options.workflow.metadata.id, runId, options.nodeId, [message]);
        return {
            workflow: workingWorkflow,
            node: failedNode,
            result: { output: { error: message, connectionViolations: compatibilityViolations }, status: WorkflowNodeStatusEnum.Failed, logs: [message] },
            events
        };
    }

    /** Purpose: recursively executes one node (and optionally connected nodes) while guarding against cycles in step mode. */
    const executeNodeById = async (targetNodeId: string, overrideInput?: Record<string, Record<string, unknown>>, nestedOverrides?: ExecuteNodeStepOptions['overrides']): Promise<{ node: WorkflowNodeModel; result: WorkflowNodeHandlerResult }> => {
        if (executionStack.has(targetNodeId)) throw new Error(`Circular node invocation detected for "${targetNodeId}".`);
        const node = workingWorkflow.nodes.find((item) => item.id === targetNodeId);
        if (!node) throw new Error(`Node "${targetNodeId}" not found for step execution.`);
        if (!isNodeEnabled(node)) {
            const disabledNode = publishBiControlState(workingWorkflow, { ...node, status: WorkflowNodeStatusEnum.Stopped, runtime: { ...(node.runtime ?? {}), status: WorkflowNodeStatusEnum.Stopped } });
            workingWorkflow = replaceNodeById(workingWorkflow, disabledNode);
            return { node: disabledNode, result: { output: toPortsOut(node).output ?? null, status: WorkflowNodeStatusEnum.Stopped, logs: ['Node is disabled.'] } };
        }

        executionStack.add(targetNodeId);
        const runtimeOverrides = targetNodeId === options.nodeId ? options.overrides : nestedOverrides;
        const runningNode = publishBiControlState(
            workingWorkflow,
            buildRunningNodeState(node, { runtime: { ...(node.runtime ?? {}), ...(runtimeOverrides?.runtime ?? {}), ...(runtimeOverrides?.properties ?? {}) } })
        );
        workingWorkflow = replaceNodeById(workingWorkflow, runningNode);
        const input = overrideInput ?? buildNodeInputContext(workingWorkflow, targetNodeId, outputsByNode, toPortsIn(runningNode));
        emitNodeStarted(sink, options.workflow.metadata.id, runId, runningNode);
        const startedAtMs = performance.now();
        const retryLimit = resolveFailureRetryLimit(runningNode);
        const retryAttemptLogs: string[] = [];
        const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
        const variableResolution = resolveNodeRuntimeVariables(workingWorkflow, runningNode, input, options.settings);
        if (!variableResolution.ok) {
            const message = formatVariableFailureMessage(variableResolution.failures, runningNode.name);
            const failedNode = publishBiControlState(workingWorkflow, buildFailedNodeState(runningNode, message));
            workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
            outputsByNode.set(runningNode.id, toPortsOut(failedNode));
            emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
            emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, [message]);
            return {
                node: failedNode,
                result: {
                    output: { error: message, variableFailures: variableResolution.failures },
                    status: WorkflowNodeStatusEnum.Failed,
                    logs: [message]
                }
            };
        }
        const executableNode: WorkflowNodeModel = {
            ...runningNode,
            runtime: { ...(runningNode.runtime ?? {}), ...variableResolution.runtime }
        };

        try {
            if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);

            for (let attemptNumber = 1; attemptNumber <= retryLimit + 1; attemptNumber += 1) {
                if (!canRunLocally && options.executeNodeRemotely) {
                    const remoteExecution = await options.executeNodeRemotely({ workflow: workingWorkflow, nodeId: runningNode.id, settings: options.settings, overrides: runtimeOverrides, hostContext: options.hostContext });
                    workingWorkflow = remoteExecution.workflow;
                    (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => undefined));
                    const status = resolveResultStatus(remoteExecution.result, remoteExecution.node.status as WorkflowNodeStatusEnum);
                    const remoteNode = publishBiControlState(workingWorkflow, normalizeNodeStatus(remoteExecution.node, status));
                    workingWorkflow = replaceNodeById(workingWorkflow, remoteNode);
                    outputsByNode.set(runningNode.id, toPortsOut(remoteNode));

                    if (status === WorkflowNodeStatusEnum.Failed) {
                        const message = resolveFailureMessageFromResult(remoteExecution.result, toRuntimeError(remoteNode) ?? 'Step execution failed.');
                        const terminalAttemptLogs = [...(remoteExecution.result.logs ?? [])];
                        if (attemptNumber <= retryLimit) {
                            const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
                            const iterationLogs = [...terminalAttemptLogs, retryLog];
                            retryAttemptLogs.push(...iterationLogs);
                            emitNodeLogs(sink, options.workflow.metadata.id, runId, runningNode.id, iterationLogs);
                            continue;
                        }

                        const failedNode = publishBiControlState(workingWorkflow, buildFailedNodeState(remoteNode, message));
                        workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
                        outputsByNode.set(runningNode.id, toPortsOut(failedNode));
                        emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
                        const terminalLogs = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
                        emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, terminalLogs);
                        return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [...retryAttemptLogs, ...terminalLogs] } };
                    }

                    const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                    const terminalLogs = remoteExecution.result.logs ?? [];
                    emitNodeFinished(sink, options.workflow.metadata.id, runId, runningNode.id, remoteNode.status, durationMs, terminalLogs);
                    return { node: remoteNode, result: { ...remoteExecution.result, status: remoteNode.status, logs: [...retryAttemptLogs, ...terminalLogs] } };
                }

                const handler = runtime.adapters.getNodeHandler(executableNode.modelId);
                const result = await handler({
                    node: { ...executableNode, ports: { ...executableNode.ports, in: input } },
                    workflow: workingWorkflow,
                    settings: options.settings,
                    input,
                    signal: options.signal,
                    hostContext: options.hostContext,
                    invokeConnectedNode: async ({ nodeId, input: connectedInput, overrides }) => executeNodeById(nodeId, connectedInput, overrides)
                });
                const status = resolveResultStatus(result);
                if (status === WorkflowNodeStatusEnum.Failed) {
                    const message = resolveFailureMessageFromResult(result, 'Step execution failed.');
                    const terminalAttemptLogs = [...(result.logs ?? [])];
                    if (attemptNumber <= retryLimit) {
                        const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
                        const iterationLogs = [...terminalAttemptLogs, retryLog];
                        retryAttemptLogs.push(...iterationLogs);
                        emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, iterationLogs);
                        continue;
                    }

                    const failedNode = publishBiControlState(workingWorkflow, buildFailedNodeState(runningNode, message));
                    workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
                    outputsByNode.set(runningNode.id, toPortsOut(failedNode));
                    emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
                    const terminalLogs = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
                    emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, terminalLogs);
                    return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [...retryAttemptLogs, ...terminalLogs] } };
                }

                const normalizedResult = { ...result, status: status as WorkflowNodeStatusEnum };
                const completedNode = publishBiControlState(workingWorkflow, buildCompletedNodeState(runningNode, input, normalizedResult));
                workingWorkflow = replaceNodeById(workingWorkflow, completedNode);
                outputsByNode.set(runningNode.id, toPortsOut(completedNode));
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                const terminalLogs = result.logs ?? [];
                emitNodeFinished(sink, options.workflow.metadata.id, runId, targetNodeId, completedNode.status, durationMs, terminalLogs);
                return { node: completedNode, result: { ...normalizedResult, logs: [...retryAttemptLogs, ...terminalLogs] } };
            }

            throw new Error('Failure mitigation loop exited unexpectedly.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Step execution failed.';
            const failedNode = publishBiControlState(workingWorkflow, buildFailedNodeState(runningNode, message));
            workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
            outputsByNode.set(runningNode.id, toPortsOut(failedNode));
            emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
            emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, [message]);
            return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [...retryAttemptLogs, message] } };
        } finally {
            executionStack.delete(targetNodeId);
        }
    };

    const outcome = await executeNodeById(options.nodeId);
    if (outcome.node.status !== WorkflowNodeStatusEnum.Failed) {
        const peerNodeIds = getBiPeerNodeIds(workingWorkflow, options.nodeId);
        for (const peerNodeId of peerNodeIds) {
            await executeNodeById(peerNodeId);
        }
    }
    return { workflow: workingWorkflow, node: outcome.node, result: outcome.result, events };
};
