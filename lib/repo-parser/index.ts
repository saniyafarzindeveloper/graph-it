import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";

export type ImportKind = "import" | "re-export" | "dynamic-import";
export type ResolutionStatus = "inside" | "outside" | "excluded" | "unresolved";

export interface SkipEntry {
  path: string;
  reason: string;
}

export interface RepoFile {
  path: string;
  folder: string;
  extension: string;
  lines: number;
  hash: string;
  moduleName: string;
  fanIn: number;
  fanOut: number;
}

export interface RepoEdge {
  source: string;
  target: string;
  kind: ImportKind;
  specifier: string;
  resolution: ResolutionStatus;
  reason?: string;
}

export interface CoverageReport {
  filesFound: number;
  filesParsed: number;
  filesSkipped: number;
  skippedFiles: SkipEntry[];
  importsSeen: number;
  importsResolved: number;
  importsOutside: number;
  importsExcluded: number;
  importsUnresolved: number;
  reExportsFound: number;
  reExportsResolved: number;
  dynamicImportsSeen: number;
  dynamicImportsResolved: number;
}

export interface ParsedRepositoryResult {
  root: string;
  scannedAt: string;
  files: RepoFile[];
  edges: RepoEdge[];
  coverage: CoverageReport;
  folderCount: number;
}

export interface ParserOptions {
  excludeDirs?: string[];
  includeExtensions?: string[];
}

const DEFAULT_EXCLUDE_DIRS = [
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "out",
  ".cache",
  "vendor",
];

const DEFAULT_INCLUDE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function toRelativePath(root: string, target: string): string {
  const relative = normalizeSlashes(path.relative(root, target));
  return relative === "" ? "." : relative;
}

function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toFileRecord(root: string, filePath: string): RepoFile {
  const relativePath = toRelativePath(root, filePath);
  const ext = path.extname(filePath);
  const folder = normalizeSlashes(path.dirname(relativePath) === "." ? "." : path.dirname(relativePath));
  const source = fs.readFileSync(filePath, "utf8");

  return {
    path: relativePath,
    folder,
    extension: ext,
    lines: source.split(/\r?\n/).length,
    hash: crypto.createHash("sha256").update(source).digest("hex").slice(0, 12),
    moduleName: relativePath.replace(new RegExp(`${escapeRegExp(ext)}$`), ""),
    fanIn: 0,
    fanOut: 0,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTsconfigPaths(root: string): Record<string, string[]> {
  const tsconfigPath = path.join(root, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    return {};
  }

  try {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8")) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    return tsconfig.compilerOptions?.paths ?? {};
  } catch {
    return {};
  }
}

function resolveAliasSpecifier(root: string, specifier: string, aliasPaths: Record<string, string[]>): string | undefined {
  const normalizedSpecifier = normalizeSlashes(specifier);

  for (const aliasPattern of Object.keys(aliasPaths)) {
    const aliasKey = normalizeSlashes(aliasPattern).replace(/\*$/, "");
    const patterns = aliasPaths[aliasPattern] ?? [];

    if (normalizedSpecifier.startsWith(aliasKey)) {
      const suffix = normalizedSpecifier.slice(aliasKey.length);
      const match = patterns[0];
      if (!match) {
        continue;
      }

      const targetPattern = normalizeSlashes(match).replace(/\*$/, "");
      const candidate = path.join(root, targetPattern + suffix);
      return candidate;
    }
  }

  return undefined;
}

function resolveImportTarget(
  root: string,
  currentFilePath: string,
  specifier: string,
  aliasPaths: Record<string, string[]>,
  includeExtensions: string[],
): { path?: string; status: ResolutionStatus; reason?: string } {
  const normalizedSpecifier = normalizeSlashes(specifier);

  if (normalizedSpecifier.startsWith(".") || normalizedSpecifier.startsWith("/")) {
    const relativeBase = path.resolve(path.dirname(currentFilePath), normalizedSpecifier);
    const candidates = new Set<string>();

    candidates.add(relativeBase);
    for (const ext of includeExtensions) {
      candidates.add(`${relativeBase}${ext}`);
    }

    const directoryCandidate = path.join(relativeBase, "index");
    candidates.add(directoryCandidate);
    for (const ext of includeExtensions) {
      candidates.add(`${directoryCandidate}${ext}`);
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        if (isInsideRoot(root, candidate)) {
          return { path: candidate, status: "inside" };
        }
        return { path: candidate, status: "outside", reason: "resolved path escapes repository root" };
      }

      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        const indexFile = path.join(candidate, "index");
        for (const ext of includeExtensions) {
          const resolvedIndex = `${indexFile}${ext}`;
          if (fs.existsSync(resolvedIndex) && fs.statSync(resolvedIndex).isFile()) {
            return { path: resolvedIndex, status: "inside" };
          }
        }
      }
    }

    return {
      status: "unresolved",
      reason: `Could not resolve relative specifier ${specifier} from ${path.relative(root, currentFilePath)}`,
    };
  }

  const aliasCandidate = resolveAliasSpecifier(root, normalizedSpecifier, aliasPaths);
  if (aliasCandidate) {
    const aliasCandidates = new Set<string>();
    aliasCandidates.add(aliasCandidate);
    for (const ext of includeExtensions) {
      aliasCandidates.add(`${aliasCandidate}${ext}`);
    }

    const directoryCandidate = path.join(aliasCandidate, "index");
    for (const ext of includeExtensions) {
      aliasCandidates.add(`${directoryCandidate}${ext}`);
    }

    for (const candidate of aliasCandidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        if (isInsideRoot(root, candidate)) {
          return { path: candidate, status: "inside" };
        }
        return { path: candidate, status: "outside", reason: "resolved alias escapes repository root" };
      }
    }

    return {
      status: "unresolved",
      reason: `Alias target not found for ${specifier}`,
    };
  }

  const absoluteCandidate = path.resolve(root, normalizedSpecifier);
  if (fs.existsSync(absoluteCandidate) && fs.statSync(absoluteCandidate).isFile()) {
    if (isInsideRoot(root, absoluteCandidate)) {
      return { path: absoluteCandidate, status: "inside" };
    }
    return { path: absoluteCandidate, status: "outside", reason: "absolute path resolves outside repository root" };
  }

  if (normalizedSpecifier.includes("/") || normalizedSpecifier.includes("\\")) {
    return {
      status: "outside",
      reason: `Package import ${specifier} points outside the repository`,
    };
  }

  return {
    status: "outside",
    reason: `Bare package import ${specifier} points outside the repository`,
  };
}

function parseFileImports(filePath: string, root: string, aliasPaths: Record<string, string[]>, includeExtensions: string[]): RepoEdge[] {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edges: RepoEdge[] = [];

  function addEdge(kind: ImportKind, specifier: string, resolution: { path?: string; status: ResolutionStatus; reason?: string }) {
    let targetPath = "";
    if (resolution.path) {
      targetPath = toRelativePath(root, resolution.path);
    }

    edges.push({
      source: toRelativePath(root, filePath),
      target: targetPath,
      kind,
      specifier,
      resolution: resolution.status,
      reason: resolution.reason,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addEdge("import", node.moduleSpecifier.text, resolveImportTarget(root, filePath, node.moduleSpecifier.text, aliasPaths, includeExtensions));
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addEdge("re-export", node.moduleSpecifier.text, resolveImportTarget(root, filePath, node.moduleSpecifier.text, aliasPaths, includeExtensions));
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
      const firstArg = node.arguments[0];
      if (ts.isStringLiteralLike(firstArg)) {
        addEdge("dynamic-import", firstArg.text, resolveImportTarget(root, filePath, firstArg.text, aliasPaths, includeExtensions));
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return edges;
}

function gatherSourceFiles(root: string, excludeDirs: string[], includeExtensions: string[]): { files: string[]; skipped: SkipEntry[] } {
  const queue = [root];
  const files: string[] = [];
  const skipped: SkipEntry[] = [];
  const excludedSet = new Set(excludeDirs);

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const nextPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (excludedSet.has(entry.name)) {
            continue;
          }
          queue.push(nextPath);
          continue;
        }

        if (entry.isFile()) {
          const extension = path.extname(entry.name);
          if (!includeExtensions.includes(extension)) {
            skipped.push({
              path: toRelativePath(root, nextPath),
              reason: `Unsupported file extension ${extension}`,
            });
            continue;
          }
          files.push(nextPath);
        }
      }
      continue;
    }

    if (stat.isFile()) {
      const extension = path.extname(current);
      if (!includeExtensions.includes(extension)) {
        skipped.push({
          path: toRelativePath(root, current),
          reason: `Unsupported file extension ${extension}`,
        });
      } else {
        files.push(current);
      }
    }
  }

  return { files: Array.from(new Set(files)).sort(), skipped: skipped.sort((left, right) => left.path.localeCompare(right.path)) };
}

export function parseRepository(root: string, options: ParserOptions = {}): ParsedRepositoryResult {
  const projectRoot = path.resolve(root);
  const excludeDirs = [...new Set([...(options.excludeDirs ?? []), ...DEFAULT_EXCLUDE_DIRS])];
  const includeExtensions = [...new Set([...(options.includeExtensions ?? []), ...DEFAULT_INCLUDE_EXTENSIONS])];
  const aliasPaths = getTsconfigPaths(projectRoot);

  const { files: discoveredFiles, skipped } = gatherSourceFiles(projectRoot, excludeDirs, includeExtensions);

  const fileRecords: RepoFile[] = [];
  const allEdges: RepoEdge[] = [];
  const coverage: CoverageReport = {
    filesFound: discoveredFiles.length + skipped.length,
    filesParsed: 0,
    filesSkipped: skipped.length,
    skippedFiles: skipped,
    importsSeen: 0,
    importsResolved: 0,
    importsOutside: 0,
    importsExcluded: 0,
    importsUnresolved: 0,
    reExportsFound: 0,
    reExportsResolved: 0,
    dynamicImportsSeen: 0,
    dynamicImportsResolved: 0,
  };

  for (const filePath of discoveredFiles) {
    const record = toFileRecord(projectRoot, filePath);
    fileRecords.push(record);

    const fileEdges = parseFileImports(filePath, projectRoot, aliasPaths, includeExtensions);
    allEdges.push(...fileEdges);
    coverage.filesParsed += 1;

    for (const edge of fileEdges) {
      coverage.importsSeen += 1;
      if (edge.kind === "re-export") {
        coverage.reExportsFound += 1;
      }
      if (edge.kind === "dynamic-import") {
        coverage.dynamicImportsSeen += 1;
      }

      if (edge.resolution === "inside") {
        coverage.importsResolved += 1;
        if (edge.kind === "re-export") {
          coverage.reExportsResolved += 1;
        }
        if (edge.kind === "dynamic-import") {
          coverage.dynamicImportsResolved += 1;
        }
        continue;
      }

      if (edge.resolution === "outside") {
        coverage.importsOutside += 1;
        continue;
      }

      if (edge.resolution === "excluded") {
        coverage.importsExcluded += 1;
        continue;
      }

      coverage.importsUnresolved += 1;
    }
  }

  const dedupedEdges = new Map<string, RepoEdge>();
  for (const edge of allEdges) {
    const key = `${edge.source}::${edge.target}::${edge.kind}::${edge.specifier}`;
    if (!dedupedEdges.has(key)) {
      dedupedEdges.set(key, edge);
    }
  }

  const uniqueEdges = Array.from(dedupedEdges.values()).sort((left, right) => {
    const sourceCompare = left.source.localeCompare(right.source);
    if (sourceCompare !== 0) {
      return sourceCompare;
    }
    return left.target.localeCompare(right.target);
  });

  const fanIn = new Map<string, Set<string>>();
  const fanOut = new Map<string, Set<string>>();

  for (const edge of uniqueEdges) {
    if (edge.resolution !== "inside") {
      continue;
    }

    const sourceSet = fanOut.get(edge.source) ?? new Set<string>();
    sourceSet.add(edge.target);
    fanOut.set(edge.source, sourceSet);

    const targetSet = fanIn.get(edge.target) ?? new Set<string>();
    targetSet.add(edge.source);
    fanIn.set(edge.target, targetSet);
  }

  const fileMap = new Map(fileRecords.map((file) => [file.path, file]));
  for (const record of fileRecords) {
    record.fanIn = fanIn.get(record.path)?.size ?? 0;
    record.fanOut = fanOut.get(record.path)?.size ?? 0;
    fileMap.set(record.path, record);
  }

  return {
    root: projectRoot,
    scannedAt: new Date().toISOString(),
    files: fileRecords.sort((left, right) => left.path.localeCompare(right.path)),
    edges: uniqueEdges,
    coverage,
    folderCount: new Set(fileRecords.map((file) => file.folder)).size,
  };
}

export default parseRepository;
