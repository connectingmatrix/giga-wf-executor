"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/types/index.ts
var types_exports = {};
__export(types_exports, {
  WorkflowExecutorModeEnum: () => WorkflowExecutorModeEnum,
  WorkflowLogLevelEnum: () => WorkflowLogLevelEnum,
  WorkflowNodeKindEnum: () => WorkflowNodeKindEnum,
  WorkflowNodeStatusEnum: () => WorkflowNodeStatusEnum,
  WorkflowViewerTypeEnum: () => WorkflowViewerTypeEnum
});
module.exports = __toCommonJS(types_exports);
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
var WorkflowViewerTypeEnum = /* @__PURE__ */ ((WorkflowViewerTypeEnum2) => {
  WorkflowViewerTypeEnum2["Json"] = "json";
  WorkflowViewerTypeEnum2["Markdown"] = "markdown";
  WorkflowViewerTypeEnum2["Raw"] = "raw";
  WorkflowViewerTypeEnum2["Table"] = "table";
  return WorkflowViewerTypeEnum2;
})(WorkflowViewerTypeEnum || {});
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  WorkflowExecutorModeEnum,
  WorkflowLogLevelEnum,
  WorkflowNodeKindEnum,
  WorkflowNodeStatusEnum,
  WorkflowViewerTypeEnum
});
