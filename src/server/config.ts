import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

export type ChatModel = ChatOpenAI | ChatAnthropic;

export function loadModel(): ChatModel {
  const provider = (process.env.MODEL_PROVIDER ?? "openai").toLowerCase();
  const modelName =
    process.env.MODEL_NAME ??
    (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o-mini");

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "Missing OPENAI_API_KEY. Copy .env.example to .env and paste your key.",
      );
    }
    return new ChatOpenAI({ model: modelName, temperature: 0, streaming: true });
  }

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "Missing ANTHROPIC_API_KEY. Copy .env.example to .env and paste your key.",
      );
    }
    return new ChatAnthropic({ model: modelName, temperature: 0, streaming: true });
  }

  throw new Error(
    `Unknown MODEL_PROVIDER "${provider}". Use "openai" or "anthropic".`,
  );
}
