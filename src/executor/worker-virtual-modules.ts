export const createVirtualExecuteModuleSource = (helperId: string): string => `
const helpers = (globalThis.__WF_EXECUTE_HELPERS__ || {})[${JSON.stringify(helperId)}] || {};
export const executeBackend = async (...args) => {
  if (typeof helpers.executeBackend !== 'function') {
    throw new Error('executeBackend helper is not available in worker runtime.');
  }
  return helpers.executeBackend(...args);
};
export const invokeConnectedNode = async (...args) => {
  if (typeof helpers.invokeConnectedNode !== 'function') {
    throw new Error('invokeConnectedNode helper is not available in worker runtime.');
  }
  return helpers.invokeConnectedNode(...args);
};
export const updateNode = async (...args) => {
  if (typeof helpers.updateNode !== 'function') {
    return null;
  }
  return helpers.updateNode(...args);
};
`;

export const createVirtualExecutorModuleSource = (): string => `
const toRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const normalizeStatus = (status) => {
  if (status === 'failed') return 'failed';
  if (status === 'warning') return 'warning';
  if (status === 'running') return 'running';
  if (status === 'stopped') return 'stopped';
  return 'passed';
};
export const normalizeResult = (result) => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { output: result ?? null, status: 'passed', logs: [] };
  }
  const record = result;
  const logs = Array.isArray(record.logs)
    ? record.logs.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
    : [];
  return {
    output: Object.prototype.hasOwnProperty.call(record, 'output') ? record.output : record,
    status: normalizeStatus(record.status),
    logs
  };
};
export const toErrorResult = (message, logs = []) => ({
  output: { error: String(message) },
  status: 'failed',
  logs: [...logs, String(message)]
});
export const toNode = (payload) => toRecord(toRecord(payload).NODE);
export { toRecord };
`;

export const createBrowserNodeBuiltinStubSource = (): string => `
const createStub = () => {
  let proxy;
  const fn = () => undefined;
  const handler = {
    get: (_target, key) => (key === 'then' ? undefined : proxy),
    apply: () => undefined,
    construct: () => ({})
  };
  proxy = new Proxy(fn, handler);
  return proxy;
};
const stub = createStub();
export default stub;
`;
