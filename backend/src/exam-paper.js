'use strict';

/**
 * 试卷题目装载与判分（2026-11-17 吴老需求）
 * ============================================================
 * 一张试卷现在可以混三种题：
 *   · 选择题     questions.type = 'choice'     2 分/题
 *   · 综合题     questions.type = 'composite'  20 分/题（按小题结分）
 *   · 编程填空题 python_tasks.task_type='fill_blank'  10 分/题（按空权重结分）
 *
 * 三种题的 id 空间不同（questions.id / python_tasks.id），所以 tests.question_ids 里
 * **编程题用 `py:` 前缀**。前缀是唯一区分依据 —— 不要靠「去 questions 表查不到就是编程题」，
 * 那样题库里被删掉的题会被误判成编程题。
 *
 * 三条硬约束（写在这里当备忘）：
 *   1. 下发给浏览器的题目**必须剥掉标准答案**（choice/composite 的 answers、python 的 blank_answers）。
 *      老代码在 startExam 里 `select('*')` 把 answers 一起发给了前端 —— 那是历史遗留，新接口不允许重复。
 *   2. 判分只认服务端取到的题库/作业表数据，绝不采信前端传上来的题目内容。
 *   3. 满分按「题」累加，不按小题累加：一道综合题不管几个小题都是 20 分。
 */

const CHOICE_SCORE = 2;
const COMPOSITE_SCORE = 20;
const PYTHON_SCORE = 10;
const PYTHON_PREFIX = 'py:';

const { taskGetAnswersArray, taskCheckAnswerCorrect, judgeFillBlankAnswer } = require('./composite-score');

/** 是否是编程填空题的条目 id */
function isPythonItem(itemId) {
  return typeof itemId === 'string' && itemId.startsWith(PYTHON_PREFIX);
}

/** `py:xxx` → `xxx` */
function pythonTaskIdOf(itemId) {
  return String(itemId || '').slice(PYTHON_PREFIX.length);
}

/** 把 tests.question_ids（数组或 JSON 字符串）正规化成去重、保序的字符串数组 */
function parseItemIds(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const id = typeof x === 'string' ? x.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 按条目的题型算该题满分（未知类型按选择题算，宁可少给分也不凭空放大） */
function scoreOfKind(kind) {
  if (kind === 'composite') return COMPOSITE_SCORE;
  if (kind === 'python') return PYTHON_SCORE;
  return CHOICE_SCORE;
}

/** 综合题小题的最小化结构：给前端渲染用，**不含正确答案** */
function publicSubQuestions(correctField) {
  const subs = taskGetAnswersArray(correctField);
  return subs.map((sq, idx) => ({
    index: sq && sq.index != null ? sq.index : idx + 1,
    type: sq && (sq.type === 'fill_blank' ? 'fill_blank' : 'choice'),
    multiple: !!(sq && sq.multiple),
    content: sq && sq.content ? sq.content : '',
    options: Array.isArray(sq && sq.options) ? sq.options : [],
    score: Number(sq && sq.score) || 0,
    // 填空小题的 answers 是「每空一个可接受答案数组」，长度就是空数
    blank_count: sq && sq.type === 'fill_blank'
      ? Math.max(1, taskGetAnswersArray(sq.answers).length)
      : 0,
  }));
}

/** 编程填空题：模板里 ①②③ 的个数才是「几空」，答案数组长度可能与之不符 */
const BLANK_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
function countTemplateBlanks(template) {
  const text = String(template || '');
  let n = 0;
  for (const m of BLANK_MARKS) {
    let from = 0;
    while (true) {
      const at = text.indexOf(m, from);
      if (at < 0) break;
      n += 1;
      from = at + m.length;
    }
  }
  return n;
}

/**
 * 装载一张试卷（service 端用）。
 * 返回 items 顺序 = question_ids 顺序（试卷顺序由老师排定，不随机）。
 *
 * item: {
 *   item_id, kind, question_id|task_id, type, content, options,
 *   sub_questions?, blank_template?, blank_count?,
 *   score, answer（服务端内部用，**不要原样返回给前端**）
 * }
 */
async function loadPaper(client, testId) {
  const [[test]] = await client.query(
    'SELECT id, title, question_ids, question_count, time_limit, paper_total FROM tests WHERE id = ?',
    [testId]
  );
  if (!test) return null;

  const allIds = parseItemIds(test.question_ids);
  const qIds = allIds.filter((id) => !isPythonItem(id));
  const pyIds = allIds.filter((id) => isPythonItem(id)).map(pythonTaskIdOf);

  const questionMap = new Map();
  if (qIds.length) {
    const [rows] = await client.query(
      'SELECT id, type, content, options, answers, explanation, cluster_id FROM questions WHERE id IN (?)',
      [qIds]
    );
    rows.forEach((r) => questionMap.set(r.id, r));
  }
  const taskMap = new Map();
  if (pyIds.length) {
    const [rows] = await client.query(
      `SELECT id, title, description, blank_template, blank_answers, blank_weights, total_score
         FROM python_tasks WHERE id IN (?) AND task_type = 'fill_blank'`,
      [pyIds]
    );
    rows.forEach((r) => taskMap.set(r.id, r));
  }

  const items = [];
  for (const id of allIds) {
    if (isPythonItem(id)) {
      const t = taskMap.get(pythonTaskIdOf(id));
      if (!t) continue; // 作业被删 → 跳过，不占分
      const blankCount = Math.max(1, countTemplateBlanks(t.blank_template) || taskGetAnswersArray(t.blank_answers).length);
      items.push({
        item_id: id,
        kind: 'python',
        task_id: t.id,
        type: 'python_fill',
        content: t.title || '',
        description: t.description || '',
        blank_template: t.blank_template || '',
        blank_count: blankCount,
        score: PYTHON_SCORE,
        answer: { blank_answers: t.blank_answers, blank_weights: t.blank_weights },
      });
      continue;
    }
    const q = questionMap.get(id);
    if (!q) continue;
    if (q.type === 'composite') {
      const subs = publicSubQuestions(q.answers);
      items.push({
        item_id: id,
        kind: 'composite',
        question_id: q.id,
        type: 'composite',
        content: q.content || '',
        options: [],
        sub_questions: subs,
        score: COMPOSITE_SCORE,
        explanation: q.explanation || '',
        answer: q.answers,
      });
    } else if (q.type === 'choice') {
      let options = [];
      try {
        const parsed = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
        options = Array.isArray(parsed?.options) ? parsed.options : (Array.isArray(parsed) ? parsed : []);
      } catch { options = []; }
      items.push({
        item_id: id,
        kind: 'choice',
        question_id: q.id,
        type: 'choice',
        content: q.content || '',
        options,
        score: CHOICE_SCORE,
        explanation: q.explanation || '',
        answer: q.answers,
      });
    }
    // wps_op / access_op / fill_blank（题库填空）不进试卷：操作题要判文件，题库填空没启用
  }

  // ⛔ 抽题**不**在这里做：抽题结果必须落到 exam_records.selected_question_ids 固定下来，
  //    否则同一场考试刷新一次就换一套题，判分和「按题目查看」都无从对齐。
  //    这里只返回整卷，抽题见 pickItemIds()。
  const picked = items;
  const paperTotal = picked.reduce((s, it) => s + scoreOfKind(it.kind), 0);
  return {
    test,
    items: picked,
    paperTotal,
    counts: {
      choice: picked.filter((i) => i.kind === 'choice').length,
      composite: picked.filter((i) => i.kind === 'composite').length,
      python: picked.filter((i) => i.kind === 'python').length,
    },
  };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 从整卷里抽本次要做的题（每个学生抽到的顺序不同，防互相抄答案）。
 * want <= 0 或 >= 题数 = 全做，但仍打乱顺序。
 */
function pickItemIds(items, want) {
  const allIds = items.map((it) => it.item_id);
  const n = Number(want) || 0;
  const pool = shuffle(allIds);
  return n > 0 && n < pool.length ? pool.slice(0, n) : pool;
}

/** 给前端的安全版本（剥掉 answer，composite 只留小题骨架） */
function toPublicPaper(paper) {
  return {
    test_id: paper.test.id,
    title: paper.test.title,
    time_limit: Number(paper.test.time_limit) || 60,
    paper_total: paper.paperTotal,
    counts: paper.counts,
    questions: paper.items.map((it) => {
      const base = {
        id: it.item_id,
        kind: it.kind,
        type: it.type,
        content: it.content,
        options: it.options || [],
        score: it.score,
      };
      if (it.kind === 'composite') base.sub_questions = it.sub_questions;
      if (it.kind === 'python') {
        base.description = it.description;
        base.blank_template = it.blank_template;
        base.blank_count = it.blank_count;
      }
      return base;
    }),
  };
}

// ---------- 判分 ----------

/** 编程题学生答案：{"blanks":["a","b"]}，也兼容直接传数组或纯字符串 */
function parsePythonAnswer(raw) {
  if (raw == null) return [];
  let v = raw;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('{') || s.startsWith('[')) {
      try { v = JSON.parse(s); } catch { return [v]; }
    } else {
      return [v];
    }
  }
  if (Array.isArray(v)) return v.map((x) => (x == null ? '' : String(x)));
  if (v && Array.isArray(v.blanks)) return v.blanks.map((x) => (x == null ? '' : String(x)));
  return [];
}

/** 代码填空比对：忽略引号外空白差异（与 python-grader.sameCode 同口径，这里简化实现） */
function sameCode(a, b) {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
  return norm(a) === norm(b);
}

function judgePythonItem(item, answerRaw) {
  const blanks = parsePythonAnswer(answerRaw);
  const correctList = taskGetAnswersArray(item.answer && item.answer.blank_answers);
  let weights = [];
  try {
    const w = typeof item.answer.blank_weights === 'string'
      ? JSON.parse(item.answer.blank_weights)
      : item.answer.blank_weights;
    weights = Array.isArray(w) ? w : [];
  } catch { weights = []; }

  const n = Math.max(item.blank_count || 0, correctList.length, 1);
  const defaultWeight = PYTHON_SCORE / n;
  let earned = 0;
  let total = 0;
  const details = [];
  for (let i = 0; i < n; i += 1) {
    const w = Number.isFinite(Number(weights[i])) && Number(weights[i]) > 0 ? Number(weights[i]) : defaultWeight;
    total += w;
    const accept = Array.isArray(correctList[i]) ? correctList[i] : [correctList[i]];
    const mine = blanks[i] == null ? '' : String(blanks[i]);
    const ok = !!mine.trim() && accept.some((a) => sameCode(a, mine));
    if (ok) earned += w;
    details.push({ blank: i + 1, answer: mine, correct: ok });
  }
  const credit = total > 0 ? Math.round((earned / total) * PYTHON_SCORE) : 0;
  return {
    credit,
    max: PYTHON_SCORE,
    isCorrect: credit >= PYTHON_SCORE,
    detail: { blanks: details },
  };
}

function judgeCompositeItem(item, answerRaw) {
  const subs = taskGetAnswersArray(item.answer);
  let parsedUser = {};
  try {
    parsedUser = typeof answerRaw === 'string' ? JSON.parse(answerRaw) : (answerRaw || {});
  } catch { parsedUser = {}; }
  if (!parsedUser || typeof parsedUser !== 'object') parsedUser = {};

  let earned = 0;
  let total = 0;
  const subs0 = [];
  const fallback = subs.length ? COMPOSITE_SCORE / subs.length : 0;
  subs.forEach((sq, idx) => {
    // 小题分值缺失时按均分兜底：宁可平均分，也不能让整道大题变成 0 分
    const w = Number(sq && sq.score) || fallback;
    total += w;
    let ok = false;
    if (sq && sq.type === 'fill_blank') {
      ok = judgeFillBlankAnswer(parsedUser.blank_answers?.[idx], sq.answers);
    } else if (sq && (sq.type === 'choice' || sq.type === 'multiple_choice')) {
      const multiple = sq.multiple === true || sq.type === 'multiple_choice';
      ok = taskCheckAnswerCorrect(
        parsedUser.choice_answers?.[idx],
        multiple ? 'multiple_choice' : 'choice',
        sq.answers,
        sq.options
      );
    }
    if (ok) earned += w;
    subs0.push({ index: idx + 1, correct: ok, score: w, earned: ok ? w : 0 });
  });
  const ratio = total > 0 ? earned / total : 0;
  const credit = Math.round(ratio * COMPOSITE_SCORE);
  return {
    credit,
    max: COMPOSITE_SCORE,
    isCorrect: credit >= COMPOSITE_SCORE,
    detail: { subs: subs0 },
  };
}

function judgeChoiceItem(item, answerRaw) {
  const ok = taskCheckAnswerCorrect(answerRaw, 'choice', item.answer, item.options);
  return {
    credit: ok ? CHOICE_SCORE : 0,
    max: CHOICE_SCORE,
    isCorrect: ok,
    detail: {},
  };
}

/**
 * 判一道题。
 * @returns {{credit:number,max:number,isCorrect:boolean,detail:object}}
 */
function judgeItem(item, answerRaw) {
  if (!item) return { credit: 0, max: 0, isCorrect: false, detail: {} };
  if (item.kind === 'composite') return judgeCompositeItem(item, answerRaw);
  if (item.kind === 'python') return judgePythonItem(item, answerRaw);
  return judgeChoiceItem(item, answerRaw);
}

/** 学生有没有作答（空串/空数组/全空白的 {} 都算没答） */
function hasAnswer(item, answerRaw) {
  if (answerRaw === undefined || answerRaw === null) return false;
  if (item && item.kind === 'python') {
    const b = parsePythonAnswer(answerRaw);
    return b.some((x) => String(x || '').trim() !== '');
  }
  if (item && item.kind === 'composite') {
    let p = {};
    try { p = typeof answerRaw === 'string' ? JSON.parse(answerRaw) : (answerRaw || {}); } catch { p = {}; }
    const cs = p && p.choice_answers ? Object.values(p.choice_answers) : [];
    const bs = p && p.blank_answers ? Object.values(p.blank_answers) : [];
    const anyChoice = cs.some((v) => String(v == null ? '' : v).trim() !== '');
    const anyBlank = bs.some((arr) => Array.isArray(arr)
      ? arr.some((x) => String(x == null ? '' : x).trim() !== '')
      : String(arr == null ? '' : arr).trim() !== '');
    return anyChoice || anyBlank;
  }
  return String(answerRaw).trim() !== '';
}

/**
 * 只按 id 列表算卷面满分（不算题目内容，保存试卷时用）。
 * 与 loadPaper 的口径必须一致：题被删了就是 0 分，不占分。
 */
async function computePaperTotalFromIds(client, rawIds) {
  const ids = parseItemIds(rawIds);
  if (!ids.length) return 0;
  const qIds = ids.filter((id) => !isPythonItem(id));
  const pyIds = ids.filter((id) => isPythonItem(id)).map(pythonTaskIdOf);
  let choice = 0;
  let composite = 0;
  let python = 0;
  if (qIds.length) {
    const [rows] = await client.query(
      "SELECT type, COUNT(*) n FROM questions WHERE id IN (?) AND type IN ('choice','composite') GROUP BY type",
      [qIds]
    );
    for (const r of rows) {
      if (r.type === 'choice') choice = Number(r.n) || 0;
      if (r.type === 'composite') composite = Number(r.n) || 0;
    }
  }
  if (pyIds.length) {
    const [[row]] = await client.query(
      "SELECT COUNT(*) n FROM python_tasks WHERE id IN (?) AND task_type = 'fill_blank'",
      [pyIds]
    );
    python = Number(row && row.n) || 0;
  }
  return choice * CHOICE_SCORE + composite * COMPOSITE_SCORE + python * PYTHON_SCORE;
}

module.exports = {
  CHOICE_SCORE,
  COMPOSITE_SCORE,
  PYTHON_SCORE,
  PYTHON_PREFIX,
  isPythonItem,
  pythonTaskIdOf,
  parseItemIds,
  scoreOfKind,
  countTemplateBlanks,
  loadPaper,
  toPublicPaper,
  pickItemIds,
  computePaperTotalFromIds,
  judgeItem,
  hasAnswer,
  parsePythonAnswer,
  publicSubQuestions,
};
