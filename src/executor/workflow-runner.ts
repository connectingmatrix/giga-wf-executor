import { ExecuteWorkflowOptions, WorkflowDefinition, WorkflowExecutorAdapters, WorkflowExecutorMode, WorkflowExecutorResult, WorkflowNodeModel, WorkflowNodeStatusEnum, WorkflowRunLogEvent, WorkflowStepOverrides } from '../types';
import { buildNodeInputContext, collectReachableNodeIdsFromStartNodes, shouldExecuteNodeInCurrentRun, sortWorkflowNodesTopologically } from '../node-core/run-context';
import { createRunId, emitNodeFailed, emitNodeFinished, emitNodeLogs, emitNodeStarted, emitWorkflowCompleted, emitWorkflowStopped, emitWorkflowValidationFailed, WorkflowEventSink } from '../node-core/log';
import { buildCompletedNodeState, buildFailedNodeState, buildRunningNodeState, markRunningNodesAsStopped, replaceNodeById } from '../node-core/state';
import { buildWorkflowSummaryInput, createNodeExecutionTiming, WorkflowNodeExecutionTimingMap } from '../node-core/summary';
import { buildRetryAttemptLog, resolveFailureMessageFromResult, resolveFailureRetryLimit, resolveResultStatus } from './failure-mitigation';
import { formatVariableFailureMessage, resolveNodeRuntimeVariables } from './variables';
import { validateWorkflowConnectionCompatibility } from './port-compatibility';

const START_MODEL_ID = 'start';
const END_MODEL_ID = 'respond-end';
const BI_DIRECTIONAL_PORT_TYPE = 'bi-directional';

export interface WorkflowRunnerContext {
    mode: WorkflowExecutorMode;
    adapters: WorkflowExecutorAdapters;
}

const isNodeEnabled = (node: WorkflowNodeModel): boolean => (typeof node.runtime?.enabled === 'boolean' ? node.runtime.enabled : true);
const shouldForwardLogs = (workflow: WorkflowDefinition): boolean => workflow.nodes.some((node) => node.modelId === START_MODEL_ID && node.runtime?.forwardSessionLogs === true);
const toPortsOut = (node: WorkflowNodeModel): Record<string, unknown> => (node.ports?.out && typeof node.ports.out === 'object' ? node.ports.out : {});
const toPortsIn = (node: WorkflowNodeModel): Record<string, Record<string, unknown>> => (node.ports?.in && typeof node.ports.in === 'object' ? node.ports.in : {});
const toRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const toRuntimeError = (node: WorkflowNodeModel): string | null => {
    const runtime = node.runtime;
    if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return null;
    const candidate = (runtime as Record<string, unknown>).error;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
};
const normalizeNodeStatus = (node: WorkflowNodeModel, status: string): WorkflowNodeModel => {
    if (node.status === status && node.runtime?.status === status) return node;
    return { ...node, status: status as WorkflowNodeStatusEnum, runtime: { ...(node.runtime ?? {}), status } };
};

const getBiOutputPortIds = (workflow: WorkflowDefinition, node: WorkflowNodeModel): string[] => {
    const schema = workflow.nodeModels?.[node.modelId];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
    const outputs = (schema.outputs && typeof schema.outputs === 'object' && !Array.isArray(schema.outputs) ? schema.outputs : {}) as Record<string, { portType?: unknown }>;
    return Object.entries(outputs)
        .filter(([, rules]) => rules?.portType === BI_DIRECTIONAL_PORT_TYPE)
        .map(([portId]) => portId);
};

const publishBiControlState = (workflow: WorkflowDefinition, node: WorkflowNodeModel): WorkflowNodeModel => {
    const biOutputPortIds = getBiOutputPortIds(workflow, node);
    if (biOutputPortIds.length === 0) return node;
    const nextPortsOut = toRecord(node.ports?.out);
    const controlState = {
        nodeId: node.id,
        nodeName: node.name,
        modelId: node.modelId,
        status: node.status,
        runtime: toRecord(node.runtime),
        output: nextPortsOut.output ?? null
    };
    biOutputPortIds.forEach((portId) => {
        const existingPortValue = toRecord(nextPortsOut[portId]);
        nextPortsOut[portId] = {
            ...existingPortValue,
            STATE: controlState
        };
    });
    return {
        ...node,
        ports: {
            in: toPortsIn(node),
            out: nextPortsOut
        }
    };
};

const parsePortName = (handle: string | undefined, fallbackPort: string): string => {
    if (!handle) return fallbackPort;
    const [, parsedPort] = handle.split(':');
    return parsedPort?.trim() ? parsedPort : fallbackPort;
};

const getOutputPortType = (workflow: WorkflowDefinition, nodeId: string, handle: string | undefined): string | undefined => {
    const node = workflow.nodes.find((item) => item.id === nodeId);
    if (!node) return undefined;
    const schema = workflow.nodeModels?.[node.modelId];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
    const outputs = (schema.outputs && typeof schema.outputs === 'object' && !Array.isArray(schema.outputs) ? schema.outputs : {}) as Record<string, { portType?: unknown }>;
    const fallbackPort = Object.keys(outputs)[0] ?? 'output';
    const portName = parsePortName(handle, fallbackPort);
    return outputs[portName]?.portType as string | undefined;
};

const getInputPortType = (workflow: WorkflowDefinition, nodeId: string, handle: string | undefined): string | undefined => {
    const node = workflow.nodes.find((item) => item.id === nodeId);
    if (!node) return undefined;
    const schema = workflow.nodeModels?.[node.modelId];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
    const inputs = (schema.inputs && typeof schema.inputs === 'object' && !Array.isArray(schema.inputs) ? schema.inputs : {}) as Record<string, { portType?: unknown }>;
    const fallbackPort = Object.keys(inputs)[0] ?? 'input';
    const portName = parsePortName(handle, fallbackPort);
    return inputs[portName]?.portType as string | undefined;
};

const isBiConnection = (workflow: WorkflowDefinition, connection: WorkflowDefinition['connections'][number]): boolean => {
    const sourcePortType = getOutputPortType(workflow, connection.from, connection.sourceHandle);
    const targetPortType = getInputPortType(workflow, connection.to, connection.targetHandle);
    return sourcePortType === BI_DIRECTIONAL_PORT_TYPE && targetPortType === BI_DIRECTIONAL_PORT_TYPE;
};

const getBiPeerNodeIds = (workflow: WorkflowDefinition, nodeId: string): string[] => {
    const peers = new Set<string>();
    workflow.connections.forEach((connection) => {
        if (!isBiConnection(workflow, connection)) return;
        if (connection.from === nodeId) peers.add(connection.to);
        if (connection.to === nodeId) peers.add(connection.from);
    });
    peers.delete(nodeId);
    return [...peers];
};

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
    let currentWorkflow: WorkflowDefinition = {
        ...workflow,
        metadata: {
            ...(workflow.metadata ?? {}),
            runtime: {
                ...toRecord(workflow.metadata?.runtime),
                settings: { ...options.settings }
            }
        }
    };

    const { events, sink } = createEventCollector(options);
    const startNodeIds = currentWorkflow.nodes.filter((node) => node.modelId === START_MODEL_ID).map((node) => node.id);
    const hasEndNode = currentWorkflow.nodes.some((node) => node.modelId === END_MODEL_ID);
    if (startNodeIds.length === 0 || !hasEndNode) {
        const missing = [startNodeIds.length === 0 ? 'Start node' : null, !hasEndNode ? 'Respond/End node' : null].filter((item): item is string => Boolean(item));
        emitWorkflowValidationFailed(sink, workflow.metadata.id, runId, `Workflow execution requires ${missing.join(' and ')}.`);
        return { workflow: currentWorkflow, stopped: false, events };
    }

    const compatibilityViolations = validateWorkflowConnectionCompatibility(currentWorkflow);
    if (compatibilityViolations.length > 0) {
        const details = compatibilityViolations.map((item) => item.message).join(' ');
        const message = `Workflow has incompatible connection(s): ${details}`;
        emitWorkflowValidationFailed(sink, workflow.metadata.id, runId, message);
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
            const disabledNode = publishBiControlState(currentWorkflow, { ...connectedNode, status: WorkflowNodeStatusEnum.Stopped, runtime: { ...(connectedNode.runtime ?? {}), status: WorkflowNodeStatusEnum.Stopped } });
            currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
            outputsByNode.set(disabledNode.id, toPortsOut(disabledNode));
            return { node: disabledNode, result: { output: toPortsOut(connectedNode).output ?? null, status: WorkflowNodeStatusEnum.Stopped, logs: ['Node is disabled.'] } };
        }

        invocationStack.add(connectedNodeId);
        const runningNode = publishBiControlState(
            currentWorkflow,
            buildRunningNodeState(connectedNode, { runtime: { ...(connectedNode.runtime ?? {}), ...(overrides?.runtime ?? {}), ...(overrides?.properties ?? {}) } })
        );
        currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
        options.onNodeStart?.(runningNode.id);
        emitNodeStarted(sink, workflow.metadata.id, runId, runningNode);
        const input = overrideInput ?? buildNodeInputContext(currentWorkflow, runningNode.id, outputsByNode, toPortsIn(runningNode));
        const startedAt = new Date().toISOString();
        const startedAtMs = performance.now();
        const retryLimit = resolveFailureRetryLimit(runningNode);
        const retryAttemptLogs: string[] = [];
        const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
        const variableResolution = resolveNodeRuntimeVariables(currentWorkflow, runningNode, input, options.settings);
        if (!variableResolution.ok) {
            const message = formatVariableFailureMessage(variableResolution.failures, runningNode.name);
            const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(runningNode, message));
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            outputsByNode.set(failedNode.id, toPortsOut(failedNode));
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, finishedAt, durationMs);
            emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
            emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, [message]);
            options.onNodeFinish?.(failedNode);
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
        const handler = runtime.adapters.getNodeHandler(executableNode.modelId);
        if (!canRunLocally && !options.executeNodeRemotely) {
            const message = `Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`;
            const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(runningNode, message));
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            outputsByNode.set(failedNode.id, toPortsOut(failedNode));
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, finishedAt, durationMs);
            emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
            options.onNodeFinish?.(failedNode);
            return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [message] } };
        }

        try {
            for (let attemptNumber = 1; attemptNumber <= retryLimit + 1; attemptNumber += 1) {
                if (!canRunLocally && options.executeNodeRemotely) {
                    const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, overrides, hostContext: options.hostContext });
                    currentWorkflow = remoteExecution.workflow;
                    (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => undefined));
                    const status = resolveResultStatus(remoteExecution.result, remoteExecution.node.status as WorkflowNodeStatusEnum);
                    const remoteNode = publishBiControlState(currentWorkflow, normalizeNodeStatus(remoteExecution.node, status));
                    currentWorkflow = replaceNodeById(currentWorkflow, remoteNode);
                    outputsByNode.set(remoteNode.id, toPortsOut(remoteNode));

                    if (status === WorkflowNodeStatusEnum.Failed) {
                        const message = resolveFailureMessageFromResult(remoteExecution.result, toRuntimeError(remoteNode) ?? 'Node execution failed.');
                        const terminalAttemptLogs = [...(remoteExecution.result.logs ?? [])];
                        if (attemptNumber <= retryLimit) {
                            const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
                            const iterationLogs = [...terminalAttemptLogs, retryLog];
                            retryAttemptLogs.push(...iterationLogs);
                            emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, iterationLogs);
                            continue;
                        }

                        const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(remoteNode, message));
                        currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
                        outputsByNode.set(failedNode.id, toPortsOut(failedNode));
                        const finishedAt = new Date().toISOString();
                        const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                        nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, finishedAt, durationMs);
                        emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
                        const terminalLogs = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
                        emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, terminalLogs);
                        const logs = [...retryAttemptLogs, ...terminalLogs];
                        options.onNodeFinish?.(failedNode);
                        return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs } };
                    }

                    const finishedAt = new Date().toISOString();
                    const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                    nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(remoteNode, remoteNode.status, startedAt, finishedAt, durationMs);
                    const terminalLogs = remoteExecution.result.logs ?? [];
                    emitNodeFinished(sink, workflow.metadata.id, runId, runningNode.id, remoteNode.status, durationMs, terminalLogs);
                    const logs = [...retryAttemptLogs, ...terminalLogs];
                    options.onNodeFinish?.(remoteNode);
                    return { node: remoteNode, result: { ...remoteExecution.result, status: remoteNode.status, logs } };
                }

                const result = await handler({
                    node: { ...executableNode, ports: { ...executableNode.ports, in: input } },
                    workflow: currentWorkflow,
                    settings: options.settings,
                    input,
                    signal: options.signal,
                    hostContext: options.hostContext,
                    invokeConnectedNode: async ({ nodeId, input: nextInput, overrides: nextOverrides }) => executeConnectedNodeById(nodeId, nextInput, nextOverrides)
                });
                const status = resolveResultStatus(result);
                if (status === WorkflowNodeStatusEnum.Failed) {
                    const message = resolveFailureMessageFromResult(result);
                    const terminalAttemptLogs = [...(result.logs ?? [])];
                    if (attemptNumber <= retryLimit) {
                        const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
                        const iterationLogs = [...terminalAttemptLogs, retryLog];
                        retryAttemptLogs.push(...iterationLogs);
                        emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, iterationLogs);
                        continue;
                    }

                    const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(runningNode, message));
                    currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
                    outputsByNode.set(failedNode.id, toPortsOut(failedNode));
                    const finishedAt = new Date().toISOString();
                    const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                    nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, finishedAt, durationMs);
                    emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
                    const terminalLogs = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
                    emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, terminalLogs);
                    const logs = [...retryAttemptLogs, ...terminalLogs];
                    options.onNodeFinish?.(failedNode);
                    return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs } };
                }

                const normalizedResult = { ...result, status: status as WorkflowNodeStatusEnum };
                const completedNode = publishBiControlState(currentWorkflow, buildCompletedNodeState(runningNode, input, normalizedResult));
                currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
                outputsByNode.set(completedNode.id, toPortsOut(completedNode));
                const finishedAt = new Date().toISOString();
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, finishedAt, durationMs);
                const terminalLogs = result.logs ?? [];
                emitNodeFinished(sink, workflow.metadata.id, runId, runningNode.id, completedNode.status, durationMs, terminalLogs);
                const logs = [...retryAttemptLogs, ...terminalLogs];
                options.onNodeFinish?.(completedNode);
                return { node: completedNode, result: { ...normalizedResult, logs } };
            }

            throw new Error('Failure mitigation loop exited unexpectedly.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Node execution failed.';
            const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(runningNode, message));
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            outputsByNode.set(failedNode.id, toPortsOut(failedNode));
            const finishedAt = new Date().toISOString();
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, finishedAt, durationMs);
            emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
            const terminalLogs = [...retryAttemptLogs, message];
            emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, [message]);
            options.onNodeFinish?.(failedNode);
            return { node: failedNode, result: { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: terminalLogs } };
        } finally {
            invocationStack.delete(connectedNodeId);
        }
    };

    const invokeBiPeerNodes = async (originNodeId: string): Promise<void> => {
        const peerNodeIds = getBiPeerNodeIds(currentWorkflow, originNodeId);
        for (const peerNodeId of peerNodeIds) {
            await executeConnectedNodeById(peerNodeId);
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
            const disabledNode = publishBiControlState(currentWorkflow, { ...node, status: WorkflowNodeStatusEnum.Stopped, runtime: { ...(node.runtime ?? {}), status: WorkflowNodeStatusEnum.Stopped } });
            currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
            outputsByNode.set(node.id, toPortsOut(disabledNode));
            options.onNodeFinish?.(disabledNode);
            continue;
        }
        if (node.status === WorkflowNodeStatusEnum.Passed && Object.keys(toPortsOut(node)).length > 0) continue;

        const runningNode = publishBiControlState(currentWorkflow, buildRunningNodeState(node));
        currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
        options.onNodeStart?.(node.id);
        emitNodeStarted(sink, workflow.metadata.id, runId, runningNode);
        let input = buildNodeInputContext(currentWorkflow, node.id, outputsByNode, toPortsIn(runningNode));
        if (runningNode.modelId === END_MODEL_ID) input = { ...input, __workflow: buildWorkflowSummaryInput(runId, new Map(outputsByNode.entries()), nodeExecutionTimings, includeLogsInSummary ? events : []) };
        const startedAt = new Date().toISOString();
        const startedAtMs = performance.now();
        const retryLimit = resolveFailureRetryLimit(runningNode);
        const retryAttemptLogs: string[] = [];
        const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
        const variableResolution = resolveNodeRuntimeVariables(currentWorkflow, runningNode, input);
        if (!variableResolution.ok) {
            const message = formatVariableFailureMessage(variableResolution.failures, runningNode.name);
            const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(runningNode, message));
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            outputsByNode.set(node.id, toPortsOut(failedNode));
            const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, new Date().toISOString(), durationMs);
            emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
            emitNodeLogs(sink, workflow.metadata.id, runId, node.id, [message]);
            options.onNodeFinish?.(failedNode);
            return { workflow: currentWorkflow, stopped: false, events };
        }
        const executableNode: WorkflowNodeModel = {
            ...runningNode,
            runtime: { ...(runningNode.runtime ?? {}), ...variableResolution.runtime }
        };
        const handler = runtime.adapters.getNodeHandler(executableNode.modelId);

        try {
            if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);

            for (let attemptNumber = 1; attemptNumber <= retryLimit + 1; attemptNumber += 1) {
                if (!canRunLocally && options.executeNodeRemotely) {
                    const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, hostContext: options.hostContext });
                    currentWorkflow = remoteExecution.workflow;
                    (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => undefined));
                    const status = resolveResultStatus(remoteExecution.result, remoteExecution.node.status as WorkflowNodeStatusEnum);
                    const remoteNode = publishBiControlState(currentWorkflow, normalizeNodeStatus(remoteExecution.node, status));
                    currentWorkflow = replaceNodeById(currentWorkflow, remoteNode);
                    outputsByNode.set(node.id, toPortsOut(remoteNode));

                    if (status === WorkflowNodeStatusEnum.Failed) {
                        const message = resolveFailureMessageFromResult(remoteExecution.result, toRuntimeError(remoteNode) ?? 'Node execution failed.');
                        const terminalAttemptLogs = [...(remoteExecution.result.logs ?? [])];
                        if (attemptNumber <= retryLimit) {
                            const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
                            const iterationLogs = [...terminalAttemptLogs, retryLog];
                            retryAttemptLogs.push(...iterationLogs);
                            emitNodeLogs(sink, workflow.metadata.id, runId, node.id, iterationLogs);
                            continue;
                        }

                        const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(remoteNode, message));
                        currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
                        outputsByNode.set(node.id, toPortsOut(failedNode));
                        const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                        nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, new Date().toISOString(), durationMs);
                        emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
                        const terminalLogs = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
                        emitNodeLogs(sink, workflow.metadata.id, runId, node.id, terminalLogs);
                        options.onNodeFinish?.(failedNode);
                        return { workflow: currentWorkflow, stopped: false, events };
                    }

                    const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                    nodeExecutionTimings[node.id] = createNodeExecutionTiming(remoteNode, remoteNode.status, startedAt, new Date().toISOString(), durationMs);
                    const terminalLogs = remoteExecution.result.logs ?? [];
                    emitNodeFinished(sink, workflow.metadata.id, runId, node.id, remoteNode.status, durationMs, terminalLogs);
                    options.onNodeFinish?.(remoteNode);
                    if (remoteNode.status === WorkflowNodeStatusEnum.Stopped) {
                        emitWorkflowStopped(sink, workflow.metadata.id, runId);
                        return { workflow: currentWorkflow, stopped: true, events };
                    }
                    await invokeBiPeerNodes(node.id);
                    break;
                }

                const result = await handler({
                    node: { ...executableNode, ports: { ...executableNode.ports, in: input } },
                    workflow: currentWorkflow,
                    settings: options.settings,
                    input,
                    signal: options.signal,
                    hostContext: options.hostContext,
                    invokeConnectedNode: async ({ nodeId, input: nextInput, overrides }) => executeConnectedNodeById(nodeId, nextInput, overrides)
                });
                const status = resolveResultStatus(result);
                if (status === WorkflowNodeStatusEnum.Failed) {
                    const message = resolveFailureMessageFromResult(result);
                    const terminalAttemptLogs = [...(result.logs ?? [])];
                    if (attemptNumber <= retryLimit) {
                        const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
                        const iterationLogs = [...terminalAttemptLogs, retryLog];
                        retryAttemptLogs.push(...iterationLogs);
                        emitNodeLogs(sink, workflow.metadata.id, runId, node.id, iterationLogs);
                        continue;
                    }

                    const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(runningNode, message));
                    currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
                    outputsByNode.set(node.id, toPortsOut(failedNode));
                    nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, new Date().toISOString(), Number((performance.now() - startedAtMs).toFixed(2)));
                    emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
                    const terminalLogs = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
                    emitNodeLogs(sink, workflow.metadata.id, runId, node.id, terminalLogs);
                    options.onNodeFinish?.(failedNode);
                    return { workflow: currentWorkflow, stopped: false, events };
                }

                const normalizedResult = { ...result, status: status as WorkflowNodeStatusEnum };
                const completedNode = publishBiControlState(currentWorkflow, buildCompletedNodeState(runningNode, input, normalizedResult));
                currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
                outputsByNode.set(node.id, toPortsOut(completedNode));
                const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
                nodeExecutionTimings[node.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, new Date().toISOString(), durationMs);
                const terminalLogs = result.logs ?? [];
                emitNodeFinished(sink, workflow.metadata.id, runId, node.id, completedNode.status, durationMs, terminalLogs);
                options.onNodeFinish?.(completedNode);
                if (completedNode.status === WorkflowNodeStatusEnum.Stopped) {
                    emitWorkflowStopped(sink, workflow.metadata.id, runId);
                    return { workflow: currentWorkflow, stopped: true, events };
                }
                await invokeBiPeerNodes(node.id);
                break;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Node execution failed.';
            const failedNode = publishBiControlState(currentWorkflow, buildFailedNodeState(runningNode, message));
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, WorkflowNodeStatusEnum.Failed, startedAt, new Date().toISOString(), Number((performance.now() - startedAtMs).toFixed(2)));
            emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
            emitNodeLogs(sink, workflow.metadata.id, runId, node.id, [message]);
            options.onNodeFinish?.(failedNode);
            return { workflow: currentWorkflow, stopped: false, events };
        }
    }

    emitWorkflowCompleted(sink, workflow.metadata.id, runId);
    return { workflow: currentWorkflow, stopped: false, events };
};
