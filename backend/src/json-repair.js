/**
 * 模型输出 JSON 的容错解析。
 *
 * 背景：让大模型直接吐 JSON 时，偶发会写出不合法的内容（字符串里带裸引号、
 * 数组元素漏逗号、写到一半被 max_tokens 截断），JSON.parse 一抛错整节微课程就失败了。
 * 这里做三件事：
 *   1. 剥掉 ```json 包裹；
 *   2. 修常见毛病（尾逗号、字符串内的裸换行、括号没闭合）后再解析；
 *   3. 实在不行就「抢救」：扫描出所有完整的 {...} 对象逐个解析，
 *      能拿到几页就用几页（配合上层的 normalize，缺页会自动补占位页）。
 */

function stripFences(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : raw;
}

/** 去掉对象/数组末尾多余的逗号：{"a":1,} / [1,2,] */
function dropTrailingCommas(s) {
  return s.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * 转义字符串内部的裸控制字符（换行、制表），以及把中文引号还原成转义双引号。
 * 只处理「处于字符串内部」的字符，不会碰结构里的逗号冒号。
 */
function escapeInsideStrings(s) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

/** 括号没闭合时补齐（按栈顺序反向闭合），用于「写到一半被截断」 */
function closeBrackets(s) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) s += '"';                 // 字符串没闭合，先补引号
  let tail = '';
  while (stack.length) {
    const open = stack.pop();
    tail += open === '{' ? '}' : ']';
  }
  return s + tail;
}

/**
 * 修复字符串里未转义的引号。
 *
 * 模型常把中文里的引号写成裸双引号，例如 "narration":"他说"你好"" ，
 * 严格解析必挂。做法是「向前看」：出现在字符串内部的双引号，
 * 只有当它后面紧跟的是 , : } ] 这类结构符号时才算闭合，否则视为正文内容并转义。
 * 对中文讲解词命中率很高；万一判断错了，外层还有抢救模式兜底。
 */
function escapeStrayQuotes(s) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch !== '"') { out += ch; continue; }

    if (!inString) { inString = true; out += ch; continue; }

    // 已经在字符串里遇到双引号：看后面第一个非空字符
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j])) j += 1;
    const next = s[j];
    const looksLikeClose = next === undefined || ',:}]'.includes(next);
    if (looksLikeClose) {
      inString = false;
      out += ch;
    } else {
      out += '\\"';
    }
  }
  return out;
}

/**
 * 补上漏掉的逗号。
 *
 * 模型偶尔写出 {"pages":[{...}{...}]}（两个元素之间没逗号），
 * 报错正是「Expected ',' or ']' after array element」。
 * 做法：一个值结束后（字符串闭合 / 对象或数组闭合），若后面紧跟的又是值的开头
 * （{ [ " 数字 true false null），就在中间补一个逗号。键后面的冒号不受影响。
 */
function insertMissingCommas(s) {
  const startsValue = (ch) => ch === '{' || ch === '[' || ch === '"' || /[0-9\-tfn]/.test(ch || '');
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      if (!inString) {
        // 字符串刚闭合：看后面是不是又直接开始了新值
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j += 1;
        if (startsValue(s[j]) && s[j] !== undefined) out += ',';
      }
      continue;
    }
    if (!inString && (ch === '}' || ch === ']')) {
      out += ch;
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j += 1;
      if (startsValue(s[j]) && s[j] !== undefined) out += ',';
      continue;
    }
    out += ch;
  }
  return out;
}

/** 从文本里抠出最外层 JSON（对象或数组），做多轮修复后解析 */
function extractJsonObject(text) {
  const body = stripFences(text);
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('模型未返回 JSON');

  const endBrace = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  const sliced = body.slice(start, endBrace > start ? endBrace + 1 : body.length);

  // 依次尝试：原文 → 去尾逗号/控制符/补逗号/补括号 → 再修裸引号
  const candidates = [sliced];
  const basic = closeBrackets(insertMissingCommas(escapeInsideStrings(dropTrailingCommas(sliced))));
  if (basic !== sliced) candidates.push(basic);
  const quoted = closeBrackets(
    escapeStrayQuotes(insertMissingCommas(escapeInsideStrings(dropTrailingCommas(sliced)))),
  );
  if (!candidates.includes(quoted)) candidates.push(quoted);

  let lastErr = null;
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('模型返回的 JSON 无法解析');
}

/**
 * 抢救模式：扫描文本里所有完整的 {...} 对象，逐个解析，返回能解析成功的那些。
 * 用于「数组写到一半被截断」——前面完整的页面依然可用，不让整次生成白费。
 */
function salvageJsonObjects(text) {
  const body = stripFences(text);
  const results = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let startIdx = -1;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) startIdx = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && startIdx >= 0) {
        const piece = body.slice(startIdx, i + 1);
        try {
          results.push(JSON.parse(escapeInsideStrings(dropTrailingCommas(piece))));
        } catch { /* 这个对象坏了就丢掉 */ }
        startIdx = -1;
      }
    }
  }
  return results;
}

module.exports = { extractJsonObject, salvageJsonObjects, closeBrackets, escapeInsideStrings, dropTrailingCommas };
