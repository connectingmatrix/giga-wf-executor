import {
    WorkflowConnectionModel,
    WorkflowDefinition,
    WorkflowExecutorAdapters,
    WorkflowNodeHandlerResult,
    WorkflowNodeModel,
    WorkflowNodeSchema,
    WorkflowNodeStatusEnum
} from '../types';

export const createWorkflow = (): WorkflowDefinition => ({
    metadata: {
        id: 'wf_test',
        name: 'Workflow Test'
    },
    nodeModels: {
        start: { id: 'start' },
        'if-else': { id: 'if-else' },
        metadata: { id: 'metadata' },
        'respond-end': { id: 'respond-end' },
        code: { id: 'code' }
    },
    nodes: [],
    connections: []
});

const createNode = (id: string, modelId: string, name: string, index: number): WorkflowNodeModel => ({
    id,
    gigaId: id,
    modelId,
    type: 'workflowStep',
    name,
    description: '',
    kind: 'process',
    status: WorkflowNodeStatusEnum.Stopped,
    position: { x: index * 100, y: 100 },
    input: {},
    output: null,
    properties: {},
    inspector: {
        title: name,
        input: {},
        properties: {},
        code: 'return input;',
        markdown: '',
        viewers: [{ id: 'json', label: 'JSON', type: 'json', value: {} }]
    }
});

export const createStartNode = (index: number): WorkflowNodeModel => createNode(`node_start_${index}`, 'start', 'Start', index);
export const createIfElseNode = (index: number): WorkflowNodeModel => createNode(`node_if_${index}`, 'if-else', 'If Else', index);
export const createMetadataNode = (index: number, name = 'Metadata'): WorkflowNodeModel => createNode(`node_meta_${index}`, 'metadata', name, index);
export const createEndNode = (index: number): WorkflowNodeModel => createNode(`node_end_${index}`, 'respond-end', 'End', index);
export const createCodeNode = (index: number): WorkflowNodeModel => createNode(`node_code_${index}`, 'code', 'Code', index);

export const createConnection = (id: string, from: string, to: string, sourceHandle = 'out:output', targetHandle = 'in:input'): WorkflowConnectionModel => ({
    id,
    name: `${from}->${to}`,
    from,
    to,
    sourceHandle,
    targetHandle
});

type HandlerMap = Record<string, (node: WorkflowNodeModel, input: Record<string, unknown>) => Promise<WorkflowNodeHandlerResult> | WorkflowNodeHandlerResult>;

export const createAdapters = (handlers: HandlerMap): WorkflowExecutorAdapters => ({
    getNodeHandler: (modelId) => async ({ node, input }) => {
        const execute = handlers[String(modelId)];
        if (!execute) {
            return { output: input, status: WorkflowNodeStatusEnum.Warning, logs: [`No handler for ${modelId}`] };
        }
        return execute(node, input);
    },
    resolveNodeSchema: (modelId, nodeModels): WorkflowNodeSchema => nodeModels[String(modelId)] ?? { id: String(modelId ?? 'unknown') }
});
