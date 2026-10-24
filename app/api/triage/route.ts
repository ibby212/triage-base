import { errorResponse, toAppError } from "@/lib/errors";
import { parseBody } from "@/lib/http";
import { TriageRequestSchema } from "@/lib/schema";
import { triageTicket } from "@/lib/triage";

// POST /api/triage { ticket, strategy?, config? } -> validated TriageResponse
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, TriageRequestSchema);
    return Response.json(await triageTicket(input, { route: "triage" }));
  } catch (error) {
    return errorResponse(toAppError(error));
  }
}
