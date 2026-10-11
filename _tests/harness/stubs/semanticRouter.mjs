const T = () => globalThis.__T;
export const semanticRouter = {
  async getDeterministicRoute(ctx) {
    const plan = T().deterministic ? T().deterministic(ctx) : null;
    T().main('router.deterministic', plan ? plan.map((s) => s.tool) : null);
    return plan;
  },
};
