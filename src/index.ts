import { countEvents, buildIcs } from "./lib/ics.ts";
import { decodeToken, encodeToken } from "./lib/codec.ts";
import { defaultTerm, normalizeTimetable, type Term, type Timetable } from "./lib/model.ts";
import { parseText } from "./lib/parse-text.ts";
import { parseCsv } from "./lib/parse-csv.ts";
import { guessTermStart, parseIcs } from "./lib/parse-ics.ts";
import { importJw } from "./lib/jw/index.ts";
import { parseDateMs } from "./lib/dates.ts";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/** 只用到 get/put，方便本地测试时注入内存实现 */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  ASSETS: Fetcher;
  /** 可选：绑定 KV 后，订阅链接就固定不变（课表改了自动更新） */
  CAL?: KVLike;
}

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: extra ? { ...JSON_HEADERS, ...extra } : JSON_HEADERS });
}

/**
 * /api/jw/import 会被书签脚本从教务系统页面直接跨域 POST，
 * 所以这个端点必须放开 CORS（只做无状态计算，不存任何数据）。
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function bad(msg: string, status = 400): Response {
  return json({ ok: false, error: msg }, status);
}

function termFrom(input: unknown): Term {
  const tt = normalizeTimetable({ term: input, courses: [] });
  if (!isFinite(parseDateMs(tt.term.start))) return defaultTerm();
  return tt.term;
}

async function readJson(req: Request): Promise<any> {
  const text = await req.text();
  if (text.length > 1_500_000) throw new Error("请求体过大（上限 1.5MB）");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomId(len: number): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += ID_CHARS[b % ID_CHARS.length];
  return out;
}

/** 服务端存储的课表（KV 模式） */
interface StoredCal {
  key: string;
  tt: Timetable;
  updatedAt: string;
}

/** 生成订阅链接用到的各种 URL */
function links(request: Request, token: string) {
  const url = new URL(request.url);
  const origin = url.origin;
  const icsUrl = origin + "/c/" + token + ".ics";
  return {
    token,
    icsUrl,
    webcalUrl: "webcal://" + url.host + "/c/" + token + ".ics",
    shareUrl: origin + "/?d=" + token,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (pathname === "/api/health") {
        return json({ ok: true, service: "kcb-ics", time: new Date().toISOString() });
      }

      /* ---------- 生成 token / 订阅链接 ---------- */
      if (pathname === "/api/encode" && request.method === "POST") {
        const body = await readJson(request);
        const tt: Timetable = normalizeTimetable(body.timetable ?? body);
        if (!tt.courses.length) return bad("课表是空的，先添加至少一门课");
        const token = await encodeToken(tt);
        return json({ ok: true, ...links(request, token), events: countEvents(tt), courses: tt.courses.length, tokenLength: token.length });
      }

      /* ---------- 固定链接（KV 模式，可选） ---------- */
      if (pathname === "/api/save" && request.method === "POST") {
        if (!env.CAL) {
          return json({ ok: false, fallback: "inline", error: "服务端没有绑定 KV，改用链接内嵌模式" });
        }
        const body = await readJson(request);
        const tt: Timetable = normalizeTimetable(body.timetable ?? body);
        if (!tt.courses.length) return bad("课表是空的，先添加至少一门课");

        const wantId = typeof body.id === "string" ? body.id.trim() : "";
        if (wantId) {
          const raw = await env.CAL.get("cal:" + wantId);
          if (!raw) return bad("这个固定链接已经不存在了", 404);
          let rec: StoredCal;
          try { rec = JSON.parse(raw); } catch { return bad("存储数据已损坏", 500); }
          if (rec.key !== String(body.key || "")) return bad("没有修改这个链接的权限", 403);
          rec.tt = tt;
          rec.updatedAt = new Date().toISOString();
          await env.CAL.put("cal:" + wantId, JSON.stringify(rec));
          const icsUrl = url.origin + "/c/" + wantId + ".ics";
          return json({
            ok: true, mode: "kv", id: wantId, key: rec.key,
            icsUrl, webcalUrl: "webcal://" + url.host + "/c/" + wantId + ".ics",
            shareUrl: url.origin + "/?d=" + (await encodeToken(tt)),
            events: countEvents(tt), courses: tt.courses.length, tokenLength: 0,
          });
        }

        const id = "k" + randomId(11);
        const key = randomId(16);
        const rec: StoredCal = { key, tt, updatedAt: new Date().toISOString() };
        await env.CAL.put("cal:" + id, JSON.stringify(rec));
        return json({
          ok: true, mode: "kv", id, key,
          icsUrl: url.origin + "/c/" + id + ".ics",
          webcalUrl: "webcal://" + url.host + "/c/" + id + ".ics",
          shareUrl: url.origin + "/?d=" + (await encodeToken(tt)),
          events: countEvents(tt), courses: tt.courses.length, tokenLength: 0,
        });
      }

      /* ---------- 还原 token ---------- */
      if (pathname === "/api/decode" && request.method === "GET") {
        const token = url.searchParams.get("d") || url.searchParams.get("token") || "";
        if (!token) return bad("缺少 token");
        const tt = await decodeToken(token);
        return json({ ok: true, timetable: tt });
      }

      /* ---------- 导入解析 ---------- */
      if (pathname === "/api/parse" && request.method === "POST") {
        const body = await readJson(request);
        const kind = String(body.kind || "text");
        const text = String(body.text || "");
        if (!text.trim()) return bad("没有收到内容");
        let term = termFrom(body.term);
        if (kind === "ics") {
          const guessed = guessTermStart(text, term);
          if (guessed) term = { ...term, start: guessed };
        }
        const result = kind === "csv" ? parseCsv(text, term) : kind === "ics" ? parseIcs(text, term) : parseText(text, term);
        return json({ ok: true, term, courses: result.courses, warnings: result.warnings });
      }

      /* ---------- 教务系统导入（跨域可用，供书签脚本调用） ---------- */
      if (pathname === "/api/jw/import") {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
        if (request.method !== "POST") return json({ ok: false, error: "只支持 POST" }, 405, CORS_HEADERS);
        const body = await readJson(request);
        const text = String(body.text ?? body.html ?? "");
        if (!text.trim()) return json({ ok: false, error: "没有收到内容" }, 400, CORS_HEADERS);

        let term = termFrom(body.term);
        const result = importJw(text, term);
        const payload: Record<string, unknown> = {
          ok: result.ok,
          system: result.system,
          mode: result.mode,
          courses: result.courses,
          warnings: result.warnings,
          stats: result.stats || null,
        };
        if (result.courses.length) {
          const tt = normalizeTimetable({ term, courses: result.courses });
          term = tt.term;
          const token = await encodeToken(tt);
          payload.token = token;
          payload.shareUrl = url.origin + "/?d=" + token;
          payload.count = tt.courses.length;
        }
        payload.term = term;
        return json(payload, 200, CORS_HEADERS);
      }

      /* ---------- 预览 ICS（返回文本，不下载） ---------- */
      if (pathname === "/api/preview" && request.method === "POST") {
        const body = await readJson(request);
        const tt = normalizeTimetable(body.timetable ?? body);
        return new Response(buildIcs(tt), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      }

      /* ---------- ICS 订阅端点 ---------- */
      if (pathname.startsWith("/c/")) {
        const rest = pathname.slice(3);
        if (rest.endsWith(".ics")) {
          const token = rest.slice(0, -4);
          if (!token) return bad("缺少 token", 404);
          let tt: Timetable | null = null;
          if (token.startsWith("k") && env.CAL) {
            const raw = await env.CAL.get("cal:" + token);
            if (raw) {
              try { tt = (JSON.parse(raw) as StoredCal).tt; } catch { tt = null; }
            }
          } else {
            try {
              tt = await decodeToken(token);
            } catch {
              tt = null;
            }
          }
          if (!tt) {
            return new Response("订阅链接无效、已损坏或已过期", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
          }
          const ics = buildIcs(tt);
          return new Response(ics, {
            headers: {
              "content-type": "text/calendar; charset=utf-8",
              "content-disposition": 'inline; filename="kcb.ics"',
              "cache-control": "public, max-age=300",
              "access-control-allow-origin": "*",
            },
          });
        }
        // /c/<token> 直接跳到编辑器，方便分享
        return Response.redirect(url.origin + "/?d=" + rest, 302);
      }

      /* ---------- 其他交给静态资源 ---------- */
      return env.ASSETS.fetch(request);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return bad("服务器出错：" + msg, 500);
    }
  },
};
