import { NextResponse } from "next/server";
import { getTenantById, updateTenant, deleteTenantCascade } from "@/lib/localDb";
import { invalidateTenantLimit } from "@/lib/tenantLimits.js";

export const dynamic = "force-dynamic";

// GET /api/tenants/[id]
export async function GET(request, { params }) {
  const { id } = await params;
  const tenant = await getTenantById(id);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  return NextResponse.json({ tenant });
}

// PATCH /api/tenants/[id] - { name?, rpm?, status? } (status: active|suspended; suspenso => chaves do tenant respondem 403) (rpm = requisicoes/minuto; null = sem limite)
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (body.status !== undefined) {
      if (!["active", "suspended"].includes(body.status)) {
        return NextResponse.json({ error: "status must be active or suspended" }, { status: 400 });
      }
      data.status = body.status;
    }
    if (body.rpm !== undefined) {
      if (body.rpm !== null && (!Number.isInteger(body.rpm) || body.rpm < 1)) {
        return NextResponse.json({ error: "rpm must be a positive integer or null" }, { status: 400 });
      }
      data.rpm = body.rpm;
    }
    const tenant = await updateTenant(id, data);
    invalidateTenantLimit(id);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    return NextResponse.json({ tenant });
  } catch (error) {
    console.log("Error updating tenant:", error);
    return NextResponse.json({ error: "Failed to update tenant" }, { status: 500 });
  }
}

// DELETE /api/tenants/[id] - offboarding: apaga chaves, conexoes, nos e combos do tenant (?purgeUsage=1 apaga tambem o historico de uso)
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const purgeUsage = new URL(request.url).searchParams.get("purgeUsage") === "1";
    const counts = await deleteTenantCascade(id, { purgeUsage });
    if (!counts?.tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    return NextResponse.json({ deleted: counts });
  } catch (error) {
    console.log("Error deleting tenant:", error);
    return NextResponse.json({ error: "Failed to delete tenant" }, { status: 500 });
  }
}
