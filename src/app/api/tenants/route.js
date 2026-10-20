import { NextResponse } from "next/server";
import { getTenants, getTenantById, createTenant } from "@/lib/localDb";

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const dynamic = "force-dynamic";

// GET /api/tenants - List all tenants
export async function GET() {
  try {
    const tenants = await getTenants();
    return NextResponse.json({ tenants });
  } catch (error) {
    console.log("Error fetching tenants:", error);
    return NextResponse.json({ error: "Failed to fetch tenants" }, { status: 500 });
  }
}

// POST /api/tenants - Create new tenant
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // `id` opcional (UUID da Account do Luar): torna o provisionamento idempotente.
    const id = body.id;
    if (id !== undefined && (typeof id !== "string" || !ID_RE.test(id))) {
      return NextResponse.json({ error: "id must match [A-Za-z0-9_-]{8,64}" }, { status: 400 });
    }
    if (id) {
      const existing = await getTenantById(id);
      if (existing) return NextResponse.json({ tenant: existing, existed: true }, { status: 200 });
    }
    const tenant = await createTenant(name.trim(), { id });

    return NextResponse.json({ tenant }, { status: 201 });
  } catch (error) {
    console.log("Error creating tenant:", error);
    return NextResponse.json({ error: "Failed to create tenant" }, { status: 500 });
  }
}
