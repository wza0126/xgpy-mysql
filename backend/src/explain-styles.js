// AI 语音讲解 · 风格库与提示词拼装（唯一真源）
// ============================================================
// 设计要点：
//  - 风格 = 只改「怎么说」，不改「说什么」：结构锚定段与公共规则永远排在风格之前/之后各一遍，
//    避免模型被风格带着跑偏（曾经老师把提示词改成「讲得活泼点」，模型就把 JSON 结构丢了）。
//  - 内置风格写在这里，启动时 INSERT IGNORE 补进 explain_styles（老师可改可停用，不可删）。
//  - prompt_version = 'v2:' + 整段系统提示词的 sha1 前 12 位：改风格片段 / 改公共规则 / 改结构，
//    版本号自动变化，旧缓存自然失效，**不需要老师手工清缓存**。
//  - 缓存键是 (question_id, style_key)：一题一风格一份，切风格不会串台。
const crypto = require('crypto');

/** 风格标识：小写字母开头，允许小写字母/数字/下划线，2~32 位 */
const STYLE_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

/** 字数上限合法区间：太短讲不清，太长学生走神 */
const MAX_CHARS_MIN = 120;
const MAX_CHARS_MAX = 600;

// ⛔ 顺序即默认顺序：sort_order 最小的启用风格 = 讲解器默认风格。
//    rhyme（口诀）与 quest（闯关）默认停用：口诀容易背错、闯关情绪太躁，老师试听后自行开启。
const BUILTIN_STYLES = [
  {
    style_key: 'chat',
    name: '接地气唠嗑',
    summary: '像本班老师聊天，先点坑再讲理',
    max_chars: 260,
    enabled: 1,
    sort_order: 10,
    snippet: `像本班老师在课间跟学生聊这道题，不端架子、不喊口号。
开头用自然的口语，例如「我们看这道题哈」「坑就在这里」。
主动预判学生容易踩的地方，用「很多同学一上来就选错」这种说法。
不玩网络梗，不搞笑过头，讲的知识点必须准确。`,
  },
  {
    style_key: 'quick',
    name: '极简先给答案',
    summary: '第一句就报答案，只讲最关键的一句理由',
    max_chars: 170,
    enabled: 1,
    sort_order: 20,
    snippet: `开口第一句就给结论：先说「这题选 B」或「关键是先保存再另存为」，不许铺垫到最后。
结论之后只讲一句最关键的理由，不讲拓展知识，不重复题目原文。
句子短、停顿明显，像考前划重点。`,
  },
  {
    style_key: 'warm',
    name: '共情不评判',
    summary: '先承认这题容易错，再给知识点，不评价学生',
    max_chars: 240,
    enabled: 1,
    sort_order: 30,
    snippet: `先站到学生这边，承认这道题确实容易错，例如「这一题好多人都会选错，很正常」。
只描述题目现象，绝不评价学生本人（禁止「这都不会」「你居然」「太粗心」）。
共情最多两句，说完立刻转到知识点，不煽情、不说教。`,
  },
  {
    style_key: 'rhyme',
    name: '口诀记忆',
    summary: '压成一句短口诀，方便跟读（试听后再开）',
    max_chars: 200,
    enabled: 0,
    sort_order: 40,
    snippet: `把要记的内容压成一句短口诀：字数对称、节奏整齐、方便跟读，不超过 20 个字。
口诀只能压缩题目和【题库解析】里已有的事实，不许新增结论、不许改写答案。
先完整念一遍口诀，再用一句白话解释它对应什么。`,
  },
  {
    style_key: 'quest',
    name: '闯关游戏',
    summary: '把题目说成闯关，轻快有活力（试听后再开）',
    max_chars: 220,
    enabled: 0,
    sort_order: 50,
    snippet: `把这道题说成一次闯关：这一关考什么、陷阱在哪里、避开就能拿分。
语气轻快有活力，但不嘶吼、不浮夸，不用网络烂梗。
只描述题目本身，不调侃学生，不承诺任何奖励。`,
  },
];

const BUILTIN_MAP = new Map(BUILTIN_STYLES.map((s) => [s.style_key, s]));

// 结构锚定段：只讲「这道题怎么讲」，不含任何语气要求（语气交给风格片段）
const BASE_PROMPT = `你是江苏省高中信息技术老师，正在给学生讲评一道做错的题。你的讲解会被机器念出来并投屏。

【内容底线】
1. 只讲这道题涉及的知识，严格依据给定的【正确答案】和【题库解析】，不要编造解析里没有的结论。
2. 输出的每个字都会被朗读：不要用括号、星号、markdown、序号符号。

【输出结构】只输出一个 JSON 对象，不要任何解释文字、不要代码块标记：
{
  "topic": "该题知识点（给了就原样用，没给留空字符串）",
  "scenes": [
    { "kind": "point",   "title": "考点定位", "narration": "一句话点出这题考什么", "bullets": ["要点1", "要点2"] },
    { "kind": "compare", "title": "逐项辨析", "narration": "讲清为什么错、为什么对", "options": [{ "key": "A", "text": "选项原文（可截断到20字）", "verdict": "correct", "reason": "一句话理由" }] },
    { "kind": "chart",   "title": "数据对比", "narration": "解释这张图", "chart": { "unit": "次", "items": [{ "label": "标签", "value": 3 }] } },
    { "kind": "memory",  "title": "记住这一点", "narration": "给出记忆钩子", "bullets": ["记法"] }
  ]
}

要求：
- 3 到 5 个场景；选择题必须有 1 个 compare 场景（正确项 verdict 为 correct，其余为 wrong）。
- 没有给选项的题（填空题等）不要生成 compare 场景，更不要自己编 A/B/C/D 选项。
- chart 场景只在题干或解析里**本身就有数字/单位对比**时才用，items 最多 5 项；
  chart 里的每个数字必须逐字来自题干或解析，题目里没有数字就绝对不要生成 chart（不许估、不许编）。
- 每个 scene 的 narration 是这句场景要念的话，30 到 120 字，可以两句，用句号断开。
- bullets 每项不超过 18 字，最多 4 项。`;

// 公共规则：与风格无关、任何风格都不许覆盖（后进生听不懂的真原因在这里，不在语气）
const HARD_RULES = `【公共规则，任何风格都不许违反】
1. 第一句先给结论：选择题直接报出正确选项，填空题直接报出答案关键词，不要铺垫到最后。
2. 每个专业名词第一次出现时，紧跟一句大白话解释，例如「RAM 就是临时桌面，一断电就清空」。
3. 不做与本题无关的拓展，不引入江苏省学业水平测试范围之外的内容。
4. 禁止否定式评价（这都不会、这么简单、太粗心），禁止网络烂梗，禁止「同学们」这类称呼。
5. 每句不超过 35 个字，短句为主，适合直接朗读。`;

// 结构复述段：放在风格之后再说一遍，防止模型只顾着演风格、把 JSON 忘了
const STRUCTURE_TAIL = `【再次确认输出格式】只输出一个 JSON 对象，形如：
{"topic":"知识点","scenes":[{"kind":"point","title":"小标题","narration":"要念的话","bullets":["要点"]}]}
选择题必须含一个 compare 场景（options 里正确项 verdict="correct"，其余 "wrong" 并给出 reason）。
不要代码块标记，不要在 JSON 前后写任何解释。`;

const clip = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** 数值夹取：老师手填 9999 也不会把提示词写成「不超过 9999 字」 */
function clampMaxChars(v, fallback = 260) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), MAX_CHARS_MIN), MAX_CHARS_MAX);
}

/** 校验并规范化教师提交的风格内容（新建与编辑共用） */
function normalizeStyleInput(body) {
  const name = clip(body && body.name, 20);
  if (!name) throw new Error('风格名称不能为空');
  const snippet = String((body && body.snippet) || '').trim().slice(0, 1200);
  if (snippet.length < 10) throw new Error('风格要求太短（至少 10 个字）');
  return {
    name,
    summary: clip(body && body.summary, 60),
    snippet,
    max_chars: clampMaxChars(body && body.max_chars),
    enabled: body && (body.enabled === 0 || body.enabled === false) ? 0 : 1,
    sort_order: Number.isFinite(Number(body && body.sort_order)) ? Math.round(Number(body.sort_order)) : 0,
  };
}

/** 拼系统提示词：结构锚定 → 公共规则 → 风格 → 结构复述 */
function buildSystemPrompt(style) {
  const maxChars = clampMaxChars(style && style.max_chars);
  return [
    BASE_PROMPT,
    HARD_RULES,
    `【讲解风格：${(style && style.name) || '默认'}】\n${String((style && style.snippet) || '').trim()}\n整段讲解的旁白合计不超过 ${maxChars} 字，宁短不长。`,
    STRUCTURE_TAIL,
  ].join('\n\n');
}

/** 提示词版本：随整段提示词内容变化，旧缓存自动失效 */
function promptVersionOf(systemPrompt) {
  return 'v2:' + crypto.createHash('sha1').update(String(systemPrompt)).digest('hex').slice(0, 12);
}

/** 内置风格补种（幂等）：已存在的不覆盖，老师改过的内容不会被启动流程冲掉 */
async function ensureBuiltinStyles(pool) {
  const rows = BUILTIN_STYLES.map((s) => [
    s.style_key, s.name, s.summary, s.snippet, s.max_chars, s.enabled, 1, s.sort_order,
  ]);
  const [result] = await pool.query(
    `INSERT IGNORE INTO explain_styles
       (style_key, name, summary, snippet, max_chars, enabled, builtin, sort_order)
     VALUES ?`,
    [rows],
  );
  return result.affectedRows || 0;
}

/** 列出风格（includeDisabled=false 时只给启用的，供讲解器 chip） */
async function listStyles(pool, includeDisabled = true) {
  const [rows] = await pool.query(
    `SELECT style_key, name, summary, snippet, max_chars, enabled, builtin, sort_order
       FROM explain_styles
      ${includeDisabled ? '' : 'WHERE enabled = 1'}
      ORDER BY sort_order ASC, style_key ASC`,
  );
  return rows.map((r) => ({
    style_key: r.style_key,
    name: r.name,
    summary: r.summary || '',
    snippet: r.snippet,
    max_chars: Number(r.max_chars) || 260,
    enabled: Number(r.enabled) ? 1 : 0,
    builtin: Number(r.builtin) ? 1 : 0,
    sort_order: Number(r.sort_order) || 0,
  }));
}

/** 取单个风格；启用校验交给调用方（学生端必须只允许启用风格） */
async function getStyle(pool, styleKey) {
  const [rows] = await pool.query(
    `SELECT style_key, name, summary, snippet, max_chars, enabled, builtin, sort_order
       FROM explain_styles WHERE style_key = ? LIMIT 1`,
    [styleKey],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    style_key: r.style_key,
    name: r.name,
    summary: r.summary || '',
    snippet: r.snippet,
    max_chars: Number(r.max_chars) || 260,
    enabled: Number(r.enabled) ? 1 : 0,
    builtin: Number(r.builtin) ? 1 : 0,
    sort_order: Number(r.sort_order) || 0,
  };
}

/** 内置默认值（「恢复默认」用） */
function builtinDefaultsOf(styleKey) {
  return BUILTIN_MAP.get(styleKey) || null;
}

module.exports = {
  STYLE_KEY_RE,
  MAX_CHARS_MIN,
  MAX_CHARS_MAX,
  BUILTIN_STYLES,
  clampMaxChars,
  normalizeStyleInput,
  buildSystemPrompt,
  promptVersionOf,
  ensureBuiltinStyles,
  listStyles,
  getStyle,
  builtinDefaultsOf,
};
