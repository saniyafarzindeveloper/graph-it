import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { EvalsDashboard } from "@/components/evals-dashboard";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function EvaluationsPage() {
  await auth.protect();
  const { orgId, getToken } = await auth();
  if (!orgId) {
    return <main className="space-y-5"><Link href="/dashboard" className="text-sm text-sky-400 hover:underline">← Dashboard</Link><h1 className="text-2xl font-semibold">Evaluation dashboard</h1><p className="text-sm text-(--app-muted)">Select a workspace to view its evaluation results.</p></main>;
  }
  const token = await getToken();
  if (!token) return <main><p className="text-sm text-rose-300">A workspace session token is required.</p></main>;
  const client = getSupabaseServerClient(token);
  const [{ data: checks, error: checksError }, { data: runs, error: runsError }] = await Promise.all([
    client.from("explanation_cache").select("path_check").eq("organization_id", orgId).not("path_check", "is", null).order("created_at", { ascending: false }).limit(100),
    client.from("eval_runs").select("id,eval_type,metrics,created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(20),
  ]);
  const pathChecks = (checks ?? []).map((row) => row.path_check as { totalPaths?: number; validPaths?: number }).filter(Boolean);
  const totalPathTokens = pathChecks.reduce((sum, result) => sum + (result.totalPaths ?? 0), 0);
  const validPathTokens = pathChecks.reduce((sum, result) => sum + (result.validPaths ?? 0), 0);
  const latestByType = new Map<string, { metrics: unknown; created_at: string }>();
  for (const run of runs ?? []) if (!latestByType.has(run.eval_type)) latestByType.set(run.eval_type, { metrics: run.metrics, created_at: run.created_at });
  return (
    <main className="space-y-5">
      <Link href="/dashboard" className="text-sm text-sky-400 hover:underline">← Dashboard</Link>
      <header>
        <h1 className="text-2xl font-semibold">Evaluation dashboard</h1>
        <p className="mt-1 text-sm text-(--app-muted)">Scores from real repository explanations. Model-judge scores are subjective, not deterministic.</p>
      </header>
      {(checksError || runsError) ? <p className="rounded border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">Could not load saved evaluations: {checksError?.message ?? runsError?.message}</p> : null}
      <EvalsDashboard
        initialPathStats={pathChecks.length ? { evaluated: pathChecks.length, pathTokens: totalPathTokens, inventedPaths: totalPathTokens - validPathTokens, score: totalPathTokens ? Math.round((validPathTokens / totalPathTokens) * 100) : 100 } : null}
        initialRoleRun={(latestByType.get("role_accuracy")?.metrics as Parameters<typeof EvalsDashboard>[0]["initialRoleRun"]) ?? null}
        initialPromptRun={(latestByType.get("prompt_comparison")?.metrics as Parameters<typeof EvalsDashboard>[0]["initialPromptRun"]) ?? null}
      />
    </main>
  );
}
