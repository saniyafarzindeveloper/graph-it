"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function AnalysisForm() {
  const router = useRouter();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl }),
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "Could not start this analysis.");
      router.push(`/analyses/${result.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not start this analysis.");
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-(--app-border) bg-(--app-panel) p-5">
      <div className="mb-4">
        <h1 className="text-base font-semibold">Analyze a repository</h1>
        <p className="mt-1 text-sm text-(--app-muted)">Paste a public GitHub URL to build its dependency map.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="repository-url">Public GitHub repository URL</label>
        <input
          id="repository-url"
          type="url"
          required
          maxLength={500}
          placeholder="https://github.com/owner/repository"
          value={repositoryUrl}
          onChange={(event) => setRepositoryUrl(event.target.value)}
          disabled={isSubmitting}
          className="min-w-0 flex-1 rounded-md border border-(--app-border) bg-(--app-bg) px-3 py-2.5 text-sm text-(--app-fg) outline-none transition placeholder:text-(--app-muted)/70 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isSubmitting || !repositoryUrl.trim()}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-(--app-accent) px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {isSubmitting ? (
            <><span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Starting…</>
          ) : "Analyze repository"}
        </button>
      </form>
      {error ? <p role="alert" className="mt-3 text-sm text-rose-500">{error}</p> : null}
    </section>
  );
}
