/**
 * 验收项自动化：确认前端产物里不存在任何模型调用 / API Key。
 * 只做字符串扫描，不联网。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "public";
const RULES = [
  { re: /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com|dashscope\.aliyuncs\.com/i, why: "出现了模型厂商的 API 域名" },
  { re: /\bsk-[A-Za-z0-9_-]{16,}/, why: "出现了疑似 OpenAI 风格的密钥" },
  { re: /Authorization\s*:\s*Bearer/i, why: "出现了 Bearer 认证头" },
  { re: /\bapi[_-]?key\b\s*[:=]\s*["'][^"']{8,}/i, why: "出现了硬编码 apiKey" },
  { re: /new\s+(OpenAI|Anthropic|ChatGPT|Ollama|Hunyuan)\s*\(/, why: "出现了模型 SDK 调用" },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(js|html|css|json|md)$/i.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8");
  for (const rule of RULES) {
    if (rule.re.test(text)) hits.push(file + "：" + rule.why);
  }
}

if (hits.length) {
  console.error("✗ 前端出现了不该有的模型调用/密钥痕迹：");
  for (const h of hits) console.error("  - " + h);
  process.exit(1);
}
console.log("✓ public/ 里没有任何模型调用或 API Key 痕迹（" + walk(ROOT).length + " 个文件）");
