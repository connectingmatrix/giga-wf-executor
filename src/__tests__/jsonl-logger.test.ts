import { describe, expect, it } from 'vitest';
import { createJsonlLogger } from '../executor/jsonl-logger';

describe('jsonl logger', () => {
    it('serializes events as JSONL', () => {
        const logger = createJsonlLogger();
        logger.push({
            workflowId: 'wf_1',
            runId: 'run_1',
            event: 'workflow.started',
            level: 'info'
        });
        logger.push({
            workflowId: 'wf_1',
            runId: 'run_1',
            event: 'node.finished',
            level: 'info',
            nodeId: 'node_1',
            data: { status: 'passed' }
        });

        const lines = logger.toJsonl().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).event).toBe('workflow.started');
        expect(JSON.parse(lines[1]).event).toBe('node.finished');
    });
});
