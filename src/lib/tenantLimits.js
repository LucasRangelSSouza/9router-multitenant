// Limite de requisicoes por minuto por tenant (janela deslizante em memoria).
// Escopo: 1 processo. Com varias replicas o limite vale por replica (ver docs).
import { getTenantById } from "@/lib/localDb";

const TTL_MS = 5000;
const cfg = new Map();   // tenantId -> { rpm, at }
const hits = new Map();  // tenantId -> number[] (timestamps ms)

async function rpmOf(tenantId) {
  const c = cfg.get(tenantId);
  const now = Date.now();
  if (c && now - c.at < TTL_MS) return c.rpm;
  let rpm = null;
  try { rpm = (await getTenantById(tenantId))?.rpm ?? null; } catch { /* sem limite em caso de erro de leitura */ }
  cfg.set(tenantId, { rpm, at: now });
  return rpm;
}

export function invalidateTenantLimit(tenantId) { cfg.delete(tenantId); }

// Retorna { ok: true } ou { ok: false, retryAfterSec, limit }.
export async function checkTenantRpm(tenantId) {
  if (!tenantId) return { ok: true };
  const limit = await rpmOf(tenantId);
  if (!limit) return { ok: true };
  const now = Date.now();
  let arr = hits.get(tenantId);
  if (!arr) { arr = []; hits.set(tenantId, arr); }
  const cutoff = now - 60000;
  while (arr.length && arr[0] <= cutoff) arr.shift();
  if (arr.length >= limit) {
    return { ok: false, limit, retryAfterSec: Math.max(1, Math.ceil((arr[0] + 60000 - now) / 1000)) };
  }
  arr.push(now);
  return { ok: true, limit };
}

// Estado atual da janela de RPM deste processo (para a tela de cotas).
export function tenantRpmState(tenantId, limit) {
  const arr = hits.get(tenantId) || [];
  const cutoff = Date.now() - 60000;
  return { limit: limit ?? null, usedLastMinute: arr.filter((t) => t > cutoff).length };
}
