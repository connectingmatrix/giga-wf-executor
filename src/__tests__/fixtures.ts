import { WorkflowConnectionModel, WorkflowDefinition, WorkflowExecutorAdapters, WorkflowNodeHandlerResult, WorkflowNodeModel, WorkflowNodeStatusEnum } from '../types';

export const createWorkflow = (): WorkflowDefinition => ({
    metadata: {
        id: 'wf_test',
        name: 'Workflow Test'
    },
    nodeModels: {
        start: {
            id: 'start',
            inputs: {
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            },
            outputs: {
                output: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            }
        },
        code: {
            id: 'code',
            inputs: {
                input: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            },
            outputs: {
                output: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            }
        },
        metadata: {
            id: 'metadata',
            inputs: {
                input: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            },
            outputs: {
                output: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            }
        },
        'if-else': {
            id: 'if-else',
            inputs: {
                input: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            },
            outputs: {
                output: { allowMultipleArrows: true },
                true: { allowMultipleArrows: true },
                false: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            }
        },
        'respond-end': {
            id: 'respond-end',
            inputs: {
                input: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            },
            outputs: {
                output: { allowMultipleArrows: true },
                command: { portType: 'bi-directional', allowMultipleArrows: true }
            }
        }
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
    runtime: {},
    ports: { in: {}, out: {} }
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

type HandlerMap = Record<string, (node: WorkflowNodeModel, input: Record<string, Record<string, unknown>>) => Promise<WorkflowNodeHandlerResult> | WorkflowNodeHandlerResult>;

export const createAdapters = (handlers: HandlerMap): WorkflowExecutorAdapters => ({
    getNodeHandler: (modelId) => async ({ node, input }) => {
        const execute = handlers[String(modelId)];
        if (!execute) {
            return { output: input, status: WorkflowNodeStatusEnum.Warning, logs: [`No handler for ${modelId}`] };
        }
        return execute(node, input);
    }
});
