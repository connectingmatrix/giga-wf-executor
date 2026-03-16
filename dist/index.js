import {
  buildCompletedNodeState,
  buildFailedNodeState,
  buildNodeInputContext,
  buildRunningNodeState,
  buildWorkflowSummaryInput,
  collectReachableNodeIdsFromStartNodes,
  createNodeExecutionTiming,
  createRunId,
  emitNodeFailed,
  emitNodeFinished,
  emitNodeStarted,
  emitWorkflowCompleted,
  emitWorkflowStopped,
  emitWorkflowValidationFailed,
  markRunningNodesAsStopped,
  replaceNodeById,
  shouldExecuteNodeInCurrentRun,
  sortWorkflowNodesTopologically
} from "./chunk-WML34O55.js";
import {
  WorkflowExecutorModeEnum,
  WorkflowLogLevelEnum,
  WorkflowNodeKindEnum,
  WorkflowNodeStatusEnum
} from "./chunk-QLBKSI3F.js";

// src/executor/jsonl-logger.ts
var createJsonlLogger = (onPush) => {
  const entries = [];
  const push = (event) => {
    const nextEvent = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      ...event
    };
    entries.push(nextEvent);
    onPush?.(nextEvent);
  };
  return {
    entries,
    push,
    toJsonl: () => entries.map((entry) => JSON.stringify(entry)).join("\n")
  };
};

// src/executor/step-runner.ts
var toPortsOut = (node) => node.ports?.out && typeof node.ports.out === "object" ? node.ports.out : {};
var toPortsIn = (node) => node.ports?.in && typeof node.ports.in === "object" ? node.ports.in : {};
var isNodeEnabled = (node) => typeof node.runtime?.enabled === "boolean" ? node.runtime.enabled : true;
var createEventCollector = (options) => {
  const events = [];
  const sink = (event) => {
    const withTimestamp = { ...event, timestamp: (/* @__PURE__ */ new Date()).toISOString() };
    events.push(withTimestamp);
    options.onEvent?.(withTimestamp);
  };
  return { events, sink };
};
var executeNodeStepWithContext = async (runtime, options) => {
  const runId = createRunId("step");
  let workingWorkflow = { ...options.workflow };
  const { events, sink } = createEventCollector(options);
  const outputsByNode = /* @__PURE__ */ new Map();
  workingWorkflow.nodes.forEach((item) => outputsByNode.set(item.id, toPortsOut(item)));
  const executionStack = /* @__PURE__ */ new Set();
  const executeNodeById = async (targetNodeId, overrideInput, nestedOverrides) => {
    if (executionStack.has(targetNodeId)) throw new Error(`Circular node invocation detected for "${targetNodeId}".`);
    const node = workingWorkflow.nodes.find((item) => item.id === targetNodeId);
    if (!node) throw new Error(`Node "${targetNodeId}" not found for step execution.`);
    if (!isNodeEnabled(node)) {
      const disabledNode = { ...node, status: "stopped" /* Stopped */, runtime: { ...node.runtime ?? {}, status: "stopped" /* Stopped */ } };
      workingWorkflow = replaceNodeById(workingWorkflow, disabledNode);
      return { node: disabledNode, result: { output: toPortsOut(node).output ?? null, status: "stopped" /* Stopped */, logs: ["Node is disabled."] } };
    }
    executionStack.add(targetNodeId);
    const runtimeOverrides = targetNodeId === options.nodeId ? options.overrides : nestedOverrides;
    const runningNode = buildRunningNodeState(node, { runtime: { ...node.runtime ?? {}, ...runtimeOverrides?.runtime ?? {}, ...runtimeOverrides?.properties ?? {} } });
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
        (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => void 0));
        const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
        emitNodeFinished(sink, options.workflow.metadata.id, runId, runningNode.id, remoteExecution.result.status ?? "passed" /* Passed */, durationMs2, remoteExecution.result.logs);
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
      const message = error instanceof Error ? error.message : "Step execution failed.";
      const failedNode = buildFailedNodeState(runningNode, message);
      workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
      outputsByNode.set(runningNode.id, toPortsOut(failedNode));
      emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
      return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: [message] } };
    } finally {
      executionStack.delete(targetNodeId);
    }
  };
  const outcome = await executeNodeById(options.nodeId);
  return { workflow: workingWorkflow, node: outcome.node, result: outcome.result, events };
};

// src/executor/workflow-runner.ts
var START_MODEL_ID = "start";
var END_MODEL_ID = "respond-end";
var isNodeEnabled2 = (node) => typeof node.runtime?.enabled === "boolean" ? node.runtime.enabled : true;
var shouldForwardLogs = (workflow) => workflow.nodes.some((node) => node.modelId === START_MODEL_ID && node.runtime?.forwardSessionLogs === true);
var toPortsOut2 = (node) => node.ports?.out && typeof node.ports.out === "object" ? node.ports.out : {};
var toPortsIn2 = (node) => node.ports?.in && typeof node.ports.in === "object" ? node.ports.in : {};
var createEventCollector2 = (options) => {
  const events = [];
  const sink = (event) => {
    const withTimestamp = { ...event, timestamp: (/* @__PURE__ */ new Date()).toISOString() };
    events.push(withTimestamp);
    options.onEvent?.(withTimestamp);
  };
  return { events, sink };
};
var executeWorkflowWithContext = async (runtime, workflow, options) => {
  const runId = createRunId("run");
  let currentWorkflow = { ...workflow };
  const { events, sink } = createEventCollector2(options);
  const startNodeIds = currentWorkflow.nodes.filter((node) => node.modelId === START_MODEL_ID).map((node) => node.id);
  const hasEndNode = currentWorkflow.nodes.some((node) => node.modelId === END_MODEL_ID);
  if (startNodeIds.length === 0 || !hasEndNode) {
    const missing = [startNodeIds.length === 0 ? "Start node" : null, !hasEndNode ? "Respond/End node" : null].filter((item) => Boolean(item));
    emitWorkflowValidationFailed(sink, workflow.metadata.id, runId, `Workflow execution requires ${missing.join(" and ")}.`);
    return { workflow: currentWorkflow, stopped: false, events };
  }
  const includeLogsInSummary = shouldForwardLogs(currentWorkflow);
  const reachableNodeIds = collectReachableNodeIdsFromStartNodes(currentWorkflow, startNodeIds);
  const orderedIds = sortWorkflowNodesTopologically(currentWorkflow).filter((nodeId) => reachableNodeIds.has(nodeId));
  const outputsByNode = /* @__PURE__ */ new Map();
  currentWorkflow.nodes.forEach((node) => outputsByNode.set(node.id, toPortsOut2(node)));
  const nodeExecutionTimings = {};
  const invocationStack = /* @__PURE__ */ new Set();
  const executeConnectedNodeById = async (connectedNodeId, overrideInput, overrides) => {
    if (invocationStack.has(connectedNodeId)) throw new Error(`Circular invocation detected for node "${connectedNodeId}".`);
    const connectedNode = currentWorkflow.nodes.find((item) => item.id === connectedNodeId);
    if (!connectedNode) throw new Error(`Connected node "${connectedNodeId}" was not found.`);
    if (!isNodeEnabled2(connectedNode)) {
      const disabledNode = { ...connectedNode, status: "stopped" /* Stopped */, runtime: { ...connectedNode.runtime ?? {}, status: "stopped" /* Stopped */ } };
      currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
      outputsByNode.set(disabledNode.id, toPortsOut2(disabledNode));
      return { node: disabledNode, result: { output: toPortsOut2(connectedNode).output ?? null, status: "stopped" /* Stopped */, logs: ["Node is disabled."] } };
    }
    invocationStack.add(connectedNodeId);
    const runningNode = buildRunningNodeState(connectedNode, { runtime: { ...connectedNode.runtime ?? {}, ...overrides?.runtime ?? {}, ...overrides?.properties ?? {} } });
    currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
    options.onNodeStart?.(runningNode.id);
    emitNodeStarted(sink, workflow.metadata.id, runId, runningNode);
    const handler = runtime.adapters.getNodeHandler(runningNode.modelId);
    const input = overrideInput ?? buildNodeInputContext(currentWorkflow, runningNode.id, outputsByNode, toPortsIn2(runningNode));
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const startedAtMs = performance.now();
    try {
      const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
      if (!canRunLocally && options.executeNodeRemotely) {
        const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, overrides, hostContext: options.hostContext });
        currentWorkflow = remoteExecution.workflow;
        outputsByNode.set(remoteExecution.node.id, toPortsOut2(remoteExecution.node));
        (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => void 0));
        const finishedAt2 = (/* @__PURE__ */ new Date()).toISOString();
        const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
        nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(remoteExecution.node, remoteExecution.node.status, startedAt, finishedAt2, durationMs2);
        emitNodeFinished(sink, workflow.metadata.id, runId, runningNode.id, remoteExecution.result.status ?? "passed" /* Passed */, durationMs2, remoteExecution.result.logs);
        options.onNodeFinish?.(remoteExecution.node);
        return { node: remoteExecution.node, result: remoteExecution.result };
      }
      if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);
      const result = await handler({ node: { ...runningNode, ports: { ...runningNode.ports, in: input } }, workflow: currentWorkflow, settings: options.settings, input, signal: options.signal, hostContext: options.hostContext, invokeConnectedNode: async ({ nodeId, input: nextInput, overrides: nextOverrides }) => executeConnectedNodeById(nodeId, nextInput, nextOverrides) });
      const completedNode = buildCompletedNodeState(runningNode, input, result);
      currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
      outputsByNode.set(completedNode.id, toPortsOut2(completedNode));
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, finishedAt, durationMs);
      emitNodeFinished(sink, workflow.metadata.id, runId, runningNode.id, completedNode.status, durationMs, result.logs);
      options.onNodeFinish?.(completedNode);
      return { node: completedNode, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node execution failed.";
      const failedNode = buildFailedNodeState(runningNode, message);
      currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
      outputsByNode.set(failedNode.id, toPortsOut2(failedNode));
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, finishedAt, durationMs);
      emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
      options.onNodeFinish?.(failedNode);
      return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: [message] } };
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
    if (!isNodeEnabled2(node)) {
      const disabledNode = { ...node, status: "stopped" /* Stopped */, runtime: { ...node.runtime ?? {}, status: "stopped" /* Stopped */ } };
      currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
      outputsByNode.set(node.id, toPortsOut2(disabledNode));
      options.onNodeFinish?.(disabledNode);
      continue;
    }
    if (node.status === "passed" /* Passed */ && Object.keys(toPortsOut2(node)).length > 0) continue;
    const runningNode = buildRunningNodeState(node);
    currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
    options.onNodeStart?.(node.id);
    emitNodeStarted(sink, workflow.metadata.id, runId, runningNode);
    const handler = runtime.adapters.getNodeHandler(node.modelId);
    let input = buildNodeInputContext(currentWorkflow, node.id, outputsByNode, toPortsIn2(runningNode));
    if (runningNode.modelId === END_MODEL_ID) input = { ...input, __workflow: buildWorkflowSummaryInput(runId, new Map(outputsByNode.entries()), nodeExecutionTimings, includeLogsInSummary ? events : []) };
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const startedAtMs = performance.now();
    try {
      const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
      if (!canRunLocally && options.executeNodeRemotely) {
        const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, hostContext: options.hostContext });
        currentWorkflow = remoteExecution.workflow;
        outputsByNode.set(node.id, toPortsOut2(remoteExecution.node));
        (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => void 0));
        const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
        nodeExecutionTimings[node.id] = createNodeExecutionTiming(remoteExecution.node, remoteExecution.node.status, startedAt, (/* @__PURE__ */ new Date()).toISOString(), durationMs2);
        emitNodeFinished(sink, workflow.metadata.id, runId, node.id, remoteExecution.result.status ?? "passed" /* Passed */, durationMs2, remoteExecution.result.logs);
        options.onNodeFinish?.(remoteExecution.node);
        continue;
      }
      if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);
      const result = await handler({ node: { ...runningNode, ports: { ...runningNode.ports, in: input } }, workflow: currentWorkflow, settings: options.settings, input, signal: options.signal, hostContext: options.hostContext, invokeConnectedNode: async ({ nodeId: nodeId2, input: nextInput, overrides }) => executeConnectedNodeById(nodeId2, nextInput, overrides) });
      const completedNode = buildCompletedNodeState(runningNode, input, result);
      currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
      outputsByNode.set(node.id, toPortsOut2(completedNode));
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      nodeExecutionTimings[node.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, (/* @__PURE__ */ new Date()).toISOString(), durationMs);
      emitNodeFinished(sink, workflow.metadata.id, runId, node.id, completedNode.status, durationMs, result.logs);
      options.onNodeFinish?.(completedNode);
      if (completedNode.status === "stopped" /* Stopped */) {
        emitWorkflowStopped(sink, workflow.metadata.id, runId);
        return { workflow: currentWorkflow, stopped: true, events };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node execution failed.";
      const failedNode = buildFailedNodeState(runningNode, message);
      currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
      nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, (/* @__PURE__ */ new Date()).toISOString(), Number((performance.now() - startedAtMs).toFixed(2)));
      emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
      options.onNodeFinish?.(failedNode);
    }
  }
  emitWorkflowCompleted(sink, workflow.metadata.id, runId);
  return { workflow: currentWorkflow, stopped: false, events };
};

// src/executor/create-workflow-executor.ts
var createWorkflowExecutor = (args) => {
  const mode = args.mode || "local" /* Local */;
  const runtime = {
    mode,
    adapters: args.adapters
  };
  return {
    mode,
    executeWorkflow: (workflow, options) => executeWorkflowWithContext(runtime, workflow, options),
    executeNodeStep: (options) => executeNodeStepWithContext(runtime, options)
  };
};
export {
  WorkflowExecutorModeEnum,
  WorkflowLogLevelEnum,
  WorkflowNodeKindEnum,
  WorkflowNodeStatusEnum,
  buildCompletedNodeState,
  buildFailedNodeState,
  buildNodeInputContext,
  buildRunningNodeState,
  buildWorkflowSummaryInput,
  collectReachableNodeIdsFromStartNodes,
  createJsonlLogger,
  createNodeExecutionTiming,
  createRunId,
  createWorkflowExecutor,
  emitNodeFailed,
  emitNodeFinished,
  emitNodeStarted,
  emitWorkflowCompleted,
  emitWorkflowStopped,
  emitWorkflowValidationFailed,
  markRunningNodesAsStopped,
  replaceNodeById,
  shouldExecuteNodeInCurrentRun,
  sortWorkflowNodesTopologically
};
