"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  WorkflowExecutorModeEnum: () => WorkflowExecutorModeEnum,
  WorkflowLogLevelEnum: () => WorkflowLogLevelEnum,
  WorkflowNodeKindEnum: () => WorkflowNodeKindEnum,
  WorkflowNodeStatusEnum: () => WorkflowNodeStatusEnum,
  buildCompletedNodeState: () => buildCompletedNodeState,
  buildFailedNodeState: () => buildFailedNodeState,
  buildNodeInputContext: () => buildNodeInputContext,
  buildRunningNodeState: () => buildRunningNodeState,
  buildWorkflowSummaryInput: () => buildWorkflowSummaryInput,
  collectReachableNodeIdsFromStartNodes: () => collectReachableNodeIdsFromStartNodes,
  createJsonlLogger: () => createJsonlLogger,
  createNodeExecutionTiming: () => createNodeExecutionTiming,
  createRunId: () => createRunId,
  createWorkflowExecutor: () => createWorkflowExecutor,
  emitNodeFailed: () => emitNodeFailed,
  emitNodeFinished: () => emitNodeFinished,
  emitNodeLogs: () => emitNodeLogs,
  emitNodeStarted: () => emitNodeStarted,
  emitWorkflowCompleted: () => emitWorkflowCompleted,
  emitWorkflowStopped: () => emitWorkflowStopped,
  emitWorkflowValidationFailed: () => emitWorkflowValidationFailed,
  markRunningNodesAsStopped: () => markRunningNodesAsStopped,
  replaceNodeById: () => replaceNodeById,
  shouldExecuteNodeInCurrentRun: () => shouldExecuteNodeInCurrentRun,
  sortWorkflowNodesTopologically: () => sortWorkflowNodesTopologically
});
module.exports = __toCommonJS(index_exports);

// src/types/index.ts
var WorkflowNodeStatusEnum = /* @__PURE__ */ ((WorkflowNodeStatusEnum2) => {
  WorkflowNodeStatusEnum2["Passed"] = "passed";
  WorkflowNodeStatusEnum2["Failed"] = "failed";
  WorkflowNodeStatusEnum2["Warning"] = "warning";
  WorkflowNodeStatusEnum2["Running"] = "running";
  WorkflowNodeStatusEnum2["Stopped"] = "stopped";
  return WorkflowNodeStatusEnum2;
})(WorkflowNodeStatusEnum || {});
var WorkflowNodeKindEnum = /* @__PURE__ */ ((WorkflowNodeKindEnum2) => {
  WorkflowNodeKindEnum2["Process"] = "process";
  WorkflowNodeKindEnum2["Output"] = "output";
  WorkflowNodeKindEnum2["Error"] = "error";
  return WorkflowNodeKindEnum2;
})(WorkflowNodeKindEnum || {});
var WorkflowLogLevelEnum = /* @__PURE__ */ ((WorkflowLogLevelEnum2) => {
  WorkflowLogLevelEnum2["Info"] = "info";
  WorkflowLogLevelEnum2["Warn"] = "warn";
  WorkflowLogLevelEnum2["Error"] = "error";
  return WorkflowLogLevelEnum2;
})(WorkflowLogLevelEnum || {});
var WorkflowExecutorModeEnum = /* @__PURE__ */ ((WorkflowExecutorModeEnum2) => {
  WorkflowExecutorModeEnum2["Local"] = "local";
  WorkflowExecutorModeEnum2["Server"] = "server";
  return WorkflowExecutorModeEnum2;
})(WorkflowExecutorModeEnum || {});

// src/node-core/run-context.ts
var parseTargetInputPortName = (connection) => {
  const [, parsedPort] = (connection.targetHandle ?? "").split(":");
  return parsedPort?.trim() ? parsedPort : "input";
};
var parseSourceOutputPortName = (connection) => {
  const [, parsedPort] = (connection.sourceHandle ?? "").split(":");
  return parsedPort?.trim() ? parsedPort : "output";
};
var parseStringArray = (value) => {
  if (!Array.isArray(value)) return null;
  const next = value.filter((item) => typeof item === "string" && item.trim().length > 0);
  return next.length > 0 ? next : null;
};
var isConnectionActiveForExecution = (connection, sourcePortsOut) => {
  const activeConnectionIds = parseStringArray(sourcePortsOut.__activeConnectionIds);
  if (activeConnectionIds) return activeConnectionIds.includes(connection.id);
  const activeOutputPorts = parseStringArray(sourcePortsOut.__activeOutputs);
  if (!activeOutputPorts) return true;
  return activeOutputPorts.includes(parseSourceOutputPortName(connection));
};
var resolveSourceOutputValue = (sourcePortsOut, connection) => {
  const sourcePortName = parseSourceOutputPortName(connection);
  if (Object.prototype.hasOwnProperty.call(sourcePortsOut, sourcePortName)) return sourcePortsOut[sourcePortName];
  return sourcePortsOut.output;
};
var buildNodeInputContext = (workflow, nodeId, outputsByNodeId, fallbackInput) => {
  const incoming = workflow.connections.filter((connection) => connection.to === nodeId);
  if (!incoming.length) return fallbackInput;
  return incoming.reduce((acc, connection) => {
    const sourcePortsOut = outputsByNodeId.get(connection.from);
    if (!sourcePortsOut) return acc;
    if (!isConnectionActiveForExecution(connection, sourcePortsOut)) return acc;
    const sourceOutput = resolveSourceOutputValue(sourcePortsOut, connection);
    if (typeof sourceOutput === "undefined") return acc;
    const inputPortName = parseTargetInputPortName(connection);
    if (!acc[inputPortName]) acc[inputPortName] = {};
    acc[inputPortName][connection.from] = sourceOutput;
    return acc;
  }, {});
};
var shouldExecuteNodeInCurrentRun = (workflow, nodeId, outputsByNodeId) => {
  const incoming = workflow.connections.filter((connection) => connection.to === nodeId);
  if (incoming.length === 0) return true;
  return incoming.some((connection) => {
    const sourcePortsOut = outputsByNodeId.get(connection.from);
    return sourcePortsOut ? isConnectionActiveForExecution(connection, sourcePortsOut) : false;
  });
};
var collectReachableNodeIdsFromStartNodes = (workflow, startNodeIds) => {
  const reachableNodeIds = new Set(startNodeIds);
  const queue = [...startNodeIds];
  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    const downstream = workflow.connections.filter((connection) => connection.from === currentNodeId).map((connection) => connection.to);
    downstream.forEach((downstreamNodeId) => {
      if (reachableNodeIds.has(downstreamNodeId)) return;
      reachableNodeIds.add(downstreamNodeId);
      queue.push(downstreamNodeId);
    });
  }
  return reachableNodeIds;
};
var sortWorkflowNodesTopologically = (workflow) => {
  const nodeIds = workflow.nodes.map((node) => node.id);
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = /* @__PURE__ */ new Map();
  workflow.connections.forEach((connection) => {
    indegree.set(connection.to, (indegree.get(connection.to) || 0) + 1);
    const list = outgoing.get(connection.from) || [];
    list.push(connection.to);
    outgoing.set(connection.from, list);
  });
  const queue = nodeIds.filter((id) => (indegree.get(id) || 0) === 0);
  const ordered = [];
  while (queue.length > 0) {
    const current = queue.shift();
    ordered.push(current);
    (outgoing.get(current) || []).forEach((target) => {
      const nextDegree = (indegree.get(target) || 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) queue.push(target);
    });
  }
  return ordered.length === nodeIds.length ? ordered : nodeIds;
};

// src/node-core/state.ts
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var toRuntimeMap = (runtime) => {
  return runtime && typeof runtime === "object" && !Array.isArray(runtime) ? { ...runtime } : {};
};
var toPorts = (ports) => ({
  in: ports?.in && typeof ports.in === "object" ? { ...ports.in } : {},
  out: ports?.out && typeof ports.out === "object" ? { ...ports.out } : {}
});
var buildOutputPorts = (output) => {
  const portsOut = { output };
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output;
    if (Array.isArray(record.__activeOutputs)) portsOut.__activeOutputs = record.__activeOutputs;
    if (Array.isArray(record.__activeConnectionIds)) portsOut.__activeConnectionIds = record.__activeConnectionIds;
    Object.entries(record).forEach(([key, value]) => {
      if (key.endsWith("Branch") && value && typeof value === "object" && !Array.isArray(value)) {
        const branch = value;
        if (typeof branch.outputPort === "string" && branch.outputPort.trim()) {
          portsOut[branch.outputPort] = branch.value;
        }
      }
    });
  }
  return portsOut;
};
var replaceNodeById = (workflow, nextNode) => ({
  ...workflow,
  nodes: workflow.nodes.map((item) => item.id === nextNode.id ? nextNode : item)
});
var buildRunningNodeState = (node, overrides) => {
  const runtime = { ...toRuntimeMap(node.runtime), ...toRuntimeMap(overrides?.runtime), status: "running" /* Running */, timestamp: nowIso() };
  const ports = toPorts(overrides?.ports ?? node.ports);
  return { ...node, ...overrides, status: "running" /* Running */, runtime, ports };
};
var buildCompletedNodeState = (node, input, result) => {
  const status = result.status ?? "passed" /* Passed */;
  const runtime = { ...toRuntimeMap(node.runtime), status, timestamp: nowIso() };
  const ports = toPorts(node.ports);
  ports.in = input;
  ports.out = buildOutputPorts(result.output);
  return { ...node, status, runtime, ports };
};
var buildFailedNodeState = (node, message) => {
  const runtime = { ...toRuntimeMap(node.runtime), status: "failed" /* Failed */, timestamp: nowIso(), error: message };
  const ports = toPorts(node.ports);
  ports.out = { error: { message } };
  return { ...node, status: "failed" /* Failed */, runtime, ports };
};
var markRunningNodesAsStopped = (workflow) => ({
  ...workflow,
  nodes: workflow.nodes.map((node) => {
    if (node.status !== "running" /* Running */) return node;
    return { ...node, status: "stopped" /* Stopped */, runtime: { ...toRuntimeMap(node.runtime), status: "stopped" /* Stopped */, timestamp: nowIso() } };
  })
});

// src/node-core/log.ts
var createRunId = (prefix) => `${prefix}_${Date.now()}`;
var resolveLogLevelFromStatus = (status) => {
  if (status === "failed" /* Failed */) return "error" /* Error */;
  if (status === "warning" /* Warning */ || status === "stopped" /* Stopped */) return "warn" /* Warn */;
  return "info" /* Info */;
};
var emitNodeStarted = (sink, workflowId, runId, node) => {
  sink({ workflowId, runId, nodeId: node.id, event: "node.started", level: "info" /* Info */, message: `Running ${node.name}` });
};
var emitNodeLogs = (sink, workflowId, runId, nodeId, logs) => {
  (logs ?? []).forEach((line) => sink({ workflowId, runId, nodeId, event: "node.log", level: "info" /* Info */, message: line }));
};
var emitNodeFinished = (sink, workflowId, runId, nodeId, status, durationMs, logs) => {
  sink({ workflowId, runId, nodeId, event: "node.finished", level: resolveLogLevelFromStatus(status), data: { status, durationMs } });
  emitNodeLogs(sink, workflowId, runId, nodeId, logs);
};
var emitNodeFailed = (sink, workflowId, runId, nodeId, message) => {
  sink({ workflowId, runId, nodeId, event: "node.failed", level: "error" /* Error */, message });
};
var emitWorkflowStopped = (sink, workflowId, runId) => {
  sink({ workflowId, runId, event: "workflow.stopped", level: "warn" /* Warn */, message: "Workflow execution was stopped by user." });
};
var emitWorkflowCompleted = (sink, workflowId, runId) => {
  sink({ workflowId, runId, event: "workflow.completed", level: "info" /* Info */ });
};
var emitWorkflowValidationFailed = (sink, workflowId, runId, message) => {
  sink({ workflowId, runId, event: "workflow.validation_failed", level: "error" /* Error */, message });
};

// src/node-core/summary.ts
var createNodeExecutionTiming = (node, status, startedAt, finishedAt, durationMs) => ({
  nodeId: node.id,
  name: node.name,
  status,
  startedAt,
  finishedAt,
  durationMs
});
var buildWorkflowSummaryInput = (runId, outputsByNode, timingsByNode, logs = []) => ({
  runId,
  outputsByNode: Object.fromEntries(outputsByNode.entries()),
  nodeExecutionTimings: timingsByNode,
  totalDurationMs: Object.values(timingsByNode).reduce((total, item) => total + item.durationMs, 0),
  logs
});

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

// src/executor/failure-mitigation.ts
var WORKFLOW_FAILURE_MITIGATION_STOP = "stop-workflow";
var WORKFLOW_FAILURE_MITIGATION_RETRY = "retry-node";
var WORKFLOW_MIN_RETRY_COUNT = 1;
var WORKFLOW_MAX_RETRY_COUNT = 6;
var parseRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
var parseFailureMitigationMode = (value) => {
  return value === WORKFLOW_FAILURE_MITIGATION_RETRY ? WORKFLOW_FAILURE_MITIGATION_RETRY : WORKFLOW_FAILURE_MITIGATION_STOP;
};
var parseFailureRetryCount = (value) => {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return WORKFLOW_MIN_RETRY_COUNT;
  const rounded = Math.round(parsed);
  if (rounded < WORKFLOW_MIN_RETRY_COUNT) return WORKFLOW_MIN_RETRY_COUNT;
  if (rounded > WORKFLOW_MAX_RETRY_COUNT) return WORKFLOW_MAX_RETRY_COUNT;
  return rounded;
};
var resolveFailureRetryLimit = (node) => {
  const runtime = parseRecord(node.runtime);
  const mitigation = parseFailureMitigationMode(runtime.failureMitigation);
  if (mitigation !== WORKFLOW_FAILURE_MITIGATION_RETRY) return 0;
  return parseFailureRetryCount(runtime.retryCount);
};
var resolveResultStatus = (result, fallbackStatus = "passed" /* Passed */) => {
  return typeof result.status === "string" ? result.status : fallbackStatus;
};
var resolveFailureMessageFromResult = (result, fallbackMessage = "Node execution failed.") => {
  const output = parseRecord(result.output);
  const candidate = output.error ?? output.message;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return fallbackMessage;
};
var buildRetryAttemptLog = (attemptNumber, retryLimit, errorMessage) => `Attempt ${attemptNumber} failed: ${errorMessage}. Retrying (${attemptNumber}/${retryLimit})...`;

// src/executor/step-runner.ts
var toPortsOut = (node) => node.ports?.out && typeof node.ports.out === "object" ? node.ports.out : {};
var toPortsIn = (node) => node.ports?.in && typeof node.ports.in === "object" ? node.ports.in : {};
var isNodeEnabled = (node) => typeof node.runtime?.enabled === "boolean" ? node.runtime.enabled : true;
var toRuntimeError = (node) => {
  const runtime = node.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return null;
  const candidate = runtime.error;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
};
var normalizeNodeStatus = (node, status) => {
  if (node.status === status && node.runtime?.status === status) return node;
  return { ...node, status, runtime: { ...node.runtime ?? {}, status } };
};
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
    const retryLimit = resolveFailureRetryLimit(runningNode);
    const retryAttemptLogs = [];
    const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
    try {
      if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);
      for (let attemptNumber = 1; attemptNumber <= retryLimit + 1; attemptNumber += 1) {
        if (!canRunLocally && options.executeNodeRemotely) {
          const remoteExecution = await options.executeNodeRemotely({ workflow: workingWorkflow, nodeId: runningNode.id, settings: options.settings, overrides: runtimeOverrides, hostContext: options.hostContext });
          workingWorkflow = remoteExecution.workflow;
          (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => void 0));
          const status2 = resolveResultStatus(remoteExecution.result, remoteExecution.node.status);
          const remoteNode = normalizeNodeStatus(remoteExecution.node, status2);
          workingWorkflow = replaceNodeById(workingWorkflow, remoteNode);
          outputsByNode.set(runningNode.id, toPortsOut(remoteNode));
          if (status2 === "failed" /* Failed */) {
            const message = resolveFailureMessageFromResult(remoteExecution.result, toRuntimeError(remoteNode) ?? "Step execution failed.");
            const terminalAttemptLogs = [...remoteExecution.result.logs ?? []];
            if (attemptNumber <= retryLimit) {
              const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
              const iterationLogs = [...terminalAttemptLogs, retryLog];
              retryAttemptLogs.push(...iterationLogs);
              emitNodeLogs(sink, options.workflow.metadata.id, runId, runningNode.id, iterationLogs);
              continue;
            }
            const failedNode = buildFailedNodeState(remoteNode, message);
            workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
            outputsByNode.set(runningNode.id, toPortsOut(failedNode));
            emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
            const terminalLogs3 = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
            emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, terminalLogs3);
            return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: [...retryAttemptLogs, ...terminalLogs3] } };
          }
          const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
          const terminalLogs2 = remoteExecution.result.logs ?? [];
          emitNodeFinished(sink, options.workflow.metadata.id, runId, runningNode.id, remoteNode.status, durationMs2, terminalLogs2);
          return { node: remoteNode, result: { ...remoteExecution.result, status: remoteNode.status, logs: [...retryAttemptLogs, ...terminalLogs2] } };
        }
        const handler = runtime.adapters.getNodeHandler(runningNode.modelId);
        const result = await handler({
          node: { ...runningNode, ports: { ...runningNode.ports, in: input } },
          workflow: workingWorkflow,
          settings: options.settings,
          input,
          signal: options.signal,
          hostContext: options.hostContext,
          invokeConnectedNode: async ({ nodeId, input: connectedInput, overrides }) => executeNodeById(nodeId, connectedInput, overrides)
        });
        const status = resolveResultStatus(result);
        if (status === "failed" /* Failed */) {
          const message = resolveFailureMessageFromResult(result, "Step execution failed.");
          const terminalAttemptLogs = [...result.logs ?? []];
          if (attemptNumber <= retryLimit) {
            const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
            const iterationLogs = [...terminalAttemptLogs, retryLog];
            retryAttemptLogs.push(...iterationLogs);
            emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, iterationLogs);
            continue;
          }
          const failedNode = buildFailedNodeState(runningNode, message);
          workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
          outputsByNode.set(runningNode.id, toPortsOut(failedNode));
          emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
          const terminalLogs2 = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
          emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, terminalLogs2);
          return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: [...retryAttemptLogs, ...terminalLogs2] } };
        }
        const normalizedResult = { ...result, status };
        const completedNode = buildCompletedNodeState(runningNode, input, normalizedResult);
        workingWorkflow = replaceNodeById(workingWorkflow, completedNode);
        outputsByNode.set(runningNode.id, toPortsOut(completedNode));
        const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
        const terminalLogs = result.logs ?? [];
        emitNodeFinished(sink, options.workflow.metadata.id, runId, targetNodeId, completedNode.status, durationMs, terminalLogs);
        return { node: completedNode, result: { ...normalizedResult, logs: [...retryAttemptLogs, ...terminalLogs] } };
      }
      throw new Error("Failure mitigation loop exited unexpectedly.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step execution failed.";
      const failedNode = buildFailedNodeState(runningNode, message);
      workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
      outputsByNode.set(runningNode.id, toPortsOut(failedNode));
      emitNodeFailed(sink, options.workflow.metadata.id, runId, targetNodeId, message);
      emitNodeLogs(sink, options.workflow.metadata.id, runId, targetNodeId, [message]);
      return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: [...retryAttemptLogs, message] } };
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
var toRuntimeError2 = (node) => {
  const runtime = node.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return null;
  const candidate = runtime.error;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
};
var normalizeNodeStatus2 = (node, status) => {
  if (node.status === status && node.runtime?.status === status) return node;
  return { ...node, status, runtime: { ...node.runtime ?? {}, status } };
};
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
    const retryLimit = resolveFailureRetryLimit(runningNode);
    const retryAttemptLogs = [];
    const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
    if (!canRunLocally && !options.executeNodeRemotely) {
      const message = `Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`;
      const failedNode = buildFailedNodeState(runningNode, message);
      currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
      outputsByNode.set(failedNode.id, toPortsOut2(failedNode));
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, finishedAt, durationMs);
      emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
      options.onNodeFinish?.(failedNode);
      return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: [message] } };
    }
    try {
      for (let attemptNumber = 1; attemptNumber <= retryLimit + 1; attemptNumber += 1) {
        if (!canRunLocally && options.executeNodeRemotely) {
          const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, overrides, hostContext: options.hostContext });
          currentWorkflow = remoteExecution.workflow;
          (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => void 0));
          const status2 = resolveResultStatus(remoteExecution.result, remoteExecution.node.status);
          const remoteNode = normalizeNodeStatus2(remoteExecution.node, status2);
          currentWorkflow = replaceNodeById(currentWorkflow, remoteNode);
          outputsByNode.set(remoteNode.id, toPortsOut2(remoteNode));
          if (status2 === "failed" /* Failed */) {
            const message = resolveFailureMessageFromResult(remoteExecution.result, toRuntimeError2(remoteNode) ?? "Node execution failed.");
            const terminalAttemptLogs = [...remoteExecution.result.logs ?? []];
            if (attemptNumber <= retryLimit) {
              const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
              const iterationLogs = [...terminalAttemptLogs, retryLog];
              retryAttemptLogs.push(...iterationLogs);
              emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, iterationLogs);
              continue;
            }
            const failedNode = buildFailedNodeState(remoteNode, message);
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            outputsByNode.set(failedNode.id, toPortsOut2(failedNode));
            const finishedAt3 = (/* @__PURE__ */ new Date()).toISOString();
            const durationMs3 = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, finishedAt3, durationMs3);
            emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
            const terminalLogs3 = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
            emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, terminalLogs3);
            const logs3 = [...retryAttemptLogs, ...terminalLogs3];
            options.onNodeFinish?.(failedNode);
            return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: logs3 } };
          }
          const finishedAt2 = (/* @__PURE__ */ new Date()).toISOString();
          const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
          nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(remoteNode, remoteNode.status, startedAt, finishedAt2, durationMs2);
          const terminalLogs2 = remoteExecution.result.logs ?? [];
          emitNodeFinished(sink, workflow.metadata.id, runId, runningNode.id, remoteNode.status, durationMs2, terminalLogs2);
          const logs2 = [...retryAttemptLogs, ...terminalLogs2];
          options.onNodeFinish?.(remoteNode);
          return { node: remoteNode, result: { ...remoteExecution.result, status: remoteNode.status, logs: logs2 } };
        }
        const result = await handler({
          node: { ...runningNode, ports: { ...runningNode.ports, in: input } },
          workflow: currentWorkflow,
          settings: options.settings,
          input,
          signal: options.signal,
          hostContext: options.hostContext,
          invokeConnectedNode: async ({ nodeId, input: nextInput, overrides: nextOverrides }) => executeConnectedNodeById(nodeId, nextInput, nextOverrides)
        });
        const status = resolveResultStatus(result);
        if (status === "failed" /* Failed */) {
          const message = resolveFailureMessageFromResult(result);
          const terminalAttemptLogs = [...result.logs ?? []];
          if (attemptNumber <= retryLimit) {
            const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
            const iterationLogs = [...terminalAttemptLogs, retryLog];
            retryAttemptLogs.push(...iterationLogs);
            emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, iterationLogs);
            continue;
          }
          const failedNode = buildFailedNodeState(runningNode, message);
          currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
          outputsByNode.set(failedNode.id, toPortsOut2(failedNode));
          const finishedAt2 = (/* @__PURE__ */ new Date()).toISOString();
          const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
          nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, finishedAt2, durationMs2);
          emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
          const terminalLogs2 = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
          emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, terminalLogs2);
          const logs2 = [...retryAttemptLogs, ...terminalLogs2];
          options.onNodeFinish?.(failedNode);
          return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: logs2 } };
        }
        const normalizedResult = { ...result, status };
        const completedNode = buildCompletedNodeState(runningNode, input, normalizedResult);
        currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
        outputsByNode.set(completedNode.id, toPortsOut2(completedNode));
        const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
        const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
        nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, finishedAt, durationMs);
        const terminalLogs = result.logs ?? [];
        emitNodeFinished(sink, workflow.metadata.id, runId, runningNode.id, completedNode.status, durationMs, terminalLogs);
        const logs = [...retryAttemptLogs, ...terminalLogs];
        options.onNodeFinish?.(completedNode);
        return { node: completedNode, result: { ...normalizedResult, logs } };
      }
      throw new Error("Failure mitigation loop exited unexpectedly.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node execution failed.";
      const failedNode = buildFailedNodeState(runningNode, message);
      currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
      outputsByNode.set(failedNode.id, toPortsOut2(failedNode));
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, finishedAt, durationMs);
      emitNodeFailed(sink, workflow.metadata.id, runId, runningNode.id, message);
      const terminalLogs = [...retryAttemptLogs, message];
      emitNodeLogs(sink, workflow.metadata.id, runId, runningNode.id, [message]);
      options.onNodeFinish?.(failedNode);
      return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: terminalLogs } };
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
    const retryLimit = resolveFailureRetryLimit(runningNode);
    const retryAttemptLogs = [];
    const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
    try {
      if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);
      for (let attemptNumber = 1; attemptNumber <= retryLimit + 1; attemptNumber += 1) {
        if (!canRunLocally && options.executeNodeRemotely) {
          const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, hostContext: options.hostContext });
          currentWorkflow = remoteExecution.workflow;
          (remoteExecution.events ?? []).forEach(options.onEvent ?? (() => void 0));
          const status2 = resolveResultStatus(remoteExecution.result, remoteExecution.node.status);
          const remoteNode = normalizeNodeStatus2(remoteExecution.node, status2);
          currentWorkflow = replaceNodeById(currentWorkflow, remoteNode);
          outputsByNode.set(node.id, toPortsOut2(remoteNode));
          if (status2 === "failed" /* Failed */) {
            const message = resolveFailureMessageFromResult(remoteExecution.result, toRuntimeError2(remoteNode) ?? "Node execution failed.");
            const terminalAttemptLogs = [...remoteExecution.result.logs ?? []];
            if (attemptNumber <= retryLimit) {
              const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
              const iterationLogs = [...terminalAttemptLogs, retryLog];
              retryAttemptLogs.push(...iterationLogs);
              emitNodeLogs(sink, workflow.metadata.id, runId, node.id, iterationLogs);
              continue;
            }
            const failedNode = buildFailedNodeState(remoteNode, message);
            currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
            outputsByNode.set(node.id, toPortsOut2(failedNode));
            const durationMs3 = Number((performance.now() - startedAtMs).toFixed(2));
            nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, (/* @__PURE__ */ new Date()).toISOString(), durationMs3);
            emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
            const terminalLogs3 = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
            emitNodeLogs(sink, workflow.metadata.id, runId, node.id, terminalLogs3);
            options.onNodeFinish?.(failedNode);
            return { workflow: currentWorkflow, stopped: false, events };
          }
          const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
          nodeExecutionTimings[node.id] = createNodeExecutionTiming(remoteNode, remoteNode.status, startedAt, (/* @__PURE__ */ new Date()).toISOString(), durationMs2);
          const terminalLogs2 = remoteExecution.result.logs ?? [];
          emitNodeFinished(sink, workflow.metadata.id, runId, node.id, remoteNode.status, durationMs2, terminalLogs2);
          options.onNodeFinish?.(remoteNode);
          if (remoteNode.status === "stopped" /* Stopped */) {
            emitWorkflowStopped(sink, workflow.metadata.id, runId);
            return { workflow: currentWorkflow, stopped: true, events };
          }
          break;
        }
        const result = await handler({
          node: { ...runningNode, ports: { ...runningNode.ports, in: input } },
          workflow: currentWorkflow,
          settings: options.settings,
          input,
          signal: options.signal,
          hostContext: options.hostContext,
          invokeConnectedNode: async ({ nodeId: nodeId2, input: nextInput, overrides }) => executeConnectedNodeById(nodeId2, nextInput, overrides)
        });
        const status = resolveResultStatus(result);
        if (status === "failed" /* Failed */) {
          const message = resolveFailureMessageFromResult(result);
          const terminalAttemptLogs = [...result.logs ?? []];
          if (attemptNumber <= retryLimit) {
            const retryLog = buildRetryAttemptLog(attemptNumber, retryLimit, message);
            const iterationLogs = [...terminalAttemptLogs, retryLog];
            retryAttemptLogs.push(...iterationLogs);
            emitNodeLogs(sink, workflow.metadata.id, runId, node.id, iterationLogs);
            continue;
          }
          const failedNode = buildFailedNodeState(runningNode, message);
          currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
          outputsByNode.set(node.id, toPortsOut2(failedNode));
          nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, (/* @__PURE__ */ new Date()).toISOString(), Number((performance.now() - startedAtMs).toFixed(2)));
          emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
          const terminalLogs2 = terminalAttemptLogs.length > 0 ? terminalAttemptLogs : [message];
          emitNodeLogs(sink, workflow.metadata.id, runId, node.id, terminalLogs2);
          options.onNodeFinish?.(failedNode);
          return { workflow: currentWorkflow, stopped: false, events };
        }
        const normalizedResult = { ...result, status };
        const completedNode = buildCompletedNodeState(runningNode, input, normalizedResult);
        currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
        outputsByNode.set(node.id, toPortsOut2(completedNode));
        const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
        nodeExecutionTimings[node.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, (/* @__PURE__ */ new Date()).toISOString(), durationMs);
        const terminalLogs = result.logs ?? [];
        emitNodeFinished(sink, workflow.metadata.id, runId, node.id, completedNode.status, durationMs, terminalLogs);
        options.onNodeFinish?.(completedNode);
        if (completedNode.status === "stopped" /* Stopped */) {
          emitWorkflowStopped(sink, workflow.metadata.id, runId);
          return { workflow: currentWorkflow, stopped: true, events };
        }
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node execution failed.";
      const failedNode = buildFailedNodeState(runningNode, message);
      currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
      nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, (/* @__PURE__ */ new Date()).toISOString(), Number((performance.now() - startedAtMs).toFixed(2)));
      emitNodeFailed(sink, workflow.metadata.id, runId, node.id, message);
      emitNodeLogs(sink, workflow.metadata.id, runId, node.id, [message]);
      options.onNodeFinish?.(failedNode);
      return { workflow: currentWorkflow, stopped: false, events };
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
  emitNodeLogs,
  emitNodeStarted,
  emitWorkflowCompleted,
  emitWorkflowStopped,
  emitWorkflowValidationFailed,
  markRunningNodesAsStopped,
  replaceNodeById,
  shouldExecuteNodeInCurrentRun,
  sortWorkflowNodesTopologically
});
