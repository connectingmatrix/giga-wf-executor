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

export interface WorkflowNodePorts {
    in: Record<string, Record<string, unknown>>;
    out: Record<string, unknown>;
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
    runtime: Record<string, unknown>;
    ports: WorkflowNodePorts;
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

export interface WorkflowNodeFieldSchema {
    aiWriteMode?: 'allow' | 'connected-options-only' | 'deny';
    aiSourcePort?: string;
    allowVariables?: boolean;
    hidden?: boolean;
    auto?: boolean;
    editable?: boolean;
    type?: string;
    [key: string]: unknown;
}

export interface WorkflowNodePortSchema {
    allowMultipleArrows?: boolean;
    side?: string;
    order?: number;
    label?: string;
    portType?: string;
    acceptedSourceGroups?: string[];
    acceptedSourceModelIds?: string[];
    [key: string]: unknown;
}

export interface WorkflowNodeSchema {
    id?: string;
    fields?: Record<string, WorkflowNodeFieldSchema>;
    inputs?: Record<string, WorkflowNodePortSchema>;
    outputs?: Record<string, WorkflowNodePortSchema>;
    [key: string]: unknown;
}

export interface WorkflowMetadata {
    id: string;
    name: string;
    createdAt?: string;
    runtime?: {
        settings?: WorkflowRuntimeSettings;
    };
    [key: string]: unknown;
}

export interface WorkflowDefinition {
    metadata: WorkflowMetadata;
    nodeModels?: Record<string, WorkflowNodeSchema>;
    nodes: WorkflowNodeModel[];
    connections: WorkflowConnectionModel[];
}

export interface WorkflowInvokeConnectedNodeArgs {
    nodeId: string;
    input?: Record<string, Record<string, unknown>>;
    overrides?: WorkflowStepOverrides;
}

export interface WorkflowNodeHandlerContext {
    node: WorkflowNodeModel;
    workflow: WorkflowDefinition;
    settings: WorkflowRuntimeSettings;
    input: Record<string, Record<string, unknown>>;
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
    runtime?: Record<string, unknown>;
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
    events?: WorkflowRunLogEvent[];
}

export interface WorkflowExecutorAdapters {
    getNodeHandler: (modelId: string | undefined) => WorkflowNodeHandler;
}

export interface ExecuteWorkflowOptions {
    signal?: AbortSignal;
    settings: WorkflowRuntimeSettings;
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
    onEvent?: (event: WorkflowRunLogEvent) => void;
}

export interface ExecuteNodeStepOptions {
    workflow: WorkflowDefinition;
    nodeId: string;
    settings: WorkflowRuntimeSettings;
    signal?: AbortSignal;
    hostContext?: unknown;
    overrides?: WorkflowStepOverrides;
    isNodeLocalCapable?: (modelId: string | undefined) => boolean;
    executeNodeRemotely?: ExecuteWorkflowOptions['executeNodeRemotely'];
    onEvent?: (event: WorkflowRunLogEvent) => void;
}

export interface WorkflowExecutorResult {
    workflow: WorkflowDefinition;
    stopped: boolean;
    events: WorkflowRunLogEvent[];
}

export interface WorkflowStepExecutorResult {
    workflow: WorkflowDefinition;
    node: WorkflowNodeModel;
    result: WorkflowNodeHandlerResult;
    events: WorkflowRunLogEvent[];
}

export interface WorkflowExecutor {
    mode: WorkflowExecutorMode;
    executeWorkflow: (workflow: WorkflowDefinition, options: ExecuteWorkflowOptions) => Promise<WorkflowExecutorResult>;
    executeNodeStep: (options: ExecuteNodeStepOptions) => Promise<WorkflowStepExecutorResult>;
}
