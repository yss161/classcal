# 课程表 → iPhone 系统日历（纯网页工具）可行性分析

> 目标：不买 Apple 开发者证书、不做原生 App，用"网页"把课表导入 iPhone 自带的「日历」，并且能自动更新。
> 结论时间：2026-11-07 · 调研方式：本地实测网络 + GitHub API + npm registry + Cloudflare 官方文档

---

## 一、结论速览（TL;DR）

**可行，且技术上不需要任何证书/付费。**

真正的最优路径不是"App"，而是 **iCalendar（.ics）订阅**：

```
浏览器里填/导入课表  →  服务端（或纯前端）生成 .ics  →  iPhone「设置→日历→账户→添加已订阅的日历」
                                                  ↑ 系统定期自动重新拉取，课表改了自动同步
```

- 苹果系统天生支持 URL 订阅日历（`webcal://` / `https://.../x.ics`），这是系统级能力，**不需要 App、不需要证书、不需要审核**。
- 免费 HTTPS 托管（Cloudflare Workers/Pages、Vercel、Deno Deploy…）就能满足，零成本。
- 真正的难点不在"订阅日历"，而在 ① **课表数据从哪来**（教务系统/图片/手动）② **国内网络可达性** ③ 订阅刷新的延迟体验。

可行性评分：技术 **9/10**、成本 **10/10**（可做到 0 元）、体验 **6/10**（受 iOS 订阅日历机制限制）。

---

## 二、iOS 侧的三条"写入日历"通道（技术边界）

| 通道 | 是否需要 App/证书 | 能自动更新 | 说明 |
|---|---|---|---|
| ① 下载 .ics 文件 → 打开 → "全部添加" | 不需要 | ❌ 一次性快照 | 最简单，纯前端即可；改课表要重新导入 |
| ② **订阅日历（webcal/https .ics）** | 不需要 | ✅ 系统定期拉取 | **推荐主路线**，体验最接近"App 同步" |
| ③ EventKit 原生 API | 需要（证书或免费个人签名 7 天/TestFlight） | ✅ | 你明确要排除 |
| ③' Scriptable / 快捷指令（免费 App 里的 JS 或动作） | 不需要证书 | ✅（手动跑一次） | **无服务器备选方案**，见第八节 |

结论：**主路线 = ① + ②**；③' 作为"连服务器都不想搭"的备选。

---

## 三、已核对的关键技术事实

| 事实 | 来源（本次实测） |
|---|---|
| Cloudflare Workers 免费版：**100,000 请求/天**，10 ms CPU/次，**静态资源请求免费且不限量** | developers.cloudflare.com workers/platform/limits & pricing（已抓取原文） |
| Cloudflare Pages 免费版：单站 20,000 文件、无限预览部署 | developers.cloudflare.com pages/platform/limits |
| `ical-generator` **11.1.3**（MIT，含时区/重复事件支持） | registry.npmjs.org |
| `rrule` **2.8.1**、`ics` **3.12.1**（另一套 ICS 生成库） | registry.npmjs.org |
| GitHub 上"课表→ics"类项目 155+ 个（`ical timetable` 检索 total_count=155） | api.github.com search（经代理） |
| 已有"在线课表工具"商业产品：nextcourse.cn「下节什么课」支持图片识别 / 二维码 / ICS / 订阅链接导入 | 直接抓取首页 + 搜索摘要 |

补充（经验性，未逐条官方验证，实现时需实测）：
- iOS 订阅日历的刷新频率**由系统决定（通常几小时~一天）**，iOS 端不提供刷新间隔设置（macOS 日历里有）。
- 通过"设置→账户→其他→添加已订阅的日历"添加的日历一般是**设备本地账户**，不像 iCloud 日历那样自动多设备同步（换设备要重新加一次）。
- 订阅日历在 iPhone 上**只读**，不能在系统日历里改；改课表必须改服务端数据。

---

## 四、三种可行架构

### 方案 A：纯前端（零后端）—— 最快出活
```
静态页(Vite/原生) → 浏览器内用 ical-generator 生成 blob → 用户下载/分享 .ics → 日历 App 打开
```
- ✅ 完全免费（GitHub Pages / Cloudflare Pages 静态）、零运维、数据不出浏览器（隐私最好）
- ❌ 只是快照，**改课表要重新导入**；iOS 上"下载→打开→全部添加"要多点几步（Safari 下载 .ics 后可在"文件"App 里点开，或用 `text/calendar` 直链让系统直接弹"添加全部"）
- 适合：先验证需求、先给自己用

### 方案 B：静态前端 + 一个 Serverless 函数（**推荐**）
```
静态前端(编辑课表) ──POST──> /api/save ──> KV/D1 存 JSON，返回随机 id
iPhone 订阅 GET /c/<id>.ics   <── Worker 用 ical-generator 实时生成 ICS（Content-Type: text/calendar）
```
- ✅ 真正的"订阅 + 自动更新"；前端可随便改、ICS 端点永远同源；号令免费额度足够个人/小范围使用
- ❌ 需要一个运行时（Workers / Vercel Functions / Deno Deploy），国内访问需自备域名
- 关键：**URL 要短**（随机 id，别把课表 base64 塞进 URL，iOS 订阅框里长 URL 体验极差且易被截断；真要无状态可用 `?d=<deflate+base64>`，控制在几百字符）

### 方案 C：全 Worker（Hono + JSX + KV）
前端和 `.ics` 端点同一个 Worker，一个域名搞定；绑定自建域名后国内可达性可控。
工程上最干净，可以直接照抄别人的 Worker iCal 项目结构（见第五节）。

### 成本与体验对比
| | 部署成本 | 运维 | 自动更新 | 用户操作步数 | 隐私 |
|---|---|---|---|---|---|
| A 纯前端 | 0 元（免费静态托管） | 无 | ❌ | 中（下载+导入） | 最好（数据全在本地） |
| B 静态+函数 | 0 元（免费额度） | 极低 | ✅ | 低（一次订阅，永久生效） | 课表存服务端 |
| C 全 Worker | 0 元（免费额度） | 极低 | ✅ | 低 | 课表存 KV |

> 备注：`workers.dev` / `pages.dev` / `github.io` 在国内**不稳定（常被墙/污染）**。因为 iPhone 拉取 ICS 也走同一张网，**买一个便宜域名（~30 元/年）+ 绑定**是性价比最高的一步。若要用国内节点加速（腾讯云 EdgeOne Pages / 阿里云 ESA 等免费额度），通常要求**域名已备案**。

---

## 五、现成项目与资料（已核实存在）

### 5.1 最接近你目标的"订阅式服务"（重点参考）
| 项目 | 技术 | 说明 |
|---|---|---|
| **vvbbnn00/USST-Lecture-Table-Calendar** ⭐14 | Next.js | 上海理工课表**日历订阅服务**，"导入日历 App 并保持更新"——架构几乎就是方案 B/C 的教科书 |
| **cn3shy/starClass** ⭐0 | Python | 多用户维护课表 → **生成 ICS 订阅链接** → iPhone 订阅后在系统日历看课表 + 上课提醒 |
| **5nix/zjut-grad-schedule** ⭐1 | JS | 课表转 **ICS 订阅 + 在线日历视图** |
| **whiteki08/SUSTechReptile** ⭐1 | Python | 自托管，把课表变成"可自动更新的 .ics 订阅链接" |
| RENZO-0807/course-calendar ⭐0 | — | 纯静态托管的课表订阅日历示例 |

### 5.2 网页端工具 / 图像识别（同类产品形态）
| 项目 | 技术 | 说明 |
|---|---|---|
| **Lounwb/AirCourse** ⭐19 | TypeScript | Web 工具：**课表截图 → 干净的 ICS**，2026 年仍在更新，产品形态参考 |
| s4sahiko/Timetable-Sync-Pro | HTML | 图片 → .ics 网页工具 |
| vaibhavTekk/vit-timetable-parser-2 | JS | 网页把课表页转成日历文件 |
| nextcourse.cn「下节什么课」 | 商业 | 在线课表工具：**图片识别 / 二维码 / ICS 文件 / 订阅链接导入**，支持 `http/https/webcal`，可直接看竞品交互 |

### 5.3 通用/各校"课表→ICS"脚本（抄 ICS 生成逻辑 + 看各校解析套路）
- **junyilou/python-ical-timetable** ⭐129（Python，最经典，支持"第2周、5~11 周单周、13~17 周"这类周次规则 + 教室 GPS）
- whoisnian/getMyCourses ⭐37（Go，NEU 树维教务）
- qwqVictor/CQUPT-ics ⭐46（支持订阅链接、教学楼/GPS）
- NN708/SEU-Curriculum-Export ⭐20（东南大学）、jtchen2k/ECNU-class2ics ⭐19（华东师大）、Meteors27/ZJU-Calendar-Maker ⭐19（"可直接导入 iOS 日历"）、1970633640/USTC-timetable-to-ics ⭐18（中科大）、renbaoshuo/fzu-ics ⭐12（福州大学）、Hogan-TR/CCZU-iCal ⭐12、yujqiao/hnu-courses-to-ics ⭐12、Hagb/cqu_timetable_new ⭐22、ldiex/UCAS_Course_Schedule_Convertor ⭐16
- 海外同类：NLion74/ics-webuntis、rayokamoto/AUDIT、Chaos02/WebUntisTimeTableToIcs（**GitHub Pages 输出 ICS 供订阅**）

### 5.4 Cloudflare Workers 上的 iCal 服务模板（直接套骨架）
- Gowee/lccal-worker ⭐27（TS，LeetCode 赛事 iCal）
- gardner/sunlight ⭐2（"serves **subscribable** iCal calendar feeds"）
- hutt/bt-to ⭐15、Quantaly/gdq-ical-cf-worker ⭐1、mollyvita/poke-ical ⭐5

### 5.5 库与规范
- `ical-generator`（11.1.3，MIT）—— 服务端/浏览器都能用，含 `timezone`、`repeating`（RRULE）、`alarms`（VALARM）
- `ics`（3.12.1）、`rrule`（2.8.1）、`ICAL.js`（解析别人给的 .ics）
- RFC 5545（iCalendar）、RFC 7986；时区用 IANA `Asia/Shanghai` + VTIMEZONE
- 参考 Apple 支持：iPhone「设置 → 日历 → 账户 → 添加账户 → 其他 → **添加已订阅的日历**」（各 iOS 版本路径略有差异）

---

## 六、必须提前知道的"坑"（这些决定体验上限）

1. **刷新延迟**：订阅日历不会秒同步，通常几小时到 1 天。**临时调课/换教室**别指望它，重要变更要另外提醒。
2. **只读**：订阅日历里的事件不能编辑，用户误以为能改。要在网页端做"改课表"入口并说明。
3. **UID 必须稳定**：同一节课每次生成必须用同一个 UID（如 `hash(课名+星期+节次+周次)`），否则系统会当成新事件，出现重复/更新丢失。更新时递增 `SEQUENCE` 并刷新 `LAST-MODIFIED`。
4. **重复事件用 RRULE，不要展开**：一周 20 节课 × 18 周 = 360 条事件，会让订阅日历变得臃肿；用 `RRULE:FREQ=WEEKLY;COUNT=n`（单双周用 `INTERVAL=2`，调课用 `EXDATE`/追加 `RDATE`）。
5. **编码/换行**：UTF-8，每行 ≤ 75 字节并做折行（CRLF + 空格续行），否则中文课名/教室会解析失败。`Content-Type: text/calendar; charset=utf-8`。
6. **首次订阅必须立即 200**：加订阅时拉不到内容就失败；别把 ICS 端点放在需要登录/Cookie 的地方，用随机 token 路径当"凭证"。
7. **URL 要短**：订阅输入框里长 URL 是体验灾难（也易被截断），用短 id。
8. **隐私**：订阅链接 = 谁拿到谁可看。用足够长的随机 token；**不要**在服务器保存学号密码；爬教务系统只做"用户自己触发、不落库"或干脆不做。
9. **国内可达性**：自定义域名 + 稳定线路，否则"订阅三天后拉不到"就是最糟的失败模式。
10. **多设备/多日历账户**：用户可能把订阅加在 iCloud 账户或本地账户，效果不同；文档里写清步骤 + 截图。

---

## 七、MVP 建议（2~3 天可跑通，给自己用）

**技术栈**：Vite + TS（可用 React/Svelte）+ `ical-generator`；Cloudflare Workers（Hono）+ Workers KV；一个便宜域名。

**路由**
- `/` 课表编辑器（表格录入：课程名/星期/起止节次/周次范围/单双周/教室/老师）
- `POST /api/save` → 存 KV，返回 `{ id, pageUrl, webcalUrl }`
- `GET /c/:id.ics` → 实时生成 ICS（`Cache-Control: max-age=300`）
- `GET /c/:id` → 显示"复制订阅链接 / 一键订阅（webcal://）"页面

**第一版必须有**：手动录入 + 节次时间表可配置（不同学校上课时间不同）+ 订阅链接一键复制 + iPhone 订阅图文引导。
**第二版**：CSV/Excel 粘贴导入、PWA 离线、VALARM（课前 10 分钟提醒）、二维码分享。
**第三版**：按学校插件化导入教务系统（照抄 5.3 的项目）、截图 OCR（成本最高，最后做）。

---

## 八、补充：连后端都不想搭的两个替代方案

1. **Scriptable（App Store 免费）**：写 JS 调 EventKit **直接写系统日历**，纯本地、无需服务器、无需证书。适合"只给自己一次性导入/更新"。
2. **快捷指令（Shortcuts）**：剪贴板文本 → 循环"添加新日程"。零成本但交互原始，批量几十节课会卡。
3. 附带方案：**Google Apps Script** Web App 也能以 `text/calendar` 输出（免费 HTTPS），但国内访问不稳定。

---

## 九、建议的下一步

1. **先做方案 A 的 30 行原型**（输入课表 → 导出 .ics），在 iPhone 上真实走一遍"下载 → 添加到日历"，确认 iOS 实际交互（这是唯一需要亲测的环节）。
2. 再决定是否上方案 B/C（要自动更新就必须有）。**建议直接上 C（全 Worker）**，因为反正要一个域名，前后端同源最省事。
3. 部署一个 Worker 原型（1 个 ICS 端点 + 1 个页面），在真机订阅一次，记录刷新延迟（观察 24 小时），这决定了你最终要不要加"手动改课表后重新导入"的兜底功能。

---

### 附：一个最小订阅 URL 的形态
```
webcal://cal.example.com/c/8f3a1c2d9e.ics
      ↑ iPhone 点这个会直接弹"订阅"；在设置里手动添加时输入 https:// 版本即可
```
