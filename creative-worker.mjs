// This public Worker has no salon credentials, roles, or owner routes.
import { aiReading, cleanQuestion, rnd } from "./worker.mjs";

const ORIGINS = new Set([
  "https://tsukiyo-arcana.pages.dev",
  "https://yosi-yo-si.github.io",
]);
const dayInJapan = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

// One stable object for ALL requests. A transaction reserves each AI attempt
// before calling the provider, including requests arriving simultaneously.
export class CreativeQuota {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch() {
    const configured = Number(this.env.CREATIVE_DAILY_CAP ?? 20);
    const limit = Number.isInteger(configured) && configured >= 0 ? Math.min(20, configured) : 20;
    const day = dayInJapan();
    const remaining = await this.ctx.storage.transaction(async txn => {
      const state = await txn.get("usage");
      const used = state?.day === day ? state.used : 0;
      if (used >= limit) return null;
      await txn.put("usage", { day, used: used + 1 });
      return limit - used - 1;
    });
    return remaining === null
      ? response({ ok: false, error: "limit", remaining: 0 }, 429)
      : response({ ok: true, remaining });
  }
}

async function readBody(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("type");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error("size"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const headers = { "vary": "origin", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
    if (origin && !ORIGINS.has(origin)) return response({ ok: false, error: "forbidden" }, 403);
    if (origin) headers["access-control-allow-origin"] = origin;
    if (url.pathname !== "/api/creative/draw") return response({ ok: false, error: "not_found" }, 404, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return response({ ok: false, error: "method" }, 405, headers);
    if (env.CREATIVE_ENABLED !== "1" || !env.CREATIVE_QUOTA || !env.ANTHROPIC_API_KEY) {
      return response({ ok: false, error: "unavailable" }, 503, headers);
    }
    let body;
    try { body = await readBody(request); } catch { return response({ ok: false, error: "bad_request" }, 400, headers); }
    if (!body || typeof body !== "object" || typeof body.question !== "string" ||
        Array.from(body.question).length > 300 || body.spread !== 3) {
      return response({ ok: false, error: "bad_request" }, 400, headers);
    }
    const question = cleanQuestion(body.question);
    if (!question) return response({ ok: false, error: "bad_request" }, 400, headers);
    let quota;
    try {
      const id = env.CREATIVE_QUOTA.idFromName("creative-global-v1");
      const res = await env.CREATIVE_QUOTA.get(id).fetch("https://quota/reserve", { method: "POST" });
      quota = await res.json();
      if (res.status === 429) return response({ ok: false, error: "limit", remaining: 0 }, 429, headers);
      if (!res.ok || quota.ok !== true || !Number.isInteger(quota.remaining) || quota.remaining < 0) throw new Error("quota");
    } catch { return response({ ok: false, error: "unavailable" }, 503, headers); }
    const pool = Array.from({ length: 22 }, (_, i) => i);
    const cards = Array.from({ length: 3 }, () => ({
      i: pool.splice(rnd(pool.length), 1)[0], rev: body.allowRev !== false && rnd(2) === 1,
    }));
    const extra = await aiReading(env, cards, question, body.tone === "soft" ? "soft" : "serious");
    return response({
      ok: true, role: "creative", shop: true, cards,
      ai: extra.ai, reading: extra.reading,
      ai_reason: extra.ai === "ok" ? null : "unavailable",
      remaining: quota.remaining,
    }, 200, headers);
  },
};
