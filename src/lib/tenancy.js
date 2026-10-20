// Modo estrito de multi-tenant (MT_STRICT=1).
//
// Sem MT_STRICT o comportamento e o do patch original: linhas sem tenant
// (tenantId IS NULL) ficam visiveis a todos e chaves sem tenant enxergam tudo.
// Com MT_STRICT=1 a regra passa a ser fail-closed:
//   - chave sem tenant nao serve nenhuma requisicao /v1;
//   - conexao/combo sem dono nunca e visivel a um tenant;
//   - criar conexao/combo/chave sem tenantId e erro;
//   - /v1/models lista apenas o que e do tenant da chave.
export function isStrict() {
  const v = String(process.env.MT_STRICT || "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

// Tenant do contexto administrativo (UI/BFF). O BFF informa o tenant por header
// ou query; nunca confiar nisso em rotas /v1 (la vale so o tenant da chave).
export function tenantIdFromRequest(request, body = null) {
  try {
    const h = request?.headers?.get?.("x-tenant-id");
    if (h) return h;
    const q = new URL(request.url).searchParams.get("tenantId");
    if (q) return q;
  } catch { /* ignore */ }
  return body?.tenantId || null;
}

export function requireTenantOrThrow(tenantId, what) {
  if (isStrict() && !tenantId) {
    const e = new Error(`tenantId is required to create ${what} (MT_STRICT=1)`);
    e.code = "TENANT_REQUIRED";
    throw e;
  }
}

// Defesa em profundidade na API de gerenciamento: se o BFF informar o tenant
// (header x-tenant-id), o objeto acessado por id precisa pertencer a ele;
// caso contrario responde 404 (nao revela que existe em outro tenant).
export async function ownershipGuard(request, kind, id) {
  const tenantId = request?.headers?.get?.("x-tenant-id");
  if (!tenantId) return null;
  const { NextResponse } = await import("next/server");
  const db = await import("@/lib/localDb");
  const get = { connection: db.getProviderConnectionById, combo: db.getComboById, key: db.getApiKeyById, node: db.getProviderNodeById }[kind];
  const row = await get(id);
  if (!row || (row.tenantId ?? null) !== tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

// Chave do estado de rodizio de um combo: por tenant (dois tenants com combo
// "main" nao compartilham indice de round-robin).
export function comboRotationKey(tenantId, name) {
  return tenantId ? `${tenantId}/${name}` : name;
}

// Estrategia de combo por tenant. Em modo estrito a estrategia vive no proprio
// combo (combos.strategy) e a global settings.comboStrategies e ignorada.
export async function comboStrategiesFor(settings, tenantId) {
  if (!isStrict()) return settings.comboStrategies || {};
  const out = {};
  if (!tenantId) return out;
  const { getCombos } = await import("@/lib/localDb");
  for (const c of await getCombos(tenantId)) if (c.strategy) out[c.name] = c.strategy;
  return out;
}
