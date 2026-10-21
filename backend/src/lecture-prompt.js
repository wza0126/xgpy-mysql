// AI 讲堂 · 微课程提示词与分页校验（唯一真源）
// ============================================================
// 与 explain-styles.js 的关系：
//  - 风格片段（snippet）仍然从 explain_styles 取，老师改风格对微课程同样生效；
//  - 但**结构锚定与公共规则必须另写**：错题讲解的规则是「先报答案、逐项辨析」，
//    微课程没有选项也没有答案，套过来会讲成「这题选 B」，学生听着莫名其妙。
//
// 三条硬约束（都踩过或必然踩）：
//  ① 页数必须封顶：一次生成 8 页约 2000 字 JSON，模型写到一半被截断的概率很高。
//  ② chart / table 的数字必须能在老师给的大纲里找到原文，否则降级成要点页 ——
//     模型极爱自己编「1000 个数比较 10 次」这种数据，画出来与知识点对不上，比不画更糟。
//  ③ narration 一律 clip 到 400 字：TTS 单句上限 300，超了会 400 报错导致整页没声音。

const PAGE_KINDS = ['lead', 'point', 'steps', 'table', 'chart', 'code', 'example', 'recap'];

/** 每种页型在提示词里的说明（也是前端渲染的字段约定） */
const PAGE_KIND_DOC = `- lead（引入，每课第一页）：kicker 一句钩子（≤20 字，写「为什么学这个」），narration 把学生带进来。
- point（要点）：bullets 2 到 4 条，每条 ≤24 字，是这一页的骨架。
- steps（流程）：steps 2 到 4 步，每步 {label: 动作名 ≤10 字, text: 一句说明 ≤20 字}。
- table（对比）：table.columns 2 到 3 列（≤12 字），table.rows 2 到 4 行，每行与列数一致（≤12 字）。
- chart（柱状图）：只在**大纲里本身就有数字对比**时用；chart.unit ≤6 字，chart.items ≤5 项，label ≤8 字，value 必须是数字。
- code（代码）：code.lang 取 python / sql / text 之一，code.text 不超过 12 行，note 一句说明 ≤40 字。
- example（例子）：scenario 情景 ≤60 字，question 设问 ≤40 字，answer 答案 ≤60 字（会被"揭晓式"呈现）。
- recap（小结，每课最后一页）：bullets 2 到 3 条，每条 ≤24 字，收束全课。`;

const LECTURE_BASE = `你是江苏省高中信息技术老师，正在为「AI 讲堂」录制一节微课程。你的讲解词会被机器逐句念出来投屏给学生看。

【内容底线】
1. 面向江苏省学业水平测试，严格不超纲；术语按教科版《数据与计算》《信息系统与社会》的口径。
2. 只讲老师给的【知识点大纲】里涉及的 content，不要自行扩展到大纲之外的新概念。
3. 输出的每个字都会被朗读：讲解词里不要写括号、星号、markdown、序号符号、数学符号。
4. 讲解词里不要出现「这道题」「选 A」「答案选」这类做题话术，这是在上一节课，不是在讲一道题。
5. 宁可少讲一个点，也不要把数字、日期、人名编出来。`;

const LECTURE_RULES = `【公共规则，任何风格都不许违反】
1. 每页先有一句结论式标题（≤16 字），再展开讲；不要用「第一页」「接下来」当标题。
2. 每个专业名词第一次出现时，紧跟一句大白话解释，例如「RAM 就是临时桌面，一断电就清空」。
3. 讲解词每句不超过 35 个字，短句为主，适合直接朗读；一页讲清一件事。
4. 禁止否定式评价（这都不会、这么简单、太粗心），禁止网络烂梗，禁止「同学们」这类称呼。
5. 禁止在讲解词里念出页型名称（不要说「这一页是流程图」）。`;

const LECTURE_STRUCTURE = `【输出结构】只输出一个 JSON 对象，不要解释文字、不要代码块标记：
{
  "title": "课程标题（≤20 字）",
  "pages": [
    { "kind": "lead", "title": "页标题", "kicker": "为什么学这个", "narration": "要念的话" },
    { "kind": "point", "title": "页标题", "narration": "要念的话", "bullets": ["要点1", "要点2"] },
    { "kind": "steps", "title": "页标题", "narration": "要念的话", "steps": [{ "label": "步骤名", "text": "一句说明" }] },
    { "kind": "table", "title": "页标题", "narration": "要念的话", "table": { "columns": ["列1", "列2"], "rows": [["格1", "格2"]] } },
    { "kind": "chart", "title": "页标题", "narration": "要念的话", "chart": { "unit": "单位", "items": [{ "label": "标签", "value": 3 }] } },
    { "kind": "code", "title": "页标题", "narration": "要念的话", "code": { "lang": "python", "text": "代码" }, "note": "一句说明" },
    { "kind": "example", "title": "页标题", "narration": "要念的话", "scenario": "情景", "question": "设问", "answer": "答案" },
    { "kind": "recap", "title": "页标题", "narration": "要念的话", "bullets": ["回顾1", "回顾2"] }
  ]
}

${PAGE_KIND_DOC}`;

const clip = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
/** 多行文本（代码）不能压成一行，单独处理：去 HTML 标签、保留换行 */
const clipMultiline = (s, n) =>
  String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);

const PAGE_MIN = 3;
const PAGE_MAX = 12;
/** 一页讲解词的字数上下限（clip 上限取 TTS 单句上限 300 的安全值） */
const NARRATION_MAX = 300;

function clampPageTarget(v, fallback = 7) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), PAGE_MIN), PAGE_MAX);
}

/** 拼微课程系统提示词：结构锚定 → 公共规则 → 风格片段 → 结构复述 → 页数约束 */
function buildLectureSystemPrompt(style, opts = {}) {
  const pageTarget = clampPageTarget(opts.pageTarget);
  const styleName = (style && style.name) || '课堂讲授';
  const snippet = String((style && style.snippet) || '').trim();
  return [
    LECTURE_BASE,
    LECTURE_RULES,
    `【讲解风格：${styleName}】\n${snippet}\n注意：风格只改「怎么说」，上面关于内容与结构的要求一句都不能改。`,
    LECTURE_STRUCTURE,
    `【本课规模】共 ${pageTarget} 页（允许 ${pageTarget - 1} 到 ${pageTarget + 1} 页）：第一页必须是 lead，最后一页必须是 recap，中间从 point / steps / table / chart / code / example 里按内容需要挑，不要为了凑数硬塞。
每页 narration 80 到 200 字，两句到四句。整个 JSON 必须在 ${pageTarget * 260} 字以内写完，不要截断。`,
  ].join('\n\n');
}

/** 单页重生成的系统提示词：同一套规则，但只产出一页 */
function buildLecturePagePrompt(style, opts = {}) {
  const styleName = (style && style.name) || '课堂讲授';
  const snippet = String((style && style.snippet) || '').trim();
  return [
    LECTURE_BASE,
    LECTURE_RULES,
    `【讲解风格：${styleName}】\n${snippet}\n注意：风格只改「怎么说」，内容与结构的要求一句都不能改。`,
    LECTURE_STRUCTURE,
    `【本次只重写一页】只输出这一个页面对象（不要包在 pages 里），kind 必须是 ${(opts.allowKinds || PAGE_KINDS).join(' / ')} 之一。
narration 80 到 200 字。不要重复其他页已经讲过的话。`,
  ].join('\n\n');
}

/** 提示词版本：含风格片段，改风格即变（只用于记录，微课程不做自动失效） */
function lecturePromptVersion(systemPrompt) {
  const crypto = require('crypto');
  return 'lec1:' + crypto.createHash('sha1').update(String(systemPrompt)).digest('hex').slice(0, 12);
}

/** 大纲里是否出现过这个数字（用于 chart / table 的防编数） */
function numberAppearsIn(value, haystack) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  const text = String(haystack || '');
  if (!text.trim()) return false;
  const intPart = Math.abs(n) % 1 === 0 ? String(Math.abs(n)) : String(Math.abs(n));
  return text.includes(intPart);
}

/** 把 chart 页降级成 point 页：保留讲解词，把数据变成要点，避免「编出来的图」 */
function chartToPoint(page) {
  const items = (page.chart && page.chart.items) || [];
  return {
    kind: 'point',
    title: page.title,
    narration: page.narration,
    bullets: items.slice(0, 4).map((it) => `${it.label} ${it.value}${(page.chart && page.chart.unit) || ''}`.slice(0, 24)),
  };
}

/**
 * 校验并规范化模型输出。
 * @param {object} obj 模型返回的 JSON
 * @param {object} opts { outline: 老师给的大纲原文, pageTarget }
 * @returns {{title:string, pages:Array}}
 */
function normalizeLecturePages(obj, opts = {}) {
  const outline = String(opts.outline || '');
  const pageTarget = clampPageTarget(opts.pageTarget);
  const rawPages = Array.isArray(obj && obj.pages) ? obj.pages : [];
  const pages = [];

  for (const p of rawPages) {
    if (!p || typeof p !== 'object') continue;
    const kind = PAGE_KINDS.includes(p.kind) ? p.kind : 'point';
    const narration = clip(p.narration, NARRATION_MAX);
    if (!narration) continue; // 没有讲解词的页等于空白页，直接丢

    const page = { kind, title: clip(p.title, 20) || '讲解', narration };

    if (kind === 'lead') {
      page.kicker = clip(p.kicker, 24);
    } else if (kind === 'steps') {
      page.steps = (Array.isArray(p.steps) ? p.steps : [])
        .slice(0, 4)
        .map((s) => ({ label: clip(s && s.label, 12), text: clip(s && s.text, 24) }))
        .filter((s) => s.label || s.text);
      if (page.steps.length < 2) {
        page.kind = 'point';
        page.bullets = page.steps.map((s) => `${s.label}${s.text ? '：' + s.text : ''}`.slice(0, 24));
        delete page.steps;
      }
    } else if (kind === 'table') {
      const cols = (Array.isArray(p.table && p.table.columns) ? p.table.columns : [])
        .slice(0, 3)
        .map((c) => clip(c, 14))
        .filter(Boolean);
      const rows = (Array.isArray(p.table && p.table.rows) ? p.table.rows : [])
        .slice(0, 4)
        .map((r) => (Array.isArray(r) ? r : []).slice(0, cols.length || 3).map((c) => clip(c, 14)));
      if (cols.length < 2 || rows.length < 1) {
        page.kind = 'point';
        page.bullets = [];
      } else {
        page.table = { columns: cols, rows };
      }
    } else if (kind === 'chart') {
      const items = (Array.isArray(p.chart && p.chart.items) ? p.chart.items : [])
        .slice(0, 5)
        .map((it) => ({ label: clip(it && it.label, 10), value: Number(it && it.value) }))
        .filter((it) => it.label && Number.isFinite(it.value));
      const unit = clip(p.chart && p.chart.unit, 6);
      // ⛔ 防编数：大纲里找不到的数值一律不画图，降级成要点
      const allFromOutline = items.length > 0 && items.every((it) => numberAppearsIn(it.value, outline));
      if (!allFromOutline) {
        const fallback = chartToPoint({ ...page, chart: { unit, items } });
        pages.push(fallback);
        continue;
      }
      page.chart = { unit, items };
    } else if (kind === 'code') {
      const codeText = clipMultiline(p.code && p.code.text, 1200);
      if (!codeText) {
        page.kind = 'point';
      } else {
        const lang = ['python', 'sql', 'text'].includes(p.code && p.code.lang) ? p.code.lang : 'text';
        page.code = { lang, text: codeText };
        page.note = clip(p.note, 60);
      }
    } else if (kind === 'example') {
      page.scenario = clip(p.scenario, 80);
      page.question = clip(p.question, 60);
      page.answer = clip(p.answer, 80);
      if (!page.scenario && !page.question) page.kind = 'point';
    } else {
      page.bullets = (Array.isArray(p.bullets) ? p.bullets : [])
        .slice(0, 4)
        .map((b) => clip(b, 26))
        .filter(Boolean);
    }

    pages.push(page);
    if (pages.length >= pageTarget + 1) break;
  }

  if (!pages.length) throw new Error('模型没有产出可用页面');
  // 收尾保底：page 数量不足时不做自造补充（宁缺勿编），只保证最少 1 页有内容
  return { title: clip(obj && obj.title, 24), pages };
}

/** 单页规范化的薄封装（复用同一套字段规则） */
function normalizeLecturePage(obj, opts = {}) {
  const one = normalizeLecturePages({ title: opts.title || '', pages: [obj] }, opts);
  return one.pages[0];
}

/** 按讲解词字数估算时长（中文朗读约 4.5 字/秒），用于列表展示 */
function estimateDuration(pages) {
  const total = (pages || []).reduce((sum, p) => sum + String((p && p.narration) || '').length, 0);
  return Math.max(10, Math.round(total / 4.5));
}

module.exports = {
  PAGE_KINDS,
  PAGE_MIN,
  PAGE_MAX,
  NARRATION_MAX,
  clampPageTarget,
  buildLectureSystemPrompt,
  buildLecturePagePrompt,
  lecturePromptVersion,
  normalizeLecturePages,
  normalizeLecturePage,
  estimateDuration,
  numberAppearsIn,
};
