import "server-only";

import { createHash } from "node:crypto";
import type { getSupabaseServerClient } from "@/lib/supabase/server";
import { CURRENT_PROMPT_VERSION, EXPLANATION_MODEL, isTracingConfigured, runExplanation, type ExplanationCacheEntry } from "@/lib/ai/client";
import { collectExplanationEvidence } from "@/lib/evals/path-context";
import { buildSourceContext, fetchManySources, GITHUB_TIMEOUT_MS, parseRepositoryUrl, type Repository } from "@/lib/analysis/repository-sources";

type SupabaseClient = ReturnType<typeof getSupabaseServerClient>;
type TargetKind = "file" | "folder";

interface FileRow {
  id: string;
  path: string;
  content_hash: string | null;
  folder: string | null;
}

interface EdgeRow {
  source_file_id: string;
  target_file_id: string;
}

async function fetchGithubJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "repo-graph-analyzer" },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("The repository or commit is no longer available on GitHub.");
    if (response.status === 403 || response.status === 429) throw new Error("GitHub rate limited this freshness check. Try again shortly.");
    throw new Error(`GitHub returned HTTP ${response.status} while checking the repository.`);
  }
  return await response.json() as Record<string, unknown>;
}

async function getCurrentCommit(repository: Repository) {
  const base = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  const metadata = await fetchGithubJson(base);
  if (metadata.private === true || typeof metadata.default_branch !== "string") {
    throw new Error("The analyzed repository must remain public.");
  }
  const commit = await fetchGithubJson(`${base}/commits/${encodeURIComponent(metadata.default_branch)}`);
  if (typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/i.test(commit.sha)) {
    throw new Error("GitHub did not return a valid current commit.");
  }
  return commit.sha;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(value: string) {
  return sha256(value).slice(0, 12);
}

function getAncestors(folder: string) {
  if (folder === ".") return ["."];
  const parts = folder.split("/");
  return parts.map((_part, index) => parts.slice(0, index + 1).join("/"));
}

export async function explainRepositoryTarget({
  client,
  organizationId,
  analysisId,
  targetKind,
  targetPath,
}: {
  client: SupabaseClient;
  organizationId: string;
  analysisId: string;
  targetKind: TargetKind;
  targetPath: string;
}) {
  const { data: analysis, error: analysisError } = await client.from("analyses")
    .select("id,project_id,commit_sha")
    .eq("id", analysisId)
    .eq("organization_id", organizationId)
    .eq("status", "completed")
    .maybeSingle();
  if (analysisError) throw new Error(`Could not load this analysis: ${analysisError.message}`);
  if (!analysis) throw new Error("Completed analysis was not found in this workspace.");

  const { data: project, error: projectError } = await client.from("projects")
    .select("repository_url")
    .eq("id", analysis.project_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (projectError) throw new Error(`Could not load the repository URL: ${projectError.message}`);
  if (typeof project?.repository_url !== "string") throw new Error("This analysis has no saved public repository URL.");
  const repository = parseRepositoryUrl(project.repository_url);

  const [{ data: storedFiles, error: filesError }, { data: storedEdges, error: edgesError }] = await Promise.all([
    client.from("files").select("id,path,content_hash,folder").eq("analysis_id", analysisId).eq("organization_id", organizationId),
    client.from("edges").select("source_file_id,target_file_id").eq("analysis_id", analysisId).eq("organization_id", organizationId),
  ]);
  if (filesError) throw new Error(`Could not load repository files: ${filesError.message}`);
  if (edgesError) throw new Error(`Could not load repository dependencies: ${edgesError.message}`);
  const files = (storedFiles ?? []) as FileRow[];
  const edges = (storedEdges ?? []) as EdgeRow[];
  const fileByPath = new Map(files.map((file) => [file.path, file]));

  let focusFiles: FileRow[];
  let focusFile: FileRow | null = null;

  if (targetKind === "file") {
    focusFile = fileByPath.get(targetPath) ?? null;
    if (!focusFile) throw new Error("That file is not part of this analysis.");
    focusFiles = [focusFile];
  } else {
    const validFolders = new Set(files.flatMap((file) => getAncestors(file.folder ?? ".")));
    if (!validFolders.has(targetPath)) throw new Error("That folder is not part of this analysis.");
    focusFiles = targetPath === "."
      ? files
      : files.filter((file) => file.path.startsWith(`${targetPath}/`));
    if (focusFiles.length === 0) throw new Error("That folder contains no analyzed source files.");
  }
  const evidence = collectExplanationEvidence(targetKind, targetPath, files, edges);
  const relationLines = evidence.relationships;
  const sourcePaths = new Set(evidence.sourcePaths);

  const currentCommit = await getCurrentCommit(repository);
  const analyzedCommit = analysis.commit_sha as string | null;
  if (analyzedCommit && !/^[0-9a-f]{40}$/i.test(analyzedCommit)) throw new Error("The analysis has an invalid recorded commit SHA.");
  const movedPastAnalysis = !analyzedCommit || currentCommit !== analyzedCommit;
  const currentSources = await fetchManySources(repository, currentCommit, focusFiles.map((file) => file.path), true);
  const changedPaths = focusFiles.flatMap((file) => {
    const source = currentSources.get(file.path);
    return typeof source !== "string" || fileHash(source) !== file.content_hash ? [file.path] : [];
  });
  const stale = movedPastAnalysis || changedPaths.length > 0;
  const staleReason = movedPastAnalysis
    ? "The repository has moved past the commit used to build this map."
    : changedPaths.length > 0
      ? `${targetKind === "folder" ? "Files in this folder" : "This file"} changed since the map was built.`
      : null;
  const sourceFingerprints = [...sourcePaths].sort().map((path) => [path, fileByPath.get(path)?.content_hash ?? "missing"]);
  const contentHash = sha256(JSON.stringify({ targetKind, targetPath, sourceFingerprints, relations: relationLines }));
  const loadSources = async () => {
    if (!analyzedCommit) return [];
    const analyzedSources = await fetchManySources(repository, analyzedCommit, [...sourcePaths]);
    return buildSourceContext(analyzedSources, targetPath);
  };
  const fileId = focusFile?.id ?? null;
  let existingRole: string | null = null;
  if (focusFile) {
    const { data: roles, error: rolesError } = await client.from("file_roles")
      .select("role_name")
      .eq("file_id", focusFile.id)
      .eq("organization_id", organizationId);
    if (rolesError) throw new Error(`Could not load this file's role: ${rolesError.message}`);
    existingRole = (roles ?? []).map((role) => role.role_name as string).find((role) => !role.startsWith("ai:"))
      ?? (roles ?? []).map((role) => role.role_name as string).find((role) => role.startsWith("ai:"))
      ?? null;
  }
  const classifyRole = targetKind === "file" && existingRole === null;

  const readCache = async (): Promise<ExplanationCacheEntry | null> => {
    const { data, error } = await client.from("explanation_cache")
      .select("content,ai_role,path_check")
      .eq("organization_id", organizationId)
      .eq("analysis_id", analysisId)
      .eq("target_kind", targetKind)
      .eq("target_path", targetPath)
      .eq("content_hash", contentHash)
      .eq("model_name", EXPLANATION_MODEL)
      .eq("prompt_version", CURRENT_PROMPT_VERSION)
      .maybeSingle();
    if (error) throw new Error(`Could not check explanation cache: ${error.message}`);
    return data ? { content: data.content as string, aiRole: data.ai_role as string | null, pathCheck: data.path_check as ExplanationCacheEntry["pathCheck"] } : null;
  };
  const writeCache = async (entry: ExplanationCacheEntry & { sourcePaths: string[]; relationships: string[]; promptVersion: string }) => {
    if (fileId && entry.aiRole && classifyRole) {
      const { error: roleError } = await client.from("file_roles").insert({
        organization_id: organizationId,
        file_id: fileId,
        role_name: `ai:${entry.aiRole}`,
      });
      if (roleError) throw new Error(`Could not save the suggested file role: ${roleError.message}`);
    }
    const { error } = await client.from("explanation_cache").upsert({
      organization_id: organizationId,
      analysis_id: analysisId,
      target_kind: targetKind,
      target_path: targetPath,
      content_hash: contentHash,
      model_name: EXPLANATION_MODEL,
      prompt_version: entry.promptVersion,
      source_paths: entry.sourcePaths,
      relationships: entry.relationships,
      path_check: entry.pathCheck,
      content: entry.content,
      ai_role: entry.aiRole,
    }, { onConflict: "organization_id,analysis_id,target_kind,target_path,content_hash,model_name,prompt_version" });
    if (error) throw new Error(`Could not save this explanation: ${error.message}`);
  };

  const result = await runExplanation({
    targetKind,
    targetPath,
    contentHash,
    sourcePaths: [...sourcePaths].sort(),
    relationships: relationLines,
    classifyRole,
    existingRole,
    stale,
    staleReason,
    loadSources,
    readCache,
    writeCache,
  });
  const role = result.aiRole?.startsWith("ai:") ? result.aiRole.slice(3) : result.aiRole;
  return {
    ...result,
    role,
    tracingConfigured: isTracingConfigured(),
    model: EXPLANATION_MODEL,
  };
}
