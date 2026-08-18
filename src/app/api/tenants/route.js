import { NextResponse } from "next/server";
import { getTenants, createTenant } from "@/lib/localDb";

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

    const tenant = await createTenant(name.trim());

    return NextResponse.json({ tenant }, { status: 201 });
  } catch (error) {
    console.log("Error creating tenant:", error);
    return NextResponse.json({ error: "Failed to create tenant" }, { status: 500 });
  }
}
