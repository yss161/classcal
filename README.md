# kcb-ics · 课表 → iPhone 日历

把课程表变成一条 **日历订阅链接**，用 iPhone 自带日历订阅它。
不装 App、不买开发者证书、不需要服务器 —— 部署在 Cloudflare Workers 上，免费额度足够。

```
填课表（4 种导入方式） → 生成链接 → iPhone「添加已订阅的日历」 → 系统日历里出现课表 + 课前提醒
```

## 功能

- **5 种导入**：粘贴文本自动识别 / 表格手动填 / CSV / 已有 .ics 反向导入 / **教务系统（正方、强智、青果、树维、URP…，书签脚本或贴源码）**
- **自动生成 iCalendar**：周次（含单双周、断档周次）、节次时间、教室、教师、课前提醒（VALARM）、时区（默认 Asia/Shanghai）
- **RFC 5545 合规**：75 字节折行、文字转义、VTIMEZONE、稳定 UID、RRULE 压缩周次（18 周课表只产生少量事件）
- **两种链接模式**
  - 默认「链接内嵌」：课表压缩后放进链接本身 —— **零后端存储、零配置**，改课表会得到新链接
  - 可选「固定链接」：绑定 Workers KV 后链接不变，改课表后 iPhone 自动同步（推荐长期用）
- **零运行时依赖**：Worker 侧没有任何 npm 依赖，前端是原生 HTML/CSS/JS（无构建步骤）
- **可分享**：分享链接打开即可还原课表

## 快速开始（本地）

```bash
npm install
npm run dev          # 打开 http://127.0.0.1:8787
npm test             # 149 个断言：核心逻辑 60 + 接口 43 + 教务适配 46
npm run typecheck
```

## 部署到 Cloudflare Workers

> 三种方式任选一种。**A 最省事**：连上 GitHub 仓库后，之后每次 `git push` 自动部署。

### A. Cloudflare Dashboard 连接 Git（推荐，「一键部署」）

1. 把本仓库推到 GitHub。
2. 打开 <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Workers** → **Connect to Git**。
3. 选你的仓库，构建配置留默认：
   - Build command：`npm ci`（或留空）
   - Deploy command：`npx wrangler deploy`
4. 点 **Deploy**。之后每次 push 到 `main` 自动重新部署。

### B. 一键部署按钮

在 README 里把下面的 `USER/REPO` 换成你自己的，读者点一下就能克隆 + 部署（会引导登录并创建 Worker）：

```markdown
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/USER/REPO)
```

### C. GitHub Actions（仓库自带工作流）

`.github/workflows/deploy.yml` 已经写好：push 到 `main` 时先跑 typecheck + 测试，再部署。
只需要在仓库 **Settings → Secrets and variables → Actions** 里加两个 secret：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 后台 → My Profile → API Tokens → Create Token，模板选 **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 后台右侧的 Account ID |

### D. 本地命令行部署

```bash
npx wrangler login
npm run deploy
```

部署完成后会得到 `https://<worker 名>.<你的子域>.workers.dev` 这样的地址。

> ⚠️ **国内访问**：`workers.dev` 域名在国内不稳定（时好时坏），而 iPhone 拉取 `.ics` 也走同一张网。
> 建议在 Cloudflare 面板给 Worker 绑定一个自己的域名（Workers → Settings → Domains & Routes → Add custom domain），几十块钱一年的域名即可，稳定性会好很多。

## 可选：绑定 KV 开启「固定链接」

默认模式下课表数据内嵌在链接里（无需任何存储），代价是**改课表会产生新链接**。
如果希望「链接永远不变、iPhone 自动同步课表更新」，加一个 KV：

1. Cloudflare 面板 → **Storage & Databases → KV** → Create namespace，名字随意（例如 `kcb-ics-cal`）。
2. 给 Worker 添加绑定：Worker → **Settings → Bindings → Add → KV namespace**，**Variable name 必须填 `CAL`**，选中刚建的 namespace。
   （或者写进 `wrangler.jsonc`：`"kv_namespaces": [{ "binding": "CAL", "id": "<namespace id>" }]`）
3. 重新部署。前端会自动从「链接内嵌」切到「固定链接」，页面上会显示「固定链接」标记。

Storage 用量极小：一份课表约 1–3 KB。免费额度 1 GB。

## iPhone 上怎么加

1. 在 iPhone 的 Safari 里打开站点，填好课表，点「生成订阅链接」。
2. 点结果里的 **① 直接订阅（iPhone 上点这里）**（这是 `webcal://` 链接，会直接跳到订阅页）；
   或者手动进入：**设置 → 日历 → 账户 → 添加账户 → 其他 → 添加已订阅的日历**，把「订阅地址」粘进去。
3. 打开系统日历，课表就在里面了，课前按你设置的提前量提醒。
4. 课表有变动就回来改，改完重新点「生成订阅链接」。
   - **固定链接模式**：地址不变，iPhone 会在几小时内自动同步。
   - **链接内嵌模式**：会生成新地址，需要在日历里删掉旧订阅、添加新订阅。

> 订阅日历在 iPhone 上**只读**，不能直接编辑；同步有延迟（几小时到一天）；它一般作为设备本地账户存在，换设备需要重新添加一次。

## 支持的导入格式

### 1. 粘贴文本（最省事）

每行一门课，**星期 / 节次 / 周次**顺序随意，字段用空格、Tab、`|` 或逗号分隔都行：

```
高等数学 周一 1-2节 1-16周 教1-101 张老师
大学英语	周三	3-4节	1-16周(单)	外语楼302
线性代数|周二|5-6|1-8,10-16|教2-201|李老师
体育 周五 5-6节 1-16周 田径场
```

周次写法：`1-16`、`1-16单`、`1-16双`、`1,3,5`、`1-8,10-16`、`（1-4，6）` 都可以。

### 2. 表格手动填

点击「+ 添加一行」，逐门填写；周次列同样支持上面的写法。

### 3. CSV

表头随意顺序，支持这些列名：`课程名称/课程名/name`、`星期/周几/day`、`节次/period`（或 `开始节/结束节`）、`周次/weeks`、`教室/地点/room`、`教师/老师/teacher`。

```csv
课程名称,星期,节次,周次,教室,教师
高等数学,周一,1-2,1-16,教1-101,张老师
大学英语,3,3-4,1-16单,外语楼302,王老师
```

### 4. .ics 反向导入

已经有 `.ics`（WakeUp 课程表、其他日历 App 导出的都算）可以直接导入：按节次时间表把日期时间反算成「第几周 / 星期几 / 第几节」，并会**自动推断学期开始日期**。

> 如果导入后提示「开始时间对不上节次表」，先在上方「节次时间表」里改成你们学校的作息时间，再导入。

### 5. 教务系统（正方 / 强智 / 青果 / 树维 / URP …）

**不需要把学号密码交给本工具**，也不需要服务器能访问学校内网 —— 因为解析发生在「你已经登录的浏览器页面」里，只把课表表格本身带过来。

#### 方式 A · 书签脚本（一次点击，推荐）

页面「教务系统」页签里有可拖拽的书签按钮，把它拖到书签栏。之后：

1. 在电脑上登录教务系统 → 打开「我的课表 / 学生个人课表」页面；
2. 点一下这个书签；
3. 页面会 POST 当前 HTML 到 `/api/jw/import`（**无状态，不存任何数据**），解析成功后自动在新标签页打开本工具，课表已经填好。

`.github` 无关，书签代码由前端现场生成，指向你自己部署的域名。若学校开了严格 CSP 拦住书签脚本，用方式 B。

#### 方式 B · 复制页面源码粘贴（最稳）

课表页按 `Ctrl+U` 看源码 → 全选复制 → 粘到「教务系统」页签的文本框 → 解析。
也可以直接在课表页全选表格复制后粘贴。

#### 方式 C · 导出文件

教务系统的「导出 Excel」→ 另存为 CSV → 用上面 CSV 页签导入。

#### 支持的系统

| 系统 | 识别关键字 | 解析方式 |
|---|---|---|
| 正方教务 ZFSoft | `jwglxt` / `xskbcx` / `N2151` | 老版课表表格 grid；新版 `kbList` JSON（含页面内嵌 JSON 时自动抠出来） |
| 强智科技 QZDatasoft | `jsxsd` / `xskb_list` | 课表表格 grid（支持 rowspan/colspan、一格多门课、单双周、教师/地点前缀） |
| 青果 KINGOSOFT | `kingosoft` / `kbcx` | 课表表格 grid |
| 树维 SudyTech | `sudytech` / `eams` | 课表表格 grid |
| URP / 金智 Wisedu | `urp` / `wisedu` | 课表表格 grid / 走通用解析器 |
| 未知系统 | — | **通用解析器**：任何「星期 × 节次」表格都能试（自动处理 colspan/rowspan、`第1-2节`、`一/二/三` 单字表头、格内 `周一第1,2节{第1-16周}`、`教师：`/`地点：` 前缀） |

解析不了时页面会说明卡在哪一步（没找到表格 / 认不出星期列 / 单元格里没有周次）。

#### 加一所学校的适配器（开发者）

1. 打开那所学校的课表页，把源码存成 `sample.html` 放在本地；
2. 跑 `node -e "..."` 或直接看 `test/jw.ts` 里的样本写法，用 `importJw(sample, term)` 试；
3. 如果只是「表头/单元格写法不同」→ 在 `src/lib/jw/grid.ts` 的 `WEEKDAY_HINTS`、`PERIOD_IN_CELL`、`WEEKS_IN_LINE` 里补正则；
   如果是完全不同的数据来源（JSON 接口）→ 在 `src/lib/jw/` 新建一个模块，仿照 `zf.ts`；
4. 在 `test/jw.ts` 里加一个样本 + 断言，防止以后改坏。

### 图片 / 截图识别？

还在路线图：需要接视觉模型 API（自备 Key），识别后仍需人工核对。目前过渡方案：系统里「导出 Excel」→ CSV，或者直接「粘贴文本」。

## HTTP 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/` | 前端页面（静态资源） |
| GET | `/api/health` | 健康检查 |
| POST | `/api/parse` | `{ kind: "text"\|"csv"\|"ics", text, term }` → 解析出课程 |
| POST | `/api/encode` | `{ timetable }` → `{ token, icsUrl, webcalUrl, shareUrl }`（链接内嵌模式） |
| POST | `/api/save` | `{ timetable, id?, key? }` → KV 固定链接（未绑定 KV 时返回 `fallback: "inline"`） |
| GET | `/api/decode?d=<token>` | 还原课表 |
| POST | `/api/jw/import` | **教务系统导入**（放开 CORS，供书签脚本跨域调用）：`{ text }` → `{ system, mode, courses, token, shareUrl }` |
| POST | `/api/preview` | 返回生成的 .ics 文本，用于页面预览 |
| GET | `/c/<token>.ics` | **订阅端点**，返回 `text/calendar` |
| GET | `/c/<token>` | 302 跳回编辑器（分享用） |

## 工作原理

```
            ┌──────────── Cloudflare Worker ────────────┐
浏览器页面 ──│ /api/parse  → 文本/CSV/ICS → 结构化课程   │
（原生 JS）  │ /api/save   → KV（可选）固定链接           │
            │ /c/*.ics    → 实时生成 iCalendar 文本      │
            └───────────────────────────────────────────┘
                            ↑ iPhone 日历定期拉取
```

- 课表被序列化成紧凑文本格式，再用 `deflate-raw` 压缩 + base64url 编码成 token（一份 6 门课的课表约 250–350 字符）。
- 每个「课程 + 星期 + 节次 + 周次连续段」生成一个 VEVENT，周次用 `RRULE:FREQ=WEEKLY;INTERVAL=n;COUNT=m` 表达；单双周 → `INTERVAL=2`，断档周次 → 多个 VEVENT。
- UID 由「学期开始日 + 课程名 + 星期 + 节次 + 起始周」哈希得到，**稳定不变**，避免 iPhone 里出现重复事件。

## 数据与隐私

- 「链接内嵌」模式：**服务器不存任何数据**，你的课表就在链接里。等于「谁知道链接谁知道课表」，别随便公开分享。
- 「固定链接」模式：课表存在你自己的 Cloudflare KV 里；`id` 是随机 12 位，另有独立的 16 位 `key` 才能修改（只存在你自己浏览器的 localStorage）。
- 不收集任何分析数据、不引入第三方脚本。

## 已知限制

- 订阅日历同步有延迟（几小时到一天），**临时调课/换教室别指望它**。
- 订阅日历只读，且一般只在本设备生效。
- 链接内嵌模式下服务端不存数据，所以「同一链接内容自动更新」必须靠 KV 模式。
- 极端长的课表（几百门课）会让 token 变长，iOS 手动粘贴订阅地址会很难受 —— 用 KV 模式或短链接即可。

## 路线图

- [x] 教务系统导入：正方 / 强智 / 青果 / 树维 / URP + 通用表格解析器（书签脚本或贴源码）
- [x] 纯文本 / CSV / .ics 导入
- [ ] 课表截图 OCR（自备 API Key）
- [ ] 更多学校的 JSON 接口适配（每校提 issue 即可）
- [ ] 调课/停课（EXDATE）可视化编辑
- [ ] 多套作息时间模板（早八/晚课）
- [ ] 课程颜色 / 多日历分组

## 目录结构

```
.
├── public/                 # 前端（无构建步骤）
│   ├── index.html
│   ├── app.js
│   └── style.css
├── src/
│   ├── index.ts            # Worker 路由
│   └── lib/
│       ├── model.ts        # 数据模型、周次解析/合并/规范化
│       ├── dates.ts        # 日期与小工具
│       ├── ics.ts          # iCalendar 生成（折行、转义、RRULE、VALARM）
│       ├── codec.ts        # 紧凑序列化 + deflate + base64url
│       ├── parse-text.ts   # 文本导入
│       ├── parse-csv.ts    # CSV 导入
│       ├── parse-ics.ts    # .ics 反向导入
│       └── jw/             # 教务系统适配
│           ├── index.ts    # 总入口 importJw（自动判断 JSON / HTML / 纯文本）
│           ├── detect.ts   # 按页面特征识别是哪家的教务系统
│           ├── grid.ts     # 通用「星期 × 节次」表格解析（colspan/rowspan 还原）
│           └── zf.ts       # 正方 kbList JSON 解析
├── test/
│   ├── run.ts              # 核心逻辑测试（node 直接跑 TS）
│   ├── server.ts           # Worker 接口冒烟测试（含 KV 模拟、跨域 CORS）
│   └── jw.ts               # 教务系统适配测试（正方/强智/青果/JSON 样本）
├── wrangler.jsonc
└── .github/workflows/deploy.yml
```

## 开发备注

- 测试直接用 `node` 跑 TypeScript（Node ≥ 22 的类型剥离），不需要 ts-node / vitest。
- Worker 代码只依赖 Web 标准 API（`CompressionStream`、`crypto.getRandomValues`、`Response` 等），因此能在 Node 里直接测。
- 想改 Worker 名字：`wrangler.jsonc` 里的 `name`，以及 `package.json` 的 `name`。

## License

MIT
