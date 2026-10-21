import { auth } from "@clerk/nextjs/server";
import { explainRepositoryTarget } from "@/lib/analysis/explanation";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, getToken } = await auth();
  if (!orgId) return Response.json({ error: "Select a workspace before requesting an explanation." }, { status: 401 });
  const token = await getToken();
  if (!token) return Response.json({ error: "A workspace session token is required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The explanation request must contain JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid explanation request." }, { status: 400 });
  const { targetKind, targetPath } = body as Record<string, unknown>;
  if ((targetKind !== "file" && targetKind !== "folder") || typeof targetPath !== "string" || !targetPath || targetPath.length > 500) {
    return Response.json({ error: "Choose a valid repository file or folder." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const result = await explainRepositoryTarget({
      client: getSupabaseServerClient(token),
      organizationId: orgId,
      analysisId: id,
      targetKind,
      targetPath,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not explain this repository item.";
    const status = message.includes("not found in this workspace") || message.includes("not part of this analysis") ? 404 : 502;
    return Response.json({ error: message }, { status });
  }
}
