import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    tenantId: row.tenantId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// tenantId filter (optional): when passed, only returns combos owned by that
// tenant OR legacy/global combos (tenantId IS NULL) — legacy data stays
// visible to every tenant until it's explicitly migrated (onda 2). Omit the
// filter entirely to keep today's unfiltered behavior (retrocompat).
export async function getCombos(tenantId = undefined) {
  const db = await getAdapter();
  if (tenantId === undefined) {
    const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
    return rows.map(rowToCombo);
  }
  const rows = db.all(
    `SELECT * FROM combos WHERE tenantId = ? OR tenantId IS NULL ORDER BY createdAt ASC`,
    [tenantId]
  );
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

// tenantId filter (optional): same legacy-visible semantics as getCombos().
export async function getComboByName(name, tenantId = undefined) {
  const db = await getAdapter();
  if (tenantId === undefined) {
    const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
    return rowToCombo(row);
  }
  const row = db.get(
    `SELECT * FROM combos WHERE name = ? AND (tenantId = ? OR tenantId IS NULL)`,
    [name, tenantId]
  );
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    tenantId: data.tenantId || null,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, tenantId, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.tenantId, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, tenantId = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.tenantId ?? null, merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
