"""G-11: isolamento E2E adversarial do gateway multi-tenant (modo estrito).
N tenants (2 ou 5) com provedores/combos de MESMO nome; 1 mock de modelo por tenant (g-mock-<i>, rede g-net).
Uso: G_URL=http://127.0.0.1:22140 G_GW_CONTAINER=g-gw python g11_isolamento.py <N> [simultaneas_por_tenant=200]
Saida: linhas 'RESULT <id> <PASS|FAIL> <detalhe>' e JSON final; exit 1 se algum FAIL."""
import asyncio, json, subprocess, sys, time, secrets
import aiohttp
import httpx
from gcommon import Gw, chat, short, URL

N = int(sys.argv[1]) if len(sys.argv) > 1 else 2
PER = int(sys.argv[2]) if len(sys.argv) > 2 else 200
GW_CONTAINER = __import__("os").environ.get("G_GW_CONTAINER", "g-gw")
g = Gw()
R = []


def rec(item, ok, detail=""):
    R.append({"item": item, "result": "PASS" if ok else "FAIL", "detail": detail})
    print(f"RESULT {item} {'PASS' if ok else 'FAIL'} {detail}")
    sys.stdout.flush()


def mock_total(i):
    out = subprocess.run(["docker", "run", "--rm", "--network", "g-net", "g-mock:local", "python", "-c",
                          f"import urllib.request;print(urllib.request.urlopen('http://g-mock-{i}:9000/stats').read().decode())"],
                         capture_output=True, text=True, timeout=60).stdout
    return json.loads(out)


def mock_reset(i):
    subprocess.run(["docker", "run", "--rm", "--network", "g-net", "g-mock:local", "python", "-c",
                    f"import urllib.request;urllib.request.urlopen(urllib.request.Request('http://g-mock-{i}:9000/reset',method='POST'))"],
                   capture_output=True, text=True, timeout=60)


# ---------------- montagem: N tenants, mesmos nomes ----------------
T, CONN, FREE, RES, UP, NODE, OAUTH = {}, {}, {}, {}, {}, {}, {}
for i in range(1, N + 1):
    T[i] = g.tenant(f"Iso {i}")
    UP[i] = f"up-{i}-{secrets.token_hex(6)}"
    NODE[i] = g.node(T[i], "same", f"http://g-mock-{i}:9000/v1")           # MESMO prefixo em todos
    CONN[i] = g.conn(T[i], NODE[i], UP[i], name="mesmo-nome")               # MESMO nome de conexao
    assert g.combo(T[i], "main", ["same/m1"]).status_code == 201            # MESMO nome de combo
    assert g.combo(T[i], "fast", ["same/m2"]).status_code == 201
    assert g.combo(T[i], f"only-{i}", ["same/m3"]).status_code == 201
    FREE[i] = g.key(T[i], "livre")["key"]
    RES[i] = g.key(T[i], "restrita", allowed=["main"])["key"]
for i in range(1, N + 1):
    mock_reset(i)
rec("00.montagem", True, f"{N} tenants, provedor/combo/conexao com o mesmo nome; 1 mock por tenant")

# ---------------- 1. cada chave so alcanca o mock do proprio tenant ----------------
ok = True
detail = []
for i in range(1, N + 1):
    for key in (FREE[i], RES[i]):
        for model in ("main", "same/m1" if key == FREE[i] else "main"):
            r = chat(key, model)
            good = r.status_code == 200 and f"mock={i} " in r.text and UP[i] in r.text
            ok &= good
            if not good:
                detail.append(f"t{i} {model}: {short(r)}")
rec("01.chave->mock proprio (mesmo nome de combo/prefixo)", ok, "; ".join(detail)[:300])

# ---------------- 2. ataques com a chave de i contra j ----------------
attacks_ok = True
bad = []
for i in range(1, N + 1):
    j = i % N + 1
    forged = [
        ("combo exclusivo do outro", FREE[i], f"only-{j}", {}, {}),
        ("combo exclusivo + fallbacks", FREE[i], "main", {"fallbacks": [f"only-{j}"], "models": [f"only-{j}"]}, {}),
        ("corpo tenantId/api_base/connectionId", FREE[i], "main", {"tenantId": T[j], "tenant_id": T[j], "api_base": f"http://g-mock-{j}:9000/v1", "connectionId": CONN[j]}, {}),
        ("header x-tenant-id", FREE[i], "main", {}, {"x-tenant-id": T[j]}),
        ("header x-connection-id", FREE[i], "main", {}, {"x-connection-id": CONN[j]}),
        ("header x-forwarded/x-9r", FREE[i], "main", {}, {"x-forwarded-for": "127.0.0.1", "x-9r-real-ip": "127.0.0.1", "x-admin-token": "x" * 40}),
        ("restrita -> fast (do proprio tenant)", RES[i], "fast", {}, {}),
        ("restrita -> same/m1 direto", RES[i], "same/m1", {}, {}),
        ("restrita -> combo do outro", RES[i], f"only-{j}", {}, {}),
        ("caixa MAIN", RES[i], "MAIN", {}, {}),
        ("espaco ' main'", RES[i], " main", {}, {}),
        ("restrita + fallbacks no corpo", RES[i], "main", {"fallbacks": ["fast"], "models": ["fast"]}, {}),
    ]
    for label, key, model, extra, hdr in forged:
        r = chat(key, model, extra=extra, headers=hdr)
        text = r.text
        leaked = f"mock={j} " in text or UP[j] in text
        # esperado: ou 4xx, ou 200 servido pelo PROPRIO mock (mock=i) com o modelo do proprio combo
        served_own = r.status_code == 200 and f"mock={i} " in text
        if label.startswith("restrita ->") or label in ("caixa MAIN", "espaco ' main'"):
            good = r.status_code in (403, 404) and not leaked
        elif label == "combo exclusivo do outro":
            good = r.status_code >= 400 and not leaked
        else:
            good = (served_own or r.status_code >= 400) and not leaked
        # "restrita + fallbacks": tem de continuar em main (m1), nunca em fast (m2)
        if label == "restrita + fallbacks no corpo":
            good = r.status_code == 200 and "model=m1" in text.replace('"model":"m1"', "model=m1") and "m2" not in text
        if label == "corpo tenantId/api_base/connectionId":
            good = good and (UP[i] in text or r.status_code >= 400)
        attacks_ok &= good
        if not good:
            bad.append(f"t{i}->t{j} {label}: {short(r, 90)}")
    # chave na query / x-api-key
    r = httpx.post(URL + "/v1/chat/completions", params={"key": FREE[i]}, json={"model": f"only-{j}", "messages": [{"role": "user", "content": "x"}]}, timeout=30)
    if r.status_code < 400 or f"mock={j} " in r.text:
        attacks_ok = False; bad.append(f"t{i} ?key= only-{j}: {short(r, 80)}")
    r = httpx.post(URL + "/v1/chat/completions", headers={"x-api-key": FREE[i]}, json={"model": f"only-{j}", "messages": [{"role": "user", "content": "x"}]}, timeout=30)
    if r.status_code < 400 or f"mock={j} " in r.text:
        attacks_ok = False; bad.append(f"t{i} x-api-key only-{j}: {short(r, 80)}")
rec("02.ataques de modelo/combo/corpo/header (chave i -> tenant j)", attacks_ok, "; ".join(bad)[:500])

# ---------------- 3. /v1/models por chave ----------------
ok = True
detail = []
for i in range(1, N + 1):
    ids = [m["id"] for m in httpx.get(URL + "/v1/models", headers={"Authorization": f"Bearer {FREE[i]}"}, timeout=30).json()["data"]]
    rids = sorted(m["id"] for m in httpx.get(URL + "/v1/models", headers={"Authorization": f"Bearer {RES[i]}"}, timeout=30).json()["data"])
    foreign = [x for x in ids if x.startswith("only-") and x != f"only-{i}"]
    good = not foreign and f"only-{i}" in ids and rids == ["main"]
    ok &= good
    if not good:
        detail.append(f"t{i}: foreign={foreign} restrita={rids}")
rec("03./v1/models so com os ids do proprio tenant (restrita so 'main')", ok, "; ".join(detail))

# ---------------- 4. API de gerenciamento ----------------
ok = True
detail = []
for i in range(1, N + 1):
    j = i % N + 1
    for path, key in (("/api/providers", "connections"), ("/api/combos", "combos"), ("/api/keys", "keys"), ("/api/provider-nodes", "nodes")):
        items = g.req("GET", path, T[i]).json()[key]
        if any(x.get("tenantId") not in (T[i], None) for x in items) or (path != "/api/provider-nodes" and not items):
            ok = False; detail.append(f"lista {path} t{i}")
    foreign_combo = [c["id"] for c in g.req("GET", "/api/combos", T[j]).json()["combos"]][0]
    foreign_key = [k["id"] for k in g.req("GET", "/api/keys", T[j]).json()["keys"]][0]
    checks = [
        ("GET", f"/api/providers/{CONN[j]}"), ("PUT", f"/api/providers/{CONN[j]}"), ("DELETE", f"/api/providers/{CONN[j]}"),
        ("POST", f"/api/providers/{CONN[j]}/test"), ("GET", f"/api/providers/{CONN[j]}/models"), ("GET", f"/api/usage/{CONN[j]}"),
        ("GET", f"/api/combos/{foreign_combo}"), ("PUT", f"/api/combos/{foreign_combo}"), ("DELETE", f"/api/combos/{foreign_combo}"),
        ("GET", f"/api/keys/{foreign_key}"), ("PUT", f"/api/keys/{foreign_key}"), ("DELETE", f"/api/keys/{foreign_key}"),
        ("PUT", f"/api/provider-nodes/{NODE[j]}"), ("DELETE", f"/api/provider-nodes/{NODE[j]}"),
    ]
    for m, p in checks:
        r = g.req(m, p, T[i], json_body={"name": "x", "isActive": False} if m == "PUT" else None)
        if r.status_code != 404:
            ok = False; detail.append(f"t{i} {m} {p[:40]} -> {r.status_code}")
    # uso/log/resumo de outro tenant
    for p in (f"/api/tenants/{T[j]}/usage", f"/api/tenants/{T[j]}/requests", f"/api/tenants/{T[j]}/summary"):
        r = g.req("GET", p, T[i])
        if r.status_code != 403:
            ok = False; detail.append(f"t{i} GET {p[-30:]} -> {r.status_code}")
    # criar conexao no no do outro tenant
    r = g.req("POST", "/api/providers", T[i], {"provider": NODE[j], "name": "x", "apiKey": "k"})
    if r.status_code != 404:
        ok = False; detail.append(f"t{i} conexao no no de t{j} -> {r.status_code}")
    # combo com provedor do outro / mover para o outro
    r = g.combo(T[i], "mix", ["same/m1", f"{NODE[j]}/m1"])
    r2 = g.req("PUT", f"/api/combos/{[c['id'] for c in g.req('GET', '/api/combos', T[i]).json()['combos']][0]}", T[i], {"tenantId": T[j]})
    still = all(c["tenantId"] == T[i] for c in g.req("GET", "/api/combos", T[i]).json()["combos"])
    if r.status_code == 201 or not still:
        ok = False; detail.append(f"t{i} combo cross-tenant criado/movido ({r.status_code}, still={still})")
    # allow-list com combo do outro
    r = g.req("POST", "/api/keys", T[i], {"name": "x", "allowedCombos": [f"only-{j}"]})
    if r.status_code != 400:
        ok = False; detail.append(f"t{i} allowedCombos de t{j} -> {r.status_code}")
# sem token / chave de tenant na API de gerenciamento / sem header
bare = httpx.get(URL + "/api/providers", headers={"x-tenant-id": T[1]}, timeout=30)
keyed = httpx.get(URL + "/api/providers", headers={"Authorization": f"Bearer {FREE[1]}", "x-tenant-id": T[1]}, timeout=30)
nohdr = g.req("GET", "/api/providers")
glob = [g.req("GET", p, T[1]).status_code for p in ("/api/settings", "/api/usage/stats", "/api/proxy-pools", "/api/models/alias", "/api/tenants")]
if bare.status_code != 401 or keyed.status_code != 401 or nohdr.status_code != 400 or any(c not in (403, 400) for c in glob[:4]):
    ok = False; detail.append(f"sem token={bare.status_code} chave-de-tenant={keyed.status_code} sem-header={nohdr.status_code} globais={glob}")
rec("04.API de gerenciamento: listas, ids cruzados, uso/log, combos/chaves/nos cruzados, sem token", ok, "; ".join(detail)[:600])

# ---------------- 5. OAuth por tenant ----------------
import base64
def jwt(p):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{b({'alg': 'none'})}.{b(p)}.sig"
ok = True
detail = []
for i in range(1, N + 1):
    r = g.req("POST", "/api/oauth/codex/import-token", T[i], {"accessToken": jwt({"email": f"t{i}@x.com", "account_id": f"acc{i}", "plan_type": "plus"}), "refreshToken": f"rt-{i}"})
    if r.status_code != 200:
        ok = False; detail.append(f"import t{i}: {short(r, 80)}")
    else:
        OAUTH[i] = r.json()["connection"]["id"]
r = httpx.post(URL + "/api/oauth/codex/import-token", headers={"x-admin-token": g.token}, json={"accessToken": jwt({"email": "x@x.com"})}, timeout=30)
if r.status_code != 400:
    ok = False; detail.append(f"import sem x-tenant-id -> {r.status_code}")
for i in range(1, N + 1):
    own = [c for c in g.req("GET", "/api/providers", T[i]).json()["connections"] if c["authType"] in ("oauth", "access_token")]
    if [c["id"] for c in own] != [OAUTH[i]]:
        ok = False; detail.append(f"t{i} ve {len(own)} oauth")
    for j in range(1, N + 1):
        if j != i and g.req("GET", f"/api/usage/{OAUTH[j]}", T[i]).status_code != 404:
            ok = False; detail.append(f"t{i} le cota oauth de t{j}")
rec("05.OAuth (import por tenant): cada tenant so ve a propria conexao; header obrigatorio", ok, "; ".join(detail)[:300])

# ---------------- 6. uso por tenant: contagem exata ----------------
time.sleep(1.5)
ok = True
detail = []
for i in range(1, N + 1):
    u = g.req("GET", f"/api/tenants/{T[i]}/usage", T[i]).json()
    sent = mock_total(i).get("total", 0)
    if u["requests"] != sent:
        ok = False; detail.append(f"t{i}: gateway={u['requests']} mock={sent}")
    if any((c.get("combo") or "").startswith("only-") and c["combo"] != f"only-{i}" for c in u["byCombo"]):
        ok = False; detail.append(f"t{i}: combo alheio no uso")
rec("06.uso por tenant bate com o que o mock do tenant recebeu (fase de ataques)", ok, "; ".join(detail))

# ---------------- 7. carga: PER simultaneas por tenant ----------------
for i in range(1, N + 1):
    mock_reset(i)


async def one(session, i, idx, stream):
    t0 = time.time()
    try:
        async with session.post(URL + "/v1/chat/completions", headers={"Authorization": f"Bearer {FREE[i]}"},
                                json={"model": "main", "messages": [{"role": "user", "content": f"c{idx}"}], "stream": stream}) as r:
            body = await r.text()
            return i, r.status, body, time.time() - t0
    except Exception as e:  # noqa
        return i, 0, str(e), time.time() - t0


async def load():
    conn = aiohttp.TCPConnector(limit=0)
    async with aiohttp.ClientSession(connector=conn, timeout=aiohttp.ClientTimeout(total=300)) as s:
        tasks = [one(s, i, k, k % 2 == 0) for i in range(1, N + 1) for k in range(PER)]
        t0 = time.time()
        res = await asyncio.gather(*tasks)
        return res, time.time() - t0

res, wall = asyncio.run(load())
errs = [r for r in res if r[1] != 200]
cross = [r for r in res if r[1] == 200 and (f"mock={r[0]} " not in r[2] or UP[r[0]] not in r[2])]
lat = sorted(r[3] for r in res)
p95 = lat[int(len(lat) * 0.95) - 1]
peaks = [mock_total(i) for i in range(1, N + 1)]
per_mock = [p.get("total", 0) for p in peaks]
ok = not errs and not cross and all(c == PER for c in per_mock)
rec(f"07.carga {N}x{PER}={N * PER} simultaneas", ok,
    f"erros={len(errs)} cruzamentos={len(cross)} mock_recebeu={per_mock} pico_em_voo={[p.get('peak') for p in peaks]} total={wall:.1f}s rps={N * PER / wall:.0f} p95={p95:.1f}s")

# ---------------- 8. varredura de logs e segredos ----------------
logs = subprocess.run(["docker", "logs", GW_CONTAINER], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
text = logs.stdout + logs.stderr
leaks = [k for k in list(UP.values()) + list(FREE.values()) + list(RES.values()) if k in text]
rec("08.varredura de logs do gateway: nenhuma chave de provedor nem chave de tenant em claro", not leaks, f"achados={len(leaks)} de {len(UP) + len(FREE) + len(RES)} segredos; linhas={len(text.splitlines())}")
api_leak = []
for i in range(1, N + 1):
    blob = json.dumps([g.req("GET", p, T[i]).json() for p in ("/api/providers", "/api/keys", "/api/combos", "/api/provider-nodes")]) + json.dumps(g.req("GET", f"/api/tenants/{T[i]}/requests", T[i]).json()) + json.dumps(g.req("GET", f"/api/tenants/{T[i]}/usage", T[i]).json())
    for k in list(UP.values()) + list(FREE.values()) + list(RES.values()):
        if k in blob:
            api_leak.append(f"t{i} ve segredo")
    for j in range(1, N + 1):
        if j != i and (T[j] in blob or CONN[j] in blob or NODE[j] in blob):
            api_leak.append(f"t{i} ve id de t{j}")
rec("09.varredura das respostas da API: sem segredos em claro e sem ids de outro tenant", not api_leak, "; ".join(api_leak)[:300])

print("JSON", json.dumps(R))
sys.exit(1 if any(x["result"] == "FAIL" for x in R) else 0)
