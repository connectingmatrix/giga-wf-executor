import { WorkflowNodeModel, WorkflowNodeSchema, WorkflowViewerType, WorkflowViewerTypeEnum } from '../types';

type WorkflowNodeViewers = NonNullable<WorkflowNodeModel['inspector']>['viewers'];

const resolveViewerOutputValue = (output: unknown, type: WorkflowViewerType): unknown => {
    if (type !== WorkflowViewerTypeEnum.Table) return output;
    if (output && typeof output === 'object' && Array.isArray((output as { rows?: unknown[] }).rows)) {
        return (output as { rows: unknown[] }).rows;
    }
    return [];
};

export const buildViewersForOutput = (
    schema: WorkflowNodeSchema,
    existingViewers: WorkflowNodeViewers | undefined,
    output: unknown
): WorkflowNodeViewers => {
    if (schema.outputViewers?.length) {
        return schema.outputViewers.map((viewer) => ({
            ...viewer,
            value: resolveViewerOutputValue(output, viewer.type)
        }));
    }

    const currentViewers = existingViewers ?? [];
    const jsonViewer = currentViewers.find((item) => item.type === WorkflowViewerTypeEnum.Json);
    if (jsonViewer) {
        return currentViewers.map((viewer) => (viewer.id === jsonViewer.id ? { ...viewer, value: output } : viewer));
    }
    return [{ id: 'json', label: 'JSON', type: WorkflowViewerTypeEnum.Json, value: output }];
};
