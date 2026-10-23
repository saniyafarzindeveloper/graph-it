import { auth } from "@clerk/nextjs/server";
import { mintAgentCredential } from "@/lib/agent/credential";
import { getScopedAgentThreadId } from "@/lib/agent/thread-id";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type AskRouteContext = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request, context: AskRouteContext) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ error: "Cross-origin requests are not allowed." }, 403);

  const { userId, orgId, getToken } = await auth();
  if (!userId || !orgId) return json({ error: "Sign in and select a workspace first." }, 401);

  let input: { question?: unknown; conversationId?: unknown };
  try {
    input = await request.json();
  } catch {
    return json({ error: "A question is required." }, 400);
  }
  if (
    typeof input.question !== "string" || !input.question.trim() || input.question.length > 8_000 ||
    typeof input.conversationId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.conversationId)
  ) return json({ error: "A valid question and conversation are required." }, 400);

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
  if (!analysis || analysis.status !== "completed" || analysis.organization_id !== orgId) return json({ error: "Analysis not found." }, 404);

  let credential: string;
  let threadId: string;
  try {
    ({ token: credential } = await mintAgentCredential({
      analysisId: String(analysis.id),
      organizationId: orgId,
      userId,
      databaseAccessToken,
    }));
    threadId = getScopedAgentThreadId({
      analysisId: String(analysis.id),
      organizationId: orgId,
      userId,
      conversationId: input.conversationId,
    });
  } catch (error) {
    const secretError = error instanceof Error && error.message.includes("AGENT_CREDENTIAL_SECRET");
    return json({ error: secretError ? "Repository agent credentials are not configured." : "Workspace session is too close to expiry." }, secretError ? 503 : 401);
  }

  const baseUrl = process.env.REPOSITORY_AGENT_SERVICE_URL?.trim() || "http://127.0.0.1:3100";
  let serviceUrl: URL;
  try {
    serviceUrl = new URL("/runs/stream", baseUrl);
  } catch {
    return json({ error: "The repository agent service URL is invalid." }, 503);
  }
  const localHttp = serviceUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(serviceUrl.hostname);
  if (serviceUrl.protocol !== "https:" && !localHttp) return json({ error: "The repository agent service must use HTTPS." }, 503);

  let upstream: Response;
  try {
    upstream = await fetch(serviceUrl, {
      method: "POST",
      cache: "no-store",
      signal: request.signal,
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ credential, threadId, prompt: input.question.trim() }),
    });
  } catch {
    return json({ error: "The repository agent is unavailable. The map and its other tools are still available." }, 503);
  }
  if (!upstream.ok || !upstream.body) {
    const message = await upstream.json().catch(() => null) as { error?: string } | null;
    return json({ error: message?.error ?? "The repository agent could not start." }, upstream.status >= 400 ? upstream.status : 503);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
