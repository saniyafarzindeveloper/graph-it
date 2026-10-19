"use client";

import { useEffect, useState } from "react";

export function AnalysisStatus({ status, createdAt }: { status: string; createdAt: string }) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (status === "completed" || status === "failed") return;
    const delay = Math.max(0, 5 * 60 * 1000 - (Date.now() - new Date(createdAt).getTime()));
    const timer = window.setTimeout(() => setStale(true), delay);
    return () => window.clearTimeout(timer);
  }, [createdAt, status]);

  if (stale) {
    return <span className="inline-flex items-center rounded border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300">stale</span>;
  }

  const className = status === "completed"
    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
    : status === "failed"
      ? "border-rose-400/40 bg-rose-500/10 text-rose-300"
      : "border-amber-400/40 bg-amber-500/10 text-amber-300";
  return (
    <span className={`inline-flex items-center rounded border px-2 py-1 text-xs font-medium ${className}`}>
      {status === "completed" ? "complete" : status}
    </span>
  );
}
