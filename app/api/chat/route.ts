import { errorResponse, toAppError } from "@/lib/errors";
import { parseBody } from "@/lib/http";
import { chat } from "@/lib/llm";
import { ChatRequestSchema } from "@/lib/schema";

// The server keeps no memory: the client resends the whole conversation every time.
export async function POST(request: Request) {
  try {
    const { messages, config } = await parseBody(request, ChatRequestSchema);
    const result = await chat(config, messages);
    return Response.json({ answer: result.answer, usage: result.usage, model: result.model });
  } catch (thrown) {
    const error = toAppError(thrown);
    if (error.status !== 400) console.error(`[chat] ${error.code}: ${error.detail ?? ""}`);
    return errorResponse(error);
  }
}
