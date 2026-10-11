'use strict';

/**
 * 游戏化任务 · 指标统计引擎
 * ============================================================
 * 「任务 = 指标 + 目标值 + 奖励」。本模块负责「指标」这一半：
 * 按任务所属指标实时聚合学生的当日/累计进度，供 game-task.js 判定是否达成。
 *
 * ⛔ 设计原则
 *   1) 全部按 **服务端当前日期**（`CURDATE()`）口径统计，与全站"每日"统计保持一致，
 *      不引入 CONVERT_TZ。
 *   2) 只读，不写任何表；进度不落快照表，避免与业务数据不同步。
 *   3) 新增指标 = 往 METRIC_DEFS 加一项，教师端下拉自动出现（无需改前端）。
 *
 * METRIC_DEFS[key] = {
 *   label  : 教师端下拉显示名
 *   unit   : 单位（题/分/次/局）
 *   hint   : 说明
 *   params : 复合指标的额外参数 [{key,label,default,placeholder}]，普通指标为空数组
 *   calc   : async (pool, studentId, params) => ({ value:number, text?:string })
 * }
 */

const DEFAULT_MASTER_THRESHOLD = 3;

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

const METRIC_DEFS = {
  // ---- 做对题数（全部来源：练习/测试/考试/任务） ----
  answer_correct: {
    label: '做对题数',
    unit: '题',
    hint: '今日做对的题目数量（含练习、测试、考试、课堂任务）',
    params: [],
    async calc(pool, studentId) {
      const [[row]] = await pool.query(
        'SELECT COUNT(*) AS c FROM student_answers ' +
        'WHERE student_id = ? AND is_correct = 1 AND DATE(created_at) = CURDATE()',
        [studentId]
      );
      return { value: Number(row.c) || 0 };
    },
  },

  // ---- 作答次数（含答错） ----
  answer_count: {
    label: '作答次数',
    unit: '题',
    hint: '今日累计作答的题目数量（不论对错）',
    params: [],
    async calc(pool, studentId) {
      const [[row]] = await pool.query(
        'SELECT COUNT(*) AS c FROM student_answers ' +
        'WHERE student_id = ? AND DATE(created_at) = CURDATE()',
        [studentId]
      );
      return { value: Number(row.c) || 0 };
    },
  },

  // ---- 新掌握题数（今日首次达到掌握阈值的题） ----
  practice_mastered: {
    label: '新掌握题数',
    unit: '题',
    hint: '今日新达到「掌握」的题目数（练习同题答对次数达到掌握阈值的当天计入）',
    params: [],
    async calc(pool, studentId) {
      const threshold = await getMasterThreshold(pool);
      const [rows] = await pool.query(
        'SELECT COUNT(*) AS c FROM (' +
        '  SELECT question_id,' +
        '    SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today_cnt,' +
        '    SUM(CASE WHEN DATE(created_at) < CURDATE() THEN 1 ELSE 0 END) AS before_cnt,' +
        '    COUNT(*) AS total_cnt' +
        '  FROM student_answers' +
        "  WHERE student_id = ? AND source = 'practice' AND is_correct = 1" +
        '  GROUP BY question_id' +
        ') t WHERE t.today_cnt >= 1 AND t.before_cnt < ? AND t.total_cnt >= ?',
        [studentId, threshold, threshold]
      );
      return { value: Number(rows[0].c) || 0, text: `掌握阈值 ${threshold} 次` };
    },
  },

  // ---- 操作题得分（WPS / Access，可限定 kind） ----
  op_score: {
    label: '操作题得分',
    unit: '分',
    hint: '今日操作题获得的总分（可在参数中限定 wps / access，留空为两者合计）',
    params: [{ key: 'kind', label: '题型（可选）', type: 'select', default: '', options: [
      { value: '', label: 'WPS + Access' },
      { value: 'wps', label: '仅 WPS' },
      { value: 'access', label: '仅 Access' },
    ] }],
    async calc(pool, studentId, params) {
      const kind = params && params.kind;
      const args = [studentId];
      let sql = 'SELECT COALESCE(SUM(score_obtained), 0) AS s FROM wps_op_submissions ' +
        'WHERE student_id = ? AND DATE(created_at) = CURDATE()';
      if (kind === 'wps' || kind === 'access') {
        sql += ' AND kind = ?';
        args.push(kind);
      }
      const [[row]] = await pool.query(sql, args);
      return { value: Number(row.s) || 0 };
    },
  },

  // ---- 勤学好问打卡 ----
  checkin: {
    label: '勤学好问打卡',
    unit: '次',
    hint: '今日是否完成勤学好问打卡（1 次即达成常态）',
    params: [],
    async calc(pool, studentId) {
      const [[row]] = await pool.query(
        'SELECT COUNT(*) AS c FROM studious_checkins WHERE student_id = ? AND check_date = CURDATE()',
        [studentId]
      );
      return { value: Number(row.c) || 0 };
    },
  },

  // ---- 正确率达标（复合指标：正确率 + 最少题数） ----
  accuracy: {
    label: '正确率达标',
    unit: '',
    hint: '今日作答正确率达到设定比例，且作答量不少于设定题数（达标计 1，未达标计 0）',
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
    params: [],
    async calc(pool, studentId) {
      const [[row]] = await pool.query(
        'SELECT COUNT(*) AS c FROM pk_room_players p ' +
        'JOIN pk_rooms r ON r.id = p.room_id ' +
        "WHERE p.user_id = ? AND p.result = 'win' " +
        'AND DATE(COALESCE(r.ends_at, r.started_at, p.joined_at)) = CURDATE()',
        [studentId]
      );
      return { value: Number(row.c) || 0 };
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
    params: def.params || [],
  }));
}

/** 取单个指标口径说明（可能为 accuracy 等复合指标） */
function getMetricDef(key) {
  return METRIC_DEFS[key] || null;
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
 * 一期任务数很少（个位数），串行足够；如需可并发。
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
  listMetrics,
  getMetricDef,
  getProgress,
  getProgressBatch,
  getMasterThreshold,
  DEFAULT_MASTER_THRESHOLD,
};
