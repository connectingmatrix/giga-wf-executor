import { WorkflowDefinition, WorkflowNodeModel, WorkflowNodeSchema, WorkflowNodeHandlerResult, WorkflowLogger, WorkflowNodeStatus } from '../types/index.js';

declare const buildNodeInputContext: (workflow: WorkflowDefinition, nodeId: string, outputsByNodeId: Map<string, unknown>, fallbackInput: Record<string, unknown>) => Record<string, unknown>;
declare const shouldExecuteNodeInCurrentRun: (workflow: WorkflowDefinition, nodeId: string, outputsByNodeId: Map<string, unknown>) => boolean;
declare const collectReachableNodeIdsFromStartNodes: (workflow: WorkflowDefinition, startNodeIds: string[]) => Set<string>;
declare const sortWorkflowNodesTopologically: (workflow: WorkflowDefinition) => string[];

declare const replaceNodeById: (workflow: WorkflowDefinition, nextNode: WorkflowNodeModel) => WorkflowDefinition;
declare const buildRunningNodeState: (node: WorkflowNodeModel, overrides?: Partial<WorkflowNodeModel>) => WorkflowNodeModel;
declare const buildCompletedNodeState: (node: WorkflowNodeModel, schema: WorkflowNodeSchema, input: Record<string, unknown>, result: WorkflowNodeHandlerResult) => WorkflowNodeModel;
declare const buildFailedNodeState: (node: WorkflowNodeModel, message: string) => WorkflowNodeModel;
declare const markRunningNodesAsStopped: (workflow: WorkflowDefinition) => WorkflowDefinition;

declare const createRunId: (prefix: "run" | "step") => string;
declare const logNodeStarted: (logger: WorkflowLogger, workflowId: string, runId: string, node: WorkflowNodeModel) => void;
declare const logNodeFinished: (logger: WorkflowLogger, workflowId: string, runId: string, nodeId: string, result: WorkflowNodeHandlerResult, durationMs?: number) => void;
declare const logNodeFailed: (logger: WorkflowLogger, workflowId: string, runId: string, nodeId: string, message: string) => void;
declare const logWorkflowStopped: (logger: WorkflowLogger, workflowId: string, runId: string) => void;
declare const logWorkflowCompleted: (logger: WorkflowLogger, workflowId: string, runId: string) => void;
declare const logWorkflowValidationFailed: (logger: WorkflowLogger, workflowId: string, runId: string, message: string) => void;

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
declare const buildWorkflowSummaryInput: (runId: string, outputsByNode: Map<string, unknown>, timingsByNode: WorkflowNodeExecutionTimingMap, logs: unknown[]) => Record<string, unknown>;

type WorkflowNodeViewers = NonNullable<WorkflowNodeModel['inspector']>['viewers'];
declare const buildViewersForOutput: (schema: WorkflowNodeSchema, existingViewers: WorkflowNodeViewers | undefined, output: unknown) => WorkflowNodeViewers;

export { type WorkflowNodeExecutionTiming, type WorkflowNodeExecutionTimingMap, buildCompletedNodeState, buildFailedNodeState, buildNodeInputContext, buildRunningNodeState, buildViewersForOutput, buildWorkflowSummaryInput, collectReachableNodeIdsFromStartNodes, createNodeExecutionTiming, createRunId, logNodeFailed, logNodeFinished, logNodeStarted, logWorkflowCompleted, logWorkflowStopped, logWorkflowValidationFailed, markRunningNodesAsStopped, replaceNodeById, shouldExecuteNodeInCurrentRun, sortWorkflowNodesTopologically };
