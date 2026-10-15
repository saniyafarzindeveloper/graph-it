import { OrganizationSwitcher, Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

type AppShellProps = {
  children: React.ReactNode;
  currentOrgSlug: string | null;
  theme: "system" | "light" | "dark";
};

export function AppShell({ children, currentOrgSlug, theme }: AppShellProps) {
  return (
    <div className="min-h-screen bg-(--app-bg) text-(--app-fg)">
      <header className="border-b border-(--app-border) bg-(--app-surface)/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-base font-semibold tracking-tight text-(--app-fg)">
              GraphIt
            </Link>
            <div className="rounded-full border border-(--app-border) bg-(--app-panel) px-3 py-1 text-xs font-medium text-(--app-muted)">
              {currentOrgSlug ? `Workspace: ${currentOrgSlug}` : "Personal account"}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle initialTheme={theme} />

            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="rounded-full border border-(--app-border) bg-(--app-panel) px-4 py-2 text-sm font-medium text-(--app-fg) transition hover:bg-(--app-hover)">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="rounded-full bg-(--app-accent) px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
                  Sign up
                </button>
              </SignUpButton>
            </Show>

            <Show when="signed-in">
              <OrganizationSwitcher />
              <UserButton />
            </Show>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
