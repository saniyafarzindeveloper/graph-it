import path from "node:path";
import type { RepoEdge, RepoFile } from "@/lib/repo-parser/index";

export interface FoldedFolder {
  id: string;
  folder: string;
  label: string;
  files: RepoFile[];
  fanIn: number;
  fanOut: number;
}

export interface FoldedRepository {
  nodes: FoldedFolder[];
  fileToNode: Map<string, string>;
  threshold: number;
}

interface DirectoryEntry {
  folder: string;
  files: RepoFile[];
}

function getDirectoryEntries(files: RepoFile[]): Map<string, DirectoryEntry> {
  const directories = new Map<string, DirectoryEntry>();

  for (const file of files) {
    let folder = file.folder;
    while (true) {
      if (!directories.has(folder)) {
        directories.set(folder, { folder, files: [] });
      }
      if (folder === ".") break;
      folder = path.posix.dirname(folder) || ".";
    }
    directories.get(file.folder)?.files.push(file);
  }

  return directories;
}

function foldAtThreshold(files: RepoFile[], threshold: number): FoldedFolder[] {
  const directories = getDirectoryEntries(files);
  const accumulated = new Map<string, RepoFile[]>();
  const orderedFolders = Array.from(directories.keys()).sort((left, right) => {
    const leftDepth = left === "." ? 0 : left.split("/").length;
    const rightDepth = right === "." ? 0 : right.split("/").length;
    const depthDifference = rightDepth - leftDepth;
    return depthDifference || left.localeCompare(right);
  });
  const result: FoldedFolder[] = [];

  for (const folder of orderedFolders) {
    const entry = directories.get(folder);
    if (!entry) continue;

    const folderFiles = [...entry.files, ...(accumulated.get(folder) ?? [])].sort((left, right) =>
      left.path.localeCompare(right.path),
    );

    if (folder !== "." && folderFiles.length < threshold) {
      const parent = path.posix.dirname(folder) || ".";
      accumulated.set(parent, [...(accumulated.get(parent) ?? []), ...folderFiles]);
      continue;
    }

    if (folderFiles.length > 0) {
      result.push({
        id: folder,
        folder,
        label: folder,
        files: folderFiles,
        fanIn: 0,
        fanOut: 0,
      });
    }
  }

  return result.sort((left, right) => left.folder.localeCompare(right.folder));
}

function assignUniqueLabels(nodes: FoldedFolder[]): void {
  const parts = nodes.map((node) => node.folder === "." ? ["root"] : node.folder.split("/"));

  nodes.forEach((node, index) => {
    const segments = parts[index];
    if (!segments) return;

    for (let length = 1; length <= segments.length; length += 1) {
      const candidate = segments.slice(-length).join("/");
      const matches = parts.filter((other) => other.slice(-length).join("/") === candidate).length;
      if (matches === 1) {
        node.label = candidate;
        break;
      }
    }
  });
}

export function foldRepository(
  files: RepoFile[],
  edges: RepoEdge[],
  maximumNodes = 24,
): FoldedRepository {
  if (files.length === 0) {
    return { nodes: [], fileToNode: new Map(), threshold: 2 };
  }

  let threshold = 2;
  let nodes = foldAtThreshold(files, threshold);

  while (nodes.length > maximumNodes && threshold < files.length) {
    threshold += 1;
    nodes = foldAtThreshold(files, threshold);
  }

  assignUniqueLabels(nodes);
  const fileToNode = new Map<string, string>();
  for (const node of nodes) {
    for (const file of node.files) {
      fileToNode.set(file.path, node.id);
    }
  }

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.resolution !== "inside") continue;

    const sourceNode = fileToNode.get(edge.source);
    const targetNode = fileToNode.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode === targetNode) continue;

    const outgoingEdges = outgoing.get(sourceNode) ?? new Set<string>();
    outgoingEdges.add(`${edge.source}\0${edge.target}`);
    outgoing.set(sourceNode, outgoingEdges);

    const incomingEdges = incoming.get(targetNode) ?? new Set<string>();
    incomingEdges.add(`${edge.source}\0${edge.target}`);
    incoming.set(targetNode, incomingEdges);
  }

  for (const node of nodes) {
    node.fanIn = incoming.get(node.id)?.size ?? 0;
    node.fanOut = outgoing.get(node.id)?.size ?? 0;
  }

  return { nodes, fileToNode, threshold };
}