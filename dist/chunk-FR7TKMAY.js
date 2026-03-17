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

export {
  buildNodeInputContext,
  shouldExecuteNodeInCurrentRun,
  collectReachableNodeIdsFromStartNodes,
  sortWorkflowNodesTopologically,
  replaceNodeById,
  buildRunningNodeState,
  buildCompletedNodeState,
  buildFailedNodeState,
  markRunningNodesAsStopped,
  createRunId,
  emitNodeStarted,
  emitNodeLogs,
  emitNodeFinished,
  emitNodeFailed,
  emitWorkflowStopped,
  emitWorkflowCompleted,
  emitWorkflowValidationFailed,
  createNodeExecutionTiming,
  buildWorkflowSummaryInput
};
