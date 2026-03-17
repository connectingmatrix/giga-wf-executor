# @workflow/executor

Shared workflow execution runtime used by both UI and backend hosts.

## What this package contains

- `createWorkflowExecutor({ mode, adapters })`
- `executeWorkflow(...)` and `executeNodeStep(...)` through returned executor
- `createWorkerNodeHandler(...)` and `createNodeExecutorSignature(...)` for signed worker-first execution
- Worker helper utilities exported at root: `toRecord`, `toErrorResult`, `toNode`, `normalizeResult`
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

Worker-first runtime is also supported through signed worker source payloads:
- `workflow.NODE_EXECUTORS[modelId] = base64(worker.ts source)`
- `workflow.NODE_EXECUTOR_SIGNATURES[modelId] = signature`
- host adapters can use `createWorkerNodeHandler(...)` to execute workers directly.

## Worker-first contract

Node workers are authored in node folders as `worker.ts` and are loaded from workflow payload.

Required exports:
- `validate(payload)`
- `init(payload)`
- `onUpdate(payload)`
- `execute(payload)`

Runtime behavior:
- Worker source is decoded from `NODE_EXECUTORS`.
- Raw source signature is verified before compilation.
- Source is transpiled from TypeScript to ESM JavaScript inside executor runtime.
- Signature is verified using `NODE_EXECUTOR_SIGNATURES`.
- Missing or invalid signatures fail execution immediately.
- Compile diagnostics are normalized into structured failed node outputs/logs.
- Compiled source is cached by `(modelId, signature)` for run/step reuse.
- `@workflow/execute` imports are supported in both forms:
  - `import { executeBackend, updateNode } from '@workflow/execute'`
  - `const m = await import('@workflow/execute')`
- `@workflow/executor` helper imports are supported for worker-authored utility access at runtime.
- Virtual helper modules expose:
  - `executeBackend(NODELikePayload)`
  - `updateNode(...)`
  - `toRecord`, `toErrorResult`, `toNode`, `normalizeResult`

## Mode and adapters

```ts
import { createWorkflowExecutor, WorkflowExecutorModeEnum } from '@workflow/executor';

const executor = createWorkflowExecutor({
  mode: WorkflowExecutorModeEnum.Local,
  adapters: {
    getNodeHandler: (modelId) => myNodeHandlerRegistry[modelId ?? 'default']
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

## Port Compatibility Validation

Shared executor validates connection compatibility before run and step execution when `workflow.nodeModels` metadata is present.

Supported input-port schema keys:

- `portType`
- `acceptedSourceGroups`
- `acceptedSourceModelIds`
- `allowMultipleArrows`

Behavior:

- Validation is schema-driven and backward-compatible:
  - if `nodeModels` is missing, execution remains permissive.
  - if a source/target model schema is missing, that edge is treated permissively.
- When both source and target schemas are present, the executor enforces:
  - declared source/target port existence,
  - accepted source model/group constraints,
  - source/target multiplicity rules.
- On violation, execution fails early with `workflow.validation_failed` (run path) or failed step output (step path).

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
