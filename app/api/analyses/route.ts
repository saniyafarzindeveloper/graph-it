import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { preparePublicRepositoryAnalysis, runPublicRepositoryAnalysis, PipelineError } from "@/lib/analysis/pipeline";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { orgId, getToken } = await auth();
  if (!orgId) return Response.json({ error: "Select a workspace before starting an analysis." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const repositoryUrl = typeof payload === "object" && payload !== null && "repositoryUrl" in payload
    ? (payload as { repositoryUrl?: unknown }).repositoryUrl
    : undefined;
  if (typeof repositoryUrl !== "string" || repositoryUrl.length > 500) {
    return Response.json({ error: "Provide a repositoryUrl string under 500 characters." }, { status: 400 });
  }

  const token = await getToken();
  if (!token) return Response.json({ error: "A workspace session token is required." }, { status: 401 });

  try {
    const result = await preparePublicRepositoryAnalysis({ repositoryUrl, organizationId: orgId, token });
    if (!result.existing) {
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
    const status = error instanceof PipelineError && error.stage === "fetch" ? 422 : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Repository analysis failed." }, { status });
  }
}
