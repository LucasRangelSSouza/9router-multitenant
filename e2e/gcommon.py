"""Helpers dos testes do gateway (fork 9router-multitenant). Segredos so via ambiente/arquivo local (.admin_token, fora do git)."""
import os, json, httpx, uuid, time, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get("G_URL", "http://127.0.0.1:22140")


def _token():
    t = os.environ.get("G_ADMIN_TOKEN")
    if t:
        return t
    return open(os.path.join(HERE, ".admin_token")).read().strip()


class Gw:
    """Cliente do plano de gerenciamento com o token de servico (o que o BFF faria)."""

    def __init__(self, url=None, token=None, timeout=60):
        self.url = url or URL
        self.c = httpx.Client(base_url=self.url, timeout=timeout)
        self.token = token or _token()

    def req(self, method, path, tenant=None, json_body=None, params=None, headers=None):
        h = {"x-admin-token": self.token}
        if tenant:
            h["x-tenant-id"] = tenant
        h.update(headers or {})
        return self.c.request(method, path, headers=h, json=json_body, params=params)

    def tenant(self, name=None, tid=None, **kw):
        tid = tid or ("t" + uuid.uuid4().hex[:15])
        r = self.req("POST", "/api/tenants", json_body={"name": name or tid, "id": tid, **kw})
        assert r.status_code in (200, 201), (r.status_code, r.text)
        return r.json()["tenant"]["id"]

    def node(self, tenant, prefix, base):
        r = self.req("POST", "/api/provider-nodes", tenant, {"name": f"node-{prefix}", "prefix": prefix, "apiType": "chat", "baseUrl": base, "type": "openai-compatible"})
        assert r.status_code == 201, (r.status_code, r.text)
        return r.json()["node"]["id"]

    def conn(self, tenant, provider, apikey, name="conn"):
        r = self.req("POST", "/api/providers", tenant, {"provider": provider, "name": name, "apiKey": apikey, "priority": 1})
        assert r.status_code == 201, (r.status_code, r.text)
        return r.json()["connection"]["id"]

    def combo(self, tenant, name, models, **kw):
        return self.req("POST", "/api/combos", tenant, {"name": name, "models": models, **kw})

    def key(self, tenant, name="k", allowed=None):
        body = {"name": name}
        if allowed is not None:
            body["allowedCombos"] = allowed
        r = self.req("POST", "/api/keys", tenant, body)
        assert r.status_code == 201, (r.status_code, r.text)
        return r.json()


def chat(key, model, base=None, extra=None, headers=None, params=None, timeout=60, stream=False):
    h = {"Authorization": f"Bearer {key}"} if key else {}
    h.update(headers or {})
    b = {"model": model, "messages": [{"role": "user", "content": "oi"}], "stream": stream}
    b.update(extra or {})
    return httpx.post((base or URL) + "/v1/chat/completions", headers=h, json=b, params=params, timeout=timeout)


def short(r, n=110):
    return f"{r.status_code} {r.text[:n]!r}".replace("\n", " ")


def mock_stats(i):
    out = subprocess.run(["docker", "run", "--rm", "--network", "g-net", "g-mock:local", "python", "-c",
                          f"import urllib.request;print(urllib.request.urlopen('http://g-mock-{i}:9000/stats').read().decode())"],
                         capture_output=True, text=True, timeout=60).stdout
    return json.loads(out)
