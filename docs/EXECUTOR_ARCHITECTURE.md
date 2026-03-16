# Executor Architecture (Detailed)

This document is intentionally verbose. It is designed so AI agents and engineers can update the shared runtime with minimal ambiguity.

## Folder map

- `src/types/index.ts`
- `src/node-core/run-context.ts`
- `src/node-core/state.ts`
- `src/node-core/log.ts`
- `src/node-core/summary.ts`
- `src/node-core/viewers.ts`
- `src/executor/jsonl-logger.ts`
- `src/executor/workflow-runner.ts`
- `src/executor/step-runner.ts`
- `src/executor/create-workflow-executor.ts`
- `src/index.ts`

## File-by-file and function-by-function

### `src/types/index.ts`

Purpose: Defines the canonical execution contracts shared by frontend and backend.

Key groups:

- Enums for node status, viewer type, log level, executor mode.
- Core graph types: `WorkflowDefinition`, `WorkflowNodeModel`, `WorkflowConnectionModel`.
  - `WorkflowDefinition` no longer requires `nodeModels`.
  - `WorkflowNodeModel` uses `runtime` (flat key/value) and `ports.in`/`ports.out`.
- Runtime types: `WorkflowRuntimeSettings`, `WorkflowRunLogEvent`.
- Handler contracts:
  - `WorkflowNodeHandlerContext`
  - `WorkflowNodeHandlerResult`
  - `WorkflowNodeHandler`
- Executor contracts:
  - `WorkflowExecutorAdapters`
  - `ExecuteWorkflowOptions`
  - `ExecuteNodeStepOptions`
  - `WorkflowExecutorResult`
  - `WorkflowStepExecutorResult`
  - `WorkflowExecutor`

### `src/node-core/run-context.ts`

Purpose: Branch-aware graph traversal and input-context resolution.

Functions:

- `buildNodeInputContext(...)`
  - Collects incoming edges to target node.
  - Reads upstream `ports.out` values.
  - Groups values by target input port.

- `shouldExecuteNodeInCurrentRun(...)`
  - Checks whether at least one inbound connection is active.
  - Supports branch activation via `__activeOutputs` and `__activeConnectionIds`.

- `collectReachableNodeIdsFromStartNodes(...)`
  - BFS from start nodes to limit runtime to reachable graph.

- `sortWorkflowNodesTopologically(...)`
  - Kahn algorithm over connections.
  - Falls back to declaration order on cyclic graphs.

### `src/node-core/state.ts`

Purpose: Pure immutable state transitions for node lifecycle.

Functions:

- `replaceNodeById(...)`
  - Replaces one node while preserving others.

- `buildRunningNodeState(...)`
  - Sets status to `running`.
  - Writes `runtime.status` and `runtime.timestamp`.

- `buildCompletedNodeState(...)`
  - Writes `ports.in`, `ports.out`, final status and runtime timestamp.

- `buildFailedNodeState(...)`
  - Writes failed status and error output.

- `markRunningNodesAsStopped(...)`
  - Converts in-flight nodes to `stopped` on abort.

### `src/node-core/log.ts`

Purpose: Standardized lifecycle event logging.

Functions:

- `createRunId(prefix)`
- `emitNodeStarted(...)`
- `emitNodeFinished(...)`
- `emitNodeFailed(...)`
- `emitWorkflowStopped(...)`
- `emitWorkflowCompleted(...)`
- `emitWorkflowValidationFailed(...)`

Conventions:

- Node status controls log level.
- Node handler logs are emitted as `node.log` events.

### `src/node-core/summary.ts`

Purpose: Execution-time metrics and end-node summary payload.

Functions:

- `createNodeExecutionTiming(...)`
- `buildWorkflowSummaryInput(...)`

Summary payload includes:

- `runId`
- `outputsByNode`
- `nodeExecutionTimings`
- `totalDurationMs`
- `logs`

### `src/node-core/viewers.ts`

Purpose: Build output viewer payload values after node completion.

Function:

- `buildViewersForOutput(...)`
  - Uses schema-defined viewers when present.
  - Defaults to JSON viewer otherwise.
  - Special handling for table viewer (`rows`).

### `src/executor/jsonl-logger.ts`

Purpose: Runtime logger implementation used by hosts.

Function:

- `createJsonlLogger(onPush?)`
  - Captures `entries`.
  - Adds timestamp on push.
  - Optional callback for stream/event bus.
  - `toJsonl()` helper for persistence/debug export.

### `src/executor/workflow-runner.ts`

Purpose: Full DAG run execution.

Entry:

- `executeWorkflowWithContext(runtime, workflow, options)`

Major stages:

1. Validate Start + Respond/End presence.
2. Build reachable node set and topological order.
3. Execute nodes in DAG order.
4. Handle local-or-remote execution policy per node.
5. Support nested connected-node invocation for orchestration nodes.
6. Emit lifecycle events and timing metrics via `onEvent`.
7. Inject workflow summary into end node input.
8. Abort handling with `stopped` transition.

### `src/executor/step-runner.ts`

Purpose: Single-node execution path with optional nested invocation.

Entry:

- `executeNodeStepWithContext(runtime, options)`

Major stages:

1. Resolve target node and apply overrides.
2. Transition target to running state.
3. Build input context from upstream outputs.
4. Execute local or remote.
5. Persist status/output and lifecycle events.

### `src/executor/create-workflow-executor.ts`

Purpose: Runtime composition root.

Function:

- `createWorkflowExecutor({ mode, adapters })`

Returns:

- `executeWorkflow(...)`
- `executeNodeStep(...)`
- `mode`

`mode` describes host runtime intent (`local` UI or `server` backend), while per-node local/remote routing remains controlled by runtime options/adapters.

## Update protocol (for AI agents)

When updating node runtime behavior:

1. Update shared contracts in `src/types/index.ts` first.
2. Update node-core functions if execution semantics changed.
3. Update both runner paths (`workflow-runner`, `step-runner`) for parity.
4. Add/adjust tests in `src/__tests__`.
5. Run `yarn typecheck && yarn test && yarn build`.
6. Update frontend/backend consumer adapters if contract changed.
