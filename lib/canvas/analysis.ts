import type { RepoEdge, RepoFile } from "@/lib/repo-parser/index";

export type GraphWalkMode = "blast-radius" | "dependency-chain";

export interface GraphWalkEntry {
  path: string;
  depth: number;
}

export interface RepositoryInsights {
  unimportedFiles: string[];
  cycles: string[][];
  highlyImportedFiles: string[];
  oversizedFiles: string[];
}

const MAX_INSIGHT_LINES = 500;

function isDiscoveredEntryPoint(filePath: string): boolean {
  const name = filePath.split("/").at(-1)?.toLowerCase() ?? "";
  const stem = name.replace(/\.(?:[cm]?[jt]sx?)$/, "");

  if (/\.(?:test|spec|stories)\./i.test(name) || /(^|\/)(__tests__|tests?)\//i.test(filePath)) return true;

  if ([
    "page", "route", "layout", "template", "default", "loading", "error",
    "not-found", "global-error", "middleware", "instrumentation", "index",
    "_app", "_document", "_error",
    "vite.config", "next.config", "nuxt.config", "astro.config", "svelte.config",
    "webpack.config", "rollup.config", "postcss.config", "tailwind.config",
    "jest.config", "vitest.config", "playwright.config", "babel.config",
    "eslint.config", "biome.config",
  ].includes(stem)) return true;

  // Pages and route modules are commonly discovered by frameworks without an import.
  if (/(^|\/)(pages|routes)\//i.test(filePath)) return true;

  return /(^|\/)app\//i.test(filePath) &&
    /^(page|route|layout|template|default|loading|error|not-found|global-error)\./i.test(name);
}

function makeAdjacency(files: RepoFile[], edges: RepoEdge[], direction: GraphWalkMode): Map<string, string[]> {
  const known = new Set(files.map((file) => file.path));
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.resolution !== "inside" || !known.has(edge.source) || !known.has(edge.target)) continue;
    const from = direction === "blast-radius" ? edge.target : edge.source;
    const to = direction === "blast-radius" ? edge.source : edge.target;
    const neighbors = adjacency.get(from) ?? new Set<string>();
    neighbors.add(to);
    adjacency.set(from, neighbors);
  }
  return new Map([...adjacency].map(([path, neighbors]) => [path, [...neighbors].sort()]));
}

/** Walk import edges from a file. Blast radius follows dependents; dependency chain follows imports. */
export function walkGraph(
  startPath: string,
  files: RepoFile[],
  edges: RepoEdge[],
  mode: GraphWalkMode,
  maxDepth = 2,
): GraphWalkEntry[] {
  if (!files.some((file) => file.path === startPath) || maxDepth < 1) return [];
  const adjacency = makeAdjacency(files, edges, mode);
  const visited = new Set([startPath]);
  const queue: GraphWalkEntry[] = [{ path: startPath, depth: 0 }];
  const result: GraphWalkEntry[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current || current.depth >= maxDepth) continue;
    for (const path of adjacency.get(current.path) ?? []) {
      if (visited.has(path)) continue;
      visited.add(path);
      const entry = { path, depth: current.depth + 1 };
      result.push(entry);
      queue.push(entry);
    }
  }
  return result;
}

function findCyclicComponents(files: RepoFile[], edges: RepoEdge[]): string[][] {
  const paths = files.map((file) => file.path).sort();
  const known = new Set(paths);
  const forward = new Map(paths.map((path) => [path, new Set<string>()]));
  const reverse = new Map(paths.map((path) => [path, new Set<string>()]));
  for (const edge of edges) {
    if (edge.resolution !== "inside" || !known.has(edge.source) || !known.has(edge.target)) continue;
    forward.get(edge.source)?.add(edge.target);
    reverse.get(edge.target)?.add(edge.source);
  }

  // Iterative Kosaraju pass 1: record finishing order without using the call stack.
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const start of paths) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ path: string; neighbors: string[]; next: number }> = [
      { path: start, neighbors: [...(forward.get(start) ?? [])].sort(), next: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      if (frame.next < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.next++];
        if (neighbor && !visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push({ path: neighbor, neighbors: [...(forward.get(neighbor) ?? [])].sort(), next: 0 });
        }
      } else {
        finishOrder.push(frame.path);
        stack.pop();
      }
    }
  }

  // Iterative reverse pass groups strongly connected files; groups larger than one are cycles.
  const assigned = new Set<string>();
  const cycles: string[][] = [];
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const start = finishOrder[index];
    if (!start || assigned.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    assigned.add(start);
    while (stack.length > 0) {
      const path = stack.pop();
      if (!path) continue;
      component.push(path);
      for (const neighbor of reverse.get(path) ?? []) {
        if (assigned.has(neighbor)) continue;
        assigned.add(neighbor);
        stack.push(neighbor);
      }
    }
    const selfLoop = component.length === 1 && (forward.get(component[0]!)?.has(component[0]!) ?? false);
    if (component.length > 1 || selfLoop) cycles.push(component.sort());
  }
  return cycles.sort((left, right) => left[0]!.localeCompare(right[0]!));
}

export function analyzeRepository(files: RepoFile[], edges: RepoEdge[]): RepositoryInsights {
  const unimportedFiles = files
    .filter((file) => file.fanIn === 0 && !isDiscoveredEntryPoint(file.path))
    .map((file) => file.path)
    .sort();

  const averageFanIn = files.length === 0
    ? 0
    : files.reduce((sum, file) => sum + file.fanIn, 0) / files.length;
  const variance = files.length === 0
    ? 0
    : files.reduce((sum, file) => sum + (file.fanIn - averageFanIn) ** 2, 0) / files.length;
  const highFanInThreshold = Math.max(5, Math.ceil(averageFanIn + 2 * Math.sqrt(variance)));

  return {
    unimportedFiles,
    cycles: findCyclicComponents(files, edges),
    highlyImportedFiles: files
      .filter((file) => file.fanIn >= highFanInThreshold && file.fanIn > averageFanIn)
      .sort((left, right) => right.fanIn - left.fanIn || left.path.localeCompare(right.path))
      .map((file) => file.path),
    oversizedFiles: files
      .filter((file) => file.lines > MAX_INSIGHT_LINES)
      .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
      .map((file) => file.path),
  };
}
