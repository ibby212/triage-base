import { z } from "zod";

// The triage contract, written once in Zod and used twice:
// 1. ASK: converted to JSON Schema and sent to the provider (json_schema mode).
// 2. CHECK: every model answer and every API payload is parsed with it.

export const CATEGORIES = ["billing", "technical_bug", "account", "feature_request"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const STRATEGIES = ["llm", "dm", "dm+llm"] as const;
export const DATASETS = ["labelled100", "all500"] as const;

// The dataset has tickets above 5,000 characters: they are rejected with a 400, not sent to a provider.
export const MAX_TICKET_CHARS = 5000;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Strategy = (typeof STRATEGIES)[number];
export type Dataset = (typeof DATASETS)[number];

const TicketText = z
  .string({ error: "The ticket must be a string." })
  .trim()
  .min(1, "The ticket is empty.")
  .max(MAX_TICKET_CHARS, `The ticket is longer than ${MAX_TICKET_CHARS} characters.`);

// What the browser sends to POST /api/triage.
export const TriageRequestSchema = z.strictObject({
  ticket: TicketText,
  strategy: z.enum(STRATEGIES).default("llm"),
  config: z.string().min(1).max(40).default("default"),
});
export type TriageRequest = z.infer<typeof TriageRequestSchema>;

// What the LLM must return. Sent to the provider as JSON Schema.
export const TriageSchema = z.strictObject({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  summary: z.string().min(1).max(300),
  suggested_action: z.string().min(1).max(500),
});
export type Triage = z.infer<typeof TriageSchema>;

export const UsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

const Probabilities = z.record(z.string(), z.number().min(0).max(1));

// What POST /api/triage returns. A decision model cannot write, so with the "dm"
// strategy summary and suggested_action are null.
export const TriageResponseSchema = z.strictObject({
  triage: z.strictObject({
    category: z.enum(CATEGORIES),
    priority: z.enum(PRIORITIES),
    summary: z.string().min(1).max(300).nullable(),
    suggested_action: z.string().min(1).max(500).nullable(),
  }),
  meta: z.strictObject({
    strategy: z.enum(STRATEGIES),
    prompt_version: z.string(),
    config: z.string(),
    llm_model: z.string().nullable(),
    dm_model: z.string().nullable(),
    latency_ms: z.number().nonnegative(),
    usage: z.strictObject({
      llm: UsageSchema.nullable(),
      dm: UsageSchema.nullable(),
      total: UsageSchema,
    }),
    cost_usd: z.number().nonnegative(),
    dm_probabilities: z
      .strictObject({ category: Probabilities, priority: Probabilities })
      .nullable(),
  }),
});
export type TriageResponse = z.infer<typeof TriageResponseSchema>;

// Chat: the client resends the whole history. Only user/assistant roles are accepted:
// a "system" message from the browser is a 400.
export const ChatRequestSchema = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(MAX_TICKET_CHARS),
      }),
    )
    .min(1, "Send at least one message.")
    .max(50, "The conversation is too long. Clear it and start again.")
    .refine((m) => m[m.length - 1].role === "user", "The last message must come from the user."),
  config: z.string().min(1).max(40).default("default"),
});

export const SmokeRequestSchema = z.strictObject({
  dataset: z.enum(DATASETS),
  sample: z.number().int().min(1).max(100),
  strategy: z.enum(STRATEGIES).default("llm"),
  config: z.string().min(1).max(40).default("default"),
});
export type SmokeRequest = z.infer<typeof SmokeRequestSchema>;

// Short, safe description of the first Zod issue, for the browser.
export function describeZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request.";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}
