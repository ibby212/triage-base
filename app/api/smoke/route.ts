import { errorResponse, toAppError } from "@/lib/errors";
import { parseBody } from "@/lib/http";
import { SmokeRequestSchema } from "@/lib/schema";
import { runSmokeTest } from "@/lib/smoke";

// A run of up to 100 tickets can take a few minutes on a free tier.
export const maxDuration = 600;

// POST /api/smoke { dataset, sample, strategy, config } -> SmokeRun (also saved under runs/)
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, SmokeRequestSchema);
    return Response.json(await runSmokeTest(input));
  } catch (error) {
    return errorResponse(toAppError(error));
  }
}
