"use client";

import { useState } from "react";

type PathStats = { evaluated: number; pathTokens: number; inventedPaths: number; score: number; failures?: Array<{ targetPath: string; invalidPaths: string[] }> };
type RoleRun = { sampleSize: number; correct: number; accuracy: number; examples: Array<{ path: string; expected: string; actual: string | null; correct: boolean }> };
type PromptRun = {
  judge: string;
  sampleSize: number;
  v1Score: number;
  v2Score: number;
  delta: number;
  langSmith?: { datasetName: string; experimentName: string; url: string | null } | null;
  langSmithError?: string | null;
  examples: Array<{ targetPath: string; v1: { score: number }; v2: { score: number }; winner: string; rationale: string }>;
};

async function postEvaluation<T>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint, { method: "POST" });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) {
    const message = body.error ?? "Evaluation could not finish.";
    if (message.includes("__TURBOPACK__imported__module") && message.includes("is not a function")) {
      throw new Error("The development server is serving an outdated evaluation module. Restart it with npm run dev, then try again.");
    }
    throw new Error(message);
  }
  return body;
}

export function EvalsDashboard({
  initialPathStats,
  initialRoleRun,
  initialPromptRun,
}: {
  initialPathStats: PathStats | null;
  initialRoleRun: RoleRun | null;
  initialPromptRun: PromptRun | null;
}) {
  const [pathStats, setPathStats] = useState<PathStats | null>(initialPathStats);
  const [roleRun, setRoleRun] = useState<RoleRun | null>(initialRoleRun);
  const [promptRun, setPromptRun] = useState<PromptRun | null>(initialPromptRun);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(name: string, endpoint: string, save: (value: T) => void) {
    setBusy(name);
    setError(null);
    try {
      save(await postEvaluation<T>(endpoint));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evaluation could not finish.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="min-w-0 max-w-full overflow-hidden whitespace-pre-wrap break-all rounded border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p> : null}
      <section className="rounded-lg border border-(--app-border) bg-(--app-panel) p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Invented paths</h2>
            <p className="mt-1 max-w-2xl text-sm text-(--app-muted)">Deterministic set-membership check. Each path-shaped token is checked against the exact source paths shown to the model. New explanations are checked automatically.</p>
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void run<PathStats>("paths", "/api/evals/paths", setPathStats)} className="rounded border border-(--app-border) px-3 py-2 text-sm hover:bg-(--app-hover) disabled:opacity-50">{busy === "paths" ? "Checking…" : "Evaluate recent explanations"}</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Path accuracy" value={pathStats ? `${pathStats.score}%` : "—"} />
          <Metric label="Explanations" value={pathStats?.evaluated ?? "—"} />
          <Metric label="Path mentions" value={pathStats?.pathTokens ?? "—"} />
          <Metric label="Invented mentions" value={pathStats?.inventedPaths ?? "—"} />
        </div>
        {pathStats?.failures?.length ? <ul className="mt-4 space-y-1 text-xs text-amber-200">{pathStats.failures.flatMap((failure) => failure.invalidPaths.map((path) => <li key={`${failure.targetPath}:${path}`}><code>{failure.targetPath}</code> mentioned unknown path <code>{path}</code></li>))}</ul> : null}
      </section>

      <section className="rounded-lg border border-(--app-border) bg-(--app-panel) p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Convention role accuracy</h2>
            <p className="mt-1 max-w-2xl text-sm text-(--app-muted)">Hides adapter-assigned labels, asks the current classifier, and compares its answer with the conventional ground truth. The dataset must contain at least 30 eligible files.</p>
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void run<RoleRun>("roles", "/api/evals/roles", setRoleRun)} className="rounded border border-(--app-border) px-3 py-2 text-sm hover:bg-(--app-hover) disabled:opacity-50">{busy === "roles" ? "Classifying 30 files…" : "Run role accuracy"}</button>
        </div>
        {roleRun ? <div className="mt-4">
          <p className="text-lg font-semibold">{roleRun.accuracy}% <span className="text-sm font-normal text-(--app-muted)">{roleRun.correct} / {roleRun.sampleSize} correct</span></p>
          <div className="mt-3 max-h-60 overflow-auto rounded border border-(--app-border)"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-(--app-panel) text-(--app-muted)"><tr><th className="p-2">File</th><th className="p-2">Expected</th><th className="p-2">Predicted</th></tr></thead><tbody>{roleRun.examples.map((item, index) => <tr key={`${item.path}:${index}`} className="border-t border-(--app-border)"><td className="p-2 font-mono">{item.path}</td><td className="p-2">{item.expected}</td><td className={item.correct ? "p-2 text-emerald-400" : "p-2 text-rose-300"}>{item.actual ?? "no role"}</td></tr>)}</tbody></table></div>
        </div> : <p className="mt-4 text-xs text-(--app-muted)">No role run saved yet.</p>}
      </section>

      <section className="rounded-lg border border-(--app-border) bg-(--app-panel) p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Prompt versions</h2>
            <p className="mt-1 max-w-2xl text-sm text-(--app-muted)">Runs the archived Phase 10 prompt and current prompt on the same two real explanations. Gemini judges usefulness, specificity, and grounding from 1 to 5; the score is a subjective model judgment.</p>
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void run<PromptRun>("prompts", "/api/evals/prompts", setPromptRun)} className="rounded border border-(--app-border) px-3 py-2 text-sm hover:bg-(--app-hover) disabled:opacity-50">{busy === "prompts" ? "Comparing prompts…" : "Compare prompt versions"}</button>
        </div>
        {promptRun ? <div className="mt-4">
          <p className="mb-3 text-xs text-(--app-muted)">{promptRun.judge} · {promptRun.sampleSize} shared examples</p>
          {promptRun.langSmith?.url ? <p className="mb-3 text-sm"><a className="text-sky-400 hover:underline" href={promptRun.langSmith.url} target="_blank" rel="noreferrer">Open LangSmith comparison: {promptRun.langSmith.experimentName}</a><span className="ml-2 text-xs text-(--app-muted)">Dataset: {promptRun.langSmith.datasetName}</span></p> : null}
          {promptRun.langSmithError ? <p role="status" className="mb-3 break-words text-xs text-amber-300">LangSmith saved the dataset, but could not record the experiments: {promptRun.langSmithError}</p> : null}
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Retired v1" value={`${promptRun.v1Score} / 5`} /><Metric label="Current v2" value={`${promptRun.v2Score} / 5`} /><Metric label="Change" value={`${promptRun.delta > 0 ? "+" : ""}${promptRun.delta}`} /></div>
          <ul className="mt-4 space-y-3">{promptRun.examples.map((item, index) => <li key={`${item.targetPath}:${index}`} className="rounded border border-(--app-border) p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><code>{item.targetPath}</code><span className="text-(--app-muted)">v1 {item.v1.score} · v2 {item.v2.score} · {item.winner}</span></div><p className="mt-2 text-xs text-(--app-muted)">{item.rationale}</p></li>)}</ul>
        </div> : <p className="mt-4 text-xs text-(--app-muted)">No prompt comparison saved yet.</p>}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded border border-(--app-border) bg-(--app-surface) p-3"><p className="text-xs text-(--app-muted)">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>;
}
