'use strict';

/**
 * 钻石钱包（账本）
 * ============================================================
 * 2026-11-08 引入。积分是「劳动量计量」（练习可以无限刷），不适合当高价值权益的凭证，
 * 因此新增钻石：来源受限、不可刷、用于兑换上网码/游戏时间这类东西。
 *
 * ⛔ 设计红线（改之前必读）：
 *  1. 钻石与积分**永不互通**。任何汇率都会让学生用刷练习换钻石，整个设计作废。
 *  2. 所有入账必须经过本模块的 grantDiamonds()，靠 diamond_transactions 的
 *     uk_source(source_type, source_id, student_id) 唯一索引保证「同一来源只发一次」。
 *     ⛔ 不要绕过它直接 UPDATE profiles.diamond_balance，否则账本与余额会对不上。
 *  3. 余额以流水为准，profiles.diamond_balance 只是快速读取的冗余值，
 *     两步必须在**同一个事务**里（调用方负责 conn 与事务）。
 *
 * 发放口径（吴老 2026-11-08 定）：
 *   · 考试 exam  ：同一次考试只发首次及格那次，source_id = test_id
 *   · 测试 test  ：随机组卷、每次卷子不同、有每日次数限制，每次及格都发，source_id = test_records.id
 *   · 任务 mission：source_id = 任务 id + 周期键，靠 student_task_claims 本身幂等
 *   · 老师发放 manual / 后台调整 adjust：source_id 为 NULL（不参与唯一约束）
 *   · 兑换消耗 exchange：source_id = exchange_records.id，金额为负
 */

const SOURCE_LABELS = {
  test: '测试',
  exam: '考试',
  mission: '任务',
  manual: '老师发放',
  adjust: '余额调整',
  exchange: '兑换消耗',
};

function genId() {
  return `dt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 入账（幂等）。同一 (source_type, source_id, student_id) 只会成功一次。
 * @returns {Promise<{granted:boolean, amount:number, reason?:string}>}
 */
async function grantDiamonds(conn, { studentId, amount, reason, sourceType = 'manual', sourceId = null, teacherId = null }) {
  const n = Math.round(Number(amount) || 0);
  if (!studentId || n <= 0) return { granted: false, amount: 0, reason: '金额无效' };

  // INSERT IGNORE + 唯一索引：天然幂等，affectedRows=0 即「这个来源已经发过了」
  const [result] = await conn.query(
    `INSERT IGNORE INTO diamond_transactions
       (student_id, amount, reason, source_type, source_id, teacher_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [studentId, n, String(reason || `获得 ${n} 钻石`).slice(0, 255), sourceType, sourceId, teacherId]
  );
  if (result.affectedRows === 0) {
    return { granted: false, amount: 0, reason: '该来源已发放过' };
  }

  await conn.query(
    'UPDATE profiles SET diamond_balance = diamond_balance + ? WHERE id = ?',
    [n, studentId]
  );
  return { granted: true, amount: n };
}

/**
 * 扣减（兑换用）。余额不足直接返回 ok:false，不抛错，方便路由回 400。
 * @returns {Promise<{ok:boolean, balance:number, error?:string}>}
 */
async function spendDiamonds(conn, { studentId, amount, reason, sourceId = null, sourceType = 'exchange' }) {
  const n = Math.round(Number(amount) || 0);
  if (!studentId || n <= 0) return { ok: false, balance: 0, error: '金额无效' };

  const [rows] = await conn.query(
    'SELECT diamond_balance FROM profiles WHERE id = ? FOR UPDATE',
    [studentId]
  );
  if (rows.length === 0) return { ok: false, balance: 0, error: '学生不存在' };

  const balance = Number(rows[0].diamond_balance) || 0;
  if (balance < n) return { ok: false, balance, error: '钻石不足' };

  await conn.query(
    `INSERT IGNORE INTO diamond_transactions
       (student_id, amount, reason, source_type, source_id)
     VALUES (?, ?, ?, ?, ?)`,
    [studentId, -n, String(reason || `消耗 ${n} 钻石`).slice(0, 255), sourceType, sourceId]
  );
  await conn.query(
    'UPDATE profiles SET diamond_balance = diamond_balance - ? WHERE id = ?',
    [n, studentId]
  );
  return { ok: true, balance: balance - n };
}

/**
 * 老师后台调整余额（学生管理 → 编辑学生）。delta 可正可负，结果不低于 0。
 * 与 grantDiamonds 的区别：不参与幂等（source_id 为 NULL），每次都记账。
 */
async function adjustDiamonds(conn, { studentId, delta, reason, teacherId = null }) {
  const d = Math.round(Number(delta) || 0);
  if (!studentId || d === 0) return { ok: true, changed: 0, balance: null };

  const [rows] = await conn.query(
    'SELECT diamond_balance FROM profiles WHERE id = ? FOR UPDATE',
    [studentId]
  );
  if (rows.length === 0) return { ok: false, error: '学生不存在' };

  const before = Number(rows[0].diamond_balance) || 0;
  const after = Math.max(0, before + d);
  const realDelta = after - before;
  if (realDelta === 0) return { ok: true, changed: 0, balance: before };

  await conn.query(
    `INSERT INTO diamond_transactions (student_id, amount, reason, source_type, source_id, teacher_id)
     VALUES (?, ?, ?, 'adjust', NULL, ?)`,
    [studentId, realDelta, String(reason || '老师调整钻石余额').slice(0, 255), teacherId]
  );
  await conn.query('UPDATE profiles SET diamond_balance = ? WHERE id = ?', [after, studentId]);
  return { ok: true, changed: realDelta, balance: after };
}

async function getDiamondBalance(conn, studentId) {
  const [rows] = await conn.query('SELECT diamond_balance FROM profiles WHERE id = ?', [studentId]);
  return rows.length ? Number(rows[0].diamond_balance) || 0 : 0;
}

/** 学生端钱包摘要：余额 + 最近流水（默认 20 条） */
async function getDiamondWallet(conn, studentId, limit = 20) {
  const balance = await getDiamondBalance(conn, studentId);
  const [rows] = await conn.query(
    `SELECT id, amount, reason, source_type, created_at
       FROM diamond_transactions WHERE student_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [studentId, Math.min(100, Math.max(1, Number(limit) || 20))]
  );
  return { balance, transactions: rows };
}

module.exports = {
  SOURCE_LABELS,
  grantDiamonds,
  spendDiamonds,
  adjustDiamonds,
  getDiamondBalance,
  getDiamondWallet,
};
