import type { FrameworkId } from "./adapters/types";

export interface RoleCategory {
  name: string;
  color: string;
}

export interface FrameworkTaxonomy {
  label: string;
  categories: RoleCategory[];
}

export const FRAMEWORK_TAXONOMY: Record<FrameworkId, FrameworkTaxonomy> = {
  next: {
    label: "Next.js",
    categories: [
      { name: "Page routes", color: "#38bdf8" },
      { name: "API endpoints", color: "#a78bfa" },
      { name: "Server actions", color: "#34d399" },
      { name: "Other files", color: "#71717a" },
    ],
  },
  nestjs: {
    label: "NestJS",
    categories: [
      { name: "Controllers", color: "#fb7185" },
      { name: "Services", color: "#f59e0b" },
      { name: "Modules", color: "#a78bfa" },
      { name: "Entities", color: "#34d399" },
      { name: "Other files", color: "#71717a" },
    ],
  },
  express: {
    label: "Express",
    categories: [
      { name: "Routes", color: "#38bdf8" },
      { name: "Controllers", color: "#a78bfa" },
      { name: "Middleware", color: "#34d399" },
      { name: "Services", color: "#f59e0b" },
      { name: "Models", color: "#fb7185" },
      { name: "Other files", color: "#71717a" },
    ],
  },
  react: {
    label: "React",
    categories: [
      { name: "Components", color: "#38bdf8" },
      { name: "Hooks", color: "#a78bfa" },
      { name: "Contexts", color: "#34d399" },
      { name: "Other files", color: "#71717a" },
    ],
  },
  generic: {
    label: "Generic",
    categories: [{ name: "Source files", color: "#71717a" }],
  },
};

export function getFrameworkTaxonomy(framework: FrameworkId): FrameworkTaxonomy {
  return FRAMEWORK_TAXONOMY[framework];
}
