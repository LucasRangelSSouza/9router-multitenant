import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { requireTenantOrThrow } from "../../tenancy.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    tenantId: row.tenantId ?? null,
    allowedCombos: parseAllowed(row.allowedCombos),
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

// null = chave livre; array = restrita aos combos listados.
function parseAllowed(v) {
  if (v === null || v === undefined || v === "") return null;
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : null;
  } catch { return []; }   // valor corrompido: fail-closed (restrita a nada)
}
function serializeAllowed(a) { return Array.isArray(a) ? JSON.stringify(a) : null; }

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

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

// tenantId: pass the owning tenant's id for all new code paths. Left optional
// (defaults to null) only so existing callers that haven't been migrated yet
// (onda 2) keep working — a null tenantId means "legacy/global key", same
// semantics as a pre-multi-tenant row.
export async function createApiKey(name, machineId, tenantId = null, opts = {}) {
  requireTenantOrThrow(tenantId, "api key");
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
    allowedCombos: Array.isArray(opts.allowedCombos) ? opts.allowedCombos : null,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, tenantId, allowedCombos, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.tenantId, serializeAllowed(apiKey.allowedCombos), apiKey.createdAt, cols.accessRestricted, cols.accessAllow]
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
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, tenantId = ?, allowedCombos = ?, accessRestricted = ?, accessAllow = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.tenantId ?? null, serializeAllowed(merged.allowedCombos), cols.accessRestricted, cols.accessAllow, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
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
  const row = db.get(
    `SELECT ak.isActive AS isActive, ak.tenantId AS tenantId, ak.allowedCombos AS allowedCombos, t.status AS tenantStatus
       FROM apiKeys ak LEFT JOIN tenants t ON t.id = ak.tenantId WHERE ak.key = ?`, [key]);
  if (!row) return null;
  return {
    isActive: row.isActive === 1 || row.isActive === true,
    tenantId: row.tenantId ?? null,
    tenantStatus: row.tenantId ? (row.tenantStatus || "active") : null,
    allowedCombos: parseAllowed(row.allowedCombos),
  };
}

// Kept for backward compatibility with existing callers — wraps getApiKeyAuth.
export async function validateApiKey(key) {
  const auth = await getApiKeyAuth(key);
  return !!auth && auth.isActive;
}
