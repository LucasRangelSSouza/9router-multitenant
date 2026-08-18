import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    tenantId: row.tenantId ?? null,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// tenantId: pass the owning tenant's id for all new code paths. Left optional
// (defaults to null) only so existing callers that haven't been migrated yet
// (onda 2) keep working — a null tenantId means "legacy/global key", same
// semantics as a pre-multi-tenant row.
export async function createApiKey(name, machineId, tenantId = null) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    tenantId: tenantId || null,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, tenantId, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.tenantId, apiKey.createdAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, tenantId = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.tenantId ?? null, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// Returns { isActive, tenantId } for the key, or null if the key doesn't exist.
// tenantId is null for legacy/global keys that predate multi-tenant support.
export async function getApiKeyAuth(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, tenantId FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return null;
  return {
    isActive: row.isActive === 1 || row.isActive === true,
    tenantId: row.tenantId ?? null,
  };
}

// Kept for backward compatibility with existing callers — wraps getApiKeyAuth.
export async function validateApiKey(key) {
  const auth = await getApiKeyAuth(key);
  return !!auth && auth.isActive;
}
