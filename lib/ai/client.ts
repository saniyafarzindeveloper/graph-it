import { ChatGoogle } from "@langchain/google/node";
import { traceable } from "langsmith/traceable";
import { z } from "zod";
import { buildCurrentExplanationPrompt, CURRENT_PROMPT_VERSION } from "@/lib/ai/prompts/current";
import { checkInventedPaths, type PathCheckResult } from "@/lib/evals/invented-paths";
import type { ExplanationSource } from "@/lib/ai/types";

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

export interface ExplanationCacheEntry {
  content: string;
  aiRole: string | null;
  pathCheck: PathCheckResult | null;
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
  writeCache: (entry: ExplanationCacheEntry & { sourcePaths: string[]; relationships: string[]; promptVersion: string }) => Promise<void>;
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

  const sourceFiles = await input.loadSources();
  const messages = buildCurrentExplanationPrompt({ ...input, sources: sourceFiles });
  const response = await invokeStructuredModel(ExplanationSchema, messages);
  const entry = { content: response.explanation, aiRole: input.classifyRole ? response.role : null };
  const pathCheck = checkInventedPaths(entry.content, input.sourcePaths);
  await input.writeCache({ ...entry, pathCheck, sourcePaths: input.sourcePaths, relationships: input.relationships, promptVersion: CURRENT_PROMPT_VERSION });
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
      promptVersion: CURRENT_PROMPT_VERSION,
      stale: input.stale,
      staleReason: input.staleReason,
      sourcePaths: input.sourcePaths,
      relationships: input.relationships,
      classifyRole: input.classifyRole,
    };
  },
});

export async function invokeStructuredModel<Schema extends z.ZodType>(
  schema: Schema,
  messages: Array<{ role: "system" | "user"; content: string }>,
  timeoutMs = 90_000,
): Promise<z.infer<Schema>> {
  const requestSignal = AbortSignal.timeout(timeoutMs);
  const options = { maxRetries: 2, signal: requestSignal };
  const invoke = (modelName: string) => getModelClient(modelName)
    .withStructuredOutput(schema)
    .invoke(messages, options) as Promise<z.infer<Schema>>;
  try {
    try {
      return await invoke(EXPLANATION_MODEL);
    } catch (primaryError) {
      const statusCode = typeof primaryError === "object" && primaryError !== null && "statusCode" in primaryError
        ? Number((primaryError as { statusCode: unknown }).statusCode)
        : undefined;
      if (![408, 429, 500, 502, 503, 504].includes(statusCode ?? 0)) throw primaryError;
      return await invoke(FALLBACK_EXPLANATION_MODEL);
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`Gemini did not respond within ${Math.round(timeoutMs / 1000)} seconds. Try again.`);
    }
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : undefined;
    if (statusCode === 429) throw new Error("Gemini's request limit has been reached. Check your API quota or wait for it to reset, then try again.");
    if (statusCode === 503) throw new Error("Gemini is temporarily at capacity. Please wait a moment, then try again.");
    throw error;
  }
}

export function generateExplanationFromPrompt(
  messages: Array<{ role: "system" | "user"; content: string }>,
  timeoutMs?: number,
) {
  return invokeStructuredModel(ExplanationSchema, messages, timeoutMs);
}

export { CURRENT_PROMPT_VERSION };
export type { ExplanationSource };
export { runExplanation };
