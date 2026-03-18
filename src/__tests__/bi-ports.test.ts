import { describe, expect, it } from 'vitest';
import { createWorkflowExecutor } from '../executor/create-workflow-executor';
import { WorkflowExecutorModeEnum, WorkflowNodeStatusEnum } from '../types';
import { createAdapters, createConnection, createEndNode, createMetadataNode, createStartNode, createWorkflow } from './fixtures';

describe('bi-directional ports', () => {
    it('rejects bi-directional and non-bi connections when handles are incompatible', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const metadata = createMetadataNode(2);
        const end = createEndNode(3);
        workflow.nodes = [start, metadata, end];
        workflow.connections = [
            createConnection('c1', start.id, metadata.id, 'out:output', 'in:command'),
            createConnection('c2', metadata.id, end.id, 'out:output', 'in:input')
        ];

        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({})
        });

        const result = await executor.executeWorkflow(workflow, {
            settings: {
                graphqlUrl: 'http://localhost/graphql',
                authMode: 'none',
                manualHeaders: {}
            }
        });

        expect(result.events.some((event) => event.event === 'workflow.validation_failed')).toBe(true);
        expect(result.events.some((event) => String(event.message ?? '').includes('bi-directional'))).toBe(true);
    });

    it('builds bi-directional input context and publishes command STATE snapshots', async () => {
        const workflow = createWorkflow();
        const start = createStartNode(1);
        const contextA = createMetadataNode(2, 'Context A');
        const contextB = createMetadataNode(3, 'Context B');
        const end = createEndNode(4);
        workflow.nodes = [start, contextA, contextB, end];
        workflow.connections = [
            createConnection('c1', start.id, contextA.id, 'out:output', 'in:input'),
            createConnection('c2', contextA.id, contextB.id, 'out:command', 'in:command'),
            createConnection('c3', contextB.id, end.id, 'out:output', 'in:input')
        ];

        const executor = createWorkflowExecutor({
            mode: WorkflowExecutorModeEnum.Local,
            adapters: createAdapters({
                start: async () => ({ output: { started: true }, status: WorkflowNodeStatusEnum.Passed }),
                metadata: async (node, input) => ({
                    output: {
                        nodeId: node.id,
                        observedCommand: (input.command as Record<string, unknown> | undefined) ?? null
                    },
                    status: WorkflowNodeStatusEnum.Passed
                }),
                'respond-end': async (_node, input) => ({ output: input, status: WorkflowNodeStatusEnum.Passed })
            })
        });

        const result = await executor.executeWorkflow(workflow, {
            settings: {
                graphqlUrl: 'http://localhost/graphql',
                authMode: 'none',
                manualHeaders: {}
            }
        });

        const contextANode = result.workflow.nodes.find((node) => node.id === contextA.id);
        const contextBNode = result.workflow.nodes.find((node) => node.id === contextB.id);

        const contextAState = (contextANode?.ports.out.command as Record<string, unknown> | undefined)?.STATE as Record<string, unknown> | undefined;
        expect(contextAState?.nodeId).toBe(contextA.id);
        expect(contextAState?.status).toBe(WorkflowNodeStatusEnum.Passed);

        const commandInput = contextBNode?.ports.in.command as Record<string, unknown> | undefined;
        const incoming = commandInput?.IN as Record<string, unknown> | undefined;
        const state = commandInput?.STATE as Record<string, unknown> | undefined;

        expect(incoming).toBeTruthy();
        expect(Object.keys(incoming ?? {})).toContain(contextA.id);
        expect(state).toBeTruthy();
        expect(Object.keys(state ?? {})).toContain(contextA.id);
    });
});
