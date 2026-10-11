const T = () => globalThis.__T;
const rec = (name) => async (...a) => { T().side(`graph.${name}`, a); return name === 'addEpisode' ? true : undefined; };
export const graphManager = {
  async getEntityContext(text) { T().side('graph.getEntityContext', text); return T().graphContext || ''; },
  upsertFact: rec('upsertFact'), addEpisode: rec('addEpisode'), retireFact: rec('retireFact'),
  init: async () => {}, addAlias: (...a) => T().side('graph.addAlias', a), isAvailable: () => true,
};
