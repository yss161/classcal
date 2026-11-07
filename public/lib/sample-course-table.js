/** 示例数据：20 门课，覆盖 1-7 天、连续周 / 单周 / 双周 / 断档周次 */
export const SAMPLE_COURSE_TABLE = {
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
};

export const SAMPLE_JSON = JSON.stringify(SAMPLE_COURSE_TABLE, null, 2);
