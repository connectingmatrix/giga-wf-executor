import {
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
} from "./chunk-IHHZFKC3.js";
import {
  WorkflowExecutorModeEnum,
  WorkflowLogLevelEnum,
  WorkflowNodeKindEnum,
  WorkflowNodeStatusEnum,
  WorkflowViewerTypeEnum
} from "./chunk-UUTIIAQA.js";

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
export {
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
};
