import type { RepoFile } from "../index";
import { nestJsAdapter } from "./nestjs";
import { nextJsAdapter } from "./nextjs";
import { expressAdapter } from "./express";
import { reactAdapter } from "./react";
import type { AdapterResult, FrameworkAdapter } from "./types";

const ADAPTERS: FrameworkAdapter[] = [nextJsAdapter, nestJsAdapter, expressAdapter, reactAdapter];

export function analyzeFramework(root: string, files: RepoFile[]): AdapterResult {
  const adapter = ADAPTERS.find((candidate) => candidate.matches(root));
  return adapter ? adapter.analyze(root, files) : { framework: "generic", roles: [], routes: [] };
}

export type { AdapterResult, FileRoleAssignment, FrameworkId, FrameworkRoute } from "./types";
