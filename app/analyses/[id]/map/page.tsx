import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CanvasPreview, type FileCategory } from "@/components/canvas-preview";
import { foldRepository } from "@/lib/canvas/folding";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { CoverageReport, RepoEdge, RepoFile } from "@/lib/repo-parser";

export const instant = false;

const categoryColors: Record<string, string> = {
  ts: "#60a5fa",
  tsx: "#34d399",
  js: "#f59e0b",
  jsx: "#f472b6",
  mjs: "#a78bfa",
  cjs: "#22d3ee",
  mts: "#4ade80",
  cts: "#fb7185",
};

const categoryLabels: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  mjs: "MJS",
  cjs: "CJS",
  mts: "MTS",
  cts: "CTS",
};

type PageProps = { params: Promise<{ id: string }> };

export default async function AnalysisMapPage({ params }: PageProps) {
  await auth.protect();
  const [{ id }, { orgId, getToken }] = await Promise.all([params, auth()]);
  const token = orgId ? await getToken() : null;
  if (!orgId || !token) notFound();

  const client = getSupabaseServerClient(token);
  const { data: analysis, error: analysisError } = await client.from("analyses")
    .select("id,name,status,coverage")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (analysisError || !analysis) notFound();
  if (analysis.status !== "completed") redirect(`/analyses/${id}`);

  const [{ data: storedFiles, error: filesError }, { data: storedEdges, error: edgesError }] = await Promise.all([
    client.from("files")
      .select("id,path,folder,extension,line_count,content_hash,module_name,fan_in,fan_out")
      .eq("analysis_id", id)
      .eq("organization_id", orgId)
      .order("path"),
    client.from("edges")
      .select("source_file_id,target_file_id,kind,specifier,resolution,reason")
      .eq("analysis_id", id)
      .eq("organization_id", orgId),
  ]);
  if (filesError || edgesError || !storedFiles) notFound();

  const filePaths = new Map(storedFiles.map((file) => [file.id as string, file.path as string]));
  const files: RepoFile[] = storedFiles.map((file) => ({
    path: file.path as string,
    folder: file.folder as string,
    extension: file.extension as string,
    lines: file.line_count ?? 0,
    hash: file.content_hash ?? "",
    moduleName: file.module_name ?? (file.path as string).replace(/\.[^.]+$/, ""),
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
  const categories: FileCategory[] = Object.entries(files.reduce<Record<string, number>>((counts, file) => {
    counts[file.extension] = (counts[file.extension] ?? 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right)).map(([extension, count]) => {
    const key = extension.replace(/^\./, "");
    return {
      id: extension,
      label: categoryLabels[key] ?? extension,
      count,
      color: categoryColors[key] ?? "#a1a1aa",
    };
  });
  const coverage = (analysis.coverage ?? {}) as CoverageReport;

  return (
    <div className="relative left-1/2 w-[calc(100vw-3rem)] max-w-none -translate-x-1/2 lg:flex lg:h-[calc(100svh-8rem)] lg:flex-col">
      <div className="mb-3 flex items-center justify-between gap-3 text-sm">
        <Link href={`/analyses/${id}`} className="text-(--app-muted) transition hover:text-(--app-fg)">← Analysis details</Link>
        <span className="truncate font-mono text-xs text-(--app-muted)">{analysis.name}</span>
      </div>
      <div className="lg:min-h-0 lg:flex-1">
      <CanvasPreview
        repoLabel={analysis.name}
        folders={folded.nodes}
        fileToNode={Array.from(folded.fileToNode.entries())}
        edges={edges}
        categories={categories}
        threshold={folded.threshold}
        coverage={coverage}
        framework={null}
        routeCount={null}
        unclassifiedCount={coverage.filesSkipped}
      />
      </div>
    </div>
  );
}
