import "server-only";

import type { ExplanationSource } from "@/lib/ai/types";

export interface Repository {
  owner: string;
  name: string;
}

export const GITHUB_TIMEOUT_MS = 20_000;
const MAX_SOURCE_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 600_000;

export function parseRepositoryUrl(value: string): Repository {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || parts.length !== 2) {
    throw new Error("This analysis needs a public GitHub repository URL.");
  }
  const owner = parts[0];
  const name = parts[1]?.replace(/\.git$/i, "");
  if (!owner || !name || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) {
    throw new Error("The saved GitHub repository URL is malformed.");
  }
  return { owner, name };
}

function sourceUrl(repository: Repository, commitSha: string, filePath: string) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${commitSha}/${encodedPath}`;
}

async function fetchSource(repository: Repository, commitSha: string, filePath: string, allowMissing = false) {
  const response = await fetch(sourceUrl(repository, commitSha, filePath), {
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    cache: "no-store",
  });
  if (response.status === 404 && allowMissing) return null;
  if (response.status === 404) throw new Error(`Could not retrieve ${filePath} from the analyzed commit.`);
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} while reading ${filePath}.`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 2_000_000) throw new Error(`${filePath} is too large to explain safely.`);
  const content = await response.text();
  if (Buffer.byteLength(content, "utf8") > 2_000_000) throw new Error(`${filePath} is too large to explain safely.`);
  return content;
}

export function fetchManySources(repository: Repository, commitSha: string, paths: string[], allowMissing: true): Promise<Map<string, string | null>>;
export function fetchManySources(repository: Repository, commitSha: string, paths: string[]): Promise<Map<string, string>>;
export async function fetchManySources(repository: Repository, commitSha: string, paths: string[], allowMissing = false) {
  const result = new Map<string, string | null>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, paths.length) }, async () => {
    while (cursor < paths.length) {
      const path = paths[cursor++];
      if (path) result.set(path, await fetchSource(repository, commitSha, path, allowMissing));
    }
  });
  await Promise.all(workers);
  return result;
}

export function buildSourceContext(sourceMap: Map<string, string>, focusPath: string): ExplanationSource[] {
  let remaining = MAX_CONTEXT_CHARS;
  const entries = [...sourceMap.entries()].sort(([left], [right]) => left.localeCompare(right));
  return entries.map(([path, content], index) => {
    const targetBudget = path === focusPath ? MAX_SOURCE_CHARS * 2 : MAX_SOURCE_CHARS;
    const budget = Math.min(targetBudget, Math.floor(remaining / Math.max(1, entries.length - index)));
    remaining -= budget;
    if (content.length <= budget) return { path, content };
    return { path, content: `${content.slice(0, budget)}\n/* source excerpt truncated for context size */` };
  });
}

export async function loadRepositorySourcesAtCommit(repositoryUrl: string, commitSha: string, paths: string[], focusPath: string) {
  const repository = parseRepositoryUrl(repositoryUrl);
  const sources = await fetchManySources(repository, commitSha, [...new Set(paths)]);
  return buildSourceContext(sources, focusPath);
}
