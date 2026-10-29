import React, { useMemo, useState } from 'react';

/**
 * 学生 × 题目 明细矩阵（2026-10-27）
 *
 * 综合题与 Python 作业共用同一套表格：行 = 班级学生，列 = 题目，
 * 格子 = 这个学生这道题的分数 / 状态。两个模块的数据形状不同，
 * 但都能无损映射成下面的 MatrixRow / MatrixColumn，所以表格只写一份。
 *
 * 排序（2026-10-27 吴老要求）：
 *   · 学号 / 姓名 / 已完成 / 得分 / 每题列，点表头即排，再点一下反向
 *   · 已完成与得分贴近姓名（2026-10-29 要求）：题目列动辄近百列，
 *     这两项原来在最右侧，要一路横向滚到底才看得到
 *   · 题目列按「没做排最前」处理（value=null 视作 -1）——
 *     老师点一下某题列头，第一眼看到的就是谁还没交
 *   · 同值一律再按学号兜底，翻页/刷新时行不会来回跳
 */

export interface MatrixColumn {
  id: string;
  /** 表头第一行，如「第3题」 */
  label: string;
  /** 表头第二行，留空则自动显示该列已做学生的平均分 */
  hint?: string;
  /** 该列满分，用于「满分」高亮与汇总 */
  full: number;
  /** 该题对这个班是否开放；false 时表头灰显（数据仍然显示，方便老师判断要不要开） */
  enabled?: boolean;
  /** 悬停说明（完整标题、知识点等） */
  title?: string;
}

export interface MatrixCell {
  /** 数值，用于排序；null = 未做 */
  value: number | null;
  /** 显示文本，默认 `value/full` */
  text?: string;
  title?: string;
  /** full = 满分绿底；warn = 已交未批改（琥珀）；normal = 普通 */
  kind?: 'full' | 'normal' | 'warn';
}

export interface MatrixRow {
  id: string;
  username: string;
  real_name: string;
  cells: Record<string, MatrixCell>;
  /** 已完成（做过 / 已交）的题目数 */
  done: number;
  /**
   * 「已完成 x/N」的分母。默认是列数，但关闭的题学生做不到，
   * 算进去会让完成率永远上不去，所以由调用方传入「可见题数」。
   */
  doneTotal?: number;
  /** 已得分数合计 */
  earned: number;
  /** 满分合计（未开放题目是否计入由调用方决定） */
  full: number;
}

interface Props {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  loading?: boolean;
  emptyText?: string;
  /** 左侧两列的表头文字 */
  idLabel?: string;
  nameLabel?: string;
  /** 右侧两个汇总列表头文字 */
  doneLabel?: string;
  earnedLabel?: string;
  /** 底部最左列的说明文字 */
  footerLabel?: string;
  className?: string;
}

type SortDir = 'asc' | 'desc';

export const TaskMatrix: React.FC<Props> = ({
  columns,
  rows,
  loading = false,
  emptyText = '这个班还没有学生',
  idLabel = '学号',
  nameLabel = '姓名',
  doneLabel = '已完成',
  earnedLabel = '得分',
  footerLabel,
  className = '',
}) => {
  // 默认按学号升序：进页面先看到名册，符合点名习惯
  const [sortKey, setSortKey] = useState<string>('username');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // 题目列第一次点用升序（未做在前）；学号姓名也用升序最自然
      setSortDir('asc');
    }
  };

  /** 取某行在某个排序键上的值；未做的题目统一当 -1，升序时排最上面 */
  const valueOf = (r: MatrixRow, key: string): string | number => {
    if (key === 'username') return r.username || '';
    if (key === 'real_name') return r.real_name || '';
    if (key === 'done') return r.done;
    if (key === 'earned') return r.earned;
    const c = r.cells[key];
    return c && c.value != null ? c.value : -1;
  };

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = valueOf(a, sortKey);
      const vb = valueOf(b, sortKey);
      let cmp = 0;
      if (typeof va === 'string' || typeof vb === 'string') {
        cmp = String(va).localeCompare(String(vb), 'zh-CN');
      } else {
        cmp = Number(va) - Number(vb);
      }
      // 同值按学号兜底：否则同分的行每次渲染顺序都可能不同
      if (cmp === 0) cmp = (a.username || '').localeCompare(b.username || '', 'zh-CN');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  /** 每列的平均分（只统计做过的学生），显示在表头第二行 */
  const colAvg = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of columns) {
      let sum = 0;
      let n = 0;
      for (const r of rows) {
        const c = r.cells[q.id];
        if (c && c.value != null) { sum += c.value; n += 1; }
      }
      m[q.id] = n ? Math.round((sum / n) * 10) / 10 : 0;
    }
    return m;
  }, [columns, rows]);

  /** 每列做过的人数，显示在表尾 */
  const colDone = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of columns) {
      let n = 0;
      for (const r of rows) {
        const c = r.cells[q.id];
        if (c && c.value != null) n += 1;
      }
      m[q.id] = n;
    }
    return m;
  }, [columns, rows]);

  const sortIcon = (key: string) =>
    sortKey !== key ? 'fa-sort text-gray-300' : sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down';

  /** 表头按钮：整格可点，点击即按此列排序 */
  const Th: React.FC<{ k: string; children: React.ReactNode; className?: string; title?: string }> = ({
    k, children, className = '', title,
  }) => (
    <th className={`whitespace-nowrap px-1 py-2 text-center font-medium ${className}`} title={title}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex w-full flex-col items-center gap-0.5 rounded px-1 py-0.5 hover:bg-gray-100 ${
          sortKey === k ? 'text-purple-700' : ''
        }`}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <i className={`fa-solid ${sortIcon(k)} text-[10px]`}></i>
        </span>
      </button>
    </th>
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400">
        <i className="fa-solid fa-spinner fa-spin mr-2"></i>加载中…
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-sm text-gray-400">
        {emptyText}
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white ${className}`}>
      <div className="max-h-[62vh] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-gray-50 text-xs text-gray-600 shadow-sm">
              <Th k="username" className="sticky left-0 z-30 bg-gray-50 text-left">{idLabel}</Th>
              <Th k="real_name" className="sticky left-[82px] z-30 bg-gray-50 text-left">{nameLabel}</Th>
              {/* 汇总两列放在姓名右侧：题目列很多，原来看「已交/得分」要一路滚到最右（2026-10-29 吴老要求） */}
              <Th k="done">{doneLabel}</Th>
              <Th k="earned">{earnedLabel}</Th>
              {columns.map((q) => (
                <Th
                  key={q.id}
                  k={q.id}
                  className={q.enabled === false ? 'text-gray-300' : ''}
                  title={q.title || q.label}
                >
                  <span>{q.label}</span>
                  <span className="text-[10px] font-normal text-gray-400">
                    {q.hint !== undefined ? q.hint : (colAvg[q.id] > 0 ? `均 ${colAvg[q.id]}` : '—')}
                  </span>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-purple-50/40">
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-xs text-gray-600">{r.username}</td>
                <td className="sticky left-[82px] z-10 bg-white px-3 py-1.5 text-gray-800">{r.real_name || '—'}</td>
                <td className="px-3 py-1.5 text-center text-xs text-gray-600">
                  {r.done}/{r.doneTotal ?? columns.length}
                </td>
                <td className="px-3 py-1.5 text-center text-xs">
                  <span className={r.earned > 0 ? 'font-medium text-purple-700' : 'text-gray-300'}>
                    {r.earned}/{r.full}
                  </span>
                </td>
                {columns.map((q) => {
                  const c = r.cells[q.id];
                  if (!c || c.value == null) {
                    return (
                      <td key={q.id} className="px-1 py-1.5 text-center text-xs text-gray-300">
                        {c && c.text ? (
                          <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-amber-700" title={c.title}>
                            {c.text}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  }
                  const style =
                    c.kind === 'full'
                      ? 'bg-emerald-50 font-medium text-emerald-700'
                      : 'text-gray-700';
                  return (
                    <td key={q.id} className="px-1 py-1.5 text-center">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs tabular-nums ${style}`}
                        title={c.title}
                      >
                        {c.text || `${c.value}/${q.full}`}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0">
            <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs text-gray-500">
              <td className="sticky left-0 z-30 bg-gray-50 px-3 py-2" colSpan={2}>
                {footerLabel || `全班 ${rows.length} 人`}
              </td>
              <td className="px-3 py-2 text-center">
                {rows.reduce((n, r) => n + r.done, 0)} 题次
              </td>
              <td className="px-3 py-2" />
              {columns.map((q) => (
                <td key={q.id} className="px-1 py-2 text-center">
                  {colDone[q.id] > 0 ? `${colDone[q.id]}人` : '—'}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
