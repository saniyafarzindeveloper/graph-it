import type { ExplanationSource } from "@/lib/ai/types";

export const CURRENT_PROMPT_VERSION = "v2";

export interface ExplanationPromptInput {
  targetKind: "file" | "folder";
  targetPath: string;
  relationships: string[];
  sources: ExplanationSource[];
  classifyRole: boolean;
}

export function buildCurrentExplanationPrompt(input: ExplanationPromptInput) {
  const roleInstruction = input.classifyRole
    ? "Also classify the target file as exactly one non-structural role: service, repository, model, util, config, component, or hook."
    : "Set role to null. Do not assign or change a role for this target.";
  const context = input.targetKind === "file"
    ? `Explain ${input.targetPath} using its own source and every direct import/dependent source supplied below. Describe its specific responsibilities and how it connects to those neighbours. ${roleInstruction}`
    : `Explain the folded folder ${input.targetPath} as a folder: summarize its supplied files and explain its incoming/outgoing relationships from the supplied boundary edges. Do not summarize just one file. Do not infer relationships beyond the supplied edges.`;
  const formatRules = "Write a few short, specific paragraphs. Formatting allowed: inline code using single backticks, bullets beginning with - , and bold using paired **. Do not use headings, hashes, italics, tables, links, or other Markdown. Refer to known repository paths exactly as supplied. Do not claim imports, dependents, behavior, or relationships absent from the supplied source and relationship list. Prefer concrete responsibilities and data flow over generic descriptions.";
  const sourceText = input.sources.map((source) => `FILE ${source.path}\n\`\`\`source\n${source.content}\n\`\`\``).join("\n\n");
  return [
    { role: "system" as const, content: `${context}\n\n${formatRules}` },
    { role: "user" as const, content: `DIRECT RELATIONSHIPS\n${input.relationships.join("\n") || "None"}\n\nSOURCE FILES\n${sourceText}` },
  ];
}
