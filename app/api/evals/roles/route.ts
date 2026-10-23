import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { buildCurrentExplanationPrompt } from "@/lib/ai/prompts/current";
import { generateExplanationFromPrompt } from "@/lib/ai/client";
import { loadRepositorySourcesAtCommit } from "@/lib/analysis/repository-sources";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const RoleSchema = z.object({
  explanation: z.string().min(1),
  role: z.enum(["service", "repository", "model", "util", "config", "component", "hook"]).nullable(),
});

const ROLE_BY_CONVENTION: Record<string, string> = {
  Services: "service",
  Models: "model",
  Entities: "model",
  Components: "component",
  Hooks: "hook",
};

type Analysis = { id: string; project_id: string; commit_sha: string | null; created_at: string };
type FileRow = { id: string; path: string; analysis_id: string };
type Candidate = { file: FileRow; analysis: Analysis; repositoryUrl: string; expected: string };

async function mapConcurrent<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T);
    }
  }));
  return results;
}

export async function POST() {
  const { orgId, getToken } = await auth();
  if (!orgId) return Response.json({ error: "Select a workspace to run evaluations." }, { status: 401 });
  const token = await getToken();
  if (!token) return Response.json({ error: "A workspace session token is required." }, { status: 401 });
  const client = getSupabaseServerClient(token);

  const { data: analyses, error: analysesError } = await client.from("analyses")
    .select("id,project_id,commit_sha,created_at")
    .eq("organization_id", orgId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(100);
  if (analysesError) return Response.json({ error: `Could not load analyses: ${analysesError.message}` }, { status: 500 });
  const analysisRows = (analyses ?? []) as Analysis[];
  const analysisIds = analysisRows.map((analysis) => analysis.id);
  if (analysisIds.length === 0) return Response.json({ error: "Complete at least one analysis before running role accuracy." }, { status: 422 });

  const [{ data: projects, error: projectError }, { data: fileRows, error: fileError }, { data: roleRows, error: roleError }] = await Promise.all([
    client.from("projects").select("id,repository_url").eq("organization_id", orgId),
    client.from("files").select("id,path,analysis_id").eq("organization_id", orgId).in("analysis_id", analysisIds).limit(5000),
    client.from("file_roles").select("file_id,role_name").eq("organization_id", orgId).limit(5000),
  ]);
  if (projectError) return Response.json({ error: `Could not load repository records: ${projectError.message}` }, { status: 500 });
  if (fileError) return Response.json({ error: `Could not load analyzed files: ${fileError.message}` }, { status: 500 });
  if (roleError) return Response.json({ error: `Could not load conventional roles: ${roleError.message}` }, { status: 500 });

  const analysisById = new Map(analysisRows.map((analysis) => [analysis.id, analysis]));
  const projectUrl = new Map((projects ?? []).map((project) => [project.id as string, project.repository_url as string | null]));
  const fileById = new Map(((fileRows ?? []) as FileRow[]).map((file) => [file.id, file]));
  const roleByFile = new Map<string, string>();
  for (const row of roleRows ?? []) {
    const expected = ROLE_BY_CONVENTION[row.role_name as string];
    const fileId = row.file_id as string;
    if (expected && !roleByFile.has(fileId)) roleByFile.set(fileId, expected);
  }
  const candidates: Candidate[] = [];
  for (const [fileId, expected] of roleByFile) {
    const file = fileById.get(fileId);
    const analysis = file ? analysisById.get(file.analysis_id) : null;
    const repositoryUrl = analysis ? projectUrl.get(analysis.project_id) : null;
    if (file && analysis?.commit_sha && repositoryUrl) candidates.push({ file, analysis, repositoryUrl, expected });
  }
  if (candidates.length < 30) {
    return Response.json({
      error: `Role accuracy needs at least 30 eligible conventional labels. This workspace has ${candidates.length}. Analyze more React, Express, or NestJS repositories with conventional components, hooks, services, models, or entities.`,
      eligible: candidates.length,
    }, { status: 422 });
  }

  const sample = candidates.slice(0, 30);
  let prepared: Array<{ candidate: Candidate; messages: ReturnType<typeof buildCurrentExplanationPrompt> }>;
  try {
    prepared = await mapConcurrent(sample, 10, async (candidate) => {
      const [source] = await loadRepositorySourcesAtCommit(
        candidate.repositoryUrl,
        candidate.analysis.commit_sha as string,
        [candidate.file.path],
        candidate.file.path,
      );
      if (!source) throw new Error(`Could not retrieve ${candidate.file.path} from its analyzed commit.`);
      const messages = buildCurrentExplanationPrompt({
        targetKind: "file",
        targetPath: candidate.file.path,
        relationships: [],
        sources: [source],
        classifyRole: true,
      });
      return { candidate, messages };
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the role evaluation dataset." }, { status: 502 });
  }

  let results: Array<{ path: string; expected: string; actual: string | null; correct: boolean }>;
  try {
    results = await mapConcurrent(prepared, 3, async ({ candidate, messages }) => {
      const result = await generateExplanationFromPrompt(messages, 20_000);
      const parsed = RoleSchema.parse(result);
      return { path: candidate.file.path, expected: candidate.expected, actual: parsed.role, correct: parsed.role === candidate.expected };
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Role accuracy evaluation failed." }, { status: 502 });
  }

  const correct = results.filter((result) => result.correct).length;
  const metrics = { sampleSize: results.length, correct, accuracy: Math.round((correct / results.length) * 100), examples: results };
  const { error: saveError } = await client.from("eval_runs").insert({
    organization_id: orgId,
    eval_type: "role_accuracy",
    metrics,
  });
  if (saveError) return Response.json({ error: `Could not save the role evaluation: ${saveError.message}` }, { status: 500 });
  return Response.json(metrics);
}
