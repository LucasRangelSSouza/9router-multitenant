// Portao de acesso das rotas /v1: chave ativa, vinculada a tenant ativo e,
// se a chave for restrita, modelo dentro da allow-list de combos.
//
// keyAuth = { isActive, tenantId, tenantStatus, allowedCombos } (ver apiKeysRepo.getApiKeyAuth)
// allowedCombos: null = chave livre (todos os combos do proprio tenant);
//                array = restrita (so esses combos, comparacao exata; array vazio = nada).
import { isStrict } from "./tenancy.js";

export function gateDecision(keyAuth, model, { requireModel = true } = {}) {
  if (isStrict()) {
    if (!keyAuth || !keyAuth.isActive) return { status: 401, message: "Invalid API key" };
    if (!keyAuth.tenantId) return { status: 403, message: "API key is not bound to a tenant" };
  }
  if (keyAuth?.tenantId && keyAuth.tenantStatus && keyAuth.tenantStatus !== "active") {
    return { status: 403, message: "Tenant suspended" };
  }
  const allow = keyAuth?.allowedCombos;
  if (Array.isArray(allow)) {
    if (!requireModel) return { status: 403, message: "API key is restricted to specific combos; endpoint not available" };
    if (typeof model !== "string" || !allow.includes(model)) {
      return { status: 403, message: "Model not allowed for this API key" };
    }
  }
  return null;
}

// Versao com Response para os handlers do /v1 (errorResponse do open-sse).
export async function gateResponse(keyAuth, model, opts) {
  const d = gateDecision(keyAuth, model, opts);
  if (!d) return null;
  const { errorResponse } = await import("open-sse/utils/error.js");
  return errorResponse(d.status, d.message);
}
