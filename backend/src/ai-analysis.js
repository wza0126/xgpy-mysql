/**
 * AI 学情分析（教师端）
 *
 * ⛔ 本模块最核心的一条原则：**AI 不碰数据库，只解读已经算好的数字。**
 *
 * 为什么这样设计（2026-10-25 定）：
 *   ① 让 LLM 自己写 SQL，它会编字段名（十次里有三次跑不通），也会查错口径
 *      （把考试答题算进练习、把停用题算进分母）；
 *   ② 让 LLM 自己算平均正确率，它经常算错，而老师是拿这个数去开会的；
 *   ③ 多轮「查→看→再查」一次要 30 秒以上，课堂上等不了。
 *
 * 所以流程固定为：固定 SQL（参数化）→ 指标 JSON → LLM 只输出文字分析。
 * 前端左侧放 AI 文字，右侧放原始数据表，老师随时可核对。
 *
 * 另一个约束：**服务端自己重新取数，永远不信任前端传上来的数字**。
 * 否则改一下请求体就能让 AI「分析」出一份虚构的成绩。
 */

const { CHAPTER_NAMES, sectionCode } = require('./chapter-taxonomy');

// ============ 主题定义 ============
// 每个主题 = 一批固定 SQL + 一份指标包，老师选一个就出对应的分析。
const TOPICS = [
  {
    key: 'overview',
    label: '班级概况',
    icon: 'fa-chart-pie',
    desc: '人数、活跃度、练习量、正确率、掌握数分布、近两周趋势',
  },
  {
    key: 'mastery',
    label: '薄弱知识点',
    icon: 'fa-layer-group',
    desc: '各章掌握率排行，以及最弱的小节知识点',
  },
  {
    key: 'wrong',
    label: '高频错题',
    icon: 'fa-circle-xmark',
    desc: '错得最多的题目，以及错误集中在哪些知识点',
  },
  {
    key: 'students',
    label: '重点关注学生',
    icon: 'fa-user-clock',
    desc: '掉队预警（未活跃 / 正确率下滑 / 练习量偏低）+ 掌握数最低的学生',
  },
  {
    key: 'exam',
    label: '考试成绩',
    icon: 'fa-file-pen',
    desc: '每场考试的参考人数、平均分、及格率、分数段、低分学生',
  },
];

const TOPIC_KEYS = TOPICS.map((t) => t.key);

/** 题型英文 → 中文（库里实际只有这几种，多出来的原样透出） */
const TYPE_NAMES = {
  choice: '单选题',
  fill_blank: '填空题',
  composite: '复合题',
  wps_op: 'WPS 操作题',
  access_op: 'Access 操作题',
};

/** 掌握阈值（同一题答对几次算掌握）—— 与练习模块、学情分析完全同口径 */
async function getMasterThreshold(pool) {
  const [rows] = await pool.query(
    "SELECT value FROM system_config WHERE config_key = 'master_question_threshold' LIMIT 1"
  );
  if (!rows.length) return 3;
  let v = rows[0].value;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      v = parsed && typeof parsed === 'object' ? parsed.value : parsed;
    } catch {
      /* 纯字符串就用原值 */
    }
  }
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

const num = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const round1 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

/** 知识点显示名：章/节 → 「1.1.3 数据、信息与知识的概念」，无编号就返回原名 */
function clusterLabel(clusterId) {
  const s = String(clusterId || '');
  if (!s) return '';
  if (!s.includes('/')) return s;
  const [ch, sec] = s.split('/');
  const code = sectionCode(ch, sec);
  return code ? `${code} ${sec}` : sec;
}

// ============ 取数：班级基础信息 ============
async function loadClassBase(pool, classId) {
  const [rows] = await pool.query(
    'SELECT id, name, teacher_id FROM classes WHERE id = ? LIMIT 1',
    [classId]
  );
  if (!rows.length) return null;
  const [students] = await pool.query(
    "SELECT id, username, real_name FROM profiles WHERE class_id = ? AND role = 'student' ORDER BY real_name, username",
    [classId]
  );
  return {
    id: rows[0].id,
    name: rows[0].name,
    teacher_id: rows[0].teacher_id,
    students,
    studentIds: students.map((s) => s.id),
  };
}

/** 每个学生的掌握题数（同一题练习答对 ≥ 阈值，且题目有知识点、属可练题） */
async function loadMasteredMap(pool, studentIds, threshold) {
  const map = new Map();
  if (!studentIds.length) return map;
  const [rows] = await pool.query(
    `SELECT m.student_id, COUNT(*) AS n FROM (
       SELECT student_id, question_id FROM student_answers
        WHERE student_id IN (?) AND source = 'practice' AND is_correct = 1
        GROUP BY student_id, question_id
       HAVING COUNT(*) >= ?
     ) m
     JOIN questions q ON q.id = m.question_id
     WHERE q.practice_enabled = 1 AND q.cluster_id IS NOT NULL AND q.cluster_id <> ''
     GROUP BY m.student_id`,
    [studentIds, threshold]
  );
  for (const r of rows) map.set(r.student_id, num(r.n));
  return map;
}

// ============ 主题 1：班级概况 ============
async function buildOverview(pool, base, threshold) {
  const ids = base.studentIds;
  const size = ids.length;

  const [agg] = await pool.query(
    `SELECT
       COUNT(*) AS answers30,
       SUM(is_correct = 1) AS correct30,
       COUNT(DISTINCT student_id) AS active30,
       SUM(created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS answers7,
       SUM(created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND is_correct = 1) AS correct7,
       COUNT(DISTINCT CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN student_id END) AS active7
     FROM student_answers
     WHERE student_id IN (?) AND source = 'practice'
       AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    [ids.length ? ids : ['']]
  );
  const a = agg[0] || {};

  const [pointRows] = await pool.query(
    "SELECT SUM(current_points) AS total, AVG(current_points) AS avg FROM profiles WHERE class_id = ? AND role = 'student'",
    [base.id]
  );
  const points = pointRows[0] || {};

  const masteredMap = await loadMasteredMap(pool, ids, threshold);
  let masteredTotal = 0;
  const masteredList = [];
  for (const s of base.students) {
    const m = masteredMap.get(s.id) || 0;
    masteredTotal += m;
    masteredList.push({ id: s.id, username: s.username, real_name: s.real_name, mastered: m });
  }
  masteredList.sort((x, y) => y.mastered - x.mastered);
  const masteredNums = masteredList.map((x) => x.mastered);

  const band = (lo, hi) => masteredNums.filter((n) => n >= lo && (hi === null || n < hi)).length;
  const masteredBands = [
    { range: '0 题', count: band(0, 1) },
    { range: '1-99 题', count: band(1, 100) },
    { range: '100-299 题', count: band(100, 300) },
    { range: '300-499 题', count: band(300, 500) },
    { range: '500 题以上', count: band(500, null) },
  ];

  // 近 14 天每日趋势
  const [trendRows] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n, SUM(is_correct = 1) AS ok
       FROM student_answers
      WHERE student_id IN (?) AND source = 'practice'
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      GROUP BY d ORDER BY d`,
    [ids.length ? ids : ['']]
  );
  const trend = trendRows.map((r) => ({
    date: r.d,
    answers: num(r.n),
    accuracy: pct(num(r.ok), num(r.n)),
  }));

  const metrics = {
    班级: base.name,
    学生人数: size,
    掌握判定标准: `同一道题练习答对 ${threshold} 次及以上算已掌握`,
    最近30天: {
      有练习记录的学生数: num(a.active30),
      练习提交总数: num(a.answers30),
      整体正确率百分比: pct(num(a.correct30), num(a.answers30)),
      人均练习提交数: size ? round1(num(a.answers30) / size) : null,
    },
    最近7天: {
      有练习记录的学生数: num(a.active7),
      练习提交总数: num(a.answers7),
      整体正确率百分比: pct(num(a.correct7), num(a.answers7)),
    },
    掌握情况: {
      人均掌握题数: size ? round1(masteredTotal / size) : null,
      掌握题数中位数: masteredNums.length ? masteredNums.sort((x, y) => x - y)[Math.floor(masteredNums.length / 2)] : null,
      掌握题数最高: masteredNums.length ? Math.max(...masteredNums) : null,
      掌握题数最低: masteredNums.length ? Math.min(...masteredNums) : null,
      分布: masteredBands,
    },
    积分: {
      班级积分总额: num(points.total),
      人均积分: round1(num(points.avg)),
    },
    近14天每日趋势: trend,
  };

  const tables = [
    {
      title: '掌握题数分布',
      columns: ['区间', '人数'],
      rows: masteredBands.map((b) => [b.range, b.count]),
    },
    {
      title: '近 14 天每日练习',
      columns: ['日期', '提交数', '正确率'],
      rows: trend.map((t) => [t.date, t.answers, t.accuracy === null ? '—' : `${t.accuracy}%`]),
    },
    {
      title: '掌握题数排行（前 10）',
      columns: ['账号', '姓名', '掌握题数'],
      rows: masteredList.slice(0, 10).map((s) => [s.username, s.real_name, s.mastered]),
    },
  ];

  return { metrics, tables };
}

// ============ 主题 2：薄弱知识点 ============
async function buildMastery(pool, base, threshold) {
  const ids = base.studentIds;
  const size = ids.length;

  // 各章题库总量（分母口径与学习模块一致：只算可练、有知识点、非操作题）
  const [clusterRows] = await pool.query(
    `SELECT cluster_id, COUNT(*) AS cnt FROM questions
      WHERE practice_enabled = 1 AND cluster_id IS NOT NULL AND cluster_id <> ''
        AND type NOT IN ('wps_op', 'access_op')
      GROUP BY cluster_id`
  );
  const chapterQCount = new Map();
  const sectionQCount = new Map();
  for (const r of clusterRows) {
    const cid = String(r.cluster_id);
    const ch = cid.includes('/') ? cid.split('/')[0] : cid;
    chapterQCount.set(ch, (chapterQCount.get(ch) || 0) + num(r.cnt));
    sectionQCount.set(cid, num(r.cnt));
  }

  if (!ids.length) {
    return { metrics: { 班级: base.name, 提示: '该班没有学生' }, tables: [] };
  }

  // 学生 × 知识点 的掌握题数
  const [rows] = await pool.query(
    `SELECT m.student_id, q.cluster_id AS cid, COUNT(*) AS n FROM (
       SELECT student_id, question_id FROM student_answers
        WHERE student_id IN (?) AND source = 'practice' AND is_correct = 1
        GROUP BY student_id, question_id
       HAVING COUNT(*) >= ?
     ) m
     JOIN questions q ON q.id = m.question_id
     WHERE q.cluster_id IS NOT NULL AND q.cluster_id <> ''
     GROUP BY m.student_id, q.cluster_id`,
    [ids, threshold]
  );

  // 按章、按知识点分别汇总「班级总掌握数」
  const chapterMastered = new Map();
  const sectionMastered = new Map();
  for (const r of rows) {
    const cid = String(r.cid);
    const ch = cid.includes('/') ? cid.split('/')[0] : cid;
    chapterMastered.set(ch, (chapterMastered.get(ch) || 0) + num(r.n));
    sectionMastered.set(cid, (sectionMastered.get(cid) || 0) + num(r.n));
  }

  const chapters = CHAPTER_NAMES.map((name) => {
    const q = chapterQCount.get(name) || 0;
    const possible = q * size;
    const got = chapterMastered.get(name) || 0;
    return {
      章节: name,
      题库题数: q,
      理论可掌握总数: possible,
      班级已掌握: got,
      掌握率: pct(got, possible),
    };
  }).filter((c) => c.题库题数 > 0);
  chapters.sort((x, y) => (x.掌握率 ?? 0) - (y.掌握率 ?? 0));

  // 小节级：只保留题库量 >= 3 的知识点（样本太小的掌握率没有参考意义）
  const sections = [];
  for (const [cid, q] of sectionQCount) {
    if (q < 3 || !cid.includes('/')) continue;
    const possible = q * size;
    const got = sectionMastered.get(cid) || 0;
    sections.push({
      知识点: clusterLabel(cid),
      原始标识: cid,
      题库题数: q,
      班级已掌握: got,
      掌握率: pct(got, possible),
    });
  }
  sections.sort((x, y) => (x.掌握率 ?? 0) - (y.掌握率 ?? 0));
  const weakestSections = sections.slice(0, 12);

  const metrics = {
    班级: base.name,
    学生人数: size,
    说明: '掌握率 = 班级已掌握题数 ÷（该知识点题库题数 × 班级人数），分母是理论最大可掌握量',
    解读提示:
      '这个百分比的分母是「题目数 × 全班人数」，所以绝对值天然偏低（全班 50 多人不可能人人都把每道题答对两遍），' +
      '正常范围通常在个位数到二十几。**应当看相对排序：哪几章最低、和最高的差多少，不要拿绝对百分比判断「教学失败」。**',
    各章掌握率: chapters,
    最弱知识点: weakestSections,
  };

  const tables = [
    {
      title: '各章掌握率（从低到高）',
      columns: ['章节', '题库题数', '已掌握', '理论总数', '掌握率'],
      rows: chapters.map((c) => [
        c.章节,
        c.题库题数,
        c.班级已掌握,
        c.理论可掌握总数,
        c.掌握率 === null ? '—' : `${c.掌握率}%`,
      ]),
    },
    {
      title: '最弱知识点（前 12，题库量 ≥3）',
      columns: ['知识点', '题库题数', '已掌握', '掌握率'],
      rows: weakestSections.map((s) => [
        s.知识点,
        s.题库题数,
        s.班级已掌握,
        s.掌握率 === null ? '—' : `${s.掌握率}%`,
      ]),
    },
  ];

  return { metrics, tables };
}

// ============ 主题 3：高频错题 ============
async function buildWrong(pool, base) {
  const ids = base.studentIds;
  if (!ids.length) {
    return { metrics: { 班级: base.name, 提示: '该班没有学生' }, tables: [] };
  }

  const [rows] = await pool.query(
    `SELECT a.question_id,
            COUNT(*) AS err_times,
            COUNT(DISTINCT a.student_id) AS err_students,
            SUBSTRING(q.content, 1, 120) AS content,
            q.cluster_id,
            q.type
       FROM student_answers a
       JOIN questions q ON q.id = a.question_id
      WHERE a.student_id IN (?) AND a.source = 'practice' AND a.is_correct = 0
      GROUP BY a.question_id, content, q.cluster_id, q.type
      ORDER BY err_students DESC, err_times DESC
      LIMIT 20`,
    [ids]
  );

  // 每道题的作答人次与错误率
  const [totalRows] = await pool.query(
    `SELECT question_id, COUNT(*) AS total, COUNT(DISTINCT student_id) AS students
       FROM student_answers
      WHERE student_id IN (?) AND source = 'practice'
      GROUP BY question_id`,
    [ids]
  );
  const totalMap = new Map(totalRows.map((r) => [r.question_id, r]));

  const items = rows.map((r) => {
    const t = totalMap.get(r.question_id) || {};
    const total = num(t.total);
    return {
      题目编号: r.question_id,
      题型: r.type || '',
      知识点: clusterLabel(r.cluster_id),
      题干摘要: String(r.content || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
      错误人数: num(r.err_students),
      错误次数: num(r.err_times),
      作答人次: total,
      该题错误率: pct(num(r.err_times), total),
    };
  });

  // 错误按知识点聚集
  const byCluster = new Map();
  for (const it of items) {
    const k = it.知识点 || '未分类';
    const o = byCluster.get(k) || { 知识点: k, 涉及题目数: 0, 错误次数合计: 0 };
    o.涉及题目数 += 1;
    o.错误次数合计 += it.错误次数;
    byCluster.set(k, o);
  }
  const clusters = [...byCluster.values()].sort((a, b) => b.错误次数合计 - a.错误次数合计);

  const metrics = {
    班级: base.name,
    学生人数: base.studentIds.length,
    说明: '统计范围是练习来源（source=practice）的答错记录，按「错过的学生人数」排序',
    高频错题: items,
    错误集中的知识点: clusters,
  };

  const tables = [
    {
      title: '高频错题（前 20）',
      columns: ['知识点', '题干摘要', '错误人数', '错误次数', '作答人次', '错误率'],
      rows: items.map((i) => [
        i.知识点 || '未分类',
        i.题干摘要.slice(0, 40) + (i.题干摘要.length > 40 ? '…' : ''),
        i.错误人数,
        i.错误次数,
        i.作答人次,
        i.该题错误率 === null ? '—' : `${i.该题错误率}%`,
      ]),
    },
    {
      title: '错误集中的知识点',
      columns: ['知识点', '涉及题目数', '错误次数合计'],
      rows: clusters.map((c) => [c.知识点, c.涉及题目数, c.错误次数合计]),
    },
  ];

  return { metrics, tables };
}

// ============ 主题 4：重点关注学生 ============
async function buildStudents(pool, base, threshold, inactiveDays = 7) {
  const ids = base.studentIds;
  if (!ids.length) {
    return { metrics: { 班级: base.name, 提示: '该班没有学生' }, tables: [] };
  }
  const size = ids.length;

  const [sessionRows] = await pool.query(
    'SELECT user_id, MAX(last_active_at) AS last_active FROM login_sessions WHERE user_id IN (?) GROUP BY user_id',
    [ids]
  );
  const lastActiveMap = new Map(sessionRows.map((r) => [r.user_id, r.last_active]));

  const [answerRows] = await pool.query(
    `SELECT student_id,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS r7,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN is_correct ELSE 0 END) AS r7ok,
        SUM(CASE WHEN created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) THEN 1 ELSE 0 END) AS p7,
        SUM(CASE WHEN created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) THEN is_correct ELSE 0 END) AS p7ok,
        SUM(created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS a30,
        MAX(created_at) AS last_answer
      FROM student_answers
      WHERE student_id IN (?) AND source = 'practice'
      GROUP BY student_id`,
    [ids]
  );
  const answerMap = new Map(answerRows.map((r) => [r.student_id, r]));

  const total30 = base.students.reduce((s, st) => s + num((answerMap.get(st.id) || {}).a30), 0);
  const classAvg30 = total30 / size;

  // ⛔ 练习量偏低不能用「全班人均的一半」当门槛：
  //    班级练习量分布极不均衡（有人 1373 次、有人 0 次），人均会被高练习量的学生拉高，
  //    结果半个班都「低于人均一半」。实测高二4 用这个口径把 55 人全判成需要关注。
  //    改用**中位数的一半**：对长尾分布稳健，命中人数稳定在少数几个真正掉队的。
  const a30Nums = base.students.map((s) => num((answerMap.get(s.id) || {}).a30)).sort((a, b) => a - b);
  const median30 = a30Nums.length ? a30Nums[Math.floor(a30Nums.length / 2)] : 0;
  const lowActivityLine = median30 * 0.5;

  const masteredMap = await loadMasteredMap(pool, ids, threshold);

  // 题库总量：用来判断「练得少」到底是不是问题（吴老 2026-10-25 指出）
  const [[poolQ]] = await pool.query(
    `SELECT COUNT(*) AS n FROM questions
      WHERE practice_enabled = 1 AND cluster_id IS NOT NULL AND cluster_id <> ''
        AND type NOT IN ('wps_op', 'access_op')`
  );
  const questionPoolSize = num(poolQ?.n);
  const masteredEnoughLine = Math.round(questionPoolSize * 0.7);

  // 最近两场考试成绩（比练习量更硬的证据）
  const [examRows] = await pool.query(
    `SELECT er.student_id, er.test_id, er.score, t.title, t.passing_score, t.created_at
       FROM exam_records er
       JOIN tests t ON t.id = er.test_id
      WHERE er.student_id IN (?) AND t.type = 'exam'
        AND (TIMESTAMPDIFF(SECOND, er.started_at, er.completed_at) > 0
             OR EXISTS (SELECT 1 FROM student_answers sa2
                         WHERE sa2.test_id = er.test_id AND sa2.student_id = er.student_id AND sa2.source = 'exam'))
      ORDER BY t.created_at DESC`,
    [ids]
  );
  const examByStudent = new Map();
  for (const r of examRows) {
    if (!examByStudent.has(r.student_id)) examByStudent.set(r.student_id, []);
    const arr = examByStudent.get(r.student_id);
    if (arr.length < 2) arr.push(r);
  }

  const nowMs = Date.now();

  const flagged = [];
  const masteredList = [];
  for (const s of base.students) {
    const mastered = masteredMap.get(s.id) || 0;
    masteredList.push({ id: s.id, username: s.username, real_name: s.real_name, mastered });

    const r = answerMap.get(s.id) || {};
    const r7 = num(r.r7);
    const p7 = num(r.p7);
    const r7rate = r7 > 0 ? pct(num(r.r7ok), r7) : null;
    const p7rate = p7 > 0 ? pct(num(r.p7ok), p7) : null;

    // 活跃判定以「最后一次练习答题时间」为主，登录会话为辅。
    // ⛔ 不能只用 login_sessions：会话行会被清理，实测有 1195 次练习的学生在这里查不到任何记录，
    //    于是被判成「从未登录」—— AI 一眼就看出了这个自相矛盾（2026-10-25）。
    const lastAnswer = r.last_answer ? new Date(r.last_answer).getTime() : null;
    const lastLogin = lastActiveMap.get(s.id) ? new Date(lastActiveMap.get(s.id)).getTime() : null;
    const lastSeen = Math.max(lastAnswer || 0, lastLogin || 0) || null;
    const inactive = lastSeen ? Math.floor((nowMs - lastSeen) / 86400000) : null;

    const flags = [];
    if (lastSeen === null) {
      flags.push('从未使用过');
    } else if (inactive !== null && inactive >= inactiveDays) {
      flags.push(`已 ${inactive} 天无练习`);
    }
    if (r7 >= 5 && p7 >= 5 && r7rate !== null && p7rate !== null && r7rate < p7rate - 15) flags.push('正确率明显下滑');
    // ⛔ 练习量偏低必须结合掌握度：题库只有 982 题，掌握到 700+ 之后剩下的题练完了，
    //    练习量下降是正常的，不是掉队（2026-10-25 吴老指出）。
    const masteredEnough = questionPoolSize > 0 && mastered >= masteredEnoughLine;
    if (lowActivityLine > 0 && num(r.a30) < lowActivityLine && !masteredEnough) flags.push('练习量偏低');

    // 考试成绩（最硬的证据）
    const myExams = examByStudent.get(s.id) || [];
    const lastExam = myExams[0] || null;
    const prevExam = myExams[1] || null;
    let lastExamScore = null;
    let examDrop = null;
    if (lastExam) {
      lastExamScore = num(lastExam.score);
      const passing = lastExam.passing_score === null || lastExam.passing_score === undefined ? 60 : num(lastExam.passing_score);
      if (lastExamScore < passing) flags.push('最近考试不及格');
      if (prevExam) {
        examDrop = Math.round((lastExamScore - num(prevExam.score)) * 10) / 10;
        if (examDrop <= -15) flags.push('比上次退步');
      }
    }

    if (flags.length) {
      flagged.push({
        账号: s.username,
        姓名: s.real_name,
        标记: flags,
        未活跃天数: lastSeen === null ? '从未使用' : inactive,
        近7天正确率: r7rate,
        前7天正确率: p7rate,
        近30天练习数: num(r.a30),
        已掌握题数: mastered,
        掌握率: questionPoolSize > 0 ? Math.round((mastered / questionPoolSize) * 100) : null,
        最近考试分: lastExamScore,
        比上次: examDrop,
      });
    }
  }
  flagged.sort((a, b) => {
    if (b.标记.length !== a.标记.length) return b.标记.length - a.标记.length;
    const ia = a.未活跃天数 === '从未使用' ? 99999 : a.未活跃天数;
    const ib = b.未活跃天数 === '从未使用' ? 99999 : b.未活跃天数;
    return ib - ia;
  });

  // 限制给模型的人数：全班 55 人时关注名单可能有二三十人，全塞进去会到 7000 字，
  // 既稀释重点又推高 token。按排序取前 25，并在指标里说明总数。
  const FLAG_LIMIT = 25;
  const flaggedForModel = flagged.slice(0, FLAG_LIMIT);
  masteredList.sort((a, b) => a.mastered - b.mastered);
  const lowestMastered = masteredList.slice(0, 10);

  const metrics = {
    班级: base.name,
    学生人数: size,
    判定口径: {
      已N天无练习: `最近一次练习答题（或登录）距今 ≥ ${inactiveDays} 天`,
      从未使用过: '既没有练习答题记录，也没有登录记录',
      正确率明显下滑: '近 7 天正确率比前 7 天低 15 个百分点以上（两段各有 ≥5 次练习）',
      练习量偏低: `近 30 天练习提交数低于全班中位数（${median30} 次）的一半，即少于 ${round1(lowActivityLine)} 次；**且该生掌握数低于 ${masteredEnoughLine} 题**`,
      最近考试不及格: '最近一次考试低于该场及格线',
      比上次退步: '最近一次考试成绩比上一场低 15 分以上',
    },
    题库总量: questionPoolSize,
    掌握充足线: masteredEnoughLine,
    重要提示:
      '题库总共只有约 1000 题，学生掌握到 700 题以上后"可练的题"本来就快没了，练习量下降是正常的，' +
      '不能据此判断掉队。判断学生是否真的落后，**优先看考试成绩**（同一时间、同一份卷、不能翻资料），' +
      '其次看掌握率，最后才看练习量。',
    全班近30天: {
      人均练习提交数: round1(classAvg30),
      中位练习提交数: median30,
      说明: '练习量分布很不均衡（有人上千次、有人 0 次），判断「偏低」用中位数比人均更可靠',
    },
    需要关注的学生总数: flagged.length,
    需要关注的学生:
      flagged.length > FLAG_LIMIT
        ? { 说明: `共 ${flagged.length} 人，以下按严重程度列出前 ${FLAG_LIMIT} 人`, 名单: flaggedForModel }
        : flaggedForModel,
    掌握题数最低的10人: lowestMastered.map((s) => ({
      账号: s.username,
      姓名: s.real_name,
      已掌握题数: s.mastered,
    })),
  };

  const tables = [
    {
      title: `需要关注的学生（${flagged.length} 人）`,
      columns: ['账号', '姓名', '标记', '最近考试', '比上次', '掌握数(率)', '近7天正确率', '近30天练习'],
      rows: flagged.map((s) => [
        s.账号,
        s.姓名,
        s.标记.join('、'),
        s.最近考试分 === null ? '未参加' : s.最近考试分,
        s.比上次 === null ? '—' : (s.比上次 > 0 ? `+${s.比上次}` : s.比上次),
        `${s.已掌握题数}${s.掌握率 === null ? '' : ` (${s.掌握率}%)`}`,
        s.近7天正确率 === null ? '—' : `${s.近7天正确率}%`,
        s.近30天练习数,
      ]),
    },
    {
      title: '掌握题数最低的 10 人',
      columns: ['账号', '姓名', '已掌握题数'],
      rows: lowestMastered.map((s) => [s.username, s.real_name, s.mastered]),
    },
  ];

  return { metrics, tables };
}

// ============ 主题 5：考试成绩 ============
async function buildExam(pool, base) {
  const classId = base.id;
  const size = base.studentIds.length;

  const likePattern = `%"${classId}"%`;
  const [exams] = await pool.query(
    `SELECT DISTINCT t.id, t.title, t.passing_score, t.created_at
       FROM tests t
      WHERE t.type = 'exam' AND (
        t.class_ids LIKE ?
        OR t.id IN (
          SELECT er.test_id FROM exam_records er
            JOIN profiles p ON p.id = er.student_id
           WHERE p.class_id = ? AND p.role = 'student'
        )
      )
      ORDER BY t.created_at DESC
      LIMIT 10`,
    [likePattern, classId]
  );

  if (!exams.length) {
    return {
      metrics: { 班级: base.name, 提示: '近段时间该班没有考试记录' },
      tables: [],
    };
  }

  const examIds = exams.map((e) => e.id);
  // ⛔ 剔除「未参加」占位记录：考试结束时系统会给没参加的人批量写一条
  //    started_at = completed_at 的 0 分记录，算进去会把「2 人参考」显示成「全班参考」
  const [records] = await pool.query(
    `SELECT er.test_id, er.student_id, er.score,
        (TIMESTAMPDIFF(SECOND, er.started_at, er.completed_at) > 0
         OR EXISTS (
           SELECT 1 FROM student_answers sa
            WHERE sa.test_id = er.test_id AND sa.student_id = er.student_id AND sa.source = 'exam'
         )) AS participated
       FROM exam_records er
       JOIN profiles p ON p.id = er.student_id
      WHERE er.test_id IN (?) AND p.class_id = ? AND p.role = 'student'`,
    [examIds, classId]
  );

  const nameMap = new Map(base.students.map((s) => [s.id, s]));

  // ---------- 考试答题明细：按「考试 × 题目」汇总 ----------
  // 为什么值得单独捞：考试成绩是**同一时间、同一份卷、没人能翻资料**的场景，
  // 比平时练习真实得多。练习数据只能说明「练了多少」，考试才能说明「真会多少」。
  // 这里把每道题的作答人次/答错人数都取出来，就能反推「哪个知识点集体失分」。
  const [detailRows] = await pool.query(
    `SELECT sa.test_id, sa.question_id, q.cluster_id, q.type,
            COUNT(*) AS attempts,
            SUM(sa.is_correct = 1) AS corrects,
            COUNT(DISTINCT CASE WHEN sa.is_correct = 0 THEN sa.student_id END) AS err_students,
            COUNT(DISTINCT sa.student_id) AS students,
            SUBSTRING(q.content, 1, 90) AS content
       FROM student_answers sa
       JOIN questions q ON q.id = sa.question_id
       JOIN profiles p ON p.id = sa.student_id
      WHERE sa.source = 'exam' AND sa.test_id IN (?) AND p.class_id = ? AND p.role = 'student'
      GROUP BY sa.test_id, sa.question_id, q.cluster_id, q.type, content`,
    [examIds, classId]
  );

  // 把明细按考试分组，算出三张榜：知识点错误率 / 单题错误率 / 题型错误率
  const detailByExam = new Map();
  for (const r of detailRows) {
    const tid = r.test_id;
    if (!detailByExam.has(tid)) {
      detailByExam.set(tid, { clusters: new Map(), types: new Map(), questions: [] });
    }
    const d = detailByExam.get(tid);
    const attempts = num(r.attempts);
    const corrects = num(r.corrects);
    const cid = r.cluster_id ? String(r.cluster_id) : '未分类';

    const c = d.clusters.get(cid) || { 知识点: clusterLabel(r.cluster_id), 题目数: 0, 作答人次: 0, 答错人次: 0 };
    c.题目数 += 1;
    c.作答人次 += attempts;
    c.答错人次 += attempts - corrects;
    d.clusters.set(cid, c);

    const typeName = TYPE_NAMES[r.type] || r.type || '未知题型';
    const t = d.types.get(typeName) || { 题型: typeName, 题目数: 0, 作答人次: 0, 答错人次: 0 };
    t.题目数 += 1;
    t.作答人次 += attempts;
    t.答错人次 += attempts - corrects;
    d.types.set(typeName, t);

    // ⛔ 单题错误率用「答错人数 ÷ 作答人数」，不能用人次：
    //    考试里同一道题可能出现多次（重考/重复提交），人次会把分母放大到 158 而人数只有 44，
    //    于是出现「30/158 却标 91.1%」这种自相矛盾的展示（2026-10-25 实测发现）。
    const stuCount = num(r.students);
    const errStudents = num(r.err_students);
    d.questions.push({
      知识点: clusterLabel(r.cluster_id),
      题型: typeName,
      题干摘要: String(r.content || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
      作答人数: stuCount,
      答错人数: errStudents,
      答错率: pct(errStudents, stuCount),
    });
  }

  /** 把 Map 汇总转成按错误率降序的数组，并补上错误率字段 */
  const rankByErrRate = (mapLike) =>
    [...mapLike.values()]
      .filter((x) => x.作答人次 >= 3) // 样本太小（只有一两个人做了）的错误率没有参考价值
      .map((x) => ({ ...x, 错误率: pct(x.答错人次, x.作答人次) }))
      .sort((a, b) => (b.错误率 ?? 0) - (a.错误率 ?? 0));

  const byExam = new Map();
  for (const r of records) {
    if (!Number(r.participated)) continue;
    if (!byExam.has(r.test_id)) byExam.set(r.test_id, []);
    byExam.get(r.test_id).push({ student_id: r.student_id, score: num(r.score) });
  }

  const list = exams.map((e, examIdx) => {
    const passing = e.passing_score === null || e.passing_score === undefined ? 60 : num(e.passing_score);
    const rs = byExam.get(e.id) || [];
    const scores = rs.map((r) => r.score);
    const n = scores.length;
    const sum = scores.reduce((a, b) => a + b, 0);
    const pass = scores.filter((s) => s >= passing).length;
    const excellent = scores.filter((s) => s >= 85).length;
    const buckets = [
      { 区间: `0-${passing - 1}`, 人数: scores.filter((s) => s < passing).length },
      { 区间: '60-69', 人数: scores.filter((s) => s >= 60 && s < 70).length },
      { 区间: '70-79', 人数: scores.filter((s) => s >= 70 && s < 80).length },
      { 区间: '80-89', 人数: scores.filter((s) => s >= 80 && s < 90).length },
      { 区间: '90-100', 人数: scores.filter((s) => s >= 90).length },
    ];
    const sorted = [...rs].sort((a, b) => a.score - b.score);
    const lowOnes = sorted.slice(0, 5).map((r) => {
      const st = nameMap.get(r.student_id) || {};
      return { 姓名: st.real_name || '', 账号: st.username || '', 分数: r.score };
    });
    // 考试明细（知识点错误率 / 题型 / 单题）：只对最近 3 场做，避免多场考试把上下文撑爆
    const detail = examIdx < 3 ? detailByExam.get(e.id) : null;
    const clusterRank = detail ? rankByErrRate(detail.clusters) : [];
    const typeRank = detail ? rankByErrRate(detail.types) : [];
    const hardest = detail
      ? [...detail.questions].filter((q) => q.作答人数 >= 3).sort((a, b) => (b.答错率 ?? 0) - (a.答错率 ?? 0)).slice(0, 10)
      : [];

    // 分数段带名单：老师看到「0-59 有 6 人」之后，第一反应一定是「哪 6 个」
    const bucketsWithNames = buckets.map((b, bi) => {
      let members;
      if (bi === 0) {
        members = sorted.filter((r) => r.score < passing);
      } else if (b.区间 === '60-69') {
        members = sorted.filter((r) => r.score >= 60 && r.score < 70);
      } else if (b.区间 === '70-79') {
        members = sorted.filter((r) => r.score >= 70 && r.score < 80);
      } else if (b.区间 === '80-89') {
        members = sorted.filter((r) => r.score >= 80 && r.score < 90);
      } else {
        members = sorted.filter((r) => r.score >= 90);
      }
      const names = members
        .map((r) => nameMap.get(r.student_id) || {})
        .map((st) => st.real_name || st.username || '')
        .filter(Boolean);
      return {
        区间: b.区间,
        人数: b.人数,
        名单: names.length > 12 ? [...names.slice(0, 12), `等 ${names.length} 人`] : names,
      };
    });

    const out = {
      考试名称: e.title,
      及格线: passing,
      考试时间: e.created_at ? new Date(e.created_at).toISOString().slice(0, 10) : '',
      参考人数: n,
      班级人数: size,
      未参加人数: Math.max(0, size - n),
      平均分: n ? round1(sum / n) : null,
      最高分: n ? Math.max(...scores) : null,
      最低分: n ? Math.min(...scores) : null,
      及格率: n ? pct(pass, n) : null,
      优秀率: n ? pct(excellent, n) : null,
      分数段: bucketsWithNames,
      最低的5人: lowOnes,
    };

    if (detail) {
      // 最近一场额外给「全员分数」：只有拿到完整分布，AI 才能判断是两极分化还是整体偏低
      if (examIdx === 0) {
        out.全员分数 = sorted.map((r) => {
          const st = nameMap.get(r.student_id) || {};
          return [st.real_name || st.username || '', r.score];
        });
      }
      out.知识点错误率 = clusterRank.slice(0, examIdx === 0 ? 12 : 6).map((c) => ({
        知识点: c.知识点,
        题目数: c.题目数,
        作答人次: c.作答人次,
        错误率: c.错误率,
      }));
      out.题型错误率 = typeRank.map((t) => ({
        题型: t.题型,
        题目数: t.题目数,
        作答人次: t.作答人次,
        错误率: t.错误率,
      }));
      out.最容易错的题 = hardest.map((q) => ({
        知识点: q.知识点,
        题干摘要: q.题干摘要.slice(0, 45) + (q.题干摘要.length > 45 ? '…' : ''),
        答错人数: q.答错人数,
        作答人数: q.作答人数,
        答错率: q.答错率,
      }));
    }

    return out;
  });

  const metrics = {
    班级: base.name,
    班级人数: size,
    说明:
      '只统计真正参加考试的学生，未参加的 0 分占位记录已剔除。' +
      '考试是同一时间、同一份卷、不能翻资料作答，比平时练习更能反映真实掌握程度。',
    字段说明: {
      知识点错误率: '该场考试里每个知识点的答错人次 ÷ 作答人次，按错误率从高到低排；这是判断「该补什么」最直接的依据',
      题型错误率: '按题型汇总的错误率，可看出是「选择题猜不准」还是「填空题写不出」',
      最容易错的题: '单题答错率排名，带题干摘要，可直接拿去讲评',
      分数段: '每档都带学生姓名名单',
      全员分数: '只有最近一场提供，格式 [姓名, 分数]',
    },
    考试列表: list,
  };

  const tables = [
    {
      title: '各场考试概况',
      columns: ['考试', '时间', '参考/班级人数', '平均分', '最高', '最低', '及格率', '优秀率'],
      rows: list.map((e) => [
        e.考试名称,
        e.考试时间,
        `${e.参考人数}/${e.班级人数}`,
        e.平均分 === null ? '—' : e.平均分,
        e.最高分 === null ? '—' : e.最高分,
        e.最低分 === null ? '—' : e.最低分,
        e.及格率 === null ? '—' : `${e.及格率}%`,
        e.优秀率 === null ? '—' : `${e.优秀率}%`,
      ]),
    },
  ];
  if (list.length) {
    const latest = list[0];
    tables.push({
      title: `最新一场分数段：${latest.考试名称}`,
      columns: ['分数段', '人数', '名单'],
      rows: latest.分数段.map((b) => [b.区间, b.人数, (b.名单 || []).join('、') || '—']),
    });
    tables.push({
      title: `最新一场最低的 5 人：${latest.考试名称}`,
      columns: ['账号', '姓名', '分数'],
      rows: latest.最低的5人.map((s) => [s.账号, s.姓名, s.分数]),
    });

    // 考试的知识点错误率 —— 这是整块里最有教学价值的数据，单独成表
    if (Array.isArray(latest.知识点错误率) && latest.知识点错误率.length) {
      tables.push({
        title: `最新一场知识点错误率：${latest.考试名称}`,
        columns: ['知识点', '题目数', '作答人次', '错误率'],
        rows: latest.知识点错误率.map((c) => [
          c.知识点 || '未分类',
          c.题目数,
          c.作答人次,
          c.错误率 === null ? '—' : `${c.错误率}%`,
        ]),
      });
    }
    if (Array.isArray(latest.题型错误率) && latest.题型错误率.length) {
      tables.push({
        title: `最新一场题型错误率：${latest.考试名称}`,
        columns: ['题型', '题目数', '作答人次', '错误率'],
        rows: latest.题型错误率.map((c) => [
          c.题型,
          c.题目数,
          c.作答人次,
          c.错误率 === null ? '—' : `${c.错误率}%`,
        ]),
      });
    }
    if (Array.isArray(latest.最容易错的题) && latest.最容易错的题.length) {
      tables.push({
        title: `最新一场最容易错的题：${latest.考试名称}`,
        columns: ['知识点', '题干', '答错/作答人数', '答错率'],
        rows: latest.最容易错的题.map((q) => [
          q.知识点 || '未分类',
          q.题干摘要,
          `${q.答错人数}/${q.作答人数}`,
          q.答错率 === null ? '—' : `${q.答错率}%`,
        ]),
      });
    }
  }

  return { metrics, tables };
}

// ============ 指标包总入口 ============
async function buildContext(pool, { classId, topic }) {
  const key = TOPIC_KEYS.includes(topic) ? topic : 'overview';
  const meta = TOPICS.find((t) => t.key === key);
  const base = await loadClassBase(pool, classId);
  if (!base) return null;

  const threshold = await getMasterThreshold(pool);

  let built;
  if (key === 'overview') built = await buildOverview(pool, base, threshold);
  else if (key === 'mastery') built = await buildMastery(pool, base, threshold);
  else if (key === 'wrong') built = await buildWrong(pool, base);
  else if (key === 'students') built = await buildStudents(pool, base, threshold);
  else if (key === 'exam') built = await buildExam(pool, base);
  else built = await buildOverview(pool, base, threshold);

  return {
    topic: key,
    topic_label: meta.label,
    class_id: base.id,
    class_name: base.name,
    student_count: base.studentIds.length,
    generated_at: new Date().toISOString(),
    master_threshold: threshold,
    metrics: built.metrics,
    tables: built.tables || [],
  };
}

// ============ 提示词 ============
// ⛔ 系统提示词写死在服务端：老师只能问问题，不能改规则。
//    否则一句「忽略上面的限制」就能让 AI 开始编数字。
const SYSTEM_PROMPT = `你是江苏省高中信息技术教师的教学数据助手。你的任务是把已经统计好的班级数据讲清楚，帮助任课老师快速判断学情。

严格遵守以下规则：
1. 你只能使用「数据」部分给出的数字。禁止推测、禁止补充数据里没有的信息、禁止编造学生姓名或分数。
2. 用户问到数据里没有的内容，直接回答"这批数据里没有这项信息"，并说明可以切换到哪个分析主题。
3. 引用数字时必须与数据一致，不要做四舍五入以外的加工（例如数据写 62.5%，不要写成"约六成"这种模糊说法，可以直接说 62.5%）。
4. 你给出的是"数据反映的现象及可能原因假设"，不是诊断结论。涉及原因推测时，必须明确标注这是推测。
5. 不要点名批评学生个人。涉及具体学生时，用客观描述（例如"该生近 30 天练习 12 次，低于全班人均 43 次"）。
6. 涉及教学建议时，要落到可执行的动作（补哪一个知识点、练哪一类题、找哪几个学生谈），不要空泛。

输出格式（用 Markdown，总长度控制在 400 字以内）：
## 主要发现
2~4 条，每条一句话，必须带具体数字。**列举类信息最多列 5 项，超过就写"等 N 项"，不要逐条罗列。**
## 值得注意的地方
0~3 条。数据正常就写"未见明显异常"。
## 建议
2~3 条可执行动作。

数据不足时不要凑字数，直接说明缺什么。宁可少说，也不要为了完整而把每一项都铺开。`;

/**
 * 拼装对话消息。
 *
 * 结构固定为：系统规则 → 数据上下文（单独一条）→ 历史轮次 → 当前问题。
 * ⛔ 历史轮次里只带文字、不带数字：每轮都重新注入最新的指标包，
 *    老师改完数据再追问时 AI 看到的是新数字，不会沿用旧结论。
 * 只保留最近 6 条（3 轮），防止长对话把 token 堆到没必要的高度。
 */
function buildMessages(context, question, history = []) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `以下是「${context.class_name}」的${context.topic_label}数据（统计时间：${context.generated_at.slice(0, 19).replace('T', ' ')}），` +
        '请先读一遍，后面我就这份数据向你提问：\n\n' +
        '```json\n' +
        JSON.stringify(context.metrics, null, 1) +
        '\n```',
    },
    { role: 'assistant', content: '已读取，请问。' },
  ];

  const tail = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }))
    : [];
  for (const m of tail) messages.push(m);

  messages.push({ role: 'user', content: String(question) });
  return messages;
}

module.exports = {
  TOPICS,
  TOPIC_KEYS,
  buildContext,
  buildMessages,
  clusterLabel,
};
