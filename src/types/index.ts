export enum WorkflowNodeStatusEnum {
    Passed = 'passed',
    Failed = 'failed',
    Warning = 'warning',
    Running = 'running',
    Stopped = 'stopped'
}

export enum WorkflowNodeKindEnum {
    Process = 'process',
    Output = 'output',
    Error = 'error'
}

export enum WorkflowViewerTypeEnum {
    Json = 'json',
    Markdown = 'markdown',
    Raw = 'raw',
    Table = 'table'
}

export enum WorkflowLogLevelEnum {
    Info = 'info',
    Warn = 'warn',
    Error = 'error'
}

export enum WorkflowExecutorModeEnum {
    Local = 'local',
    Server = 'server'
}

export type WorkflowNodeStatus = `${WorkflowNodeStatusEnum}`;
export type WorkflowNodeKind = `${WorkflowNodeKindEnum}`;
export type WorkflowViewerType = `${WorkflowViewerTypeEnum}`;
export type WorkflowLogLevel = `${WorkflowLogLevelEnum}`;
export type WorkflowExecutorMode = `${WorkflowExecutorModeEnum}`;

export interface WorkflowRunLogEvent {
    timestamp: string;
    level: WorkflowLogLevel;
    event: string;
    workflowId: string;
    runId: string;
    nodeId?: string;
    message?: string;
    data?: unknown;
}

export interface WorkflowRuntimeSettings {
    graphqlUrl: string;
    httpBaseUrl?: string;
    authMode: string;
    manualHeaders?: Record<string, string>;
}

export interface WorkflowNodeSchema {
    id: string;
    outputViewers?: Array<{
        id: string;
        label: string;
        type: WorkflowViewerType;
    }>;
}

export interface WorkflowNodeModel {
    id: string;
    gigaId: string;
    modelId: string;
    type: string;
    name: string;
    description: string;
    kind: WorkflowNodeKind;
    status: WorkflowNodeStatus;
    position: { x: number; y: number };
    input: Record<string, unknown>;
    output: unknown;
    properties?: Record<string, unknown>;
    inspector?: {
        title?: string;
        input?: Record<string, unknown>;
        properties?: Record<string, unknown>;
        code?: string;
        markdown?: string;
        viewers: Array<{
            id: string;
            label: string;
            type: WorkflowViewerType;
            value: unknown;
        }>;
    };
}

export interface WorkflowConnectionModel {
    id: string;
    name: string;
    from: string;
    to: string;
    sourceHandle?: string;
    targetHandle?: string;
    text?: string;
}

export interface WorkflowMetadata {
    id: string;
    name: string;
    createdAt?: string;
    runtime?: {
        settings?: WorkflowRuntimeSettings;
        sessionLogs?: WorkflowRunLogEvent[];
    };
    [key: string]: unknown;
}

export interface WorkflowDefinition {
    metadata: WorkflowMetadata;
    nodeModels: Record<string, WorkflowNodeSchema>;
    nodes: WorkflowNodeModel[];
    connections: WorkflowConnectionModel[];
}

export interface WorkflowInvokeConnectedNodeArgs {
    nodeId: string;
    input?: Record<string, unknown>;
    overrides?: WorkflowStepOverrides;
}

export interface WorkflowNodeHandlerContext {
    node: WorkflowNodeModel;
    workflow: WorkflowDefinition;
    settings: WorkflowRuntimeSettings;
    input: Record<string, unknown>;
    signal?: AbortSignal;
    hostContext?: unknown;
    invokeConnectedNode?: (args: WorkflowInvokeConnectedNodeArgs) => Promise<{ node: WorkflowNodeModel; result: WorkflowNodeHandlerResult }>;
}

export interface WorkflowNodeHandlerResult {
    output: unknown;
    status?: WorkflowNodeStatus;
    logs?: string[];
}

export type WorkflowNodeHandler = (context: WorkflowNodeHandlerContext) => Promise<WorkflowNodeHandlerResult>;

export interface WorkflowStepOverrides {
    properties?: Record<string, unknown>;
    code?: string;
    markdown?: string;
}

export interface WorkflowLogger {
    push: (event: Omit<WorkflowRunLogEvent, 'timestamp'>) => void;
    entries: WorkflowRunLogEvent[];
}

export interface WorkflowExecutorRemoteNodeResult {
    workflow: WorkflowDefinition;
    node: WorkflowNodeModel;
    result: WorkflowNodeHandlerResult;
    logs?: WorkflowRunLogEvent[];
}

export interface WorkflowExecutorAdapters {
    getNodeHandler: (modelId: string | undefined) => WorkflowNodeHandler;
    resolveNodeSchema: (modelId: string | undefined, nodeModels: Record<string, WorkflowNodeSchema>) => WorkflowNodeSchema;
}

export interface ExecuteWorkflowOptions {
    signal?: AbortSignal;
    settings: WorkflowRuntimeSettings;
    logger: WorkflowLogger;
    hostContext?: unknown;
    isNodeLocalCapable?: (modelId: string | undefined) => boolean;
    executeNodeRemotely?: (payload: {
        workflow: WorkflowDefinition;
        nodeId: string;
        settings: WorkflowRuntimeSettings;
        overrides?: WorkflowStepOverrides;
        hostContext?: unknown;
    }) => Promise<WorkflowExecutorRemoteNodeResult>;
    onNodeStart?: (nodeId: string) => void;
    onNodeFinish?: (node: WorkflowNodeModel) => void;
}

export interface ExecuteNodeStepOptions {
    workflow: WorkflowDefinition;
    nodeId: string;
    settings: WorkflowRuntimeSettings;
    logger: WorkflowLogger;
    signal?: AbortSignal;
    hostContext?: unknown;
    overrides?: WorkflowStepOverrides;
    isNodeLocalCapable?: (modelId: string | undefined) => boolean;
    executeNodeRemotely?: ExecuteWorkflowOptions['executeNodeRemotely'];
}

export interface WorkflowExecutorResult {
    workflow: WorkflowDefinition;
    logs: WorkflowRunLogEvent[];
    stopped: boolean;
}

export interface WorkflowStepExecutorResult {
    workflow: WorkflowDefinition;
    node: WorkflowNodeModel;
    result: WorkflowNodeHandlerResult;
}

export interface WorkflowExecutor {
    mode: WorkflowExecutorMode;
    executeWorkflow: (workflow: WorkflowDefinition, options: ExecuteWorkflowOptions) => Promise<WorkflowExecutorResult>;
    executeNodeStep: (options: ExecuteNodeStepOptions) => Promise<WorkflowStepExecutorResult>;
}
