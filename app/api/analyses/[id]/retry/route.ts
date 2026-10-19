import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { PipelineError, preparePublicRepositoryAnalysis, runPublicRepositoryAnalysis } from "@/lib/analysis/pipeline";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, getToken } = await auth();
  if (!orgId) return Response.json({ error: "Select a workspace before retrying an analysis." }, { status: 401 });

  const token = await getToken();
  if (!token) return Response.json({ error: "A workspace session token is required." }, { status: 401 });

  const { id } = await params;
  try {
    const client = getSupabaseServerClient(token);
    const { data: analysis, error: analysisError } = await client.from("analyses")
      .select("project_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (analysisError) throw new PipelineError(`Could not load this analysis: ${analysisError.message}`, "store");
    if (!analysis) return Response.json({ error: "Analysis was not found in this workspace." }, { status: 404 });

    const { data: project, error: projectError } = await client.from("projects")
      .select("repository_url")
      .eq("id", analysis.project_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (projectError) throw new PipelineError(`Could not load the repository URL: ${projectError.message}`, "store");
    if (!project?.repository_url) throw new PipelineError("This analysis has no saved public repository URL.", "store");

    const result = await preparePublicRepositoryAnalysis({ repositoryUrl: project.repository_url as string, organizationId: orgId, token });
    if (result.job) {
      after(async () => {
        try {
          await runPublicRepositoryAnalysis(result.job);
        } catch {
          // The worker persists its failure state before rejecting.
        }
      });
    }
    return Response.json({ id: result.id, status: result.status, existing: result.existing }, { status: result.existing ? 200 : 202 });
  } catch (error) {
    const status = error instanceof PipelineError && error.message.includes("not found") ? 404 : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Could not retry this analysis." }, { status });
  }
}
