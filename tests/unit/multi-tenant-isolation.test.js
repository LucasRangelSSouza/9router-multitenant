// End-to-end proof that the multi-tenant patch actually isolates tenants:
// tenants, apiKeys, providerConnections and combos scoped by tenantId must
// never leak across tenants, while callers that don't pass tenantId at all
// keep the pre-patch "sees everything" behavior (backward compatibility).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function freshContext() {
  // Reset global DB singleton + module cache so this test's temp DATA_DIR
  // is actually picked up (driver.js caches the adapter on `global`).
  delete global._dbAdapter;
  vi.resetModules();

  const { createTenant } = await import("@/lib/db/repos/tenantsRepo.js");
  const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
  const { createProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
  const { createCombo, getComboByName } = await import("@/lib/db/repos/combosRepo.js");
  const { getApiKeyAuth, getProviderCredentials } = await import("@/sse/services/auth.js");

  return {
    createTenant, createApiKey, createProviderConnection,
    createCombo, getComboByName, getApiKeyAuth, getProviderCredentials,
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tenant-isolation-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("multi-tenant isolation (end-to-end)", () => {
  it("apiKey auth resolves to the owning tenant, never the other one", async () => {
    const ctx = await freshContext();

    const tenantA = await ctx.createTenant("Tenant A");
    const tenantB = await ctx.createTenant("Tenant B");

    const keyA = await ctx.createApiKey("Key A", "machine-a", tenantA.id);
    const keyB = await ctx.createApiKey("Key B", "machine-b", tenantB.id);

    const authA = await ctx.getApiKeyAuth(keyA.key);
    const authB = await ctx.getApiKeyAuth(keyB.key);

    expect(authA).not.toBeNull();
    expect(authA.tenantId).toBe(tenantA.id);
    expect(authA.tenantId).not.toBe(tenantB.id);

    expect(authB).not.toBeNull();
    expect(authB.tenantId).toBe(tenantB.id);
    expect(authB.tenantId).not.toBe(tenantA.id);
  });

  it("getProviderCredentials returns each tenant's own connection, never the other tenant's", async () => {
    const ctx = await freshContext();

    const tenantA = await ctx.createTenant("Tenant A");
    const tenantB = await ctx.createTenant("Tenant B");

    await ctx.createProviderConnection({
      provider: "gemini",
      authType: "apikey",
      name: "Gemini A",
      email: "tenant-a@fake.test",
      apiKey: "fake-key-tenant-a",
      tenantId: tenantA.id,
    });
    await ctx.createProviderConnection({
      provider: "gemini",
      authType: "apikey",
      name: "Gemini B",
      email: "tenant-b@fake.test",
      apiKey: "fake-key-tenant-b",
      tenantId: tenantB.id,
    });

    const credsA = await ctx.getProviderCredentials("gemini", null, null, { tenantId: tenantA.id });
    const credsB = await ctx.getProviderCredentials("gemini", null, null, { tenantId: tenantB.id });

    expect(credsA).not.toBeNull();
    expect(credsA.apiKey).toBe("fake-key-tenant-a");
    expect(credsA.providerSpecificData).toBeDefined();
    // Never the other tenant's credential
    expect(credsA.apiKey).not.toBe("fake-key-tenant-b");

    expect(credsB).not.toBeNull();
    expect(credsB.apiKey).toBe("fake-key-tenant-b");
    expect(credsB.apiKey).not.toBe("fake-key-tenant-a");
  });

  it("CRITICAL: tenant with no connections never receives another tenant's connection (no leak)", async () => {
    const ctx = await freshContext();

    const tenantA = await ctx.createTenant("Tenant A");
    const tenantB = await ctx.createTenant("Tenant B");

    // Only tenant A has a connection. Tenant B has none.
    await ctx.createProviderConnection({
      provider: "gemini",
      authType: "apikey",
      name: "Gemini A only",
      email: "only-tenant-a@fake.test",
      apiKey: "fake-key-only-a",
      tenantId: tenantA.id,
    });

    const credsForB = await ctx.getProviderCredentials("gemini", null, null, { tenantId: tenantB.id });

    // Must NOT leak tenant A's connection to tenant B.
    expect(credsForB === null || credsForB.apiKey === undefined).toBe(true);
    if (credsForB) {
      expect(credsForB.apiKey).not.toBe("fake-key-only-a");
    }
  });

  it("combo isolation: tenant B cannot read tenant A's named combo (unless it's legacy/global)", async () => {
    const ctx = await freshContext();

    const tenantA = await ctx.createTenant("Tenant A");
    const tenantB = await ctx.createTenant("Tenant B");

    await ctx.createCombo({
      name: "shared-name-test-combo",
      kind: "custom",
      models: ["model-x"],
      tenantId: tenantA.id,
    });

    const foundByOwner = await ctx.getComboByName("shared-name-test-combo", tenantA.id);
    const foundByOther = await ctx.getComboByName("shared-name-test-combo", tenantB.id);

    expect(foundByOwner).not.toBeNull();
    expect(foundByOwner.tenantId).toBe(tenantA.id);
    // Tenant B must not see tenant A's tenant-scoped combo.
    expect(foundByOther).toBeNull();

    // But a legacy/global combo (tenantId: null) must be visible to both.
    await ctx.createCombo({
      name: "legacy-global-combo",
      kind: "custom",
      models: ["model-y"],
      tenantId: null,
    });
    const globalSeenByA = await ctx.getComboByName("legacy-global-combo", tenantA.id);
    const globalSeenByB = await ctx.getComboByName("legacy-global-combo", tenantB.id);
    expect(globalSeenByA).not.toBeNull();
    expect(globalSeenByB).not.toBeNull();
  });

  it("backward compatibility: omitting tenantId entirely keeps pre-patch 'sees everything' behavior", async () => {
    const ctx = await freshContext();

    const tenantA = await ctx.createTenant("Tenant A");
    const tenantB = await ctx.createTenant("Tenant B");

    await ctx.createProviderConnection({
      provider: "gemini",
      authType: "apikey",
      name: "Gemini A",
      email: "tenant-a@fake.test",
      apiKey: "fake-key-tenant-a",
      tenantId: tenantA.id,
    });
    await ctx.createProviderConnection({
      provider: "gemini",
      authType: "apikey",
      name: "Gemini B",
      email: "tenant-b@fake.test",
      apiKey: "fake-key-tenant-b",
      tenantId: tenantB.id,
    });

    // No options.tenantId passed at all — legacy caller path.
    const creds = await ctx.getProviderCredentials("gemini", null, null, {});
    expect(creds).not.toBeNull();
    // Either connection is acceptable (unfiltered pool, priority/strategy decides),
    // but it must not fail/return null just because tenantId was omitted.
    expect(["fake-key-tenant-a", "fake-key-tenant-b"]).toContain(creds.apiKey);

    // Same for combos: no tenantId filter → sees the tenant-scoped combo too.
    await ctx.createCombo({
      name: "combo-visible-to-legacy-caller",
      kind: "custom",
      models: ["model-z"],
      tenantId: tenantA.id,
    });
    const legacyLookup = await ctx.getComboByName("combo-visible-to-legacy-caller");
    expect(legacyLookup).not.toBeNull();
    expect(legacyLookup.tenantId).toBe(tenantA.id);
  });
});
