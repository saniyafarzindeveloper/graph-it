import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AgentCredentialClaims } from "@/lib/agent/credential";
import type { RepoEdge, RepoFile } from "@/lib/repo-parser";
import type { FrameworkRoute } from "@/lib/repo-parser/adapters/types";
import type { RepositorySnapshot } from "@/lib/agent/repository-tools";

const PAGE_SIZE = 1000;

async function readAllPages<Row>(load: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await load(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not read repository graph: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function loadCredentialRepositorySnapshot(claims: AgentCredentialClaims): Promise<RepositorySnapshot> {
  const client = getSupabaseServerClient(claims.databaseAccessToken);
  const { data: analysis, error: analysisError } = await client.from("analyses")
    .select("id,status,organization_id,framework,coverage")
    .eq("id", claims.analysisId)
    .eq("organization_id", claims.organizationId)
    .maybeSingle();
  if (analysisError) throw new Error(`Could not verify the analysis scope: ${analysisError.message}`);
  if (!analysis || analysis.status !== "completed") throw new Error("The scoped analysis is unavailable.");

  const files = await readAllPages((from, to) => client.from("files")
    .select("id,path,folder,extension,line_count,content_hash,module_name,commonjs_exports,fan_in,fan_out")
    .eq("analysis_id", claims.analysisId)
    .eq("organization_id", claims.organizationId)
    .order("path")
    .range(from, to));
  const [storedEdges, storedRoutes, storedRoles] = await Promise.all([
    readAllPages((from, to) => client.from("edges")
      .select("source_file_id,target_file_id,kind,specifier,resolution,reason")
      .eq("analysis_id", claims.analysisId)
      .eq("organization_id", claims.organizationId)
      .range(from, to)),
    readAllPages((from, to) => client.from("routes")
      .select("method,path,source_file")
      .eq("analysis_id", claims.analysisId)
      .eq("organization_id", claims.organizationId)
      .order("path")
      .range(from, to)),
    readAllPages((from, to) => client.from("file_roles")
      .select("file_id,role_name,files!inner(analysis_id)")
      .eq("organization_id", claims.organizationId)
      .eq("files.analysis_id", claims.analysisId)
      .range(from, to)),
  ]);

  const filePaths = new Map(files.map((file) => [String(file.id), String(file.path)]));
  const repoFiles: RepoFile[] = files.map((file) => ({
    path: String(file.path),
    folder: String(file.folder ?? "."),
    extension: String(file.extension ?? ""),
    lines: safeNumber(file.line_count),
    hash: String(file.content_hash ?? ""),
    moduleName: String(file.module_name ?? String(file.path).replace(/\.[^.]+$/, "")),
    commonJsExports: Array.isArray(file.commonjs_exports) ? file.commonjs_exports.map(String) : [],
    fanIn: safeNumber(file.fan_in),
    fanOut: safeNumber(file.fan_out),
  }));
  const repoEdges: RepoEdge[] = storedEdges.flatMap((edge) => {
    const source = filePaths.get(String(edge.source_file_id));
    const target = filePaths.get(String(edge.target_file_id));
    if (!source || !target) return [];
    const kind = ["import", "re-export", "dynamic-import", "require"].includes(String(edge.kind))
      ? String(edge.kind) as RepoEdge["kind"]
      : "import";
    const resolution = ["inside", "outside", "excluded", "unresolved"].includes(String(edge.resolution))
      ? String(edge.resolution) as RepoEdge["resolution"]
      : "unresolved";
    return [{
      source,
      target,
      kind,
      specifier: String(edge.specifier ?? ""),
      resolution,
      ...(typeof edge.reason === "string" ? { reason: edge.reason } : {}),
    }];
  });
  const routes: FrameworkRoute[] = storedRoutes.flatMap((route) =>
    typeof route.source_file === "string"
      ? [{ method: String(route.method), path: String(route.path), sourceFile: route.source_file }]
      : [],
  );
  const roles = storedRoles.flatMap((role) => {
    const filePath = filePaths.get(String(role.file_id));
    return filePath ? [{ filePath, role: String(role.role_name) }] : [];
  });
  const coverage = typeof analysis.coverage === "object" && analysis.coverage !== null
    ? analysis.coverage as Record<string, unknown>
    : {};

  return {
    files: repoFiles,
    edges: repoEdges,
    routes,
    roles,
    framework: typeof analysis.framework === "string" ? analysis.framework : null,
    importsSeen: safeNumber(coverage.importsSeen),
    importsResolved: safeNumber(coverage.importsResolved),
    importsOutside: safeNumber(coverage.importsOutside),
    importsExcluded: safeNumber(coverage.importsExcluded),
    importsUnresolved: safeNumber(coverage.importsUnresolved),
  };
}
