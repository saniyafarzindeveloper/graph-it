export interface PathCheckResult {
  checked: true;
  totalPaths: number;
  validPaths: number;
  invalidPaths: string[];
  score: number;
}

// Match repository-like paths and filenames with common source/config formats.
// This deliberately stays deterministic: every candidate is checked against
// the exact paths supplied to the model.
const PATH_TOKEN = /(?<![\w@.-])(?:\.\.?\/)?(?:[\w@.()[\]-]+\/)*[\w@.()[\]-]+\.(?:[cm]?[jt]sx?|jsonc?|mdx?|md|css|scss|sass|less|html|vue|svelte|ya?ml|toml|xml|sql|sh|mjs|cjs)(?![\w-])/gi;

export function checkInventedPaths(explanation: string, allowedPaths: Iterable<string>): PathCheckResult {
  const allowed = new Set(allowedPaths);
  const candidates = [...explanation.matchAll(PATH_TOKEN)].map(([value]) => value.replace(/^(?:\.\/|\.\.\/)/, ""));
  const invalidPaths = [...new Set(candidates.filter((candidate) => !allowed.has(candidate)))];
  const validPaths = candidates.length - candidates.filter((candidate) => !allowed.has(candidate)).length;
  return {
    checked: true,
    totalPaths: candidates.length,
    validPaths,
    invalidPaths,
    score: candidates.length === 0 ? 100 : Math.round((validPaths / candidates.length) * 100),
  };
}
