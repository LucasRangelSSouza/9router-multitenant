"""Gerador de carga assincrono. Uso: loadgen.py URL KEY MODEL N [--stream] [--conc N] [--timeout S]
Dispara N requisicoes ao mesmo tempo (todas na largada), mede latencia total e TTFB."""
import argparse, asyncio, json, statistics, time, collections
import aiohttp

async def one(sess, url, key, model, stream, timeout, extra_headers):
    t0 = time.perf_counter()
    try:
        async with sess.post(url, json={"model": model, "stream": stream, "messages": [{"role": "user", "content": "oi"}]},
                             headers={"Authorization": f"Bearer {key}", **extra_headers}, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            first = None
            if stream:
                body = b""
                async for chunk in r.content.iter_any():
                    if first is None:
                        first = time.perf_counter() - t0
                    body += chunk
                ok = r.status == 200 and b"[DONE]" in body
                txt = body.decode(errors="replace")
            else:
                txt = await r.text(); first = time.perf_counter() - t0
                ok = r.status == 200
            return {"ok": ok, "status": r.status, "lat": time.perf_counter() - t0, "ttfb": first, "text": txt[:300], "mock": r.headers.get("x-mock-id")}
    except Exception as e:
        return {"ok": False, "status": -1, "lat": time.perf_counter() - t0, "ttfb": None, "text": f"{type(e).__name__}:{e}"[:200], "mock": None}

def pct(xs, p):
    xs = sorted(xs); 
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else float("nan")

async def run(a):
    conn = aiohttp.TCPConnector(limit=0, force_close=False)
    hdr = dict(h.split("=", 1) for h in (a.header or []))
    async with aiohttp.ClientSession(connector=conn) as sess:
        t0 = time.perf_counter()
        if a.rate:
            tasks = []; n = int(a.rate * a.duration); st = time.perf_counter()
            for i in range(n):
                tgt = st + i / a.rate
                await asyncio.sleep(max(0, tgt - time.perf_counter()))
                tasks.append(asyncio.create_task(one(sess, a.url, a.key, a.model, a.stream, a.timeout, hdr)))
            res = await asyncio.gather(*tasks); a.n = n
        else:
            res = await asyncio.gather(*[one(sess, a.url, a.key, a.model, a.stream, a.timeout, hdr) for _ in range(a.n)])
        wall = time.perf_counter() - t0
    ok = [r for r in res if r["ok"]]
    lats = [r["lat"] for r in ok]; tt = [r["ttfb"] for r in ok if r["ttfb"] is not None]
    errs = collections.Counter(f'{r["status"]}:{r["text"][:230]}' for r in res if not r["ok"])
    out = {"n": a.n, "ok": len(ok), "err": len(res) - len(ok), "wall_s": round(wall, 2), "rps": round(len(ok) / wall, 1),
           "p50": round(pct(lats, .5), 2), "p95": round(pct(lats, .95), 2), "p99": round(pct(lats, .99), 2), "max": round(max(lats), 2) if lats else None,
           "ttfb_p50": round(pct(tt, .5), 2), "ttfb_p95": round(pct(tt, .95), 2), "stream": a.stream, "errors": dict(errs.most_common(5)),
           "sample": ok[0]["text"][:120] if ok else None}
    print(json.dumps(out))

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("url"); p.add_argument("key"); p.add_argument("model"); p.add_argument("n", type=int)
    p.add_argument("--stream", action="store_true"); p.add_argument("--timeout", type=float, default=180)
    p.add_argument("--header", action="append"); p.add_argument("--rate", type=float, default=0); p.add_argument("--duration", type=float, default=20)
    asyncio.run(run(p.parse_args()))
