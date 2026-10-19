import { honoPreview } from "@/data/hono-preview";
import { CanvasPreview, type FileCategory } from "@/components/canvas-preview";
import { foldRepository } from "@/lib/canvas/folding";

const folded = foldRepository(honoPreview.files, honoPreview.edges);
const categoryColors: Record<string, string> = {
  ".ts": "#60a5fa",
  ".tsx": "#34d399",
  ".js": "#f59e0b",
  ".jsx": "#f472b6",
  ".mjs": "#a78bfa",
  ".cjs": "#22d3ee",
  ".mts": "#4ade80",
  ".cts": "#fb7185",
};

const categoryLabels: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TSX",
  ".js": "JavaScript",
  ".jsx": "JSX",
  ".mjs": "MJS",
  ".cjs": "CJS",
  ".mts": "MTS",
  ".cts": "CTS",
};

const categories: FileCategory[] = Object.entries(
  honoPreview.files.reduce<Record<string, number>>((counts, file) => {
    counts[file.extension] = (counts[file.extension] ?? 0) + 1;
    return counts;
  }, {}),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([extension, count]) => ({
    id: extension,
    label: categoryLabels[extension] ?? extension,
    count,
    color: categoryColors[extension] ?? "#a1a1aa",
  }));

export default function PreviewPage() {
  return (
    <div className="relative left-1/2 w-[calc(100vw-3rem)] max-w-none -translate-x-1/2 lg:h-[calc(100svh-8rem)]">
      <CanvasPreview
        repoLabel="honojs/hono"
        folders={folded.nodes}
        fileToNode={Array.from(folded.fileToNode.entries())}
        edges={honoPreview.edges}
        categories={categories}
        threshold={folded.threshold}
        coverage={honoPreview.coverage}
        framework={null}
        routeCount={null}
        unclassifiedCount={honoPreview.files.length}
      />
    </div>
  );
}
