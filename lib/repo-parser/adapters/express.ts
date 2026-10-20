import type { RepoFile } from "../index";
import { hasDependency, readPackageManifest } from "./manifest";
import type { AdapterResult, FrameworkAdapter } from "./types";

const ROLE_BY_DIRECTORY: Record<string, string> = {
  route: "Routes",
  routes: "Routes",
  router: "Routes",
  routers: "Routes",
  controller: "Controllers",
  controllers: "Controllers",
  middleware: "Middleware",
  middlewares: "Middleware",
  service: "Services",
  services: "Services",
  model: "Models",
  models: "Models",
};

export const expressAdapter: FrameworkAdapter = {
  framework: "express",
  matches(root) {
    return hasDependency(readPackageManifest(root), "express");
  },
  analyze(_root, files: RepoFile[]): AdapterResult {
    const roles: AdapterResult["roles"] = [];
    for (const file of files) {
      const directories = file.path.split("/").slice(0, -1).reverse();
      const roleName = directories.map((directory) => ROLE_BY_DIRECTORY[directory.toLowerCase()]).find(Boolean);
      if (roleName) roles.push({ path: file.path, roleName });
    }
    return { framework: "express", roles, routes: [] };
  },
};
