import React, { useState } from 'react';
import {
  CHAPTER_NAMES,
  CHAPTER_CODES,
  CHAPTER_TAXONOMY,
  sectionCode,
} from '../../data/chapterTaxonomy';

/**
 * 「已掌握题数」资格的范围选择器（考试管理 · 普通测试 / 试卷 PK 共用）。
 *
 * 视觉与交互对两端保持一致：
 *  - 章 = 蓝色胶囊，前面带教材编号（1.2 数据编码）
 *  - 点章左侧 ▸ 展开小节 = 绿色小胶囊，带小节编号（1.2.2 文本数据的编码）
 *  - 选章 = 整章（含全部小节）；选小节 = 只统计该小节
 *  - 互斥：勾整章时清掉该章已选小节；已勾整章时点某小节，自动「收窄」为该小节
 *
 * 编号规则与学习模块同源（backend/src/chapter-taxonomy.js 的 SECTION_CODES）：
 * 小节编号 = 章 code + "." + 该小节在词表里的书写序号。
 */

export interface ScopeCounts {
  total: number;
  by_primary: Record<string, number>;
  by_cluster?: Record<string, number>;
}

const ALL_CHAPTERS = CHAPTER_TAXONOMY.flatMap((p) => p.chapters);
const chapterSections = (ch: string): string[] =>
  ALL_CHAPTERS.find((c) => c.name === ch)?.sections || [];

/**
 * 选中范围内的可练习题量（用于上限提示）。
 * 章名走 by_primary（含该章全部小节），「章/小节」走 by_cluster（只算该小节）。
 */
export function countInScope(counts: ScopeCounts, selection: string[]): number {
  if (!selection.length) return counts.total;
  return selection.reduce((sum, n) => {
    const v = n.includes('/')
      ? (counts.by_cluster?.[n] || 0)
      : (counts.by_primary[n] || 0);
    return sum + v;
  }, 0);
}

interface Props {
  /** 当前选中项：章名 或「章名/小节名」；空数组 = 全部范围 */
  value: string[];
  onChange: (next: string[]) => void;
  counts: ScopeCounts;
  /** 展开区最大高度（默认 220px，两端一致） */
  maxHeightClass?: string;
}

export const MasteredScopePicker: React.FC<Props> = ({
  value,
  onChange,
  counts,
  maxHeightClass = 'max-h-[220px]',
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (ch: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  /** 选/取消整章：选中时清掉该章下已选小节，避免重复计数 */
  const toggleChapter = (ch: string) => {
    const on = value.includes(ch);
    onChange(
      on
        ? value.filter((n) => n !== ch)
        : [...value.filter((n) => n !== ch && !n.startsWith(`${ch}/`)), ch]
    );
  };

  /** 选/取消小节：先从整章收窄到该小节（子集优先），否则整章会盖住它 */
  const toggleSection = (ch: string, sec: string) => {
    const path = `${ch}/${sec}`;
    const on = value.includes(path);
    const base = value.filter((n) => n !== ch);
    onChange(on ? base.filter((n) => n !== path) : [...base, path]);
  };

  const pickedTotal = countInScope(counts, value);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-gray-600">
          统计范围（不选 = 全部范围，共 {counts.total} 道可练习题）
        </p>
        {value.length > 0 && (
          <span className="shrink-0 text-xs text-blue-600">
            已选 {value.length} 项 · {pickedTotal} 题
          </span>
        )}
      </div>

      <div className={`${maxHeightClass} overflow-y-auto rounded-lg border border-gray-200 bg-white p-2`}>
        {CHAPTER_NAMES.map((name) => {
          const sections = chapterSections(name);
          const chapterOn = value.includes(name);
          const isOpen = expanded.has(name);
          const pickedSections = sections.filter((s) => value.includes(`${name}/${s}`)).length;
          const cnt = counts.by_primary[name] || 0;
          const chCode = CHAPTER_CODES[name] || '';
          return (
            <div key={name} className="border-b border-gray-100 py-0.5 last:border-0">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleExpand(name)}
                  className="h-5 w-5 shrink-0 text-gray-400 hover:text-gray-700"
                  title={isOpen ? '收起小节' : '展开小节（二级类目）'}
                >
                  <i className={`fa-solid fa-chevron-${isOpen ? 'down' : 'right'} text-[10px]`}></i>
                </button>
                <button
                  type="button"
                  onClick={() => toggleChapter(name)}
                  title={`${chCode} ${name}（整章，含全部小节）：${cnt} 道可练习题`}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    chapterOn
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400'
                  }`}
                >
                  {chCode && (
                    <span
                      className={`mr-1 font-mono text-[10px] tabular-nums ${
                        chapterOn ? 'text-white/75' : 'text-gray-400'
                      }`}
                    >
                      {chCode}
                    </span>
                  )}
                  {name}
                  <span className={`ml-1 ${chapterOn ? 'text-white/80' : 'text-gray-400'}`}>{cnt}</span>
                </button>
                {pickedSections > 0 && (
                  <span className="shrink-0 text-[11px] text-emerald-600">
                    已选 {pickedSections} 个小节
                  </span>
                )}
              </div>

              {isOpen && (
                <div className="my-1 ml-6 flex flex-wrap gap-1.5">
                  {sections.length === 0 ? (
                    <span className="text-[11px] text-gray-400">该章无二级类目</span>
                  ) : (
                    sections.map((sec) => {
                      const path = `${name}/${sec}`;
                      const on = value.includes(path);
                      const c = counts.by_cluster?.[path] || 0;
                      const sCode = sectionCode(name, sec);
                      return (
                        <button
                          key={path}
                          type="button"
                          onClick={() => toggleSection(name, sec)}
                          title={`${sCode} ${path}：${c} 道可练习题`}
                          className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                            on
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-gray-300 bg-white text-gray-600 hover:border-emerald-400'
                          }`}
                        >
                          {sCode && (
                            <span
                              className={`mr-1 font-mono text-[10px] tabular-nums ${
                                on ? 'text-white/75' : 'text-gray-400'
                              }`}
                            >
                              {sCode}
                            </span>
                          )}
                          {sec}
                          <span className={`ml-1 ${on ? 'text-white/80' : 'text-gray-400'}`}>{c}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          选章 = 整章（含全部小节）；点 <b>▸</b> 展开可选单个<b>小节（二级类目）</b>，此时只统计该小节下的题
        </p>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="ml-2 shrink-0 text-xs text-blue-600 hover:underline"
          >
            清空（改回全部范围）
          </button>
        )}
      </div>
    </div>
  );
};
