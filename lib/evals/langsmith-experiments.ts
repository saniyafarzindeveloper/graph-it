import "server-only";

import { createHash } from "node:crypto";
import { Client, type Run } from "langsmith";
import { evaluate } from "langsmith/evaluation";

export interface LangSmithExampleInput {
  caseId: string;
  targetKind: "file" | "folder";
  targetPath: string;
  sourcePaths: string[];
  relationships: string[];
  sources: Array<{ path: string; content: string }>;
}

export interface LangSmithPromptComparison {
  caseId: string;
  targetPath: string;
  targetKind: "file" | "folder";
  v1: { explanation: string; usefulness: number; specificity: number; groundedness: number; score: number };
  v2: { explanation: string; usefulness: number; specificity: number; groundedness: number; score: number };
  winner: "v1" | "v2" | "tie";
  rationale: string;
}

function stableUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16);
  const id = hex.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function createLangSmithClient() {
  const apiKey = process.env.LANGSMITH_API_KEY?.trim();
  const apiUrl = process.env.LANGSMITH_ENDPOINT?.trim();
  if (!apiKey || !apiUrl) {
    throw new Error("LangSmith dataset and experiment logging needs LANGSMITH_API_KEY and LANGSMITH_ENDPOINT configured on the server.");
  }
  return new Client({ apiKey, apiUrl, workspaceId: process.env.LANGSMITH_WORKSPACE_ID?.trim() || undefined });
}

export async function prepareLangSmithDataset(organizationId: string, examples: Array<LangSmithExampleInput & { referenceExplanation: string }>) {
  const client = createLangSmithClient();
  const orgHash = createHash("sha256").update(organizationId).digest("hex").slice(0, 10);
  const sampleHash = createHash("sha256").update(examples.map((example) => example.caseId).sort().join("\n")).digest("hex").slice(0, 8);
  const datasetName = `repo-explanation-evals-${orgHash}-${sampleHash}`;
  const exists = await client.hasDataset({ datasetName });
  const dataset = exists
    ? await client.readDataset({ datasetName })
    : await client.createDataset(datasetName, {
      description: "Workspace scoped source context and saved explanations used to compare repository explanation prompts.",
      metadata: { application: "repository-graph-analyzer", purpose: "prompt-evaluation" },
    });
  const existing = new Map<string, string>();
  for await (const example of client.listExamples({ datasetId: dataset.id, limit: 1000 })) {
    const caseId = typeof example.inputs.caseId === "string" ? example.inputs.caseId : null;
    if (caseId) existing.set(caseId, example.id);
  }

  const additions = [];
  const updates = [];
  for (const example of examples) {
    const exampleId = stableUuid(`${organizationId}:${datasetName}:${example.caseId}`);
    const inputs = {
      caseId: example.caseId,
      targetKind: example.targetKind,
      targetPath: example.targetPath,
      sourcePaths: example.sourcePaths,
      relationships: example.relationships,
      sources: example.sources,
    };
    const outputs = { explanation: example.referenceExplanation };
    const currentId = existing.get(example.caseId);
    if (currentId) updates.push({ id: currentId, inputs, outputs });
    else additions.push({ id: exampleId, dataset_id: dataset.id, inputs, outputs });
  }
  if (additions.length) await client.createExamples(additions);
  if (updates.length) await client.updateExamples(updates);
  return { client, datasetId: dataset.id, datasetName };
}

export async function logLangSmithPromptExperiments(
  dataset: Awaited<ReturnType<typeof prepareLangSmithDataset>>,
  comparisons: LangSmithPromptComparison[],
) {
  const byCase = new Map(comparisons.map((comparison) => [comparison.caseId, comparison]));
  const baseOptions = {
    data: dataset.datasetId,
    client: dataset.client,
    maxConcurrency: 1,
    description: "Prompt version evaluation over the same saved repository explanations and source context.",
  };
  const v1Experiment = await evaluate(async (inputs: Record<string, unknown>) => {
    const comparison = byCase.get(String(inputs.caseId));
    if (!comparison) throw new Error("A LangSmith prompt evaluation example has no generated v1 output.");
    return { explanation: comparison.v1.explanation, promptVersion: "v1" };
  }, {
    ...baseOptions,
    experimentPrefix: "repository-explanation-v1",
    evaluators: [({ inputs }: { inputs: Record<string, unknown> }) => {
      const comparison = byCase.get(String(inputs.caseId));
      if (!comparison) throw new Error("A LangSmith prompt evaluation example has no v1 score.");
      return [
        { key: "usefulness", score: comparison.v1.usefulness, comment: "Gemini model-as-judge; subjective 1–5 rubric." },
        { key: "specificity", score: comparison.v1.specificity, comment: "Gemini model-as-judge; subjective 1–5 rubric." },
        { key: "groundedness", score: comparison.v1.groundedness, comment: "Gemini model-as-judge; subjective 1–5 rubric." },
      ];
    }],
  });
  const v2Experiment = await evaluate(async (inputs: Record<string, unknown>) => {
    const comparison = byCase.get(String(inputs.caseId));
    if (!comparison) throw new Error("A LangSmith prompt evaluation example has no generated v2 output.");
    return { explanation: comparison.v2.explanation, promptVersion: "v2" };
  }, {
    ...baseOptions,
    experimentPrefix: "repository-explanation-v2",
    evaluators: [({ inputs }: { inputs: Record<string, unknown> }) => {
      const comparison = byCase.get(String(inputs.caseId));
      if (!comparison) throw new Error("A LangSmith prompt evaluation example has no v2 score.");
      return [
        { key: "usefulness", score: comparison.v2.usefulness, comment: "Gemini model-as-judge; subjective 1–5 rubric." },
        { key: "specificity", score: comparison.v2.specificity, comment: "Gemini model-as-judge; subjective 1–5 rubric." },
        { key: "groundedness", score: comparison.v2.groundedness, comment: "Gemini model-as-judge; subjective 1–5 rubric." },
      ];
    }],
  });

  const comparative = await evaluate([v1Experiment, v2Experiment], {
    client: dataset.client,
    experimentPrefix: "repository-explanation-v1-v2-comparison",
    description: "Pairwise prompt preference over identical source examples; judge scores are subjective.",
    evaluators: [({ runs, inputs }: { runs: Run[]; inputs: Record<string, unknown> }) => {
      const comparison = byCase.get(String(inputs.caseId));
      if (!comparison) throw new Error("A LangSmith comparative example has no judge result.");
      const scores: Record<string, number> = {};
      for (const run of runs) {
        const version = run.outputs?.promptVersion;
        if (version !== "v1" && version !== "v2") continue;
        scores[run.id] = comparison.winner === "tie" ? 0.5 : comparison.winner === version ? 1 : 0;
      }
      return { key: "prompt_preference", scores };
    }],
  });
  return {
    datasetName: dataset.datasetName,
    experimentName: comparative.experimentName,
    url: comparative.url,
  };
}
