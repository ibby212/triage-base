import "server-only";
import { z } from "zod";
import { getDmConfig, type DmConfig } from "./config";
import { AppError, fromHttpStatus } from "./errors";
import { CATEGORIES, PRIORITIES, type Category, type Priority, type Usage } from "./schema";

// Decision model client: vLLM Semantic Router "Decision 3.0", POST /v1/systemone.
// The OpenAI chat SDK does not apply to this endpoint, so this is a plain fetch.
// A decision model reads the ticket once and answers typed questions with probabilities.
// It cannot write: no summary, no suggested action.

export const DM_QUESTIONS_VERSION = "dm-questions-v1";

// The decision guidance, as data: the options and what each one means.
const QUESTIONS = {
  category: {
    type: "choice",
    instructions:
      "Which support queue should this customer ticket for a BI SaaS product go to? " +
      "How-to questions about using the product go to technical_bug.",
    criteria: {
      billing: "invoices, payments, refunds, charges, plan or pricing changes, VAT, purchase orders",
      technical_bug: "the product does not work as expected: errors, crashes, wrong data, broken exports or integrations, or a how-to question",
      account: "login, SSO, passwords, 2FA, roles and permissions, user seats, workspace settings, data deletion or GDPR requests",
      feature_request: "the customer asks for a capability the product does not offer today",
    },
  },
  priority: {
    type: "choice",
    instructions:
      "What is the business impact of this ticket? Judge the impact, not the tone: urgency words or anger do not raise it.",
    criteria: {
      low: "cosmetic issue, question, how-to, or a feature request",
      medium: "one user or one feature impaired with a workaround, or a time-bound request",
      high: "many users blocked, data loss, security concern, production outage, or a serious billing error such as a double charge",
    },
  },
} as const;

// The answer is untrusted too: validated with Zod, never assumed.
const ChoiceAnswer = z.object({
  choice: z.string(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
const DmResponseSchema = z.object({
  answers: z.object({ category: ChoiceAnswer, priority: ChoiceAnswer }),
  model: z.string().optional(),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }).partial().optional(),
});

export type DmDecision = {
  category: Category;
  priority: Priority;
  probabilities: { category: Record<string, number>; priority: Record<string, number> };
  usage: Usage | null;
  model: string;
  config: DmConfig;
};

export function requireDmConfig(): DmConfig {
  const config = getDmConfig();
  if (!config) {
    throw new AppError("not_configured", {
      message: "The decision model is not configured: set DM_API_KEY in .env.local and restart the server.",
    });
  }
  return config;
}

export function dmCost(config: DmConfig, usage: Usage | null): number {
  return usage ? (usage.input_tokens * config.priceInputPerM) / 1_000_000 : 0;
}

async function callDm(config: DmConfig, ticket: string): Promise<Response> {
  return fetch(`${config.baseURL}/v1/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, state: ticket, questions: QUESTIONS }),
    signal: AbortSignal.timeout(30_000),
  });
}

export async function decide(ticket: string): Promise<DmDecision> {
  const config = requireDmConfig();

  let response = await callDm(config, ticket);
  // Free tier: per-minute budgets. One bounded retry, honouring Retry-After (max 5 s).
  if (response.status === 429) {
    const wait = Math.min(Number(response.headers.get("retry-after")) || 2, 5);
    await new Promise((r) => setTimeout(r, wait * 1000));
    response = await callDm(config, ticket);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw fromHttpStatus(response.status, `DM ${response.status} ${text.slice(0, 200)}`);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AppError("invalid_model_output", { detail: "DM answer is not JSON" });
  }
  const parsed = DmResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("invalid_model_output", { detail: `DM schema mismatch: ${parsed.error.issues[0]?.message}` });
  }
  const { answers, usage, model } = parsed.data;
  const category = z.enum(CATEGORIES).safeParse(answers.category.choice);
  const priority = z.enum(PRIORITIES).safeParse(answers.priority.choice);
  if (!category.success || !priority.success) {
    throw new AppError("invalid_model_output", { detail: "DM chose an option outside the allowed set" });
  }

  const input = usage?.input_tokens;
  return {
    category: category.data,
    priority: priority.data,
    probabilities: { category: answers.category.probabilities, priority: answers.priority.probabilities },
    // Decision models bill input only: output is a few numbers.
    usage: input === undefined ? null : { input_tokens: input, output_tokens: 0, total_tokens: input },
    model: model ?? config.model,
    config,
  };
}
