import { WorkflowDefinition, WorkflowNodeModel, WorkflowNodePortSchema, WorkflowNodeSchema } from '../types';

export interface WorkflowConnectionCompatibilityViolation {
    connectionId: string;
    message: string;
}

interface ValidatedConnection {
    connectionId: string;
    sourceUsageKey: string;
    targetUsageKey: string;
    sourceRule: WorkflowNodePortSchema;
    targetRule: WorkflowNodePortSchema;
    sourcePortName: string;
    targetPortName: string;
    connectionName: string;
}

const BI_DIRECTIONAL_PORT_TYPE = 'bi-directional';

const toRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
};

const toComparable = (value: string): string => value.trim().toLowerCase();

const toStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
};

const parsePortName = (handle: string | undefined, fallback: string): string => {
    if (!handle) return fallback;
    const [, parsed] = handle.split(':');
    return parsed?.trim() ? parsed.trim() : fallback;
};

const getNodeSchema = (workflow: WorkflowDefinition, node: WorkflowNodeModel): WorkflowNodeSchema | null => {
    const schema = workflow.nodeModels?.[node.modelId];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
    return schema;
};

const toPortRules = (value: unknown): Record<string, WorkflowNodePortSchema> => {
    const record = toRecord(value);
    if (!Object.keys(record).length) return {};
    return record as Record<string, WorkflowNodePortSchema>;
};

const resolveNodeGroup = (schema: WorkflowNodeSchema | null): string | undefined => {
    if (!schema) return undefined;
    const schemaGroup = toRecord(schema).group;
    if (typeof schemaGroup === 'string' && schemaGroup.trim().length > 0) return schemaGroup.trim();
    return undefined;
};

const matchesAcceptedModelIds = (sourceNode: WorkflowNodeModel, acceptedSourceModelIds: string[]): boolean => {
    if (!acceptedSourceModelIds.length) return true;
    return acceptedSourceModelIds.some((entry) => toComparable(entry) === toComparable(sourceNode.modelId));
};

const matchesAcceptedGroups = (sourceGroup: string | undefined, acceptedSourceGroups: string[]): boolean => {
    if (!acceptedSourceGroups.length) return true;
    if (!sourceGroup) return false;
    return acceptedSourceGroups.some((entry) => toComparable(entry) === toComparable(sourceGroup));
};

const allowsMultiple = (portRule: WorkflowNodePortSchema | undefined): boolean => portRule?.allowMultipleArrows !== false;

const hasNodeModelMetadata = (workflow: WorkflowDefinition): boolean => {
    const modelMap = workflow.nodeModels;
    if (!modelMap || typeof modelMap !== 'object') return false;
    return Object.keys(modelMap).length > 0;
};

export const validateWorkflowConnectionCompatibility = (workflow: WorkflowDefinition): WorkflowConnectionCompatibilityViolation[] => {
    if (!hasNodeModelMetadata(workflow)) return [];

    const violations: WorkflowConnectionCompatibilityViolation[] = [];
    const sourceUsage = new Map<string, number>();
    const targetUsage = new Map<string, number>();
    const validatedConnections: ValidatedConnection[] = [];

    workflow.connections.forEach((connection) => {
        const sourceNode = workflow.nodes.find((node) => node.id === connection.from);
        const targetNode = workflow.nodes.find((node) => node.id === connection.to);
        const connectionName = connection.name || connection.id;

        if (!sourceNode || !targetNode) {
            violations.push({
                connectionId: connection.id,
                message: `Connection "${connectionName}" references missing source/target nodes.`
            });
            return;
        }

        const sourceSchema = getNodeSchema(workflow, sourceNode);
        const targetSchema = getNodeSchema(workflow, targetNode);

        if (!sourceSchema || !targetSchema) return;

        const sourcePorts = toPortRules(sourceSchema.outputs);
        const targetPorts = toPortRules(targetSchema.inputs);

        if (!Object.keys(sourcePorts).length || !Object.keys(targetPorts).length) return;

        const sourcePortName = parsePortName(connection.sourceHandle, Object.keys(sourcePorts)[0] ?? 'output');
        const targetPortName = parsePortName(connection.targetHandle, Object.keys(targetPorts)[0] ?? 'input');
        const sourceRule = sourcePorts[sourcePortName];
        const targetRule = targetPorts[targetPortName];

        if (!sourceRule || !targetRule) {
            violations.push({
                connectionId: connection.id,
                message: `Connection "${connectionName}" uses unknown port(s): out:${sourcePortName} -> in:${targetPortName}.`
            });
            return;
        }

        const sourceIsBi = sourceRule.portType === BI_DIRECTIONAL_PORT_TYPE;
        const targetIsBi = targetRule.portType === BI_DIRECTIONAL_PORT_TYPE;
        if (sourceIsBi !== targetIsBi) {
            violations.push({
                connectionId: connection.id,
                message: `Connection "${connectionName}" must connect bi-directional ports to bi-directional ports only.`
            });
            return;
        }

        const acceptedSourceGroups = toStringArray(targetRule.acceptedSourceGroups);
        const acceptedSourceModelIds = toStringArray(targetRule.acceptedSourceModelIds);
        const sourceGroup = resolveNodeGroup(sourceSchema);

        if (!matchesAcceptedModelIds(sourceNode, acceptedSourceModelIds) || !matchesAcceptedGroups(sourceGroup, acceptedSourceGroups)) {
            violations.push({
                connectionId: connection.id,
                message: `Connection "${connectionName}" is an incompatible connection for target port in:${targetPortName}.`
            });
        }

        const sourceUsageKey = `${sourceNode.id}|${sourcePortName}`;
        const targetUsageKey = `${targetNode.id}|${targetPortName}`;
        sourceUsage.set(sourceUsageKey, (sourceUsage.get(sourceUsageKey) ?? 0) + 1);
        targetUsage.set(targetUsageKey, (targetUsage.get(targetUsageKey) ?? 0) + 1);

        validatedConnections.push({
            connectionId: connection.id,
            sourceUsageKey,
            targetUsageKey,
            sourceRule,
            targetRule,
            sourcePortName,
            targetPortName,
            connectionName
        });
    });

    validatedConnections.forEach((validated) => {
        const sourceUsageCount = sourceUsage.get(validated.sourceUsageKey) ?? 0;
        const targetUsageCount = targetUsage.get(validated.targetUsageKey) ?? 0;

        if (!allowsMultiple(validated.sourceRule) && sourceUsageCount > 1) {
            violations.push({
                connectionId: validated.connectionId,
                message: `Connection "${validated.connectionName}" exceeds source multiplicity for out:${validated.sourcePortName}.`
            });
        }

        if (!allowsMultiple(validated.targetRule) && targetUsageCount > 1) {
            violations.push({
                connectionId: validated.connectionId,
                message: `Connection "${validated.connectionName}" exceeds target multiplicity for in:${validated.targetPortName}.`
            });
        }
    });

    return violations;
};
