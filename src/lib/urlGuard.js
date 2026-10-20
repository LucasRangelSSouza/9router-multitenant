// Anti-SSRF para URLs que o tenant informa (baseUrl de no de provedor, proxy).
// O gateway roda numa rede com acesso a servicos internos; um tenant nao pode
// apontar um "provedor" para loopback, link-local/metadata, faixas privadas ou
// nomes de servico do Docker (hostname sem ponto). Desligavel so para testes
// locais com MT_ALLOW_PRIVATE_URLS=1 (o mock de modelo vive na rede privada).
// Defesa complementar obrigatoria: rede de egress do container (ver deploy/).
import net from "node:net";

function privateV4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function checkOutboundUrl(raw) {
  if (process.env.MT_ALLOW_PRIVATE_URLS === "1") return null;
  let u;
  try { u = new URL(String(raw).trim()); } catch { return "URL invalida"; }
  if (!["http:", "https:"].includes(u.protocol)) return "Somente http(s) e permitido";
  if (u.username || u.password) return "URL com credenciais nao e permitida";
  let host = u.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return "Host interno nao e permitido";
  const ver = net.isIP(host);
  if (ver === 4 && privateV4(host)) return "Endereco privado/reservado nao e permitido";
  if (ver === 6) {
    const h = host.replace(/^::ffff:/, "");
    if (net.isIP(h) === 4 && privateV4(h)) return "Endereco privado/reservado nao e permitido";
    if (/^(::1?|fe[89ab]|f[cd])/.test(host)) return "Endereco privado/reservado nao e permitido";
  }
  if (!ver && !host.includes(".")) return "Host sem dominio (nome de servico interno) nao e permitido";
  return null;
}

// providerSpecificData vem do tenant: qualquer campo que pareca URL/host/endpoint e
// validado como acima, e o provedor "ollama-local" (loopback por definicao) e recusado.
export function checkProviderSpecificData(provider, psd) {
  if (process.env.MT_ALLOW_PRIVATE_URLS === "1") return null;
  if (provider === "ollama-local") return "ollama-local is not available to tenants";
  if (!psd || typeof psd !== "object") return null;
  for (const [k, v] of Object.entries(psd)) {
    if (typeof v !== "string" || !v) continue;
    if (/url|host|endpoint/i.test(k) || /^https?:\/\//i.test(v)) {
      const bad = checkOutboundUrl(/^https?:\/\//i.test(v) ? v : `https://${v}`);
      if (bad) return `${k}: ${bad}`;
    }
  }
  return null;
}
