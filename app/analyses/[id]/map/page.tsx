import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CanvasPreview, type FileCategory } from "@/components/canvas-preview";
import { AnalysisRerunButton } from "@/components/analysis-rerun-button";
import { foldRepository } from "@/lib/canvas/folding";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { CoverageReport, RepoEdge, RepoFile } from "@/lib/repo-parser";
import { getFrameworkTaxonomy } from "@/lib/repo-parser/taxonomy";
import type { FrameworkId, FrameworkRoute } from "@/lib/repo-parser/adapters/types";
import { isTracingConfigured } from "@/lib/ai/client";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export default async function AnalysisMapPage({ params }: PageProps) {
  await auth.protect();
  const [{ id }, { orgId, getToken }] = await Promise.all([params, auth()]);
  const token = orgId ? await getToken() : null;
  if (!orgId || !token) notFound();

  const client = getSupabaseServerClient(token);
  const { data: analysis, error: analysisError } = await client.from("analyses")
    .select("id,name,status,coverage,framework")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (analysisError || !analysis) notFound();
  if (analysis.status !== "completed") redirect(`/analyses/${id}`);

  const [
    { data: storedFiles, error: filesError },
    { data: storedEdges, error: edgesError },
    { data: storedRoutes, error: routesError },
  ] = await Promise.all([
    client.from("files")
      .select("id,path,folder,extension,line_count,content_hash,module_name,commonjs_exports,fan_in,fan_out")
      .eq("analysis_id", id)
      .eq("organization_id", orgId)
      .order("path"),
    client.from("edges")
      .select("source_file_id,target_file_id,kind,specifier,resolution,reason")
      .eq("analysis_id", id)
      .eq("organization_id", orgId),
    client.from("routes")
      .select("method,path,source_file")
      .eq("analysis_id", id)
      .eq("organization_id", orgId)
      .order("path"),
  ]);
  if (filesError || edgesError || routesError || !storedFiles) notFound();
  const { data: storedRoles, error: rolesError } = await client.from("file_roles")
    .select("file_id,role_name,files!inner(analysis_id)")
    .eq("organization_id", orgId)
    .eq("files.analysis_id", id);
  if (rolesError) notFound();

  const filePaths = new Map(storedFiles.map((file) => [file.id as string, file.path as string]));
  const files: RepoFile[] = storedFiles.map((file) => ({
    path: file.path as string,
    folder: file.folder as string,
    extension: file.extension as string,
    lines: file.line_count ?? 0,
    hash: file.content_hash ?? "",
    moduleName: file.module_name ?? (file.path as string).replace(/\.[^.]+$/, ""),
    commonJsExports: Array.isArray(file.commonjs_exports) ? file.commonjs_exports as string[] : [],
    fanIn: file.fan_in ?? 0,
    fanOut: file.fan_out ?? 0,
  }));
  const edges: RepoEdge[] = (storedEdges ?? []).flatMap((edge) => {
    const source = filePaths.get(edge.source_file_id as string);
    const target = edge.target_file_id ? filePaths.get(edge.target_file_id as string) : undefined;
    if (!source || !target) return [];
    return [{
      source,
      target,
      kind: edge.kind as RepoEdge["kind"],
      specifier: edge.specifier as string,
      resolution: edge.resolution as RepoEdge["resolution"],
      ...(edge.reason ? { reason: edge.reason as string } : {}),
    }];
  });
  const folded = foldRepository(files, edges);
  const frameworkValue = analysis.framework as FrameworkId;
  const framework: FrameworkId = ["next", "nestjs", "express", "react", "generic"].includes(frameworkValue) ? frameworkValue : "generic";
  const taxonomy = getFrameworkTaxonomy(framework);
  const rolesByFile = new Map<string, Set<string>>();
  const pathsByRole = new Map<string, Set<string>>();
  const filePathById = new Map(storedFiles.map((file) => [file.id as string, file.path as string]));
  for (const role of storedRoles ?? []) {
    const filePath = filePathById.get(role.file_id as string);
    if (!filePath) continue;
    const names = rolesByFile.get(filePath) ?? new Set<string>();
    names.add(role.role_name as string);
    rolesByFile.set(filePath, names);
    const paths = pathsByRole.get(role.role_name as string) ?? new Set<string>();
    paths.add(filePath);
    pathsByRole.set(role.role_name as string, paths);
  }
  const categories: FileCategory[] = taxonomy.categories.map((category) => {
    const filePaths = framework === "generic"
      ? files.filter((file) => !rolesByFile.has(file.path)).map((file) => file.path)
      : category.name === "Other files"
        ? files.filter((file) => !rolesByFile.has(file.path)).map((file) => file.path)
        : [...(pathsByRole.get(category.name) ?? [])];
    return { id: category.name, label: category.name, count: filePaths.length, color: category.color, filePaths };
  });
  const aiRoleColors: Record<string, string> = {
    service: "#f59e0b", repository: "#34d399", model: "#fb7185", util: "#a78bfa",
    config: "#fbbf24", component: "#38bdf8", hook: "#c084fc",
  };
  const aiRoleNames = [...new Set((storedRoles ?? []).map((role) => role.role_name as string).filter((name) => name.startsWith("ai:")))];
  for (const roleName of aiRoleNames) {
    const roleValue = roleName.slice(3);
    const filePaths = [...(pathsByRole.get(roleName) ?? [])];
    categories.push({
      id: roleName,
      label: `AI · ${roleValue.charAt(0).toUpperCase()}${roleValue.slice(1)}`,
      count: filePaths.length,
      color: aiRoleColors[roleValue] ?? "#a78bfa",
      filePaths,
    });
  }
  const initialAiRoles = [...rolesByFile.entries()].flatMap(([filePath, roleNames]) =>
    [...roleNames].filter((name) => name.startsWith("ai:")).map((name) => [filePath, name.slice(3)] as [string, string]),
  );
  const coverage = (analysis.coverage ?? {}) as CoverageReport;
  const routes: FrameworkRoute[] = (storedRoutes ?? []).flatMap((route) =>
    typeof route.source_file === "string"
      ? [{ method: route.method as string, path: route.path as string, sourceFile: route.source_file }]
      : [],
  );

  return (
    <div className="relative left-1/2 w-[calc(100vw-3rem)] max-w-none -translate-x-1/2 lg:flex lg:h-[calc(100svh-8rem)] lg:flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link href={`/analyses/${id}`} className="text-(--app-muted) transition hover:text-(--app-fg)">← Analysis details</Link>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <span
            aria-label={framework === "generic" ? "Framework not detected" : `Detected framework: ${taxonomy.label}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${framework === "generic" ? "border-amber-400/30 bg-amber-500/10 text-amber-300" : "border-sky-400/30 bg-sky-500/10 text-sky-200"}`}
          >
            <span aria-hidden="true" className={`size-1.5 rounded-full ${framework === "generic" ? "bg-amber-400" : "bg-sky-400"}`} />
            Framework: {framework === "generic" ? "Not detected" : taxonomy.label}
          </span>
          <AnalysisRerunButton analysisId={id} />
        </div>
      </div>
      <div className="lg:min-h-0 lg:flex-1">
      <CanvasPreview
        analysisId={id}
        tracingConfigured={isTracingConfigured()}
        initialAiRoles={initialAiRoles}
        repoLabel={analysis.name}
        folders={folded.nodes}
        fileToNode={Array.from(folded.fileToNode.entries())}
        edges={edges}
        categories={categories}
        categoriesTitle={`${taxonomy.label} roles`}
        routes={routes}
        threshold={folded.threshold}
        coverage={coverage}
        framework={taxonomy.label}
        routeCount={routes.length}
        unclassifiedCount={coverage.filesSkipped}
      />
      </div>
    </div>
  );
}
