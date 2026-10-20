import fs from "node:fs";
import path from "node:path";

export function readPackageManifest(root: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function hasDependency(manifest: Record<string, unknown> | null, name: string): boolean {
  if (!manifest) return false;
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = manifest[key];
    if (typeof dependencies === "object" && dependencies !== null && name in dependencies) return true;
  }
  return false;
}
