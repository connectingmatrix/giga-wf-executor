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

// src/node-core/index.ts
var node_core_exports = {};
__export(node_core_exports, {
  buildCompletedNodeState: () => buildCompletedNodeState,
  buildFailedNodeState: () => buildFailedNodeState,
  buildNodeInputContext: () => buildNodeInputContext,
  buildRunningNodeState: () => buildRunningNodeState,
  buildViewersForOutput: () => buildViewersForOutput,
  buildWorkflowSummaryInput: () => buildWorkflowSummaryInput,
  collectReachableNodeIdsFromStartNodes: () => collectReachableNodeIdsFromStartNodes,
  createNodeExecutionTiming: () => createNodeExecutionTiming,
  createRunId: () => createRunId,
  logNodeFailed: () => logNodeFailed,
  logNodeFinished: () => logNodeFinished,
  logNodeStarted: () => logNodeStarted,
  logWorkflowCompleted: () => logWorkflowCompleted,
  logWorkflowStopped: () => logWorkflowStopped,
  logWorkflowValidationFailed: () => logWorkflowValidationFailed,
  markRunningNodesAsStopped: () => markRunningNodesAsStopped,
  replaceNodeById: () => replaceNodeById,
  shouldExecuteNodeInCurrentRun: () => shouldExecuteNodeInCurrentRun,
  sortWorkflowNodesTopologically: () => sortWorkflowNodesTopologically
});
module.exports = __toCommonJS(node_core_exports);

// src/node-core/run-context.ts
var parseTargetInputPortName = (connection) => {
  const targetHandle = connection.targetHandle;
  if (!targetHandle) return "input";
  const [, parsedPort] = targetHandle.split(":");
  return parsedPort?.trim() ? parsedPort : "input";
};
var parseSourceOutputPortName = (connection) => {
  const sourceHandle = connection.sourceHandle;
  if (!sourceHandle) return "output";
  const [, parsedPort] = sourceHandle.split(":");
  return parsedPort?.trim() ? parsedPort : "output";
};
var parseActiveOutputPorts = (sourceOutput) => {
  if (!sourceOutput || typeof sourceOutput !== "object" || Array.isArray(sourceOutput)) return null;
  const activeOutputs = sourceOutput.__activeOutputs;
  if (!Array.isArray(activeOutputs)) return null;
  return activeOutputs.filter((item) => typeof item === "string" && item.trim().length > 0);
};
var parseActiveConnectionIds = (sourceOutput) => {
  if (!sourceOutput || typeof sourceOutput !== "object" || Array.isArray(sourceOutput)) return null;
  const activeConnectionIds = sourceOutput.__activeConnectionIds;
  if (!Array.isArray(activeConnectionIds)) return null;
  return activeConnectionIds.filter((item) => typeof item === "string" && item.trim().length > 0);
};
var isConnectionActiveForExecution = (connection, outputsByNodeId) => {
  const sourceOutput = outputsByNodeId.get(connection.from);
  if (typeof sourceOutput === "undefined") return false;
  const activeConnectionIds = parseActiveConnectionIds(sourceOutput);
  if (activeConnectionIds && activeConnectionIds.length > 0) return activeConnectionIds.includes(connection.id);
  const activeOutputPorts = parseActiveOutputPorts(sourceOutput);
  if (!activeOutputPorts || activeOutputPorts.length === 0) return true;
  const sourcePortName = parseSourceOutputPortName(connection);
  return activeOutputPorts.includes(sourcePortName);
};
var buildNodeInputContext = (workflow, nodeId, outputsByNodeId, fallbackInput) => {
  const incoming = workflow.connections.filter((connection) => connection.to === nodeId);
  if (!incoming.length) return fallbackInput;
  const nextInput = incoming.reduce((acc, connection) => {
    if (!isConnectionActiveForExecution(connection, outputsByNodeId)) return acc;
    const sourceOutput = outputsByNodeId.get(connection.from);
    if (typeof sourceOutput === "undefined") return acc;
    const inputPortName = parseTargetInputPortName(connection);
    if (!acc[inputPortName]) acc[inputPortName] = {};
    acc[inputPortName][connection.from] = sourceOutput;
    return acc;
  }, {});
  if (Object.keys(fallbackInput ?? {}).length > 0) nextInput.current = fallbackInput;
  return nextInput;
};
var shouldExecuteNodeInCurrentRun = (workflow, nodeId, outputsByNodeId) => {
  const incoming = workflow.connections.filter((connection) => connection.to === nodeId);
  if (incoming.length === 0) return true;
  return incoming.some((connection) => isConnectionActiveForExecution(connection, outputsByNodeId));
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
  if (ordered.length !== nodeIds.length) return nodeIds;
  return ordered;
};

// src/node-core/viewers.ts
var resolveViewerOutputValue = (output, type) => {
  if (type !== "table" /* Table */) return output;
  if (output && typeof output === "object" && Array.isArray(output.rows)) {
    return output.rows;
  }
  return [];
};
var buildViewersForOutput = (schema, existingViewers, output) => {
  if (schema.outputViewers?.length) {
    return schema.outputViewers.map((viewer) => ({
      ...viewer,
      value: resolveViewerOutputValue(output, viewer.type)
    }));
  }
  const currentViewers = existingViewers ?? [];
  const jsonViewer = currentViewers.find((item) => item.type === "json" /* Json */);
  if (jsonViewer) {
    return currentViewers.map((viewer) => viewer.id === jsonViewer.id ? { ...viewer, value: output } : viewer);
  }
  return [{ id: "json", label: "JSON", type: "json" /* Json */, value: output }];
};

// src/node-core/state.ts
var createNowIsoTimestamp = () => (/* @__PURE__ */ new Date()).toISOString();
var replaceNodeById = (workflow, nextNode) => ({
  ...workflow,
  nodes: workflow.nodes.map((item) => item.id === nextNode.id ? nextNode : item)
});
var buildRunningNodeState = (node, overrides) => {
  const properties = {
    ...node.properties ?? {},
    ...overrides?.properties ?? {},
    status: "running" /* Running */,
    timestamp: createNowIsoTimestamp()
  };
  return {
    ...node,
    ...overrides,
    status: "running" /* Running */,
    properties,
    inspector: node.inspector ? {
      ...node.inspector,
      ...overrides?.inspector ?? {},
      properties: { ...node.inspector.properties ?? {}, ...properties, status: "running" /* Running */ }
    } : node.inspector
  };
};
var buildCompletedNodeState = (node, schema, input, result) => {
  const status = result.status ?? "passed" /* Passed */;
  const properties = { ...node.properties ?? {}, status, timestamp: createNowIsoTimestamp() };
  return {
    ...node,
    input,
    output: result.output,
    status,
    properties,
    inspector: node.inspector ? {
      ...node.inspector,
      input,
      properties: { ...node.inspector.properties ?? {}, ...properties, status },
      viewers: buildViewersForOutput(schema, node.inspector.viewers, result.output)
    } : node.inspector
  };
};
var buildFailedNodeState = (node, message) => ({
  ...node,
  status: "failed" /* Failed */,
  output: { error: message },
  properties: { ...node.properties ?? {}, status: "failed" /* Failed */, timestamp: createNowIsoTimestamp() }
});
var markRunningNodesAsStopped = (workflow) => ({
  ...workflow,
  nodes: workflow.nodes.map((node) => node.status === "running" /* Running */ ? { ...node, status: "stopped" /* Stopped */ } : node)
});

// src/node-core/log.ts
var resolveLogLevelFromStatus = (status) => {
  if (status === "failed" /* Failed */) return "error" /* Error */;
  if (status === "warning" /* Warning */ || status === "stopped" /* Stopped */) return "warn" /* Warn */;
  return "info" /* Info */;
};
var createRunId = (prefix) => `${prefix}_${Date.now()}`;
var logNodeStarted = (logger, workflowId, runId, node) => {
  logger.push({ workflowId, runId, nodeId: node.id, event: "node.started", level: "info" /* Info */, message: `Running ${node.name}` });
};
var logNodeFinished = (logger, workflowId, runId, nodeId, result, durationMs) => {
  const status = result.status ?? "passed" /* Passed */;
  logger.push({ workflowId, runId, nodeId, event: "node.finished", level: resolveLogLevelFromStatus(status), data: { status, durationMs } });
  (result.logs ?? []).forEach((line) => {
    logger.push({ workflowId, runId, nodeId, event: "node.log", level: "info" /* Info */, message: line });
  });
};
var logNodeFailed = (logger, workflowId, runId, nodeId, message) => {
  logger.push({ workflowId, runId, nodeId, event: "node.failed", level: "error" /* Error */, message });
};
var logWorkflowStopped = (logger, workflowId, runId) => {
  logger.push({ workflowId, runId, event: "workflow.stopped", level: "warn" /* Warn */, message: "Workflow execution was stopped by user." });
};
var logWorkflowCompleted = (logger, workflowId, runId) => {
  logger.push({ workflowId, runId, event: "workflow.completed", level: "info" /* Info */ });
};
var logWorkflowValidationFailed = (logger, workflowId, runId, message) => {
  logger.push({ workflowId, runId, event: "workflow.validation_failed", level: "error" /* Error */, message });
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
var buildWorkflowSummaryInput = (runId, outputsByNode, timingsByNode, logs) => ({
  runId,
  outputsByNode: Object.fromEntries(outputsByNode.entries()),
  nodeExecutionTimings: timingsByNode,
  totalDurationMs: Object.values(timingsByNode).reduce((total, item) => total + item.durationMs, 0),
  logs
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildCompletedNodeState,
  buildFailedNodeState,
  buildNodeInputContext,
  buildRunningNodeState,
  buildViewersForOutput,
  buildWorkflowSummaryInput,
  collectReachableNodeIdsFromStartNodes,
  createNodeExecutionTiming,
  createRunId,
  logNodeFailed,
  logNodeFinished,
  logNodeStarted,
  logWorkflowCompleted,
  logWorkflowStopped,
  logWorkflowValidationFailed,
  markRunningNodesAsStopped,
  replaceNodeById,
  shouldExecuteNodeInCurrentRun,
  sortWorkflowNodesTopologically
});
