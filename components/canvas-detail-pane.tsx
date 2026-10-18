"use client";

import { useMemo } from "react";
import type { CoverageReport, RepoEdge, RepoFile } from "@/lib/repo-parser/index";
import type { FoldedFolder } from "@/lib/canvas/folding";
import type { CanvasSelection } from "@/lib/canvas/layout";

export type DetailTab = "structure" | "explanation";

interface CanvasDetailPaneProps {
  repoName: string;
  files: RepoFile[];
  edges: RepoEdge[];
  coverage: CoverageReport;
  framework: string | null;
  routeCount: number | null;
  unclassifiedCount: number | null;
  fileToNode: Map<string, string>;
  hovered: CanvasSelection;
  selectedFile: RepoFile | null;
  selectedFolder: FoldedFolder | null;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onSelectFile: (filePath: string) => void;
  onHover: (target: CanvasSelection) => void;
}

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
        "block w-full truncate rounded px-2 py-1 text-left font-mono text-[10px]",
        selected || hovered ? "bg-sky-500/15 text-sky-300" : "text-(--app-muted) hover:bg-(--app-hover) hover:text-foreground",
      ].join(" ")}
      title={filePath}
      onClick={() => onSelect(filePath)}
      onMouseEnter={() => onHover({ kind: "file", id: filePath })}
      onMouseLeave={() => onHover(null)}
    >
      {filePath}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-b border-(--app-border) py-2">
      <dt className="text-[10px] text-(--app-muted)">{label}</dt>
      <dd className="mt-0.5 truncate text-xs font-medium text-foreground">{value}</dd>
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
    <section className="mt-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold text-foreground">{title}</h3>
        <span className="text-[10px] tabular-nums text-(--app-muted)">{paths.length}</span>
      </div>
      {paths.length > 0 ? (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
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
  coverage,
  framework,
  routeCount,
  unclassifiedCount,
  fileToNode,
  hovered,
  selectedFile,
  selectedFolder,
  activeTab,
  onTabChange,
  onSelectFile,
  onHover,
}: CanvasDetailPaneProps) {
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

  const focusedLabel = hovered?.kind === "file"
    ? hovered.id
    : hovered?.kind === "folder"
      ? selectedFolder?.id === hovered.id ? selectedFolder.label : hovered.id
      : null;

  return (
    <aside aria-label="Details" className="flex max-h-[60svh] min-h-28 flex-col overflow-hidden rounded-md lg:max-h-none lg:min-h-0 border border-(--app-border) bg-(--app-panel)">
      <header className="border-b border-(--app-border) p-3">
        <div className="truncate font-mono text-xs font-semibold text-foreground" title={repoName}>{repoName}</div>
        <div role="tablist" aria-label="Detail view" className="mt-3 flex gap-1">
          {(["structure", "explanation"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={[
                "rounded px-2 py-1 text-[10px] font-medium capitalize",
                activeTab === tab ? "bg-(--app-hover) text-foreground" : "text-(--app-muted) hover:text-foreground",
              ].join(" ")}
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {focusedLabel ? (
        <div className="border-b border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[10px] text-sky-300">
          Map focus <span className="ml-1 font-mono">{focusedLabel}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
      </div>
    </aside>
  );
}
