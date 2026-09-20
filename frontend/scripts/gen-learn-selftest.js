#!/usr/bin/env node
/**
 * 生成前端章末自测题数据 frontend/src/data/learnSelfTest.ts
 *
 * 来源：改造前 LearnModule.tsx 里硬编码的「Python百问 / IT百问」（共 24 组问答）。
 * 目标：按 chapter-taxonomy.js 的 16 章重新归组，作为每章末尾的「章末自测」。
 *
 * 用法：node scripts/gen-learn-selftest.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELFTEST_JSON = path.join(ROOT, '_tmp_selftest.json');
const OUT = path.join(ROOT, 'src', 'data', 'learnSelfTest.ts');

// 原「第 N 层 / 一、二、三」→ 16 章词表章名
// 说明：一章可对应多个原分组，题目会按分组顺序合并。
const PY_MAP = {
  'PY0': ['程序设计语言的基本知识'],                                  // Python初印象与环境操作
  'PY1': ['程序设计语言的基本知识'],                                  // 数据、常量、变量与数据类型
  'PY2': ['程序设计语言的基本知识'],                                  // 运算符、表达式与类型转换
  'PY3': ['程序设计语言的基本知识'],                                  // 常用内置函数
  'PY4': ['算法的程序实现'],                                          // 顺序结构
  'PY5': ['算法的程序实现'],                                          // 选择结构
  'PY6': ['算法的程序实现'],                                          // for 循环
  'PY7': ['算法的程序实现'],                                          // while 循环与流程控制
  'PY8': ['算法的程序实现'],                                          // 字符串
  'PY9': ['算法的程序实现'],                                          // 列表
  'PY10': ['函数及其应用'],                                           // 函数与模块
  'PY11': ['算法的程序实现'],                                         // 异常处理
  'PY12': ['算法与问题解决', '经典算法应用'],                          // 算法基础与流程图
  'PY13': ['算法与问题解决', '经典算法应用'],                          // 综合与易错陷阱
};

const IT_MAP = {
  'IT0': ['信息技术发展及其影响'],                                    // 信息与信息技术
  'IT1': ['信息系统的支撑技术'],                                      // 计算机基础（硬件）
  'IT2': ['信息系统的支撑技术'],                                      // 计算机基础（软件）
  'IT3': ['数据编码'],                                               // 进制与编码
  'IT4': ['信息系统的支撑技术'],                                      // 网络技术基础
  'IT5': ['信息系统的支撑技术'],                                      // 物联网
  'IT6': ['信息系统的安全', '信息社会伦理道德与法律法规'],              // 信息安全与信息社会
  'IT7': ['人工智能'],                                               // 人工智能
  'IT8': ['信息系统概述', '信息系统的设计与开发'],                     // 信息系统与数据管理
  'IT9': ['数据获取与表达'],                                          // 多媒体技术
};

function main() {
  const data = JSON.parse(fs.readFileSync(SELFTEST_JSON, 'utf8'));

  /** @type {Map<string, {cluster_id:string, groups:{title:string, questions:string[]}[]}>} */
  const byChapter = new Map();

  const push = (prefix, list, map, chapterField) => {
    list.forEach((sec, i) => {
      const key = `${prefix}${i}`;
      const targets = map[key];
      if (!targets) { console.warn(`[warn] ${key} "${sec.title}" 未映射，跳过`); return; }
      targets.forEach((chapter) => {
        if (!byChapter.has(chapter)) byChapter.set(chapter, { cluster_id: chapter, groups: [] });
        byChapter.get(chapter).groups.push({ title: sec.title, questions: sec.questions.slice() });
      });
    });
  };
  push('PY', data.pythonSections, PY_MAP);
  push('IT', data.itSections, IT_MAP);

  // 按 16 章词表顺序输出
  const { CHAPTER_NAMES } = require(path.resolve(ROOT, '..', 'backend', 'src', 'chapter-taxonomy.js'));
  const chapters = CHAPTER_NAMES.filter(n => byChapter.has(n)).map(n => {
    const g = byChapter.get(n);
    return { cluster_id: n, groups: g.groups };
  });

  const missing = CHAPTER_NAMES.filter(n => !byChapter.has(n));
  if (missing.length) console.warn('[warn] 以下章没有自测题：', missing.join('、'));

  const ts = `/**
 * 章末自测题（原「Python百问 / IT百问」按 16 章词表重新归组）
 *
 * 自动生成，请勿手工编辑 —— 数据源见 scripts/gen-learn-selftest.js
 * 说明：这些是「思考题/自测提问」，点击会打开 AI 答疑窗口，不计入练习积分。
 */
export interface SelfTestGroup {
  title: string;
  questions: string[];
}

export interface SelfTestChapter {
  cluster_id: string;
  groups: SelfTestGroup[];
}

export const LEARN_SELF_TEST: SelfTestChapter[] = ${JSON.stringify(chapters, null, 2)};

/** 取某章的自测题（展平） */
export function getSelfTest(chapterId: string): { title: string; question: string }[] {
  const ch = LEARN_SELF_TEST.find((c) => c.cluster_id === chapterId);
  if (!ch) return [];
  const out: { title: string; question: string }[] = [];
  ch.groups.forEach((g) => g.questions.forEach((q) => out.push({ title: g.title, question: q })));
  return out;
}
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, ts, 'utf8');

  console.log(`[ok] 生成 ${path.relative(ROOT, OUT)} —— ${chapters.length} 章`);
  chapters.forEach(c => {
    const total = c.groups.reduce((a, g) => a + g.questions.length, 0);
    console.log(`     ${c.cluster_id.padEnd(20, '　')} ${c.groups.length} 组 / ${total} 题`);
  });
}

main();
