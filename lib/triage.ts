import "server-only";
import { AppError, toAppError } from "./errors";
import { llmCost, triageWithLlm } from "./llm";
import { logCall } from "./log";
import { PROMPT_VERSION } from "./prompt";
import { getLlmConfig } from "./config";
import { TriageResponseSchema, type Strategy, type TriageResponse, type Usage } from "./schema";

// Runs one ticket through the LLM and returns a checked TriageResponse.

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

export type TriageContext = { route: "triage" | "smoke"; ticketId?: string; runId?: string };

export async function triageTicket(
  input: { ticket: string; strategy: Strategy; config: string },
  context: TriageContext,
): Promise<TriageResponse> {
  const started = performance.now();
  const { ticket, config } = input;
  const llmModel = getLlmConfig(config)?.model ?? null;

  const baseLog = {
    ts: new Date().toISOString(),
    route: context.route,
    strategy: "llm",
    api: "chat.completions" as const,
    prompt_version: PROMPT_VERSION,
    config,
    llm_model: llmModel,
    dm_model: null,
    ticket_id: context.ticketId,
    ticket_chars: ticket.length,
    run_id: context.runId,
  };

  try {
    const result = await triageWithLlm(config, ticket);
    const cost = llmCost(result.config, result.usage);
    // The payload is checked against its schema before it is forwarded to the user.
    const parsed = TriageResponseSchema.safeParse({
      triage: result.triage,
      meta: {
        strategy: "llm",
        prompt_version: PROMPT_VERSION,
        config,
        llm_model: llmModel,
        dm_model: null,
        latency_ms: Math.round(performance.now() - started),
        usage: { llm: result.usage, dm: null, total: result.usage ?? ZERO },
        cost_usd: cost,
        dm_probabilities: null,
      },
    });
    if (!parsed.success) {
      throw new AppError("invalid_model_output", { detail: `response schema: ${parsed.error.issues[0]?.message}` });
    }
    await logCall({
      ...baseLog,
      status: 200,
      error_code: null,
      latency_ms: parsed.data.meta.latency_ms,
      input_tokens: result.usage?.input_tokens ?? null,
      output_tokens: result.usage?.output_tokens ?? null,
      cost_usd: cost,
    });
    return parsed.data;
  } catch (thrown) {
    const error = toAppError(thrown);
    const usage = (thrown as { usage?: Usage | null }).usage ?? null;
    console.error(`[triage] ${error.code}: ${error.detail ?? ""}`);
    await logCall({
      ...baseLog,
      status: error.status,
      error_code: error.code,
      latency_ms: Math.round(performance.now() - started),
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      cost_usd: 0,
    });
    throw error;
  }
}
