import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import { createRepositoryAgent } from "./repository-agent.js";

const checkpointer = new MemorySaver();
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/runs/stream") {
    response.writeHead(404).end();
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 24_000) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      credential?: unknown;
      threadId?: unknown;
      prompt?: unknown;
    };
    if (
      typeof body.credential !== "string" || !body.credential ||
      typeof body.threadId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.threadId) ||
      typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 8_000
    ) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "A scoped credential, conversation, and question are required." }));
      return;
    }

    const agent = await createRepositoryAgent(body.credential, checkpointer);
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (event: string, data: unknown) => {
      if (!response.destroyed) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const activeTools = new Map<string, string>();
    const events = agent.streamEvents(
      { messages: [{ role: "user", content: body.prompt.trim() }] },
      { version: "v2", recursionLimit: 16, configurable: { thread_id: body.threadId } },
    );
    for await (const event of events) {
      if (event.event === "on_tool_start") {
        const callId = event.run_id ?? randomUUID();
        activeTools.set(callId, event.name);
        send("tool_start", { callId, name: event.name, input: event.data?.input ?? {} });
      } else if (event.event === "on_tool_end") {
        send("tool_end", { callId: event.run_id, name: activeTools.get(event.run_id) ?? event.name });
      } else if (event.event === "on_chat_model_stream") {
        const chunk = event.data?.chunk as { content?: unknown } | undefined;
        if (typeof chunk?.content === "string" && chunk.content) send("token", { text: chunk.content });
      }
    }
    send("done", {});
    response.end();
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "The repository agent could not complete this question." }));
    } else {
      response.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : "The repository agent could not complete this question." })}\n\n`);
      response.end();
    }
  }
});

const port = Number(process.env.REPOSITORY_AGENT_PORT ?? 3100);
server.listen(port, "127.0.0.1", () => {
  console.log(`Repository agent stream service listening on 127.0.0.1:${port}`);
});
