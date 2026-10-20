"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AnalysisRerunButton({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rerun = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/retry`, { method: "POST" });
      const payload = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not re-analyze this repository.");
      if (payload.status === "running") router.push(`/analyses/${encodeURIComponent(analysisId)}`);
      else {
        setRunning(false);
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not re-analyze this repository.");
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={rerun}
        disabled={running}
        className="rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-fg) transition hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
      >
        {running ? "Starting…" : "Re-analyze repository"}
      </button>
      {error ? <span role="alert" className="max-w-64 text-right text-xs text-rose-400">{error}</span> : null}
    </div>
  );
}
