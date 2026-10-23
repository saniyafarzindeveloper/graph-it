import { auth } from "@clerk/nextjs/server";
import { traceable } from "langsmith/traceable";
import { z } from "zod";
import { EXPLANATION_MODEL, invokeStructuredModel } from "@/lib/ai/client";
import { buildCurrentExplanationPrompt } from "@/lib/ai/prompts/current";
import { loadRepositorySourcesAtCommit } from "@/lib/analysis/repository-sources";
import { buildRetiredExplanationPrompt } from "@/evals/prompts/retired-v1";
import { collectExplanationEvidence, type EvalFileEdge, type EvalFilePath } from "@/lib/evals/path-context";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { logLangSmithPromptExperiments, prepareLangSmithDataset, type LangSmithPromptComparison } from "@/lib/evals/langsmith-experiments";

export const maxDuration = 300;

const ExplanationSchema = z.object({
  explanation: z.string().min(1),
  role: z.enum(["service", "repository", "model", "util", "config", "component", "hook"]).nullable(),
});

const JudgeSchema = z.object({
  v1: z.object({ usefulness: z.number().int().min(1).max(5), specificity: z.number().int().min(1).max(5), groundedness: z.number().int().min(1).max(5) }),
  v2: z.object({ usefulness: z.number().int().min(1).max(5), specificity: z.number().int().min(1).max(5), groundedness: z.number().int().min(1).max(5) }),
  winner: z.enum(["v1", "v2", "tie"]),
  rationale: z.string().min(1),
});

type CacheRow = {
  analysis_id: string;
  target_kind: "file" | "folder";
  target_path: string;
  source_paths: string[] | null;
  relationships: string[] | null;
  content: string;
  created_at: string;
};

const runPromptComparison = traceable(async (examples: Array<{
  targetKind: "file" | "folder";
  targetPath: string;
  caseId: string;
  sourcePaths: string[];
  relationships: string[];
  sources: Array<{ path: string; content: string }>;
  referenceExplanation: string;
}>) => {
  const results = [];
  for (const example of examples) {
    const promptInput = { ...example, classifyRole: false };
    const [v1, v2] = await Promise.all([
      invokeStructuredModel(ExplanationSchema, buildRetiredExplanationPrompt(promptInput), 60_000),
      invokeStructuredModel(ExplanationSchema, buildCurrentExplanationPrompt(promptInput), 60_000),
    ]);
    const judgeSources = example.sources.map(({ path, content }) => `FILE ${path}\n${content.slice(0, 3_000)}`).join("\n\n").slice(0, 18_000);
    const judge = await invokeStructuredModel(JudgeSchema, [
      {
        role: "system",
        content: "You are comparing two repository explanations. Score each independently from 1 to 5 for usefulness, specificity, and groundedness in the supplied source. Groundedness means claims and paths are supported by the source. Choose the better answer or tie, and briefly explain the decision. This is a subjective model-as-judge evaluation, not a deterministic fact.",
      },
      {
        role: "user",
        content: `TARGET: ${example.targetPath}\nRELATIONSHIPS:\n${example.relationships.join("\n") || "None"}\nSOURCES:\n${judgeSources}\n\nVERSION v1:\n${v1.explanation}\n\nVERSION v2:\n${v2.explanation}`,
      },
    ], 60_000);
    const average = (scores: typeof judge.v1) => Number(((scores.usefulness + scores.specificity + scores.groundedness) / 3).toFixed(2));
    results.push({
      targetPath: example.targetPath,
      targetKind: example.targetKind,
      caseId: example.caseId,
      v1: { explanation: v1.explanation, score: average(judge.v1), ...judge.v1 },
      v2: { explanation: v2.explanation, score: average(judge.v2), ...judge.v2 },
      winner: judge.winner,
      rationale: judge.rationale,
    });
  }
  return results;
}, { name: "prompt-version-evaluation", run_type: "chain" });

export async function POST() {
  const { orgId, getToken } = await auth();
  if (!orgId) return Response.json({ error: "Select a workspace to run evaluations." }, { status: 401 });
  const token = await getToken();
  if (!token) return Response.json({ error: "A workspace session token is required." }, { status: 401 });
  const client = getSupabaseServerClient(token);
  const { data: cacheRows, error: cacheError } = await client.from("explanation_cache")
    .select("analysis_id,target_kind,target_path,source_paths,relationships,content,created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (cacheError) return Response.json({ error: `Could not load saved explanations: ${cacheError.message}` }, { status: 500 });
  const uniqueRows = new Map<string, CacheRow>();
  for (const row of (cacheRows ?? []) as CacheRow[]) {
    const key = `${row.analysis_id}:${row.target_kind}:${row.target_path}`;
    if (!uniqueRows.has(key)) uniqueRows.set(key, row);
  }
  const rows = [...uniqueRows.values()].slice(0, 2);
  if (rows.length < 2) return Response.json({ error: "Prompt comparison needs at least two saved real explanations. Explain more files or folders first." }, { status: 422 });

  const analysisIds = [...new Set(rows.map((row) => row.analysis_id))];
  const [{ data: analyses, error: analysisError }, { data: fileRows, error: fileError }, { data: edgeRows, error: edgeError }] = await Promise.all([
    client.from("analyses").select("id,project_id,commit_sha").eq("organization_id", orgId).in("id", analysisIds),
    client.from("files").select("id,analysis_id,path,folder").eq("organization_id", orgId).in("analysis_id", analysisIds),
    client.from("edges").select("analysis_id,source_file_id,target_file_id").eq("organization_id", orgId).in("analysis_id", analysisIds),
  ]);
  if (analysisError) return Response.json({ error: `Could not load analysis context: ${analysisError.message}` }, { status: 500 });
  if (fileError) return Response.json({ error: `Could not load repository paths: ${fileError.message}` }, { status: 500 });
  if (edgeError) return Response.json({ error: `Could not load dependency relationships: ${edgeError.message}` }, { status: 500 });
  const analysisList = (analyses ?? []) as Array<{ id: string; project_id: string; commit_sha: string | null }>;
  const projectIds = [...new Set(analysisList.map((analysis) => analysis.project_id))];
  const { data: projects, error: projectError } = await client.from("projects").select("id,repository_url").eq("organization_id", orgId).in("id", projectIds);
  if (projectError) return Response.json({ error: `Could not load repository URLs: ${projectError.message}` }, { status: 500 });
  const analysisById = new Map(analysisList.map((analysis) => [analysis.id, analysis]));
  const projectById = new Map((projects ?? []).map((project) => [project.id as string, project.repository_url as string | null]));
  const files = (fileRows ?? []) as Array<EvalFilePath & { analysis_id: string }>;
  const edges = (edgeRows ?? []) as Array<EvalFileEdge & { analysis_id: string }>;

  const examples: Array<{
    targetKind: "file" | "folder";
    targetPath: string;
    caseId: string;
    sourcePaths: string[];
    relationships: string[];
    sources: Array<{ path: string; content: string }>;
    referenceExplanation: string;
  }> = [];
  try {
    for (const row of rows) {
      const analysis = analysisById.get(row.analysis_id);
      const repositoryUrl = analysis ? projectById.get(analysis.project_id) : null;
      if (!analysis?.commit_sha || !repositoryUrl) continue;
      const evidence = collectExplanationEvidence(
        row.target_kind,
        row.target_path,
        files.filter((file) => file.analysis_id === row.analysis_id),
        edges.filter((edge) => edge.analysis_id === row.analysis_id),
      );
      const sourcePaths = row.source_paths?.length ? row.source_paths : evidence.sourcePaths;
      const sources = await loadRepositorySourcesAtCommit(repositoryUrl, analysis.commit_sha, sourcePaths, row.target_path);
      if (sources.length === 0) continue;
      examples.push({
        targetKind: row.target_kind,
        targetPath: row.target_path,
        caseId: `${row.analysis_id}:${row.target_kind}:${row.target_path}`,
        sourcePaths,
        relationships: row.relationships ?? evidence.relationships,
        sources,
        referenceExplanation: row.content,
      });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load explanation source context." }, { status: 502 });
  }
  if (examples.length < 2) return Response.json({ error: "Could not reconstruct source context for at least two saved explanations." }, { status: 422 });

  let langSmithDataset;
  try {
    langSmithDataset = await prepareLangSmithDataset(orgId, examples);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? `Could not prepare the LangSmith evaluation dataset: ${error.message}` : "Could not prepare the LangSmith evaluation dataset." }, { status: 502 });
  }

  let comparisons: LangSmithPromptComparison[];
  try {
    comparisons = await runPromptComparison(examples);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Prompt comparison failed." }, { status: 502 });
  }

  let langSmith: { datasetName: string; experimentName: string; url: string | null } | null = null;
  let langSmithError: string | null = null;
  try {
    langSmith = await logLangSmithPromptExperiments(langSmithDataset, comparisons);
  } catch (error) {
    langSmithError = error instanceof Error ? error.message : "LangSmith could not record the prompt experiments.";
  }

  const v1Score = Number((comparisons.reduce((sum, result) => sum + result.v1.score, 0) / comparisons.length).toFixed(2));
  const v2Score = Number((comparisons.reduce((sum, result) => sum + result.v2.score, 0) / comparisons.length).toFixed(2));
  const metrics = {
    judge: "Gemini model-as-judge; subjective 1–5 rubric",
    sampleSize: comparisons.length,
    v1Score,
    v2Score,
    delta: Number((v2Score - v1Score).toFixed(2)),
    examples: comparisons.map((comparison) => ({
      targetPath: comparison.targetPath,
      targetKind: comparison.targetKind,
      v1: { score: comparison.v1.score, usefulness: comparison.v1.usefulness, specificity: comparison.v1.specificity, groundedness: comparison.v1.groundedness },
      v2: { score: comparison.v2.score, usefulness: comparison.v2.usefulness, specificity: comparison.v2.specificity, groundedness: comparison.v2.groundedness },
      winner: comparison.winner,
      rationale: comparison.rationale,
    })),
    langSmith,
    langSmithError,
  };
  const { error: saveError } = await client.from("eval_runs").insert({ organization_id: orgId, eval_type: "prompt_comparison", metrics });
  if (saveError) return Response.json({ error: `Could not save prompt comparison: ${saveError.message}` }, { status: 500 });
  return Response.json({ ...metrics, model: EXPLANATION_MODEL });
}
