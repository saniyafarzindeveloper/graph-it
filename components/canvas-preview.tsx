"use client";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCanvasLayout, type CanvasEdge, type CanvasNode, type CanvasSelection } from "@/lib/canvas/layout";
import type { FoldedFolder } from "@/lib/canvas/folding";
import type { CoverageReport, RepoEdge, RepoFile } from "@/lib/repo-parser/index";
import { CanvasDetailPane, type DetailTab } from "@/components/canvas-detail-pane";
import { analyzeRepository } from "@/lib/canvas/analysis";
import type { FrameworkRoute } from "@/lib/repo-parser/adapters";

export interface FileCategory {
  id: string;
  label: string;
  count: number;
  color: string;
  filePaths?: string[];
}

interface CanvasPreviewProps {
  analysisId?: string | null;
  tracingConfigured?: boolean;
  initialAiRoles?: Array<[string, string]>;
  repoLabel: string;
  folders: FoldedFolder[];
  fileToNode: Array<[string, string]>;
  edges: RepoEdge[];
  categories: FileCategory[];
  categoriesTitle?: string;
  routes?: FrameworkRoute[];
  threshold: number;
  coverage: CoverageReport;
  framework: string | null;
  routeCount: number | null;
  unclassifiedCount: number | null;
}

function FolderNode({ data }: NodeProps<CanvasNode>) {
  const {
    folder,
    expanded,
    visibleFiles,
    hiddenFileCount,
    selectedFile,
    hasFocus,
    highlightedFilePaths,
    hoveredFilePaths,
    hoveredFolder,
    categoryColors,
    categoryFilter,
    categoryMatchCount,
    categoryMatchedFilePaths,
  } = data;
  const selectedFolder = data.selectedFolder;
  const highlightedFiles = new Set(highlightedFilePaths);

  return (
    <div
      className={[
        "relative h-full w-full overflow-hidden rounded-md border bg-(--app-panel) text-foreground shadow-sm transition-all duration-100",
        selectedFolder || hoveredFolder || hoveredFilePaths.length > 0 ? "border-sky-400 ring-1 ring-sky-400/50" : "border-(--app-border)",
        data.dimmed ? "opacity-20" : "opacity-100",
      ].join(" ")}
      title={folder.folder}
    >
      {expanded ? null : <Handle type="target" id="in" position={Position.Left} className="h-2! w-2! border-0! bg-emerald-500!" />}
      {expanded ? null : <Handle type="source" id="out" position={Position.Right} className="h-2! w-2! border-0! bg-amber-500!" />}

      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Close" : "Open"} ${folder.label}`}
        title={`${expanded ? "Close" : "Open"} ${folder.folder}`}
        className={[
          "nodrag nopan flex w-full flex-col justify-center px-3 text-left",
          expanded ? "h-19" : "h-full",
        ].join(" ")}
      >
        <span className="truncate font-mono text-xs font-semibold">{folder.label}</span>
        <span className="mt-1 flex items-center gap-3 text-[10px] text-(--app-muted)">
          <span>{folder.files.length} files</span>
          <span>in {folder.fanIn}</span>
          <span>out {folder.fanOut}</span>
        </span>
        {expanded && categoryFilter ? (
          <span className="mt-1 text-[10px] text-sky-300">{categoryMatchCount} / {folder.files.length} match category</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="border-t border-(--app-border) px-2 pb-2">
          {hiddenFileCount > 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-(--app-muted)">
              {hiddenFileCount} additional files below
            </div>
          ) : null}
          <div
            aria-label={`${folder.label} files`}
            className="nowheel nodrag nopan max-h-61 overflow-y-auto overscroll-contain"
            tabIndex={0}
          >
            {visibleFiles.map((file: RepoFile) => {
              const selected = selectedFile === file.path;
              return (
                <div key={file.path} className="relative flex h-6.25 items-center">
                  <Handle
                    type="target"
                    id={`in:${file.path}`}
                    position={Position.Left}
                    className="h-1.5! w-1.5! border-0! bg-emerald-500!"
                  />
                  <button
                    type="button"
                    title={file.path}
                    className={[
                      "nodrag nopan flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left font-mono text-[10px]",
                      selected ? "bg-sky-500/15 text-sky-300" : "text-(--app-muted) hover:bg-(--app-hover) hover:text-foreground",
                      !categoryFilter && hasFocus && !highlightedFiles.has(file.path) ? "opacity-25" : "opacity-100",
                      categoryFilter && !categoryMatchedFilePaths.includes(file.path) ? "opacity-20" : "",
                      hoveredFilePaths.includes(file.path) ? "bg-sky-500/15 text-sky-300" : "",
                    ].join(" ")}
                    onClick={(event) => {
                      event.stopPropagation();
                      data.onSelectFile(file.path);
                    }}
                    onMouseEnter={() => data.onHover({ kind: "file", id: file.path })}
                    onMouseLeave={() => data.onHover({ kind: "folder", id: folder.id })}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: categoryColors?.[file.extension] ?? "#a1a1aa" }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{file.path.slice(folder.folder === "." ? 0 : folder.folder.length + 1)}</span>
                  </button>
                  <Handle
                    type="source"
                    id={`out:${file.path}`}
                    position={Position.Right}
                    className="h-1.5! w-1.5! border-0! bg-amber-500!"
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const nodeTypes: NodeTypes = { folder: FolderNode };

const extensionColors: Record<string, string> = {
  ".ts": "#60a5fa",
  ".tsx": "#34d399",
  ".js": "#f59e0b",
  ".jsx": "#f472b6",
  ".mjs": "#a78bfa",
  ".cjs": "#22d3ee",
  ".mts": "#4ade80",
  ".cts": "#fb7185",
};

function CanvasStage({
  analysisId = null,
  tracingConfigured = false,
  initialAiRoles = [],
  repoLabel,
  folders,
  fileToNode,
  edges,
  categories,
  categoriesTitle,
  routes = [],
  threshold,
  coverage,
  framework,
  routeCount,
  unclassifiedCount,
}: CanvasPreviewProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [hovered, setHovered] = useState<CanvasSelection>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("structure");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const previousExpandedCount = useRef(0);
  const hoverClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { fitView, getZoom } = useReactFlow<CanvasNode, CanvasEdge>();
  const folded = useMemo(
    () => ({ nodes: folders, fileToNode: new Map(fileToNode), threshold }),
    [folders, fileToNode, threshold],
  );
  const categoryColors = useMemo(
    () => ({ ...extensionColors, ...Object.fromEntries(categories.map((category) => [category.id, category.color])) }),
    [categories],
  );
  const categoryPaths = useMemo(
    () => new Map(categories.filter((category) => category.filePaths).map((category) => [category.id, category.filePaths!])),
    [categories],
  );

  const allFiles = useMemo(() => folders.flatMap((folder) => folder.files), [folders]);
  const insights = useMemo(() => analyzeRepository(allFiles, edges), [allFiles, edges]);
  const updateHover = useCallback((target: CanvasSelection) => {
    if (hoverClearTimer.current) clearTimeout(hoverClearTimer.current);
    hoverClearTimer.current = null;
    if (target) {
      setHovered(target);
      return;
    }
    hoverClearTimer.current = setTimeout(() => {
      setHovered(null);
      hoverClearTimer.current = null;
    }, 70);
  }, []);
  const selectedFile = useMemo(
    () => selection?.kind === "file" ? allFiles.find((file) => file.path === selection.id) ?? null : null,
    [allFiles, selection],
  );
  const selectedFolder = useMemo(
    () => selection?.kind === "folder" ? folders.find((folder) => folder.id === selection.id) ?? null : null,
    [folders, selection],
  );

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
    setSelection({ kind: "folder", id: folderId });
  }, []);

  const selectFile = useCallback((filePath: string) => {
    const folderId = folded.fileToNode.get(filePath);
    if (folderId) {
      setExpandedFolders((current) => current.has(folderId) ? current : new Set([...current, folderId]));
    }
    setSelection({ kind: "file", id: filePath });
  }, [folded]);

  const selectPath = useCallback((path: string) => {
    if (allFiles.some((file) => file.path === path)) {
      selectFile(path);
      return;
    }
    const folder = folders.find((item) => item.id === path);
    if (!folder) return;
    setExpandedFolders((current) => current.has(folder.id) ? current : new Set([...current, folder.id]));
    setSelection({ kind: "folder", id: folder.id });
  }, [allFiles, folders, selectFile]);

  const graph = useMemo(
    () => createCanvasLayout(folded, edges, expandedFolders, selection, hovered, selectFile, setHovered, categoryColors, categoryFilter, categoryPaths),
    [folded, edges, expandedFolders, selection, hovered, selectFile, categoryColors, categoryFilter, categoryPaths],
  );

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: CanvasNode) => {
    toggleFolder(node.data.folder.id);
  }, [toggleFolder]);

  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: CanvasNode) => {
    updateHover({ kind: "folder", id: node.data.folder.id });
  }, [updateHover]);

  const handleNodeMouseLeave = useCallback((_event: React.MouseEvent, node: CanvasNode) => {
    if (hovered?.kind === "folder" && hovered.id === node.data.folder.id) updateHover(null);
  }, [hovered, updateHover]);

  useEffect(() => () => {
    if (hoverClearTimer.current) clearTimeout(hoverClearTimer.current);
  }, []);

  useEffect(() => {
    const openedFolder = expandedFolders.size > previousExpandedCount.current;
    previousExpandedCount.current = expandedFolders.size;
    if (!openedFolder) return;

    const zoomBeforeOpen = getZoom();
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.12, minZoom: 0.12, maxZoom: zoomBeforeOpen, duration: 180 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedFolders, fitView, getZoom]);

  return (
    <main className="grid h-full min-h-136 grid-cols-1 gap-3 lg:grid-cols-[minmax(14rem,16%)_minmax(0,1fr)_minmax(18rem,24%)]">
      <aside aria-label={categoriesTitle ?? "File categories"} className="min-h-28 overflow-y-auto rounded-md border border-(--app-border) bg-(--app-panel) p-3 lg:min-h-0">
        <h1 className="mb-3 text-xs font-semibold text-foreground">{categoriesTitle ?? "File categories"}</h1>
        <ul className="space-y-2">
          {categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                aria-pressed={categoryFilter === category.id}
                title={categoryFilter === category.id ? "Clear category filter" : `Highlight ${category.label} files`}
                onClick={() => setCategoryFilter((current) => current === category.id ? null : category.id)}
                className={["flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs transition", categoryFilter === category.id ? "bg-sky-500/15 text-foreground" : "text-(--app-muted) hover:bg-(--app-hover) hover:text-foreground"].join(" ")}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: category.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{category.label}</span>
                <span className="tabular-nums">{category.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section aria-label="Dependency map" className="relative min-h-[55svh] overflow-hidden rounded-md border border-(--app-border) bg-(--app-panel) lg:min-h-0">
        <div className="absolute left-3 top-3 z-10 rounded border border-(--app-border) bg-(--app-panel)/90 px-2 py-1 font-mono text-[10px] text-(--app-muted)">
          {repoLabel} · {graph.nodes.length} folders · {folders.reduce((sum, folder) => sum + folder.files.length, 0)} files
        </div>
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          onPaneClick={() => {
            setSelection(null);
            if (hoverClearTimer.current) clearTimeout(hoverClearTimer.current);
            hoverClearTimer.current = null;
            setHovered(null);
          }}
          fitView
          fitViewOptions={{ padding: 0.18, minZoom: 0.12, maxZoom: 1.05 }}
          minZoom={0.12}
          maxZoom={1.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          defaultEdgeOptions={{ type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--app-border)" gap={22} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      </section>

      <CanvasDetailPane
        analysisId={analysisId}
        tracingConfigured={tracingConfigured}
        initialAiRoles={initialAiRoles}
        repoName={repoLabel}
        files={allFiles}
        edges={edges}
        insights={insights}
        coverage={coverage}
        framework={framework}
        routeCount={routeCount}
        unclassifiedCount={unclassifiedCount}
        routes={routes}
        fileToNode={folded.fileToNode}
        hovered={hovered}
        selectedFile={selectedFile}
        selectedFolder={selectedFolder}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSelectFile={selectFile}
        onSelectPath={selectPath}
        onHover={updateHover}
      />
    </main>
  );
}

export function CanvasPreview(props: CanvasPreviewProps) {
  return (
    <ReactFlowProvider>
      <CanvasStage {...props} />
    </ReactFlowProvider>
  );
}
