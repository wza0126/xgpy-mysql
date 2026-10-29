/**
 * 一次性数据修复：把综合题 1–14 题的小题分值重新分配成「每题 20 分」。
 *
 * 背景（2026-10-29 吴老反馈）：这 14 道是早期录入的，小题分值是手填的，
 * 每题合计只有 9～16 分，不是 20 分；而 15–30 题导入时按 20 分均分。
 * 结果 30 道题合计只有 482 分，应为 600 分。
 *
 * 口径：与 15–30 题完全一致 —— base = 20 / n，前 n-1 个小题取 base，
 * 余数全部给最后一个小题（n=6 → 3,3,3,3,3,5；n=7 → 2,2,2,2,2,2,8）。
 * 只改 answers[].score，其它字段（题干、选项、答案）一律不动。
 *
 * ⛔ 历史成绩不用改：/api/teacher/composite/matrix 是按「当前」小题分值
 *    重算得分的（getCompositeCredit 只取每空对错），改完即刻全表生效。
 */
const mysql = require('mysql2/promise');

const TOTAL_PER_QUESTION = 20;
const TARGET_RANGE = [1, 14];

function splitScore(n) {
  const base = Math.floor(TOTAL_PER_QUESTION / n);
  const arr = new Array(n - 1).fill(base);
  arr.push(TOTAL_PER_QUESTION - base * (n - 1));
  return arr;
}

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '122201',
    database: 'xgpy',
    charset: 'utf8mb4',
  });

  const [rows] = await conn.query(
    "SELECT id, content, answers FROM questions WHERE type='composite'"
  );

  const plan = [];
  for (const r of rows) {
    const m = /<strong>(\d+)、/.exec(r.content || '');
    if (!m) continue;
    const no = Number(m[1]);
    if (no < TARGET_RANGE[0] || no > TARGET_RANGE[1]) continue;

    let arr;
    try {
      arr = JSON.parse(r.answers);
    } catch {
      console.log(`⚠ 第${no}题 answers 解析失败，跳过`);
      continue;
    }
    if (!Array.isArray(arr) || !arr.length) continue;

    const next = splitScore(arr.length);
    const before = arr.map((a) => a.score);
    const beforeTotal = before.reduce((s, v) => s + (Number(v) || 0), 0);
    if (beforeTotal === TOTAL_PER_QUESTION && before.every((v, i) => v === next[i])) continue;

    arr.forEach((a, i) => {
      a.score = next[i];
    });
    plan.push({ id: r.id, no, n: arr.length, before, next, beforeTotal });
  }

  if (!plan.length) {
    console.log('没有需要修改的题目');
    await conn.end();
    return;
  }

  console.log('题号 | 小题 | 原分值 → 新分值 | 原合计 → 新合计');
  for (const p of plan) {
    console.log(
      ` ${String(p.no).padStart(2)}  |  ${p.n}   | ${JSON.stringify(p.before)} → ${JSON.stringify(p.next)} | ${p.beforeTotal} → ${TOTAL_PER_QUESTION}`
    );
  }

  for (const p of plan) {
    // 重新读一次，避免把上面解析的对象写回去时丢掉别的字段
    const [cur] = await conn.query('SELECT answers FROM questions WHERE id = ?', [p.id]);
    const arr = JSON.parse(cur[0].answers);
    const next = splitScore(arr.length);
    arr.forEach((a, i) => {
      a.score = next[i];
    });
    await conn.execute('UPDATE questions SET answers = ? WHERE id = ?', [
      JSON.stringify(arr),
      p.id,
    ]);
  }

  console.log(`\n已更新 ${plan.length} 道题`);
  await conn.end();
})().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
