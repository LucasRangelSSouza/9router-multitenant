import { ownershipGuard, comboRotationKey } from "@/lib/tenancy.js";
import { validateComboModels, validateComboStrategy } from "@/lib/keyScope.js";
import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const denied = await ownershipGuard(request, "combo", id);
    if (denied) return denied;
    const combo = await getComboById(id);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const denied = await ownershipGuard(request, "combo", id);
    if (denied) return denied;
    const body = await request.json();
    const current = await getComboById(id);
    if (!current) return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    // dono e id nunca mudam por update (impede mover combo para outro tenant)
    delete body.tenantId; delete body.id; delete body.createdAt;
    if (body.models !== undefined) {
      const vm = await validateComboModels(current.tenantId, body.models, body.name || current.name);
      if (vm.error) return NextResponse.json({ error: vm.error }, { status: 400 });
    }
    if (body.strategy !== undefined) {
      const vs = validateComboStrategy(body.strategy);
      if (vs.error) return NextResponse.json({ error: vs.error }, { status: 400 });
      body.strategy = vs.value;
    }

    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }
      
      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(body.name, current.tenantId ?? undefined);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }
    
    // Capture previous name to invalidate rotation state on rename
    const prev = await getComboById(id);
    const combo = await updateCombo(id, body);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state (models/strategy/name may have changed)
    if (prev?.name) resetComboRotation(comboRotationKey(prev.tenantId, prev.name));
    if (combo.name && combo.name !== prev?.name) resetComboRotation(comboRotationKey(combo.tenantId, combo.name));

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const denied = await ownershipGuard(request, "combo", id);
    if (denied) return denied;
    const prev = await getComboById(id);
    const success = await deleteCombo(id);
    
    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(comboRotationKey(prev.tenantId, prev.name));
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
