# @workflow/executor

Shared workflow execution runtime used by both UI and backend hosts.

## What this package contains

- `createWorkflowExecutor({ mode, adapters })`
- `executeWorkflow(...)` and `executeNodeStep(...)` through returned executor
- Shared runtime types (`@workflow/executor/types`)
- Shared node-core utilities (`@workflow/executor/node-core`)
- JSONL logger helper

## Why this package exists

The workflow executor logic was duplicated across frontend and backend. This package centralizes:

- DAG traversal and start/end validation
- Branch-aware connection execution
- node state lifecycle (`running -> passed|failed|stopped`)
- step execution path
- JSONL logging utilities
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
- `resolveNodeSchema(modelId, nodeModels)` provides schema used for viewer/state shaping.
- Optional remote execution bridge is passed at runtime via `executeWorkflow` / `executeNodeStep` options.

## Execution API

```ts
const result = await executor.executeWorkflow(workflow, {
  settings,
  logger,
  hostContext, // optional runtime context for host-specific dependencies
  isNodeLocalCapable, // optional local/remote routing per node
  executeNodeRemotely, // optional remote execution fallback
  onNodeStart,
  onNodeFinish
});
```

```ts
const stepResult = await executor.executeNodeStep({
  workflow,
  nodeId,
  settings,
  logger,
  hostContext,
  overrides // properties/code/markdown overrides
});
```

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
