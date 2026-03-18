import { describe, expect, it } from 'vitest';
import { createWorkflowExecutor } from '../executor/create-workflow-executor';
import { WorkflowExecutorModeEnum, WorkflowNodeStatusEnum } from '../types';
import { createAdapters, createCodeNode, createConnection, createMetadataNode, createStartNode, createWorkflow } from './fixtures';

describe('shared workflow step executor', () => {
    it('executes only target node in step mode', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const code = createCodeNode(2);
        const metadata = createMetadataNode(3);
        workflow.nodes = [start, code, metadata];
        workflow.connections = [createConnection('c1', start.id, code.id), createConnection('c2', code.id, metadata.id)];

        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                code: async () => ({ output: { ok: true }, status: WorkflowNodeStatusEnum.Passed, logs: ['step ok'] })
            })
        });

        const result = await executor.executeNodeStep({ workflow, nodeId: code.id, settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect(result.node.ports.out.output).toEqual({ ok: true });
        const untouched = result.workflow.nodes.find((item) => item.id === metadata.id);
        expect(untouched?.status).toBe(WorkflowNodeStatusEnum.Stopped);
    });

    it('retries step execution until success when mitigation is retry-node', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const code = createCodeNode(2);
        code.runtime = { failureMitigation: 'retry-node', retryCount: 3 };
        start.status = WorkflowNodeStatusEnum.Passed;
        start.ports.out = { output: { message: 'Hi' } };
        workflow.nodes = [start, code];
        workflow.connections = [createConnection('c1', start.id, code.id)];

        let attempts = 0;
        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                code: async () => {
                    attempts += 1;
                    if (attempts < 3) return { output: { error: 'transient' }, status: WorkflowNodeStatusEnum.Failed, logs: [`failed ${attempts}`] };
                    return { output: { ok: true }, status: WorkflowNodeStatusEnum.Passed, logs: ['succeeded'] };
                }
            })
        });

        const result = await executor.executeNodeStep({ workflow, nodeId: code.id, settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        const retryLines = result.events.filter((event) => event.nodeId === code.id && event.event === 'node.log').map((event) => String(event.message ?? ''));

        expect(attempts).toBe(3);
        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect(result.result.logs).toEqual(expect.arrayContaining(['failed 1', 'failed 2', 'succeeded']));
        expect(retryLines.some((line) => line.includes('Retrying (1/3)'))).toBe(true);
        expect(retryLines.some((line) => line.includes('Retrying (2/3)'))).toBe(true);
    });

    it('fails step execution after retry exhaustion', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const code = createCodeNode(2);
        code.runtime = { failureMitigation: 'retry-node', retryCount: 2 };
        workflow.nodes = [start, code];
        workflow.connections = [createConnection('c1', start.id, code.id)];

        let attempts = 0;
        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                code: async () => {
                    attempts += 1;
                    return { output: { error: 'fatal' }, status: WorkflowNodeStatusEnum.Failed, logs: [`failed ${attempts}`] };
                }
            })
        });

        const result = await executor.executeNodeStep({ workflow, nodeId: code.id, settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        expect(attempts).toBe(3);
        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(result.result.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(result.result.logs).toEqual(expect.arrayContaining(['failed 1', 'failed 2', 'failed 3']));
    });

    it('stop-workflow mitigation fails step immediately without retries', async () => {
        const workflow = createWorkflow();
        const code = createCodeNode(2);
        code.runtime = { failureMitigation: 'stop-workflow' };
        workflow.nodes = [code];

        let attempts = 0;
        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                code: async () => {
                    attempts += 1;
                    return { output: { error: 'halt now' }, status: WorkflowNodeStatusEnum.Failed, logs: ['halt now'] };
                }
            })
        });

        const result = await executor.executeNodeStep({ workflow, nodeId: code.id, settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        expect(attempts).toBe(1);
        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(result.result.logs).toContain('halt now');
    });

    it('fails step execution when connection compatibility rules are violated', async () => {
        const workflow = createWorkflow();
        const nonModelNode = createMetadataNode(1, 'Non Model');
        const governorNode = createMetadataNode(2, 'AI Governor');
        governorNode.modelId = 'ai-governor';
        workflow.nodes = [nonModelNode, governorNode];
        workflow.connections = [createConnection('c1', nonModelNode.id, governorNode.id, 'out:output', 'in:modelIn')];
        workflow.nodeModels = {
            metadata: {
                id: 'metadata',
                group: 'Data',
                inputs: { input: { allowMultipleArrows: true } },
                outputs: { output: { allowMultipleArrows: true } }
            },
            'ai-governor': {
                id: 'ai-governor',
                inputs: {
                    modelIn: {
                        allowMultipleArrows: true,
                        acceptedSourceGroups: ['AI Models']
                    },
                    input: { allowMultipleArrows: true }
                },
                outputs: { output: { allowMultipleArrows: true } }
            }
        };

        const executor = createWorkflowExecutor({ mode: WorkflowExecutorModeEnum.Local, adapters: createAdapters({}) });
        const result = await executor.executeNodeStep({ workflow, nodeId: governorNode.id, settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(String(result.result.logs?.[0] ?? '')).toContain('incompatible connection');
    });
});

describe('step variable resolution', () => {
    it('resolves runtime variable tokens in step execution', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        start.status = WorkflowNodeStatusEnum.Passed;
        start.ports.out = { output: { message: 'Hi' } };
        const code = createCodeNode(2);
        code.runtime = { prompt: 'Summary {{input.node_start_1.output.message}}' };
        workflow.nodes = [start, code];
        workflow.connections = [createConnection('c1', start.id, code.id)];
        workflow.nodeModels = {
            code: {
                id: 'code',
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
                code: async (node) => {
                    seenPrompt = String(node.runtime.prompt ?? '');
                    return { output: { prompt: seenPrompt }, status: WorkflowNodeStatusEnum.Passed };
                }
            })
        });

        const result = await executor.executeNodeStep({ workflow, nodeId: code.id, settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        expect(seenPrompt).toBe('Summary Hi');
        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Passed);
    });

    it('resolves workflow graph metadata and runtime settings in step variable tokens', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        start.status = WorkflowNodeStatusEnum.Passed;
        start.ports.out = { output: { message: 'Hi' } };
        const code = createCodeNode(2);
        code.runtime = {
            prompt: 'Ctx {{workflow.metadata.name}} / {{workflow.nodes[0].name}} / {{workflow.connections[0].id}} / {{workflow.runtime.settings.graphqlUrl}} / {{workflow.settings.authMode}}'
        };
        workflow.nodes = [start, code];
        workflow.connections = [createConnection('c1', start.id, code.id)];
        workflow.nodeModels = {
            code: {
                id: 'code',
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
                code: async (node) => {
                    seenPrompt = String(node.runtime.prompt ?? '');
                    return { output: { prompt: seenPrompt }, status: WorkflowNodeStatusEnum.Passed };
                }
            })
        });

        const result = await executor.executeNodeStep({ workflow, nodeId: code.id, settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        expect(seenPrompt).toBe('Ctx Workflow Test / Start / c1 / http://localhost/graphql / none');
        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Passed);
    });

    it('fails step execution when variable token is unresolved', async () => {

        const workflow = createWorkflow();
        const code = createCodeNode(2);
        code.runtime = { prompt: 'Summary {{input.node_start_1.output.message}}' };
        workflow.nodes = [code];
        workflow.nodeModels = {
            code: {
                id: 'code',
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
                code: async () => ({ output: { ok: true }, status: WorkflowNodeStatusEnum.Passed })
            })
        });

        const result = await executor.executeNodeStep({ workflow, nodeId: code.id, settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' } });
        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Failed);
        expect(result.result.status).toBe(WorkflowNodeStatusEnum.Failed);
    });
});
