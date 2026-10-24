import { z } from "zod";

// Tickets and chat messages above this length are rejected with a 400.
export const MAX_TICKET_CHARS = 5000;

export const UsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

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

// Short, safe description of the first Zod issue, for the browser.
export function describeZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request.";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}
