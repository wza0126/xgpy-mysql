#!/usr/bin/env node
/**
 * 迁移 learn_visited_records 的历史 question_key 到当前格式（v2.5.2）
 *
 * 背景：学习模块改版过三次，键格式演化了三代，导致新统计逻辑（按 `章名::selftest::序号`
 *       解析章名）匹配不上老记录，学生进度永远是 0。
 *
 *   ┌ 第 1 代  "sectionIndex-questionIndex"   如 "0-0"、"13-0"      —— python/it 合并扁平化 section 0..23
 *   ├ 第 2 代  "modulePrefix-section-index"   如 "py-0-0"、"it-0-0"  —— 加了 py/it 前缀
 *   └ 第 3 代  "章名::selftest::序号"          如 "人工智能::selftest::3" —— 当前格式
 *
 * 映射策略（**优先按题面文本精确匹配，而非按序号猜测**）：
 *   1. 读 frontend/src/data/learnSelfTest.ts，构建 `题面文本 -> 章名::selftest::序号` 索引；
 *   2. 对每条老记录的 question_text 做精确匹配；
 *   3. 命中 → 更新为新键（同学生同新键已存在时，删除重复的老记录）；
 *      未命中 → 保留原样并汇总报告（不猜测、不乱改）。
 *
 * 用法：
 *   node scripts/debug/migrate_learn_visited_keys.cjs --dry    # 只预演，不写库（默认）
 *   node scripts/debug/migrate_learn_visited_keys.cjs --apply  # 实际执行
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const ROOT = path.resolve(__dirname, '..', '..', '..');   // -> 仓库根
const SELFTEST_TS = path.join(ROOT, 'frontend', 'src', 'data', 'learnSelfTest.ts');

const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };

/** 从生成的 TS 里解析出 `题面 -> 章名::selftest::序号`（序号 = 该章展平后的下标，与前端一致） */
function buildTextIndex() {
  const src = fs.readFileSync(SELFTEST_TS, 'utf8');
  // 定位 `export const LEARN_SELF_TEST: SelfTestChapter[] = [ ... ];`
  const m = src.match(/LEARN_SELF_TEST[^=]*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('未能从 learnSelfTest.ts 解析出 LEARN_SELF_TEST 数组');
  const chapters = JSON.parse(m[1]);
  const idx = new Map();      // 题面 -> 首选新键
  const dups = new Map();     // 题面 -> 全部候选新键（用于检测跨章重复）
  for (const ch of chapters) {
    let i = 0;
    for (const g of ch.groups) {
      for (const q of g.questions) {
        const key = `${ch.cluster_id}::selftest::${i}`;
        if (!idx.has(q)) idx.set(q, key);
        if (!dups.has(q)) dups.set(q, []);
        dups.get(q).push(key);
        i += 1;
      }
    }
  }
  return { idx, dups };
}

(async () => {
  const { idx: textIndex, dups } = buildTextIndex();
  const totalQuestions = [...dups.values()].reduce((a, v) => a + v.length, 0);
  console.log(`[info] 自测题面：唯一 ${textIndex.size} 条 / 总计 ${totalQuestions} 条`);
  const dupList = [...dups.entries()].filter(([, v]) => v.length > 1);
  if (dupList.length) {
    console.log(`[warn] ${dupList.length} 个题面跨章重复，迁移时取首次出现的章：`);
    dupList.slice(0, 5).forEach(([q, ks]) => console.log(`   "${q.slice(0, 34)}…" -> ${ks.join(' | ')}`));
  }

  const c = await mysql.createConnection(DB);
  const [rows] = await c.query(
    "SELECT id, student_id, question_key, question_text FROM learn_visited_records WHERE question_key NOT LIKE '%::%' ORDER BY id"
  );
  console.log(`[info] 待处理的老格式记录：${rows.length} 条`);

  const plan = [];       // { id, oldKey, newKey, text }
  const unmatched = [];  // 无法匹配的
  for (const r of rows) {
    const txt = String(r.question_text || '').trim();
    const newKey = textIndex.get(txt);
    if (newKey) plan.push({ id: r.id, student_id: r.student_id, oldKey: r.question_key, newKey, text: txt });
    else unmatched.push(r);
  }

  console.log(`\n=== 可迁移 ${plan.length} 条 / 无法匹配 ${unmatched.length} 条 ===`);
  const byKey = new Map();
  for (const p of plan) byKey.set(p.oldKey, (byKey.get(p.oldKey) || 0) + 1);
  console.log('老键 -> 迁移条数：');
  [...byKey.entries()].sort().forEach(([k, v]) => console.log(`  ${k.padEnd(12)} ${v}`));

  if (unmatched.length) {
    console.log('\n--- 无法匹配的记录（保持原样）---');
    unmatched.slice(0, 15).forEach(r =>
      console.log(`  #${r.id} ${r.student_id.slice(0, 20)} | ${r.question_key} | ${String(r.question_text || '').slice(0, 50)}`)
    );
    if (unmatched.length > 15) console.log(`  … 另有 ${unmatched.length - 15} 条`);
  }

  if (!APPLY) {
    console.log('\n[dry-run] 未写库。加 --apply 实际执行。');
    await c.end();
    return;
  }

  let updated = 0, deleted = 0;
  await c.beginTransaction();
  try {
    for (const p of plan) {
      // 目标键若已存在（同学生），直接删掉这条老记录，避免唯一键冲突
      const [exist] = await c.query(
        'SELECT id FROM learn_visited_records WHERE student_id = ? AND question_key = ? LIMIT 1',
        [p.student_id, p.newKey]
      );
      if (exist.length) {
        await c.query('DELETE FROM learn_visited_records WHERE id = ?', [p.id]);
        deleted += 1;
      } else {
        await c.query('UPDATE learn_visited_records SET question_key = ? WHERE id = ?', [p.newKey, p.id]);
        updated += 1;
      }
    }
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  }

  console.log(`\n[ok] 迁移完成：更新 ${updated} 条，去重删除 ${deleted} 条`);
  const [chk] = await c.query(
    "SELECT SUM(question_key LIKE '%::%') newFmt, SUM(question_key NOT LIKE '%::%') oldFmt FROM learn_visited_records"
  );
  console.log(`[check] 新格式 ${chk[0].newFmt} 条 / 残留老格式 ${chk[0].oldFmt} 条`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
