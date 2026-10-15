import fs from "node:fs";
import path from "node:path";
import { parseRepository } from "../lib/repo-parser/index.ts";

const args = process.argv.slice(2);
let root = process.cwd();
let outputPath: string | undefined;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === "--root") {
    root = path.resolve(args[index + 1] ?? process.cwd());
    index += 1;
    continue;
  }

  if (arg === "--out") {
    outputPath = path.resolve(args[index + 1] ?? "repo-output.json");
    index += 1;
    continue;
  }

  if (arg === "--help") {
    console.log("Usage: node --experimental-strip-types scripts/parse-repo.mts [--root PATH] [--out PATH]");
    process.exit(0);
  }
}

const result = parseRepository(root);

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
}

console.log(JSON.stringify(
  {
    root,
    filesFound: result.coverage.filesFound,
    filesParsed: result.coverage.filesParsed,
    filesSkipped: result.coverage.filesSkipped,
    folderCount: result.folderCount,
    importsResolved: result.coverage.importsResolved,
    importsUnresolved: result.coverage.importsUnresolved,
    reExportsFound: result.coverage.reExportsFound,
    reExportsResolved: result.coverage.reExportsResolved,
    outputPath: outputPath ?? "stdout-only",
  },
  null,
  2,
));
