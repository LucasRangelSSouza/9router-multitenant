import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
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

export async function createTenant(name) {
  if (!name) throw new Error("name is required");
  const db = await getAdapter();
  const tenant = {
    id: uuidv4(),
    name,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO tenants(id, name, createdAt) VALUES(?, ?, ?)`,
    [tenant.id, tenant.name, tenant.createdAt]
  );
  return tenant;
}
