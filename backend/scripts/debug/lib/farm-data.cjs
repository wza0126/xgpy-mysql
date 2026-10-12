'use strict';
/**
 * 农场测试数据「不留痕」工具
 * ============================================================
 * ⛔ 为什么需要它（血泪教训）：
 *   回归脚本为了从干净状态开始，会删掉测试学生的
 *     farm_plots / farm_logs / point_transactions(source_type='farm')。
 *   但「学生 a」同时也是老师自己试玩用的账号 —— 于是每跑一次回归，
 *   就吃掉一份真实试玩记录，而且积分流水删掉后**事后无法追溯**。
 *   只回滚 profiles 的积分是不够的（那只保住总额，保不住明细）。
 *
 * ⛔ 规则：跑测试前整份快照，finally 里**放回原样**（不是「删干净」），
 *   并把「还原后行数 === 快照行数」写进不留痕断言。
 *
 * 用法：
 *   const { snapshotFarmData, restoreFarmData } = require('./lib/farm-data.cjs');
 *   const snap = await snapshotFarmData(db, studentId);   // 动手删之前！
 *   try { ...跑测试... } finally { await restoreFarmData(db, snap); }
 */

const TABLES = [
  { t: 'farm_plots', where: 'student_id = ?' },
  { t: 'farm_logs', where: 'student_id = ?' },
  { t: 'point_transactions', where: "student_id = ? AND source_type = 'farm'" },
];

async function snapshotFarmData(db, studentId) {
  const snap = { studentId, tables: {} };
  for (const x of TABLES) {
    const [rows] = await db.query('SELECT * FROM ' + x.t + ' WHERE ' + x.where, [studentId]);
    snap.tables[x.t] = rows;
  }
  return snap;
}

// 返回各表实际还原的行数
async function restoreFarmData(db, snap) {
  const out = {};
  if (!snap || !snap.studentId) return out;
  for (const x of TABLES) {
    await db.query('DELETE FROM ' + x.t + ' WHERE ' + x.where, [snap.studentId]);
    const rows = snap.tables[x.t] || [];
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const sql = 'INSERT INTO ' + x.t + ' (' + cols.map((c) => '`' + c + '`').join(', ') + ') VALUES ?';
      // ⛔ 同一个进程内把 Date 对象原样交给驱动，不做 JSON 往返 —— 否则
      //   datetime 列会变成 ISO 字符串，回填时报 Incorrect datetime value。
      await db.query(sql, [rows.map((r) => cols.map((c) => r[c]))]);
    }
    out[x.t] = rows.length;
  }
  return out;
}

module.exports = { TABLES, snapshotFarmData, restoreFarmData };
