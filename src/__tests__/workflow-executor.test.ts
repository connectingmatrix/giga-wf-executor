import { describe, expect, it } from 'vitest';
import { createWorkflowExecutor } from '../executor/create-workflow-executor';
import { WorkflowExecutorModeEnum, WorkflowNodeStatusEnum } from '../types';
import { createAdapters, createConnection, createEndNode, createIfElseNode, createMetadataNode, createStartNode, createWorkflow } from './fixtures';

describe('shared workflow executor', () => {
    it('returns validation error when start/end nodes are missing', async () => {
        const workflow = createWorkflow();
        workflow.nodes = [createEndNode(1)];
        const executor = createWorkflowExecutor({ mode: WorkflowExecutorModeEnum.Local, adapters: createAdapters({}) });
        const result = await executor.executeWorkflow(workflow, { settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        expect(result.stopped).toBe(false);
        expect(result.events.some((item) => item.event === 'workflow.validation_failed')).toBe(true);
    });

    it('executes true branch and sends summary to end node', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const ifElse = createIfElseNode(2);
        const trueNode = createMetadataNode(3, 'True Node');
        const falseNode = createMetadataNode(4, 'False Node');
        const end = createEndNode(5);
        workflow.nodes = [start, ifElse, trueNode, falseNode, end];
        workflow.connections = [
            createConnection('c1', start.id, ifElse.id),
            createConnection('c2', ifElse.id, trueNode.id, 'out:true'),
            createConnection('c3', ifElse.id, falseNode.id, 'out:false'),
            createConnection('c4', trueNode.id, end.id),
            createConnection('c5', falseNode.id, end.id)
        ];

        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                start: async () => ({ output: { started: true, __activeOutputs: ['output'] }, status: WorkflowNodeStatusEnum.Passed }),
                'if-else': async (_node, input) => {
                    const started = Boolean((input.input as Record<string, unknown>)[start.id]);
                    return { output: { passed: started, trueBranch: { outputPort: 'true', value: input }, falseBranch: { outputPort: 'false', value: null }, __activeOutputs: [started ? 'true' : 'false'] }, status: WorkflowNodeStatusEnum.Passed };
                },
                metadata: async (_node, input) => ({ output: { input }, status: WorkflowNodeStatusEnum.Passed }),
                'respond-end': async (_node, input) => ({ output: { summary: (input.__workflow as Record<string, unknown>) ?? {} }, status: WorkflowNodeStatusEnum.Passed })
            })
        });
        const result = await executor.executeWorkflow(workflow, { settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        const trueAfter = result.workflow.nodes.find((item) => item.id === trueNode.id);
        const falseAfter = result.workflow.nodes.find((item) => item.id === falseNode.id);
        const endAfter = result.workflow.nodes.find((item) => item.id === end.id);
        expect(trueAfter?.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect(falseAfter?.status).toBe(WorkflowNodeStatusEnum.Stopped);
        expect((endAfter?.ports.out.output as { summary?: unknown })?.summary).toBeTruthy();
    });

    it('retries failed node and succeeds before retry limit', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const flaky = createMetadataNode(2, 'Flaky Node');
        const end = createEndNode(3);
        flaky.runtime = { failureMitigation: 'retry-node', retryCount: 3 };
        workflow.nodes = [start, flaky, end];
        workflow.connections = [createConnection('c1', start.id, flaky.id), createConnection('c2', flaky.id, end.id)];

        let attempts = 0;
        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                start: async () => ({ output: { started: true, __activeOutputs: ['output'] }, status: WorkflowNodeStatusEnum.Passed }),
                metadata: async () => {
                    attempts += 1;
                    if (attempts < 3) return { output: { error: 'temporary' }, status: WorkflowNodeStatusEnum.Failed, logs: [`attempt ${attempts} failed`] };
                    return { output: { stable: true }, status: WorkflowNodeStatusEnum.Passed, logs: ['recovered'] };
                },
                'respond-end': async (_node, input) => ({ output: { input }, status: WorkflowNodeStatusEnum.Passed, logs: ['end reached'] })
            })
        });

        const result = await executor.executeWorkflow(workflow, { settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        const flakyAfter = result.workflow.nodes.find((item) => item.id === flaky.id);
        const endAfter = result.workflow.nodes.find((item) => item.id === end.id);
        const flakyLogs = result.events.filter((event) => event.nodeId === flaky.id && event.event === 'node.log').map((event) => String(event.message ?? ''));

        expect(attempts).toBe(3);
        expect(flakyAfter?.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect(endAfter?.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect(flakyLogs.some((line) => line.includes('Retrying (1/3)'))).toBe(true);
        expect(flakyLogs.some((line) => line.includes('Retrying (2/3)'))).toBe(true);
        expect(result.events.some((event) => event.event === 'workflow.completed')).toBe(true);
    });

    it('fails workflow after retry exhaustion', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const flaky = createMetadataNode(2, 'Always Fail');
        const end = createEndNode(3);
        flaky.runtime = { failureMitigation: 'retry-node', retryCount: 2 };
        workflow.nodes = [start, flaky, end];
        workflow.connections = [createConnection('c1', start.id, flaky.id), createConnection('c2', flaky.id, end.id)];

        let attempts = 0;
        let endCalls = 0;
        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                start: async () => ({ output: { started: true, __activeOutputs: ['output'] }, status: WorkflowNodeStatusEnum.Passed }),
                metadata: async () => {
                    attempts += 1;
                    return { output: { error: 'permanent' }, status: WorkflowNodeStatusEnum.Failed, logs: [`attempt ${attempts} failed`] };
                },
                'respond-end': async () => {
                    endCalls += 1;
                    return { output: { ok: true }, status: WorkflowNodeStatusEnum.Passed };
                }
            })
        });

        const result = await executor.executeWorkflow(workflow, { settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        const flakyAfter = result.workflow.nodes.find((item) => item.id === flaky.id);
        const endAfter = result.workflow.nodes.find((item) => item.id === end.id);

        expect(attempts).toBe(3);
        expect(endCalls).toBe(0);
        expect(flakyAfter?.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(endAfter?.status).toBe(WorkflowNodeStatusEnum.Stopped);
        expect(result.events.some((event) => event.event === 'node.failed' && event.nodeId === flaky.id)).toBe(true);
        expect(result.events.some((event) => event.event === 'workflow.completed')).toBe(false);
    });

    it('stop-workflow mitigation fails immediately without retries', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const failing = createMetadataNode(2, 'Stop Mode');
        const end = createEndNode(3);
        failing.runtime = { failureMitigation: 'stop-workflow' };
        workflow.nodes = [start, failing, end];
        workflow.connections = [createConnection('c1', start.id, failing.id), createConnection('c2', failing.id, end.id)];

        let attempts = 0;
        let endCalls = 0;
        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                start: async () => ({ output: { started: true, __activeOutputs: ['output'] }, status: WorkflowNodeStatusEnum.Passed }),
                metadata: async () => {
                    attempts += 1;
                    return { output: { error: 'halt' }, status: WorkflowNodeStatusEnum.Failed, logs: ['halt'] };
                },
                'respond-end': async () => {
                    endCalls += 1;
                    return { output: { ok: true }, status: WorkflowNodeStatusEnum.Passed };
                }
            })
        });

        const result = await executor.executeWorkflow(workflow, { settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        const failingAfter = result.workflow.nodes.find((item) => item.id === failing.id);

        expect(attempts).toBe(1);
        expect(endCalls).toBe(0);
        expect(failingAfter?.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(result.events.some((event) => event.event === 'workflow.completed')).toBe(false);
    });
});

describe('workflow variable resolution', () => {
    it('resolves runtime variable tokens before node execution', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const metadata = createMetadataNode(2, 'Uses Variable');
        const end = createEndNode(3);
        metadata.runtime = { prompt: 'Use {{input.node_start_1.output.answer}}' };
        workflow.nodes = [start, metadata, end];
        workflow.connections = [createConnection('c1', start.id, metadata.id), createConnection('c2', metadata.id, end.id)];
        workflow.nodeModels = {
            metadata: {
                id: 'metadata',
                fields: {
                    prompt: {
                        type: 'textarea',
                        allowVariables: true
                    }
                }
            }
        };

        let seenPrompt = '';
        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                start: async () => ({ output: { answer: '42', __activeOutputs: ['output'] }, status: WorkflowNodeStatusEnum.Passed }),
                metadata: async (node) => {
                    seenPrompt = String(node.runtime.prompt ?? '');
                    return { output: { prompt: seenPrompt }, status: WorkflowNodeStatusEnum.Passed };
                },
                'respond-end': async (_node, input) => ({ output: { input }, status: WorkflowNodeStatusEnum.Passed })
            })
        });

        const result = await executor.executeWorkflow(workflow, { settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        const metadataAfter = result.workflow.nodes.find((item) => item.id === metadata.id);
        expect(seenPrompt).toBe('Use 42');
        expect(metadataAfter?.status).toBe(WorkflowNodeStatusEnum.Passed);
    });

    it('fails workflow node when variable token is unresolved', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const metadata = createMetadataNode(2, 'Broken Variable');
        const end = createEndNode(3);
        metadata.runtime = { prompt: 'Use {{input.node_start_1.output.missing}}' };
        workflow.nodes = [start, metadata, end];
        workflow.connections = [createConnection('c1', start.id, metadata.id), createConnection('c2', metadata.id, end.id)];
        workflow.nodeModels = {
            metadata: {
                id: 'metadata',
                fields: {
                    prompt: {
                        type: 'textarea',
                        allowVariables: true
                    }
                }
            }
        };

        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                start: async () => ({ output: { ok: true, __activeOutputs: ['output'] }, status: WorkflowNodeStatusEnum.Passed }),
                metadata: async () => ({ output: { ok: true }, status: WorkflowNodeStatusEnum.Passed })
            })
        });

        const result = await executor.executeWorkflow(workflow, { settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        const metadataAfter = result.workflow.nodes.find((item) => item.id === metadata.id);
        expect(metadataAfter?.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(result.events.some((event) => event.event === 'node.failed' && event.nodeId === metadata.id)).toBe(true);
    });

    it('fails when variable token is used in disallowed field', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const metadata = createMetadataNode(2, 'Disallowed Variable');
        const end = createEndNode(3);
        metadata.runtime = { queryLimit: '{{input.node_start_1.output.count}}' };
        workflow.nodes = [start, metadata, end];
        workflow.connections = [createConnection('c1', start.id, metadata.id), createConnection('c2', metadata.id, end.id)];
        workflow.nodeModels = {
            metadata: {
                id: 'metadata',
                fields: {
                    queryLimit: {
                        type: 'number',
                        allowVariables: false
                    }
                }
            }
        };

        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                start: async () => ({ output: { count: 2, __activeOutputs: ['output'] }, status: WorkflowNodeStatusEnum.Passed }),
                metadata: async () => ({ output: { ok: true }, status: WorkflowNodeStatusEnum.Passed })
            })
        });

        const result = await executor.executeWorkflow(workflow, { settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        const metadataAfter = result.workflow.nodes.find((item) => item.id === metadata.id);
        expect(metadataAfter?.status).toBe(WorkflowNodeStatusEnum.Failed);
    });
});
