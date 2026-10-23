export interface EvalFilePath {
  id: string;
  path: string;
  folder: string | null;
}

export interface EvalFileEdge {
  source_file_id: string;
  target_file_id: string;
}

export function collectExplanationEvidence(
  targetKind: "file" | "folder",
  targetPath: string,
  files: EvalFilePath[],
  edges: EvalFileEdge[],
) {
  const fileById = new Map(files.map((file) => [file.id, file]));
  const sourcePaths = new Set<string>();
  const relationships: string[] = [];

  if (targetKind === "file") {
    const focus = files.find((file) => file.path === targetPath);
    if (!focus) return { sourcePaths: [], relationships };
    sourcePaths.add(focus.path);
    for (const edge of edges) {
      const source = fileById.get(edge.source_file_id);
      const target = fileById.get(edge.target_file_id);
      if (!source || !target) continue;
      if (source.id === focus.id) {
        sourcePaths.add(target.path);
        relationships.push(`${source.path} imports ${target.path}`);
      }
      if (target.id === focus.id) {
        sourcePaths.add(source.path);
        relationships.push(`${source.path} imports ${target.path}`);
      }
    }
  } else {
    const inside = (file: EvalFilePath) => targetPath === "." || file.path.startsWith(`${targetPath}/`);
    const members = files.filter(inside);
    const memberIds = new Set(members.map((file) => file.id));
    for (const file of members) sourcePaths.add(file.path);
    for (const edge of edges) {
      const source = fileById.get(edge.source_file_id);
      const target = fileById.get(edge.target_file_id);
      if (!source || !target) continue;
      const sourceInside = memberIds.has(source.id);
      const targetInside = memberIds.has(target.id);
      if (sourceInside === targetInside) continue;
      sourcePaths.add(source.path);
      sourcePaths.add(target.path);
      relationships.push(`${source.path} imports ${target.path}${sourceInside ? " (outgoing from folder)" : " (incoming to folder)"}`);
    }
  }

  return {
    sourcePaths: [...sourcePaths].sort(),
    relationships: [...new Set(relationships)].sort(),
  };
}
