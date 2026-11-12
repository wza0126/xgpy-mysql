/**
 * Python 语法高亮（学生端代码编辑器用）。
 *
 * 为什么要自己做：本项目内网离线打包，引 CodeMirror/Monaco 会明显增大 exe 体积，
 * 而课堂只需要「关键字变色 + 输入提示」两件事。
 *
 * 实现要点：
 *   - 单遍扫描，**先识别字符串和注释**，再识别标识符/数字，
 *     这样字符串里的 "if" 不会被染色（用正则替换一定会踩这个坑）。
 *   - 输出前统一 HTML 转义，注入不可能发生。
 *   - 配色对齐 VSCode Dark+，学生以后换到真正的编辑器不会有陌生感。
 */

const KEYWORDS = new Set([
  'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or',
  'break', 'continue', 'pass', 'def', 'return', 'import', 'from', 'as',
  'class', 'try', 'except', 'finally', 'with', 'lambda', 'global',
  'nonlocal', 'del', 'is', 'yield', 'assert', 'raise',
  'True', 'False', 'None',
]);

const BUILTINS = new Set([
  'print', 'input', 'int', 'str', 'float', 'bool', 'len', 'range',
  'list', 'dict', 'set', 'tuple', 'sum', 'max', 'min', 'abs', 'round',
  'sorted', 'reversed', 'enumerate', 'zip', 'type', 'open', 'map', 'filter',
  'append', 'split', 'join', 'format', 'strip', 'upper', 'lower', 'replace',
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 标识符字符：字母 / 数字 / 下划线（含中文，学生偶尔会写中文变量） */
function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_\u4e00-\u9fa5]/.test(ch);
}

/**
 * 把 Python 源码转成带 <span> 的 HTML。
 * ⛔ 返回值要直接 dangerouslySetInnerHTML，所以每一段都必须先转义。
 */
export function highlightPython(code: string): string {
  const n = code.length;
  let i = 0;
  let out = '';

  while (i < n) {
    const ch = code[i];

    // ① 注释：# 到行末
    if (ch === '#') {
      let j = code.indexOf('\n', i);
      if (j < 0) j = n;
      out += `<span class="py-comment">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // ② 字符串：三引号优先，其次单/双引号（单引号不跨行）
    if (ch === '"' || ch === "'") {
      const triple = code.startsWith(ch + ch + ch, i);
      const quote = triple ? ch + ch + ch : ch;
      let j = i + quote.length;
      let closed = false;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code.startsWith(quote, j)) { j += quote.length; closed = true; break; }
        if (!triple && code[j] === '\n') break; // 未闭合的单行字符串，到行末为止
        j += 1;
      }
      out += `<span class="py-string">${escapeHtml(code.slice(i, Math.min(j, n)))}</span>`;
      i = Math.min(j, n);
      if (!closed && !triple && i < n) {
        // 保持换行原样输出，避免把代码结构吃掉
      }
      continue;
    }

    // ③ 数字
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9._eExXa-fA-F]/.test(code[j])) j += 1;
      out += `<span class="py-number">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // ④ 标识符 → 关键字 / 内置函数 / 普通名字
    if (/[A-Za-z_\u4e00-\u9fa5]/.test(ch)) {
      let j = i;
      while (j < n && isIdentChar(code[j])) j += 1;
      const w = code.slice(i, j);
      if (KEYWORDS.has(w)) out += `<span class="py-kw">${escapeHtml(w)}</span>`;
      else if (BUILTINS.has(w)) out += `<span class="py-builtin">${escapeHtml(w)}</span>`;
      else if (w === 'self') out += `<span class="py-self">${escapeHtml(w)}</span>`;
      else out += escapeHtml(w);
      i = j;
      continue;
    }

    // ⑤ 其它字符原样输出
    out += escapeHtml(ch);
    i += 1;
  }

  // <pre> 末尾的换行不会被渲染，补一个占位，保证最后一行空行也能显示
  if (code.endsWith('\n')) out += ' ';
  return out;
}

/** 补全候选词表（与高亮共用一份，避免两边不一致） */
export const COMPLETION_WORDS: string[] = Array.from(
  new Set([...KEYWORDS, ...BUILTINS]),
);
