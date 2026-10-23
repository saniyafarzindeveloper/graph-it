import fs from "node:fs";
import { loadProjectEnv } from "./env.mts";
import { checkInventedPaths } from "../lib/evals/invented-paths.ts";

loadProjectEnv();

type Example = { explanation: string; sourcePaths: string[] };
const inputPath = process.argv[2];
if (!inputPath || !fs.existsSync(inputPath)) {
  console.error("Usage: npm run eval:paths -- <dataset.json>");
  console.error('Dataset format: [{"explanation":"...","sourcePaths":["src/index.ts"]}]');
  process.exit(2);
}

const examples = JSON.parse(fs.readFileSync(inputPath, "utf8")) as Example[];
if (!Array.isArray(examples)) throw new Error("The dataset must be a JSON array.");
const results = examples.map((example, index) => ({
  index: index + 1,
  ...checkInventedPaths(example.explanation, example.sourcePaths),
}));
const candidates = results.reduce((sum, result) => sum + result.totalPaths, 0);
const valid = results.reduce((sum, result) => sum + result.validPaths, 0);
console.log(JSON.stringify({
  examples: results.length,
  pathTokens: candidates,
  validPaths: valid,
  inventedPaths: candidates - valid,
  score: candidates === 0 ? 100 : Math.round((valid / candidates) * 100),
  failures: results.filter((result) => result.invalidPaths.length > 0),
}, null, 2));
