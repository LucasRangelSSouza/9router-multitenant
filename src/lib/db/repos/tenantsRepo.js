import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    rpm: row.rpm ?? null,
    createdAt: row.createdAt,
  };
}

export async function getTenants() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM tenants ORDER BY createdAt ASC`);
  return rows.map(rowToTenant);
}

export async function getTenantById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM tenants WHERE id = ?`, [id]);
  return rowToTenant(row);
}

export async function createTenant(name, opts = {}) {
  if (!name) throw new Error("name is required");
  const db = await getAdapter();
  const tenant = {
    id: opts.id || uuidv4(),
    name,
    rpm: opts.rpm ?? null,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO tenants(id, name, rpm, createdAt) VALUES(?, ?, ?, ?)`,
    [tenant.id, tenant.name, tenant.rpm, tenant.createdAt]
  );
  return tenant;
}

export async function updateTenant(id, data) {
  const db = await getAdapter();
  const cur = db.get(`SELECT * FROM tenants WHERE id = ?`, [id]);
  if (!cur) return null;
  const name = data.name ?? cur.name;
  const rpm = data.rpm === undefined ? cur.rpm : data.rpm;
  db.run(`UPDATE tenants SET name = ?, rpm = ? WHERE id = ?`, [name, rpm, id]);
  return rowToTenant(db.get(`SELECT * FROM tenants WHERE id = ?`, [id]));
}

// Offboarding: remove o tenant e TUDO que e dele (chaves, conexoes, combos).
export async function deleteTenantCascade(id) {
  const db = await getAdapter();
  let counts = null;
  db.transaction(() => {
    const k = db.run(`DELETE FROM apiKeys WHERE tenantId = ?`, [id]);
    const c = db.run(`DELETE FROM providerConnections WHERE tenantId = ?`, [id]);
    const b = db.run(`DELETE FROM combos WHERE tenantId = ?`, [id]);
    const t = db.run(`DELETE FROM tenants WHERE id = ?`, [id]);
    counts = { keys: k?.changes ?? 0, connections: c?.changes ?? 0, combos: b?.changes ?? 0, tenant: t?.changes ?? 0 };
  });
  return counts;
}

// Uso agregado do tenant: usageHistory nao tem tenantId, entao junta pela chave.
export async function getTenantUsage(id, { sinceIso = null } = {}) {
  const db = await getAdapter();
  const params = [id];
  let where = `ak.tenantId = ?`;
  if (sinceIso) { where += ` AND uh.timestamp >= ?`; params.push(sinceIso); }
  const totals = db.get(
    `SELECT COUNT(*) AS requests, COALESCE(SUM(uh.promptTokens),0) AS promptTokens,
            COALESCE(SUM(uh.completionTokens),0) AS completionTokens, COALESCE(SUM(uh.cost),0) AS cost
       FROM usageHistory uh JOIN apiKeys ak ON ak.key = uh.apiKey WHERE ${where}`, params);
  const byModel = db.all(
    `SELECT uh.provider AS provider, uh.model AS model, COUNT(*) AS requests,
            COALESCE(SUM(uh.promptTokens),0) AS promptTokens, COALESCE(SUM(uh.completionTokens),0) AS completionTokens,
            COALESCE(SUM(uh.cost),0) AS cost
       FROM usageHistory uh JOIN apiKeys ak ON ak.key = uh.apiKey WHERE ${where}
      GROUP BY uh.provider, uh.model ORDER BY requests DESC LIMIT 200`, params);
  return { tenantId: id, ...totals, byModel };
}
