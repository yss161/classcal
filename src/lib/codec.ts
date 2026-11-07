import { normalizeTimetable, parseWeeks, type Course, type Timetable, type Period } from "./model.ts";

/**
 * 行程码（token）格式，尽量短：
 * K1
 * T|学期名|2026-09-07|18|Asia/Shanghai|10
 * P|0800-0845|0855-0940|...
 * C|课程名|1|1|2|1-16|教1-101|张老师
 */
const MAGIC = "K1";

function esc(s: string): string {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\p").replace(/\r?\n/g, "\\n");
}

function unesc(s: string): string {
  return String(s ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\\p/g, "|")
    .replace(/\\\\/g, "\\");
}

function splitEscaped(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i++;
      continue;
    }
    if (ch === "|") { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

export function serialize(tt: Timetable): string {
  const t = tt.term;
  const lines: string[] = [MAGIC];
  lines.push(["T", esc(t.name), t.start, String(t.weeks), esc(t.tz), String(t.alarm)].join("|"));
  lines.push(["P", ...t.periods.map((p) => (p.s + "-" + p.e).replace(":", ""))].join("|"));
  for (const c of tt.courses) {
    const weeks = weeksToSpecLocal(c.weeks);
    lines.push(["C", esc(c.name), String(c.day), String(c.start), String(c.end), weeks, esc(c.loc || ""), esc(c.teacher || "")].join("|"));
  }
  return lines.join("\n");
}

function weeksToSpecLocal(weeks: number[]): string {
  const arr = [...new Set(weeks)].sort((a, b) => a - b);
  if (!arr.length) return "";
  const step = arr.length > 1 ? arr[1] - arr[0] : 1;
  const isArith = arr.every((v, i) => i === 0 || v - arr[i - 1] === step);
  if (isArith && step === 1) return arr[0] + "-" + arr[arr.length - 1];
  if (isArith && step === 2) return arr[0] + "-" + arr[arr.length - 1] + (arr[0] % 2 ? "单" : "双");
  const parts: string[] = [];
  let i = 0;
  while (i < arr.length) {
    let j = i;
    while (j + 1 < arr.length && arr[j + 1] - arr[j] === 1) j++;
    if (j - i >= 2) parts.push(arr[i] + "-" + arr[j]);
    else for (let k = i; k <= j; k++) parts.push(String(arr[k]));
    i = j + 1;
  }
  return parts.join(",");
}

export function deserialize(text: string): Timetable {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim());
  if (lines[0] !== MAGIC) throw new Error("token 格式不正确");
  const termRaw: Record<string, unknown> = {};
  let periods: Period[] = [];
  const courses: Course[] = [];
  for (const line of lines.slice(1)) {
    const f = splitEscaped(line).map(unesc);
    const tag = f[0];
    if (tag === "T") {
      termRaw.name = f[1] || "我的课表";
      termRaw.start = f[2] || "";
      termRaw.weeks = Number(f[3]) || 18;
      termRaw.tz = f[4] || "Asia/Shanghai";
      termRaw.alarm = Number(f[5]) || 0;
    } else if (tag === "P") {
      periods = f
        .slice(1)
        .map((x) => {
          const m = /^(\d{3,4})-(\d{3,4})$/.exec(x.trim());
          if (!m) return null;
          const fmt = (v: string) => (v.length === 3 ? "0" + v[0] + ":" + v.slice(1) : v.slice(0, 2) + ":" + v.slice(2));
          return { s: fmt(m[1]), e: fmt(m[2]) } as Period;
        })
        .filter((x): x is Period => !!x);
    } else if (tag === "C") {
      const total = Number(termRaw.weeks) || 18;
      courses.push({
        name: f[1] || "",
        day: Number(f[2]) || 1,
        start: Number(f[3]) || 1,
        end: Number(f[4]) || Number(f[3]) || 1,
        weeks: parseWeeks(f[5] || "", total),
        loc: f[6] || undefined,
        teacher: f[7] || undefined,
      });
    }
  }
  if (periods.length) termRaw.periods = periods;
  return normalizeTimetable({ term: termRaw, courses });
}

/* ---------------- 压缩 + base64url ---------------- */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "";
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  const clean = String(s || "").replace(/[^A-Za-z0-9-_]/g, "");
  const bits: number[] = [];
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    bits.push(v);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 1 < bits.length; i += 4) {
    const c0 = bits[i];
    const c1 = bits[i + 1];
    const c2 = i + 2 < bits.length ? bits[i + 2] : -1;
    const c3 = i + 3 < bits.length ? bits[i + 3] : -1;
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 >= 0) bytes.push(((c2 & 3) << 6) | c3);
  }
  return new Uint8Array(bytes);
}

/** 保证拿到 ArrayBuffer 支撑的视图（TS 5.7+ 的 Uint8Array<ArrayBuffer>） */
function tightBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

/**
 * 把一段字节喂进 TransformStream 并读回结果。
 * 注意：写入端的错误必须自己 catch，否则在 Node 里会成为未处理的 Promise 拒绝。
 */
async function pipeThroughStream(stream: TransformStream<Uint8Array, Uint8Array>, bytes: Uint8Array): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const feeder = (async () => {
    try {
      await writer.write(tightBytes(bytes));
      await writer.close();
    } catch {
      /* 数据本身有问题时，读端会给出真正的错误 */
    }
  })();
  try {
    const buf = await new Response(stream.readable).arrayBuffer();
    await feeder;
    return new Uint8Array(buf);
  } finally {
    await feeder;
  }
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThroughStream(new CompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>, bytes);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThroughStream(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>, bytes);
}

export async function encodeToken(tt: Timetable): Promise<string> {
  const raw = new TextEncoder().encode(serialize(tt));
  return toBase64Url(await deflateRaw(raw));
}

export async function decodeToken(token: string): Promise<Timetable> {
  const bytes = fromBase64Url(token);
  if (!bytes.length) throw new Error("token 为空");
  const raw = await inflateRaw(bytes);
  return deserialize(new TextDecoder().decode(raw));
}
