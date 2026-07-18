import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface Match {
  start: number;
  end: number;
  latex: string;
  block: boolean;
}

function renderLatexNodes(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  const matches: Match[] = [];

  // 先匹配块级 $$...$$
  const blockRe = /\$\$([\s\S]*?)\$\$/g;
  let bm;
  while ((bm = blockRe.exec(text)) !== null) {
    matches.push({ start: bm.index, end: bm.index + bm[0].length, latex: bm[1].trim(), block: true });
  }

  // 再匹配行内 $...$，跳过已匹配的区域
  const inlineRe = /\$([^\$]+?)\$/g;
  let im;
  while ((im = inlineRe.exec(text)) !== null) {
    const inBlock = matches.some(m => im!.index >= m.start && im!.index < m.end);
    if (!inBlock) {
      matches.push({ start: im.index, end: im.index + im[0].length, latex: im[1].trim(), block: false });
    }
  }

  // 按位置排序
  matches.sort((a, b) => a.start - b.start);

  for (const m of matches) {
    if (m.start > lastIndex) {
      result.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, m.start)}</span>);
    }
    try {
      const html = katex.renderToString(m.latex, {
        displayMode: m.block,
        throwOnError: false,
      });
      result.push(
        <span key={`k-${m.start}`} dangerouslySetInnerHTML={{ __html: html }} />
      );
    } catch {
      result.push(<span key={`kerr-${m.start}`}>{text.slice(m.start, m.end)}</span>);
    }
    lastIndex = m.end;
  }

  if (lastIndex < text.length) {
    result.push(<span key={`t-end`}>{text.slice(lastIndex)}</span>);
  }

  return result;
}

interface LatexRendererProps {
  content: string;
  className?: string;
}

export const LatexRenderer: React.FC<LatexRendererProps> = ({ content, className }) => {
  return <div className={`whitespace-pre-wrap ${className || ''}`}>{renderLatexNodes(content)}</div>;
};
