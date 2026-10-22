/**
 * 编程填空题 · AI 讲解脚本（提示词 + 规范化 + 兜底）
 *
 * 用途：学生端「python 编程 → 编程填空」点「AI 语音讲解」，逐个空讲填空技巧。
 *
 * ⛔ 正确答案**永远由题库注入**（python_tasks.blank_answers），模型只负责说「为什么」。
 *    实测模型会写 `x%2 == 0` / `x % 2 == 0` 这种细微差异，学生照着填可能就是错的；
 *    而这种题一个字符错就零分。所以脚本结构里根本没有 answer 字段。
 * ⛔ 一行代码里出现多个空时不能只说「这一行」，要按空的实际位置讲，否则学生会串位。
 */

/** 与前端 placeholderRegex 保持一致：①..⑳ 共 20 个占位符 */
const PLACEHOLDER_CHARS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

const PROMPT_VERSION = 'fillblank-v1';

function clip(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * 把模板拆成「每个空」的清单。
 * @returns {{index:number, char:string, answers:string[], line:string}[]}
 */
function analyzeTemplate(template, blankAnswersRaw) {
  const templateStr = String(template || '');
  let answersRaw = blankAnswersRaw;
  if (typeof answersRaw === 'string') {
    try { answersRaw = JSON.parse(answersRaw); } catch { answersRaw = []; }
  }
  const answerGroups = Array.isArray(answersRaw) ? answersRaw : [];
  const lines = templateStr.split('\n');
  const out = [];
  let idx = 0;
  for (let li = 0; li < lines.length; li += 1) {
    for (const ch of lines[li]) {
      const pos = PLACEHOLDER_CHARS.indexOf(ch);
      if (pos < 0) continue;
      idx += 1;
      const group = answerGroups[idx - 1];
      const answers = (Array.isArray(group) ? group : [group])
        .map((x) => String(x == null ? '' : x))
        .filter((x) => x.length > 0);
      out.push({ index: idx, char: ch, answers, line: lines[li] });
    }
  }
  return out;
}

/** 用每组答案的第一个把模板补全 —— 给模型看「完整正确的程序」，它才能讲出上下文依据 */
function assembleCode(template, blanks) {
  let code = String(template || '');
  blanks.forEach((b) => {
    code = code.replace(b.char, b.answers[0] || '');
  });
  return code;
}

function buildPrompt(task, blanks) {
  const systemPrompt = [
    '你是一位江苏省高中信息技术老师，正在给零基础学生讲「Python 编程填空」题。',
    '学生看到的是带 ①②③ 占位符的代码模板，要把每个占位符换成正确的代码。',
    '',
    '你的任务：逐个空讲清「这个空为什么填这个、依据是上下文哪一行、最容易错在哪」。',
    '',
    '硬性要求：',
    '1. 只讲给出的这些空，不要新增空、不要改题、不要重写整段程序。',
    '2. 讲解必须依据给出的「完整正确代码」与上下文；不确定就说得保守些，禁止编造。',
    '3. 口语化短句，每句不超过 40 字；直接念代码本身（如“x 对 2 取余等于 0”），',
    '   不要念符号的中文名（不要说“左括号”“双等号”）。',
    '4. 每个空给两句话：why 说清依据（≤60 字），tip 给易错提醒或记法（≤30 字，没有就留空字串）。',
    '5. 不要在 JSON 里写答案，答案由系统给出；你只解释。',
    '6. 只输出 JSON，不要 Markdown 代码块，不要任何额外说明。',
    '',
    '输出格式：',
    '{"intro":"这题考什么、几个空分别在考什么，≤80字",',
    ' "blanks":[{"index":1,"why":"...","tip":"..."}],',
    ' "summary":"这类题的填空套路，≤70字"}',
  ].join('\n');

  const blankLines = blanks.map((b) => {
    const line = clip(b.line.trim(), 80);
    const alts = b.answers.length > 1 ? `（也可填：${b.answers.slice(1).join(' / ')}）` : '';
    return `第${b.index}空：正确答案 = ${b.answers[0] || '（题库未配置）'}${alts}\n        所在行：${line}`;
  }).join('\n');

  const userPrompt = [
    `【题目】${task.title || ''}`,
    task.description ? `【题目说明】${clip(task.description, 600)}` : '',
    task.hint ? `【老师给的提示】${clip(task.hint, 120)}` : '',
    '',
    '【代码模板（①②③ 是要填的空）】',
    '```python',
    String(task.template || '').slice(0, 1600),
    '```',
    '',
    '【填好之后的完整正确代码】',
    '```python',
    assembleCode(task.template, blanks).slice(0, 1600),
    '```',
    '',
    '【填空清单】',
    blankLines,
    '',
    `请按系统要求输出 JSON，blanks 数组要有 ${blanks.length} 项，index 从 1 开始。`,
  ].filter(Boolean).join('\n');

  return { systemPrompt, userPrompt, promptVersion: PROMPT_VERSION };
}

/**
 * 规范化模型输出：数量对齐、长度裁剪、缺的补兜底。
 * ⛔ 不校验 index 顺序以外的东西：模型爱怎么措辞都行，但必须每空一条。
 */
function normalizeScript(raw, task, blanks) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const byIndex = new Map();
  (Array.isArray(src.blanks) ? src.blanks : []).forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    const idx = Number(b.index);
    const key = Number.isFinite(idx) && idx >= 1 && idx <= blanks.length ? idx : i + 1;
    if (byIndex.has(key)) return;
    byIndex.set(key, {
      why: clip(String(b.why || b.reason || b.explain || '').trim(), 160),
      tip: clip(String(b.tip || b.notice || b.warning || '').trim(), 80),
    });
  });

  const outBlanks = blanks.map((b) => {
    const got = byIndex.get(b.index) || {};
    return {
      index: b.index,
      char: b.char,
      answers: b.answers,
      line: b.line,
      why: got.why || fallbackWhy(b),
      tip: got.tip || '',
    };
  });

  const intro = clip(String(src.intro || '').trim(), 200) || fallbackIntro(task, blanks);
  const summary = clip(String(src.summary || src.recap || '').trim(), 200)
    || '填空先看这一行要干什么，再看前后变量怎么来的；填完在心里把整段代码顺着跑一遍。';

  return { intro, blanks: outBlanks, summary };
}

function fallbackWhy(b) {
  const answer = b.answers[0] || '';
  if (!answer) return '这一空题库还没有配置答案，先跳过，问老师确认。';
  return `这一空要填 ${answer}，填上之后整行变成「${clip(b.line.trim(), 60)}」，程序才能按题意往下走。`;
}

function fallbackIntro(task, blanks) {
  return `${task.title || '这道题'}，一共 ${blanks.length} 个空，我们一个一个看该填什么、为什么这么填。`;
}

/** 模型不可用时的兜底脚本：不缓存，下次还会重试生成 */
function buildFallbackScript(task, blanks) {
  return {
    intro: fallbackIntro(task, blanks),
    blanks: blanks.map((b) => ({ index: b.index, char: b.char, answers: b.answers, line: b.line, why: fallbackWhy(b), tip: '' })),
    summary: '填空的顺序：先看这一行要实现什么，再看变量从哪来、到哪去，最后把整段代码顺一遍。',
  };
}

module.exports = {
  PLACEHOLDER_CHARS,
  PROMPT_VERSION,
  analyzeTemplate,
  assembleCode,
  buildPrompt,
  normalizeScript,
  buildFallbackScript,
};
