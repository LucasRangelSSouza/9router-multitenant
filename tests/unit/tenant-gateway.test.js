// Gateway multi-tenant (Fase G): allow-list de combos por chave, tenant suspenso,
// nos de provedor por tenant, estrategia por combo, uso por tenant, SSRF e token de servico.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {
  DATA_DIR: process.env.DATA_DIR,
  MT_STRICT: process.env.MT_STRICT,
  MT_ADMIN_TOKEN: process.env.MT_ADMIN_TOKEN,
  MT_ALLOW_PRIVATE_URLS: process.env.MT_ALLOW_PRIVATE_URLS,
};

async function ctx() {
  delete global._dbAdapter;
  vi.resetModules();
  const mods = await Promise.all([
    import("@/lib/db/repos/tenantsRepo.js"), import("@/lib/db/repos/apiKeysRepo.js"),
    import("@/lib/db/repos/connectionsRepo.js"), import("@/lib/db/repos/combosRepo.js"),
    import("@/lib/db/repos/nodesRepo.js"), import("@/lib/db/repos/usageRepo.js"),
    import("@/sse/services/model.js"), import("@/lib/gate.js"), import("@/lib/keyScope.js"),
    import("@/lib/requestContext.js"), import("@/lib/urlGuard.js"),
  ]);
  return Object.assign({}, ...mods);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-gw-"));
  process.env.DATA_DIR = tempDir;
  process.env.MT_STRICT = "1";
  delete process.env.MT_ALLOW_PRIVATE_URLS;
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("allow-list de combos por chave", () => {
  it("persiste, volta na autenticacao e aceita so combos do proprio tenant", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const b = await x.createTenant("B");
    await x.createCombo({ name: "c1", models: [], tenantId: a.id });
    await x.createCombo({ name: "cb", models: [], tenantId: b.id });
    expect((await x.validateAllowedCombos(a.id, ["c1"])).value).toEqual(["c1"]);
    expect((await x.validateAllowedCombos(a.id, ["cb"])).error).toMatch(/not found in this tenant/);
    expect((await x.validateAllowedCombos(a.id, "c1")).error).toBeTruthy();
    const k = await x.createApiKey("r", "m", a.id, { allowedCombos: ["c1"] });
    expect((await x.getApiKeyAuth(k.key)).allowedCombos).toEqual(["c1"]);
    const free = await x.createApiKey("f", "m", a.id);
    expect((await x.getApiKeyAuth(free.key)).allowedCombos).toBeNull();
  });

  it("gateDecision: restrita so passa no combo exato; invalida, sem tenant e suspenso negam", async () => {
    const x = await ctx();
    const ok = { isActive: true, tenantId: "t1", tenantStatus: "active", allowedCombos: ["c1"] };
    expect(x.gateDecision(ok, "c1")).toBeNull();
    for (const m of ["c2", "C1", "c1 ", "pa/m1", "", null, undefined, 123]) expect(x.gateDecision(ok, m)?.status).toBe(403);
    expect(x.gateDecision({ ...ok, allowedCombos: [] }, "c1")?.status).toBe(403);
    expect(x.gateDecision({ ...ok, allowedCombos: null }, "qualquer")).toBeNull();
    expect(x.gateDecision(ok, null, { requireModel: false })?.status).toBe(403);
    expect(x.gateDecision({ ...ok, tenantStatus: "suspended" }, "c1")?.message).toMatch(/suspended/);
    expect(x.gateDecision({ ...ok, tenantId: null }, "c1")?.status).toBe(403);
    expect(x.gateDecision({ ...ok, isActive: false }, "c1")?.status).toBe(401);
    expect(x.gateDecision(null, "c1")?.status).toBe(401);
  });

  it("allowedCombos corrompido no banco = restrita a nada (fail-closed)", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const k = await x.createApiKey("r", "m", a.id);
    const db = await (await import("@/lib/db/driver.js")).getAdapter();
    db.run(`UPDATE apiKeys SET allowedCombos = 'nao-e-json' WHERE id = ?`, [k.id]);
    expect((await x.getApiKeyAuth(k.key)).allowedCombos).toEqual([]);
  });

  it("suspender o tenant reflete na autenticacao da chave; retomar volta", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const k = await x.createApiKey("k", "m", a.id);
    expect((await x.getApiKeyAuth(k.key)).tenantStatus).toBe("active");
    await x.updateTenant(a.id, { status: "suspended" });
    expect((await x.getApiKeyAuth(k.key)).tenantStatus).toBe("suspended");
    await x.updateTenant(a.id, { status: "active" });
    expect((await x.getApiKeyAuth(k.key)).tenantStatus).toBe("active");
  });
});

describe("nos de provedor por tenant", () => {
  it("prefixo igual em tenants diferentes resolve cada um para o seu no; sem tenant nao resolve", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const b = await x.createTenant("B");
    const na = await x.createProviderNode({ id: "openai-compatible-chat-a", type: "openai-compatible", prefix: "meu", apiType: "chat", baseUrl: "https://a.example.com/v1", name: "na", tenantId: a.id });
    const nb = await x.createProviderNode({ id: "openai-compatible-chat-b", type: "openai-compatible", prefix: "meu", apiType: "chat", baseUrl: "https://b.example.com/v1", name: "nb", tenantId: b.id });
    expect((await x.getModelInfo("meu/m1", a.id)).provider).toBe(na.id);
    expect((await x.getModelInfo("meu/m1", b.id)).provider).toBe(nb.id);
    expect((await x.getProviderNodes({ tenantId: a.id })).map((n) => n.id)).toEqual([na.id]);
    expect(await x.getProviderNodes({ tenantId: null })).toEqual([]);
    await expect(x.createProviderNode({ type: "openai-compatible", prefix: "z", baseUrl: "https://z.example.com", name: "z" })).rejects.toThrow(/tenantId is required/);
    await x.createProviderNode({ id: "openai-compatible-chat-b2", type: "openai-compatible", prefix: "soB", apiType: "chat", baseUrl: "https://b2.example.com/v1", name: "nb2", tenantId: b.id });
    expect((await x.getModelInfo("soB/m1", a.id)).provider).not.toBe("openai-compatible-chat-b2");
  });

  it("offboarding apaga os nos do tenant", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    await x.createProviderNode({ type: "openai-compatible", prefix: "p", baseUrl: "https://a.example.com", name: "n", tenantId: a.id });
    expect((await x.deleteTenantCascade(a.id)).nodes).toBe(1);
  });
});

describe("combos: provedores do mesmo tenant e estrategia propria", () => {
  it("validateComboModels recusa provedor de outro tenant e combo inexistente", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const b = await x.createTenant("B");
    const na = await x.createProviderNode({ id: "openai-compatible-chat-a", type: "openai-compatible", prefix: "pa", apiType: "chat", baseUrl: "https://a.example.com", name: "na", tenantId: a.id });
    await x.createProviderNode({ id: "openai-compatible-chat-b", type: "openai-compatible", prefix: "pb", apiType: "chat", baseUrl: "https://b.example.com", name: "nb", tenantId: b.id });
    await x.createProviderConnection({ provider: na.id, authType: "apikey", name: "ca", apiKey: "k", tenantId: a.id });
    await x.createCombo({ name: "base", models: ["pa/m1"], tenantId: a.id });
    expect((await x.validateComboModels(a.id, ["pa/m1", "base"], "novo")).value).toBeTruthy();
    expect((await x.validateComboModels(a.id, ["pb/m1"], "novo")).error).toMatch(/not configured in this tenant/);
    expect((await x.validateComboModels(a.id, ["openai/gpt-4o"], "novo")).error).toMatch(/not configured/);
    expect((await x.validateComboModels(a.id, ["inexistente"], "novo")).error).toMatch(/unknown combo/);
    expect((await x.validateComboModels(a.id, ["novo"], "novo")).error).toMatch(/itself/);
  });

  it("estrategia vive no combo; dois tenants com combo main nao compartilham", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const b = await x.createTenant("B");
    await x.createCombo({ name: "main", models: [], strategy: { fallbackStrategy: "round-robin" }, tenantId: a.id });
    await x.createCombo({ name: "main", models: [], tenantId: b.id });
    const { comboStrategiesFor, comboRotationKey } = await import("@/lib/tenancy.js");
    const glob = { comboStrategies: { main: { fallbackStrategy: "fusion" } } };
    expect((await comboStrategiesFor(glob, a.id)).main.fallbackStrategy).toBe("round-robin");
    expect((await comboStrategiesFor(glob, b.id)).main).toBeUndefined();
    expect(comboRotationKey(a.id, "main")).not.toBe(comboRotationKey(b.id, "main"));
    expect(x.validateComboStrategy({ fallbackStrategy: "xx" }).error).toBeTruthy();
  });
});

describe("uso por tenant", () => {
  it("grava tenantId e combo pedido (contexto) e agrega so o tenant", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const b = await x.createTenant("B");
    const ka = await x.createApiKey("ka", "m", a.id);
    const kb = await x.createApiKey("kb", "m", b.id);
    await x.runWithRequestContext({ tenantId: a.id, requestedModel: "main" }, async () => {
      await x.saveRequestUsage({ provider: "p", model: "m1", apiKey: ka.key, tokens: { prompt_tokens: 10, completion_tokens: 5 }, status: "ok" });
    });
    await x.saveRequestUsage({ provider: "p", model: "m2", apiKey: kb.key, tokens: { prompt_tokens: 7, completion_tokens: 1 }, status: "ok" });
    await x.saveRequestUsage({ provider: "p", model: "m1", apiKey: ka.key, tokens: { prompt_tokens: 3, completion_tokens: 3 }, status: "error", timestamp: new Date(Date.now() + 5).toISOString() });
    const ua = await x.getTenantUsage(a.id);
    const ub = await x.getTenantUsage(b.id);
    expect(ua.requests).toBe(2);
    expect(ua.promptTokens).toBe(13);
    expect(ua.errors).toBe(1);
    expect(ua.byCombo.find((c) => c.combo === "main").requests).toBe(1);
    expect(ub.requests).toBe(1);
    expect(ub.promptTokens).toBe(7);
    const log = await x.getTenantRequests(a.id, { limit: 10 });
    expect(log.requests).toHaveLength(2);
    expect(JSON.stringify(log)).not.toContain(ka.key);
  });
});

describe("anti-SSRF", () => {
  it("bloqueia hosts internos e aceita publicos", async () => {
    const x = await ctx();
    const bad = ["http://localhost:3000", "http://127.0.0.1/x", "http://169.254.169.254/latest", "http://10.0.0.5/v1", "http://192.168.1.1",
      "http://172.20.0.3:8080", "http://chatwoot-rails:3000", "http://[::1]/x", "http://[::ffff:10.0.0.1]/x", "http://[fd00::1]/x",
      "file:///etc/passwd", "ftp://a.com", "http://u:p@a.com", "http://metadata.internal", "http://0.0.0.0"];
    for (const u of bad) expect(x.checkOutboundUrl(u), u).toBeTruthy();
    for (const u of ["https://api.openai.com/v1", "https://8.8.8.8/x", "http://example.org:8080/v1"]) expect(x.checkOutboundUrl(u), u).toBeNull();
    expect(x.checkProviderSpecificData("ollama-local", {})).toBeTruthy();
    expect(x.checkProviderSpecificData("azure", { azureEndpoint: "http://10.0.0.1" })).toBeTruthy();
    expect(x.checkProviderSpecificData("azure", { azureEndpoint: "https://x.openai.azure.com" })).toBeNull();
    process.env.MT_ALLOW_PRIVATE_URLS = "1";
    expect(x.checkOutboundUrl("http://localhost")).toBeNull();
  });
});

describe("token de servico (serviceTokenGate)", () => {
  async function gate(method, p, headers = {}) {
    process.env.MT_ADMIN_TOKEN = "t".repeat(40);
    const mod = await import("@/dashboardGuard.js");
    const url = new URL("http://gw.local" + p);
    const req = { url: url.toString(), method, nextUrl: url, headers: new Headers(headers), cookies: { get: () => undefined } };
    const res = await mod.__test__.serviceTokenGate(req, url.pathname);
    return res ? res.status : null;
  }

  it("rotas globais negadas; escopadas exigem x-tenant-id de tenant existente", async () => {
    const x = await ctx();
    const a = await x.createTenant("A");
    const H = { "x-tenant-id": a.id };
    const globais = ["/api/settings", "/api/usage/stats", "/api/usage/chart", "/api/proxy-pools", "/api/cli-tools/all-statuses", "/api/models/alias",
      "/api/providers/test-batch", "/api/providers/client", "/api/oauth/codex/start-proxy", "/api/shutdown", "/api/tunnel/enable"];
    for (const p of globais) expect(await gate("GET", p, H), p).toBe(403);
    const escopadas = ["/api/providers", "/api/combos", "/api/keys", "/api/provider-nodes", "/api/oauth/codex/authorize", "/api/usage/abc123", "/api/providers/xyz/test", `/api/tenants/${a.id}/usage`];
    for (const p of escopadas) {
      expect(await gate("GET", p, {}), p + " sem header").toBe(400);
      expect(await gate("GET", p, H), p).toBeNull();
    }
    expect(await gate("GET", "/api/providers", { "x-tenant-id": "tenant-inexistente-1" })).toBe(404);
    expect(await gate("GET", "/api/providers", { "x-tenant-id": "x" })).toBe(400);
    expect(await gate("GET", `/api/tenants/${a.id}/usage`, { "x-tenant-id": "outro-tenant-0001" })).toBe(403);
    expect(await gate("GET", "/api/providers?tenantId=outro-tenant-0001", H)).toBe(400);
    expect(await gate("GET", "/api/tenants", H)).toBe(403);
    expect(await gate("POST", "/api/tenants", {})).toBe(400);
    expect(await gate("POST", "/api/tenants", H)).toBeNull();
    expect(await gate("DELETE", `/api/tenants/${a.id}`, {})).toBe(400);
    expect(await gate("DELETE", `/api/tenants/${a.id}`, H)).toBeNull();
    expect(await gate("DELETE", `/api/tenants/${a.id}`, { "x-tenant-id": "outro-tenant-0001" })).toBe(403);
  });
});

describe("provisionamento do BFF", () => {
  it("nao permite criar tenant com id diferente do escopo informado", async () => {
    const x = await ctx();
    const { POST } = await import("@/app/api/tenants/route.js");
    const ownId = "account_12345678";
    const otherId = "account_87654321";
    const mismatched = new Request("http://gw.local/api/tenants", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": ownId },
      body: JSON.stringify({ id: otherId, name: "Outra conta" }),
    });
    expect((await POST(mismatched)).status).toBe(403);

    const allowed = new Request("http://gw.local/api/tenants", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": ownId },
      body: JSON.stringify({ id: ownId, name: "Conta atual" }),
    });
    const response = await POST(allowed);
    expect(response.status).toBe(201);
    expect((await response.json()).tenant.id).toBe(ownId);
    expect(await x.getTenantById(otherId)).toBeNull();
  });
});
