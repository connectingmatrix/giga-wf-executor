import { executeNodeStepWithContext } from './step-runner';
import { executeWorkflowWithContext } from './workflow-runner';
import { ExecuteNodeStepOptions, ExecuteWorkflowOptions, WorkflowExecutor, WorkflowExecutorAdapters, WorkflowExecutorMode, WorkflowExecutorModeEnum } from '../types';

export interface WorkflowExecutorFactoryArgs {
    mode: WorkflowExecutorMode;
    adapters: WorkflowExecutorAdapters;
}

export const createWorkflowExecutor = (args: WorkflowExecutorFactoryArgs): WorkflowExecutor => {
    const mode = args.mode || WorkflowExecutorModeEnum.Local;
    const runtime = {
        mode,
        adapters: args.adapters
    };

    return {
        mode,
        executeWorkflow: (workflow, options: ExecuteWorkflowOptions) => executeWorkflowWithContext(runtime, workflow, options),
        executeNodeStep: (options: ExecuteNodeStepOptions) => executeNodeStepWithContext(runtime, options)
    };
};
