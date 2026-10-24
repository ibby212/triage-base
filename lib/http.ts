import "server-only";
import type { z } from "zod";
import { AppError } from "./errors";
import { describeZodError } from "./schema";

// Reads the JSON body and validates it with a Zod schema. Throws a 400 AppError otherwise.
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("invalid_request", { message: "Invalid JSON body." });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("invalid_request", { message: describeZodError(parsed.error) });
  }
  return parsed.data;
}
