import { createRepositoryAgent } from "./repository-agent.js";

const [question, ...questionParts] = process.argv.slice(2);
const prompt = [question, ...questionParts].filter(Boolean).join(" ").trim();
const credential = process.env.REPOSITORY_AGENT_CREDENTIAL?.trim();

if (!prompt || !credential) {
  console.error('Usage: REPOSITORY_AGENT_CREDENTIAL="<short-lived token>" npm run agent -- "<question>"');
  process.exitCode = 2;
} else {
  const agent = await createRepositoryAgent(credential);
  const result = await agent.invoke({
    messages: [{ role: "user", content: prompt }],
  }, { recursionLimit: 12 });

  for (const message of result.messages) {
    const calls = "tool_calls" in message && Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const call of calls) {
      if (typeof call === "object" && call !== null && "name" in call) console.log(`Tool: ${String(call.name)}`);
    }
  }
  const finalMessage = result.messages.at(-1);
  console.log(typeof finalMessage?.content === "string"
    ? finalMessage.content
    : JSON.stringify(finalMessage?.content ?? "No response returned.", null, 2));
}
