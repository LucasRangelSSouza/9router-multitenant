// Contexto por requisicao /v1 (AsyncLocalStorage): permite gravar tenant e o
// "model" pedido (nome do combo) no uso sem mudar a assinatura dos handlers.
import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis;
if (!g.__mtReqCtx) g.__mtReqCtx = new AsyncLocalStorage();
export const reqCtx = g.__mtReqCtx;

export function runWithRequestContext(ctx, fn) { return reqCtx.run(ctx, fn); }
export function currentRequestContext() { return reqCtx.getStore() || null; }
