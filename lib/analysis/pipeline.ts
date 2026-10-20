import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseRepository, type ParsedRepositoryResult } from "@/lib/repo-parser";
import { analyzeFramework, type AdapterResult } from "@/lib/repo-parser/adapters";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 300 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const BATCH_SIZE = 500;

type Stage = "fetch" | "select" | "parse" | "store";
type Repository = { owner: string; name: string; canonicalUrl: string };

function escapeTarPattern(member: string) {
  // BSD tar treats member operands as glob patterns. GitHub repositories often
  // contain literal brackets in route paths such as [threadId].
  return member.replace(/[\\*?\[\]]/g, "\\$&");
}

export class PipelineError extends Error {
  constructor(message: string, readonly stage: Stage) {
    super(message);
    this.name = "PipelineError";
  }
}

function parseGitHubUrl(input: string): Repository {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new PipelineError("Enter a valid public GitHub repository URL.", "fetch");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password || parts.length !== 2) {
    throw new PipelineError("Only public github.com/{owner}/{repository} URLs are supported.", "fetch");
  }
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, "");
  if (!/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(name) || name === "." || name === "..") {
    throw new PipelineError("The GitHub repository URL is malformed.", "fetch");
  }
  return { owner, name, canonicalUrl: `https://github.com/${owner.toLowerCase()}/${name.toLowerCase()}` };
}

async function fetchJson(url: string, stage: Stage): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "repo-graph-analyzer" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new PipelineError("The repository or its default branch was not found, or the repository is private.", stage);
    if (response.status === 403 || response.status === 429) throw new PipelineError("GitHub rate limit reached. Try again later.", stage);
    throw new PipelineError(`GitHub returned ${response.status} while reading repository metadata.`, stage);
  }
  return await response.json() as Record<string, unknown>;
}

async function fetchArchive(repo: Repository, workspace: string) {
  const metadata = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`, "fetch");
  if (metadata.private === true || typeof metadata.default_branch !== "string") {
    throw new PipelineError("The repository must be public and have a default branch.", "fetch");
  }
  const commit = await fetchJson(
    `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits/${encodeURIComponent(metadata.default_branch)}`,
    "fetch",
  );
  if (typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/i.test(commit.sha)) {
    throw new PipelineError("GitHub did not return a valid commit SHA.", "fetch");
  }

  const archiveUrl = `https://codeload.github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/tar.gz/${commit.sha}`;
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(90_000), redirect: "error" });
  if (!response.ok || !response.body) throw new PipelineError(`Could not download repository archive (HTTP ${response.status}).`, "fetch");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_ARCHIVE_BYTES) throw new PipelineError("Repository archive exceeds the 25 MB download limit.", "fetch");

  const archivePath = path.join(workspace, "repository.tar.gz");
  let bytes = 0;
  const reader = response.body.getReader();
  const archiveFile = await open(archivePath, "w");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_ARCHIVE_BYTES) throw new PipelineError("Repository archive exceeds the 25 MB download limit.", "fetch");
      await archiveFile.write(value);
    }
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("The repository archive download was interrupted.", "fetch");
  } finally {
    reader.releaseLock();
    await archiveFile.close();
  }
  return { archivePath, commitSha: commit.sha };
}

async function safelyExtractArchive(archivePath: string, destination: string) {
  let listing: string;
  let verbose: string;
  try {
    ({ stdout: listing } = await execFileAsync("tar", ["-tzf", archivePath], { maxBuffer: 8 * 1024 * 1024 }));
    ({ stdout: verbose } = await execFileAsync("tar", ["-tvzf", archivePath], { maxBuffer: 8 * 1024 * 1024 }));
  } catch {
    throw new PipelineError("The repository archive is invalid or could not be inspected.", "select");
  }
  const entries = listing.split("\n").filter(Boolean);
  const details = verbose.split("\n").filter(Boolean);
  if (entries.length > MAX_ARCHIVE_ENTRIES || entries.length !== details.length) {
    throw new PipelineError("Repository archive contains too many or malformed entries.", "select");
  }
  let totalBytes = 0;
  let archiveRoot: string | null = null;
  const seenPaths = new Set<string>();
  const records = entries.map((member, index) => {
    const normalized = member.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    if (normalized.startsWith("/") || segments.some((part) => part === "..") || segments.length === 0) {
      throw new PipelineError("Repository archive contains an unsafe path.", "select");
    }
    const root = segments[0];
    const normalizedPath = path.posix.normalize(normalized);
    if (seenPaths.has(normalizedPath)) throw new PipelineError("Repository archive contains a duplicate path.", "select");
    seenPaths.add(normalizedPath);
    if (archiveRoot && root !== archiveRoot) throw new PipelineError("Repository archive has an unexpected directory layout.", "select");
    archiveRoot = root;
    const detail = details[index];
    if (!detail) throw new PipelineError("Repository archive contains a malformed entry.", "select");
    // The archive's root directory is expected and has no child path segment.
    if (segments.length === 1 && detail[0] !== "d") {
      throw new PipelineError("Repository archive has an unexpected directory layout.", "select");
    }
    const match = detail.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s/);
    if (match) totalBytes += Number(match[1]);
    if (totalBytes > MAX_EXTRACTED_BYTES) throw new PipelineError("Repository expands beyond the 300 MB extraction limit.", "select");
    return { member, normalized: normalizedPath, type: detail[0] };
  });

  const nonDirectoryPaths = new Set(records.filter((entry) => entry.type !== "d").map((entry) => entry.normalized));
  const selected = records.filter((entry) => {
    // Selecting a directory can make BSD tar recursively extract its contents,
    // including links we intentionally excluded. Extract regular files only.
    if (entry.type !== "-") return false;
    const parents = entry.normalized.split("/").slice(0, -1);
    for (let index = 1; index <= parents.length; index += 1) {
      if (nonDirectoryPaths.has(parents.slice(0, index).join("/"))) return false;
    }
    return true;
  });
  const includedMembers = new Set(selected.map((entry) => entry.normalized));
  const skippedEntries = records
    .filter((entry) => entry.type !== "d" && !includedMembers.has(entry.normalized))
    .map((entry) => ({
      path: entry.normalized.split("/").slice(1).join("/"),
      type: entry.type,
    }));

  if (selected.length === 0) throw new PipelineError("The repository archive contains no regular files to analyze.", "select");
  // Extract only validated regular files and directories. Links and special
  // files are intentionally omitted so archives cannot write outside the temp root.
  for (let start = 0; start < selected.length; start += 400) {
    const batch = selected.slice(start, start + 400).map((entry) => escapeTarPattern(entry.member));
    try {
      await execFileAsync("tar", ["-xzf", archivePath, "--no-same-owner", "--no-same-permissions", "-C", destination, "--", ...batch], { maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      const detail = (error as { stderr?: string }).stderr?.trim().replace(/\s+/g, " ").slice(-300);
      throw new PipelineError(detail ? `Could not extract the repository archive: ${detail}` : "Could not extract the repository archive.", "select");
    }
  }
  const roots = await readdir(destination, { withFileTypes: true });
  const root = roots.find((entry) => entry.isDirectory());
  if (!root) throw new PipelineError("The repository archive is empty.", "select");
  return { root: path.join(destination, root.name), skippedEntries };
}

async function setProgress(client: ReturnType<typeof getSupabaseServerClient>, analysisId: string, stage: Stage | "completed", message: string, status = "running") {
  const { error } = await client.from("analyses").update({ stage, stage_message: message, status }).eq("id", analysisId);
  if (error) throw new PipelineError(`Could not save ${stage} progress: ${error.message}`, stage === "completed" ? "store" : stage);
}

async function insertBatches(client: ReturnType<typeof getSupabaseServerClient>, table: "files" | "edges" | "file_roles" | "routes", rows: Record<string, unknown>[]) {
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const { error } = await client.from(table).insert(rows.slice(index, index + BATCH_SIZE));
    if (error) throw new PipelineError(`Could not store ${table}: ${error.message}`, "store");
  }
}

async function storeResult(client: ReturnType<typeof getSupabaseServerClient>, orgId: string, analysisId: string, result: ParsedRepositoryResult, adapter: AdapterResult) {
  const fileRows = await Promise.all(result.files.map(async (file) => ({
    organization_id: orgId,
    analysis_id: analysisId,
    path: file.path,
    language: file.extension.replace(/^\./, "") || null,
    size_bytes: (await stat(path.join(result.root, file.path))).size,
    folder: file.folder,
    extension: file.extension,
    line_count: file.lines,
    content_hash: file.hash,
    module_name: file.moduleName,
    commonjs_exports: file.commonJsExports ?? [],
    fan_in: file.fanIn,
    fan_out: file.fanOut,
  })));
  await insertBatches(client, "files", fileRows);
  const { data: storedFiles, error } = await client.from("files").select("id,path").eq("analysis_id", analysisId);
  if (error) throw new PipelineError(`Could not map stored files to dependency edges: ${error.message}`, "store");
  const fileIds = new Map((storedFiles ?? []).map((file) => [file.path as string, file.id as string]));
  const roleRows = adapter.roles.flatMap((role) => {
    const fileId = fileIds.get(role.path);
    return fileId ? [{ organization_id: orgId, file_id: fileId, role_name: role.roleName }] : [];
  });
  await insertBatches(client, "file_roles", roleRows);
  const routeRows = adapter.routes.map((route) => ({
    organization_id: orgId,
    analysis_id: analysisId,
    path: route.path,
    method: route.method,
    source_file: route.sourceFile,
  }));
  await insertBatches(client, "routes", routeRows);
  const edgeRows = result.edges.flatMap((edge) => {
    const source = fileIds.get(edge.source);
    const target = edge.resolution === "inside" ? fileIds.get(edge.target) : undefined;
    if (!source || !target) return [];
    return [{
      organization_id: orgId,
      analysis_id: analysisId,
      source_file_id: source,
      target_file_id: target,
      kind: edge.kind,
      specifier: edge.specifier,
      resolution: edge.resolution,
      reason: edge.reason ?? null,
    }];
  });
  await insertBatches(client, "edges", edgeRows);
}

export type AnalysisInput = {
  repositoryUrl: string;
  organizationId: string;
  token: string;
  retryAnalysisId?: string;
};

export type AnalysisJob = AnalysisInput & {
  id: string;
  repository: Repository;
};

export async function preparePublicRepositoryAnalysis(input: AnalysisInput) {
  const repo = parseGitHubUrl(input.repositoryUrl);
  const client = getSupabaseServerClient(input.token);
  const key = repo.canonicalUrl;

  const { data: existingProject, error: projectLookupError } = await client.from("projects")
    .select("id").eq("organization_id", input.organizationId).eq("repository_url", key).maybeSingle();
  if (projectLookupError) throw new Error(`Could not check repository history: ${projectLookupError.message}`);
  if (existingProject) {
    const { data: existingAnalysis, error } = await client.from("analyses").select("id,status")
      .eq("organization_id", input.organizationId).eq("repository_key", key).maybeSingle();
    if (error) throw new Error(`Could not check existing analysis: ${error.message}`);
    if (existingAnalysis) {
      if (input.retryAnalysisId === existingAnalysis.id) {
        return await prepareAnalysisRetry({ analysisId: existingAnalysis.id as string, organizationId: input.organizationId, token: input.token });
      }
      if (existingAnalysis.status === "failed") {
        return await prepareAnalysisRetry({ analysisId: existingAnalysis.id as string, organizationId: input.organizationId, token: input.token });
      }
      return { id: existingAnalysis.id as string, status: existingAnalysis.status as string, existing: true as const };
    }
  }

  const { data: organization, error: organizationError } = await client.from("organizations")
    .select("id").eq("id", input.organizationId).maybeSingle();
  if (organizationError) throw new PipelineError(`Could not verify the active organization: ${organizationError.message}`, "store");
  if (!organization) {
    const slug = input.organizationId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const { error } = await client.from("organizations").insert({ id: input.organizationId, name: "Workspace", slug: `${slug}-${input.organizationId.slice(-8)}` });
    if (error) throw new PipelineError(`Could not initialize the active organization: ${error.message}`, "store");
  }

  let projectId = existingProject?.id as string | undefined;
  if (!projectId) {
    const { data, error } = await client.from("projects").insert({
      organization_id: input.organizationId,
      name: `${repo.owner}/${repo.name}`,
      description: "Public GitHub repository",
      repository_url: key,
    }).select("id").single();
    if (error && error.code !== "23505") throw new PipelineError(`Could not create repository project: ${error.message}`, "store");
    if (error) {
      const { data: racedProject, error: racedProjectError } = await client.from("projects").select("id")
        .eq("organization_id", input.organizationId).eq("repository_url", key).single();
      if (racedProjectError) throw new PipelineError(`Could not find the existing repository project: ${racedProjectError.message}`, "store");
      projectId = racedProject.id as string;
    } else {
      projectId = data.id as string;
    }
  }

  const { data: created, error: createError } = await client.from("analyses").insert({
    organization_id: input.organizationId,
    project_id: projectId,
    repository_key: key,
    name: `${repo.owner}/${repo.name}`,
    status: "running",
    stage: "fetch",
    stage_message: "Fetching public repository archive",
  }).select("id").single();
  if (createError) {
    if (createError.code !== "23505") throw new PipelineError(`Could not create analysis: ${createError.message}`, "store");
    const { data: existing, error } = await client.from("analyses").select("id,status")
      .eq("organization_id", input.organizationId).eq("repository_key", key).single();
    if (error) throw new PipelineError(`Could not find the active analysis: ${error.message}`, "store");
    return { id: existing.id as string, status: existing.status as string, existing: true as const };
  }
  return {
    id: created.id as string,
    status: "running",
    existing: false as const,
    job: { ...input, id: created.id as string, repository: repo } satisfies AnalysisJob,
  };
}

async function prepareAnalysisRetry(input: Pick<AnalysisInput, "organizationId" | "token"> & { analysisId: string }) {
  const client = getSupabaseServerClient(input.token);
  const { data: analysis, error: analysisError } = await client.from("analyses")
    .select("id,status,project_id")
    .eq("id", input.analysisId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (analysisError) throw new PipelineError(`Could not load this analysis: ${analysisError.message}`, "store");
  if (!analysis) throw new PipelineError("Analysis was not found in this workspace.", "store");
  if (analysis.status !== "failed" && analysis.status !== "completed") {
    return { id: analysis.id as string, status: analysis.status as string, existing: true as const };
  }

  const { data: project, error: projectError } = await client.from("projects")
    .select("repository_url")
    .eq("id", analysis.project_id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (projectError) throw new PipelineError(`Could not load the repository URL: ${projectError.message}`, "store");
  if (!project?.repository_url) throw new PipelineError("This analysis has no saved public repository URL.", "store");
  const repository = parseGitHubUrl(project.repository_url as string);

  const { data: claimed, error: claimError } = await client.from("analyses").update({
    status: "running",
    stage: "fetch",
    stage_message: "Retrying public repository archive",
    failed_stage: null,
    error_message: null,
    commit_sha: null,
    coverage: null,
    folder_count: null,
    summary: null,
    completed_at: null,
    framework: "generic",
    created_at: new Date().toISOString(),
  }).eq("id", input.analysisId).eq("organization_id", input.organizationId).eq("status", analysis.status).select("id").maybeSingle();
  if (claimError) throw new PipelineError(`Could not restart this analysis: ${claimError.message}`, "store");
  if (!claimed) {
    const { data: current, error } = await client.from("analyses").select("id,status").eq("id", input.analysisId).single();
    if (error) throw new PipelineError(`Could not check analysis status: ${error.message}`, "store");
    return { id: current.id as string, status: current.status as string, existing: true as const };
  }

  try {
    const { error: edgeError } = await client.from("edges").delete().eq("analysis_id", input.analysisId).eq("organization_id", input.organizationId);
    if (edgeError) throw new PipelineError(`Could not clear old dependencies: ${edgeError.message}`, "store");
    const { error: routeError } = await client.from("routes").delete().eq("analysis_id", input.analysisId).eq("organization_id", input.organizationId);
    if (routeError) throw new PipelineError(`Could not clear old routes: ${routeError.message}`, "store");
    const { error: fileError } = await client.from("files").delete().eq("analysis_id", input.analysisId).eq("organization_id", input.organizationId);
    if (fileError) throw new PipelineError(`Could not clear old files: ${fileError.message}`, "store");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not clear the failed run.";
    await client.from("analyses").update({ status: "failed", stage: "store", stage_message: message, failed_stage: "store", error_message: message }).eq("id", input.analysisId);
    throw error;
  }

  return {
    id: input.analysisId,
    status: "running",
    existing: false as const,
    job: { ...input, repositoryUrl: repository.canonicalUrl, repository, id: input.analysisId } satisfies AnalysisJob,
  };
}

export async function runPublicRepositoryAnalysis(job: AnalysisJob) {
  const client = getSupabaseServerClient(job.token);
  const workspace = await mkdtemp(path.join(tmpdir(), "repo-analysis-"));
  let stage: Stage = "fetch";
  try {
    const { archivePath, commitSha } = await fetchArchive(job.repository, workspace);
    const { error: commitError } = await client.from("analyses").update({ commit_sha: commitSha }).eq("id", job.id);
    if (commitError) throw new PipelineError(`Could not record repository commit: ${commitError.message}`, "fetch");
    stage = "select";
    await setProgress(client, job.id, stage, "Selecting source files from archive");
    const sourceDirectory = path.join(workspace, "source");
    await mkdir(sourceDirectory);
    const { root: sourceRoot, skippedEntries } = await safelyExtractArchive(archivePath, sourceDirectory);
    stage = "parse";
    await setProgress(client, job.id, stage, "Parsing imports and module relationships");
    const result = parseRepository(sourceRoot);
    const adapter = analyzeFramework(sourceRoot, result.files);
    const sourceExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
    const skippedSourceEntries = skippedEntries.filter((entry) => sourceExtensions.test(entry.path));
    result.coverage.filesFound += skippedSourceEntries.length;
    result.coverage.filesSkipped += skippedSourceEntries.length;
    result.coverage.skippedFiles.push(...skippedSourceEntries.map((entry) => ({
      path: entry.path,
      reason: entry.type === "l" || entry.type === "h" ? "Symbolic or hard link not followed" : "Non-regular archive entry skipped",
    })));
    stage = "store";
    await setProgress(client, job.id, stage, `Storing ${result.files.length} files and ${result.edges.length} dependencies`);
    await storeResult(client, job.organizationId, job.id, result, adapter);
    const { error: completeError } = await client.from("analyses").update({
      status: "completed",
      stage: "completed",
      stage_message: "Repository analysis complete",
      completed_at: new Date().toISOString(),
      commit_sha: commitSha,
      coverage: result.coverage,
      folder_count: result.folderCount,
      framework: adapter.framework,
      summary: `${result.files.length} source files, ${result.edges.length} dependencies. ${result.coverage.importsResolved} imports resolved.`,
    }).eq("id", job.id);
    if (completeError) throw new PipelineError(`Could not complete the analysis: ${completeError.message}`, "store");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected repository analysis failure.";
    await client.from("analyses").update({ status: "failed", stage, stage_message: message, failed_stage: error instanceof PipelineError ? error.stage : stage, error_message: message }).eq("id", job.id);
    throw error;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
