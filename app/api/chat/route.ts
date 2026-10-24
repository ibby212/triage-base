import { errorResponse, toAppError } from "@/lib/errors";
import { parseBody } from "@/lib/http";
import { chat, llmCost } from "@/lib/llm";
import { logCall } from "@/lib/log";
import { ChatRequestSchema } from "@/lib/schema";

// The server keeps no memory: the client resends the whole conversation every time.
export async function POST(request: Request) {
  const started = performance.now();
  let configName = "default";
  try {
    const { messages, config } = await parseBody(request, ChatRequestSchema);
    configName = config;
    const result = await chat(config, messages);
    const latency = Math.round(performance.now() - started);
    await logCall({
      ts: new Date().toISOString(), route: "chat", strategy: null, api: "chat.completions",
      prompt_version: null, config, llm_model: result.model, dm_model: null,
      status: 200, error_code: null, latency_ms: latency,
      input_tokens: result.usage?.input_tokens ?? null, output_tokens: result.usage?.output_tokens ?? null,
      cost_usd: llmCost(result.config, result.usage),
    });
    return Response.json({ answer: result.answer, usage: result.usage, model: result.model });
  } catch (thrown) {
    const error = toAppError(thrown);
    if (error.status !== 400) {
      console.error(`[chat] ${error.code}: ${error.detail ?? ""}`);
      await logCall({
        ts: new Date().toISOString(), route: "chat", strategy: null, api: "chat.completions",
        prompt_version: null, config: configName, llm_model: null, dm_model: null,
        status: error.status, error_code: error.code, latency_ms: Math.round(performance.now() - started),
        input_tokens: null, output_tokens: null, cost_usd: 0,
      });
    }
    return errorResponse(error);
  }
}
