import { auth } from "@clerk/nextjs/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

type AnalysisRow = {
  id: string;
  name: string;
  status: string;
  summary: string | null;
  created_at: string;
  completed_at: string | null;
};

type AnalysesResult = {
  analyses: AnalysisRow[];
  error: string | null;
};

async function getCurrentOrgAnalyses(orgId: string | null, token: string | null): Promise<AnalysesResult> {

  if (!orgId || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return { analyses: [], error: null };
  }
  if (!token) {
    return { analyses: [], error: "Clerk did not provide a session token for Supabase." };
  }

  try {
    const supabase = await getSupabaseServerClient(token);
    const { data, error } = await supabase
      .from("analyses")
      .select("id, name, status, summary, created_at, completed_at")
      .order("created_at", { ascending: false });

    if (error) {
      return { analyses: [], error: error.message };
    }

    return { analyses: data ?? [], error: null };
  } catch (error) {
    return {
      analyses: [],
      error: error instanceof Error ? error.message : "Unknown Supabase request error.",
    };
  }
}

export default async function DashboardPage() {
  await auth.protect();

  const { orgId, getToken } = await auth();
  const activeOrgId = orgId ?? null;
  const token = activeOrgId ? await getToken() : null;
  const { analyses, error: analysesError } = await getCurrentOrgAnalyses(activeOrgId, token);

  return (
    <main>
      <section className="overflow-hidden rounded-lg border border-(--app-border) bg-(--app-panel)">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold">Recent analyses</h1>
          <span className="text-xs text-(--app-muted)">
            {analyses.length} {analyses.length === 1 ? "analysis" : "analyses"}
          </span>
        </div>

        {analysesError ? (
          <div className="border-t border-(--app-border) bg-rose-500/10 p-5">
            <p className="font-medium text-rose-200">Could not load analyses</p>
            <p className="mt-2 wrap-break-word text-sm text-rose-100">{analysesError}</p>
          </div>
        ) : analyses.length === 0 ? (
          <div className="border-t border-(--app-border) px-5 py-12 text-center">
            <p className="text-sm font-medium text-foreground">No analyses yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-(--app-border)">
            <table className="w-full min-w-190 border-collapse text-left text-sm">
              <thead className="bg-(--app-hover)/70 text-xs text-(--app-muted)">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Repository</th>
                  <th scope="col" className="px-4 py-3 font-medium">State</th>
                  <th scope="col" className="px-4 py-3 font-medium">Commit / result</th>
                  <th scope="col" className="px-4 py-3 font-medium">Started</th>
                  <th scope="col" className="px-4 py-3 font-medium">Finished</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((analysis) => (
                  <tr key={analysis.id} className="border-t border-(--app-border) transition-colors hover:bg-(--app-hover)/50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-foreground">
                      {analysis.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex items-center rounded border px-2 py-1 text-xs font-medium",
                          analysis.status === "completed"
                            ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                            : analysis.status === "failed"
                              ? "border-rose-400/40 bg-rose-500/10 text-rose-300"
                              : "border-amber-400/40 bg-amber-500/10 text-amber-300",
                        ].join(" ")}
                      >
                        {analysis.status === "completed" ? "complete" : analysis.status}
                      </span>
                    </td>
                    <td className={[
                      "max-w-xs px-4 py-3 text-xs",
                      analysis.status === "failed" ? "text-rose-300" : "text-(--app-muted)",
                      analysis.summary?.startsWith("Commit ") ? "font-mono" : "",
                    ].join(" ")}>
                      {analysis.summary ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-(--app-muted)">
                      {new Date(analysis.created_at).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-(--app-muted)">
                      {analysis.completed_at ? new Date(analysis.completed_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
