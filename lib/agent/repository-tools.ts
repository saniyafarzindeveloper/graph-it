import { analyzeRepository, walkGraph } from "../canvas/analysis.js";
import type { RepoEdge, RepoFile } from "../repo-parser/index.js";
import type { FrameworkRoute } from "../repo-parser/adapters/types.js";
import { z } from "zod";

export interface RepositoryRole {
  filePath: string;
  role: string;
}

export interface RepositorySnapshot {
  files: RepoFile[];
  edges: RepoEdge[];
  routes: FrameworkRoute[];
  roles: RepositoryRole[];
  framework: string | null;
  importsSeen: number;
  importsResolved: number;
  importsOutside: number;
  importsExcluded: number;
  importsUnresolved: number;
}

export const REPOSITORY_TOOL_SCHEMAS = {
  summary: z.object({}),
  searchFiles: z.object({ pathFragment: z.string().trim().min(1).max(160) }),
  listByRole: z.object({ role: z.string().trim().min(1).max(100) }),
  directNeighbors: z.object({ path: z.string().trim().min(1).max(500) }),
  walkDependencies: z.object({
    path: z.string().trim().min(1).max(500),
    direction: z.enum(["dependency-chain", "blast-radius"]),
    maxDepth: z.number().int().min(1).max(20).default(5),
  }),
  routeTable: z.object({ search: z.string().trim().max(160).optional() }),
} as const;

export type RepositoryToolName = keyof typeof REPOSITORY_TOOL_SCHEMAS;

const MAX_RESULTS = 100;
const MAX_WALK_DEPTH = 20;

function capResults<T>(items: T[], limit = MAX_RESULTS): { items: T[]; truncated: boolean } {
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

export function runRepositoryTool(snapshot: RepositorySnapshot, name: RepositoryToolName, input: unknown) {
  switch (name) {
    case "summary": {
      const insights = analyzeRepository(snapshot.files, snapshot.edges);
      const rolesByName = new Map<string, number>();
      for (const assignment of snapshot.roles) rolesByName.set(assignment.role, (rolesByName.get(assignment.role) ?? 0) + 1);
      return {
        framework: snapshot.framework,
        fileCount: snapshot.files.length,
        dependencyCount: snapshot.edges.filter((edge) => edge.resolution === "inside").length,
        routeCount: snapshot.routes.length,
        imports: {
          seen: snapshot.importsSeen,
          resolvedInside: snapshot.importsResolved,
          outside: snapshot.importsOutside,
          excluded: snapshot.importsExcluded,
          unresolved: snapshot.importsUnresolved,
        },
        roles: Object.fromEntries([...rolesByName.entries()].sort(([a], [b]) => a.localeCompare(b))),
        insights: {
          unimportedFiles: capResults(insights.unimportedFiles),
          cycles: capResults(insights.cycles),
          highlyImportedFiles: capResults(insights.highlyImportedFiles),
          oversizedFiles: capResults(insights.oversizedFiles),
        },
      };
    }
    case "searchFiles": {
      const { pathFragment } = REPOSITORY_TOOL_SCHEMAS.searchFiles.parse(input);
      const matches = snapshot.files
        .filter((file) => file.path.toLocaleLowerCase().includes(pathFragment.toLocaleLowerCase()))
        .sort((a, b) => a.path.localeCompare(b.path));
      return {
        query: pathFragment,
        matches: capResults(matches).items.map(({ path, folder, extension, lines }) => ({ path, folder, extension, lines })),
        truncated: matches.length > MAX_RESULTS,
      };
    }
    case "listByRole": {
      const { role } = REPOSITORY_TOOL_SCHEMAS.listByRole.parse(input);
      const matches = snapshot.roles
        .filter((assignment) => assignment.role.toLocaleLowerCase() === role.toLocaleLowerCase())
        .map((assignment) => assignment.filePath)
        .sort();
      return { role, files: capResults(matches).items, count: matches.length, truncated: matches.length > MAX_RESULTS };
    }
    case "directNeighbors": {
      const { path } = REPOSITORY_TOOL_SCHEMAS.directNeighbors.parse(input);
      if (!snapshot.files.some((file) => file.path === path)) return { error: "That path is not present in the analyzed file list." };
      const imports = walkGraph(path, snapshot.files, snapshot.edges, "dependency-chain", 1).map(({ path: item }) => item);
      const dependents = walkGraph(path, snapshot.files, snapshot.edges, "blast-radius", 1).map(({ path: item }) => item);
      return { path, imports: capResults(imports), importedBy: capResults(dependents) };
    }
    case "walkDependencies": {
      const { path, direction, maxDepth } = REPOSITORY_TOOL_SCHEMAS.walkDependencies.parse(input);
      if (!snapshot.files.some((file) => file.path === path)) return { error: "That path is not present in the analyzed file list." };
      const boundedDepth = Math.max(1, Math.min(maxDepth, MAX_WALK_DEPTH));
      const entries = walkGraph(path, snapshot.files, snapshot.edges, direction, boundedDepth);
      const result = capResults(entries);
      return { startPath: path, direction, maxDepth: boundedDepth, files: result.items, truncated: result.truncated };
    }
    case "routeTable": {
      const { search } = REPOSITORY_TOOL_SCHEMAS.routeTable.parse(input);
      const query = search?.toLocaleLowerCase();
      const matches = snapshot.routes
        .filter((route) => !query || `${route.method} ${route.path} ${route.sourceFile}`.toLocaleLowerCase().includes(query))
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.sourceFile.localeCompare(b.sourceFile));
      const result = capResults(matches);
      return { routes: result.items, count: matches.length, truncated: result.truncated };
    }
  }
}
