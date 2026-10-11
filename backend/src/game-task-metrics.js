'use strict';

/**
 * 游戏化任务 · 指标统计引擎
 * ============================================================
 * 「任务 = 指标 + 目标值 + 奖励」。本模块负责「指标」这一半：
 * 按任务所属指标实时聚合学生的进度，供 game-task.js 判定是否达成。
 *
 * ⛔ 设计原则
 *   1) daily 指标按 **服务端当前日期**（`CURDATE()`）口径，与全站"每日"统计一致；
 *      total 指标按**累计/历史**口径，永不重置。两者共存，由 `scope` 区分。
 *   2) 只读，不写任何表；进度不落快照表，避免与业务数据不同步。
 *   3) 新增指标 = 往 METRIC_DEFS 加一项，教师端下拉自动出现（无需改前端）。
 *   4) `series` 决定成就归属的「系列」（学生端成就殿堂按系列分组展示）。**系列由指标派生**，
 *      因此无需给 game_tasks 加 category 列（不动表结构）。
 *
 * METRIC_DEFS[key] = {
 *   label  : 教师端下拉显示名
 *   unit   : 单位（题/分/次/局/级/天）
 *   hint   : 说明
 *   scope  : 'daily'（当日，0 点重置） | 'total'（累计，用于一次性成就）
 *   series : 归属系列 key（见 SERIES_DEFS）
 *   params : 复合指标的额外参数 [{key,label,default,placeholder}]，普通指标为空数组
 *   calc   : async (pool, studentId, params) => ({ value:number, text?:string })
 * }
 */

const DEFAULT_MASTER_THRESHOLD = 3;

/** PK 段位层级的显示名（index 即 pk_rank_tier 值） */
const PK_TIER_NAMES = ['小学生', '初中生', '高中生', '本科生', '研究生'];

/**
 * 成就「系列」——学生端成就殿堂按此分组。
 * ⛔ 系列 **由指标派生**（METRIC_DEFS[key].series），不落库、不加列。
 */
const SERIES_DEFS = {
  answer: { id: 'answer', name: '答题达人', icon: 'star', color: '#4f46e5' },
  master: { id: 'master', name: '掌握大师', icon: 'book', color: '#0ea5e9' },
  pk: { id: 'pk', name: '对战王者', icon: 'sword', color: '#e11d48' },
  diligence: { id: 'diligence', name: '勤学坚持', icon: 'fire', color: '#f97316' },
  op: { id: 'op', name: '操作题', icon: 'code', color: '#0891b2' },
  wealth: { id: 'wealth', name: '财富积累', icon: 'coin', color: '#e9a61c' },
  pet: { id: 'pet', name: '宠物养成', icon: 'paw', color: '#059669' },
};

/** 系列清单（教师端 / 学生端共用） */
function listSeries() {
  return Object.values(SERIES_DEFS).map((s) => ({ ...s }));
}

/** 掌握阈值：读 system_config.master_question_threshold（与练习门禁同源） */
async function getMasterThreshold(pool) {
  try {
    const [rows] = await pool.query(
      "SELECT `value` FROM system_config WHERE config_key = 'master_question_threshold' LIMIT 1"
    );
    if (!rows.length) return DEFAULT_MASTER_THRESHOLD;
    const raw = rows[0].value;
    let parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    }
    const v = parsed && typeof parsed === 'object' && parsed.value !== undefined ? parsed.value : parsed;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MASTER_THRESHOLD;
  } catch {
    return DEFAULT_MASTER_THRESHOLD;
  }
}

/** 单列标量查询小工具 */
async function scalar(pool, sql, args, key) {
  const [[row]] = await pool.query(sql, args);
  return Number(row && row[key]) || 0;
}

const METRIC_DEFS = {
  // ============================================================
  // 一、当日口径（scope:'daily'）—— 一期每日任务用
  // ============================================================

  // ---- 做对题数（全部来源：练习/测试/考试/任务） ----
  answer_correct: {
    label: '做对题数',
    unit: '题',
    hint: '今日做对的题目数量（含练习、测试、考试、课堂任务）',
    scope: 'daily',
    series: 'answer',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM student_answers ' +
        'WHERE student_id = ? AND is_correct = 1 AND DATE(created_at) = CURDATE()',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 作答次数（含答错） ----
  answer_count: {
    label: '作答次数',
    unit: '题',
    hint: '今日累计作答的题目数量（不论对错）',
    scope: 'daily',
    series: 'answer',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM student_answers ' +
        'WHERE student_id = ? AND DATE(created_at) = CURDATE()',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 新掌握题数（今日首次达到掌握阈值的题） ----
  practice_mastered: {
    label: '新掌握题数',
    unit: '题',
    hint: '今日新达到「掌握」的题目数（练习同题答对次数达到掌握阈值的当天计入）',
    scope: 'daily',
    series: 'master',
    params: [],
    async calc(pool, studentId) {
      const threshold = await getMasterThreshold(pool);
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM (' +
        '  SELECT question_id,' +
        '    SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today_cnt,' +
        '    SUM(CASE WHEN DATE(created_at) < CURDATE() THEN 1 ELSE 0 END) AS before_cnt,' +
        '    COUNT(*) AS total_cnt' +
        '  FROM student_answers' +
        "  WHERE student_id = ? AND source = 'practice' AND is_correct = 1" +
        '  GROUP BY question_id' +
        ') t WHERE t.today_cnt >= 1 AND t.before_cnt < ? AND t.total_cnt >= ?',
        [studentId, threshold, threshold], 'c');
      return { value: c, text: `掌握阈值 ${threshold} 次` };
    },
  },

  // ---- 操作题得分（WPS / Access，可限定 kind） ----
  op_score: {
    label: '操作题得分',
    unit: '分',
    hint: '今日操作题获得的总分（可在参数中限定 wps / access，留空为两者合计）',
    scope: 'daily',
    series: 'op',
    params: [{
      key: 'kind', label: '题型（可选）', type: 'select', default: '', options: [
        { value: '', label: 'WPS + Access' },
        { value: 'wps', label: '仅 WPS' },
        { value: 'access', label: '仅 Access' },
      ],
    }],
    async calc(pool, studentId, params) {
      const kind = params && params.kind;
      const args = [studentId];
      let sql = 'SELECT COALESCE(SUM(score_obtained), 0) AS s FROM wps_op_submissions ' +
        'WHERE student_id = ? AND DATE(created_at) = CURDATE()';
      if (kind === 'wps' || kind === 'access') {
        sql += ' AND kind = ?';
        args.push(kind);
      }
      return { value: await scalar(pool, sql, args, 's') };
    },
  },

  // ---- 勤学好问打卡 ----
  checkin: {
    label: '勤学好问打卡',
    unit: '次',
    hint: '今日是否完成勤学好问打卡（1 次即达成常态）',
    scope: 'daily',
    series: 'diligence',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM studious_checkins WHERE student_id = ? AND check_date = CURDATE()',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 正确率达标（复合指标：正确率 + 最少题数） ----
  accuracy: {
    label: '正确率达标',
    unit: '',
    hint: '今日作答正确率达到设定比例，且作答量不少于设定题数（达标计 1，未达标计 0）',
    scope: 'daily',
    series: 'answer',
    params: [
      { key: 'rate', label: '正确率(%)', type: 'number', default: 90 },
      { key: 'min_count', label: '最少作答题数', type: 'number', default: 10 },
    ],
    async calc(pool, studentId, params) {
      const rateWant = Number(params && params.rate) || 90;
      const minCount = Number(params && params.min_count) || 10;
      const [[row]] = await pool.query(
        'SELECT COUNT(*) AS total_cnt, COALESCE(SUM(is_correct = 1), 0) AS correct_cnt ' +
        'FROM student_answers WHERE student_id = ? AND DATE(created_at) = CURDATE()',
        [studentId]
      );
      const total = Number(row.total_cnt) || 0;
      const correct = Number(row.correct_cnt) || 0;
      const rate = total > 0 ? (correct / total) * 100 : 0;
      const passed = total >= minCount && rate >= rateWant;
      const text = total > 0
        ? `正确率 ${rate.toFixed(0)}%（${correct}/${total}，需 ≥${rateWant}% 且 ≥${minCount} 题）`
        : `今日暂无作答（需 ≥${minCount} 题）`;
      return { value: passed ? 1 : 0, text };
    },
  },

  // ---- PK 对战胜利场次 ----
  pk_win: {
    label: 'PK 胜利场次',
    unit: '局',
    hint: '今日 PK 对战中获胜的场次',
    scope: 'daily',
    series: 'pk',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM pk_room_players p ' +
        'JOIN pk_rooms r ON r.id = p.room_id ' +
        "WHERE p.user_id = ? AND p.result = 'win' " +
        'AND DATE(COALESCE(r.ends_at, r.started_at, p.joined_at)) = CURDATE()',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ============================================================
  // 二、累计口径（scope:'total'）—— 二期一次性成就用
  // ============================================================

  // ---- 累计做对题数（与 answer_correct 同源，只是不限日期） ----
  total_correct: {
    label: '累计做对题数',
    unit: '题',
    hint: '历史累计做对的题目数量（含练习、测试、考试，永不重置）',
    scope: 'total',
    series: 'answer',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM student_answers WHERE student_id = ? AND is_correct = 1',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 累计作答题数 ----
  total_answer: {
    label: '累计作答题数',
    unit: '题',
    hint: '历史累计作答的题目数量（不论对错）',
    scope: 'total',
    series: 'answer',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM student_answers WHERE student_id = ?',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 累计掌握题数（练习同题答对次数 >= 阈值） ----
  total_mastered: {
    label: '累计掌握题数',
    unit: '题',
    hint: '历史累计达到「掌握」的题目数（练习同题答对次数达到掌握阈值即永久计入）',
    scope: 'total',
    series: 'master',
    params: [],
    async calc(pool, studentId) {
      const threshold = await getMasterThreshold(pool);
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM (' +
        '  SELECT question_id, COUNT(*) AS total_cnt' +
        '  FROM student_answers' +
        "  WHERE student_id = ? AND source = 'practice' AND is_correct = 1" +
        '  GROUP BY question_id' +
        ') t WHERE t.total_cnt >= ?',
        [studentId, threshold], 'c');
      return { value: c, text: `掌握阈值 ${threshold} 次` };
    },
  },

  // ---- 累计达成十连对次数 ----
  perfect_10_times: {
    label: '累计十连对次数',
    unit: '次',
    hint: '历史上累计达成「连续答对 10 题」的次数（读 profiles.perfect_10_times）',
    scope: 'total',
    series: 'answer',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COALESCE(perfect_10_times, 0) AS c FROM profiles WHERE id = ?',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 累计操作题得分 ----
  total_op_score: {
    label: '累计操作题得分',
    unit: '分',
    hint: '历史累计的操作题得分（可在参数中限定 wps / access，留空为两者合计）',
    scope: 'total',
    series: 'op',
    params: [{
      key: 'kind', label: '题型（可选）', type: 'select', default: '', options: [
        { value: '', label: 'WPS + Access' },
        { value: 'wps', label: '仅 WPS' },
        { value: 'access', label: '仅 Access' },
      ],
    }],
    async calc(pool, studentId, params) {
      const kind = params && params.kind;
      const args = [studentId];
      let sql = 'SELECT COALESCE(SUM(score_obtained), 0) AS s FROM wps_op_submissions WHERE student_id = ?';
      if (kind === 'wps' || kind === 'access') {
        sql += ' AND kind = ?';
        args.push(kind);
      }
      return { value: await scalar(pool, sql, args, 's') };
    },
  },

  // ---- 累计 PK 胜场 ----
  total_pk_win: {
    label: '累计 PK 胜场',
    unit: '局',
    hint: '历史累计 PK 对战中获胜的场次',
    scope: 'total',
    series: 'pk',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        "SELECT COUNT(*) AS c FROM pk_room_players WHERE user_id = ? AND result = 'win'",
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- PK 段位（0 小学生 ~ 4 研究生） ----
  pk_rank_tier: {
    label: 'PK 段位',
    unit: '段',
    hint: '当前 PK 段位层级（0 小学生 / 1 初中生 / 2 高中生 / 3 本科生 / 4 研究生）',
    scope: 'total',
    series: 'pk',
    params: [],
    async calc(pool, studentId) {
      const t = await scalar(pool,
        'SELECT COALESCE(pk_rank_tier, 0) AS t FROM profiles WHERE id = ?',
        [studentId], 't');
      return { value: t, text: `当前段位：${PK_TIER_NAMES[t] || PK_TIER_NAMES[0]}` };
    },
  },

  // ---- 累计勤学好问打卡次数 ----
  checkin_total: {
    label: '累计打卡次数',
    unit: '次',
    hint: '历史累计完成勤学好问打卡的次数',
    scope: 'total',
    series: 'diligence',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COUNT(*) AS c FROM studious_checkins WHERE student_id = ?',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 累计活跃天数（有作答记录的不同日期数） ----
  total_active_days: {
    label: '累计活跃天数',
    unit: '天',
    hint: '历史上有过作答记录的不同日期数（按自然日去重）',
    scope: 'total',
    series: 'diligence',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COUNT(DISTINCT DATE(created_at)) AS c FROM student_answers WHERE student_id = ?',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 累计获得积分 ----
  total_points_earned: {
    label: '累计获得积分',
    unit: '分',
    hint: '历史累计获得的积分（读 profiles.total_points_earned，只增不减）',
    scope: 'total',
    series: 'wealth',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COALESCE(total_points_earned, 0) AS c FROM profiles WHERE id = ?',
        [studentId], 'c');
      return { value: c };
    },
  },

  // ---- 宠物等级 ----
  pet_level: {
    label: '宠物等级',
    unit: '级',
    hint: '当前宠物等级（读 profiles.pet_level）',
    scope: 'total',
    series: 'pet',
    params: [],
    async calc(pool, studentId) {
      const c = await scalar(pool,
        'SELECT COALESCE(pet_level, 1) AS c FROM profiles WHERE id = ?',
        [studentId], 'c');
      return { value: c };
    },
  },
};

/** 指标清单（教师端下拉用），不暴露 calc */
function listMetrics() {
  return Object.entries(METRIC_DEFS).map(([key, def]) => ({
    key,
    label: def.label,
    unit: def.unit,
    hint: def.hint,
    scope: def.scope,
    series: def.series,
    params: def.params || [],
  }));
}

/** 取单个指标口径说明（可能为 accuracy 等复合指标） */
function getMetricDef(key) {
  return METRIC_DEFS[key] || null;
}

/** 某任务的系列信息（由指标派生） */
function getSeriesOfMetric(key) {
  const def = METRIC_DEFS[key];
  if (!def) return null;
  return SERIES_DEFS[def.series] ? { ...SERIES_DEFS[def.series] } : null;
}

/**
 * 计算某学生在某指标上的当前进度
 * @returns {Promise<{value:number, text:string, error?:string}>}
 */
async function getProgress(pool, metric, studentId, params) {
  const def = METRIC_DEFS[metric];
  if (!def) return { value: 0, text: '', error: `未知指标：${metric}` };
  try {
    const r = await def.calc(pool, studentId, params || {});
    return { value: Number(r.value) || 0, text: r.text || '' };
  } catch (e) {
    return { value: 0, text: '', error: e && e.message ? e.message : String(e) };
  }
}

/**
 * 批量计算：一个学生 + 多个任务（每个任务一次查询）
 * 任务数很少（几十个），串行足够；如需可并发。
 */
async function getProgressBatch(pool, tasks, studentId) {
  const out = {};
  for (const t of tasks) {
    out[t.id] = await getProgress(pool, t.metric, studentId, t.metric_params || {});
  }
  return out;
}

module.exports = {
  METRIC_DEFS,
  SERIES_DEFS,
  PK_TIER_NAMES,
  listMetrics,
  listSeries,
  getMetricDef,
  getSeriesOfMetric,
  getProgress,
  getProgressBatch,
  getMasterThreshold,
  DEFAULT_MASTER_THRESHOLD,
};
