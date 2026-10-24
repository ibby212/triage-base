import "server-only";

// All provider settings come from environment variables (.env.local). Nothing is hard-coded
// in the logic. The browser only ever sees a config name, never a URL or a key.

export type StructuredOutputMode = "json_schema" | "prompt";

export type LlmConfig = {
  name: string;
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  structuredOutput: StructuredOutputMode;
  priceInputPerM: number;
  priceOutputPerM: number;
  // Free tiers limit requests per minute; the smoke test paces itself below this. 0 = no limit.
  maxRpm: number;
};

function num(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readLlmConfig(name: string, prefix: string): LlmConfig | null {
  const env = process.env;
  const baseURL = env[`${prefix}_BASE_URL`];
  const apiKey = env[`${prefix}_API_KEY`];
  const model = env[`${prefix}_MODEL`];
  if (!baseURL || !apiKey || !model) return null;
  return {
    name,
    label: env[`${prefix}_LABEL`] || model,
    baseURL,
    apiKey,
    model,
    structuredOutput: env[`${prefix}_STRUCTURED_OUTPUT`] === "prompt" ? "prompt" : "json_schema",
    priceInputPerM: num(env[`${prefix}_PRICE_INPUT_PER_M`]),
    priceOutputPerM: num(env[`${prefix}_PRICE_OUTPUT_PER_M`]),
    maxRpm: num(env[`${prefix}_MAX_RPM`]),
  };
}

export function getLlmConfigs(): LlmConfig[] {
  return [readLlmConfig("default", "LLM"), readLlmConfig("alt", "LLM_ALT")].filter(
    (c): c is LlmConfig => c !== null,
  );
}

export function getLlmConfig(name: string): LlmConfig | null {
  return getLlmConfigs().find((c) => c.name === name) ?? null;
}

// Safe to send to the browser: names, labels and model ids only.
export function publicConfigInfo() {
  return {
    llm: getLlmConfigs().map((c) => ({ name: c.name, label: c.label, model: c.model })),
  };
}
