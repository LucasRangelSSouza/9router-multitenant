"""Servidor de modelo FALSO OpenAI-compativel. Latencia fixa, SSE, estatisticas por chave.
ENV: MOCK_ID (nome), LATENCY (s, default 2.0), FAIL_KEYS (csv de chaves que respondem 429), PORT."""
import asyncio, json, os, time
from collections import Counter
from aiohttp import web
import uvloop

MOCK_ID = os.environ.get("MOCK_ID", "mock")
LATENCY = float(os.environ.get("LATENCY", "2.0"))
FAIL_KEYS = {k for k in os.environ.get("FAIL_KEYS", "").split(",") if k}
inflight = 0
peak = 0
total = 0
by_key = Counter()
by_model = Counter()
log = []  # (t, key, model)

def bearer(req):
    a = req.headers.get("Authorization", "")
    return a[7:] if a.startswith("Bearer ") else req.headers.get("x-api-key", "")

async def chat(req):
    global inflight, peak, total
    key = bearer(req)
    body = await req.json()
    model = body.get("model", "")
    if key in FAIL_KEYS:
        by_key[key + "|429"] += 1
        return web.json_response({"error": {"message": "rate limited (mock)", "type": "rate_limit"}}, status=429)
    inflight += 1; total += 1; peak = max(peak, inflight)
    by_key[key] += 1; by_model[model] += 1
    log.append((time.time(), key, model))
    try:
        text = f"mock={MOCK_ID} key={key} model={model}"
        words = text.split(" ")
        if body.get("stream"):
            resp = web.StreamResponse(headers={"Content-Type": "text/event-stream", "x-mock-id": MOCK_ID})
            await resp.prepare(req)
            step = LATENCY / (len(words) + 1)
            for i, w in enumerate(words):
                await asyncio.sleep(step)
                ch = {"id": "c1", "object": "chat.completion.chunk", "created": int(time.time()), "model": model,
                      "choices": [{"index": 0, "delta": ({"role": "assistant", "content": ""} if i == 0 else {}) | {"content": w + " "}, "finish_reason": None}]}
                await resp.write(f"data: {json.dumps(ch)}\n\n".encode())
            await asyncio.sleep(step)
            fin = {"id": "c1", "object": "chat.completion.chunk", "created": int(time.time()), "model": model,
                   "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
            uchunk = {"id": "c1", "object": "chat.completion.chunk", "created": int(time.time()), "model": model, "choices": [],
                      "usage": {"prompt_tokens": 10, "completion_tokens": len(words), "total_tokens": 10 + len(words)}}
            await resp.write(f"data: {json.dumps(fin)}\n\ndata: {json.dumps(uchunk)}\n\ndata: [DONE]\n\n".encode())
            await resp.write_eof()
            return resp
        await asyncio.sleep(LATENCY)
        return web.json_response({"id": "c1", "object": "chat.completion", "created": int(time.time()), "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": len(words), "total_tokens": 10 + len(words)}},
            headers={"x-mock-id": MOCK_ID})
    finally:
        inflight -= 1

async def models(req):
    return web.json_response({"object": "list", "data": [{"id": "m1", "object": "model"}, {"id": "gpt-x", "object": "model"}]})

async def stats(req):
    return web.json_response({"mock": MOCK_ID, "total": total, "peak_inflight": peak, "inflight": inflight,
                              "by_key": dict(by_key), "by_model": dict(by_model)})

async def reset(req):
    global peak, total
    peak = 0; total = 0; by_key.clear(); by_model.clear(); log.clear()
    return web.json_response({"ok": True})

app = web.Application()
app.router.add_post("/v1/chat/completions", chat)
app.router.add_get("/v1/models", models)
app.router.add_get("/stats", stats)
app.router.add_post("/reset", reset)
if __name__ == "__main__":
    uvloop.install()
    web.run_app(app, port=int(os.environ.get("PORT", "9000")), access_log=None)
