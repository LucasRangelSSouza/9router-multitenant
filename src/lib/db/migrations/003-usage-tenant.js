// usageHistory ganha tenantId e requestedModel; apiKeys.allowedCombos e
// tenants.status (suspensao). As migracoes rodam antes do sync aditivo, entao
// as colunas sao garantidas aqui; depois o uso historico recebe o tenant pela chave.
function addCol(db, table, col, def) {
  const has = db.all(`PRAGMA table_info(${table})`).some((r) => r.name === col);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export default {
  version: 3,
  name: "usage-tenant-allowlist-status",
  up(db) {
    addCol(db, "usageHistory", "tenantId", "TEXT");
    addCol(db, "usageHistory", "requestedModel", "TEXT");
    addCol(db, "apiKeys", "allowedCombos", "TEXT");
    addCol(db, "providerNodes", "tenantId", "TEXT");
    addCol(db, "combos", "strategy", "TEXT");
    addCol(db, "tenants", "status", "TEXT DEFAULT 'active'");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_tenant_ts ON usageHistory(tenantId, timestamp DESC)`);
    db.exec(`UPDATE usageHistory SET tenantId = (SELECT tenantId FROM apiKeys WHERE apiKeys.key = usageHistory.apiKey) WHERE tenantId IS NULL AND apiKey IS NOT NULL`);
  },
};
