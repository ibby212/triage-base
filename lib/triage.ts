import "server-only";
import { decide, dmCost, DM_QUESTIONS_VERSION } from "./dm";
import { AppError, toAppError } from "./errors";
import { llmCost, triageWithLlm } from "./llm";
import { logCall, type CallLogEntry } from "./log";
import { PROMPT_VERSION } from "./prompt";
import { getLlmConfig } from "./config";
import {
  TriageResponseSchema,
  type Strategy,
  type TriageResponse,
  type Usage,
} from "./schema";

// The triage feature, for the three strategies the user can pick:
//   llm     the LLM decides category + priority and writes summary + action (one LLM call)
//   dm      the decision model decides category + priority; nothing is written (one DM call)
//   dm+llm  the decision model decides; the LLM only writes summary + action for that decision

const API_NAME: Record<Strategy, CallLogEntry["api"]> = {
  llm: "chat.completions",
  dm: "systemone",
  "dm+llm": "chat.completions+systemone",
};

function sumUsage(...items: (Usage | null)[]): Usage {
  return items.reduce<Usage>(
    (acc, u) =>
      u
        ? {
            input_tokens: acc.input_tokens + u.input_tokens,
            output_tokens: acc.output_tokens + u.output_tokens,
            total_tokens: acc.total_tokens + u.total_tokens,
          }
        : acc,
    { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  );
}

function promptVersionFor(strategy: Strategy): string {
  if (strategy === "llm") return PROMPT_VERSION;
  if (strategy === "dm") return DM_QUESTIONS_VERSION;
  return `${DM_QUESTIONS_VERSION}+${PROMPT_VERSION}`;
}

export type TriageContext = { route: "triage" | "smoke"; ticketId?: string; runId?: string };

export async function triageTicket(
  input: { ticket: string; strategy: Strategy; config: string },
  context: TriageContext,
): Promise<TriageResponse> {
  const started = performance.now();
  const { ticket, strategy, config } = input;
  const llmModel = strategy === "dm" ? null : (getLlmConfig(config)?.model ?? null);
  let dmModel: string | null = null;
  let llmUsage: Usage | null = null;
  let dmUsage: Usage | null = null;
  let cost = 0;

  const baseLog = {
    ts: new Date().toISOString(),
    route: context.route,
    strategy,
    api: API_NAME[strategy],
    prompt_version: promptVersionFor(strategy),
    config,
    ticket_id: context.ticketId,
    ticket_chars: ticket.length,
    run_id: context.runId,
  };

  try {
    let response: TriageResponse;

    if (strategy === "llm") {
      const result = await triageWithLlm(config, ticket);
      llmUsage = result.usage;
      cost = llmCost(result.config, llmUsage);
      response = build(result.triage, null);
    } else {
      const decision = await decide(ticket);
      dmModel = decision.model;
      dmUsage = decision.usage;
      cost = dmCost(decision.config, dmUsage);

      if (strategy === "dm") {
        response = build(
          { category: decision.category, priority: decision.priority, summary: null, suggested_action: null },
          decision.probabilities,
        );
      } else {
        const result = await triageWithLlm(config, ticket, {
          category: decision.category,
          priority: decision.priority,
        });
        llmUsage = result.usage;
        cost += llmCost(result.config, llmUsage);
        // The decision model's choice wins, even if the LLM changed it.
        response = build(
          { ...result.triage, category: decision.category, priority: decision.priority },
          decision.probabilities,
        );
      }
    }

    await logCall({
      ...baseLog,
      llm_model: llmModel,
      dm_model: dmModel,
      status: 200,
      error_code: null,
      latency_ms: response.meta.latency_ms,
      input_tokens: response.meta.usage.total.input_tokens,
      output_tokens: response.meta.usage.total.output_tokens,
      cost_usd: cost,
    });
    return response;
  } catch (thrown) {
    const error = toAppError(thrown);
    const partial = (thrown as { usage?: Usage | null }).usage ?? null;
    const usage = sumUsage(llmUsage ?? partial, dmUsage);
    console.error(`[triage] ${error.code}: ${error.detail ?? ""}`);
    await logCall({
      ...baseLog,
      llm_model: llmModel,
      dm_model: dmModel,
      status: error.status,
      error_code: error.code,
      latency_ms: Math.round(performance.now() - started),
      input_tokens: usage.input_tokens || null,
      output_tokens: usage.output_tokens || null,
      cost_usd: cost,
    });
    throw error;
  }

  function build(
    triage: TriageResponse["triage"],
    probabilities: TriageResponse["meta"]["dm_probabilities"],
  ): TriageResponse {
    // The payload is checked against its schema before it is forwarded to the user.
    const parsed = TriageResponseSchema.safeParse({
      triage,
      meta: {
        strategy,
        prompt_version: promptVersionFor(strategy),
        config,
        llm_model: llmModel,
        dm_model: dmModel,
        latency_ms: Math.round(performance.now() - started),
        usage: { llm: llmUsage, dm: dmUsage, total: sumUsage(llmUsage, dmUsage) },
        cost_usd: cost,
        dm_probabilities: probabilities,
      },
    });
    if (!parsed.success) {
      throw new AppError("invalid_model_output", { detail: `response schema: ${parsed.error.issues[0]?.message}` });
    }
    return parsed.data;
  }
}
