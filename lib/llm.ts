import "server-only";
import OpenAI from "openai";
import { getLlmConfig, type LlmConfig } from "./config";
import { AppError } from "./errors";
import { CHAT_SYSTEM_PROMPT } from "./prompt";
import type { Usage } from "./schema";

// The only module that talks to an LLM provider. Routes call these functions;
// no SDK calls anywhere else. Uses the Chat Completions API.

const clients = new Map<string, OpenAI>();

function clientFor(config: LlmConfig): OpenAI {
  let client = clients.get(config.name);
  if (!client) {
    // Timeout is per attempt. The SDK retries 429/5xx/network errors once, with backoff.
    client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, timeout: 30_000, maxRetries: 1 });
    clients.set(config.name, client);
  }
  return client;
}

export function requireLlmConfig(name: string): LlmConfig {
  const config = getLlmConfig(name);
  if (!config) throw new AppError("not_configured", { message: `Unknown model configuration "${name}".` });
  return config;
}

function toUsage(usage: OpenAI.CompletionUsage | undefined): Usage | null {
  if (!usage) return null; // some endpoints report no usage: we say so instead of inventing numbers
  const input = usage.prompt_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  return { input_tokens: input, output_tokens: output, total_tokens: usage.total_tokens ?? input + output };
}

export function llmCost(config: LlmConfig, usage: Usage | null): number {
  if (!usage) return 0;
  return (usage.input_tokens * config.priceInputPerM + usage.output_tokens * config.priceOutputPerM) / 1_000_000;
}

export async function chat(
  configName: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<{ answer: string; usage: Usage | null; model: string; config: LlmConfig }> {
  const config = requireLlmConfig(configName);
  const completion = await clientFor(config).chat.completions.create({
    model: config.model,
    messages: [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...history],
    max_tokens: 2048,
  });
  const answer = completion.choices[0]?.message?.content?.trim();
  if (!answer) throw new AppError("invalid_model_output", { detail: "empty chat answer" });
  return { answer, usage: toUsage(completion.usage), model: config.model, config };
}
