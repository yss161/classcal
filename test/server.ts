/* 不依赖 wrangler 的本地冒烟测试：直接调用 Worker 的 fetch */
import worker from "../src/index.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(process.cwd(), "public");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const env = {
  ASSETS: {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      let p = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = join(PUBLIC, p);
      if (!existsSync(file)) return new Response("Not Found", { status: 404 });
      const ext = p.slice(p.lastIndexOf("."));
      return new Response(readFileSync(file), { headers: { "content-type": MIME[ext] || "application/octet-stream" } });
    },
  },
};

const BASE = "https://example.com";
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + " " + extra); }
}
const call = (pathname: string, init?: RequestInit) => worker.fetch(new Request(BASE + pathname, init), env as any);
const postJson = (pathname: string, body: unknown) => call(pathname, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const term = { name: "2026 秋", start: "2026-09-07", weeks: 18, alarm: 10 };

console.log("\n[1] 静态与健康检查");
const home = await call("/");
const homeText = await home.text();
ok("GET / 返回 index.html", home.status === 200 && homeText.includes("课表 → iPhone 日历"));
ok("GET /app.js 正常", (await call("/app.js")).status === 200);
ok("GET /style.css 正常", (await call("/style.css")).status === 200);
ok("/api/health", (await call("/api/health")).status === 200);

console.log("\n[2] 文本解析接口");
const p1 = await (await postJson("/api/parse", { kind: "text", text: "高等数学 周一 1-2节 1-16周 教1-101 张老师\n体育 周五 5-6节 1-16周 田径场", term })).json();
ok("解析两门课", p1.ok && p1.courses.length === 2, JSON.stringify(p1).slice(0, 200));

console.log("\n[3] 生成订阅链接");
const enc = await (await postJson("/api/encode", { timetable: { term, courses: p1.courses } })).json();
ok("encode 成功", enc.ok === true, JSON.stringify(enc).slice(0, 200));
ok("icsUrl 形态", /^https:\/\/example\.com\/c\/[A-Za-z0-9_-]+\.ics$/.test(enc.icsUrl), enc.icsUrl);
ok("webcalUrl 形态", enc.webcalUrl.startsWith("webcal://example.com/c/"), enc.webcalUrl);
ok("shareUrl 形态", enc.shareUrl.startsWith("https://example.com/?d="), enc.shareUrl);
console.log("  链接长度:", enc.icsUrl.length, "字符");

console.log("\n[4] ICS 订阅端点");
const icsRes = await call(new URL(enc.icsUrl).pathname);
const icsText = await icsRes.text();
ok("状态 200", icsRes.status === 200);
ok("Content-Type: text/calendar", (icsRes.headers.get("content-type") || "").includes("text/calendar"), icsRes.headers.get("content-type") || "");
ok("可被缓存", (icsRes.headers.get("cache-control") || "").includes("max-age"));
ok("含两门课", icsText.includes("SUMMARY:高等数学") && icsText.includes("SUMMARY:体育"));
ok("含 RRULE", icsText.includes("RRULE:FREQ=WEEKLY"));
ok("含 VALARM", icsText.includes("BEGIN:VALARM"));

console.log("\n[5] 解码与分享跳转");
const dec = await (await call("/api/decode?d=" + enc.token)).json();
ok("decode 还原课程数", dec.ok && dec.timetable.courses.length === 2);
ok("decode 还原学期名", dec.timetable.term.name === "2026 秋");
const redir = await call("/c/" + enc.token);
ok("/c/<token> 跳转编辑器", redir.status === 302 && (redir.headers.get("location") || "").includes("/?d="));

console.log("\n[6] 错误处理");
ok("坏 token 返回 404", (await call("/c/notatoken.ics")).status === 404);
ok("空课表 encode 返回 400", (await postJson("/api/encode", { timetable: { term, courses: [] } })).status === 400);
ok("缺内容 parse 返回 400", (await postJson("/api/parse", { kind: "text", text: "   " })).status === 400);
ok("坏 JSON 不崩溃", (await call("/api/encode", { method: "POST", body: "{oops" })).status === 500);

console.log("\n[7] ICS 往返（导出再导入）");
const p2 = await (await postJson("/api/parse", { kind: "ics", text: icsText, term })).json();
ok("ICS 反向解析课程数", p2.ok && p2.courses.length === 2, JSON.stringify(p2.courses && p2.courses.map((c:any)=>c.name)));
const again = await (await postJson("/api/encode", { timetable: { term: p2.term, courses: p2.courses } })).json();
ok("重新生成的 token 与原 token 一致", again.token === enc.token, "长度 " + (again.token||"").length + " vs " + enc.token.length);

/* ---------------- KV 固定链接模式 ---------------- */
console.log("\n[8] 未绑定 KV 时 /api/save 优雅降级");
const noKv = await (await postJson("/api/save", { timetable: { term, courses: p1.courses } })).json();
ok("返回 ok:false + fallback:inline", noKv.ok === false && noKv.fallback === "inline", JSON.stringify(noKv));

console.log("\n[9] KV 固定链接模式（内存版 KV 模拟）");
const store = new Map<string, string>();
const envKv = {
  ASSETS: env.ASSETS,
  CAL: {
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async put(k: string, v: string) { store.set(k, v); },
  },
};
const callKv = (pathname: string, init?: RequestInit) => worker.fetch(new Request(BASE + pathname, init), envKv as any);
const save = await (await callKv("/api/save", { method: "POST", body: JSON.stringify({ timetable: { term, courses: p1.courses } }), headers: { "content-type": "application/json" } })).json();
ok("首次 save 得到 id/key", save.ok && /^k[a-z0-9]{11}$/.test(save.id) && save.key.length === 16, JSON.stringify(save).slice(0, 160));
ok("id 与 token 不同（短链接）", save.icsUrl.length < 80, save.icsUrl);
const kvIcs = await callKv(new URL(save.icsUrl).pathname);
const kvIcsText = await kvIcs.text();
ok("KV 订阅端点 200 + ics", kvIcs.status === 200 && kvIcsText.includes("SUMMARY:高等数学"));

// 更新后链接不变、内容变化
const p3 = await (await postJson("/api/parse", { kind: "text", text: "高等数学 周一 1-2节 1-16周 教9-999 张老师", term })).json();
const updated = await (await callKv("/api/save", { method: "POST", body: JSON.stringify({ timetable: { term, courses: p3.courses }, id: save.id, key: save.key }), headers: { "content-type": "application/json" } })).json();
ok("更新成功且 id 不变", updated.ok && updated.id === save.id, JSON.stringify(updated).slice(0, 160));
const kvIcs2 = await (await callKv(new URL(save.icsUrl).pathname)).text();
ok("同一链接内容已更新", kvIcs2.includes("LOCATION:教9-999"));

const stolen = await callKv("/api/save", { method: "POST", body: JSON.stringify({ timetable: { term, courses: p3.courses }, id: save.id, key: "wrongkeywrongkey" }), headers: { "content-type": "application/json" } });
ok("错误 key 被拒绝 403", stolen.status === 403);
const missing = await callKv("/api/save", { method: "POST", body: JSON.stringify({ timetable: { term, courses: p3.courses }, id: "knothingshere", key: "x" }), headers: { "content-type": "application/json" } });
ok("未知 id 返回 404", missing.status === 404);
ok("未知 KV id 的 .ics 返回 404", (await callKv("/c/kzzzzzzzzzzz.ics")).status === 404);
ok("KV 模式下 /c/<id> 跳转", (await callKv("/c/" + save.id)).status === 302);

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
if (fail) process.exit(1);
