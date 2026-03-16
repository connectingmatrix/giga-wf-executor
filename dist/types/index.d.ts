declare enum WorkflowNodeStatusEnum {
    Passed = "passed",
    Failed = "failed",
    Warning = "warning",
    Running = "running",
    Stopped = "stopped"
}
declare enum WorkflowNodeKindEnum {
    Process = "process",
    Output = "output",
    Error = "error"
}
declare enum WorkflowViewerTypeEnum {
    Json = "json",
    Markdown = "markdown",
    Raw = "raw",
    Table = "table"
}
declare enum WorkflowLogLevelEnum {
    Info = "info",
    Warn = "warn",
    Error = "error"
}
declare enum WorkflowExecutorModeEnum {
    Local = "local",
    Server = "server"
}
type WorkflowNodeStatus = `${WorkflowNodeStatusEnum}`;
type WorkflowNodeKind = `${WorkflowNodeKindEnum}`;
type WorkflowViewerType = `${WorkflowViewerTypeEnum}`;
type WorkflowLogLevel = `${WorkflowLogLevelEnum}`;
type WorkflowExecutorMode = `${WorkflowExecutorModeEnum}`;
interface WorkflowRunLogEvent {
    timestamp: string;
    level: WorkflowLogLevel;
    event: string;
    workflowId: string;
    runId: string;
    nodeId?: string;
    message?: string;
    data?: unknown;
}
interface WorkflowRuntimeSettings {
    graphqlUrl: string;
    httpBaseUrl?: string;
    authMode: string;
    manualHeaders?: Record<string, string>;
}
interface WorkflowNodeSchema {
    id: string;
    outputViewers?: Array<{
        id: string;
        label: string;
        type: WorkflowViewerType;
    }>;
}
interface WorkflowNodeModel {
    id: string;
    gigaId: string;
    modelId: string;
    type: string;
    name: string;
    description: string;
    kind: WorkflowNodeKind;
    status: WorkflowNodeStatus;
    position: {
        x: number;
        y: number;
    };
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
interface WorkflowConnectionModel {
    id: string;
    name: string;
    from: string;
    to: string;
    sourceHandle?: string;
    targetHandle?: string;
    text?: string;
}
interface WorkflowMetadata {
    id: string;
    name: string;
    createdAt?: string;
    runtime?: {
        settings?: WorkflowRuntimeSettings;
        sessionLogs?: WorkflowRunLogEvent[];
    };
    [key: string]: unknown;
}
interface WorkflowDefinition {
    metadata: WorkflowMetadata;
    nodeModels: Record<string, WorkflowNodeSchema>;
    nodes: WorkflowNodeModel[];
    connections: WorkflowConnectionModel[];
}
interface WorkflowInvokeConnectedNodeArgs {
    nodeId: string;
    input?: Record<string, unknown>;
    overrides?: WorkflowStepOverrides;
}
interface WorkflowNodeHandlerContext {
    node: WorkflowNodeModel;
    workflow: WorkflowDefinition;
    settings: WorkflowRuntimeSettings;
    input: Record<string, unknown>;
    signal?: AbortSignal;
    hostContext?: unknown;
    invokeConnectedNode?: (args: WorkflowInvokeConnectedNodeArgs) => Promise<{
        node: WorkflowNodeModel;
        result: WorkflowNodeHandlerResult;
    }>;
}
interface WorkflowNodeHandlerResult {
    output: unknown;
    status?: WorkflowNodeStatus;
    logs?: string[];
}
type WorkflowNodeHandler = (context: WorkflowNodeHandlerContext) => Promise<WorkflowNodeHandlerResult>;
interface WorkflowStepOverrides {
    properties?: Record<string, unknown>;
    code?: string;
    markdown?: string;
}
interface WorkflowLogger {
    push: (event: Omit<WorkflowRunLogEvent, 'timestamp'>) => void;
    entries: WorkflowRunLogEvent[];
}
interface WorkflowExecutorRemoteNodeResult {
    workflow: WorkflowDefinition;
    node: WorkflowNodeModel;
    result: WorkflowNodeHandlerResult;
    logs?: WorkflowRunLogEvent[];
}
interface WorkflowExecutorAdapters {
    getNodeHandler: (modelId: string | undefined) => WorkflowNodeHandler;
    resolveNodeSchema: (modelId: string | undefined, nodeModels: Record<string, WorkflowNodeSchema>) => WorkflowNodeSchema;
}
interface ExecuteWorkflowOptions {
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
interface ExecuteNodeStepOptions {
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
interface WorkflowExecutorResult {
    workflow: WorkflowDefinition;
    logs: WorkflowRunLogEvent[];
    stopped: boolean;
}
interface WorkflowStepExecutorResult {
    workflow: WorkflowDefinition;
    node: WorkflowNodeModel;
    result: WorkflowNodeHandlerResult;
}
interface WorkflowExecutor {
    mode: WorkflowExecutorMode;
    executeWorkflow: (workflow: WorkflowDefinition, options: ExecuteWorkflowOptions) => Promise<WorkflowExecutorResult>;
    executeNodeStep: (options: ExecuteNodeStepOptions) => Promise<WorkflowStepExecutorResult>;
}

export { type ExecuteNodeStepOptions, type ExecuteWorkflowOptions, type WorkflowConnectionModel, type WorkflowDefinition, type WorkflowExecutor, type WorkflowExecutorAdapters, type WorkflowExecutorMode, WorkflowExecutorModeEnum, type WorkflowExecutorRemoteNodeResult, type WorkflowExecutorResult, type WorkflowInvokeConnectedNodeArgs, type WorkflowLogLevel, WorkflowLogLevelEnum, type WorkflowLogger, type WorkflowMetadata, type WorkflowNodeHandler, type WorkflowNodeHandlerContext, type WorkflowNodeHandlerResult, type WorkflowNodeKind, WorkflowNodeKindEnum, type WorkflowNodeModel, type WorkflowNodeSchema, type WorkflowNodeStatus, WorkflowNodeStatusEnum, type WorkflowRunLogEvent, type WorkflowRuntimeSettings, type WorkflowStepExecutorResult, type WorkflowStepOverrides, type WorkflowViewerType, WorkflowViewerTypeEnum };
