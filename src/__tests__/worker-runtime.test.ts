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
