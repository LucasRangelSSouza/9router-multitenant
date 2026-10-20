import { NextResponse } from "next/server";
import { getTenantById, getTenantRequests } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/tenants/[id]/requests?limit=50&before=<id> - log de requisicoes so do tenant
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!(await getTenantById(id))) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    const sp = new URL(request.url).searchParams;
    return NextResponse.json(await getTenantRequests(id, { limit: sp.get("limit"), beforeId: sp.get("before") }));
  } catch (error) {
    console.log("Error fetching tenant requests:", error);
    return NextResponse.json({ error: "Failed to fetch tenant requests" }, { status: 500 });
  }
}
