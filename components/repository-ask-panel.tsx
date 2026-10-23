"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type ToolCall = { callId: string; name: string; input: unknown; done: boolean };
type ChatMessage = { id: string; role: "user" | "assistant"; text: string; tools: ToolCall[] };

const toolLabels: Record<string, string> = {
  get_repository_summary: "Repository summary",
  search_files_by_path: "Search files by path",
  list_files_by_role: "Files by role",
  get_direct_neighbors: "Direct neighbors",
  walk_dependencies: "Dependency walk",
  get_route_table: "Route table",
};

interface RepositoryAskPanelProps {
  analysisId: string | null;
  selectedPath: string | null;
  files: string[];
  onSelectPath: (path: string) => void;
}

export function RepositoryAskPanel({ analysisId, selectedPath, files, onSelectPath }: RepositoryAskPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const conversationId = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || sending || !analysisId) return;
    if (!conversationId.current) conversationId.current = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const prompt = selectedPath
      ? `The currently selected map item is ${selectedPath}. Use that as context only when relevant, and verify it with a repository lookup.\n\nQuestion: ${trimmed}`
      : trimmed;
    setQuestion("");
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: trimmed, tools: [] },
      { id: assistantId, role: "assistant", text: "", tools: [] },
    ]);

    const updateAssistant = (update: (message: ChatMessage) => ChatMessage) => {
      setMessages((current) => current.map((message) => message.id === assistantId ? update(message) : message));
    };

    try {
      const response = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ question: prompt, conversationId: conversationId.current }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "The repository agent could not start.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleFrame = (frame: string) => {
        let eventName = "message";
        let data = "";
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) return;
        const payload = JSON.parse(data) as Record<string, unknown>;
        if (eventName === "tool_start") {
          updateAssistant((message) => ({ ...message, tools: [...message.tools, {
            callId: String(payload.callId ?? crypto.randomUUID()),
            name: String(payload.name ?? "repository_lookup"),
            input: payload.input ?? {},
            done: false,
          }] }));
        } else if (eventName === "tool_end") {
          updateAssistant((message) => ({ ...message, tools: message.tools.map((tool) =>
            tool.callId === payload.callId ? { ...tool, done: true } : tool,
          ) }));
        } else if (eventName === "token" && typeof payload.text === "string") {
          updateAssistant((message) => ({ ...message, text: message.text + payload.text }));
        } else if (eventName === "error") {
          updateAssistant((message) => ({ ...message, text: message.text || String(payload.error ?? "The agent run failed.") }));
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          handleFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (buffer.trim()) handleFrame(buffer);
      updateAssistant((message) => message.text
        ? message
        : { ...message, text: "The agent finished without a text answer." });
    } catch (error) {
      updateAssistant((message) => ({
        ...message,
        text: message.text || (error instanceof Error && error.name === "TimeoutError"
          ? "The question timed out. Try again."
          : error instanceof Error ? error.message : "The repository agent is unavailable."),
      }));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Ask about this repository">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-(--app-border) bg-(--app-hover)/35 p-3">
            <h2 className="text-xs font-semibold text-foreground">Ask about this repository</h2>
            <p className="mt-1.5 text-[11px] leading-5 text-(--app-muted)">Questions about files, imports, dependencies, framework roles, and detected routes work best.</p>
            {selectedPath ? <p className="mt-3 truncate rounded bg-sky-500/10 px-2 py-1.5 font-mono text-[10px] text-sky-300" title={selectedPath}>Selected · {selectedPath}</p> : null}
          </div>
        ) : messages.map((message) => (
          <article key={message.id} className={message.role === "user" ? "ml-5 rounded-lg bg-(--app-hover) px-3 py-2.5" : "space-y-2"}>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-(--app-muted)">{message.role === "user" ? "You" : "Repository agent"}</div>
            {message.role === "assistant" && message.tools.length > 0 ? (
              <ol className="space-y-1.5" aria-label="Repository lookups">
                {message.tools.map((call) => (
                  <li key={call.callId} className="rounded-md border border-(--app-border) bg-(--app-hover)/50 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-medium text-foreground">{toolLabels[call.name] ?? call.name.replaceAll("_", " ")}</span>
                      <span className={call.done ? "text-emerald-400" : "text-sky-300"}>{call.done ? "Done" : "Looking up…"}</span>
                    </div>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap wrap-break-word font-mono text-[9px] leading-4 text-(--app-muted)">{JSON.stringify(call.input)}</pre>
                  </li>
                ))}
              </ol>
            ) : null}
            {message.text ? (
              <p className="whitespace-pre-wrap text-[11px] leading-5 text-(--app-fg)">{message.role === "assistant"
                ? message.text.split(/(`[^`]+`)/g).map((part, index) => {
                  const path = part.startsWith("`") && part.endsWith("`") ? part.slice(1, -1) : part;
                  return part.startsWith("`") && part.endsWith("`") && files.includes(path)
                    ? <button key={index} type="button" className="font-mono text-sky-300 underline decoration-sky-300/40 underline-offset-2" onClick={() => onSelectPath(path)}>{path}</button>
                    : <span key={index}>{part}</span>;
                }) : message.text}</p>
            ) : null}
          </article>
        ))}
        {sending ? <p className="text-[10px] text-(--app-muted)">Checking the repository graph…</p> : null}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-(--app-border) p-3">
        {selectedPath ? <p className="mb-2 truncate text-[9px] text-sky-300" title={selectedPath}>Selected context · <span className="font-mono">{selectedPath}</span></p> : null}
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={!analysisId || sending}
            maxLength={8_000}
            rows={2}
            placeholder={analysisId ? "Ask about files, imports, or routes…" : "Ask is available for analyzed repositories."}
            aria-label="Your repository question"
            className="min-h-15 min-w-0 flex-1 resize-none rounded-md border border-(--app-border) bg-(--app-bg) px-2.5 py-2 text-[11px] leading-5 text-foreground outline-none placeholder:text-(--app-muted) focus:border-sky-500 disabled:opacity-60"
          />
          <button type="submit" disabled={!analysisId || sending || !question.trim()} className="shrink-0 rounded-md bg-sky-500 px-3 py-2 text-[10px] font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>
    </section>
  );
}
