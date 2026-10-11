const T = () => globalThis.__T;
export async function extractFacts(input) {
  T().side('facts.extract', input);
  return T().facts || { facts: [], retired: [], aliases: [] };
}
