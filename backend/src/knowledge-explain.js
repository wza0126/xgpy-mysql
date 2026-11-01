/**
 * 知识点 · AI 讲解脚本（讲义切片 + 提示词 + 规范化 + 兜底）
 *
 * 用途：学习模块每个知识点（chapter-taxonomy 的小节）标题后的耳机按钮，
 *       点开把这一节讲义讲成一节「微型课」。
 *
 * 与「编程填空 AI 讲解」的差别（结构不一样，讲法也不能照抄）：
 *   · 填空讲的是「第 N 空填什么」，一空一步，有确定答案；
 *   · 知识点讲的是一段有结构的讲义，要按「导入 → 要点 → 易错 → 考点 → 口诀 → 随堂问」组织，
 *     而且高一新课和高二复习的节奏完全不同（复习要跳过例子和随堂问）。
 *     所以脚本是「一节课」的骨架，不是「一串空」。
 *
 * ⛔ 事实必须来自讲义原文：讲稿里出现的年份、版本号、标准编号、参数一律以讲义为准。
 *    模型只负责「怎么讲」（例子、类比、口诀、串词），不负责「讲什么事实」。
 *    所以提示词里给了讲义原文，并要求不许引入讲义之外的具体事实。
 * ⛔ 随堂问题的答案必须能从讲义原文推出：课堂上老师会照着念，答案错了很尴尬。
 *    规范化时校验 answer 必须是合法选项字母，否则整题丢弃（宁缺勿错）。
 * ⛔ 模型失败不能让功能消失：走 buildFallbackScript（把讲义原文分段朗读），学生照样能听。
 */

const { LECTURE_ANCHOR_HINTS, findHeadings, normalizeTitle, stripNumbering } = require('./lecture-anchors');

const PROMPT_VERSION = 'knowledge-v1';

/** 讲义正文送进模型的上限（字符）。超过的部分砍掉，避免 token 爆掉 */
const MAX_LECTURE_CHARS = 2600;

function clip(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 把讲义 HTML 转成「能读的纯文本」：保留段落/列表/表格的行结构，图换成占位 */
function htmlToPlain(html) {
  let s = String(html || '');
  s = s.replace(/<img\b[^>]*>/gi, '（此处有图）');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '· ');
  s = s.replace(/<\/t[dh]>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&amp;/gi, '&');
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 找某小节在讲义里对应的标题下标。
 *
 * ⛔ 不能只用 chapter-taxonomy 的锚点口径（computeChapterAnchors 只取第一个命中）：
 *    词表一节 ↔ 讲义多个标题的情况很常见（如「数据、信息与知识的概念」= 讲义 1.数据 / 2.信息 / 3.知识），
 *    只取第一个会把后两个标题下的内容整段丢掉，讲稿就只讲了「数据」不讲「信息、知识」。
 *    这里把命中的标题全收下来，取「最早命中」到「最晚命中」的子树范围。
 */
function resolveSectionHeadings(chapter, html, section) {
  const headings = findHeadings(html || '');
  if (!headings.length) return { headings, indexes: [] };

  const exact = (target) => {
    const key = normalizeTitle(target);
    return headings.filter((h) => normalizeTitle(h.text) === key).map((h) => h.index);
  };

  const rule = (LECTURE_ANCHOR_HINTS[chapter] || {})[section];
  if (rule != null) {
    const list = Array.isArray(rule) ? rule : [rule];
    const hits = [];
    for (const item of list) {
      const got = exact(String(item).replace(/^\^/, ''));
      if (got.length) hits.push(got[0]);
    }
    if (hits.length) return { headings, indexes: [...new Set(hits)] };
  }

  const key = stripNumbering(section);
  if (!key) return { headings, indexes: [] };
  let hits = headings.filter((h) => stripNumbering(h.text) === key).map((h) => h.index);
  if (!hits.length) {
    hits = headings
      .filter((h) => {
        const t = stripNumbering(h.text);
        return t.length >= 3 && (t.includes(key) || key.includes(t));
      })
      .map((h) => h.index);
  }
  return { headings, indexes: hits.length ? [hits[0]] : [] };
}

/**
 * 取出某小节在讲义里的正文（纯文本）。
 * 范围：该小节第一个命中标题起，到「层级 <= 起始标题层级」的下一个标题前为止。
 */
function extractSectionText(chapter, html, section) {
  const { headings, indexes } = resolveSectionHeadings(chapter, html, section);
  if (!indexes.length) return '';
  const start = headings[Math.min(...indexes)];
  const last = headings[Math.max(...indexes)];
  let endPos = String(html || '').length;
  for (const h of headings) {
    if (h.index > last.index && h.level <= start.level) {
      endPos = h.openStart;
      break;
    }
  }
  return htmlToPlain(String(html || '').slice(start.openStart, endPos));
}

/** 讲稿的系统提示词。改这里等于改全站讲解口径，注意同步 PROMPT_VERSION */
function buildSystemPrompt() {
  return [
    '你是一位江苏省高中信息技术老师，使用教科版必修1《数据与计算》和必修2《信息系统与社会》，',
    '现在要把【一个知识点】讲成一节 6 到 10 分钟的微型课。同一份讲稿还要供高二学业水平测试复习使用。',
    '',
    '【绝对不能做】',
    '1. 不许编造讲义里没有的具体事实：年份、版本号、标准编号、参数、公司名、数据量。讲义没写就用"教材里给的"这种说法带过。',
    '2. 不许把内容扩展到其他小节，只讲给定的这个知识点。',
    '3. 不许出现"显然""众所周知""易证""大家注意听"这类词。',
    '4. 不许写"同学们好""让我们一起走进"这类空话开场。',
    '',
    '【必须做到】',
    '5. 先例子后定义：抽象概念一定先给一个高一学生能立刻点头的生活例子或类比，再给严谨表述。',
    '6. say 是"说出来的话"：口语、短句，一句不超过 40 字，不要书面长句，不要念括号和编号。',
    '7. key 是写在黑板上给学生抄的那一行，要和 say 互补而不是复述：尽量短、可背、可当笔记。',
    '8. 易错点必须来自讲义里真正容易混的地方（讲义中标了 ⚠ 或写"注意""易错""必背"的优先），没有把握就少写。',
    '9. exam 要说清学测怎么考：选择题辨析、填空、还是计算，考哪个点。',
    '10. mnemonic 要能给出口诀、谐音或对比关系，让学生一句就想起整块内容。',
    '11. quiz 只出 1 到 2 道，选项互斥且只有一个明确正确，答案必须能由讲义原文直接推出；宁可不给，也不要出错。',
    '',
    '【输出】只输出 JSON，不要 Markdown 代码块，不要任何解释文字。',
    '顶层只有 7 个键，一个都不能少，而且**必须是顶层**（不要把 points 之类塞进 intro 里面）：',
    '{',
    '  "intro": {"hook": "一句话点题，≤24字", "say": "导入：生活场景+为什么学，≤120字"},',
    '  "objectives": ["能说出…（≤22字）", "能判断…", "能算出…"],',
    '  "points": [{"title": "≤12字", "key": "板书要点≤60字", "say": "讲解词≤150字", "example": "例子≤80字，可为空串"}],',
    '  "pitfalls": [{"what": "错在哪≤18字", "say": "为什么容易错≤100字", "how": "正确做法≤60字"}],',
    '  "exam": "学测怎么考，≤120字",',
    '  "mnemonic": "一句话记住，≤40字",',
    '  "quiz": [{"q": "题干≤60字", "options": ["选项1", "选项2", "选项3"], "answer": "A", "why": "为什么≤80字"}]',
    '}',
    '',
    'points 给 3 到 5 个，按讲义的实际结构拆；pitfalls 给 1 到 3 个，讲义没有明显易错点就给 1 个最常混的；',
    'quiz 给 1 到 2 道，如果没有把握出题就给空数组 []。',
  ].join('\n');
}

/**
 * 构造提示词。
 * @param {{chapter:string, section:string, code?:string, text:string, sampleQuestions?:string[], questionCount?:number}} ctx
 */
function buildPrompt(ctx) {
  const systemPrompt = buildSystemPrompt();

  const samples = (ctx.sampleQuestions || []).filter(Boolean).slice(0, 4);
  const userPrompt = [
    `【教材章节】${ctx.chapter}`,
    `【本次要讲的知识点】${ctx.section}${ctx.code ? `（学分代码 ${ctx.code}）` : ''}`,
    '',
    '【该知识点的讲义原文】',
    clip(ctx.text, MAX_LECTURE_CHARS),
    '',
    samples.length
      ? `【本节练习题题干摘录，仅供你判断学测怎么考，不要把题干抄进讲稿】\n${samples.map((s, i) => `${i + 1}. ${clip(s, 70)}`).join('\n')}`
      : '',
    '',
    `请输出 JSON。必须包含 objectives 三个字段，逐条写成本条知识点的学习目标，每条以"能说出""能判断""能算出""会区分"开头。`,
    `points 3 到 5 个（按讲义结构拆），pitfalls 1 到 3 个，quiz 1 到 2 道。`,
  ].filter(Boolean).join('\n');

  return { systemPrompt, userPrompt, promptVersion: PROMPT_VERSION };
}

/* ---------------------------------------------------------------- 规范化 */

const QUIZ_LETTERS = 'ABCDEF';

function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('；');
  if (typeof v === 'object') {
    // 模型偶尔把 {title, content} 这种对象塞进来
    return asText(v.text || v.content || v.title || v.say || v.value || '');
  }
  return '';
}

function asList(v) {
  return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
}

/**
 * 把模型「嵌套错位」的输出拉平。
 *
 * ⛔ 实测（2026-11-01）模型会把 objectives / points / pitfalls / exam … 全部塞进 intro 里，
 *    只剩一个顶层键 {"intro":{...}}。不兼容的话整份讲稿会退化成兜底的讲义原文，
 *    看起来"生成成功"，实际内容全丢。
 * 这里把 intro / body / content 等容器里"本该在顶层"的字段提上来。
 */
function liftNested(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const FIELDS = ['intro', 'objectives', 'points', 'pitfalls', 'exam', 'mnemonic', 'quiz'];

  const containers = [];
  if (src.intro && typeof src.intro === 'object' && !Array.isArray(src.intro)) containers.push(src.intro);
  for (const k of ['body', 'content', 'data', 'script', 'lesson', 'result']) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) containers.push(v);
  }

  for (const c of containers) {
    // intro 自己既是容器又是字段：只有当它没有 hook/say 时才整个搬
    if (c !== src.intro) {
      if (src.intro == null && (c.hook || c.say)) src.intro = { hook: c.hook, say: c.say };
    }
    for (const f of FIELDS) {
      if (f === 'intro') continue;
      if (src[f] == null && c[f] != null) src[f] = c[f];
    }
  }
  return src;
}

/** 模型偶尔把 points 写成 {"1":{...},"2":{...}} 这种对象，转成数组 */
function asObjectList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const vals = Object.values(v);
    return vals.every((x) => x && typeof x === 'object') ? vals : [];
  }
  return v == null || v === '' ? [] : [v];
}

/**
 * 规范化模型输出：字段兜底、长度裁剪、结构校验。
 * ⛔ 随堂问题目答案不合法就整题丢弃 —— 老师会照着念，错答案比没有题更糟。
 */
function normalizeScript(raw, ctx) {
  const src = liftNested(raw);

  const introRaw = src.intro;
  const hook = clip(asText(introRaw && typeof introRaw === 'object' ? introRaw.hook : ''), 40);
  const introSay = clip(
    asText(introRaw && typeof introRaw === 'object' ? introRaw.say : introRaw),
    240,
  );

  // 模型有时把 objectives 塞进 intro 里（见 liftNested 注释）
  const objectives = asList(src.objectives || (src.intro && typeof src.intro === 'object' ? src.intro.objectives : null))
    .map((o) => clip(asText(o), 48))
    .filter(Boolean)
    .slice(0, 4);

  const points = asObjectList(src.points)
    .map((p) => {
      const o = p && typeof p === 'object' ? p : { title: p };
      return {
        title: clip(asText(o.title || o.name || o.heading), 24),
        key: clip(asText(o.key || o.board || o.note), 120),
        say: clip(asText(o.say || o.explain || o.content), 300),
        example: clip(asText(o.example || o.case || o.analogy), 160),
      };
    })
    .filter((p) => p.title || p.say)
    .slice(0, 6);

  const pitfalls = asObjectList(src.pitfalls)
    .map((p) => {
      const o = p && typeof p === 'object' ? p : { what: p };
      return {
        what: clip(asText(o.what || o.title || o.error || o.wrong), 40),
        say: clip(asText(o.say || o.why || o.explain || o.content), 200),
        how: clip(asText(o.how || o.fix || o.right || o.correct), 120),
      };
    })
    .filter((p) => p.what || p.say)
    .slice(0, 4);

  const exam = clip(asText(src.exam || src.examTip || src.test), 240);
  const mnemonic = clip(asText(src.mnemonic || src.remember || src.slogan), 80);

  const quiz = asObjectList(src.quiz)
    .map((q) => {
      const o = q && typeof q === 'object' ? q : {};
      const options = asList(o.options).map((x) => clip(asText(x), 60)).filter(Boolean).slice(0, 4);
      let answer = asText(o.answer).trim().toUpperCase();
      // 模型可能给 "A" / "A." / "A、选项原文" / 选项原文本身
      const letter = (answer.match(/^[A-F]/) || [])[0] || '';
      if (!letter) {
        const byText = options.findIndex((x) => normalizeTitle(x) === normalizeTitle(answer));
        answer = byText >= 0 ? QUIZ_LETTERS[byText] : '';
      } else {
        answer = letter;
      }
      return {
        q: clip(asText(o.q || o.question || o.stem), 120),
        options,
        answer,
        why: clip(asText(o.why || o.explain || o.reason), 160),
      };
    })
    // ⛔ 至少两个选项、答案必须落在选项范围内，否则丢弃
    .filter((q) => q.q && q.options.length >= 2 && QUIZ_LETTERS.indexOf(q.answer) >= 0 && QUIZ_LETTERS.indexOf(q.answer) < q.options.length)
    .slice(0, 2);

  const fallback = buildFallbackScript(ctx);
  return {
    intro: {
      hook: hook || fallback.intro.hook,
      say: introSay || fallback.intro.say,
    },
    objectives: objectives.length ? objectives : fallback.objectives,
    points: points.length ? points : fallback.points,
    pitfalls,
    exam: exam || fallback.exam,
    mnemonic: mnemonic || '',
    quiz,
  };
}

/* ---------------------------------------------------------------- 兜底 */

/**
 * 质量闸：判断模型的原始输出够不够格。
 *
 * ⛔ 实测两种坏输出必须拦住：
 *    ① 字段全塞进 intro（顶层只剩 intro），解析"成功"但内容是空的；
 *    ② 输出被截断，只剩前半段（特征是 exam / mnemonic 这两个尾部字段必然缺失）。
 *    拦不住的话，会把残次品缓存下来，学生永远听到这份讲稿。
 */
function isUsableRaw(raw) {
  const f = liftNested(raw);
  const pts = asObjectList(f.points).filter((p) => p && typeof p === 'object' && (p.title || p.say));
  return pts.length >= 2 && !!(f.exam || f.mnemonic);
}

/**
 * 模型不可用时的兜底：直接把讲义原文按段落切成要点朗读。
 * ⛔ 不缓存（degraded=true），下次还重试生成；但学生至少不是点开一片空白。
 */
function buildFallbackScript(ctx) {
  const paras = String(ctx.text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 8 && !/^[（(]?\d+[.、）)]/.test(l));
  const pick = paras.slice(0, 5).map((p) => ({
    title: clip(p, 20),
    key: '',
    say: clip(p, 200),
    example: '',
  }));
  return {
    intro: {
      hook: `${ctx.section}：这一节我们要弄明白几件事`,
      say: `这一节讲${ctx.section}。AI 讲解暂时不可用，先按讲义原文一段一段过一遍。`,
    },
    objectives: [],
    points: pick.length ? pick : [{
      title: ctx.section,
      key: '',
      say: '这一节的讲义正文暂时读不到，请先看右侧讲义原文。',
      example: '',
    }],
    pitfalls: [],
    exam: '',
    mnemonic: '',
    quiz: [],
  };
}

module.exports = {
  PROMPT_VERSION,
  liftNested,
  isUsableRaw,
  MAX_LECTURE_CHARS,
  htmlToPlain,
  extractSectionText,
  buildPrompt,
  normalizeScript,
  buildFallbackScript,
};
