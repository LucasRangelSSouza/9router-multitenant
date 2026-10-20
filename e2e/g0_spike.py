"""G-0: prova (a) allow-list de chave, (b) API de gerenciamento por tenant, (c) OAuth remoto, (d) cota, (e) uso.
Uso: G_URL=... python g0_spike.py  -> imprime linhas 'RESULT <item> <PASS|FAIL|GAP|INFO> <detalhe>' e um JSON final."""
import json, sys, time, base64
import httpx
from gcommon import *

g = Gw()
URLB = g.url
R = []


def rec(item, ok, detail):
    R.append({"item": item, "result": ok, "detail": detail})
    print(f"RESULT {item} {ok} {detail}")
    sys.stdout.flush()


def P(cond, fail="FAIL"):
    return "PASS" if cond else fail


A = g.tenant("Spike A")
B = g.tenant("Spike B")
nA = g.node(A, "pa", "http://g-mock-1:9000/v1")
nB = g.node(B, "pb", "http://g-mock-2:9000/v1")
cA = g.conn(A, nA, "up-A")
cB = g.conn(B, nB, "up-B")
r1 = g.combo(A, "c1", ["pa/m1"])
r2 = g.combo(A, "c2", ["pa/m2"])
rb = g.combo(B, "c1", ["pb/m1"])
rec("setup.combos", P(r1.status_code == 201 and r2.status_code == 201 and rb.status_code == 201), f"A:c1={r1.status_code} c2={r2.status_code} B:c1={rb.status_code}")

# ---------- (a) allow-list ----------
kfree = g.key(A, "livre")
kres = g.key(A, "restrita", allowed=["c1"])
rec("a.0 api aceita allowedCombos", P(kres.get("allowedCombos") == ["c1"], "GAP"), f"resposta={ {k: v for k, v in kres.items() if k != 'key'} }")
ok1 = chat(kres["key"], "c1")
rec("a.1 restrita -> combo permitido", P(ok1.status_code == 200), short(ok1))
bad = chat(kres["key"], "c2")
rec("a.2 restrita -> outro combo do proprio tenant", P(bad.status_code == 403, "GAP"), short(bad))
dire = chat(kres["key"], "pa/m1")
rec("a.3 restrita -> provider/model direto", P(dire.status_code == 403, "GAP"), short(dire))
fb = chat(kres["key"], "c1", extra={"fallbacks": ["c2"], "models": ["c2"], "tenantId": B})
rec("a.4 fallbacks/models/tenantId forjados no corpo (continua c1 no mock 1)", P(fb.status_code == 200 and "mock=1" in fb.text and "model=pa" not in fb.text and "m2" not in fb.text), short(fb))
hdr = chat(kres["key"], "c2", headers={"x-tenant-id": A, "x-api-key": kfree["key"]})
rec("a.5 header forjado x-tenant-id/x-api-key (c2 continua negado)", P(hdr.status_code == 403, "GAP"), short(hdr))
cross = chat(kres["key"], "c1", headers={"x-tenant-id": B})
rec("a.6 header x-tenant-id=B nao desvia para o tenant B", P(cross.status_code == 200 and "mock=1" in cross.text), short(cross))
lst = httpx.get(URLB + "/v1/models", headers={"Authorization": f"Bearer {kres['key']}"}).json()
ids = sorted(m["id"] for m in lst["data"])
rec("a.7 /v1/models da chave restrita lista so o permitido", P(ids == ["c1"], "GAP"), f"ids={ids[:8]}")
free = chat(kfree["key"], "c2")
rec("a.8 chave livre -> qualquer combo do proprio tenant", P(free.status_code == 200), short(free))
xt = chat(kfree["key"], "pb/m1")
rec("a.9 chave de A -> provedor de B (pb/m1)", P(xt.status_code >= 400 and "mock=2" not in xt.text), short(xt))

# ---------- (b) API de gerenciamento por tenant ----------
s = lambda r: r.status_code
lp = g.req("GET", "/api/providers", A).json()["connections"]
rec("b.1 GET /api/providers (A) so lista as de A", P([c["id"] for c in lp] == [cA]), f"n={len(lp)}")
no_hdr = g.req("GET", "/api/providers")
rec("b.2 token de servico sem x-tenant-id e recusado", P(s(no_hdr) == 400, "GAP"), short(no_hdr))
glob = g.req("GET", "/api/settings", A)
rec("b.3 token de servico nao alcanca /api/settings (global)", P(s(glob) == 403, "GAP"), short(glob))
glob2 = g.req("GET", "/api/usage/stats", A)
rec("b.4 token de servico nao alcanca /api/usage/stats (global)", P(s(glob2) == 403, "GAP"), short(glob2))
xconn = g.req("GET", f"/api/providers/{cB}", A)
rec("b.5 A le conexao de B por id", P(s(xconn) == 404, "GAP"), short(xconn))
xdel = g.req("DELETE", f"/api/providers/{cB}", A)
rec("b.6 A apaga conexao de B por id", P(s(xdel) == 404, "GAP"), short(xdel))
lc = g.req("GET", "/api/combos", A).json()["combos"]
rec("b.7 combos de A so de A", P(sorted(c["name"] for c in lc) == ["c1", "c2"] and all(c["tenantId"] == A for c in lc)), f"{[c['name'] for c in lc]}")
bad_combo = g.combo(A, "mix", ["pb/m1"])
rec("b.8 combo de A com provedor de B e negado", P(s(bad_combo) == 400, "GAP"), short(bad_combo))
g.req("PUT", f"/api/combos/{lc[0]['id']}", A, {"tenantId": B})
lcB = g.req("GET", "/api/combos", B).json()["combos"]
rec("b.9 PUT combo com tenantId=B nao move o combo", P(all(c["tenantId"] == B for c in lcB) and len(lcB) == 1, "GAP"), f"B tem {[c['name'] for c in lcB]}")
nodes = g.req("GET", "/api/provider-nodes", A).json()["nodes"]
rec("b.10 provider-nodes (A) so de A", P([n["id"] for n in nodes] == [nA], "GAP"), f"n={len(nodes)}")
keys = g.req("GET", "/api/keys", A).json()["keys"]
rec("b.11 keys (A) so de A e segredo mascarado", P(all(k["tenantId"] == A and "***" in k["key"] for k in keys), "GAP"), f"n={len(keys)}")
rec("b.12 token errado", P(g.c.get("/api/providers", headers={"x-admin-token": "x" * 40, "x-tenant-id": A}).status_code == 401), "")
ssrf = g.req("POST", "/api/provider-nodes", A, {"name": "x", "prefix": "zz", "apiType": "chat", "baseUrl": "http://169.254.169.254/latest", "type": "openai-compatible"})
rec("b.13 SSRF: baseUrl metadata (so barra com MT_ALLOW_PRIVATE_URLS!=1)", "INFO", short(ssrf))

# ---------- (c) OAuth remoto ----------
for prov in ["codex", "claude", "gemini-cli"]:
    ra = g.req("GET", f"/api/oauth/{prov}/authorize", A, params={"redirect_uri": "https://luar.example.com/oauth/callback"})
    j = ra.json() if ra.status_code == 200 else {}
    rec(f"c.1 authorize {prov} com redirect_uri do Luar", P(ra.status_code == 200 and "luar.example.com" in json.dumps(j)), f"{ra.status_code} keys={list(j)[:6]}")
rd = g.req("GET", "/api/oauth/github/device-code", A)
jd = rd.json() if rd.status_code == 200 else {}
rec("c.2 device-code github (chama o provedor real)", P("user_code" in jd or "userCode" in jd, "INFO"), f"{rd.status_code} keys={list(jd)[:8] or rd.text[:100]}")
rx = g.req("POST", "/api/oauth/codex/exchange", A, {"code": "codigo-invalido", "redirectUri": "https://luar.example.com/oauth/callback", "codeVerifier": "v" * 50, "state": "s"})
rec("c.3 exchange com code invalido chega ao provedor e falha limpo", P(rx.status_code >= 400), short(rx))


def jwt(payload):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{b({'alg': 'none'})}.{b(payload)}.sig"


tok = jwt({"email": "a@x.com", "account_id": "acc-1", "plan_type": "plus"})
ri = g.req("POST", "/api/oauth/codex/import-token", A, {"accessToken": tok, "refreshToken": "rt-A"})
rec("c.4 import-token OAuth cria conexao DO TENANT A", P(ri.status_code in (200, 201)), short(ri))
oa = [c for c in g.req("GET", "/api/providers", A).json()["connections"] if c["authType"] in ("oauth", "access_token")]
ob = [c for c in g.req("GET", "/api/providers", B).json()["connections"] if c["authType"] in ("oauth", "access_token")]
rec("c.5 conexao OAuth de A invisivel para B", P(len(oa) >= 1 and len(ob) == 0), f"A={len(oa)} B={len(ob)}")

# ---------- (d) cotas ----------
if oa:
    rq = g.req("GET", f"/api/usage/{oa[0]['id']}", A)
    rec("d.1 cota por provedor OAuth: /api/usage/:connectionId (consulta o provedor; token falso => erro do provedor)", "INFO", short(rq))
    rq2 = g.req("GET", f"/api/usage/{oa[0]['id']}", B)
    rec("d.2 B consulta cota da conexao de A", P(rq2.status_code == 404, "GAP"), short(rq2))
rk = g.req("GET", f"/api/usage/{cA}", A)
rec("d.3 conexao por API key: cota do provedor nao se aplica", "INFO", short(rk))
sm = g.req("GET", f"/api/tenants/{A}/summary", A)
rec("d.4 /api/tenants/:id/summary (RPM, contagens)", P(sm.status_code == 200, "GAP"), short(sm, 200))
g.req("PATCH", f"/api/tenants/{A}", None, {"rpm": 4})
time.sleep(0.2)
codes = [chat(kfree["key"], "c1").status_code for _ in range(7)]
rec("d.5 cota RPM por tenant (rpm=4: 4x200 + 3x429)", P(codes.count(200) == 4 and codes.count(429) == 3), f"{codes}")
g.req("PATCH", f"/api/tenants/{A}", None, {"rpm": None})

# ---------- (e) uso ----------
time.sleep(1)
ua = g.req("GET", f"/api/tenants/{A}/usage", A)
ub = g.req("GET", f"/api/tenants/{B}/usage", B)
ja = ua.json() if ua.status_code == 200 else {}
jb = ub.json() if ub.status_code == 200 else {}
rec("e.1 uso do tenant A (requests/tokens)", P(ja.get("requests", 0) >= 5), f"req={ja.get('requests')} prompt={ja.get('promptTokens')} comp={ja.get('completionTokens')} chaves={list(ja)}")
rec("e.2 uso por combo/provedor/dia", P(bool(ja.get("byCombo") and ja.get("byDay") and ja.get("byProvider")), "GAP"), f"byCombo={ja.get('byCombo', [])[:3]}")
rec("e.3 uso de B isolado (0 req)", P(jb.get("requests") == 0), f"B req={jb.get('requests')}")
xu = g.req("GET", f"/api/tenants/{A}/usage", B)
rec("e.4 B pede uso de A (x-tenant-id=B)", P(xu.status_code == 403, "GAP"), short(xu))
lg = g.req("GET", f"/api/tenants/{A}/requests", A, params={"limit": 5})
rec("e.5 log de requisicoes do tenant", P(lg.status_code == 200 and bool(lg.json().get("requests")), "GAP"), short(lg, 160))
m2 = mock_stats(2)
rec("e.6 mock do tenant B recebeu 0 chamadas das chaves de A", P(m2.get("total", 0) == 0), f"mock2={m2.get('total')}")

# ---------- ciclo de vida (G-2) ----------
g.req("PATCH", f"/api/tenants/{B}", None, {"status": "suspended"})
kb = g.key(B, "kb")
rs = chat(kb["key"], "c1")
rec("g2.1 tenant suspenso => chave responde 403", P(rs.status_code == 403, "GAP"), short(rs))
g.req("PATCH", f"/api/tenants/{B}", None, {"status": "active"})
ra2 = chat(kb["key"], "c1")
rec("g2.2 retomado => 200", P(ra2.status_code == 200, "GAP"), short(ra2))
dl = g.req("DELETE", f"/api/tenants/{B}", None)
rd2 = chat(kb["key"], "c1")
rec("g2.3 offboarding (DELETE) apaga tudo e a chave morre", P(dl.status_code == 200 and rd2.status_code in (401, 403), "GAP"), f"{dl.text[:100]} chave={rd2.status_code}")
print("JSON", json.dumps(R))
