// src/types/index.ts
var WorkflowNodeStatusEnum = /* @__PURE__ */ ((WorkflowNodeStatusEnum2) => {
  WorkflowNodeStatusEnum2["Passed"] = "passed";
  WorkflowNodeStatusEnum2["Failed"] = "failed";
  WorkflowNodeStatusEnum2["Warning"] = "warning";
  WorkflowNodeStatusEnum2["Running"] = "running";
  WorkflowNodeStatusEnum2["Stopped"] = "stopped";
  return WorkflowNodeStatusEnum2;
})(WorkflowNodeStatusEnum || {});
var WorkflowNodeKindEnum = /* @__PURE__ */ ((WorkflowNodeKindEnum2) => {
  WorkflowNodeKindEnum2["Process"] = "process";
  WorkflowNodeKindEnum2["Output"] = "output";
  WorkflowNodeKindEnum2["Error"] = "error";
  return WorkflowNodeKindEnum2;
})(WorkflowNodeKindEnum || {});
var WorkflowLogLevelEnum = /* @__PURE__ */ ((WorkflowLogLevelEnum2) => {
  WorkflowLogLevelEnum2["Info"] = "info";
  WorkflowLogLevelEnum2["Warn"] = "warn";
  WorkflowLogLevelEnum2["Error"] = "error";
  return WorkflowLogLevelEnum2;
})(WorkflowLogLevelEnum || {});
var WorkflowExecutorModeEnum = /* @__PURE__ */ ((WorkflowExecutorModeEnum2) => {
  WorkflowExecutorModeEnum2["Local"] = "local";
  WorkflowExecutorModeEnum2["Server"] = "server";
  return WorkflowExecutorModeEnum2;
})(WorkflowExecutorModeEnum || {});

export {
  WorkflowNodeStatusEnum,
  WorkflowNodeKindEnum,
  WorkflowLogLevelEnum,
  WorkflowExecutorModeEnum
};
