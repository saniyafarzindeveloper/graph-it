import Link from "next/link";

export default function Home() {
  return (
    <main className="space-y-8 py-10">
      <section className="rounded-3xl border border-(--app-border) bg-(--app-panel) p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--app-muted)">Auth and teams</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Secure team workspaces, organized around the active organization.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-(--app-muted)">
          Sign in to choose or create a workspace, switch between organizations, and keep the current team visible on the first render.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-full bg-(--app-accent) px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
          >
            Open dashboard
          </Link>
          <Link
            href="/sign-in"
            className="rounded-full border border-(--app-border) bg-transparent px-5 py-3 text-sm font-medium text-foreground transition hover:bg-(--app-hover)"
          >
            Go to sign-in
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <div className="rounded-3xl border border-(--app-border) bg-(--app-panel) p-6">
          <p className="text-sm text-(--app-muted)">Current state</p>
          <p className="mt-3 text-2xl font-semibold">Signed out</p>
        </div>
        <div className="rounded-3xl border border-(--app-border) bg-(--app-panel) p-6">
          <p className="text-sm text-(--app-muted)">Organization support</p>
          <p className="mt-3 text-2xl font-semibold">Enabled</p>
        </div>
        <div className="rounded-3xl border border-(--app-border) bg-(--app-panel) p-6">
          <p className="text-sm text-(--app-muted)">Theme states</p>
          <p className="mt-3 text-2xl font-semibold">System / light / dark</p>
        </div>
      </section>
    </main>
  );
}
