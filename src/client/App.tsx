import { useEffect, useRef, useState } from "react";
import type { Outline } from "../shared/outline";
import { WALKTHROUGH_PROMPTS } from "./prompts";

type Block =
  | { id: number; type: "user"; text: string }
  | { id: number; type: "assistant"; text: string }
  | { id: number; type: "tool"; name: string; status: "running" | "done"; detail: string }
  | { id: number; type: "error"; text: string };

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

type ChatEvent =
  | { type: "token"; text: string }
  | { type: "tool"; status: "start" | "end"; name: string; detail?: string }
  | { type: "error"; message: string }
  | { type: "done" };

function loadThreadId(): string {
  const existing = sessionStorage.getItem("threadId");
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem("threadId", created);
  return created;
}

export function App() {
  const [outline, setOutline] = useState<Outline>({ items: [] });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [draft, setDraft] = useState("");
  const [threadId, setThreadId] = useState(loadThreadId);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

  async function refreshOutline() {
    const response = await fetch("/api/outline");
    setOutline((await response.json()) as Outline);
  }

  useEffect(() => {
    void refreshOutline();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [blocks]);

  function push(block: WithoutId<Block>) {
    const id = nextId.current++;
    setBlocks((current) => [...current, { ...block, id } as Block]);
  }

  async function resetOutline() {
    const response = await fetch("/api/outline/reset", { method: "POST" });
    setOutline((await response.json()) as Outline);
  }

  function newChat() {
    const created = crypto.randomUUID();
    sessionStorage.setItem("threadId", created);
    setThreadId(created);
    setBlocks([]);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    push({ type: "user", text: message });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, threadId }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        push({ type: "error", text: payload?.error ?? "The request failed." });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as ChatEvent;
          applyEvent(event);
          if (event.type === "tool" && event.status === "end") {
            void refreshOutline();
          }
        }
      }
    } catch (error) {
      push({
        type: "error",
        text: error instanceof Error ? error.message : "The request failed.",
      });
    } finally {
      setBusy(false);
      void refreshOutline();
    }
  }

  function applyEvent(event: ChatEvent) {
    if (event.type === "token") {
      setBlocks((current) => {
        const last = current[current.length - 1];
        if (last?.type === "assistant") {
          return [...current.slice(0, -1), { ...last, text: last.text + event.text }];
        }
        return [...current, { id: nextId.current++, type: "assistant", text: event.text }];
      });
      return;
    }

    if (event.type === "tool" && event.status === "start") {
      push({ type: "tool", name: event.name, status: "running", detail: "" });
      return;
    }

    if (event.type === "tool" && event.status === "end") {
      setBlocks((current) => {
        const copy = [...current];
        for (let index = copy.length - 1; index >= 0; index -= 1) {
          const block = copy[index];
          if (block?.type === "tool" && block.status === "running" && block.name === event.name) {
            copy[index] = { ...block, status: "done", detail: event.detail ?? "" };
            break;
          }
        }
        return copy;
      });
      return;
    }

    if (event.type === "error") {
      push({ type: "error", text: event.message });
    }
  }

  return (
    <main className="app">
      <section className="panel outline-panel">
        <div className="panel-head">
          <h1>Outline</h1>
          <button type="button" onClick={() => void resetOutline()} disabled={busy}>
            Restore sample
          </button>
        </div>
        <p className="muted">Saved in outline.json. Order in the list is the slide order.</p>
        <ol className="slides">
          {outline.items.map((item, index) => (
            <li className="slide" key={item.id}>
              <div className="slide-top">
                <span className="position">{index + 1}</span>
                <strong>{item.title}</strong>
              </div>
              <p>{item.description}</p>
              <span className="muted">{item.id}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel chat-panel">
        <div className="panel-head">
          <h2>Chat</h2>
          <button type="button" onClick={newChat} disabled={busy}>
            New chat
          </button>
        </div>

        <div className="chat-log" ref={logRef}>
          {blocks.map((block) => {
            if (block.type === "tool") {
              return (
                <div className="tool" key={block.id}>
                  {block.status === "running" ? "Working" : "Done"}: {block.name}
                </div>
              );
            }
            if (block.type === "error") {
              return (
                <div className="error" key={block.id}>
                  {block.text}
                </div>
              );
            }
            return (
              <div className={`bubble ${block.type}`} key={block.id}>
                {block.text}
              </div>
            );
          })}
          {busy && <p className="muted">The agent is working…</p>}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Say what you want changed"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !draft.trim()}>
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
