#!/usr/bin/env node
/**
 * 生成前端章末自测题数据 frontend/src/data/learnSelfTest.ts
 *
 * 【数据来源】
 *   1. 既有的 src/data/learnSelfTest.ts —— 作为「基线数据」读回（保住历史题库，绝不清空）；
 *   2. scripts/selftest-extra.json   —— 增量补充题（当前用于补「数据与信息」「信息社会及其特征」两章）。
 *
 * 【为什么这样设计】
 *   旧版脚本依赖一个一次性的中间文件 _tmp_selftest.json（原「Python百问/IT百问」的导出），
 *   该文件早已删除 → 旧脚本一跑就 ENOENT，**而且一旦中间文件丢失就再也无法重建题库**。
 *   改成「读回自身产物 + 增量补丁」后，脚本自洽可重跑，不会再出现"越跑越少"的事故。
 *
 * 【合并语义】
 *   - extra 里同一 cluster_id 的同名 group 与基线合并，题目去重（按题面）；
 *   - extra 里新的 cluster_id / group 直接追加；
 *   - 章节顺序按 chapter-taxonomy.js 的 CHAPTER_NAMES 排。
 *
 * 用法：node scripts/gen-learn-selftest.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'data', 'learnSelfTest.ts');
const EXTRA = path.join(ROOT, 'scripts', 'selftest-extra.json');

/** 从当前产物里读回基线数据；文件不存在或解析失败则返回空数组（首次生成场景） */
function readBaseline() {
  if (!fs.existsSync(OUT)) return [];
  const src = fs.readFileSync(OUT, 'utf8');
  const m = src.match(/LEARN_SELF_TEST[^=]*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[warn] 无法解析现有 learnSelfTest.ts，按空基线处理：', e.message);
    return [];
  }
}

function readExtra() {
  if (!fs.existsSync(EXTRA)) return [];
  const j = JSON.parse(fs.readFileSync(EXTRA, 'utf8'));
  return Array.isArray(j.chapters) ? j.chapters : [];
}

function main() {
  const baseline = readBaseline();
  const extra = readExtra();

  const baseTotal = baseline.reduce((s, c) => s + c.groups.reduce((a, g) => a + g.questions.length, 0), 0);
  const extraTotal = extra.reduce((s, c) => s + c.groups.reduce((a, g) => a + g.questions.length, 0), 0);
  console.log(`[info] 基线 ${baseline.length} 章 / ${baseTotal} 问；补充 ${extra.length} 章 / ${extraTotal} 问`);

  // cluster_id -> { cluster_id, groups: [{title, questions:[]}] }
  const byChapter = new Map();
  for (const ch of baseline) {
    byChapter.set(ch.cluster_id, {
      cluster_id: ch.cluster_id,
      groups: ch.groups.map(g => ({ title: g.title, questions: g.questions.slice() })),
    });
  }

  let added = 0, dup = 0;
  for (const ch of extra) {
    if (!byChapter.has(ch.cluster_id)) {
      byChapter.set(ch.cluster_id, { cluster_id: ch.cluster_id, groups: [] });
    }
    const target = byChapter.get(ch.cluster_id);
    for (const g of ch.groups) {
      let tg = target.groups.find(x => x.title === g.title);
      if (!tg) {
        tg = { title: g.title, questions: [] };
        target.groups.push(tg);
      }
      const seen = new Set(tg.questions);
      for (const q of g.questions) {
        if (seen.has(q)) { dup++; continue; }
        seen.add(q);
        tg.questions.push(q);
        added++;
      }
    }
  }

  // 按 16 章词表顺序输出
  const { CHAPTER_NAMES } = require(path.resolve(ROOT, '..', 'backend', 'src', 'chapter-taxonomy.js'));
  const chapters = CHAPTER_NAMES.filter(n => byChapter.has(n)).map(n => {
    const c = byChapter.get(n);
    return { cluster_id: n, groups: c.groups.filter(g => g.questions.length > 0) };
  });

  const missing = CHAPTER_NAMES.filter(n => !byChapter.has(n));
  if (missing.length) console.warn('[warn] 以下章没有自测题：', missing.join('、'));

  const ts = `/**
 * 章末自测题（原「Python百问 / IT百问」按 16 章词表重新归组 + 缺失章补充）
 *
 * 自动生成，请勿手工编辑 —— 数据源与生成逻辑见 scripts/gen-learn-selftest.js
 * 增量补充题见 scripts/selftest-extra.json
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

  const finalTotal = chapters.reduce((s, c) => s + c.groups.reduce((a, g) => a + g.questions.length, 0), 0);
  console.log(`[ok] 生成 ${path.relative(ROOT, OUT)} —— ${chapters.length} 章 / ${finalTotal} 问（新增 ${added}，跳过重复 ${dup}）`);
  chapters.forEach(c => {
    const total = c.groups.reduce((a, g) => a + g.questions.length, 0);
    console.log(`     ${c.cluster_id.padEnd(20, '　')} ${c.groups.length} 组 / ${total} 题`);
  });
  const stillMissing = CHAPTER_NAMES.filter(n => !chapters.some(c => c.cluster_id === n));
  if (stillMissing.length) console.warn('[warn] 仍未覆盖的章：', stillMissing.join('、'));
}

main();
