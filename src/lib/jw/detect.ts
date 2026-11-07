export interface SystemInfo {
  id: string;
  name: string;
  /** 命中关键字的个数，越大越可信 */
  score: number;
}

const RULES: { id: string; name: string; patterns: RegExp[] }[] = [
  {
    id: "zf",
    name: "正方教务系统（ZFSoft）",
    patterns: [/zhengfang/i, /zfsoft/i, /jwglxt/i, /xskbcx/i, /正方/i, /N2151/, /xskbcx_cxXsKb/i],
  },
  {
    id: "qz",
    name: "强智科技教务系统（QZDatasoft）",
    patterns: [/qzdatasoft/i, /强智/i, /\/jsxsd\//i, /xskb_list/i, /xsksList/i],
  },
  {
    id: "kingosoft",
    name: "青果软件（KINGOSOFT）",
    patterns: [/kingosoft/i, /青果/i, /\/kbcx\//i, /xsgrkbcx/i],
  },
  {
    id: "sudy",
    name: "树维教务（SudyTech）",
    patterns: [/sudytech/i, /树维/i, /\/eams\//i, /jwglxt\/xtgl/i],
  },
  {
    id: "urp",
    name: "URP 综合教务",
    patterns: [/urp/i, /综合教务/i],
  },
  {
    id: "wisedu",
    name: "金智教育 / 统一身份认证（Wisedu）",
    patterns: [/wisedu/i, /金智/i, /authserver/i, /cas\./i],
  },
];

/** 从页面 HTML（或任意文本）里猜是哪家的教务系统 */
export function detectSystem(text: string): SystemInfo {
  const src = String(text || "");
  let best: SystemInfo = { id: "generic", name: "通用课表表格（未识别具体系统）", score: 0 };
  for (const rule of RULES) {
    let score = 0;
    for (const re of rule.patterns) if (re.test(src)) score++;
    if (score > best.score) best = { id: rule.id, name: rule.name, score };
  }
  return best;
}
