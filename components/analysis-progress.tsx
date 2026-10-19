"use client";

import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Analysis = {
  id: string;
  name: string;
  status: string;
  stage: string | null;
  stage_message: string | null;
  failed_stage: string | null;
  error_message: string | null;
  commit_sha: string | null;
  coverage: Record<string, number> | null;
  folder_count: number | null;
  summary: string | null;
  created_at: string;
  completed_at: string | null;
};

const stages = [
  { id: "fetch", label: "Fetch repository", detail: "Download the public source archive and pin its commit." },
  { id: "select", label: "Select source files", detail: "Inspect the archive and identify files to analyze." },
  { id: "parse", label: "Parse dependencies", detail: "Resolve imports, aliases, and module relationships." },
  { id: "store", label: "Store graph", detail: "Save files, edges, and parser coverage." },
] as const;

function shortSha(value: string | null) {
  return value ? value.slice(0, 12) : null;
}

export function AnalysisProgress({ initialAnalysis, token }: { initialAnalysis: Analysis; token: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [stale, setStale] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    { accessToken: async () => (await getToken()) ?? token },
  ), [getToken, token]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data, error } = await supabase.from("analyses")
        .select("id,name,status,stage,stage_message,failed_stage,error_message,commit_sha,coverage,folder_count,summary,created_at,completed_at")
        .eq("id", initialAnalysis.id).maybeSingle();
      if (active && data && !error) setAnalysis(data as Analysis);
    };

    const channel = supabase.channel(`analysis:${initialAnalysis.id}`, { config: { private: true } })
      .on("broadcast", { event: "stage_update" }, (message) => {
        const payload = (message as { payload?: { stage?: string; message?: string; status?: string } }).payload;
        if (!payload || !active) return;
        setAnalysis((current) => ({
          ...current,
          stage: payload.stage ?? current.stage,
          stage_message: payload.message ?? current.stage_message,
          status: payload.status ?? current.status,
        }));
        if (payload.status === "completed" || payload.status === "failed") void refresh();
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setConnection("connected");
          // Reconcile the server render with updates that may have happened
          // before this tab joined the channel. Progress after this is pushed.
          void refresh();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("disconnected");
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [initialAnalysis.id, supabase]);

  useEffect(() => {
    if (analysis.status === "completed") {
      router.replace(`/analyses/${analysis.id}/map`);
    }
  }, [analysis.id, analysis.status, router]);

  useEffect(() => {
    if (analysis.status === "completed" || analysis.status === "failed") {
      return;
    }
    const staleAfter = 5 * 60 * 1000;
    const age = Date.now() - new Date(analysis.created_at).getTime();
    const timer = window.setTimeout(() => setStale(true), Math.max(0, staleAfter - age));
    return () => window.clearTimeout(timer);
  }, [analysis.created_at, analysis.status]);

  const finished = analysis.status === "completed";
  const failed = analysis.status === "failed";
  const staleRun = stale && !finished && !failed;
  const currentStage = failed ? analysis.failed_stage : analysis.stage;
  const stageIndex = stages.findIndex((stage) => stage.id === currentStage);
  const coverageSeen = analysis.coverage?.importsSeen ?? 0;
  const coverageResolved = analysis.coverage?.importsResolved ?? 0;
  const resolvedPercent = coverageSeen > 0 ? Math.round((coverageResolved / coverageSeen) * 100) : null;

  const retryAnalysis = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/analyses/${encodeURIComponent(analysis.id)}/retry`, { method: "POST" });
      const payload = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not retry this analysis.");
      setStale(false);
      if (payload.status === "running") {
        setAnalysis((current) => ({
          ...current,
          status: "running",
          stage: "fetch",
          stage_message: "Retrying public repository archive",
          failed_stage: null,
          error_message: null,
          created_at: new Date().toISOString(),
        }));
      }
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Could not retry this analysis.");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl">
      <Link href="/dashboard" className="text-sm text-(--app-muted) transition hover:text-(--app-fg)">← Dashboard</Link>

      <section className="mt-4 overflow-hidden rounded-xl border border-(--app-border) bg-(--app-panel)">
        <header className="border-b border-(--app-border) p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-(--app-muted)">Repository analysis</p>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
              failed ? "border-rose-400/40 bg-rose-500/10 text-rose-400" : finished ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-400" : staleRun ? "border-amber-400/40 bg-amber-500/10 text-amber-400" : "border-sky-400/40 bg-sky-500/10 text-sky-400"
            }`}>
              {!failed && !finished && !staleRun ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
              {failed ? "Failed" : finished ? "Complete" : staleRun ? "Stale run" : "In progress"}
            </span>
          </div>
          <h1 className="mt-3 break-all font-mono text-xl font-semibold tracking-tight sm:text-2xl">{analysis.name}</h1>
          <p className="mt-2 text-sm text-(--app-muted)">
            {analysis.stage_message ?? "Waiting for the analysis worker to start…"}
          </p>
        </header>

        <div className="p-6 sm:p-8">
          {staleRun ? (
            <div role="status" className="mb-6 rounded-md border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
              This run has not reported progress for over five minutes. It may have stopped before finishing.
            </div>
          ) : null}

          <ol className="space-y-5" aria-label="Analysis stages" aria-live="polite">
            {stages.map((stage, index) => {
              const isFailed = failed && stage.id === analysis.failed_stage;
              const isComplete = finished || (stageIndex >= 0 && index < stageIndex) || (failed && stageIndex >= 0 && index < stageIndex);
              const isCurrent = !finished && !failed && stage.id === analysis.stage;
              return (
                <li key={stage.id} className="flex gap-4">
                  <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                    isFailed ? "border-rose-400 bg-rose-500/10 text-rose-400" : isComplete ? "border-emerald-400 bg-emerald-500/10 text-emerald-400" : isCurrent ? "border-sky-400 bg-sky-500/10 text-sky-400" : "border-(--app-border) text-(--app-muted)"
                  }`}>
                    {isComplete ? "✓" : isFailed ? "!" : String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className={`text-sm font-medium ${isCurrent || isComplete ? "text-(--app-fg)" : "text-(--app-muted)"}`}>{stage.label}</h2>
                      {isCurrent ? <span className="text-[11px] font-medium uppercase tracking-wider text-sky-500">Working</span> : null}
                      {isComplete ? <span className="text-[11px] font-medium uppercase tracking-wider text-emerald-500">Done</span> : null}
                      {isFailed ? <span className="text-[11px] font-medium uppercase tracking-wider text-rose-500">Failed</span> : null}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-(--app-muted)">{stage.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          {failed ? (
            <div role="alert" className="mt-7 rounded-md border border-rose-400/30 bg-rose-500/10 p-4">
              <p className="text-sm font-medium text-rose-400">The analysis could not finish</p>
              <p className="mt-1 break-words text-sm text-(--app-fg)">{analysis.error_message ?? analysis.stage_message ?? "An unexpected error occurred."}</p>
              {analysis.failed_stage ? <p className="mt-2 text-xs text-(--app-muted)">Failed during {analysis.failed_stage}.</p> : null}
              {retryError ? <p className="mt-3 text-sm text-rose-300">{retryError}</p> : null}
              <button type="button" onClick={retryAnalysis} disabled={retrying} className="mt-4 rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60">
                {retrying ? "Retrying…" : "Retry analysis"}
              </button>
            </div>
          ) : null}

          {finished ? (
            <div className="mt-7 space-y-4">
              {resolvedPercent !== null ? (
                <div className={`rounded-md border px-4 py-3 ${resolvedPercent < 95 ? "border-amber-400/40 bg-amber-500/10" : "border-emerald-400/30 bg-emerald-500/10"}`}>
                  <p className="text-sm font-medium">
                    {resolvedPercent < 95 ? "Partial dependency graph" : "Dependency coverage"}
                    <span className="ml-2 font-mono">{resolvedPercent}%</span>
                  </p>
                  <p className="mt-1 text-xs text-(--app-muted)">{coverageResolved} of {coverageSeen} imports resolved inside the repository.</p>
                </div>
              ) : (
                <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm">Analysis complete · no imports to resolve.</div>
              )}
              <div className="grid gap-3 rounded-md border border-(--app-border) p-4 text-sm sm:grid-cols-2">
                <div><p className="text-xs text-(--app-muted)">Commit</p><p className="mt-1 font-mono">{shortSha(analysis.commit_sha) ?? "Unavailable"}</p></div>
                <div><p className="text-xs text-(--app-muted)">Source files</p><p className="mt-1">{analysis.coverage?.filesParsed ?? 0} files · {analysis.folder_count ?? 0} folders</p></div>
                {analysis.summary ? <p className="text-xs text-(--app-muted) sm:col-span-2">{analysis.summary}</p> : null}
              </div>
            </div>
          ) : null}

          <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-(--app-border) pt-4">
            <span className="inline-flex items-center gap-2 text-xs text-(--app-muted)" aria-live="polite">
              <span className={`size-1.5 rounded-full ${connection === "connected" ? "bg-emerald-500" : connection === "connecting" ? "animate-pulse bg-amber-500" : "bg-rose-500"}`} />
              {connection === "connected" ? "Live progress connected" : connection === "connecting" ? "Connecting to live progress…" : "Live connection interrupted"}
            </span>
            {finished || failed || connection === "disconnected" ? (
              <Link href="/dashboard" className="text-sm font-medium text-sky-500 hover:text-sky-400">Back to analyses</Link>
            ) : null}
          </footer>
        </div>
      </section>
    </main>
  );
}
