const T = () => globalThis.__T;
export default class UserMemory {
  constructor() {}
  async retrieveRelevantContext(text) { T().side('memory.retrieve', text); return T().rag || { facts: [], workflows: [] }; }
  saveMemory(m) { T().side('memory.save', m); }
  adjustConfidence(key, delta) { T().side('memory.adjust', [key, delta]); }
}
