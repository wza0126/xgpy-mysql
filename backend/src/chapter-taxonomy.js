/**
 * 考点章节词表（唯一分类总纲）
 * 来源：信息技术学测考点精讲.html（经教师审核确认）
 * 用途：① 学习模块 16 章目录  ② 题库聚类强制枚举  ③ 练习模块章节筛选
 *
 * 约定：
 *  - 一级分类 = 章（chapter），如「数据与信息」
 *  - 二级分类 = 小节（section），如「数据编码/文本数据的编码」
 *  - allowChapter=true 的章，允许题目直接挂章级（cluster_id 只有一级）
 *
 * 【重要】修改此文件后必须同步：
 *  1. 学习模块目录（前端从 /api/knowledge/chapters 拉取，无需改前端）
 *  2. 重新聚类题库（教师端「增量聚类」或「全量重跑」）
 */

const CHAPTER_TAXONOMY = [
  {
    part: "必修一",
    partName: "数据与计算",
    group: "第一部分 数据",
    chapters: [
      {
        code: "1.1",
        id: "data-info",
        name: "数据与信息",
        allowChapter: false,
        sections: ["数据、信息与知识的概念", "数据、信息、知识与智慧的关系", "大数据"],
      },
      {
        code: "1.2",
        id: "data-encoding",
        name: "数据编码",
        allowChapter: false,
        sections: ["数字化与进制转换", "文本数据的编码", "声音数据的编码", "图像数据的编码", "条形码与二维码", "数据存储"],
      },
      {
        code: "1.3",
        id: "data-acquire",
        name: "数据获取与表达",
        allowChapter: false,
        sections: ["数据获取", "数据计算", "数据可视化表达", "数据分析报告与数字化学习", "数据保护"],
      },
      {
        code: "1.4",
        id: "ai",
        name: "人工智能",
        allowChapter: false,
        sections: ["人工智能的基础概念", "人工智能的应用领域", "种类多样的人工智能技术", "人工智能的算法"],
      },
    ],
  },
  {
    part: "必修一",
    partName: "数据与计算",
    group: "第二部分 算法与程序",
    chapters: [
      {
        code: "2.1",
        id: "algorithm-basic",
        name: "算法与问题解决",
        allowChapter: false,
        sections: ["算法的概念与特征", "算法的描述与结构", "计算机解决问题的过程"],
      },
      {
        code: "2.2",
        id: "python-basic",
        name: "程序设计语言的基本知识",
        allowChapter: false,
        sections: ["程序设计语言", "Python 语言相关要点", "数据类型", "运算符与表达式", "常量与变量", "赋值语句", "输入语句 input", "输出语句 print"],
      },
      {
        code: "2.3",
        id: "python-impl",
        name: "算法的程序实现",
        allowChapter: false,
        sections: ["顺序结构", "分支结构", "列表", "for 循环", "while 循环", "break 与 continue"],
      },
      {
        code: "2.4",
        id: "function",
        name: "函数及其应用",
        allowChapter: false,
        sections: ["函数与模块"],
      },
      {
        code: "2.5",
        id: "classic-algo",
        name: "经典算法应用",
        allowChapter: true,
        sections: ["解析算法", "枚举算法", "算法的优劣"],
      },
    ],
  },
  {
    part: "必修二",
    partName: "信息系统与社会",
    group: "第一部分 信息系统",
    chapters: [
      {
        code: "3.1",
        id: "is-overview",
        name: "信息系统概述",
        allowChapter: false,
        sections: ["信息系统的概念", "信息系统的组成", "信息系统的功能", "信息系统的分类", "信息系统对社会发展的影响"],
      },
      {
        code: "3.2",
        id: "is-tech",
        name: "信息系统的支撑技术",
        allowChapter: true,
        sections: ["计算机系统的组成", "计算机网络的概念与功能", "计算机网络的分类", "网络协议与 IP 地址", "网络拓扑结构", "网络组建与调试命令", "带宽与网速", "计算机网络设备", "无线网络", "传感与控制", "物联网"],
      },
      {
        code: "3.3",
        id: "is-dev",
        name: "信息系统的设计与开发",
        allowChapter: false,
        sections: ["信息系统的体系结构", "信息系统的开发过程", "信息系统的数据库构建"],
      },
      {
        code: "3.4",
        id: "is-security",
        name: "信息系统的安全",
        allowChapter: true,
        sections: ["信息系统安全风险", "安全风险防范的技术与方法"],
      },
    ],
  },
  {
    part: "必修二",
    partName: "信息系统与社会",
    group: "第二部分 信息社会",
    chapters: [
      {
        code: "4.1",
        id: "it-dev",
        name: "信息技术发展及其影响",
        allowChapter: false,
        sections: ["信息技术概述", "信息技术的发展历程", "信息技术的发展趋势", "信息技术的社会应用", "信息技术的社会影响"],
      },
      {
        code: "4.2",
        id: "info-society",
        name: "信息社会及其特征",
        allowChapter: false,
        sections: ["信息社会的定义", "信息社会的特征"],
      },
      {
        code: "4.3",
        id: "ethics-law",
        name: "信息社会伦理道德与法律法规",
        allowChapter: false,
        sections: ["信息社会的道德规范", "信息社会的法律法规", "知识产权"],
      },
    ],
  },
];

// 展平：所有合法的一级分类（章名）
const CHAPTER_NAMES = CHAPTER_TAXONOMY.flatMap((p) => p.chapters.map((c) => c.name));

// 展平：所有合法的二级分类（"章名/小节名"）
const SECTION_PATHS = CHAPTER_TAXONOMY.flatMap((p) =>
  p.chapters.flatMap((c) => c.sections.map((s) => `${c.name}/${s}`))
);

// 章名 -> 该章小节列表
const SECTIONS_BY_CHAPTER = {};
CHAPTER_TAXONOMY.forEach((p) => p.chapters.forEach((c) => { SECTIONS_BY_CHAPTER[c.name] = c.sections.slice(); }));

// 章名 -> 是否允许题直接挂章级
const CHAPTER_ALLOW_SELF = {};
CHAPTER_TAXONOMY.forEach((p) => p.chapters.forEach((c) => { CHAPTER_ALLOW_SELF[c.name] = !!c.allowChapter; }));

// 章节代码 -> 章名（如 "1.1" -> "数据与信息"）
const CHAPTER_BY_CODE = {};
CHAPTER_TAXONOMY.forEach((p) => p.chapters.forEach((c) => { CHAPTER_BY_CODE[c.code] = c.name; }));

// 生成给 AI 的紧凑词表文本（用于聚类提示词）
function buildTaxonomyPromptText() {
  return CHAPTER_TAXONOMY.map((p) =>
    p.chapters.map((c) => {
      const secs = c.sections.join("、");
      return `【${c.name}】：${secs}${c.allowChapter ? "（也可直接用「" + c.name + "」）" : ""}`;
    }).join("\n")
  ).join("\n");
}

module.exports = {
  CHAPTER_TAXONOMY,
  CHAPTER_NAMES,
  SECTION_PATHS,
  SECTIONS_BY_CHAPTER,
  CHAPTER_ALLOW_SELF,
  CHAPTER_BY_CODE,
  buildTaxonomyPromptText,
};
