import type { RepoFile } from "../index";

export type FrameworkId = "next" | "nestjs" | "express" | "react" | "generic";

export interface FrameworkRoute {
  method: string;
  path: string;
  sourceFile: string;
}

export interface FileRoleAssignment {
  path: string;
  roleName: string;
}

export interface AdapterResult {
  framework: FrameworkId;
  roles: FileRoleAssignment[];
  routes: FrameworkRoute[];
}

export interface FrameworkAdapter {
  framework: Exclude<FrameworkId, "generic">;
  matches(root: string): boolean;
  analyze(root: string, files: RepoFile[]): AdapterResult;
}
