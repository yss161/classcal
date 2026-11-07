# course-table-v1 JSON 格式

ClassCal 只接受这一种结构的 JSON。它由**外部 AI（或别的工具）产出**，ClassCal 本身不调用任何模型、不需要 API Key。

> 把本文件整段贴给 AI 当格式要求即可；末尾有完整示例。

---

## 1. 顶层结构

```json
{
  "schemaVersion": "course-table-v1",
  "meta": { "school": "示例大学", "term": "2026-2027 学年第一学期", "startDate": "2026-09-07" },
  "courses": [ /* 见下 */ ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schemaVersion` | string | ✅ | **必须是 `"course-table-v1"`**，写错会直接拒绝 |
| `meta` | object | ❌ | 只是给人看的，ClassCal 不依赖它（学校、学期名、开学日期都可以放这里） |
| `courses` | array | ✅ | 非空数组，一条 = 一门课的一个上课时段 |

## 2. 单条课程

```json
{
  "name": "高等数学A",
  "teacher": "张伟",
  "weekday": 1,
  "weeks": "1-16",
  "periods": "1-2",
  "location": "教1-101"
}
```

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `name` | string | ✅ | 非空。只放**一门课**的名字，不要把两门课塞进一个字符串 |
| `teacher` | string \| null | ❌ | 允许 `null`。允许多位老师用「、」连接；**不要**加前导 `*`（加了也会被自动清掉） |
| `weekday` | integer | ✅ | **1-7 的整数**：1=周一 … 7=周日。不要写 `"周一"`（能容错但不推荐） |
| `weeks` | string | ✅ | 上课周次，见下方写法表 |
| `periods` | string | ✅ | 上课节次，见下方写法表 |
| `location` | string \| null | ❌ | 允许 `null`；教室/楼名/「线上」都行 |

### weeks 写法（推荐左边这列，右侧都能容错）

| 推荐 | 含义 | 也接受 |
|---|---|---|
| `"1-16"` | 第 1 到 16 周，每周 | `"1-16周"`、`"第1-16周"` |
| `"1-15单"` | 第 1 到 16 周里的**奇数周** | `"1-16周(单)"`、`"1-16单周"` |
| `"2-16双"` | 偶数周 | `"1-16周（双）"` |
| `"1,3,5,7"` | 指定几周 | `"1、3、5、7周"` |
| `"1-8,10-16"` | 断档周次（第 9 周不上） | `"1-8周,10-16周"` |

### periods 写法

| 推荐 | 含义 | 也接受 |
|---|---|---|
| `"1-2"` | 第 1、2 节连上 | `"第1-2节"`、`"1,2"`、`"1~2"` |
| `"3"` | 只上第 3 节 | `"第3节"` |

## 3. 拆分规则（给 AI 的硬要求）

1. **一格多课要拆成多条**：同一时间格里有「高等数学 / 大学物理」两门课，就输出两条记录。
2. **一门课一周上两次 → 两条记录**（不同 weekday 或不同 periods 就是不同的上课时段）。
3. **连堂课算一条**：第 1-2 节连上，写 `"periods": "1-2"`，不要拆成两条 1 和 2。
4. **不要把不同周次的同一门课合并**：单周和双周是两条，`"1-15单"` + `"2-16双"`。
5. **不要编造**：表里没写教师/地点就给 `null`，不要猜。
6. **不要输出 Markdown 表格或注释**，只输出这一个 JSON 对象。
7. 课程名里的括号、空格原样保留；不要在 name 里塞周次/教室/教师。

## 4. ClassCal 会做的容错（不用你处理）

- 自动剥掉 ```json 围栏和 JSON 前后的解释文字；
- 自动修正中文引号、结尾多余逗号；
- `weekday: "周一"` 之类自动换算成 1，并给一条 warning；
- 教师名前的 `*` 自动清理；
- 完全重复的记录（name+weekday+weeks+periods+location 全同）自动去重；
- 超出学期总周数的周次自动裁剪并提示。

## 5. 完整示例（20 条）

```json
{
  "schemaVersion": "course-table-v1",
  "meta": {
    "school": "示例大学",
    "term": "2026-2027 学年第一学期",
    "startDate": "2026-09-07"
  },
  "courses": [
    {
      "name": "高等数学A",
      "teacher": "张伟",
      "weekday": 1,
      "weeks": "1-16",
      "periods": "1-2",
      "location": "教1-101"
    },
    {
      "name": "大学英语（读写）",
      "teacher": "李娜",
      "weekday": 1,
      "weeks": "1-16",
      "periods": "3-4",
      "location": "外语楼302"
    },
    {
      "name": "线性代数",
      "teacher": "王强",
      "weekday": 1,
      "weeks": "1-8,10-16",
      "periods": "5-6",
      "location": "教2-201"
    },
    {
      "name": "体育（篮球）",
      "teacher": "刘洋",
      "weekday": 1,
      "weeks": "1-16",
      "periods": "7-8",
      "location": "东区篮球场"
    },
    {
      "name": "数据结构",
      "teacher": "陈静",
      "weekday": 2,
      "weeks": "1-16",
      "periods": "1-2",
      "location": "信息楼A203"
    },
    {
      "name": "数据结构实验",
      "teacher": "陈静",
      "weekday": 2,
      "weeks": "3-18",
      "periods": "3-4",
      "location": "信息楼机房B"
    },
    {
      "name": "大学物理",
      "teacher": "赵敏",
      "weekday": 2,
      "weeks": "2-17",
      "periods": "5-6",
      "location": "理科楼305"
    },
    {
      "name": "概率论与数理统计",
      "teacher": "孙浩",
      "weekday": 3,
      "weeks": "1-16单",
      "periods": "1-2",
      "location": "教3-105"
    },
    {
      "name": "操作系统",
      "teacher": "周琳",
      "weekday": 3,
      "weeks": "1-16",
      "periods": "3-4",
      "location": "信息楼A305"
    },
    {
      "name": "马克思主义基本原理",
      "teacher": "吴涛",
      "weekday": 3,
      "weeks": "1-16双",
      "periods": "5-6",
      "location": "综合楼401"
    },
    {
      "name": "计算机组成原理",
      "teacher": "郑凯",
      "weekday": 4,
      "weeks": "1-16",
      "periods": "1-2",
      "location": "信息楼A201"
    },
    {
      "name": "计算机组成原理实验",
      "teacher": "郑凯",
      "weekday": 4,
      "weeks": "1-8",
      "periods": "3-4",
      "location": "信息楼实验中心"
    },
    {
      "name": "软件工程",
      "teacher": "冯雪",
      "weekday": 4,
      "weeks": "1-16",
      "periods": "5-6",
      "location": "信息楼B102"
    },
    {
      "name": "大学英语听说",
      "teacher": "李娜",
      "weekday": 4,
      "weeks": "1-16",
      "periods": "7-8",
      "location": "语音室2"
    },
    {
      "name": "编译原理",
      "teacher": "何军",
      "weekday": 5,
      "weeks": "1-12",
      "periods": "1-2",
      "location": "信息楼A302"
    },
    {
      "name": "人工智能导论",
      "teacher": "许倩",
      "weekday": 5,
      "weeks": "1-16",
      "periods": "3-4",
      "location": "信息楼报告厅"
    },
    {
      "name": "体育（羽毛球）",
      "teacher": "刘洋",
      "weekday": 5,
      "weeks": "1-16",
      "periods": "5-6",
      "location": "体育馆2号场"
    },
    {
      "name": "数字逻辑",
      "teacher": "邵峰",
      "weekday": 5,
      "weeks": "1-16",
      "periods": "7-8",
      "location": "教4-210"
    },
    {
      "name": "创新创业实践",
      "teacher": "钱多多",
      "weekday": 6,
      "weeks": "1-8",
      "periods": "1-2",
      "location": "创客空间"
    },
    {
      "name": "形势与政策",
      "teacher": "杨帆",
      "weekday": 6,
      "weeks": "1-16双",
      "periods": "3-4",
      "location": "综合楼301"
    }
  ]
}
```

## 6. 最小可用示例

```json
{
  "schemaVersion": "course-table-v1",
  "courses": [
    { "name": "高等数学", "teacher": "张伟", "weekday": 1, "weeks": "1-16", "periods": "1-2", "location": "教1-101" }
  ]
}
```

## 7. 常见错误与提示

| ClassCal 提示 | 含义 | 怎么修 |
|---|---|---|
| `E_SCHEMA_VERSION` | 版本号不是 `course-table-v1` | 改顶层字段 |
| `E_COURSES_MISSING` / `E_COURSES_EMPTY` | 没有 courses 或为空 | 确认课表放在 `courses` 里 |
| `E_WEEKDAY_MISSING` | 某条缺 weekday | 补 1-7 的整数 |
| `E_WEEKDAY_RANGE` | weekday 不在 1-7 | 1=周一…7=周日 |
| `E_WEEKS_UNPARSABLE` / `E_PERIODS_UNPARSABLE` | 字符串解析不出周次/节次 | 用上表推荐写法 |
| `W_LOCATION_EMPTY` / `W_TEACHER_EMPTY` | 教师或地点为空 | 允许，仅提示 |
| `W_MULTI_COURSE` | 课程名里像有多门课 | 拆成多条 |
| `W_WEEKS_CLIPPED` | 周次超出学期总周数 | 检查学期设置或数据 |
| `W_DUPLICATE` | 与前面的记录完全重复 | 删掉重复项 |
