# @workflow/executor

Shared workflow execution runtime used by both UI and backend hosts.

## What this package contains

- `createWorkflowExecutor({ mode, adapters })`
- `executeWorkflow(...)` and `executeNodeStep(...)` through returned executor
- Shared runtime types (`@workflow/executor/types`)
- Shared node-core utilities (`@workflow/executor/node-core`)
- JSONL logger helper (optional host utility, not required by executor API)

## Why this package exists

The workflow executor logic was duplicated across frontend and backend. This package centralizes:

- DAG traversal and start/end validation
- Branch-aware connection execution
- node state lifecycle (`running -> passed|failed|stopped`)
- step execution path
- event callbacks for out-of-band logging
- runtime summary generation for `Respond/End` nodes

Node implementations remain host-owned and are injected by adapters.

## Mode and adapters

```ts
import { createWorkflowExecutor, WorkflowExecutorModeEnum } from '@workflow/executor';

const executor = createWorkflowExecutor({
  mode: WorkflowExecutorModeEnum.Local,
  adapters: {
    getNodeHandler: (modelId) => myNodeHandlerRegistry[modelId ?? 'default'],
    resolveNodeSchema: (modelId, nodeModels) => nodeModels[modelId ?? 'unknown']
  }
});
```

Adapter contract:

- `getNodeHandler(modelId)` provides node-specific execution.
- Optional remote execution bridge is passed at runtime via `executeWorkflow` / `executeNodeStep` options.

## Execution API

```ts
const result = await executor.executeWorkflow(workflow, {
  settings,
  hostContext, // optional runtime context for host-specific dependencies
  isNodeLocalCapable, // optional local/remote routing per node
  executeNodeRemotely, // optional remote execution fallback
  onNodeStart,
  onNodeFinish,
  onEvent // optional out-of-band lifecycle event sink
});
```

```ts
const stepResult = await executor.executeNodeStep({
  workflow,
  nodeId,
  settings,
  hostContext,
  overrides, // runtime/property/code/markdown overrides
  onEvent
});
```

## Failure Mitigation Runtime Fields

Node runtime supports built-in failure mitigation in shared executor:

- `failureMitigation`:
  - `stop-workflow` (default): fail immediately on node failure.
  - `retry-node`: retry the same node before terminal failure.
- `retryCount`:
  - used only with `retry-node`.
  - clamped to `1..6`.

Behavior:

- Applies to both `executeWorkflow(...)` and `executeNodeStep(...)`.
- Retries trigger on thrown handler errors and explicit failed results (`status: "failed"`).
- Retry attempt lines are emitted as `node.log` events during execution.
- Final returned node result logs include aggregated retry-attempt logs plus terminal attempt logs.

## Variable Resolution Runtime Fields

Shared executor now resolves template tokens in node runtime values before handler execution.

Supported token syntax:

- `{{input.node_id.output.key}}`

Behavior:

- Resolution runs in both `executeWorkflow(...)` and `executeNodeStep(...)`.
- Resolution context includes:
  - upstream input map (port and source-node aliases),
  - node runtime/properties map,
  - workflow metadata.
- If any token cannot be resolved, node fails before handler call with:
  - `output.error` message,
  - `output.variableFailures` detail array,
  - failed lifecycle events/log lines.
- Schema permission enforcement:
  - when `workflow.nodeModels[modelId].fields[field].allowVariables` exists, it is enforced.
  - disallowed token usage fails node before handler call.
  - if schema is missing, fallback is allow.
- Runtime resolution is execution-only; it does not overwrite canonical stored node configuration.

## Local development

```bash
yarn install
yarn typecheck
yarn test
yarn build
```

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

Checks:

- install
- typecheck
- test
- build

## Detailed documentation

See [`docs/EXECUTOR_ARCHITECTURE.md`](./docs/EXECUTOR_ARCHITECTURE.md) for file-level and function-level explanations.
