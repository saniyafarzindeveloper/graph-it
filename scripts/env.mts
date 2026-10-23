import nextEnv from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Load the root project's .env files for scripts outside the Next.js runtime. */
export function loadProjectEnv() {
  return nextEnv.loadEnvConfig(projectRoot);
}
