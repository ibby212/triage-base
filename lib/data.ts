import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CATEGORIES, PRIORITIES, type Dataset } from "./schema";

const TicketSchema = z.object({
  ticket_id: z.string(),
  channel: z.string(),
  language: z.string(),
  customer_plan: z.string(),
  subject: z.string(),
  body: z.string(),
});

const LabelledTicketSchema = TicketSchema.extend({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  needs_human_review: z.boolean(),
  tags: z.string(),
});

export type Ticket = z.infer<typeof TicketSchema> & {
  category?: (typeof CATEGORIES)[number];
  priority?: (typeof PRIORITIES)[number];
  tags?: string;
};

const FILES: Record<Dataset, string> = {
  labelled100: "support_tickets_100_labelled.json",
  all500: "support_tickets_500.json",
};

const cache = new Map<Dataset, Ticket[]>();

export async function loadDataset(dataset: Dataset): Promise<Ticket[]> {
  const cached = cache.get(dataset);
  if (cached) return cached;
  const raw: unknown = JSON.parse(await readFile(path.join(process.cwd(), "data", FILES[dataset]), "utf8"));
  const schema = dataset === "labelled100" ? z.array(LabelledTicketSchema) : z.array(TicketSchema);
  const tickets = schema.parse(raw) as Ticket[];
  cache.set(dataset, tickets);
  return tickets;
}

// The ticket text sent to the model is subject + "\n\n" + body.
export function ticketText(ticket: Ticket): string {
  return `${ticket.subject}\n\n${ticket.body}`;
}

// Random sample without replacement (Fisher-Yates on a copy).
export function sample<T>(items: T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}
