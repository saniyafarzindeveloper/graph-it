import { createDeepAgent } from "deepagents";

const model = "openai:gpt-5.5-2026-04-23";

const internetSearch = { type: "web_search_preview" };
const researchInstructions = `You are an expert researcher. Research the user's topic using the internet search tool, then write a clear, concise report. Prefer reliable sources, distinguish confirmed facts from uncertainty, and include source links when available.

Use the web_search tool as your primary way to gather current information.`;

const agent = await createDeepAgent({
  model,
  tools: [internetSearch],
  systemPrompt: researchInstructions,
});

const question = process.argv.slice(2).join(" ").trim() || "What is LangGraph?";
const result = await agent.invoke({
  messages: [{ role: "user", content: question }],
});

const finalMessage = result.messages.at(-1);
console.log(typeof finalMessage?.content === "string"
  ? finalMessage.content
  : JSON.stringify(finalMessage?.content ?? "No response returned.", null, 2));
