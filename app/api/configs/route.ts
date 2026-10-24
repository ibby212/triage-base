import { publicConfigInfo } from "@/lib/config";

// Names, labels and model ids only: the browser never receives a URL or a key.
export function GET() {
  return Response.json(publicConfigInfo());
}
