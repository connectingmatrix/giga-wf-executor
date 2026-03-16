import { describe, expect, it } from 'vitest';
import { createJsonlLogger } from '../executor/jsonl-logger';
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
        const logger = createJsonlLogger();
        const result = await executor.executeNodeStep({
            workflow,
            nodeId: code.id,
            settings: { graphqlUrl: 'http://localhost/graphql', authMode: 'none' },
            logger
        });

        expect(result.node.status).toBe(WorkflowNodeStatusEnum.Passed);
        expect(result.node.output).toEqual({ ok: true });
        const untouched = result.workflow.nodes.find((item) => item.id === metadata.id);
        expect(untouched?.status).toBe(WorkflowNodeStatusEnum.Stopped);
    });
});
