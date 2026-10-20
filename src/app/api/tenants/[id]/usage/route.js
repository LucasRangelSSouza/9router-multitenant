import { NextResponse } from "next/server";
import { getTenantById, getTenantUsage } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/tenants/[id]/usage?since=ISO - uso agregado so do tenant (via chaves dele)
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!(await getTenantById(id))) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    const since = new URL(request.url).searchParams.get("since");
    return NextResponse.json(await getTenantUsage(id, { sinceIso: since || null }));
  } catch (error) {
    console.log("Error fetching tenant usage:", error);
    return NextResponse.json({ error: "Failed to fetch tenant usage" }, { status: 500 });
  }
}
