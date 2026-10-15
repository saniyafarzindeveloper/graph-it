"use client";

import { useEffect, useState } from "react";

type ThemeMode = "system" | "light" | "dark";

const themes: ThemeMode[] = ["system", "light", "dark"];

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.style.colorScheme = theme === "dark" ? "dark" : theme === "light" ? "light" : prefersDark ? "dark" : "light";

  document.cookie = `theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}

export function ThemeToggle({ initialTheme = "system" }: { initialTheme?: ThemeMode }) {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="inline-flex items-center rounded-full border border-zinc-300 bg-white/80 p-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80">
      {themes.map((option) => {
        const isActive = theme === option;

        return (
          <button
            key={option}
            type="button"
            aria-label={`Set theme to ${option}`}
            onClick={() => setTheme(option)}
            className={[
              "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              isActive
                ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
                : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
            ].join(" ")}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
