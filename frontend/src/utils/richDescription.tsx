import React from 'react';

/**
 * 富文本题目要求渲染（2026-11-17）
 * ============================================================
 * 编程填空题的「题目要求」存在 python_tasks.description，格式是**纯文本 + markdown 图片**，
 * 图片还是 base64 内嵌的（`![程序运行结果](data:image/png;base64,...)`）。
 *
 * 直接用 dangerouslySetInnerHTML 会：
 *   ① 把 markdown 语法原样印出来（学生看到一堆 `![...](data:...)`）
 *   ② 把老师上传的任意 HTML 注入进来（XSS）
 * 所以这里手动切分「文本 / 图片」两种片段，图片只认 data:image 与 http(s)，
 * 文本走 React 文本节点（自动转义）。
 */

export type RichSeg = { type: 'text'; value: string } | { type: 'img'; src: string; alt: string };

/** 只放行 data:image / http(s) / 站内绝对路径，其余（javascript:、blob: 等）一律丢掉 */
function safeImageSrc(src: string): string | null {
  const s = String(src || '').trim();
  if (!s) return null;
  if (/^data:image\//i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/[^/\s]/.test(s)) return s;
  return null;
}

export function splitRichText(text: string): RichSeg[] {
  const raw = String(text || '');
  if (!raw) return [];
  const segs: RichSeg[] = [];
  // ⛔ base64 字符集不含 ')'，所以 [^)]+ 足够；alt 里也不会有 ']'
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) segs.push({ type: 'text', value: raw.slice(last, m.index) });
    const src = safeImageSrc(m[2]);
    if (src) segs.push({ type: 'img', src, alt: m[1] || '' });
    else segs.push({ type: 'text', value: m[0] }); // 不安全就按原文显示，别悄悄吞掉
    last = m.index + m[0].length;
  }
  if (last < raw.length) segs.push({ type: 'text', value: raw.slice(last) });
  return segs;
}

/** 去掉图片，只留文字（列表摘要、AI 提示用） */
export function richTextToPlain(text: string, imgPlaceholder = ''): string {
  return splitRichText(text)
    .map((s) => (s.type === 'img' ? imgPlaceholder : s.value))
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export const RichDescription: React.FC<{
  text?: string | null;
  className?: string;
  imgClassName?: string;
}> = ({ text, className = '', imgClassName = '' }) => {
  const segs = splitRichText(text || '');
  if (!segs.length) return null;
  return (
    <div className={`whitespace-pre-wrap leading-relaxed ${className}`}>
      {segs.map((s, i) => (
        s.type === 'img' ? (
          <img
            key={i}
            src={s.src}
            alt={s.alt || '题目图片'}
            className={`my-2 block max-w-full rounded border border-gray-200 ${imgClassName}`}
            // 图片坏了至少给个提示，别留一块空白
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = 'none';
              const tip = document.createElement('div');
              tip.className = 'my-1 text-xs text-amber-600';
              tip.textContent = `（图片加载失败${s.alt ? `：${s.alt}` : ''}）`;
              el.parentNode?.insertBefore(tip, el);
            }}
          />
        ) : (
          <span key={i}>{s.value}</span>
        )
      ))}
    </div>
  );
};
