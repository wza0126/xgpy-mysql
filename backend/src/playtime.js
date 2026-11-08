'use strict';

/**
 * 游戏时长池（2026-11-08）
 * ============================================================
 * 模型：钻石 → 时长（分钟）→ 按时长的应用按秒消耗。
 *
 * ⛔ 设计红线：
 *  1. 时长**只能用钻石买**，不能用积分。积分可以刷，钻石来源受限。
 *  2. 时长池是**全局共用**的，不分应用。否则换着应用玩就绕过上限。
 *  3. 余额以 play_time_logs 为准，profiles.play_seconds_balance 是冗余快照，
 *     两者必须在同一事务内更新。
 *  4. 每日两条上限（不是一条）：
 *     · 产出上限：测试/考试/任务给的钻石合计，防「反复刷同一场测试」
 *     · 消费上限：当天游玩总秒数，防「攒一周猛玩一下午」
 *     老师手动发放的钻石**不计入产出上限**（A 档，吴老 2026-11-08 定）。
 *
 * 单位：数据库一律存秒。分钟只用于展示与兑换粒度，避免心跳 30 秒被取整吃掉。
 */

const RULE_DEFAULTS = {
  diamond_to_minutes: 5,      // 1 颗钻石 = 5 分钟
  daily_earn_cap: 3,          // 每日可赚钻石上限（测试+考试+任务）
  daily_minutes_cap: 30,      // 每日可玩分钟上限
  max_exchange_minutes: 30,   // 单次最多兑换分钟
};

const RULE_KEYS = {
  diamond_to_minutes: 'play_diamond_to_minutes',
  daily_earn_cap: 'play_daily_earn_cap',
  daily_minutes_cap: 'play_daily_minutes_cap',
  max_exchange_minutes: 'play_max_exchange_minutes',
};

/** 计入每日产出上限的钻石来源（老师手动 manual / 后台调整 adjust 不算） */
const EARN_CAPPED_SOURCES = ['test', 'exam', 'mission'];

/**
 * ⛔ MariaDB 的 JSON 列经 mysql2 读出来是**字符串**（'{"value": 1}'），不是对象。
 * 直接 Number() 会得到 NaN 并静默退回默认值 —— 老师改了规则却不生效，且不报错。
 * 这里统一解包：字符串先 JSON.parse，再看有没有 value 键。
 */
function pickValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    try { return pickValue(JSON.parse(v)); } catch { return v; }
  }
  if (typeof v === 'object' && !Array.isArray(v) && 'value' in v) return v.value;
  return v;
}

function toInt(v, fallback, min, max) {
  const n = Math.round(Number(pickValue(v)));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 读取规则（老师端可改，改完立即生效） */
async function getRules(conn) {
  const keys = Object.values(RULE_KEYS);
  const [rows] = await conn.query(
    'SELECT config_key, value FROM system_config WHERE config_key IN (?)',
    [keys]
  );
  const map = new Map(rows.map((r) => [r.config_key, r.value]));
  return {
    diamond_to_minutes: toInt(map.get(RULE_KEYS.diamond_to_minutes), RULE_DEFAULTS.diamond_to_minutes, 1, 60),
    daily_earn_cap: toInt(map.get(RULE_KEYS.daily_earn_cap), RULE_DEFAULTS.daily_earn_cap, 0, 50),
    daily_minutes_cap: toInt(map.get(RULE_KEYS.daily_minutes_cap), RULE_DEFAULTS.daily_minutes_cap, 0, 240),
    max_exchange_minutes: toInt(map.get(RULE_KEYS.max_exchange_minutes), RULE_DEFAULTS.max_exchange_minutes, 1, 120),
  };
}

/** 今天已赚的钻石（只统计计入配额的来源） */
async function getTodayEarned(conn, studentId) {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS earned
       FROM diamond_transactions
      WHERE student_id = ? AND amount > 0
        AND source_type IN (?)
        AND created_at >= CURDATE()`,
    [studentId, EARN_CAPPED_SOURCES]
  );
  return Number(rows[0]?.earned) || 0;
}

/** 今天已玩的秒数（只统计消耗） */
async function getTodayUsedSeconds(conn, studentId) {
  const [rows] = await conn.query(
    `SELECT COALESCE(-SUM(seconds), 0) AS used
       FROM play_time_logs
      WHERE student_id = ? AND seconds < 0 AND created_at >= CURDATE()`,
    [studentId]
  );
  return Number(rows[0]?.used) || 0;
}

/** 学生端钱包：余额、今日进度、规则 */
async function getPlayWallet(conn, studentId) {
  const rules = await getRules(conn);
  const [rows] = await conn.query(
    'SELECT play_seconds_balance FROM profiles WHERE id = ?',
    [studentId]
  );
  const balance = Number(rows[0]?.play_seconds_balance) || 0;
  const earnedToday = await getTodayEarned(conn, studentId);
  const usedToday = await getTodayUsedSeconds(conn, studentId);
  const dailyCapSeconds = rules.daily_minutes_cap * 60;

  return {
    balance_seconds: balance,
    balance_minutes: Math.floor(balance / 60),
    rules,
    today: {
      earned_diamonds: earnedToday,
      earn_cap: rules.daily_earn_cap,
      used_seconds: usedToday,
      used_minutes: Math.floor(usedToday / 60),
      cap_seconds: dailyCapSeconds,
      cap_minutes: rules.daily_minutes_cap,
      remaining_seconds: Math.max(0, dailyCapSeconds - usedToday),
    },
  };
}

/**
 * 用钻石换时长。
 * @returns {Promise<{ok:boolean, error?:string, minutes?:number, seconds?:number, balance_seconds?:number}>}
 */
async function exchangePlayTime(conn, { studentId, diamonds, spendDiamonds }) {
  const n = Math.round(Number(diamonds) || 0);
  if (!studentId || n <= 0) return { ok: false, error: '兑换数量无效' };
  if (!spendDiamonds) throw new Error('exchangePlayTime 需要传入 spendDiamonds');

  const rules = await getRules(conn);
  const minutes = n * rules.diamond_to_minutes;
  if (minutes > rules.max_exchange_minutes) {
    return { ok: false, error: `单次最多兑换 ${rules.max_exchange_minutes} 分钟（${Math.floor(rules.max_exchange_minutes / rules.diamond_to_minutes)} 颗）` };
  }
  const seconds = minutes * 60;

  // 先写时长流水拿到 id，再用它做钻石流水的幂等键（两本账一一对应）
  const [ins] = await conn.query(
    `INSERT INTO play_time_logs (student_id, seconds, reason, source_type, source_id)
     VALUES (?, ?, ?, 'exchange', NULL)`,
    [studentId, seconds, `兑换：${n} 颗钻石 → ${minutes} 分钟`]
  );
  const logId = String(ins.insertId);

  const spent = await spendDiamonds(conn, {
    studentId,
    amount: n,
    reason: `兑换 ${minutes} 分钟游戏时间`,
    sourceType: 'play_time',
    sourceId: logId,
  });
  if (!spent.ok) {
    // 调用方负责回滚；这里把错误原样带回（通常是「钻石不足」）
    return { ok: false, error: spent.error || '钻石不足' };
  }

  await conn.query('UPDATE play_time_logs SET source_id = ? WHERE id = ?', [logId, logId]);
  await conn.query(
    'UPDATE profiles SET play_seconds_balance = play_seconds_balance + ? WHERE id = ?',
    [seconds, studentId]
  );

  const [rows] = await conn.query('SELECT play_seconds_balance FROM profiles WHERE id = ?', [studentId]);
  return { ok: true, minutes, seconds, balance_seconds: Number(rows[0]?.play_seconds_balance) || 0 };
}

/**
 * 心跳消耗（前端每 30 秒调一次）。
 * ⛔ 校验顺序：余额 → 每日上限。两条都要过，任何一个不满足就 locked。
 */
async function consumePlayTime(conn, { studentId, appId, seconds = 30 }) {
  const sec = Math.round(Number(seconds) || 0);
  if (!studentId || sec <= 0) return { ok: false, reason: 'invalid', error: '时长为空' };
  if (sec > 300) return { ok: false, reason: 'invalid', error: '单次上报过大' };

  const rules = await getRules(conn);
  const [rows] = await conn.query(
    'SELECT play_seconds_balance FROM profiles WHERE id = ? FOR UPDATE',
    [studentId]
  );
  if (rows.length === 0) return { ok: false, reason: 'no_student', error: '学生不存在' };

  const balance = Number(rows[0].play_seconds_balance) || 0;
  if (balance <= 0) {
    return { ok: false, reason: 'no_balance', locked: true, balance_seconds: 0, error: '时长不足' };
  }

  const usedToday = await getTodayUsedSeconds(conn, studentId);
  const dailyCapSeconds = rules.daily_minutes_cap * 60;
  if (dailyCapSeconds > 0 && usedToday >= dailyCapSeconds) {
    return {
      ok: false, reason: 'daily_cap', locked: true,
      balance_seconds: balance, used_seconds: usedToday, cap_seconds: dailyCapSeconds,
      error: `今天已经玩满 ${rules.daily_minutes_cap} 分钟了`,
    };
  }

  // 只扣到「余额」和「每日上限」中先到的那个
  let charge = Math.min(sec, balance);
  if (dailyCapSeconds > 0) charge = Math.min(charge, dailyCapSeconds - usedToday);
  if (charge <= 0) {
    return { ok: false, reason: 'daily_cap', locked: true, balance_seconds: balance, error: '今日额度已用完' };
  }

  await conn.query(
    `INSERT INTO play_time_logs (student_id, seconds, reason, source_type, app_id)
     VALUES (?, ?, ?, 'consume', ?)`,
    [studentId, -charge, '应用使用', appId || null]
  );
  await conn.query(
    'UPDATE profiles SET play_seconds_balance = play_seconds_balance - ? WHERE id = ?',
    [charge, studentId]
  );

  const remaining = balance - charge;
  const usedAfter = usedToday + charge;
  return {
    ok: true,
    charged: charge,
    balance_seconds: remaining,
    used_seconds: usedAfter,
    cap_seconds: dailyCapSeconds,
    // 余额或每日额度见底时通知前端弹遮罩
    locked: remaining <= 0 || (dailyCapSeconds > 0 && usedAfter >= dailyCapSeconds),
    lock_reason: remaining <= 0 ? 'no_balance' : (dailyCapSeconds > 0 && usedAfter >= dailyCapSeconds ? 'daily_cap' : null),
  };
}

/** 老师调整时长（学生管理 → 编辑学生） */
async function adjustPlayTime(conn, { studentId, seconds, reason, teacherId = null }) {
  const sec = Math.round(Number(seconds) || 0);
  if (!studentId || sec === 0) return { ok: true, changed: 0, balance_seconds: null };

  const [rows] = await conn.query(
    'SELECT play_seconds_balance FROM profiles WHERE id = ? FOR UPDATE',
    [studentId]
  );
  if (rows.length === 0) return { ok: false, error: '学生不存在' };

  const before = Number(rows[0].play_seconds_balance) || 0;
  const after = Math.max(0, before + sec);
  const real = after - before;
  if (real === 0) return { ok: true, changed: 0, balance_seconds: before };

  await conn.query(
    `INSERT INTO play_time_logs (student_id, seconds, reason, source_type)
     VALUES (?, ?, ?, 'adjust')`,
    [studentId, real, String(reason || '老师调整游戏时长').slice(0, 255)]
  );
  await conn.query('UPDATE profiles SET play_seconds_balance = ? WHERE id = ?', [after, studentId]);
  return { ok: true, changed: real, balance_seconds: after };
}

/** 老师端保存规则 */
async function saveRules(conn, patch) {
  const updates = [];
  for (const [field, key] of Object.entries(RULE_KEYS)) {
    if (patch[field] === undefined) continue;
    const lim = { diamond_to_minutes: [1, 60], daily_earn_cap: [0, 50], daily_minutes_cap: [0, 240], max_exchange_minutes: [1, 120] }[field];
    const val = toInt(patch[field], RULE_DEFAULTS[field], lim[0], lim[1]);
    updates.push([key, val]);
  }
  for (const [key, val] of updates) {
    await conn.query(
      `INSERT INTO system_config (id, config_key, value)
       VALUES (?, ?, JSON_OBJECT('value', ?))
       ON DUPLICATE KEY UPDATE value = JSON_OBJECT('value', ?)`,
      [`config_${key}`, key, val, val]
    );
  }
  return getRules(conn);
}

module.exports = {
  RULE_DEFAULTS,
  EARN_CAPPED_SOURCES,
  getRules,
  getTodayEarned,
  getTodayUsedSeconds,
  getPlayWallet,
  exchangePlayTime,
  consumePlayTime,
  adjustPlayTime,
  saveRules,
};
