import { verifyAgentCredential } from "@/lib/agent/credential";
import { loadCredentialRepositorySnapshot } from "@/lib/agent/repository-snapshot";
import { REPOSITORY_TOOL_SCHEMAS, runRepositoryTool, type RepositoryToolName } from "@/lib/agent/repository-tools";

const tools = {
  summary: "summary",
  "search-files": "searchFiles",
  "files-by-role": "listByRole",
  neighbors: "directNeighbors",
  walk: "walkDependencies",
  routes: "routeTable",
} as const satisfies Record<string, RepositoryToolName>;

type ToolRouteContext = { params: Promise<{ tool: string }> };

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
  });
}

export async function GET(request: Request, context: ToolRouteContext) {
  const authorization = request.headers.get("authorization");
  const credential = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!credential) return response({ error: "A scoped bearer credential is required." }, 401);

  let claims;
  try {
    claims = await verifyAgentCredential(credential);
  } catch (error) {
    if (error instanceof Error && error.message.includes("AGENT_CREDENTIAL_SECRET")) {
      return response({ error: "The repository tool service is not configured." }, 503);
    }
    return response({ error: "The scoped credential is invalid or expired." }, 401);
  }

  const { tool: endpointName } = await context.params;
  const toolName = tools[endpointName as keyof typeof tools];
  if (!toolName) return response({ error: "Unknown repository tool." }, 404);

  const input: Record<string, string | number> = Object.fromEntries(new URL(request.url).searchParams.entries());
  if (toolName === "walkDependencies" && typeof input.maxDepth === "string") input.maxDepth = Number(input.maxDepth);
  const parsedInput = REPOSITORY_TOOL_SCHEMAS[toolName].safeParse(input);
  if (!parsedInput.success) return response({ error: "Invalid repository tool arguments." }, 400);

  try {
    const snapshot = await loadCredentialRepositorySnapshot(claims);
    return response(runRepositoryTool(snapshot, toolName, parsedInput.data));
  } catch {
    return response({ error: "Could not read the scoped repository analysis." }, 503);
  }
}
