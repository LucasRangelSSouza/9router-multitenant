// combos.name era UNIQUE global: dois tenants nao podiam ter combos com o mesmo
// nome (INSERT falhava com 500). Passa a ser unico por (tenantId, name).
// SQLite nao remove UNIQUE inline, entao reconstruimos a tabela.
export default {
  version: 2,
  name: "combos-unico-por-tenant",
  up(db) {
    const t = db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='combos'`);
    if (t && /name\s+TEXT\s+UNIQUE/i.test(t.sql || "")) {
      db.exec(`DROP INDEX IF EXISTS idx_combo_name`);
      db.exec(`DROP INDEX IF EXISTS idx_combo_tenant`);
      db.exec(`ALTER TABLE combos RENAME TO combos_old_unique`);
      db.exec(`CREATE TABLE combos (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT, models TEXT NOT NULL, tenantId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
      db.exec(`INSERT INTO combos(id, name, kind, models, tenantId, createdAt, updatedAt) SELECT id, name, kind, models, tenantId, createdAt, updatedAt FROM combos_old_unique`);
      db.exec(`DROP TABLE combos_old_unique`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_combo_tenant ON combos(tenantId)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_tenant_name ON combos(COALESCE(tenantId, ''), name)`);
  },
};
