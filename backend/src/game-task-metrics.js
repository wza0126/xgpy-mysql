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

/**
 * 操作题累计得分（**唯一口径**）。
 *
 * 教学侧有两处要用这个数：
 *   1) 任务中心「成就殿堂 → 累计操作题得分」（指标 total_op_score）
 *   2) 考试管理 → 普通测试 / 对战PK 的资格验证（新增的两条：WPS / Access）
 * 所以把 SQL 收在这里，谁都不许另写一份 —— 否则「成就殿堂显示 120 分、
 * 资格却说不够」这类自相矛盾迟早发生。
 *
 * ⛔ 口径（老师 2026-10-19 明确）：**所有操作题各自最高得分之和**。
 *    旧口径是 SUM(score_obtained)（每次上传的评分都计入），同一道题反复上传同一个文件
 *    就能无限刷分。新口径按 question_id 分组取 MAX(score_obtained) 再求和：
 *    同一道题传 100 次，也只按它历史上最好的一次成绩计 1 次。
 *
 * @param {object}  pool
 * @param {string}  studentId
 * @param {string?} kind  'wps' | 'access'；留空/其它值 = 两者合计
 * @returns {Promise<number>} 累计得分（无记录为 0）
 */
async function getOpScore(pool, studentId, kind) {
  const args = [studentId];
  let sql =
    'SELECT COALESCE(SUM(t.best), 0) AS s FROM (' +
    '  SELECT MAX(score_obtained) AS best FROM wps_op_submissions' +
    '  WHERE student_id = ?';
  if (kind === 'wps' || kind === 'access') {
    sql += ' AND kind = ?';
    args.push(kind);
  }
  sql += '  GROUP BY question_id) t';
  return scalar(pool, sql, args, 's');
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
    hint: '所有操作题各自最高得分之和（同一道题多次上传只按历史最好一次计分，防止重复上传刷分；可在参数中限定 wps / access，留空为两者合计）',
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
      return { value: await getOpScore(pool, studentId, kind) };
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
    hint: '当前宠物等级（读 student_pets.growth_level，与萌宠模块同源；等级无上限）',
    scope: 'total',
    series: 'pet',
    params: [],
    async calc(pool, studentId) {
      // ⛔ 口径（老师 2026-10-14 明确）：宠物等级是**学生级的唯一值** ——
      //    一个学生只有一个宠物等级，**不存在「几只不同等级的宠物」**。
      //    student_pets 里的多行不是「多只不同等级的宠物」，正常流程下一人只有一行
      //    （换养走的是「删除旧行 + 插入新行并继承 growth_level/growth_value」）；
      //    「形态」（想显示第几阶段的形状）才是按行选的，存在 display_level 列里。
      //    所以这里取的是「该学生的宠物等级」这一个值，用 MAX 只是为了在历史重复行残留时
      //    也能稳定取到同一个值（重复行是同一次自动领养竞态留下的，等级本应相同）。
      //
      // ⛔ 真源是 student_pets.growth_level，**不是** profiles.pet_level：
      //    profiles.pet_level 是 019/020 迁移一次性回填的历史缓存列，之后长期没有任何代码写入它，
      //    会永久停在回填时的值（实测学生 a 实际 16 级、profiles.pet_level 却仍是 5），
      //    表现为「任务系统里宠物等级 5 级封顶」。现在 feed-pet 已顺手刷新它，但它仍只是缓存。
      //    等级本身无上限（阶段=min(等级,max_stage)），所以这里不能加任何 MIN/LEAST 截断。
      const c = await scalar(pool,
        'SELECT COALESCE(MAX(growth_level), 1) AS c FROM student_pets WHERE student_id = ?',
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
 * 批量计算：一个学生 + 多个任务。
 *
 * 2026-10-23 优化（原实现是「每个任务串行一次查询」，27 个任务就是 27 次串行 RTT，
 * 实测 pending-count 均耗时 202ms、峰值 7.7s，是全场最慢的常规接口）：
 *   1) **按指标去重**：key = metric + params。任务表里 total_correct 一项就占了 4 个任务，
 *      原来同一个数被查了 4 遍；去重后 27 个任务只需 15 次查询。
 *   2) **有限并发**：单学生内并发跑，但限 6 路 —— 上课高峰 50 人同时刷新时，
 *      若一次性放 27 个并发会把连接池（100）瞬间打满，排队反而更慢。
 * 口径完全不变：同一个 key 的多个任务共用一个结果对象（buildStudentItem 只读不写）。
 */
const PROGRESS_CONCURRENCY = Math.max(1, Number(process.env.XGPY_PROGRESS_CONCURRENCY) || 6);

async function getProgressBatch(pool, tasks, studentId) {
  const out = {};
  if (!Array.isArray(tasks) || tasks.length === 0) return out;

  // 1) 去重：同 metric + 同 params 只算一次
  const groups = new Map(); // key -> { metric, params, taskIds }
  for (const t of tasks) {
    const params = t.metric_params || {};
    const key = `${t.metric}|${JSON.stringify(params)}`;
    const g = groups.get(key);
    if (g) g.taskIds.push(t.id);
    else groups.set(key, { metric: t.metric, params, taskIds: [t.id] });
  }

  // 2) 有限并发执行
  const entries = [...groups.values()];
  let cursor = 0;
  const workerCount = Math.min(PROGRESS_CONCURRENCY, entries.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= entries.length) return;
      const g = entries[i];
      let r;
      try {
        r = await getProgress(pool, g.metric, studentId, g.params);
      } catch (e) {
        r = { value: 0, text: '', error: e && e.message ? e.message : String(e) };
      }
      for (const id of g.taskIds) out[id] = r;
    }
  });
  await Promise.all(workers);
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
  getOpScore,
  DEFAULT_MASTER_THRESHOLD,
};
