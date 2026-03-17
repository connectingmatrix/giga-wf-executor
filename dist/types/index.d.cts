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
interface WorkflowNodePorts {
    in: Record<string, Record<string, unknown>>;
    out: Record<string, unknown>;
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
    runtime: Record<string, unknown>;
    ports: WorkflowNodePorts;
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
interface WorkflowNodeFieldSchema {
    allowVariables?: boolean;
    hidden?: boolean;
    auto?: boolean;
    editable?: boolean;
    type?: string;
    [key: string]: unknown;
}
interface WorkflowNodeSchema {
    id?: string;
    fields?: Record<string, WorkflowNodeFieldSchema>;
    [key: string]: unknown;
}
interface WorkflowMetadata {
    id: string;
    name: string;
    createdAt?: string;
    runtime?: {
        settings?: WorkflowRuntimeSettings;
    };
    [key: string]: unknown;
}
interface WorkflowDefinition {
    metadata: WorkflowMetadata;
    nodeModels?: Record<string, WorkflowNodeSchema>;
    nodes: WorkflowNodeModel[];
    connections: WorkflowConnectionModel[];
}
interface WorkflowInvokeConnectedNodeArgs {
    nodeId: string;
    input?: Record<string, Record<string, unknown>>;
    overrides?: WorkflowStepOverrides;
}
interface WorkflowNodeHandlerContext {
    node: WorkflowNodeModel;
    workflow: WorkflowDefinition;
    settings: WorkflowRuntimeSettings;
    input: Record<string, Record<string, unknown>>;
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
    runtime?: Record<string, unknown>;
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
    events?: WorkflowRunLogEvent[];
}
interface WorkflowExecutorAdapters {
    getNodeHandler: (modelId: string | undefined) => WorkflowNodeHandler;
}
interface ExecuteWorkflowOptions {
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
interface ExecuteNodeStepOptions {
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
interface WorkflowExecutorResult {
    workflow: WorkflowDefinition;
    stopped: boolean;
    events: WorkflowRunLogEvent[];
}
interface WorkflowStepExecutorResult {
    workflow: WorkflowDefinition;
    node: WorkflowNodeModel;
    result: WorkflowNodeHandlerResult;
    events: WorkflowRunLogEvent[];
}
interface WorkflowExecutor {
    mode: WorkflowExecutorMode;
    executeWorkflow: (workflow: WorkflowDefinition, options: ExecuteWorkflowOptions) => Promise<WorkflowExecutorResult>;
    executeNodeStep: (options: ExecuteNodeStepOptions) => Promise<WorkflowStepExecutorResult>;
}

export { type ExecuteNodeStepOptions, type ExecuteWorkflowOptions, type WorkflowConnectionModel, type WorkflowDefinition, type WorkflowExecutor, type WorkflowExecutorAdapters, type WorkflowExecutorMode, WorkflowExecutorModeEnum, type WorkflowExecutorRemoteNodeResult, type WorkflowExecutorResult, type WorkflowInvokeConnectedNodeArgs, type WorkflowLogLevel, WorkflowLogLevelEnum, type WorkflowLogger, type WorkflowMetadata, type WorkflowNodeFieldSchema, type WorkflowNodeHandler, type WorkflowNodeHandlerContext, type WorkflowNodeHandlerResult, type WorkflowNodeKind, WorkflowNodeKindEnum, type WorkflowNodeModel, type WorkflowNodePorts, type WorkflowNodeSchema, type WorkflowNodeStatus, WorkflowNodeStatusEnum, type WorkflowRunLogEvent, type WorkflowRuntimeSettings, type WorkflowStepExecutorResult, type WorkflowStepOverrides };
