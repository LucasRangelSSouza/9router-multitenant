import { isStrict, tenantIdFromRequest } from "@/lib/tenancy.js";
import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { validateAllowedCombos } from "@/lib/keyScope.js";

import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET(request) {
  try {
    const tenantId = tenantIdFromRequest(request);
    let keys = await getApiKeys();
    if (tenantId) {
      // escopo de tenant (BFF): so as chaves dele, e o segredo nunca volta na listagem
      keys = keys.filter((k) => k.tenantId === tenantId).map((k) => ({ ...k, key: `${String(k.key).slice(0, 8)}***` }));
    }
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;
    const tenantId = tenantIdFromRequest(request, body);
    if (isStrict() && !tenantId) {
      return NextResponse.json({ error: "tenantId is required (MT_STRICT=1)" }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    // tenantId is optional — omitted/undefined keeps today's legacy/global key behavior.
    const allowed = await validateAllowedCombos(tenantId, body.allowedCombos);
    if (allowed.error) return NextResponse.json({ error: allowed.error }, { status: 400 });
    const apiKey = await createApiKey(name, machineId, tenantId || null, { allowedCombos: allowed.value });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      tenantId: apiKey.tenantId,
      allowedCombos: apiKey.allowedCombos,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
