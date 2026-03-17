import { WorkflowDefinition, WorkflowNodeModel, WorkflowNodeHandlerResult, WorkflowRunLogEvent, WorkflowNodeStatus } from '../types/index.js';

/** Purpose: builds a deterministic per-port input map from upstream ports.out values for a node execution. */
declare const buildNodeInputContext: (workflow: WorkflowDefinition, nodeId: string, outputsByNodeId: Map<string, Record<string, unknown>>, fallbackInput: Record<string, Record<string, unknown>>) => Record<string, Record<string, unknown>>;
declare const shouldExecuteNodeInCurrentRun: (workflow: WorkflowDefinition, nodeId: string, outputsByNodeId: Map<string, Record<string, unknown>>) => boolean;
declare const collectReachableNodeIdsFromStartNodes: (workflow: WorkflowDefinition, startNodeIds: string[]) => Set<string>;
/** Purpose: computes a stable topological execution order for workflow nodes, with declaration-order fallback on cycles. */
declare const sortWorkflowNodesTopologically: (workflow: WorkflowDefinition) => string[];

declare const replaceNodeById: (workflow: WorkflowDefinition, nextNode: WorkflowNodeModel) => WorkflowDefinition;
declare const buildRunningNodeState: (node: WorkflowNodeModel, overrides?: Partial<WorkflowNodeModel>) => WorkflowNodeModel;
declare const buildCompletedNodeState: (node: WorkflowNodeModel, input: Record<string, Record<string, unknown>>, result: WorkflowNodeHandlerResult) => WorkflowNodeModel;
declare const buildFailedNodeState: (node: WorkflowNodeModel, message: string) => WorkflowNodeModel;
declare const markRunningNodesAsStopped: (workflow: WorkflowDefinition) => WorkflowDefinition;

type WorkflowEventSink = (event: Omit<WorkflowRunLogEvent, 'timestamp'>) => void;
declare const createRunId: (prefix: string) => string;
declare const emitNodeStarted: (sink: WorkflowEventSink, workflowId: string, runId: string, node: WorkflowNodeModel) => void;
declare const emitNodeLogs: (sink: WorkflowEventSink, workflowId: string, runId: string, nodeId: string, logs?: string[]) => void;
declare const emitNodeFinished: (sink: WorkflowEventSink, workflowId: string, runId: string, nodeId: string, status: string, durationMs: number, logs?: string[]) => void;
declare const emitNodeFailed: (sink: WorkflowEventSink, workflowId: string, runId: string, nodeId: string, message: string) => void;
declare const emitWorkflowStopped: (sink: WorkflowEventSink, workflowId: string, runId: string) => void;
declare const emitWorkflowCompleted: (sink: WorkflowEventSink, workflowId: string, runId: string) => void;
declare const emitWorkflowValidationFailed: (sink: WorkflowEventSink, workflowId: string, runId: string, message: string) => void;

interface WorkflowNodeExecutionTiming {
    nodeId: string;
    name: string;
    status: WorkflowNodeStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
}
type WorkflowNodeExecutionTimingMap = Record<string, WorkflowNodeExecutionTiming>;
declare const createNodeExecutionTiming: (node: WorkflowNodeModel, status: WorkflowNodeStatus, startedAt: string, finishedAt: string, durationMs: number) => WorkflowNodeExecutionTiming;
declare const buildWorkflowSummaryInput: (runId: string, outputsByNode: Map<string, unknown>, timingsByNode: WorkflowNodeExecutionTimingMap, logs?: unknown[]) => Record<string, unknown>;

export { type WorkflowEventSink, type WorkflowNodeExecutionTiming, type WorkflowNodeExecutionTimingMap, buildCompletedNodeState, buildFailedNodeState, buildNodeInputContext, buildRunningNodeState, buildWorkflowSummaryInput, collectReachableNodeIdsFromStartNodes, createNodeExecutionTiming, createRunId, emitNodeFailed, emitNodeFinished, emitNodeLogs, emitNodeStarted, emitWorkflowCompleted, emitWorkflowStopped, emitWorkflowValidationFailed, markRunningNodesAsStopped, replaceNodeById, shouldExecuteNodeInCurrentRun, sortWorkflowNodesTopologically };
