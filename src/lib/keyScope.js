import { getCombos } from "@/lib/localDb";

// Valida a allow-list de uma chave: array de nomes de combos que EXISTEM no proprio tenant.
export async function validateAllowedCombos(tenantId, allowed) {
  if (allowed === undefined || allowed === null) return { value: null };
  if (!Array.isArray(allowed) || allowed.some((x) => typeof x !== "string" || !x)) return { error: "allowedCombos must be an array of combo names or null" };
  const own = new Set((await getCombos(tenantId)).map((c) => c.name));
  const foreign = allowed.filter((n) => !own.has(n));
  if (foreign.length) return { error: `combos not found in this tenant: ${foreign.join(", ")}` };
  return { value: [...new Set(allowed)] };
}

const STRATEGIES = new Set(["fallback", "round-robin", "fusion"]);

// Estrategia do combo (guardada no proprio combo): { fallbackStrategy, judgeModel?, fusionTuning? }.
export function validateComboStrategy(strategy) {
  if (strategy === undefined || strategy === null) return { value: null };
  if (typeof strategy !== "object" || Array.isArray(strategy)) return { error: "strategy must be an object or null" };
  const out = {};
  if (strategy.fallbackStrategy !== undefined) {
    if (!STRATEGIES.has(strategy.fallbackStrategy)) return { error: "strategy.fallbackStrategy must be fallback, round-robin or fusion" };
    out.fallbackStrategy = strategy.fallbackStrategy;
  }
  if (strategy.judgeModel !== undefined) {
    if (typeof strategy.judgeModel !== "string") return { error: "strategy.judgeModel must be a string" };
    out.judgeModel = strategy.judgeModel;
  }
  if (strategy.fusionTuning !== undefined) {
    if (typeof strategy.fusionTuning !== "object" || strategy.fusionTuning === null) return { error: "strategy.fusionTuning must be an object" };
    out.fusionTuning = strategy.fusionTuning;
  }
  return { value: out };
}

// Um combo so pode apontar para provedores que o PROPRIO tenant tem (ou para outro
// combo do mesmo tenant). Vale no gateway; o BFF do Luar valida tambem.
export async function validateComboModels(tenantId, models, selfName = null) {
  if (!Array.isArray(models)) return { error: "models must be an array" };
  if (!tenantId) return { value: models };   // legado sem tenant (nao estrito)
  const { getProviderConnections, getCombos } = await import("@/lib/localDb");
  const { getModelInfo } = await import("@/sse/services/model.js");
  const conns = await getProviderConnections({ tenantId });
  const providers = new Set(conns.map((c) => c.provider));
  const combos = new Set((await getCombos(tenantId)).map((c) => c.name));
  for (const m of models) {
    if (typeof m !== "string" || !m.trim()) return { error: "each model must be a non-empty string" };
    if (!m.includes("/")) {
      if (m === selfName) return { error: `combo cannot reference itself: ${m}` };
      if (!combos.has(m)) return { error: `unknown combo or alias in this tenant: ${m}` };
      continue;
    }
    const info = await getModelInfo(m, tenantId);
    if (!info?.provider || !providers.has(info.provider)) {
      return { error: `provider of "${m}" is not configured in this tenant` };
    }
  }
  return { value: models };
}
