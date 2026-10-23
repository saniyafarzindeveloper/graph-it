import { auth } from "@clerk/nextjs/server";
import { checkInventedPaths } from "@/lib/evals/invented-paths";
import { collectExplanationEvidence, type EvalFileEdge, type EvalFilePath } from "@/lib/evals/path-context";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type CachedExplanation = {
  id: string;
  analysis_id: string;
  target_kind: "file" | "folder";
  target_path: string;
  content: string;
  source_paths: string[] | null;
};

export async function POST() {
  const { orgId, getToken } = await auth();
  if (!orgId) return Response.json({ error: "Select a workspace to run evaluations." }, { status: 401 });
  const token = await getToken();
  if (!token) return Response.json({ error: "A workspace session token is required." }, { status: 401 });
  const client = getSupabaseServerClient(token);

  const { data: cached, error: cacheError } = await client.from("explanation_cache")
    .select("id,analysis_id,target_kind,target_path,content,source_paths")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (cacheError) return Response.json({ error: `Could not load recent explanations: ${cacheError.message}` }, { status: 500 });
  const entries = (cached ?? []) as CachedExplanation[];
  if (entries.length === 0) return Response.json({ error: "There are no saved explanations to evaluate yet." }, { status: 422 });

  const analysisIds = [...new Set(entries.map((entry) => entry.analysis_id))];
  const [{ data: fileRows, error: fileError }, { data: edgeRows, error: edgeError }] = await Promise.all([
    client.from("files").select("id,analysis_id,path,folder").eq("organization_id", orgId).in("analysis_id", analysisIds),
    client.from("edges").select("analysis_id,source_file_id,target_file_id").eq("organization_id", orgId).in("analysis_id", analysisIds),
  ]);
  if (fileError) return Response.json({ error: `Could not load analyzed paths: ${fileError.message}` }, { status: 500 });
  if (edgeError) return Response.json({ error: `Could not load analyzed dependencies: ${edgeError.message}` }, { status: 500 });
  const files = (fileRows ?? []) as Array<EvalFilePath & { analysis_id: string }>;
  const edges = (edgeRows ?? []) as Array<EvalFileEdge & { analysis_id: string }>;
  const filesByAnalysis = new Map<string, EvalFilePath[]>();
  const edgesByAnalysis = new Map<string, EvalFileEdge[]>();
  for (const file of files) filesByAnalysis.set(file.analysis_id, [...(filesByAnalysis.get(file.analysis_id) ?? []), file]);
  for (const edge of edges) edgesByAnalysis.set(edge.analysis_id, [...(edgesByAnalysis.get(edge.analysis_id) ?? []), edge]);

  const evaluated = entries.map((entry) => {
    const evidence = collectExplanationEvidence(
      entry.target_kind,
      entry.target_path,
      filesByAnalysis.get(entry.analysis_id) ?? [],
      edgesByAnalysis.get(entry.analysis_id) ?? [],
    );
    const sourcePaths = entry.source_paths?.length ? entry.source_paths : evidence.sourcePaths;
    return { entry, sourcePaths, result: checkInventedPaths(entry.content, sourcePaths) };
  });

  for (let start = 0; start < evaluated.length; start += 10) {
    const batch = evaluated.slice(start, start + 10);
    const updates = await Promise.all(batch.map(({ entry, sourcePaths, result }) => client.from("explanation_cache")
      .update({ source_paths: sourcePaths, path_check: result })
      .eq("id", entry.id)
      .eq("organization_id", orgId)));
    const failed = updates.find((update) => update.error);
    if (failed?.error) return Response.json({ error: `Could not save a path evaluation: ${failed.error.message}` }, { status: 500 });
  }

  const pathCount = evaluated.reduce((sum, item) => sum + item.result.totalPaths, 0);
  const validCount = evaluated.reduce((sum, item) => sum + item.result.validPaths, 0);
  return Response.json({
    evaluated: evaluated.length,
    pathTokens: pathCount,
    inventedPaths: pathCount - validCount,
    score: pathCount === 0 ? 100 : Math.round((validCount / pathCount) * 100),
    failures: evaluated.filter((item) => item.result.invalidPaths.length > 0).slice(0, 20).map(({ entry, result }) => ({
      targetPath: entry.target_path,
      invalidPaths: result.invalidPaths,
    })),
  });
}
