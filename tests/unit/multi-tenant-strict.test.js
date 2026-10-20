// Modo estrito (MT_STRICT=1): fail-closed. Linhas sem dono nunca vazam, combos
// com o mesmo nome convivem em tenants diferentes, offboarding apaga tudo do tenant.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalStrict = process.env.MT_STRICT;

async function ctx() {
  delete global._dbAdapter;
  vi.resetModules();
  const t = await import("@/lib/db/repos/tenantsRepo.js");
  const k = await import("@/lib/db/repos/apiKeysRepo.js");
  const c = await import("@/lib/db/repos/connectionsRepo.js");
  const b = await import("@/lib/db/repos/combosRepo.js");
  const a = await import("@/sse/services/auth.js");
  const m = await import("@/sse/services/model.js");
  return { ...t, ...k, ...c, ...b, ...a, ...m };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tenant-strict-"));
  process.env.DATA_DIR = tempDir;
  process.env.MT_STRICT = "1";
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  if (originalStrict === undefined) delete process.env.MT_STRICT; else process.env.MT_STRICT = originalStrict;
});

describe("multi-tenant estrito", () => {
  it("criar conexao, combo ou chave sem tenant falha", async () => {
    const x = await ctx();
    await expect(x.createProviderConnection({ provider: "openai", authType: "apikey", name: "a", apiKey: "k" })).rejects.toThrow(/tenantId is required/);
    await expect(x.createCombo({ name: "c", models: [] })).rejects.toThrow(/tenantId is required/);
    await expect(x.createApiKey("k", "m")).rejects.toThrow(/tenantId is required/);
  });

  it("conexao sem dono (legado) nunca e visivel a um tenant", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    // grava uma linha legada direto, como as de antes do patch
    const db = await (await import("@/lib/db/driver.js")).getAdapter();
    const now = new Date().toISOString();
    db.run(`INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt) VALUES('legacy','openai','apikey','legacy',1,'{"apiKey":"sk-legacy"}',?,?)`, [now, now]);
    const mine = await x.getProviderConnections({ provider: "openai", isActive: true, tenantId: a.id });
    expect(mine).toHaveLength(0);
    // sem tenant na requisicao: nenhuma credencial (fail-closed)
    expect(await x.getProviderCredentials("openai", null, null, {})).toBeNull();
    expect(await x.getProviderCredentials("openai", null, null, { tenantId: a.id })).toBeNull();
  });

  it("combos com o mesmo nome em tenants diferentes; cada um resolve o seu", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const b = await x.createTenant("B");
    await x.createCombo({ name: "main", models: ["a/m1"], tenantId: a.id });
    await x.createCombo({ name: "main", models: ["b/m1"], tenantId: b.id });
    expect((await x.getComboByName("main", a.id)).models).toEqual(["a/m1"]);
    expect((await x.getComboByName("main", b.id)).models).toEqual(["b/m1"]);
    await expect(x.createCombo({ name: "main", models: [], tenantId: a.id })).rejects.toThrow();
    // sem tenant (chave sem dono): combo nao resolve
    expect(await x.getComboModels("main", null)).toBeNull();
    expect((await x.getComboModels("main", a.id))).toEqual(["a/m1"]);
  });

  it("offboarding apaga chaves, conexoes e combos so do tenant", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const b = await x.createTenant("B");
    for (const t of [a, b]) {
      await x.createApiKey(`k-${t.name}`, "m", t.id);
      await x.createProviderConnection({ provider: "openai", authType: "apikey", name: `c-${t.name}`, apiKey: "k", tenantId: t.id });
      await x.createCombo({ name: "main", models: [], tenantId: t.id });
    }
    const counts = await x.deleteTenantCascade(a.id);
    expect(counts).toEqual({ keys: 1, connections: 1, combos: 1, tenant: 1 });
    expect(await x.getProviderConnections({ tenantId: b.id })).toHaveLength(1);
    expect(await x.getCombos(b.id)).toHaveLength(1);
    expect(await x.getTenantById(a.id)).toBeNull();
  });

  it("rpm persiste e atualiza", async () => {
    const x = await ctx();
    const a = await x.createTenant("A", { rpm: 60 });
    expect(a.rpm).toBe(60);
    const u = await x.updateTenant(a.id, { rpm: null });
    expect(u.rpm).toBeNull();
  });
});
