import { handleSystemone } from "@/sse/handlers/systemone.js";
import { isStrict } from "@/lib/tenancy.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/systemone - System One (Jev) decision endpoint
 */
export async function POST(request) {
  // LUAR: o System One nao e multi-tenant (credenciais e modelos globais). Fechado no modo estrito.
  if (isStrict()) return Response.json({ error: { message: "Not found", type: "invalid_request_error" } }, { status: 404 });
  return await handleSystemone(request);
}
