'use strict';
/**
 * 星卡学院（原 Python魔法学院重构）后端 2026-11-16
 *
 * 玩法：16 章 = 16 座建筑，70 个知识点 = 70 张星卡（每张三阶）。
 * 节奏：吴老定 70 个知识点必须 35 节课内走完 → 每课 2 个知识点（LESSON_PLAN）。
 *
 * ⛔ 三条不可破坏的边界：
 *   1. **不写 student_answers**：学院判分是独立的，不污染练习模块的统计与掌握判定
 *      （掌握口径是全平台共用的，学院进去一写，练习的「已掌握」就会莫名变化）。
 *   2. **不发积分**：只发魔力（纯游戏内数值）与钻石（走平台每日产出上限）。
 *   3. **cluster_id 必须与 questions.cluster_id 完全同口径**，否则卡和题对不上。
 */
const { CHAPTER_TAXONOMY } = require('./chapter-taxonomy');
const pool = require('./db');
const { grantDiamonds } = require('./diamond');

/** 学生一次答题给多少魔力 / 答错给多少（保证错的人也在前进，只是慢） */
const MANA_CORRECT = 5;
const MANA_WRONG = 1;
const MANA_HINT_COST = 10;
const MAX_STAGE = 3;

// ---------- 课程表：70 节按教材顺序两两一课，共 35 课 ----------
const LESSON_PLAN = (() => {
  const cards = [];
  for (const part of CHAPTER_TAXONOMY) {
    for (const ch of part.chapters) {
      for (const sec of ch.sections) {
        cards.push({
          cluster_id: `${ch.name}/${sec}`,
          chapter_code: ch.code,
          chapter_name: ch.name,
          section: sec,
          part: part.part,
        });
      }
    }
  }
  const lessons = [];
  for (let i = 0; i < cards.length; i += 2) {
    lessons.push({ idx: lessons.length + 1, cards: cards.slice(i, i + 2) });
  }
  return { cards, lessons, total: cards.length, lessonCount: lessons.length };
})();

/** 16 座建筑（每章一座） */
const BUILDINGS = (() => {
  const list = [];
  for (const part of CHAPTER_TAXONOMY) {
    for (const ch of part.chapters) {
      list.push({
        chapter_code: ch.code,
        chapter_name: ch.name,
        part: part.part,
        section_total: ch.sections.length,
        max_stars: ch.sections.length * MAX_STAGE,
      });
    }
  }
  return list;
})();

const CARD_INDEX = new Map(LESSON_PLAN.cards.map((c, i) => [c.cluster_id, { ...c, order: i }]));

/** 星数 → 学院等级（1-10，纯外观用，不给战力） */
function levelOf(stars) {
  if (stars <= 0) return 1;
  return Math.max(1, Math.min(10, Math.ceil(stars / 21)));
}

function readConfigValue(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && 'value' in v) return v.value;
    return v;
  } catch {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }
}

async function getAcademyConfig() {
  const cfg = { enabled: 1, diamond_per_lesson: 1, cards_per_lesson: 2 };
  try {
    const [rows] = await pool.query(
      "SELECT config_key, value FROM system_config WHERE config_key LIKE 'academy\\_%'"
    );
    for (const r of rows) {
      const key = String(r.config_key || '').slice('academy_'.length);
      if (key === 'enabled') cfg.enabled = Number(readConfigValue(r.value, 1)) ? 1 : 0;
      if (key === 'diamond_per_lesson') cfg.diamond_per_lesson = Math.max(0, Number(readConfigValue(r.value, 1)) || 0);
      if (key === 'cards_per_lesson') cfg.cards_per_lesson = Math.max(1, Number(readConfigValue(r.value, 2)) || 2);
    }
  } catch (e) {
    console.warn('[academy] 读配置失败，用默认值:', e.message);
  }
  return cfg;
}

async function classLessonIdx(classId) {
  if (!classId) return 1;
  try {
    const [[row]] = await pool.query(
      'SELECT lesson_idx FROM academy_class_lesson WHERE class_id = ? LIMIT 1',
      [classId]
    );
    const n = Number(row && row.lesson_idx);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  } catch {
    return 1;
  }
}

async function ensureProfile(studentId) {
  await pool.query(
    `INSERT INTO academy_profiles (student_id) VALUES (?)
     ON DUPLICATE KEY UPDATE student_id = student_id`,
    [studentId]
  );
  const [[row]] = await pool.query('SELECT * FROM academy_profiles WHERE student_id = ?', [studentId]);
  return row;
}

async function loadCards(studentId) {
  const [rows] = await pool.query(
    'SELECT cluster_id, stage, correct_cnt, wrong_cnt FROM academy_cards WHERE student_id = ?',
    [studentId]
  );
  const map = new Map();
  rows.forEach((r) => map.set(r.cluster_id, {
    stage: Number(r.stage) || 0,
    correct_cnt: Number(r.correct_cnt) || 0,
    wrong_cnt: Number(r.wrong_cnt) || 0,
  }));
  return map;
}

function starsOf(cards) {
  let s = 0;
  cards.forEach((c) => { s += Math.min(MAX_STAGE, Number(c.stage) || 0); });
  return s;
}

function buildingsOf(cards) {
  return BUILDINGS.map((b) => {
    let stars = 0;
    let lit = 0;
    LESSON_PLAN.cards
      .filter((c) => c.chapter_name === b.chapter_name)
      .forEach((c) => {
        const st = cards.get(c.cluster_id)?.stage || 0;
        stars += st;
        if (st > 0) lit += 1;
      });
    return {
      ...b,
      stars,
      lit,
      percent: b.max_stars ? Math.round((stars / b.max_stars) * 100) : 0,
    };
  });
}

/** 取一张卡的题目（脱敏：不带 answers / explanation） */
async function pickQuestion(clusterId) {
  const [rows] = await pool.query(
    `SELECT id, type, content, options, cluster_id FROM questions
      WHERE practice_enabled = 1 AND type = 'choice' AND cluster_id = ?
      ORDER BY RAND() LIMIT 1`,
    [clusterId]
  );
  if (!rows.length) return null;
  const q = rows[0];
  let options = [];
  try {
    const parsed = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    options = Array.isArray(parsed?.options) ? parsed.options : (Array.isArray(parsed) ? parsed : []);
  } catch { options = []; }
  return { id: q.id, type: q.type, content: q.content, options, cluster_id: q.cluster_id };
}

/** 服务端判分（单选题：答案形如 {"answers":["D"]}） */
function judgeChoice(answerRaw, answersField) {
  let correct = '';
  try {
    const parsed = typeof answersField === 'string' ? JSON.parse(answersField) : answersField;
    const arr = Array.isArray(parsed?.answers) ? parsed.answers : (Array.isArray(parsed) ? parsed : [parsed]);
    correct = String(arr[0] || '').trim().toUpperCase();
  } catch { correct = ''; }
  const got = String(answerRaw || '').trim().toUpperCase();
  // 兼容前端直接传 "D" 或 "D. xxx"
  const letter = /^[A-F]/.exec(got) ? got[0] : got;
  return { correct: !!correct && letter === correct, right: correct };
}

module.exports = function attachAcademy(app, deps) {
  const { authenticate, requireTeachingRole } = deps;

  // ---------- 学生端：学院状态 ----------
  app.get('/api/student/academy/state', authenticate, async (req, res) => {
    try {
      const studentId = req.user.userId || req.user.id;
      const cfg = await getAcademyConfig();
      const profile = await ensureProfile(studentId);
      const cards = await loadCards(studentId);
      const stars = starsOf(cards);

      const [[prow]] = await pool.query(
        'SELECT class_id, COALESCE(diamond_balance,0) AS diamond_balance FROM profiles WHERE id = ?',
        [studentId]
      );
      const lessonIdx = await classLessonIdx(prow && prow.class_id);
      const lesson = LESSON_PLAN.lessons[lessonIdx - 1] || LESSON_PLAN.lessons[0];

      const lessonCards = lesson.cards.map((c) => {
        const st = cards.get(c.cluster_id) || { stage: 0, correct_cnt: 0, wrong_cnt: 0 };
        return { ...c, ...st };
      });

      res.json({
        data: {
          enabled: !!cfg.enabled,
          profile: {
            level: levelOf(stars),
            stars,
            star_max: LESSON_PLAN.total * MAX_STAGE,
            mana: Number(profile.mana) || 0,
            stardust: Number(profile.stardust) || 0,
            streak_days: Number(profile.streak_days) || 0,
            total_answered: Number(profile.total_answered) || 0,
            total_correct: Number(profile.total_correct) || 0,
            diamond_balance: Number(prow && prow.diamond_balance) || 0,
          },
          lesson: {
            idx: lessonIdx,
            total: LESSON_PLAN.lessonCount,
            cards: lessonCards,
            done: lessonCards.every((c) => c.stage >= 1),
          },
          buildings: buildingsOf(cards),
          card_total: LESSON_PLAN.total,
          lit_count: LESSON_PLAN.cards.filter((c) => (cards.get(c.cluster_id)?.stage || 0) > 0).length,
          config: { diamond_per_lesson: cfg.diamond_per_lesson },
        },
        error: null,
      });
    } catch (e) {
      console.error('[academy] state 失败:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---------- 学生端：取一张卡的题 ----------
  app.get('/api/student/academy/question', authenticate, async (req, res) => {
    try {
      const clusterId = String(req.query.cluster_id || '').trim();
      if (!CARD_INDEX.has(clusterId)) {
        return res.status(400).json({ data: null, error: '知识点不存在' });
      }
      const q = await pickQuestion(clusterId);
      if (!q) {
        // 该节没题：概念卡（学生读一段要点即可点亮，不依赖题库）
        return res.json({
          data: {
            kind: 'concept',
            cluster_id: clusterId,
            title: CARD_INDEX.get(clusterId).section,
            points: [
              '这一节暂时没有配套练习题。',
              '先记住它的定义与用途，下次遇到同类题先判断它考查的是概念还是应用。',
            ],
          },
          error: null,
        });
      }
      res.json({ data: { kind: 'question', ...q }, error: null });
    } catch (e) {
      console.error('[academy] question 失败:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---------- 学生端：答题 ----------
  app.post('/api/student/academy/answer', authenticate, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const studentId = req.user.userId || req.user.id;
      const clusterId = String((req.body && req.body.cluster_id) || '').trim();
      const questionId = String((req.body && req.body.question_id) || '').trim();
      const answer = (req.body && req.body.answer) || '';

      if (!CARD_INDEX.has(clusterId)) {
        return res.status(400).json({ data: null, error: '知识点不存在' });
      }

      let isCorrect = false;
      let right = '';
      let explanation = '';
      if (questionId) {
        const [[q]] = await conn.query(
          "SELECT answers, cluster_id, explanation FROM questions WHERE id = ? AND type = 'choice' LIMIT 1",
          [questionId]
        );
        if (!q) return res.status(404).json({ data: null, error: '题目不存在' });
        // ⛔ 防作弊：题目必须属于这个知识点，否则学生可以拿别的题的答案来刷这张卡
        if (String(q.cluster_id) !== clusterId) {
          return res.status(400).json({ data: null, error: '题目与知识点不匹配' });
        }
        const judged = judgeChoice(answer, q.answers);
        isCorrect = judged.correct;
        right = judged.right;
        explanation = q.explanation || '';
      } else {
        // 概念卡：没有题，直接算通过
        isCorrect = true;
      }

      // ⛔ ensureProfile 走 pool 的独立连接，必须在事务外做完；
      //    在事务里调用会和下面的 FOR UPDATE 抢同一行锁 → 死锁
      await ensureProfile(studentId);

      await conn.beginTransaction();

      const today = new Date().toISOString().slice(0, 10);

      const [[card]] = await conn.query(
        'SELECT stage, correct_cnt, wrong_cnt FROM academy_cards WHERE student_id = ? AND cluster_id = ? FOR UPDATE',
        [studentId, clusterId]
      );
      // ⛔ 同一张卡一天只升一阶：否则学生一晚上连点同一题就能把 210 星刷满，
      //    「一学年养成」直接变成「一小时通关」。题意也会变成背答案。
      const [[todayRow]] = await conn.query(
        'SELECT correct FROM academy_daily WHERE student_id = ? AND day = ? AND cluster_id = ?',
        [studentId, today, clusterId]
      );
      const alreadyCountedToday = !!todayRow && Number(todayRow.correct) === 1;
      const countThisTime = isCorrect && !alreadyCountedToday;

      const prevCorrect = Number(card?.correct_cnt) || 0;
      const prevWrong = Number(card?.wrong_cnt) || 0;
      const newCorrect = prevCorrect + (countThisTime ? 1 : 0);
      const newWrong = prevWrong + (isCorrect ? 0 : 1);
      const newStage = Math.min(MAX_STAGE, newCorrect);

      await conn.query(
        `INSERT INTO academy_cards (student_id, cluster_id, stage, correct_cnt, wrong_cnt, last_at)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE stage = VALUES(stage), correct_cnt = VALUES(correct_cnt),
                                 wrong_cnt = VALUES(wrong_cnt), last_at = NOW()`,
        [studentId, clusterId, newStage, newCorrect, newWrong]
      );

      // 档案：魔力、累计、连续天数（行已在事务外建好）
      const [[prof]] = await conn.query('SELECT * FROM academy_profiles WHERE student_id = ? FOR UPDATE', [studentId]);
      const lastDate = prof.last_active_date ? new Date(prof.last_active_date).toISOString().slice(0, 10) : '';
      let streak = Number(prof.streak_days) || 0;
      if (lastDate !== today) {
        const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        streak = lastDate === yest ? streak + 1 : 1;
      }
      const manaGain = isCorrect ? MANA_CORRECT : MANA_WRONG;
      await conn.query(
        `UPDATE academy_profiles
            SET mana = mana + ?, streak_days = ?, last_active_date = ?,
                total_answered = total_answered + 1, total_correct = total_correct + ?
          WHERE student_id = ?`,
        [manaGain, streak, today, isCorrect ? 1 : 0, studentId]
      );

      // 今日委托记录（仅作展示与"今天做过什么"，发钻不看它）
      await conn.query(
        `INSERT INTO academy_daily (student_id, day, cluster_id, question_id, done, correct, picked_at)
         VALUES (?, ?, ?, ?, 1, ?, NOW())
         ON DUPLICATE KEY UPDATE done = 1, correct = GREATEST(correct, VALUES(correct)), question_id = VALUES(question_id)`,
        [studentId, today, clusterId, questionId || null, isCorrect ? 1 : 0]
      );

      // 本课两卡都点亮 → 首通发钻（幂等靠 source_id = 课次）
      const [[prow]] = await conn.query('SELECT class_id FROM profiles WHERE id = ?', [studentId]);
      const lessonIdx = await classLessonIdx(prow && prow.class_id);
      const lesson = LESSON_PLAN.lessons[lessonIdx - 1] || LESSON_PLAN.lessons[0];
      const [lessonStages] = await conn.query(
        `SELECT cluster_id, stage FROM academy_cards
          WHERE student_id = ? AND cluster_id IN (?)`,
        [studentId, lesson.cards.map((c) => c.cluster_id)]
      );
      const stageMap = new Map(lessonStages.map((r) => [r.cluster_id, Number(r.stage) || 0]));
      const lessonDone = lesson.cards.every((c) => (stageMap.get(c.cluster_id) || 0) >= 1);

      const cfg = await getAcademyConfig();
      let diamondEarned = 0;
      let diamondBlocked = '';
      if (lessonDone && cfg.diamond_per_lesson > 0) {
        const r = await grantDiamonds(conn, {
          studentId,
          amount: cfg.diamond_per_lesson,
          reason: `星卡学院第 ${lessonIdx} 课首通`,
          sourceType: 'academy',
          sourceId: `lesson-${lessonIdx}`,
        });
        if (r.granted) diamondEarned = r.amount;
        else if (r.reason === 'daily_cap') diamondBlocked = 'daily_cap';
      }

      // 重算星数（70 行内，逐次算可接受；比增量维护更不容易错）
      const [allCards] = await conn.query(
        'SELECT stage FROM academy_cards WHERE student_id = ?',
        [studentId]
      );
      const stars = starsOf(new Map(allCards.map((r, i) => [i, r])));
      await conn.query('UPDATE academy_profiles SET stars = ?, level = ? WHERE student_id = ?',
        [stars, levelOf(stars), studentId]);

      await conn.commit();

      const [[fresh]] = await pool.query('SELECT mana, stardust FROM academy_profiles WHERE student_id = ?', [studentId]);
      res.json({
        data: {
          correct: isCorrect,
          right,
          explanation,
          cluster_id: clusterId,
          stage: newStage,
          stage_up: newStage > (Number(card?.stage) || 0),
          counted_today: countThisTime,
          already_counted: isCorrect && alreadyCountedToday,
          stars,
          level: levelOf(stars),
          mana: Number(fresh?.mana) || 0,
          lesson_done: lessonDone,
          diamond_earned: diamondEarned,
          diamond_blocked: diamondBlocked,
        },
        error: null,
      });
    } catch (e) {
      try { await conn.rollback(); } catch { /* ignore */ }
      console.error('[academy] answer 失败:', e);
      res.status(500).json({ data: null, error: e.message });
    } finally {
      conn.release();
    }
  });

  // ---------- 学生端：买提示（排除两个错误选项） ----------
  app.post('/api/student/academy/hint', authenticate, async (req, res) => {
    try {
      const studentId = req.user.userId || req.user.id;
      const questionId = String((req.body && req.body.question_id) || '').trim();
      if (!questionId) return res.status(400).json({ data: null, error: '缺少题目' });

      const [[q]] = await pool.query('SELECT answers, options FROM questions WHERE id = ? LIMIT 1', [questionId]);
      if (!q) return res.status(404).json({ data: null, error: '题目不存在' });

      const judged = judgeChoice('', q.answers);
      let opts = [];
      try {
        const parsed = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
        opts = Array.isArray(parsed?.options) ? parsed.options : (Array.isArray(parsed) ? parsed : []);
      } catch { opts = []; }
      const letters = opts.map((o) => String(o).trim()[0]).filter((c) => /[A-F]/i.test(c));
      const wrong = letters.filter((c) => c.toUpperCase() !== judged.right).slice(0, 2);

      const profile = await ensureProfile(studentId);
      if ((Number(profile.mana) || 0) < MANA_HINT_COST) {
        return res.status(400).json({ data: null, error: `魔力不足，需要 ${MANA_HINT_COST} 点` });
      }
      await pool.query('UPDATE academy_profiles SET mana = mana - ? WHERE student_id = ?', [MANA_HINT_COST, studentId]);
      const [[fresh]] = await pool.query('SELECT mana FROM academy_profiles WHERE student_id = ?', [studentId]);

      res.json({ data: { eliminate: wrong, cost: MANA_HINT_COST, mana: Number(fresh?.mana) || 0 }, error: null });
    } catch (e) {
      console.error('[academy] hint 失败:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---------- 学生端：图鉴（70 张卡全量） ----------
  app.get('/api/student/academy/dex', authenticate, async (req, res) => {
    try {
      const studentId = req.user.userId || req.user.id;
      const cards = await loadCards(studentId);
      const items = LESSON_PLAN.cards.map((c) => {
        const st = cards.get(c.cluster_id) || { stage: 0, correct_cnt: 0, wrong_cnt: 0 };
        return { ...c, ...st };
      });
      res.json({ data: { items, total: items.length, buildings: buildingsOf(cards) }, error: null });
    } catch (e) {
      console.error('[academy] dex 失败:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---------- 学生端：班内排行（按星数，不按刷题量） ----------
  app.get('/api/student/academy/rank', authenticate, async (req, res) => {
    try {
      const studentId = req.user.userId || req.user.id;
      const [[me]] = await pool.query('SELECT class_id FROM profiles WHERE id = ?', [studentId]);
      if (!me || !me.class_id) return res.json({ data: { items: [], me: null }, error: null });
      const [rows] = await pool.query(
        `SELECT p.id, p.username, p.real_name, COALESCE(a.stars,0) AS stars, COALESCE(a.level,1) AS level
           FROM profiles p
           LEFT JOIN academy_profiles a ON a.student_id = p.id
          WHERE p.class_id = ? AND p.role = 'student'
          ORDER BY stars DESC, p.username ASC
          LIMIT 30`,
        [me.class_id]
      );
      const items = rows.map((r, i) => ({
        rank: i + 1,
        student_id: r.id,
        name: r.real_name || r.username,
        stars: Number(r.stars) || 0,
        level: Number(r.level) || 1,
        is_me: r.id === studentId,
      }));
      res.json({ data: { items, me: items.find((x) => x.is_me) || null }, error: null });
    } catch (e) {
      console.error('[academy] rank 失败:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---------- 老师端：总览 ----------
  app.get('/api/teacher/academy/overview', authenticate, requireTeachingRole, async (req, res) => {
    try {
      const classId = String(req.query.class_id || '').trim();
      if (!classId) return res.status(400).json({ data: null, error: '请选择班级' });
      const cfg = await getAcademyConfig();
      const lessonIdx = await classLessonIdx(classId);

      // 全班星数分布
      const [rows] = await pool.query(
        `SELECT p.id, p.username, p.real_name, COALESCE(a.stars,0) stars, COALESCE(a.level,1) lv,
                COALESCE(a.total_answered,0) ans
           FROM profiles p LEFT JOIN academy_profiles a ON a.student_id = p.id
          WHERE p.class_id = ? AND p.role = 'student'
          ORDER BY stars DESC`,
        [classId]
      );
      const list = rows.map((r) => ({
        student_id: r.id,
        name: r.real_name || r.username,
        username: r.username,
        stars: Number(r.stars) || 0,
        level: Number(r.lv) || 1,
        answered: Number(r.ans) || 0,
        percent: Math.round(((Number(r.stars) || 0) / (LESSON_PLAN.total * MAX_STAGE)) * 100),
      }));

      res.json({
        data: {
          config: {
            enabled: !!cfg.enabled,
            diamond_per_lesson: cfg.diamond_per_lesson,
            cards_per_lesson: cfg.cards_per_lesson,
          },
          lesson: {
            idx: lessonIdx,
            total: LESSON_PLAN.lessonCount,
            cards: (LESSON_PLAN.lessons[lessonIdx - 1] || LESSON_PLAN.lessons[0]).cards,
          },
          lessons: LESSON_PLAN.lessons.map((l) => ({
            idx: l.idx,
            titles: l.cards.map((c) => `${c.chapter_code} ${c.section}`),
          })),
          students: list,
          card_total: LESSON_PLAN.total,
        },
        error: null,
      });
    } catch (e) {
      console.error('[academy] teacher overview 失败:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---------- 老师端：保存配置 ----------
  app.put('/api/teacher/academy/config', authenticate, requireTeachingRole, async (req, res) => {
    try {
      const body = req.body || {};
      const saved = [];
      const setCfg = async (key, value) => {
        await pool.query(
          `INSERT INTO system_config (id, config_key, value, updated_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
          [`config_academy_${key}`, `academy_${key}`, JSON.stringify({ value })]
        );
        saved.push(key);
      };

      if (body.enabled !== undefined) await setCfg('enabled', Number(body.enabled) ? 1 : 0);
      if (body.diamond_per_lesson !== undefined) {
        const n = Math.min(10, Math.max(0, Math.round(Number(body.diamond_per_lesson) || 0)));
        await setCfg('diamond_per_lesson', n);
      }
      if (body.cards_per_lesson !== undefined) {
        const n = Math.min(4, Math.max(1, Math.round(Number(body.cards_per_lesson) || 2)));
        await setCfg('cards_per_lesson', n);
      }

      const classId = String(body.class_id || '').trim();
      if (classId && body.lesson_idx !== undefined) {
        const n = Math.min(LESSON_PLAN.lessonCount, Math.max(1, Math.round(Number(body.lesson_idx) || 1)));
        await pool.query(
          `INSERT INTO academy_class_lesson (class_id, lesson_idx, updated_by)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE lesson_idx = VALUES(lesson_idx), updated_by = VALUES(updated_by)`,
          [classId, n, req.user.userId || req.user.id || null]
        );
        saved.push('lesson_idx');
      }

      res.json({ data: { saved }, error: null });
    } catch (e) {
      console.error('[academy] teacher config 失败:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 课程表（前端展示 35 课，也便于老师核对顺序）
  app.get('/api/teacher/academy/lessons', authenticate, requireTeachingRole, async (req, res) => {
    res.json({
      data: {
        total: LESSON_PLAN.lessonCount,
        card_total: LESSON_PLAN.total,
        lessons: LESSON_PLAN.lessons.map((l) => ({
          idx: l.idx,
          cards: l.cards.map((c) => ({ cluster_id: c.cluster_id, chapter_code: c.chapter_code, section: c.section })),
        })),
        buildings: BUILDINGS,
      },
      error: null,
    });
  });
};

module.exports.LESSON_PLAN = LESSON_PLAN;
module.exports.BUILDINGS = BUILDINGS;
