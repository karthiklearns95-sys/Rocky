const T = () => globalThis.__T;
export const delegationManager = {
  async dispatchToWorker(payload) { T().side('delegation.dispatch', payload); return 'dispatched'; },
};
