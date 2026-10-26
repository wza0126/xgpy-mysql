import React, { useEffect, useMemo, useState } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 综合题 · 练习反馈（教师端，2026-10-26 二次改版）
 *
 * 定位修正：这个入口**不做题目管理**——题型、小题、答案的编辑在「选题」页里本来就更强，
 * 再做一个弱化版只会让人不知道该在哪改。
 * 所以这里只放两样东西：
 *   ① 学生练得怎么样：作答人次 / 人数 / 平均分 / 最高分 / 最近一次；
 *   ② 老师要做的动作：开放或关闭练习、重置练习记录（让学生能重做）。
 */

interface CompositeRow {
  id: string;
  content: string;
  cluster_id: string;
  sub_topic: string;
  practice_enabled: boolean;
  exam_enabled: boolean;
  subs_count: number;
}

interface StatRow {
  id: string;
  subs_count: number;
  full_score: number;
  attempts: number;
  students: number;
  avg_score: number;
  best_score: number;
  last_at: string | null;
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const CompositeManager: React.FC = () => {
  const [rows, setRows] = useState<CompositeRow[]>([]);
  const [stats, setStats] = useState<Record<string, StatRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [filter, setFilter] = useState<'all' | 'practicable' | 'practiced'>('all');

  const load = async () => {
    try {
      const [listRes, statRes]: any[] = await Promise.all([
        backendClient.get('/api/teacher/composite/questions'),
        backendClient.get('/api/teacher/composite/stats'),
      ]);
      setRows((listRes && listRes.data) || []);
      const map: Record<string, StatRow> = {};
      ((statRes && statRes.data) || []).forEach((s: StatRow) => {
        map[s.id] = s;
      });
      setStats(map);
      setError('');
    } catch (e: any) {
      setError(e?.message || '加载综合题失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const togglePractice = async (row: CompositeRow) => {
    setBusyId(row.id);
    try {
      const next = !row.practice_enabled;
      await backendClient.post('/api/teacher/composite/practice', {
        question_id: row.id,
        practice_enabled: next,
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, practice_enabled: next } : r)));
    } catch (e: any) {
      alert(e?.message || '操作失败');
    } finally {
      setBusyId('');
    }
  };

  const resetPractice = async (row: CompositeRow) => {
    const st = stats[row.id];
    const label = (row.sub_topic || row.content || '').replace(/<[^>]+>/g, '').slice(0, 30);
    const count = st?.attempts || 0;
    if (count === 0) {
      alert('这道题还没有练习记录，不用重置。');
      return;
    }
    // 二次确认：先把「要删多少条」摆出来，再说清哪些数据不受影响
    const ok = window.confirm(
      `重置「${label}」的练习记录？\n\n` +
        `将删除 ${count} 条学生练习作答（涉及 ${st?.students || 0} 名学生），删除后不可恢复。\n` +
        `学生重新进入「综合题」就能再做这道题；考试成绩不受影响。`
    );
    if (!ok) return;

    setBusyId(row.id);
    try {
      const res: any = await backendClient.post('/api/teacher/composite/reset', { question_id: row.id });
      const deleted = Number(res?.data?.deleted) || 0;
      alert(`已重置：删除 ${deleted} 条练习记录`);
      await load();
    } catch (e: any) {
      alert(e?.message || '重置失败');
    } finally {
      setBusyId('');
    }
  };

  const totals = useMemo(() => {
    const list = Object.values(stats);
    return {
      composite: rows.length,
      open: rows.filter((r) => r.practice_enabled).length,
      attempts: list.reduce((s, x) => s + (x.attempts || 0), 0),
      practiced: list.filter((x) => (x.attempts || 0) > 0).length,
    };
  }, [rows, stats]);

  const list = useMemo(() => {
    if (filter === 'practicable') return rows.filter((r) => r.practice_enabled);
    if (filter === 'practiced') return rows.filter((r) => (stats[r.id]?.attempts || 0) > 0);
    return rows;
  }, [rows, stats, filter]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <i className="fa-solid fa-circle-notch fa-spin text-2xl text-purple-500"></i>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">综合题</p>
          <p className="mt-1 text-2xl font-bold text-gray-800">{totals.composite}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">已开放练习</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {totals.open}
            <span className="ml-1 text-xs font-normal text-gray-400">/ {totals.composite}</span>
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">被学生练过</p>
          <p className="mt-1 text-2xl font-bold text-indigo-600">{totals.practiced}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">累计练习人次</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{totals.attempts}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {([['all', '全部'], ['practicable', '可练'], ['practiced', '练过的']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded px-3 py-1.5 transition-colors ${
                filter === k ? 'bg-white font-medium text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          改题干 / 小题 / 答案请到「选题」页（那里是完整编辑器）
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400">
          没有符合条件的综合题
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">题目</th>
                <th className="px-3 py-2 text-center font-medium">小题 / 满分</th>
                <th className="px-3 py-2 text-center font-medium">作答</th>
                <th className="px-3 py-2 text-center font-medium">平均分</th>
                <th className="px-3 py-2 text-center font-medium">最高分</th>
                <th className="px-3 py-2 text-center font-medium">最近一次</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((row) => {
                const st = stats[row.id];
                const attempts = st?.attempts || 0;
                return (
                  <tr key={row.id} className="hover:bg-gray-50/60">
                    <td className="max-w-[280px] px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] text-purple-700">
                          {(row.cluster_id || '').split('/').pop() || '未分类'}
                        </span>
                        {row.practice_enabled ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">可练</span>
                        ) : (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">未开放</span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-gray-700" title={row.sub_topic || ''}>
                        {String(row.sub_topic || row.content || '').replace(/<[^>]+>/g, '').slice(0, 40)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-600">
                      {row.subs_count} / {st?.full_score || row.subs_count}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {attempts > 0 ? (
                        <>
                          <span className="font-medium text-gray-800">{attempts}</span>
                          <span className="text-xs text-gray-400"> 人次</span>
                          <p className="text-[11px] text-gray-400">{st?.students || 0} 人</p>
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {attempts > 0 ? (
                        <span
                          className={`font-medium ${
                            (st?.avg_score || 0) >= (st?.full_score || 1) * 0.6 ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        >
                          {st?.avg_score}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-600">
                      {attempts > 0 ? st?.best_score : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs text-gray-500">{formatTime(st?.last_at)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => togglePractice(row)}
                          disabled={busyId === row.id}
                          className={`rounded-lg px-2.5 py-1 text-xs text-white transition-colors disabled:opacity-50 ${
                            row.practice_enabled ? 'bg-gray-500 hover:bg-gray-600' : 'bg-emerald-600 hover:bg-emerald-700'
                          }`}
                        >
                          {busyId === row.id ? '处理中…' : row.practice_enabled ? '关闭练习' : '开放练习'}
                        </button>
                        <button
                          onClick={() => resetPractice(row)}
                          disabled={busyId === row.id}
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="清空这题的学生练习记录，让学生能重做"
                        >
                          重置练习
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        重置只清「练习」来源的作答记录，考试成绩与随堂任务记录不受影响；清除后学生可重新练习本题。
      </p>
    </div>
  );
};
