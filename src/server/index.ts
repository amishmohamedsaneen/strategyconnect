import "dotenv/config";
import express from "express";
import path from "node:path";
import { createOutlineAgent } from "./agent.js";
import { loadModel } from "./config.js";
import { createOutlineStore } from "./outline-store.js";

const port = Number(process.env.PORT ?? 3001);
const outlinePath = path.resolve(process.env.OUTLINE_PATH ?? "outline.json");
const store = createOutlineStore(outlinePath);

let agent: ReturnType<typeof createOutlineAgent> | undefined;

function getAgent() {
  if (!agent) {
    agent = createOutlineAgent(store, loadModel());
  }
  return agent;
}

const app = express();
app.use(express.json());

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String(part.text);
      }
      return "";
    })
    .join("");
}

function send(res: express.Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.get("/api/outline", async (_req, res) => {
  res.json(await store.read());
});

app.post("/api/outline/reset", async (_req, res) => {
  res.json(await store.reset());
});

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const threadId = typeof req.body?.threadId === "string" ? req.body.threadId.trim() : "";
  if (!message || !threadId) {
    res.status(400).json({ error: "message and threadId are required." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    let insideTool = 0;

    const events = getAgent().streamEvents(
      { messages: [{ role: "user", content: message }] },
      { version: "v2", configurable: { thread_id: threadId } },
    );

    for await (const event of events) {
      if (event.event === "on_tool_start") {
        insideTool += 1;
        console.log(`tool start: ${event.name}`);
        send(res, { type: "tool", status: "start", name: event.name });
      } else if (event.event === "on_tool_end") {
        insideTool = Math.max(0, insideTool - 1);
        const output = textFromContent(
          event.data && typeof event.data === "object" && "output" in event.data
            ? (event.data.output as { content?: unknown }).content ?? event.data.output
            : "",
        );
        console.log(`tool end: ${event.name}`);
        send(res, {
          type: "tool",
          status: "end",
          name: event.name,
          detail: output.slice(0, 500),
        });
      } else if (event.event === "on_chat_model_stream" && insideTool === 0) {
        const chunk =
          event.data && typeof event.data === "object" && "chunk" in event.data
            ? (event.data.chunk as { content?: unknown }).content
            : "";
        const text = textFromContent(chunk);
        if (text) send(res, { type: "token", text });
      }
    }

    send(res, { type: "done" });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "The agent failed.";
    console.error(messageText);
    send(res, { type: "error", message: messageText });
    send(res, { type: "done" });
  } finally {
    res.end();
  }
});

app.listen(port, () => {
  console.log(`API on http://localhost:${port}`);
  console.log("Open the page at http://localhost:5173");
});
