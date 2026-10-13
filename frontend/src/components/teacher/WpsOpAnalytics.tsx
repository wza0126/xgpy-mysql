import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { studentLabel } from '../../utils/studentLabel';

/**
 * 教师端 · 操作题「练习情况」（WPS / Access 共用）
 * ============================================================
 * 口径（与学生端「我的最好成绩」完全一致）：
 *     score(学生, 题) = MAX(wps_op_submissions.score_obtained)
 *     学生总分 = Σ 各题最高分（没做过的题不计入，只影响「已做」列）
 * 也就是同一题反复提交只认最好的一次，避免学生被自己的低分拖累。
 *
 * ⛔ 题目标题取「主模板文件名」（如「人口密度数据分析表」），
 *    不用题干正文 —— 题干是一整段操作说明，当列头又长又乱且几道题互相难辨。
 *
 * ⚠️ WPS 与 Access 共用同一张提交表 wps_op_submissions，用 kind 区分
 *    （'wps' / 'access'），所以本组件只需换一个 base 路径即可复用。
 */

interface QMeta {
  id: string;
  title: string;
  /** 主模板文件名（含扩展名），无模板的老题为空串 */
  template_name: string;
  cluster_id: string;
  full_score: number;
  step_count: number;
  practice_enabled: number;
}

interface CellScore {
  best: number;
  full: number;
  tries: number;
}

interface StudentRow {
  id: string;
  username: string;
  real_name: string;
  class_id: string;
  class_name: string;
  scores: Record<string, CellScore>;
  total: number;
  done_count: number;
  full_mark: number;
}

interface PerQ {
  question_id: string;
  submitted: number;
  avg: number | null;
  max: number | null;
  min: number | null;
}

interface AnalyticsData {
  classes: { id: string; name: string }[];
  class_id: string;
  questions: QMeta[];
  students: StudentRow[];
  per_question: PerQ[];
  student_count: number;
  full_mark: number;
}

type SortKey = 'label' | 'class' | 'total' | 'done';

const scoreColor = (obtained: number, full: number) => {
  if (!(full > 0)) return 'text-gray-500';
  const r = obtained / full;
  if (r >= 1) return 'text-emerald-600';
  if (r >= 0.6) return 'text-amber-600';
  return 'text-rose-600';
};

/** 表头里的题目名（模板文件名可能很长，截断显示，完整名进 title 提示 + 下方对照表） */
const HEAD_MAX = 12;
const shortTitle = (t: string) => (t.length > HEAD_MAX ? t.slice(0, HEAD_MAX) + '…' : t);

export const WpsOpAnalytics: React.FC<{ kind?: 'wps' | 'access' }> = ({ kind = 'wps' }) => {
  const isAccess = kind === 'access';
  const base = isAccess ? '/api/teacher/access-op' : '/api/teacher/wps-op';
  const kindLabel = isAccess ? 'Access' : 'WPS';
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [classId, setClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'total', asc: false });

  const load = useCallback(async (cid: string) => {
    setLoading(true);
    setErr('');
    try {
      const qs = cid ? `?classId=${encodeURIComponent(cid)}` : '';
      const { data: d, error } = await backendClient.get(`${base}/analytics${qs}`);
      if (error) throw new Error(error.message || String(error));
      setData(d || null);
    } catch (e: any) {
      setErr(e?.message || '加载练习情况失败');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => { load(''); }, [load]);

  const rows = useMemo(() => {
    const list = (data?.students || []).slice();
    const byAccount = (a: StudentRow, b: StudentRow) => studentLabel(a).localeCompare(studentLabel(b), 'zh-Hans-CN');
    const val = (s: StudentRow) => {
      switch (sort.key) {
        case 'label': return studentLabel(s);
        case 'class': return String(s.class_name || '');
        case 'done': return s.done_count || 0;
        default: return s.total || 0;
      }
    };
    list.sort((a, b) => {
      const va = val(a); const vb = val(b);
      const cmp = typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb), 'zh-Hans-CN')
        : (va as number) - (vb as number);
      const primary = sort.asc ? cmp : -cmp;
      return primary !== 0 ? primary : byAccount(a, b);
    });
    return list;
  }, [data, sort]);

  const perQMap = useMemo(() => {
    const m = new Map<string, PerQ>();
    (data?.per_question || []).forEach((p) => m.set(p.question_id, p));
    return m;
  }, [data]);

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'label' || key === 'class' }));
  };

  const sortIcon = (key: SortKey) => {
    if (sort.key !== key) return <i className="fas fa-sort ml-1 text-[10px] text-gray-300" />;
    return <i className={`fas fa-sort-${sort.asc ? 'up' : 'down'} ml-1 text-[10px] text-emerald-600`} />;
  };

  const exportCsv = () => {
    if (!data) return;
    // 导出用完整模板文件名（表头会截断，CSV 里给全称，方便老师直接拿去统计）
    const head = ['账号', '姓名', '班级', ...data.questions.map((q) => `${q.template_name || q.title}(${q.full_score}分)`), '总分', '已做题数'];
    const lines = [head.join(',')];
    for (const s of rows) {
      const cells = [
        s.username || '', s.real_name || '', s.class_name || '',
        ...data.questions.map((q) => {
          const hit = s.scores[q.id];
          return hit ? String(hit.best) : '';
        }),
        String(s.total), String(s.done_count),
      ];
      lines.push(cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${kindLabel}操作题练习情况_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  if (loading && !data) return <div className="py-12 text-center text-sm text-gray-400">加载练习情况…</div>;

  if (err && !data) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        {err}
        <button onClick={() => load(classId)} className="ml-2 underline">重试</button>
      </div>
    );
  }

  const d = data!;
  const questions = d.questions || [];

  return (
    <div className="space-y-3">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          班级
          <select
            value={classId}
            onChange={(e) => { setClassId(e.target.value); load(e.target.value); }}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
          >
            <option value="">全部班级（{d.student_count} 人）</option>
            {(d.classes || []).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </label>
        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          {questions.length} 道操作题 · 全卷满分 {d.full_mark}
        </span>
        <span className="text-[11px] text-gray-400">每题取该生最高分，总分 = 各题最高分之和；题目名取模板文件名</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => load(classId)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            <i className="fas fa-rotate mr-1" /> 刷新
          </button>
          <button onClick={exportCsv} disabled={!rows.length} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            <i className="fas fa-file-csv mr-1" /> 导出 CSV
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">{err}</div>}

      {!questions.length && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-400">
          还没有 {kindLabel} 操作题，先在「题库管理」里出题。
        </div>
      )}

      {!!questions.length && (
        <div className="overflow-auto rounded-lg border border-gray-200 bg-white" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-100 text-gray-600">
                <th
                  onClick={() => toggleSort('label')}
                  className="sticky left-0 z-30 cursor-pointer border-b border-gray-200 bg-gray-100 px-3 py-2 text-left font-semibold whitespace-nowrap"
                >
                  账号 姓名 {sortIcon('label')}
                </th>
                <th onClick={() => toggleSort('class')} className="cursor-pointer border-b border-gray-200 px-3 py-2 text-left font-semibold whitespace-nowrap">
                  班级 {sortIcon('class')}
                </th>
                {questions.map((q, i) => (
                  <th
                    key={q.id}
                    title={`${q.template_name || q.title}（${q.full_score} 分 / ${q.step_count} 步）`}
                    className="border-b border-gray-200 px-2 py-2 text-center font-semibold whitespace-nowrap"
                  >
                    <div className="text-[11px] text-gray-700">{i + 1}. {shortTitle(q.title)}</div>
                    <div className="text-[10px] font-normal text-gray-400">
                      {q.full_score} 分{q.practice_enabled ? '' : ' · 已下架'}
                    </div>
                  </th>
                ))}
                <th onClick={() => toggleSort('total')} className="cursor-pointer border-b border-l border-gray-200 px-3 py-2 text-center font-semibold whitespace-nowrap bg-gray-100">
                  总分 {sortIcon('total')}
                </th>
                <th onClick={() => toggleSort('done')} className="cursor-pointer border-b border-gray-200 bg-gray-100 px-3 py-2 text-center font-semibold whitespace-nowrap">
                  已做 {sortIcon('done')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-sky-50/60">
                  <td className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-1.5 whitespace-nowrap text-gray-800">
                    {studentLabel(s)}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1.5 whitespace-nowrap text-gray-500">{s.class_name || '—'}</td>
                  {questions.map((q) => {
                    const hit = s.scores[q.id];
                    return (
                      <td key={q.id} className="border-b border-gray-100 px-2 py-1.5 text-center whitespace-nowrap" title={hit ? `提交 ${hit.tries} 次，最高 ${hit.best} / ${hit.full}` : '未提交'}>
                        {hit ? (
                          <span className={`font-semibold ${scoreColor(hit.best, hit.full || q.full_score)}`}>{hit.best}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-gray-100 bg-gray-50/70 px-3 py-1.5 text-center font-bold whitespace-nowrap text-gray-800">
                    {s.total}
                    {s.done_count > 0 && (
                      <span className="ml-0.5 text-[10px] font-normal text-gray-400">
                        /{questions.reduce((acc, q) => acc + (s.scores[q.id] ? (s.scores[q.id].full || q.full_score) : 0), 0)}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1.5 text-center whitespace-nowrap text-gray-500">
                    {s.done_count}/{questions.length}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={questions.length + 4} className="py-10 text-center text-sm text-gray-400">该范围内暂无学生</td></tr>
              )}
            </tbody>
            {!!rows.length && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-gray-50 text-gray-500">
                  <td className="sticky left-0 z-10 bg-gray-50 px-3 py-1.5 font-medium whitespace-nowrap" colSpan={2}>每题平均（按提交人数）</td>
                  {questions.map((q) => {
                    const p = perQMap.get(q.id);
                    return (
                      <td key={q.id} className="px-2 py-1.5 text-center whitespace-nowrap" title={p && p.submitted ? `${p.submitted} 人提交，最高 ${p.max}，最低 ${p.min}` : '尚无人提交'}>
                        {p && p.avg !== null ? <span className="font-semibold text-gray-700">{p.avg}</span> : <span className="text-gray-300">—</span>}
                        {p && p.submitted ? <span className="ml-1 text-[10px] text-gray-400">({p.submitted}人)</span> : null}
                      </td>
                    );
                  })}
                  <td className="border-l border-gray-200 bg-gray-50 px-3 py-1.5 text-center font-semibold text-gray-600 whitespace-nowrap">
                    {rows.length ? Math.round((rows.reduce((a, s) => a + s.total, 0) / rows.length) * 100) / 100 : '—'}
                  </td>
                  <td className="bg-gray-50 px-3 py-1.5 text-center whitespace-nowrap" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* 题目对照表（表头会截断，这里给全称） */}
      {questions.length > 1 && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-600">
            题目对照
            <span className="font-normal text-gray-400">题目名 = 这道题的模板文件名（上传的空白表格 / 数据库文件名）</span>
          </div>
          <div className="space-y-1">
            {questions.map((q, i) => (
              <div key={q.id} className="flex items-baseline gap-2 text-xs text-gray-500">
                <span className="flex-none rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-gray-700">{q.template_name || q.title}</span>
                <span className="flex-none text-[11px] text-gray-400">{q.cluster_id || '未分类'} · {q.full_score} 分</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WpsOpAnalytics;
