'use strict';
/**
 * 桌面「学习星域」图层
 * ============================================================
 * 一层铺在学生桌面壁纸之上、图标之下的环境图层（前端 z-[5]，pointer-events-none）。
 * 随学生练习量成长：星星变多、星座点亮、行星入轨、极光铺开。
 *
 * 【核心口径】
 *  1) 档位只看「累计作答次数」（student_answers 行数，允许重复练同一题），只升不降。
 *     全库只有约 1100 道题，按「做过的不同题数」算永远到不了星海，所以必须按次数。
 *  2) 星座 = 章（16 章），星点 = 小节（AI 聚类的 cluster_id 二级，受 chapter-taxonomy 词表约束）。
 *  3) 小节点亮 = 该知识点「达到掌握阈值的题目占比」>= lit_ratio（默认 0.5）；
 *     章点亮 = 该章下所有小节都点亮。
 *     掌握阈值与练习门禁同源：system_config.master_question_threshold（默认 2 次答对）。
 *  4) 掌握只统计 source='practice'（与成就殿堂「新掌握题数」同一口径），
 *     测试/考试答对不计入掌握，避免考前刷一遍就全亮。
 *
 * 【性能】
 *  学生端每 10 秒轮询，这里做 30 秒内存缓存（按 studentId），50 人班级 ≈ 5 次/秒命中缓存。
 *  缓存由 PUT 配置时整体清空。
 */

const { CHAPTER_TAXONOMY, sectionCode } = require('./chapter-taxonomy');
const { getMasterThreshold } = require('./game-task-metrics');

/** 与 farm_config 一致：单行表，缺行时用这份默认值兜底 */
const DEFAULT_CFG = {
  enabled: 0,
  class_ids: null,
  daily_goal: 30,
  tier_2: 50,
  tier_3: 200,
  tier_4: 500,
  tier_5: 1000,
  lit_ratio: 0.5,
};

const TIER_NAMES = ['星尘', '初亮', '成图', '银河', '星海'];
const CACHE_TTL = 30 * 1000;
/** 题型隔离：操作题不进知识点进度（与全局 SQL_NOT_WPS_OP 同义） */
const NOT_OP_SQL = "q.type NOT IN ('wps_op','access_op')";

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function parseClassIds(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(String).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

/** 空数组 = 全校生效（与农场同一约定） */
function inScope(classIds, classId) {
  if (!classIds.length) return true;
  return classIds.includes(String(classId || ''));
}

/** 教材顺序的 16 章（星座锚点按这个顺序固定，前端据此取位置） */
function chapterOrder() {
  const out = [];
  CHAPTER_TAXONOMY.forEach((p) => {
    p.chapters.forEach((ch) => out.push({ name: ch.name, code: ch.code, part: p.partName }));
  });
  return out;
}

/** 连续练习天数：只看最近 120 个有作答的日期，从今天（或昨天）往前数 */
function calcStreak(dateRows) {
  if (!dateRows.length) return 0;
  const days = dateRows.map((r) => {
    const d = r.d instanceof Date ? r.d : new Date(r.d);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  });
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const ONE = 86400000;
  const set = new Set(days);
  // 今天没练但昨天练了，仍算「连续中」（当天还有机会补上）
  let cursor = set.has(t0) ? t0 : set.has(t0 - ONE) ? t0 - ONE : null;
  if (cursor === null) return 0;
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor -= ONE;
  }
  return streak;
}

/** 累计作答次数 → 档位（1..5） */
function tierOf(total, tiers) {
  let tier = 1;
  for (let i = tiers.length - 1; i >= 1; i--) {
    if (total >= tiers[i]) {
      tier = i + 1;
      break;
    }
  }
  return clamp(tier, 1, 5);
}

function registerStudyGalaxy(app, { pool, authenticate, requireTeacher, requireStudent }) {
  const cache = new Map(); // studentId -> { at, data: { granted, payload } }

  /**
   * 缓存清理：过期条目此前只在教师改配置（cache.clear）时才消失，
   * 全校几百号学生一天下来 Map 只涨不落（每人大约 10KB），属于慢性泄漏。
   * 超过 150 条时顺手清掉过期的；仍超过 CACHE_MAX 就按插入顺序淘汰最旧的。
   */
  const CACHE_MAX = 400;
  function pruneCache(now) {
    if (cache.size < 150) return;
    for (const [k, v] of cache) {
      if (now - v.at >= CACHE_TTL) cache.delete(k);
    }
    if (cache.size > CACHE_MAX) {
      let drop = cache.size - CACHE_MAX;
      for (const k of cache.keys()) {
        if (drop-- <= 0) break;
        cache.delete(k);
      }
    }
  }

  async function loadConfig() {
    const [rows] = await pool.query('SELECT * FROM study_galaxy_config WHERE id = 1');
    return rows[0] || Object.assign({ id: 1 }, DEFAULT_CFG);
  }

  function shapeTiers(cfg) {
    const t2 = Math.max(1, Math.round(num(cfg.tier_2, 50)));
    const t3 = Math.max(t2 + 1, Math.round(num(cfg.tier_3, 200)));
    const t4 = Math.max(t3 + 1, Math.round(num(cfg.tier_4, 500)));
    const t5 = Math.max(t4 + 1, Math.round(num(cfg.tier_5, 1000)));
    return [0, t2, t3, t4, t5];
  }

  // ------------------------------------------------------------
  // 学生端：桌面轮询
  // ------------------------------------------------------------
  app.get('/api/student/study-galaxy', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId || req.user.user_id;
      const cfg = await loadConfig();
      const classIds = parseClassIds(cfg.class_ids);
      const [[prof]] = await pool.query(
        'SELECT class_id FROM profiles WHERE id = ? LIMIT 1',
        [studentId]
      );
      const classId = prof ? prof.class_id : null;

      if (Number(cfg.enabled) !== 1) {
        return res.json({ data: { enabled: false, reason: 'closed' }, error: null });
      }
      if (!inScope(classIds, classId)) {
        return res.json({ data: { enabled: false, reason: 'out_of_scope' }, error: null });
      }

      const hit = cache.get(studentId);
      const now = Date.now();
      if (hit && now - hit.at < CACHE_TTL) {
        return res.json({ data: hit.payload, error: null });
      }

      const payload = await buildGalaxy(studentId, cfg);
      pruneCache(now);
      cache.set(studentId, { at: now, payload });
      res.json({ data: payload, error: null });
    } catch (error) {
      console.error('Error in GET /api/student/study-galaxy:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  async function buildGalaxy(studentId, cfg) {
    const tiers = shapeTiers(cfg);
    const dailyGoal = clamp(Math.round(num(cfg.daily_goal, 30)), 1, 500);
    const litRatio = clamp(num(cfg.lit_ratio, 0.5), 0.05, 1);
    const threshold = await getMasterThreshold(pool);

    // 1) 累计 / 今日
    //    （原来还算了 active_days 与「连续练习天数」，卡片改成「今日掌握题数」后已无人使用，
    //      白白多跑一次 DISTINCT 日期查询，2026-10-18 一并去掉）
    const [[agg]] = await pool.query(
      'SELECT COUNT(*) AS total, ' +
        'SUM(CASE WHEN created_at >= CURDATE() THEN 1 ELSE 0 END) AS today ' +
        'FROM student_answers WHERE student_id = ?',
      [studentId]
    );
    const totalAnswer = num(agg && agg.total, 0);
    const todayAnswer = num(agg && agg.today, 0);

    // 2) 今日新掌握题数：今天「首次跨过掌握线」的题。
    //    口径：该题累计答对次数已 ≥ 阈值，且「扣掉今天的答对次数」就不到阈值 → 说明是今天跨过去的。
    //    为什么不用「连续练习天数」：学校一周两节课，连续天数注定不好看，会误伤积极性。
    const [[todayMasteredRow]] = await pool.query(
      'SELECT COUNT(*) AS c FROM ( ' +
        '  SELECT question_id, ' +
        '    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS total_correct, ' +
        '    SUM(CASE WHEN is_correct = 1 AND created_at >= CURDATE() THEN 1 ELSE 0 END) AS today_correct ' +
        '  FROM student_answers WHERE student_id = ? AND source = ? GROUP BY question_id ' +
        ') t WHERE t.total_correct >= ? AND t.total_correct - t.today_correct < ?',
      [studentId, 'practice', threshold, threshold]
    );
    const todayMastered = num(todayMasteredRow && todayMasteredRow.c, 0);

    // 3) 知识点进度（按 cluster_id 聚合，只算带「章/小节」的二级分类）
    const [rows] = await pool.query(
      'SELECT q.cluster_id AS cluster, COUNT(*) AS total_q, ' +
        'SUM(CASE WHEN a.correct_cnt >= ? THEN 1 ELSE 0 END) AS mastered_q, ' +
        'SUM(CASE WHEN a.answer_cnt > 0 THEN 1 ELSE 0 END) AS touched_q ' +
        'FROM questions q LEFT JOIN ( ' +
        '  SELECT question_id, COUNT(*) AS answer_cnt, SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct_cnt ' +
        '  FROM student_answers WHERE student_id = ? AND source = ? GROUP BY question_id ' +
        ') a ON a.question_id = q.id ' +
        'WHERE ' + NOT_OP_SQL + " AND q.cluster_id IS NOT NULL AND q.cluster_id <> '' " +
        'GROUP BY q.cluster_id',
      [threshold, studentId, 'practice']
    );

    // 章 → 小节
    const byChapter = new Map();
    rows.forEach((r) => {
      const full = String(r.cluster || '');
      const idx = full.indexOf('/');
      if (idx <= 0) return; // 章级分类（无小节）不计入：既不占星位，也不污染比例
      const chapter = full.slice(0, idx);
      const section = full.slice(idx + 1);
      if (!byChapter.has(chapter)) byChapter.set(chapter, []);
      const totalQ = num(r.total_q, 0);
      const masteredQ = num(r.mastered_q, 0);
      byChapter.get(chapter).push({
        name: section,
        code: sectionCode(chapter, section),
        questions: totalQ,
        mastered_questions: masteredQ,
        touched: num(r.touched_q, 0) > 0,
        lit: totalQ > 0 && masteredQ / totalQ >= litRatio,
      });
    });

    const chapters = chapterOrder().map((ch) => {
      // 按小节编号（= 词表书写顺序）排序，不能用 localeCompare 拼音序 ——
      // 否则编号会显示成 1.1.3、1.1.1、1.1.2 这种乱序
      const sections = (byChapter.get(ch.name) || []).sort((a, b) => {
        if (a.code && b.code) return a.code.localeCompare(b.code, 'en', { numeric: true });
        return a.name.localeCompare(b.name, 'zh');
      });
      const qTotal = sections.reduce((s, x) => s + x.questions, 0);
      const qMastered = sections.reduce((s, x) => s + x.mastered_questions, 0);
      const litCount = sections.filter((x) => x.lit).length;
      return {
        name: ch.name,
        code: ch.code,
        part: ch.part,
        questions: qTotal,
        mastered_questions: qMastered,
        points: sections.length,
        points_lit: litCount,
        // 章点亮 = 该章所有小节都点亮（无小节的章永不点亮）
        lit: sections.length > 0 && litCount === sections.length,
        sections,
      };
    });

    const pointsTotal = chapters.reduce((s, c) => s + c.points, 0);
    const pointsMastered = chapters.reduce((s, c) => s + c.points_lit, 0);
    const qMasteredTotal = chapters.reduce((s, c) => s + c.mastered_questions, 0);
    const qTotalAll = chapters.reduce((s, c) => s + c.questions, 0);
    const chaptersLit = chapters.filter((c) => c.lit).length;

    // 4) 下一目标：优先「已开始但没点亮」里离点亮最近的，其次「未接触」里题量最少的
    let next = null;
    const active = [];
    const untouched = [];
    chapters.forEach((c) => {
      c.sections.forEach((s) => {
        if (s.lit) return;
        const remain = Math.max(0, s.questions - s.mastered_questions);
        const item = {
          chapter: c.name,
          chapter_code: c.code,
          section: s.name,
          section_code: s.code,
          remain,
          total: s.questions,
          mastered: s.mastered_questions,
        };
        (s.touched ? active : untouched).push(item);
      });
    });
    if (active.length) {
      active.sort((a, b) => a.remain - b.remain || b.mastered - a.mastered);
      next = active[0];
    } else if (untouched.length) {
      untouched.sort((a, b) => a.total - b.total);
      next = untouched[0];
    }

    const tier = tierOf(totalAnswer, tiers);
    return {
      enabled: true,
      tier,
      tier_name: TIER_NAMES[tier - 1],
      tiers,
      tier_names: TIER_NAMES,
      total_answer: totalAnswer,
      today_answer: todayAnswer,
      daily_goal: dailyGoal,
      master_threshold: threshold,
      summary: {
        chapters_lit: chaptersLit,
        chapters_total: chapters.filter((c) => c.points > 0).length,
        points_mastered: pointsMastered,
        points_total: pointsTotal,
        // 累计掌握题数（同一题累计答对 ≥ 掌握阈值）
        questions_mastered: qMasteredTotal,
        questions_total: qTotalAll,
        // 今日新掌握题数：今天首次跨过掌握线的题（桌面卡片第 3 格用它）
        today_mastered: todayMastered,
      },
      next,
      chapters,
    };
  }

  // ------------------------------------------------------------
  // 教师端：读配置
  // ------------------------------------------------------------
  app.get('/api/teacher/study-galaxy/config', authenticate, requireTeacher, async (req, res) => {
    try {
      const cfg = await loadConfig();
      const tiers = shapeTiers(cfg);
      // 用 created_at >= CURDATE() 而不是 DATE(created_at) = CURDATE()：
      // 列上套函数会让 created_at 索引彻底失效，全表扫；这条统计是全库范围，量大了会很明显。
      const [stat] = await pool.query(
        'SELECT COUNT(DISTINCT student_id) AS today_students, COUNT(*) AS today_answers ' +
          'FROM student_answers WHERE created_at >= CURDATE()'
      );
      res.json({
        data: {
          config: {
            enabled: Number(cfg.enabled) === 1,
            class_ids: parseClassIds(cfg.class_ids),
            daily_goal: clamp(Math.round(num(cfg.daily_goal, 30)), 1, 500),
            tiers,
            tier_names: TIER_NAMES,
            lit_ratio: num(cfg.lit_ratio, 0.5),
          },
          stats: {
            today_students: num(stat && stat[0] && stat[0].today_students, 0),
            today_answers: num(stat && stat[0] && stat[0].today_answers, 0),
          },
          updated_at: cfg.updated_at || null,
        },
        error: null,
      });
    } catch (error) {
      console.error('Error in GET /api/teacher/study-galaxy/config:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // ------------------------------------------------------------
  // 教师端：写配置
  // ------------------------------------------------------------
  app.put('/api/teacher/study-galaxy/config', authenticate, requireTeacher, async (req, res) => {
    try {
      const teacherId = req.user.userId || req.user.user_id;
      const b = req.body || {};
      const cfg = await loadConfig();

      const enabled = b.enabled === true || b.enabled === 1 || b.enabled === '1' ? 1 : 0;
      const classIds = Array.isArray(b.class_ids)
        ? b.class_ids.map(String).filter(Boolean)
        : parseClassIds(b.class_ids);
      const dailyGoal = clamp(Math.round(num(b.daily_goal, cfg.daily_goal)), 1, 500);

      // 五档阈值：未传则保留原值；传了必须严格递增，否则整批拒绝（回滚到原值）
      const raw = Array.isArray(b.tiers) ? b.tiers : null;
      let t2 = Math.round(num(cfg.tier_2, 50));
      let t3 = Math.round(num(cfg.tier_3, 200));
      let t4 = Math.round(num(cfg.tier_4, 500));
      let t5 = Math.round(num(cfg.tier_5, 1000));
      if (raw) {
        const nums = raw.slice(0, 5).map((x) => Math.round(num(x, 0)));
        if (nums.length < 5) return res.status(400).json({ data: null, error: '阈值必须是 5 个数' });
        if (nums[0] !== 0) return res.status(400).json({ data: null, error: '第一档（星尘）固定从 0 开始' });
        for (let i = 1; i < 5; i++) {
          if (!(nums[i] > nums[i - 1])) {
            return res.status(400).json({ data: null, error: '五档阈值必须严格递增' });
          }
        }
        if (nums[4] > 1000000) return res.status(400).json({ data: null, error: '阈值过大' });
        t2 = nums[1];
        t3 = nums[2];
        t4 = nums[3];
        t5 = nums[4];
      }

      const litRatio =
        b.lit_ratio === undefined ? num(cfg.lit_ratio, 0.5) : clamp(num(b.lit_ratio, 0.5), 0.05, 1);

      await pool.query(
        'UPDATE study_galaxy_config SET enabled=?, class_ids=?, daily_goal=?, tier_2=?, tier_3=?, tier_4=?, ' +
          'tier_5=?, lit_ratio=?, updated_by=? WHERE id = 1',
        [enabled, classIds.length ? JSON.stringify(classIds) : null, dailyGoal, t2, t3, t4, t5, litRatio, teacherId]
      );
      cache.clear();

      res.json({ data: { ok: true, tiers: [0, t2, t3, t4, t5] }, error: null });
    } catch (error) {
      console.error('Error in PUT /api/teacher/study-galaxy/config:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });
}

module.exports = {
  registerStudyGalaxy,
  // 导出给回归脚本与前端文案复用
  TIER_NAMES,
  DEFAULT_TIERS: [0, 50, 200, 500, 1000],
  tierOf,
  calcStreak,
};
