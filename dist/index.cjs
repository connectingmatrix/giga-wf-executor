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
  WorkflowViewerTypeEnum: () => WorkflowViewerTypeEnum,
  buildCompletedNodeState: () => buildCompletedNodeState,
  buildFailedNodeState: () => buildFailedNodeState,
  buildNodeInputContext: () => buildNodeInputContext,
  buildRunningNodeState: () => buildRunningNodeState,
  buildViewersForOutput: () => buildViewersForOutput,
  buildWorkflowSummaryInput: () => buildWorkflowSummaryInput,
  collectReachableNodeIdsFromStartNodes: () => collectReachableNodeIdsFromStartNodes,
  createJsonlLogger: () => createJsonlLogger,
  createNodeExecutionTiming: () => createNodeExecutionTiming,
  createRunId: () => createRunId,
  createWorkflowExecutor: () => createWorkflowExecutor,
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
var WorkflowViewerTypeEnum = /* @__PURE__ */ ((WorkflowViewerTypeEnum2) => {
  WorkflowViewerTypeEnum2["Json"] = "json";
  WorkflowViewerTypeEnum2["Markdown"] = "markdown";
  WorkflowViewerTypeEnum2["Raw"] = "raw";
  WorkflowViewerTypeEnum2["Table"] = "table";
  return WorkflowViewerTypeEnum2;
})(WorkflowViewerTypeEnum || {});
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
var executeNodeStepWithContext = async (runtime, options) => {
  const runId = createRunId("step");
  let workingWorkflow = { ...options.workflow };
  const outputsByNode = new Map(workingWorkflow.nodes.map((item) => [item.id, item.output]));
  const executionStack = /* @__PURE__ */ new Set();
  const executeNodeById = async (targetNodeId, overrideInput, nestedOverrides) => {
    if (executionStack.has(targetNodeId)) throw new Error(`Circular node invocation detected for "${targetNodeId}".`);
    const node = workingWorkflow.nodes.find((item) => item.id === targetNodeId);
    if (!node) throw new Error(`Node "${targetNodeId}" not found for step execution.`);
    if (node.properties?.enabled === false) {
      const disabledNode = { ...node, status: "stopped" /* Stopped */, properties: { ...node.properties ?? {}, status: "stopped" /* Stopped */ } };
      workingWorkflow = replaceNodeById(workingWorkflow, disabledNode);
      return { node: disabledNode, result: { output: node.output ?? null, status: "stopped" /* Stopped */, logs: ["Node is disabled."] } };
    }
    executionStack.add(targetNodeId);
    const schema = runtime.adapters.resolveNodeSchema(node.modelId, workingWorkflow.nodeModels);
    const handler = runtime.adapters.getNodeHandler(node.modelId);
    const runtimeOverrides = targetNodeId === options.nodeId ? options.overrides : nestedOverrides;
    const runningNode = buildRunningNodeState(node, {
      properties: { ...node.properties ?? {}, ...runtimeOverrides?.properties ?? {} },
      inspector: node.inspector ? { ...node.inspector, code: runtimeOverrides?.code ?? node.inspector.code, markdown: runtimeOverrides?.markdown ?? node.inspector.markdown } : node.inspector
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
        const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
        logNodeFinished(options.logger, options.workflow.metadata.id, runId, runningNode.id, remoteExecution.result, durationMs2);
        return { node: remoteExecution.node, result: remoteExecution.result };
      }
      if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);
      const result = await handler({
        node: { ...runningNode, input },
        workflow: workingWorkflow,
        settings: options.settings,
        input,
        signal: options.signal,
        hostContext: options.hostContext,
        invokeConnectedNode: async ({ nodeId, input: connectedInput, overrides }) => executeNodeById(nodeId, connectedInput, overrides)
      });
      const completedNode = buildCompletedNodeState(runningNode, schema, input, result);
      workingWorkflow = replaceNodeById(workingWorkflow, completedNode);
      outputsByNode.set(runningNode.id, result.output ?? null);
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      logNodeFinished(options.logger, options.workflow.metadata.id, runId, targetNodeId, result, durationMs);
      return { node: completedNode, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step execution failed.";
      const failedNode = buildFailedNodeState(runningNode, message);
      workingWorkflow = replaceNodeById(workingWorkflow, failedNode);
      outputsByNode.set(runningNode.id, failedNode.output);
      logNodeFailed(options.logger, options.workflow.metadata.id, runId, targetNodeId, message);
      return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: [message] } };
    } finally {
      executionStack.delete(targetNodeId);
    }
  };
  const outcome = await executeNodeById(options.nodeId);
  return { workflow: workingWorkflow, node: outcome.node, result: outcome.result };
};

// src/executor/workflow-runner.ts
var START_MODEL_ID = "start";
var END_MODEL_ID = "respond-end";
var executeWorkflowWithContext = async (runtime, workflow, options) => {
  const runId = createRunId("run");
  let currentWorkflow = { ...workflow };
  const startNodeIds = currentWorkflow.nodes.filter((node) => node.modelId === START_MODEL_ID).map((node) => node.id);
  const hasEndNode = currentWorkflow.nodes.some((node) => node.modelId === END_MODEL_ID);
  if (startNodeIds.length === 0 || !hasEndNode) {
    const missing = [startNodeIds.length === 0 ? "Start node" : null, !hasEndNode ? "Respond/End node" : null].filter((item) => Boolean(item));
    logWorkflowValidationFailed(options.logger, workflow.metadata.id, runId, `Workflow execution requires ${missing.join(" and ")}.`);
    return { workflow: currentWorkflow, logs: [...workflow.metadata.runtime?.sessionLogs ?? [], ...options.logger.entries], stopped: false };
  }
  const reachableNodeIds = collectReachableNodeIdsFromStartNodes(currentWorkflow, startNodeIds);
  const orderedIds = sortWorkflowNodesTopologically(currentWorkflow).filter((nodeId) => reachableNodeIds.has(nodeId));
  const outputsByNode = /* @__PURE__ */ new Map();
  const nodeExecutionTimings = {};
  const invocationStack = /* @__PURE__ */ new Set();
  const executeConnectedNodeById = async (connectedNodeId, overrideInput, overrides) => {
    if (invocationStack.has(connectedNodeId)) throw new Error(`Circular invocation detected for node "${connectedNodeId}".`);
    const connectedNode = currentWorkflow.nodes.find((item) => item.id === connectedNodeId);
    if (!connectedNode) throw new Error(`Connected node "${connectedNodeId}" was not found.`);
    if (connectedNode.properties?.enabled === false) {
      const disabledNode = { ...connectedNode, status: "stopped" /* Stopped */, properties: { ...connectedNode.properties ?? {}, status: "stopped" /* Stopped */ } };
      currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
      return { node: disabledNode, result: { output: connectedNode.output ?? null, status: "stopped" /* Stopped */, logs: ["Node is disabled."] } };
    }
    invocationStack.add(connectedNodeId);
    const runningNode = buildRunningNodeState(connectedNode, {
      properties: { ...connectedNode.properties ?? {}, ...overrides?.properties ?? {} },
      inspector: connectedNode.inspector ? { ...connectedNode.inspector, code: overrides?.code ?? connectedNode.inspector.code, markdown: overrides?.markdown ?? connectedNode.inspector.markdown } : connectedNode.inspector
    });
    currentWorkflow = replaceNodeById(currentWorkflow, runningNode);
    options.onNodeStart?.(runningNode.id);
    logNodeStarted(options.logger, workflow.metadata.id, runId, runningNode);
    const schema = runtime.adapters.resolveNodeSchema(runningNode.modelId, currentWorkflow.nodeModels);
    const handler = runtime.adapters.getNodeHandler(runningNode.modelId);
    const input = overrideInput ?? buildNodeInputContext(currentWorkflow, runningNode.id, outputsByNode, runningNode.input ?? {});
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const startedAtMs = performance.now();
    try {
      const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
      if (!canRunLocally && options.executeNodeRemotely) {
        const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, overrides, hostContext: options.hostContext });
        currentWorkflow = remoteExecution.workflow;
        outputsByNode.set(remoteExecution.node.id, remoteExecution.result.output ?? null);
        const finishedAt2 = (/* @__PURE__ */ new Date()).toISOString();
        const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
        nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(remoteExecution.node, remoteExecution.node.status, startedAt, finishedAt2, durationMs2);
        logNodeFinished(options.logger, workflow.metadata.id, runId, runningNode.id, remoteExecution.result, durationMs2);
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
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, finishedAt, durationMs);
      logNodeFinished(options.logger, workflow.metadata.id, runId, runningNode.id, result, durationMs);
      options.onNodeFinish?.(completedNode);
      return { node: completedNode, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node execution failed.";
      const failedNode = buildFailedNodeState(runningNode, message);
      currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
      outputsByNode.set(failedNode.id, failedNode.output);
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      nodeExecutionTimings[runningNode.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, finishedAt, durationMs);
      logNodeFailed(options.logger, workflow.metadata.id, runId, runningNode.id, message);
      options.onNodeFinish?.(failedNode);
      return { node: failedNode, result: { output: { error: message }, status: "failed" /* Failed */, logs: [message] } };
    } finally {
      invocationStack.delete(connectedNodeId);
    }
  };
  for (const nodeId of orderedIds) {
    if (options.signal?.aborted) {
      currentWorkflow = markRunningNodesAsStopped(currentWorkflow);
      logWorkflowStopped(options.logger, workflow.metadata.id, runId);
      return { workflow: currentWorkflow, logs: [...workflow.metadata.runtime?.sessionLogs ?? [], ...options.logger.entries], stopped: true };
    }
    const node = currentWorkflow.nodes.find((item) => item.id === nodeId);
    if (!node) continue;
    if (!shouldExecuteNodeInCurrentRun(currentWorkflow, node.id, outputsByNode)) continue;
    if (node.properties?.enabled === false) {
      const disabledNode = { ...node, status: "stopped" /* Stopped */, properties: { ...node.properties ?? {}, status: "stopped" /* Stopped */ } };
      currentWorkflow = replaceNodeById(currentWorkflow, disabledNode);
      outputsByNode.set(node.id, node.output ?? null);
      options.onNodeFinish?.(disabledNode);
      continue;
    }
    if (outputsByNode.has(node.id)) continue;
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
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const startedAtMs = performance.now();
    try {
      const canRunLocally = options.isNodeLocalCapable ? options.isNodeLocalCapable(runningNode.modelId) : true;
      if (!canRunLocally && options.executeNodeRemotely) {
        const remoteExecution = await options.executeNodeRemotely({ workflow: currentWorkflow, nodeId: runningNode.id, settings: options.settings, hostContext: options.hostContext });
        const finishedAt2 = (/* @__PURE__ */ new Date()).toISOString();
        const durationMs2 = Number((performance.now() - startedAtMs).toFixed(2));
        currentWorkflow = remoteExecution.workflow;
        outputsByNode.set(node.id, remoteExecution.result.output ?? null);
        nodeExecutionTimings[node.id] = createNodeExecutionTiming(remoteExecution.node, remoteExecution.node.status, startedAt, finishedAt2, durationMs2);
        logNodeFinished(options.logger, workflow.metadata.id, runId, node.id, remoteExecution.result, durationMs2);
        options.onNodeFinish?.(remoteExecution.node);
        continue;
      }
      if (!canRunLocally && !options.executeNodeRemotely) throw new Error(`Node model "${runningNode.modelId}" requires server execution in "${runtime.mode}" mode.`);
      const result = await handler({
        node: { ...runningNode, input },
        workflow: currentWorkflow,
        settings: options.settings,
        input,
        signal: options.signal,
        hostContext: options.hostContext,
        invokeConnectedNode: async ({ nodeId: nodeId2, input: nextInput, overrides }) => executeConnectedNodeById(nodeId2, nextInput, overrides)
      });
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      const completedNode = buildCompletedNodeState(runningNode, schema, input, result);
      currentWorkflow = replaceNodeById(currentWorkflow, completedNode);
      outputsByNode.set(node.id, result.output ?? null);
      nodeExecutionTimings[node.id] = createNodeExecutionTiming(completedNode, completedNode.status, startedAt, finishedAt, durationMs);
      logNodeFinished(options.logger, workflow.metadata.id, runId, node.id, result, durationMs);
      options.onNodeFinish?.(completedNode);
      if (completedNode.status === "stopped" /* Stopped */) {
        logWorkflowStopped(options.logger, workflow.metadata.id, runId);
        return { workflow: currentWorkflow, logs: [...workflow.metadata.runtime?.sessionLogs ?? [], ...options.logger.entries], stopped: true };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node execution failed.";
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs = Number((performance.now() - startedAtMs).toFixed(2));
      const failedNode = buildFailedNodeState(runningNode, message);
      currentWorkflow = replaceNodeById(currentWorkflow, failedNode);
      nodeExecutionTimings[node.id] = createNodeExecutionTiming(failedNode, "failed" /* Failed */, startedAt, finishedAt, durationMs);
      logNodeFailed(options.logger, workflow.metadata.id, runId, node.id, message);
      options.onNodeFinish?.(failedNode);
    }
  }
  logWorkflowCompleted(options.logger, workflow.metadata.id, runId);
  return { workflow: currentWorkflow, logs: [...workflow.metadata.runtime?.sessionLogs ?? [], ...options.logger.entries], stopped: false };
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
  WorkflowViewerTypeEnum,
  buildCompletedNodeState,
  buildFailedNodeState,
  buildNodeInputContext,
  buildRunningNodeState,
  buildViewersForOutput,
  buildWorkflowSummaryInput,
  collectReachableNodeIdsFromStartNodes,
  createJsonlLogger,
  createNodeExecutionTiming,
  createRunId,
  createWorkflowExecutor,
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
