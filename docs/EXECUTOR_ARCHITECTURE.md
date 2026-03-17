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
- `src/executor/failure-mitigation.ts`
- `src/executor/variables.ts`
- `src/executor/port-compatibility.ts`
- `src/executor/worker-runtime.ts`
- `src/executor/workflow-runner.ts`
- `src/executor/step-runner.ts`
- `src/executor/create-workflow-executor.ts`
- `src/index.ts`

## File-by-file and function-by-function

### `src/types/index.ts`

Purpose: Defines the canonical execution contracts shared by frontend and backend.

Key groups:

- Enums for node status, viewer type, log level, executor mode.
- Worker helper types for node-authored workers: `WorkerPayload`, `WorkerNodeFacade`, `WorkerSelfState`, `WorkerScope`, `WorkerValidateResult`, `WorkerUpdateResult`, `WorkerExecuteResult`.
- Core graph types: `WorkflowDefinition`, `WorkflowNodeModel`, `WorkflowConnectionModel`.
  - `WorkflowDefinition` supports optional `nodeModels` for schema-aware runtime behavior (for example variable permission checks).
  - `WorkflowDefinition` also supports optional worker payload roots:
    - `NODE_EXECUTORS` (`modelId -> base64 worker source`)
    - `NODE_EXECUTOR_SIGNATURES` (`modelId -> signature`)
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
2. Validate schema-aware connection compatibility (when `nodeModels` metadata exists).
3. Build reachable node set and topological order.
4. Execute nodes in DAG order.
5. Handle local-or-remote execution policy per node.
6. Support nested connected-node invocation for orchestration nodes.
7. Emit lifecycle events and timing metrics via `onEvent`.
8. Inject workflow summary into end node input.
9. Abort handling with `stopped` transition.
10. Failure mitigation at shared-runner layer:
   - `failureMitigation=retry-node` retries failed attempts (`retryCount` clamped `1..6`).
   - `failureMitigation=stop-workflow` fails immediately.
   - Retry-attempt logs stream as `node.log` during run.
   - Workflow run exits without `workflow.completed` when terminal node failure occurs.
11. Variable resolution layer:
   - resolves runtime token values (for example {{input.node_id.output.key}}) before handler execution.
   - unresolved or disallowed tokens fail node before handler invocation.
   - disallowed enforcement reads optional schema flag workflow.nodeModels[modelId].fields[field].allowVariables.
   - resolved values are execution-local and do not rewrite canonical persisted runtime config.

### `src/executor/step-runner.ts`

Purpose: Single-node execution path with optional nested invocation.

Entry:

- `executeNodeStepWithContext(runtime, options)`

Major stages:

1. Resolve target node and apply overrides.
2. Validate schema-aware connection compatibility (when `nodeModels` metadata exists).
3. Transition target to running state.
4. Build input context from upstream outputs.
5. Execute local or remote.
6. Persist status/output and lifecycle events.
7. Apply the same failure mitigation contract as DAG runs:
   - retries on thrown errors or failed statuses,
   - aggregate retry logs into returned step result logs.
8. Apply the same variable resolution contract as DAG runs:
   - resolve runtime template tokens before node handler invocation,
   - fail node immediately for unresolved/disallowed tokens with structured error output.

### `src/executor/port-compatibility.ts`

Purpose: Shared schema-driven graph compatibility validation used by both run and step paths.

Function:

- `validateWorkflowConnectionCompatibility(workflow)`
  - Checks connection source/target existence.
  - Applies compatibility enforcement only when schema metadata is available.
  - Enforces target constraints (`acceptedSourceGroups`, `acceptedSourceModelIds`) and multiplicity (`allowMultipleArrows`) for declared ports.
  - Returns deterministic violation messages for host-level failure reporting.

### `src/executor/failure-mitigation.ts`

Purpose: Canonical runtime parsing and mitigation helpers shared by both runner paths.

Functions:

- `parseFailureMitigationMode(...)`
- `parseFailureRetryCount(...)`
- `resolveFailureRetryLimit(...)`
- `resolveResultStatus(...)`
- `resolveFailureMessageFromResult(...)`
- `buildRetryAttemptLog(...)`

### `src/executor/variables.ts`

Purpose: Shared runtime template-variable resolution and schema permission enforcement.

Functions:

- `resolveNodeRuntimeVariables(...)`
  - resolves {{...}} tokens against execution context.
  - validates unresolved tokens.
  - validates disallowed usage via schema allowVariables flags when schema exists.
- `formatVariableFailureMessage(...)`
  - builds deterministic failure message for logs and node error output.

### `src/executor/worker-runtime.ts`

Purpose: Signed worker-module loading and execution bridge.

Functions:

- `createNodeExecutorSignature(modelId, source)`
  - creates deterministic signature string used by hosts and runtime validation.

- `createWorkerNodeHandler({ modelId, executeHelpers })`
  - decodes worker source from `workflow.NODE_EXECUTORS[modelId]`.
  - validates signature from `workflow.NODE_EXECUTOR_SIGNATURES[modelId]`.
  - rewrites `@workflow/execute` imports to runtime virtual helper module.
  - caches compiled sources by `(modelId, signature)` and loads worker module from `data:` URL.
  - enforces required exports (`validate/init/onUpdate/execute`).
  - executes worker contract and normalizes output/status/logs.
  - applies bounded `onUpdate` reentry protection (`6`).

Worker payload contract exposed by runtime:
- `workflow`
- `NODE_SCOPE`
- `NODE` (node snapshot, `PORTS`, `PROPERTIES`, `OUTPUT`)
- `self` (`status`, `PORTS`, `OUTPUT`)

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
