import * as dagre from "@dagrejs/dagre";
import { MarkerType } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import type { ImportKind, RepoEdge, RepoFile } from "@/lib/repo-parser/index";
import type { FoldedFolder, FoldedRepository } from "./folding";

export const MAX_VISIBLE_FILES = 9;

export type CanvasSelection =
  | { kind: "folder"; id: string }
  | { kind: "file"; id: string }
  | null;

export interface CanvasNodeData extends Record<string, unknown> {
  folder: FoldedFolder;
  expanded: boolean;
  visibleFiles: RepoFile[];
  hiddenFileCount: number;
  selectedFile: string | null;
  selectedFolder: boolean;
  hasFocus: boolean;
  highlightedFilePaths: string[];
  hoveredFilePaths: string[];
  hoveredFolder: boolean;
  categoryColors: Record<string, string>;
  dimmed: boolean;
  onSelectFile: (filePath: string) => void;
  onHover: (target: CanvasSelection) => void;
}

export interface CanvasEdgeData extends Record<string, unknown> {
  kind: ImportKind;
  count: number;
  dimmed: boolean;
}

export type CanvasNode = Node<CanvasNodeData, "folder">;
export type CanvasEdge = Edge<CanvasEdgeData>;

interface EdgeAggregate {
  sourceNode: string;
  targetNode: string;
  kind: ImportKind;
  count: number;
  sourceFile: string;
  targetFile: string;
}

function flowNodeId(folderId: string): string {
  return `folder:${folderId}`;
}

function endpointHandle(folder: FoldedFolder, expanded: boolean, filePath: string, type: "in" | "out"): string {
  if (!expanded) return type;
  const isVisible = folder.files.some((file) => file.path === filePath);
  return isVisible ? `${type}:${filePath}` : `${type}:more`;
}

function getSelectionFiles(selection: CanvasSelection, folded: FoldedRepository): Set<string> {
  if (!selection) return new Set();
  if (selection.kind === "file") return new Set([selection.id]);
  return new Set(folded.nodes.find((node) => node.id === selection.id)?.files.map((file) => file.path) ?? []);
}

export function createCanvasLayout(
  folded: FoldedRepository,
  rawEdges: RepoEdge[],
  expandedFolders: Set<string>,
  selection: CanvasSelection,
  hovered: CanvasSelection,
  onSelectFile: (filePath: string) => void,
  onHover: (target: CanvasSelection) => void,
  categoryColors: Record<string, string>,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const primaryFiles = getSelectionFiles(selection, folded);
  const hoveredFiles = getSelectionFiles(hovered, folded);
  const activeFiles = new Set([...primaryFiles, ...hoveredFiles]);
  const eligibleEdges = rawEdges.filter(
    (edge) => edge.resolution === "inside" && folded.fileToNode.has(edge.source) && folded.fileToNode.has(edge.target),
  );

  for (const edge of eligibleEdges) {
    if (primaryFiles.has(edge.source)) activeFiles.add(edge.target);
    if (primaryFiles.has(edge.target)) activeFiles.add(edge.source);
    if (hoveredFiles.has(edge.source)) activeFiles.add(edge.target);
    if (hoveredFiles.has(edge.target)) activeFiles.add(edge.source);
  }

  const activeNodes = new Set<string>();
  for (const filePath of activeFiles) {
    const folderId = folded.fileToNode.get(filePath);
    if (folderId) activeNodes.add(folderId);
  }

  const nodeSizes = new Map<string, { width: number; height: number }>();
  for (const folder of folded.nodes) {
    const expanded = expandedFolders.has(folder.id);
    const width = expanded ? 300 : Math.max(156, Math.min(276, folder.label.length * 7.5 + 58));
    const height = expanded
      ? 76 + Math.min(folder.files.length * 25, 244) + (folder.files.length > MAX_VISIBLE_FILES ? 27 : 0) + 10
      : 54 + Math.min(folder.fanIn, 18) * 3;
    nodeSizes.set(folder.id, { width, height });
  }

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "LR",
    nodesep: 58,
    ranksep: 90,
    marginx: 36,
    marginy: 36,
    ranker: "network-simplex",
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const folder of folded.nodes) {
    const size = nodeSizes.get(folder.id);
    if (size) graph.setNode(flowNodeId(folder.id), size);
  }

  const layoutPairs = new Set<string>();
  for (const edge of eligibleEdges) {
    const sourceNode = folded.fileToNode.get(edge.source);
    const targetNode = folded.fileToNode.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode === targetNode) continue;
    const pair = `${sourceNode}\0${targetNode}`;
    if (!layoutPairs.has(pair)) {
      graph.setEdge(flowNodeId(sourceNode), flowNodeId(targetNode));
      layoutPairs.add(pair);
    }
  }

  dagre.layout(graph);

  const nodes: CanvasNode[] = folded.nodes.map((folder) => {
    const expanded = expandedFolders.has(folder.id);
    const size = nodeSizes.get(folder.id) ?? { width: 180, height: 60 };
    const position = graph.node(flowNodeId(folder.id));
    return {
      id: flowNodeId(folder.id),
      type: "folder",
      position: {
        x: (position?.x ?? 0) - size.width / 2,
        y: (position?.y ?? 0) - size.height / 2,
      },
      width: size.width,
      height: size.height,
      style: { width: size.width, height: size.height },
      data: {
        folder,
        expanded,
        visibleFiles: folder.files,
        hiddenFileCount: Math.max(0, folder.files.length - MAX_VISIBLE_FILES),
        selectedFile: selection?.kind === "file" ? selection.id : null,
        selectedFolder: selection?.kind === "folder" && selection.id === folder.id,
        hasFocus: selection !== null || hovered !== null,
        highlightedFilePaths: folder.files.filter((file) => activeFiles.has(file.path)).map((file) => file.path),
        hoveredFilePaths: folder.files.filter((file) => hoveredFiles.has(file.path)).map((file) => file.path),
        hoveredFolder: hovered?.kind === "folder" && hovered.id === folder.id,
        categoryColors,
        dimmed: (selection !== null || hovered !== null) && !activeNodes.has(folder.id),
        onSelectFile,
        onHover,
      },
      zIndex: activeNodes.has(folder.id) ? 2 : 1,
    };
  });

  const aggregates = new Map<string, EdgeAggregate>();
  const individualEdges: EdgeAggregate[] = [];

  for (const edge of eligibleEdges) {
    const sourceFolderId = folded.fileToNode.get(edge.source);
    const targetFolderId = folded.fileToNode.get(edge.target);
    if (!sourceFolderId || !targetFolderId) continue;

    const sourceExpanded = expandedFolders.has(sourceFolderId);
    const targetExpanded = expandedFolders.has(targetFolderId);
    if (sourceFolderId === targetFolderId && !sourceExpanded) continue;

    if (!sourceExpanded && !targetExpanded && selection === null && sourceFolderId !== targetFolderId) {
      const key = `${sourceFolderId}\0${targetFolderId}\0${edge.kind}`;
      const aggregate = aggregates.get(key);
      if (aggregate) {
        aggregate.count += 1;
      } else {
        aggregates.set(key, {
          sourceNode: sourceFolderId,
          targetNode: targetFolderId,
          kind: edge.kind,
          count: 1,
          sourceFile: edge.source,
          targetFile: edge.target,
        });
      }
      continue;
    }

    individualEdges.push({
      sourceNode: sourceFolderId,
      targetNode: targetFolderId,
      kind: edge.kind,
      count: 1,
      sourceFile: edge.source,
      targetFile: edge.target,
    });
  }

  const edgeRows = [...aggregates.values(), ...individualEdges];
  const edges: CanvasEdge[] = edgeRows.map((row, index) => {
    const sourceExpanded = expandedFolders.has(row.sourceNode);
    const targetExpanded = expandedFolders.has(row.targetNode);
    const highlighted =
      primaryFiles.has(row.sourceFile) || primaryFiles.has(row.targetFile) ||
      hoveredFiles.has(row.sourceFile) || hoveredFiles.has(row.targetFile);
    const outbound = primaryFiles.has(row.sourceFile) || hoveredFiles.has(row.sourceFile);
    const color = highlighted ? outbound ? "#d97706" : "#15803d" : "#71717a";
    return {
      id: `edge:${row.sourceNode}:${row.targetNode}:${row.kind}:${row.sourceFile}:${row.targetFile}:${index}`,
      source: flowNodeId(row.sourceNode),
      target: flowNodeId(row.targetNode),
      sourceHandle: endpointHandle(
        folded.nodes.find((node) => node.id === row.sourceNode)!,
        sourceExpanded,
        row.sourceFile,
        "out",
      ),
      targetHandle: endpointHandle(
        folded.nodes.find((node) => node.id === row.targetNode)!,
        targetExpanded,
        row.targetFile,
        "in",
      ),
      type: "smoothstep",
      label: row.count > 1 ? String(row.count) : undefined,
      labelStyle: { fontSize: 10, fill: "var(--app-muted)" },
      labelBgStyle: { fill: "var(--app-panel)", fillOpacity: 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: {
        stroke: color,
        strokeWidth: highlighted ? 2 : Math.min(1.4 + Math.log2(row.count), 4),
        opacity: (selection !== null || hovered !== null) && !highlighted ? 0.12 : 0.62,
      },
      zIndex: highlighted ? 2 : 0,
      data: { kind: row.kind, count: row.count, dimmed: (selection !== null || hovered !== null) && !highlighted },
    };
  });

  return { nodes, edges };
}