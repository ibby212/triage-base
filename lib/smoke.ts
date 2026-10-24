import "server-only";
import { randomUUID } from "node:crypto";
import { getLlmConfig } from "./config";
import { loadDataset, sample, ticketText } from "./data";
import { AppError } from "./errors";
import { saveRun } from "./log";
import { PROMPT_VERSION } from "./prompt";
import { TriageRequestSchema, type SmokeRequest } from "./schema";
import { triageTicket } from "./triage";

// Smoke test: small and fast, to catch breakage, not to prove quality.
// Each ticket goes through the same triageTicket() as POST /api/triage.

export type SmokeRow = {
  ticket_id: string;
  tags: string | null;
  outcome: string; // "ok" or an error code
  status: number;
  expected: { category: string; priority: string } | null;
  predicted: { category: string; priority: string } | null;
  category_match: boolean | null;
  priority_match: boolean | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export type SmokeRun = {
  run_id: string;
  ts: string;
  dataset: SmokeRequest["dataset"];
  sample_size: number;
  strategy: SmokeRequest["strategy"];
  config: string;
  config_label: string | null;
  llm_model: string | null;
  dm_model: string | null;
  prompt_version: string;
  outcomes: Record<string, number>;
  labelled: boolean;
  accuracy: { category: number; priority: number; both: number } | null;
  mismatches: { category: number; priority: number } | null;
  confusion: { category: Record<string, Record<string, number>>; priority: Record<string, Record<string, number>> } | null;
  latency_ms: { avg: number; p50: number; p95: number; wall: number };
  tokens: { input: number; output: number; total: number };
  cost_usd: number;
  rows: SmokeRow[];
  file?: string;
};

const CONCURRENCY = 3;
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function bump(matrix: Record<string, Record<string, number>>, expected: string, predicted: string) {
  matrix[expected] ??= {};
  matrix[expected][predicted] = (matrix[expected][predicted] ?? 0) + 1;
}

export async function runSmokeTest(request: SmokeRequest): Promise<SmokeRun> {
  const { dataset, strategy, config } = request;
  if (!getLlmConfig(config)) {
    throw new AppError("not_configured", { message: `Unknown model configuration "${config}".` });
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + randomUUID().slice(0, 4);
  const tickets = sample(await loadDataset(dataset), request.sample);
  const labelled = dataset === "labelled100";
  const started = performance.now();

  const rows = await mapLimit(tickets, CONCURRENCY, async (ticket): Promise<SmokeRow> => {
    const expected = labelled && ticket.category && ticket.priority
      ? { category: ticket.category, priority: ticket.priority }
      : null;
    const base = { ticket_id: ticket.ticket_id, tags: ticket.tags || null, expected };
    const t0 = performance.now();

    // Same input validation as the API: over-long tickets are a 400, not a provider call.
    const input = TriageRequestSchema.safeParse({ ticket: ticketText(ticket), strategy, config });
    if (!input.success) {
      return {
        ...base, outcome: "invalid_request", status: 400, predicted: null,
        category_match: null, priority_match: null, latency_ms: 0,
        input_tokens: 0, output_tokens: 0, cost_usd: 0,
      };
    }

    try {
      const result = await triageTicket(input.data, { route: "smoke", ticketId: ticket.ticket_id, runId });
      const predicted = { category: result.triage.category, priority: result.triage.priority };
      return {
        ...base, outcome: "ok", status: 200, predicted,
        category_match: expected ? expected.category === predicted.category : null,
        priority_match: expected ? expected.priority === predicted.priority : null,
        latency_ms: result.meta.latency_ms,
        input_tokens: result.meta.usage.total.input_tokens,
        output_tokens: result.meta.usage.total.output_tokens,
        cost_usd: result.meta.cost_usd,
      };
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError("internal_error");
      return {
        ...base, outcome: appError.code, status: appError.status, predicted: null,
        category_match: null, priority_match: null,
        latency_ms: Math.round(performance.now() - t0),
        input_tokens: 0, output_tokens: 0, cost_usd: 0,
      };
    }
  });

  const outcomes: Record<string, number> = {};
  for (const row of rows) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;

  const scored = rows.filter((r) => r.outcome === "ok" && r.expected && r.predicted);
  let accuracy: SmokeRun["accuracy"] = null;
  let mismatches: SmokeRun["mismatches"] = null;
  let confusion: SmokeRun["confusion"] = null;
  if (labelled) {
    const n = scored.length || 1;
    const catOk = scored.filter((r) => r.category_match).length;
    const priOk = scored.filter((r) => r.priority_match).length;
    const bothOk = scored.filter((r) => r.category_match && r.priority_match).length;
    accuracy = { category: catOk / n, priority: priOk / n, both: bothOk / n };
    mismatches = { category: scored.length - catOk, priority: scored.length - priOk };
    confusion = { category: {}, priority: {} };
    for (const r of scored) {
      bump(confusion.category, r.expected!.category, r.predicted!.category);
      bump(confusion.priority, r.expected!.priority, r.predicted!.priority);
    }
  }

  const latencies = rows.filter((r) => r.status !== 400).map((r) => r.latency_ms).sort((a, b) => a - b);
  const llmConfig = getLlmConfig(config);
  const promptVersion = PROMPT_VERSION;

  const run: SmokeRun = {
    run_id: runId,
    ts: new Date().toISOString(),
    dataset,
    sample_size: tickets.length,
    strategy,
    config,
    config_label: llmConfig?.label ?? null,
    llm_model: llmConfig?.model ?? null,
    dm_model: null,
    prompt_version: promptVersion,
    outcomes,
    labelled,
    accuracy,
    mismatches,
    confusion,
    latency_ms: {
      avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      wall: Math.round(performance.now() - started),
    },
    tokens: {
      input: rows.reduce((a, r) => a + r.input_tokens, 0),
      output: rows.reduce((a, r) => a + r.output_tokens, 0),
      total: rows.reduce((a, r) => a + r.input_tokens + r.output_tokens, 0),
    },
    cost_usd: rows.reduce((a, r) => a + r.cost_usd, 0),
    rows,
  };
  run.file = await saveRun(run);
  return run;
}

