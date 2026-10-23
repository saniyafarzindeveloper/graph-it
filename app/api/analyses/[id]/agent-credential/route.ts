import { auth } from "@clerk/nextjs/server";
import { mintAgentCredential } from "@/lib/agent/credential";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type CredentialRouteContext = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request, context: CredentialRouteContext) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ error: "Cross-origin requests are not allowed." }, 403);

  const { userId, orgId, getToken } = await auth();
  if (!userId || !orgId) return json({ error: "Sign in and select a workspace first." }, 401);

  const { id: analysisId } = await context.params;
  const databaseAccessToken = await getToken();
  if (!databaseAccessToken) return json({ error: "A workspace session token is required." }, 401);

  const client = getSupabaseServerClient(databaseAccessToken);
  const { data: analysis, error } = await client.from("analyses")
    .select("id,status,organization_id")
    .eq("id", analysisId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) return json({ error: "Could not verify access to this analysis." }, 503);
  if (!analysis || analysis.status !== "completed" || analysis.organization_id !== orgId) {
    return json({ error: "Analysis not found." }, 404);
  }

  try {
    const { token, expiresIn } = await mintAgentCredential({
      analysisId: String(analysis.id),
      organizationId: orgId,
      userId,
      databaseAccessToken,
    });
    return json({ credential: token, expiresIn });
  } catch (error) {
    const status = error instanceof Error && error.message.includes("AGENT_CREDENTIAL_SECRET") ? 503 : 401;
    return json({ error: status === 503 ? "Repository agent credentials are not configured." : "Workspace session is too close to expiry." }, status);
  }
}
