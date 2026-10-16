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
import type { RepoEdge, RepoFile } from "@/lib/repo-parser/index";

export interface FileCategory {
  id: string;
  label: string;
  count: number;
  color: string;
}

interface CanvasPreviewProps {
  repoLabel: string;
  folders: FoldedFolder[];
  fileToNode: Array<[string, string]>;
  edges: RepoEdge[];
  categories: FileCategory[];
  threshold: number;
}

function FolderNode({ data }: NodeProps<CanvasNode>) {
  const {
    folder,
    expanded,
    visibleFiles,
    hiddenFileCount,
    selectedFile,
    hasSelection,
    highlightedFilePaths,
    hiddenFilesHighlighted,
    categoryColors,
  } = data;
  const selectedFolder = data.selectedFolder;
  const highlightedFiles = new Set(highlightedFilePaths);

  return (
    <div
      className={[
        "relative h-full w-full overflow-hidden rounded-md border bg-(--app-panel) text-foreground shadow-sm",
        selectedFolder ? "border-sky-400 ring-1 ring-sky-400/50" : "border-(--app-border)",
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
      </button>

      {expanded ? (
        <div className="border-t border-(--app-border) px-2 pb-2">
          <div className="max-h-61 overflow-y-auto">
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
                      hasSelection && !highlightedFiles.has(file.path) ? "opacity-25" : "opacity-100",
                    ].join(" ")}
                    onClick={(event) => {
                      event.stopPropagation();
                      data.onSelectFile(file.path);
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: categoryColors[file.extension] ?? "#a1a1aa" }}
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
            {hiddenFileCount > 0 ? (
              <div onClick={(event) => event.stopPropagation()} className={[
                "relative flex h-6.75 items-center px-2 text-[10px] text-(--app-muted)",
                hasSelection && !hiddenFilesHighlighted ? "opacity-25" : "opacity-100",
              ].join(" ")}>
                <Handle type="target" id="in:more" position={Position.Left} className="h-1.5! w-1.5! border-0! bg-emerald-500!" />
                + {hiddenFileCount} more files
                <Handle type="source" id="out:more" position={Position.Right} className="h-1.5! w-1.5! border-0! bg-amber-500!" />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const nodeTypes: NodeTypes = { folder: FolderNode };

function CanvasStage({ repoLabel, folders, fileToNode, edges, categories, threshold }: CanvasPreviewProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const previousExpandedCount = useRef(0);
  const { fitView, getZoom } = useReactFlow<CanvasNode, CanvasEdge>();
  const folded = useMemo(
    () => ({ nodes: folders, fileToNode: new Map(fileToNode), threshold }),
    [folders, fileToNode, threshold],
  );
  const categoryColors = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category.color])),
    [categories],
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
    setSelection({ kind: "file", id: filePath });
  }, []);

  const graph = useMemo(
    () => createCanvasLayout(folded, edges, expandedFolders, selection, selectFile, categoryColors),
    [folded, edges, expandedFolders, selection, selectFile, categoryColors],
  );

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: CanvasNode) => {
    toggleFolder(node.data.folder.id);
  }, [toggleFolder]);

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
    <main className="grid h-full min-h-136 grid-cols-1 gap-3 lg:grid-cols-[14rem_minmax(0,1fr)_18rem]">
      <aside aria-label="File categories" className="min-h-28 overflow-y-auto rounded-md border border-(--app-border) bg-(--app-panel) p-3 lg:min-h-0">
        <h1 className="mb-3 text-xs font-semibold text-foreground">File categories</h1>
        <ul className="space-y-2">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center gap-2 text-xs text-(--app-muted)">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: category.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{category.label}</span>
              <span className="tabular-nums">{category.count}</span>
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
          fitView
          fitViewOptions={{ padding: 0.18, minZoom: 0.12, maxZoom: 1.05 }}
          minZoom={0.12}
          maxZoom={1.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          defaultEdgeOptions={{ type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }}
          proOptions={{ hideAttribution: false }}
        >
          <Background color="var(--app-border)" gap={22} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      </section>

      <aside aria-label="Details" className="min-h-28 rounded-md border border-(--app-border) bg-(--app-panel) p-3 lg:min-h-0">
        <h2 className="text-xs font-semibold text-(--app-muted)">Details</h2>
      </aside>
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