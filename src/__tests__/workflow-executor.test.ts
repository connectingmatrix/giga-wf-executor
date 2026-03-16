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
});
