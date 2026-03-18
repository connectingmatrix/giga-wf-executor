import { describe, expect, it } from 'vitest';
import { createNodeExecutorSignature, createWorkerNodeHandler } from '../executor/worker-runtime';
import { WorkflowDefinition, WorkflowNodeHandlerContext, WorkflowNodeStatusEnum } from '../types';

const textEncoder = new TextEncoder();

const toBase64 = (source: string): string => {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(source, 'utf8').toString('base64');
    }

    const bytes = textEncoder.encode(source);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
};

const createWorkflow = (modelId: string, source: string, signature?: string): WorkflowDefinition => ({
    metadata: {
        id: 'wf_worker_runtime',
        name: 'Worker Runtime Test'
    },
    nodes: [
        {
            id: 'node_1',
            gigaId: 'node_1',
            modelId,
            type: 'workflowStep',
            name: 'Node 1',
            description: '',
            kind: 'process',
            status: WorkflowNodeStatusEnum.Stopped,
            position: { x: 0, y: 0 },
            runtime: {
                flag: true
            },
            ports: {
                in: {},
                out: {}
            }
        }
    ],
    connections: [],
    NODE_EXECUTORS: {
        [modelId]: toBase64(source)
    },
    NODE_EXECUTOR_SIGNATURES: {
        [modelId]: signature ?? createNodeExecutorSignature(modelId, source)
    }
});

const createContext = (workflow: WorkflowDefinition): WorkflowNodeHandlerContext => ({
    node: workflow.nodes[0],
    workflow,
    settings: {
        graphqlUrl: 'http://localhost/graphql',
        authMode: 'none'
    },
    input: {}
});

describe('worker runtime compilation and loading', () => {
    it('forwards executeBackend descriptor and payload args with context metadata', async () => {
        const modelId = 'worker-execute-backend-args';
        const source = `
import { executeBackend } from '@workflow/execute';

export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async () => {
  return executeBackend(
    {
      service: 'services/workflow/nodes/node-handlers.ts',
      function: 'executeWorkerBackendArgsNode',
      description: 'Tests descriptor argument forwarding.'
    },
    { fromWorker: true, value: 42 }
  );
};`;

        const workflow = createWorkflow(modelId, source);
        const context = createContext(workflow);
        let receivedRequest: Record<string, unknown> | null = null;
        const handler = createWorkerNodeHandler({
            modelId,
            executeHelpers: {
                executeBackend: async (request) => {
                    receivedRequest = request as unknown as Record<string, unknown>;
                    return {
                        output: {
                            ok: true
                        },
                        status: WorkflowNodeStatusEnum.Passed,
                        logs: ['execute-backend-forwarded']
                    };
                }
            }
        });

        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect(result.logs).toContain('execute-backend-forwarded');
        expect(receivedRequest).toBeTruthy();
        expect((receivedRequest?.descriptor as Record<string, unknown>)?.service).toBe('services/workflow/nodes/node-handlers.ts');
        expect((receivedRequest?.descriptor as Record<string, unknown>)?.function).toBe('executeWorkerBackendArgsNode');
        expect((receivedRequest?.payload as Record<string, unknown>)?.fromWorker).toBe(true);
        expect(((receivedRequest?.context as Record<string, unknown>)?.node as Record<string, unknown>)?.id).toBe('node_1');
    });

    it('injects workflow graph metadata and runtime settings into worker payload', async () => {
        const modelId = 'worker-context-payload';
        const source = `
export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async (payload) => ({
  output: {
    workflowName: payload.workflow?.metadata?.name ?? null,
    nodeCount: Array.isArray(payload.workflow?.nodes) ? payload.workflow.nodes.length : 0,
    connectionCount: Array.isArray(payload.workflow?.connections) ? payload.workflow.connections.length : 0,
    graphqlUrl: payload.workflow?.metadata?.runtime?.settings?.graphqlUrl ?? null
  },
  status: 'passed',
  logs: ['worker-context']
});`;

        const workflow = createWorkflow(modelId, source);
        workflow.nodes.push({
            ...workflow.nodes[0],
            id: 'node_2',
            gigaId: 'node_2',
            name: 'Node 2'
        });
        workflow.connections = [
            {
                id: 'c1',
                name: 'node_1->node_2',
                from: 'node_1',
                to: 'node_2'
            }
        ];

        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({ modelId });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect((result.output as Record<string, unknown>).workflowName).toBe('Worker Runtime Test');
        expect((result.output as Record<string, unknown>).nodeCount).toBe(2);
        expect((result.output as Record<string, unknown>).connectionCount).toBe(1);
        expect((result.output as Record<string, unknown>).graphqlUrl).toBe('http://localhost/graphql');
        expect(result.logs).toContain('worker-context');
    });

    it('normalizes nested TypeScript module shapes and does not crash on missing ES2022 enum path', async () => {

        const modelId = 'nested-ts-shape';
        const source = `
export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async () => ({ output: { ok: true }, status: 'passed', logs: ['nested-ts'] });`;

        const transpileModule = (input: string) => ({
            outputText: input,
            diagnostics: []
        });

        const workflow = createWorkflow(modelId, source);
        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({
            modelId,
            typescriptModuleLoader: async () => ({
                default: {
                    default: {
                        transpileModule,
                        flattenDiagnosticMessageText: (message: unknown) => String(message),
                        DiagnosticCategory: { Error: 1 }
                    }
                }
            })
        });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect(result.logs).toContain('nested-ts');
    });

    it('compiles TypeScript worker source and executes with @workflow/executor imports', async () => {
        const modelId = 'worker-model';
        const source = `
import type { WorkerPayload, WorkerValidateResult } from '@workflow/executor';
import { toNode, toRecord, normalizeResult } from '@workflow/executor';

export const validate = async (payload: WorkerPayload): Promise<WorkerValidateResult> => {
  const node = toNode(payload);
  const hasId = String(node.id ?? '').trim().length > 0;
  return { ok: hasId, errors: hasId ? [] : ['NODE.id is required'], warnings: [] };
};

export const init = async (_payload: WorkerPayload) => true;

export const onUpdate = async (_payload: WorkerPayload) => ({ ok: true });

export const execute = async (payload: WorkerPayload) => {
  const node = toNode(payload);
  const properties = toRecord(node.PROPERTIES);
  return normalizeResult({
    output: {
      id: node.id,
      flag: properties.flag ?? null
    },
    status: 'passed',
    logs: ['compiled-worker']
  });
};`;

        const workflow = createWorkflow(modelId, source);
        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({ modelId });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect((result.output as Record<string, unknown>).id).toBe('node_1');
        expect(result.logs).toContain('compiled-worker');
    });

    it('stubs node built-in imports in browser runtime', async () => {
        const modelId = 'browser-node-builtins';
        const source = `
import fs from 'fs';

export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async () => ({
  output: { hasReadFileSync: typeof fs.readFileSync === 'function' },
  status: 'passed',
  logs: ['browser-stubbed']
});`;

        const workflow = createWorkflow(modelId, source);
        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({
            modelId,
            runtimeEnvironment: 'browser'
        });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect((result.output as Record<string, unknown>).hasReadFileSync).toBe(true);
        expect(result.logs).toContain('browser-stubbed');
    });

    it('keeps unresolved non-builtin imports as explicit runtime failures in browser mode', async () => {
        const modelId = 'browser-unresolved-import';
        const source = `
import unknownModule from 'not-a-real-runtime-module';

export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async () => ({
  output: { unknownModule },
  status: 'passed',
  logs: []
});`;

        const workflow = createWorkflow(modelId, source);
        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({
            modelId,
            runtimeEnvironment: 'browser'
        });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(String((result.output as Record<string, unknown>).error ?? '')).toContain('Unable to load worker module');
    });

    it('executes node built-in imports normally in node runtime', async () => {
        const modelId = 'node-builtins';
        const source = `
import fs from 'fs';

export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async () => ({
  output: { hasReadFileSync: typeof fs.readFileSync === 'function' },
  status: 'passed',
  logs: ['node-builtin']
});`;

        const workflow = createWorkflow(modelId, source);
        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({
            modelId,
            runtimeEnvironment: 'node'
        });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect((result.output as Record<string, unknown>).hasReadFileSync).toBe(true);
        expect(result.logs).toContain('node-builtin');
    });

    it('fails with explicit diagnostics when worker TypeScript compile fails', async () => {
        const modelId = 'compile-fail';
        const source = `
export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async () => {
  const broken: = 123;
  return { output: { ok: true }, status: 'passed', logs: [] };
};`;

        const workflow = createWorkflow(modelId, source);
        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({ modelId });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(String((result.output as Record<string, unknown>).error ?? '')).toContain('compile failed');
    });

    it('fails when worker has unresolved runtime imports', async () => {
        const modelId = 'resolve-fail';
        const source = `
import missingThing from 'not-a-real-runtime-module';

export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async () => ({ output: { missingThing }, status: 'passed', logs: [] });`;

        const workflow = createWorkflow(modelId, source);
        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({ modelId });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(String((result.output as Record<string, unknown>).error ?? '')).toContain('Unable to load worker module');
    });

    it('fails when worker signature does not match source', async () => {
        const modelId = 'signature-fail';
        const source = `
export const validate = async () => ({ ok: true, errors: [], warnings: [] });
export const init = async () => true;
export const onUpdate = async () => ({ ok: true });
export const execute = async () => ({ output: { ok: true }, status: 'passed', logs: [] });`;

        const workflow = createWorkflow(modelId, source, 'wf-sign-v1-invalid');
        const context = createContext(workflow);
        const handler = createWorkerNodeHandler({ modelId });
        const result = await handler(context);

        expect(result.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(String((result.output as Record<string, unknown>).error ?? '')).toContain('signature mismatch');
    });
});
