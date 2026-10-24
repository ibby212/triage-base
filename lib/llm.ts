import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { getLlmConfig, type LlmConfig } from "./config";
import { AppError } from "./errors";
import { buildTriageUserMessage, CHAT_SYSTEM_PROMPT, TRIAGE_SYSTEM_PROMPT } from "./prompt";
import { TriageSchema, type Category, type Priority, type Triage, type Usage } from "./schema";

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

// Use 1 (ASK): the Zod contract as JSON Schema. strict mode needs every key required
// and additionalProperties false, which z.strictObject produces.
const { $schema: _ignored, ...TRIAGE_JSON_SCHEMA } = z.toJSONSchema(TriageSchema);

// Prompt-only mode: some models wrap the JSON in a ```json fence anyway.
function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text.trim();
}

// Use 2 (CHECK): string -> unknown -> Triage. Never `as Triage`.
function parseTriage(text: string): Triage {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(text));
  } catch {
    throw new AppError("invalid_model_output", { detail: `not JSON: ${text.slice(0, 120)}` });
  }
  const parsed = TriageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("invalid_model_output", { detail: `schema mismatch: ${parsed.error.issues[0]?.message}` });
  }
  return parsed.data;
}

async function triageOnce(config: LlmConfig, ticket: string, decided?: { category: Category; priority: Priority }) {
  const completion = await clientFor(config).chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: buildTriageUserMessage(ticket, decided) },
    ],
    temperature: 0,
    // Generous: reasoning models spend output tokens before the JSON.
    max_tokens: 2000,
    ...(config.structuredOutput === "json_schema"
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: { name: "support_triage", strict: true, schema: TRIAGE_JSON_SCHEMA },
          },
        }
      : {}),
  });
  const usage = toUsage(completion.usage);
  const choice = completion.choices[0];
  if (choice?.finish_reason === "length") {
    throw Object.assign(new AppError("invalid_model_output", { detail: "cut off (finish_reason=length)" }), { usage });
  }
  try {
    return { triage: parseTriage(choice?.message?.content ?? ""), usage };
  } catch (error) {
    throw Object.assign(error as AppError, { usage });
  }
}

function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

// Invalid output is retried once (and both attempts count in the usage).
export async function triageWithLlm(
  configName: string,
  ticket: string,
  decided?: { category: Category; priority: Priority },
): Promise<{ triage: Triage; usage: Usage | null; config: LlmConfig; attempts: number }> {
  const config = requireLlmConfig(configName);
  try {
    const first = await triageOnce(config, ticket, decided);
    return { ...first, config, attempts: 1 };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "invalid_model_output") throw error;
    const firstUsage = (error as AppError & { usage?: Usage | null }).usage ?? null;
    console.warn(`[triage] invalid model output, retrying once: ${error.detail}`);
    try {
      const second = await triageOnce(config, ticket, decided);
      return { triage: second.triage, usage: addUsage(firstUsage, second.usage), config, attempts: 2 };
    } catch (retryError) {
      const secondUsage = (retryError as { usage?: Usage | null }).usage ?? null;
      throw Object.assign(retryError as Error, { usage: addUsage(firstUsage, secondUsage) });
    }
  }
}
