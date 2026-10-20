import { NextResponse } from "next/server";
import { getTenantById, getTenantCounts } from "@/lib/localDb";
import { tenantRpmState } from "@/lib/tenantLimits.js";

export const dynamic = "force-dynamic";

// GET /api/tenants/[id]/summary - estado do tenant: status, limite de RPM (e uso na janela), contagens
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const tenant = await getTenantById(id);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    return NextResponse.json({ tenant, counts: await getTenantCounts(id), rpm: tenantRpmState(id, tenant.rpm) });
  } catch (error) {
    console.log("Error fetching tenant summary:", error);
    return NextResponse.json({ error: "Failed to fetch tenant summary" }, { status: 500 });
  }
}
