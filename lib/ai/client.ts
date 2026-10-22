import { ChatGoogle } from "@langchain/google/node";
import { traceable } from "langsmith/traceable";
import { z } from "zod";

export const EXPLANATION_MODEL = "gemini-3.8-flash";
const FALLBACK_EXPLANATION_MODEL = "gemini-3.5-flash-lite";

const ExplanationSchema = z.object({
  explanation: z.string().min(1),
  role: z.enum(["service", "repository", "model", "util", "config", "component", "hook"]).nullable(),
});

const modelClients = new Map<string, ChatGoogle>();

export function getModelClient(modelName = EXPLANATION_MODEL) {
  const apiKey = process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("AI explanations need GOOGLE_API_KEY (or GEMINI_API_KEY) configured on the server.");
  let client = modelClients.get(modelName);
  if (!client) {
    client = new ChatGoogle({ model: modelName, apiKey, maxRetries: 0 });
    modelClients.set(modelName, client);
  }
  return client;
}

export function isTracingConfigured() {
  return process.env.LANGSMITH_TRACING?.toLowerCase() === "true"
    && Boolean(process.env.LANGSMITH_API_KEY?.trim())
    && Boolean(process.env.LANGSMITH_ENDPOINT?.trim());
}

export interface ExplanationSource {
  path: string;
  content: string;
}

export interface ExplanationCacheEntry {
  content: string;
  aiRole: string | null;
}

export interface ExplanationCall {
  targetKind: "file" | "folder";
  targetPath: string;
  contentHash: string;
  sourcePaths: string[];
  relationships: string[];
  classifyRole: boolean;
  existingRole: string | null;
  stale: boolean;
  staleReason: string | null;
  loadSources: () => Promise<ExplanationSource[]>;
  readCache: () => Promise<ExplanationCacheEntry | null>;
  writeCache: (entry: ExplanationCacheEntry) => Promise<void>;
}

export interface ExplanationResult {
  content: string | null;
  aiRole: string | null;
  cacheHit: boolean;
  stale: boolean;
  staleReason: string | null;
}

const runExplanation = traceable(async (input: ExplanationCall): Promise<ExplanationResult> => {
  // Intentionally inside the traced function: cache hits create a visible run
  // with a cacheHit result and no child model invocation.
  const cached = await input.readCache();
  if (cached) return { content: cached.content, aiRole: cached.aiRole, cacheHit: true, stale: input.stale, staleReason: input.staleReason };
  if (input.stale) return { content: null, aiRole: null, cacheHit: false, stale: true, staleReason: input.staleReason };

  const model = (modelName: string) => getModelClient(modelName).withStructuredOutput(ExplanationSchema, {
    name: "repository_explanation",
  });
  const roleInstruction = input.classifyRole
    ? "Also classify the target file as exactly one non-structural role: service, repository, model, util, config, component, or hook."
    : "Set role to null. Do not assign or change a role for this target.";
  const formatRules = "Write a few short paragraphs. Formatting allowed: inline code using single backticks, bullets beginning with - , and bold using paired **. Do not use headings, hashes, italics, tables, links, or other Markdown. Refer to known repository paths exactly as supplied. Do not claim imports, dependents, behavior, or relationships absent from the supplied source and relationship list.";
  const context = input.targetKind === "file"
    ? `Explain ${input.targetPath} using its own source and every direct import/dependent source supplied below. Describe what the file does in the context of those neighbours. ${roleInstruction}`
    : `Explain the folded folder ${input.targetPath} as a folder: summarize its supplied files and explain its incoming/outgoing relationships from the supplied boundary edges. Do not summarize just one file. Do not infer relationships beyond the supplied edges.`;
  const sourceFiles = await input.loadSources();
  const sources = sourceFiles.map((source) => `FILE ${source.path}\n\`\`\`source\n${source.content}\n\`\`\``).join("\n\n");
  let response;
  const requestSignal = AbortSignal.timeout(90_000);
  const invokeOptions = { maxRetries: 2, signal: requestSignal };
  const messages = [
    { role: "system" as const, content: `${context}\n\n${formatRules}` },
    { role: "user" as const, content: `DIRECT RELATIONSHIPS\n${input.relationships.join("\n") || "None"}\n\nSOURCE FILES\n${sources}` },
  ];
  try {
    try {
      response = await model(EXPLANATION_MODEL).invoke(messages, invokeOptions);
    } catch (primaryError) {
      const statusCode = typeof primaryError === "object" && primaryError !== null && "statusCode" in primaryError
        ? Number((primaryError as { statusCode: unknown }).statusCode)
        : undefined;
      if (![408, 429, 500, 502, 503, 504].includes(statusCode ?? 0)) throw primaryError;
      response = await model(FALLBACK_EXPLANATION_MODEL).invoke(messages, invokeOptions);
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Gemini did not respond within 90 seconds. Try the explanation again.");
    }
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : undefined;
    if (statusCode === 429) {
      throw new Error("Gemini's request limit has been reached. Check your API quota or wait for it to reset, then try again.");
    }
    if (statusCode === 503) {
      throw new Error("Gemini is temporarily at capacity. Please wait a moment, then try the explanation again.");
    }
    throw error;
  }
  const entry = { content: response.explanation, aiRole: input.classifyRole ? response.role : null };
  await input.writeCache(entry);
  return { ...entry, cacheHit: false, stale: false, staleReason: null };
}, {
  name: "repository_explanation_with_cache",
  run_type: "chain",
  processInputs: (inputs) => {
    const input = inputs as unknown as ExplanationCall;
    return {
      targetKind: input.targetKind,
      targetPath: input.targetPath,
      contentHash: input.contentHash,
      modelName: EXPLANATION_MODEL,
      stale: input.stale,
      staleReason: input.staleReason,
      sourcePaths: input.sourcePaths,
      relationships: input.relationships,
      classifyRole: input.classifyRole,
    };
  },
});

export { runExplanation };
