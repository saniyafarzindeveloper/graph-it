"use client";

import { useMemo, useState } from "react";
import type { CoverageReport, RepoEdge, RepoFile } from "@/lib/repo-parser/index";
import type { FoldedFolder } from "@/lib/canvas/folding";
import type { CanvasSelection } from "@/lib/canvas/layout";
import { walkGraph, type GraphWalkMode, type RepositoryInsights } from "@/lib/canvas/analysis";
import type { FrameworkRoute } from "@/lib/repo-parser/adapters";

export type DetailTab = "structure" | "explanation";

interface CanvasDetailPaneProps {
  repoName: string;
  files: RepoFile[];
  edges: RepoEdge[];
  insights: RepositoryInsights;
  coverage: CoverageReport;
  framework: string | null;
  routeCount: number | null;
  unclassifiedCount: number | null;
  routes: FrameworkRoute[];
  fileToNode: Map<string, string>;
  hovered: CanvasSelection;
  selectedFile: RepoFile | null;
  selectedFolder: FoldedFolder | null;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onSelectFile: (filePath: string) => void;
  onHover: (target: CanvasSelection) => void;
}

const insightCopy = {
  unimported: "These files have no in-repository dependents; framework and tooling entry points are left out.",
  cycles: "These files form an import cycle.",
  highFanIn: "These files are imported by an unusually large part of the repository.",
  oversized: "These files are unusually long and may take longer to understand.",
} as const;

const languageNames: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript JSX",
  ".js": "JavaScript",
  ".jsx": "JavaScript JSX",
  ".mjs": "ES module JavaScript",
  ".cjs": "CommonJS JavaScript",
  ".mts": "ES module TypeScript",
  ".cts": "CommonJS TypeScript",
};

function PathButton({
  filePath,
  selected,
  hovered,
  onSelect,
  onHover,
}: {
  filePath: string;
  selected: boolean;
  hovered: boolean;
  onSelect: (filePath: string) => void;
  onHover: (target: CanvasSelection) => void;
}) {
  return (
    <button
      type="button"
      className={[
        "block w-full truncate rounded px-2 py-1 text-left font-mono text-[10px] transition-colors duration-100",
        selected || hovered ? "bg-sky-500/15 text-sky-300" : "text-(--app-muted) hover:bg-(--app-hover) hover:text-foreground",
      ].join(" ")}
      title={filePath}
      onClick={() => onSelect(filePath)}
      onMouseEnter={() => onHover({ kind: "file", id: filePath })}
    >
      {filePath}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-(--app-hover)/60 px-2.5 py-2">
      <dt className="text-[10px] text-(--app-muted)">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function PathList({
  title,
  paths,
  selectedPath,
  isHovered,
  emptyLabel,
  onSelectFile,
  onHover,
}: {
  title: string;
  paths: string[];
  selectedPath: string | null;
  isHovered: (filePath: string) => boolean;
  emptyLabel: string;
  onSelectFile: (filePath: string) => void;
  onHover: (target: CanvasSelection) => void;
}) {
  return (
    <section className="mt-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        <span className="text-[10px] tabular-nums text-(--app-muted)">{paths.length}</span>
      </div>
      {paths.length > 0 ? (
        <ul className="max-h-44 space-y-0.5 overflow-y-auto" onMouseLeave={() => onHover(null)}>
          {paths.map((filePath) => (
            <li key={filePath}>
              <PathButton
                filePath={filePath}
                selected={selectedPath === filePath}
                hovered={isHovered(filePath)}
                onSelect={onSelectFile}
                onHover={onHover}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-1 text-[10px] text-(--app-muted)">{emptyLabel}</p>
      )}
    </section>
  );
}

export function CanvasDetailPane({
  repoName,
  files,
  edges,
  insights,
  coverage,
  framework,
  routeCount,
  unclassifiedCount,
  routes,
  fileToNode,
  hovered,
  selectedFile,
  selectedFolder,
  activeTab,
  onTabChange,
  onSelectFile,
  onHover,
}: CanvasDetailPaneProps) {
  const [walkMode, setWalkMode] = useState<GraphWalkMode | null>(null);
  const isHovered = (filePath: string) =>
    hovered?.kind === "file"
      ? hovered.id === filePath
      : hovered?.kind === "folder" && fileToNode.get(filePath) === hovered.id;
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const topDependedOn = useMemo(
    () => [...files].filter((file) => file.fanIn > 0).sort((left, right) => right.fanIn - left.fanIn || left.path.localeCompare(right.path)).slice(0, 8),
    [files],
  );
  const readingStarts = useMemo(
    () => [...files].filter((file) => file.fanIn === 0).sort((left, right) => right.fanOut - left.fanOut || left.path.localeCompare(right.path)).slice(0, 8),
    [files],
  );

  const fileRelations = useMemo(() => {
    if (!selectedFile) return { imports: [], dependents: [], otherImports: [] as RepoEdge[] };
    const imports = new Set<string>();
    const dependents = new Set<string>();
    const otherImports: RepoEdge[] = [];

    for (const edge of edges) {
      if (edge.source === selectedFile.path) {
        if (edge.resolution === "inside" && fileByPath.has(edge.target)) imports.add(edge.target);
        else otherImports.push(edge);
      }
      if (edge.target === selectedFile.path && edge.resolution === "inside") dependents.add(edge.source);
    }

    return {
      imports: [...imports].sort(),
      dependents: [...dependents].sort(),
      otherImports,
    };
  }, [edges, fileByPath, selectedFile]);

  const folderTypes = useMemo(() => {
    if (!selectedFolder) return [];
    const counts = new Map<string, number>();
    for (const file of selectedFolder.files) {
      counts.set(file.extension, (counts.get(file.extension) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [selectedFolder]);
  const walkEntries = useMemo(
    () => selectedFile && walkMode ? walkGraph(selectedFile.path, files, edges, walkMode, 2) : [],
    [selectedFile, files, edges, walkMode],
  );

  const focusedLabel = hovered?.kind === "file"
    ? hovered.id
    : hovered?.kind === "folder"
      ? selectedFolder?.id === hovered.id ? selectedFolder.label : hovered.id
      : null;

  return (
    <aside aria-label="Details" className="flex max-h-[60svh] min-h-28 flex-col overflow-hidden rounded-md lg:max-h-none lg:min-h-0 border border-(--app-border) bg-(--app-panel)">
      <header className="shrink-0 border-b border-(--app-border) p-4">
        <div className="truncate font-mono text-sm font-semibold text-foreground" title={repoName}>{repoName}</div>
        <div role="tablist" aria-label="Detail view" className="mt-3 flex rounded-md bg-(--app-hover)/70 p-1">
          {(["structure", "explanation"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={[
                "flex-1 rounded px-2 py-1.5 text-[10px] font-medium capitalize transition",
                activeTab === tab ? "bg-(--app-panel) text-foreground shadow-sm" : "text-(--app-muted) hover:text-foreground",
              ].join(" ")}
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-(--app-muted)">Explore dependencies</p>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ["blast-radius", "Blast radius"],
              ["dependency-chain", "Dependency chain"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={walkMode === mode}
                onClick={() => setWalkMode((current) => current === mode ? null : mode)}
                className={["min-h-9 rounded-md border px-2 py-1.5 text-[10px] font-medium transition", walkMode === mode ? "border-sky-400/50 bg-sky-500/10 text-sky-300" : "border-(--app-border) text-(--app-muted) hover:bg-(--app-hover) hover:text-foreground"].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p
          aria-hidden={!focusedLabel}
          className={["mt-3 min-h-4 truncate text-[10px] text-sky-300", focusedLabel ? "opacity-100" : "opacity-0"].join(" ")}
          title={focusedLabel ?? undefined}
        >
          Map focus <span className="ml-1 font-mono">{focusedLabel ?? ""}</span>
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {walkMode ? (
          <section className="mb-5 rounded-md border border-(--app-border) bg-(--app-hover)/40 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold text-foreground">
                {walkMode === "blast-radius" ? "Files that depend on this" : "Files this depends on"}
              </h2>
              {selectedFile ? <span className="text-[10px] text-(--app-muted)">2 levels · {walkEntries.length}</span> : null}
            </div>
            {selectedFile ? walkEntries.length > 0 ? (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto" onMouseLeave={() => onHover(null)}>
                {walkEntries.map((entry) => (
                  <li key={entry.path} className="flex items-center gap-2">
                    <PathButton
                      filePath={entry.path}
                      selected={false}
                      hovered={isHovered(entry.path)}
                      onSelect={onSelectFile}
                      onHover={onHover}
                    />
                    <span className="shrink-0 text-[9px] text-(--app-muted)">L{entry.depth}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-[10px] text-(--app-muted)">No connected files within two levels.</p> : (
              <p className="mt-2 text-[10px] text-(--app-muted)">Select a file on the map to see its connections.</p>
            )}
          </section>
        ) : null}
        {activeTab === "explanation" ? (
          <p className="py-4 text-xs text-(--app-muted)">No explanation is available yet.</p>
        ) : selectedFile ? (
          <>
            <h2 className="wrap-break-word font-mono text-xs font-semibold text-foreground">{selectedFile.path}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-3">
              <Metric label="Kind" value={languageNames[selectedFile.extension] ?? (selectedFile.extension || "Unknown")} />
              <Metric label="Lines" value={selectedFile.lines} />
              <Metric label="Imports" value={fileRelations.imports.length} />
              <Metric label="Dependents" value={fileRelations.dependents.length} />
            </dl>
            <PathList
              title="Imports"
              paths={fileRelations.imports}
              selectedPath={selectedFile.path}
              isHovered={isHovered}
              emptyLabel="No in-repository imports"
              onSelectFile={onSelectFile}
              onHover={onHover}
            />
            <PathList
              title="Imported by"
              paths={fileRelations.dependents}
              selectedPath={selectedFile.path}
              isHovered={isHovered}
              emptyLabel="No files import this file"
              onSelectFile={onSelectFile}
              onHover={onHover}
            />
            {selectedFile.commonJsExports?.length ? (
              <section className="mt-4">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <h3 className="text-[11px] font-semibold text-foreground">CommonJS exports</h3>
                  <span className="text-[10px] tabular-nums text-(--app-muted)">{selectedFile.commonJsExports.length}</span>
                </div>
                <ul className="flex flex-wrap gap-1">
                  {selectedFile.commonJsExports.map((name) => (
                    <li key={name} className="rounded bg-(--app-hover)/70 px-1.5 py-1 font-mono text-[10px] text-(--app-muted)">{name}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {fileRelations.otherImports.length > 0 ? (
              <section className="mt-4">
                <h3 className="mb-1 text-[11px] font-semibold text-foreground">Other imports</h3>
                <ul className="space-y-1 text-[10px] text-(--app-muted)">
                  {fileRelations.otherImports.map((edge, index) => (
                    <li key={`${edge.specifier}:${index}`} className="wrap-break-word">
                      <span className="font-mono">{edge.specifier}</span>
                      <span className="ml-1">({edge.resolution})</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : selectedFolder ? (
          <>
            <h2 className="wrap-break-word font-mono text-xs font-semibold text-foreground">{selectedFolder.folder}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-3">
              <Metric label="Files" value={selectedFolder.files.length} />
              <Metric label="Incoming" value={selectedFolder.fanIn} />
              <Metric label="Outgoing" value={selectedFolder.fanOut} />
              <Metric label="Directory" value={selectedFolder.folder} />
            </dl>
            <section className="mt-4">
              <h3 className="mb-2 text-[11px] font-semibold text-foreground">File kinds</h3>
              <ul className="space-y-1">
                {folderTypes.map(([extension, count]) => (
                  <li key={extension} className="flex justify-between text-[10px] text-(--app-muted)">
                    <span className="font-mono">{extension || "(none)"}</span>
                    <span className="tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            </section>
            <PathList
              title="Files"
              paths={selectedFolder.files.map((file) => file.path)}
              selectedPath={null}
              isHovered={isHovered}
              emptyLabel="No files"
              onSelectFile={onSelectFile}
              onHover={onHover}
            />
          </>
        ) : (
          <>
            <h2 className="text-xs font-semibold text-foreground">Repository summary</h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-3">
              <Metric label="Framework" value={framework ?? "Not detected"} />
              <Metric label="Files" value={files.length} />
              <Metric label="Imports" value={coverage.importsSeen} />
              <Metric label="Routes" value={routeCount ?? "Not analyzed"} />
              <Metric label="Unidentified files" value={unclassifiedCount ?? "Not classified"} />
            </dl>
            <section className="mt-5">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold text-foreground">Routes</h3>
                <span className="text-[10px] tabular-nums text-(--app-muted)">{routes.length}</span>
              </div>
              {routes.length > 0 ? (
                <div className="max-h-52 overflow-y-auto rounded-md border border-(--app-border)">
                  <table className="w-full text-left text-[10px]">
                    <thead className="sticky top-0 bg-(--app-panel) text-(--app-muted)">
                      <tr><th className="px-2 py-1.5 font-medium">Method</th><th className="px-2 py-1.5 font-medium">Pattern</th></tr>
                    </thead>
                    <tbody>
                      {routes.map((route, index) => (
                        <tr key={`${route.method}:${route.path}:${route.sourceFile}:${index}`} className="border-t border-(--app-border)">
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-sky-300">{route.method}</td>
                          <td className="px-2 py-1.5">
                            <button type="button" title={route.sourceFile} onClick={() => onSelectFile(route.sourceFile)} className="block max-w-full truncate font-mono text-(--app-fg) hover:text-sky-300">
                              {route.path}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-[10px] text-(--app-muted)">No exact routes were found.</p>}
            </section>
            <PathList
              title="Most depended on"
              paths={topDependedOn.map((file) => file.path)}
              selectedPath={null}
              isHovered={isHovered}
              emptyLabel="No incoming imports"
              onSelectFile={onSelectFile}
              onHover={onHover}
            />
            <PathList
              title="Files nothing imports"
              paths={readingStarts.map((file) => file.path)}
              selectedPath={null}
              isHovered={isHovered}
              emptyLabel="No unreferenced files"
              onSelectFile={onSelectFile}
              onHover={onHover}
            />
          </>
        )}

        <details className="mt-5 border-t border-(--app-border) pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-semibold text-foreground">
            <span>Insights</span>
            <span className="text-[10px] font-normal tabular-nums text-(--app-muted)">
              {insights.unimportedFiles.length + insights.cycles.length + insights.highlyImportedFiles.length + insights.oversizedFiles.length}
            </span>
          </summary>
          <section className="mt-3">
            <h3 className="text-[10px] font-semibold text-foreground">Files nothing imports · {insights.unimportedFiles.length}</h3>
            <p className="mt-1 text-[10px] text-(--app-muted)">{insightCopy.unimported}</p>
            {insights.unimportedFiles.length ? (
              <PathList title="Files" paths={insights.unimportedFiles} selectedPath={selectedFile?.path ?? null} isHovered={isHovered} emptyLabel="None" onSelectFile={onSelectFile} onHover={onHover} />
            ) : <p className="mt-1 text-[10px] text-(--app-muted)">No matching files.</p>}
          </section>
          <section className="mt-4">
            <h3 className="text-[10px] font-semibold text-foreground">Import cycles · {insights.cycles.length}</h3>
            <p className="mt-1 text-[10px] text-(--app-muted)">{insightCopy.cycles}</p>
            {insights.cycles.map((cycle, index) => (
              <PathList key={cycle.join("|")} title={`Cycle ${index + 1}`} paths={cycle} selectedPath={selectedFile?.path ?? null} isHovered={isHovered} emptyLabel="None" onSelectFile={onSelectFile} onHover={onHover} />
            ))}
          </section>
          <section className="mt-4">
            <h3 className="text-[10px] font-semibold text-foreground">Unusually depended on · {insights.highlyImportedFiles.length}</h3>
            <p className="mt-1 text-[10px] text-(--app-muted)">{insightCopy.highFanIn}</p>
            <PathList title="Files" paths={insights.highlyImportedFiles} selectedPath={selectedFile?.path ?? null} isHovered={isHovered} emptyLabel="None" onSelectFile={onSelectFile} onHover={onHover} />
          </section>
          <section className="mt-4">
            <h3 className="text-[10px] font-semibold text-foreground">Long files · {insights.oversizedFiles.length}</h3>
            <p className="mt-1 text-[10px] text-(--app-muted)">{insightCopy.oversized}</p>
            <PathList title="Files" paths={insights.oversizedFiles} selectedPath={selectedFile?.path ?? null} isHovered={isHovered} emptyLabel="None" onSelectFile={onSelectFile} onHover={onHover} />
          </section>
        </details>
      </div>
    </aside>
  );
}
