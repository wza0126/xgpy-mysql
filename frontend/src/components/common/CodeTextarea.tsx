import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { highlightPython, COMPLETION_WORDS } from '../../utils/pythonHighlight';

/**
 * 学生端 Python 代码输入框（2026-11-12）：语法高亮 + 关键字自动补全。
 *
 * 实现方式：「高亮层 + 透明输入层」叠加
 *   - 底层 <pre> 显示彩色代码（不可点，pointer-events:none）
 *   - 上层 <textarea> 文字设为透明、只保留光标和选区，负责真正的输入
 *   两层字体/字号/行高/padding/换行规则必须完全一致，否则会错位。
 *   这是 CodeMirror 之前最经典的做法，零依赖、零体积增长。
 *
 * 为什么不引 CodeMirror/Monaco：内网离线打包，exe 已经 66MB，
 * 课堂只需要「关键字变色 + 输入提示」，不值得为它背上一个大依赖。
 *
 * 交互：
 *   - 输入字母/下划线 ≥1 个字符就弹候选（最多 8 条，前缀优先，按长度排序）
 *   - ↑↓ 切换、Tab 补全、Esc 关闭、点候选也能补全
 *   - Enter **不拦截**（学生打完常要换行，抢 Enter 会让人以为"换行坏了"）
 *   - Tab 无候选时插入 4 空格（Python 缩进；原来 Tab 会让焦点跑掉）
 *   - 中文输入法合成期间不弹、不抢键
 */

const MAX_SUGGESTIONS = 8;
const INDENT = '    ';

interface Sug {
  start: number;
  end: number;
  word: string;
  items: string[];
  active: number;
  left: number;
  top: number;
}

export interface CodeTextareaProps {
  value: string;
  onChange: (v: string) => void;
  /** 外层尺寸控制（如 flex-1） */
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  /** 禁止粘贴（学生端防抄作业） */
  blockPaste?: boolean;
}

/** 光标相对 textarea 内容区的坐标（镜像元素法） */
function caretCoords(ta: HTMLTextAreaElement): { left: number; top: number; lineHeight: number } {
  const cs = window.getComputedStyle(ta);
  const div = document.createElement('div');
  const props = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textTransform', 'tabSize',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing',
  ];
  props.forEach((k) => { div.style[k as any] = cs.getPropertyValue(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())) || (cs as any)[k]; });
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.overflowWrap = 'break-word';
  div.style.width = ta.clientWidth + 'px';

  div.textContent = ta.value.slice(0, ta.selectionStart);
  const span = document.createElement('span');
  span.textContent = '\u200b';
  div.appendChild(span);
  document.body.appendChild(div);
  const left = span.offsetLeft;
  const top = span.offsetTop;
  document.body.removeChild(div);

  return { left, top, lineHeight: parseFloat(cs.lineHeight) || 24 };
}

export const CodeTextarea: React.FC<CodeTextareaProps> = ({
  value,
  onChange,
  className = '',
  placeholder,
  disabled,
  blockPaste = false,
}) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [sug, setSug] = useState<Sug | null>(null);
  const composingRef = useRef(false);
  const pendingCaretRef = useRef<number | null>(null);

  const html = useMemo(() => highlightPython(value), [value]);

  // 补全后把光标放回插入位置
  useEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos === null) return;
    pendingCaretRef.current = null;
    const ta = taRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }, [value]);

  /** 高亮层跟随滚动，保证两层永远对齐 */
  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }, []);

  const reposition = useCallback((s: Sug | null) => {
    if (!s) return;
    const ta = taRef.current;
    if (!ta) { setSug(null); return; }
    const rect = ta.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { setSug(null); return; }
    const c = caretCoords(ta);
    setSug({
      ...s,
      left: rect.left + c.left - ta.scrollLeft,
      top: rect.top + c.top - ta.scrollTop + c.lineHeight,
    });
  }, []);

  const refresh = useCallback(() => {
    const ta = taRef.current;
    if (!ta || disabled || composingRef.current) { setSug(null); return; }
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) { setSug(null); return; }
    const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(ta.value.slice(0, pos));
    if (!m) { setSug(null); return; }
    const word = m[1];
    const lower = word.toLowerCase();
    const items = COMPLETION_WORDS
      .filter((w) => w.toLowerCase().startsWith(lower) && w !== word)
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
      .slice(0, MAX_SUGGESTIONS);
    if (!items.length) { setSug(null); return; }
    reposition({ start: pos - word.length, end: pos, word, items, active: 0, left: 0, top: 0 });
  }, [disabled, reposition]);

  const apply = useCallback((word: string) => {
    if (!sug) return;
    const next = value.slice(0, sug.start) + word + value.slice(sug.end);
    pendingCaretRef.current = sug.start + word.length;
    setSug(null);
    onChange(next);
  }, [onChange, sug, value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    requestAnimationFrame(() => { refresh(); syncScroll(); });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return;

    if (sug) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSug({ ...sug, active: (sug.active + 1) % sug.items.length });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSug({ ...sug, active: (sug.active - 1 + sug.items.length) % sug.items.length });
        return;
      }
      // ⛔ 只认 Tab：Enter 留给换行（学生打完字常要换行，抢 Enter 会以为换行坏了）
      if (e.key === 'Tab') {
        e.preventDefault();
        apply(sug.items[sug.active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSug(null);
        return;
      }
    }

    // 无候选的 Tab：插入 4 空格（原来 Tab 会让焦点跳走，写 Python 缩进很痛苦）
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      pendingCaretRef.current = start + INDENT.length;
      onChange(value.slice(0, start) + INDENT + value.slice(end));
    }
  };

  // 浮层跟随滚动
  useEffect(() => {
    if (!sug) return;
    const onScroll = () => reposition(sug);
    window.addEventListener('resize', onScroll);
    return () => window.removeEventListener('resize', onScroll);
  }, [sug, reposition]);

  return (
    <div className={`relative overflow-hidden bg-slate-900 ${className}`}>
      {/* 高亮层：不吃鼠标事件，纯展示 */}
      <pre
        ref={preRef}
        aria-hidden="true"
        className="py-code-layer pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words px-4 py-3 font-mono text-sm leading-6 text-slate-100"
      >
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>

      {/* 输入层：文字透明，只留光标与选区 */}
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onBlur={() => setSug(null)}
        onPaste={blockPaste ? (e) => e.preventDefault() : undefined}
        onCompositionStart={() => { composingRef.current = true; setSug(null); }}
        onCompositionEnd={() => { composingRef.current = false; requestAnimationFrame(refresh); }}
        className="py-code-input absolute inset-0 h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 py-3 font-mono text-sm leading-6 text-transparent outline-none"
        spellCheck={false}
        placeholder={placeholder}
        disabled={disabled}
      />

      {sug && (
        <ul
          className="fixed z-[9999] min-w-[150px] rounded-md border border-slate-600 bg-slate-800 py-1 font-mono text-xs shadow-2xl"
          style={{ left: sug.left, top: sug.top }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {sug.items.map((w, i) => (
            <li
              key={w}
              onMouseEnter={() => setSug({ ...sug, active: i })}
              onClick={() => apply(w)}
              className={`cursor-pointer px-2 py-1 ${i === sug.active ? 'bg-sky-600 text-white' : 'text-slate-200'}`}
            >
              <span className="font-semibold">{w.slice(0, sug.word.length)}</span>
              <span className={i === sug.active ? 'text-sky-100' : 'text-slate-400'}>
                {w.slice(sug.word.length)}
              </span>
            </li>
          ))}
          <li className="mt-1 border-t border-slate-600 px-2 pt-1 text-[10px] text-slate-400">
            ↑↓ 选择 · Tab 补全 · Esc 关闭
          </li>
        </ul>
      )}
    </div>
  );
};

export default CodeTextarea;
