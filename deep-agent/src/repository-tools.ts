import { tool } from "langchain";
import { REPOSITORY_TOOL_SCHEMAS, type RepositoryToolName } from "../../lib/agent/repository-tools.js";

export interface RepositoryToolAccess {
  credential: string;
  toolsBaseUrl?: string;
}

const TOOL_ENDPOINTS: Record<RepositoryToolName, string> = {
  summary: "summary",
  searchFiles: "search-files",
  listByRole: "files-by-role",
  directNeighbors: "neighbors",
  walkDependencies: "walk",
  routeTable: "routes",
};

async function queryToolEndpoint<T extends Record<string, string | number | undefined>>(
  access: RepositoryToolAccess,
  name: RepositoryToolName,
  args: T,
) {
  if (!access.credential.trim()) throw new Error("A short-lived analysis credential is required.");
  const baseUrl = access.toolsBaseUrl ?? process.env.REPOSITORY_TOOLS_URL ?? "http://localhost:3000";
  const url = new URL(`/api/agent/tools/${TOOL_ENDPOINTS[name]}`, baseUrl);
  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) throw new Error("Repository tool credentials may only be sent over HTTPS (or localhost during development).");
  for (const [key, value] of Object.entries(args)) if (value !== undefined) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${access.credential}`, accept: "application/json" },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Repository tool endpoint returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (typeof payload === "object" && payload !== null) {
    if ("credential" in payload && typeof payload.credential === "string") {
      access.credential = payload.credential;
    }
    if ("result" in payload) return JSON.stringify(payload.result) ?? "null";
  }
  return JSON.stringify(payload);
}

export function createRepositoryTools(access: RepositoryToolAccess) {
  return [
    tool(() => queryToolEndpoint(access, "summary", {}), {
      name: "get_repository_summary",
      description: "Return exact repository counts, framework, role counts, parser coverage, and graph insights. Call this before answering repository-wide questions. It does not judge code quality.",
      schema: REPOSITORY_TOOL_SCHEMAS.summary,
    }),
    tool(({ pathFragment }) => queryToolEndpoint(access, "searchFiles", { pathFragment }), {
      name: "search_files_by_path",
      description: "Find analyzed source files whose exact path contains the supplied case-insensitive fragment. Returns stored paths and metadata only.",
      schema: REPOSITORY_TOOL_SCHEMAS.searchFiles,
    }),
    tool(({ role }) => queryToolEndpoint(access, "listByRole", { role }), {
      name: "list_files_by_role",
      description: "List source file paths assigned the exact framework or conventional role label, such as Page routes, Services, or Components. Do not invent role assignments.",
      schema: REPOSITORY_TOOL_SCHEMAS.listByRole,
    }),
    tool(({ path }) => queryToolEndpoint(access, "directNeighbors", { path }), {
      name: "get_direct_neighbors",
      description: "Return direct in-repository import targets and direct dependents for an exact analyzed file path. The dependency direction uses the same graph walk as the map.",
      schema: REPOSITORY_TOOL_SCHEMAS.directNeighbors,
    }),
    tool(({ path, direction, maxDepth }) => queryToolEndpoint(access, "walkDependencies", { path, direction, maxDepth }), {
      name: "walk_dependencies",
      description: "Walk the stored dependency graph from an exact file path. Use dependency-chain for imports or blast-radius for dependents. This tool selects the start and direction; the shared map graph function performs the walk.",
      schema: REPOSITORY_TOOL_SCHEMAS.walkDependencies,
    }),
    tool(({ search }) => queryToolEndpoint(access, "routeTable", { search }), {
      name: "get_route_table",
      description: "Return exact framework routes stored by the repository parser, optionally filtered by method, route path, or source file. Never infer routes from naming conventions.",
      schema: REPOSITORY_TOOL_SCHEMAS.routeTable,
    }),
  ] as const;
}
