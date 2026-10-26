import React, { useEffect, useMemo, useState } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 综合题管理（教师端，2026-10-26）
 *
 * 定位：题库管理里给综合题一个**独立入口**，不再和单选/填空混在一张表里翻。
 * 这里管两件事：
 *   ① 看清每道综合题有几个小题、考哪个知识点（小题题干可直接展开核对）；
 *   ② 控制学生端能不能在「综合题练习」里练到它（practice_enabled）。
 * 编辑题干仍在题库管理的编辑器里做（题型选「综合题」），这里不做重复建设。
 */

interface SubPreview {
  type: string;
  score: number;
  multiple: boolean;
  content: string;
}

interface CompositeRow {
  id: string;
  content: string;
  cluster_id: string;
  sub_topic: string;
  practice_enabled: boolean;
  exam_enabled: boolean;
  subs_count: number;
  subs_preview: SubPreview[];
  created_at?: string;
}

export const CompositeManager: React.FC = () => {
  const [rows, setRows] = useState<CompositeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [expanded, setExpanded] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'practicable' | 'closed'>('all');

  const load = async () => {
    try {
      const res: any = await backendClient.get('/api/teacher/composite/questions');
      setRows((res && res.data) || []);
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

  const stats = useMemo(() => {
    const total = rows.length;
    const open = rows.filter((r) => r.practice_enabled).length;
    const subs = rows.reduce((s, r) => s + (r.subs_count || 0), 0);
    return { total, open, subs };
  }, [rows]);

  const list = useMemo(() => {
    if (filter === 'practicable') return rows.filter((r) => r.practice_enabled);
    if (filter === 'closed') return rows.filter((r) => !r.practice_enabled);
    return rows;
  }, [rows, filter]);

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

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">综合题总数</p>
          <p className="mt-1 text-2xl font-bold text-gray-800">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">已开放练习</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {stats.open}
            <span className="ml-1 text-xs font-normal text-gray-400">/ {stats.total}</span>
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">小题合计</p>
          <p className="mt-1 text-2xl font-bold text-indigo-600">{stats.subs}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {([['all', '全部'], ['practicable', '可练'], ['closed', '未开放']] as const).map(([k, label]) => (
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
          综合题不会进入单题练习池；这里打开始终由学生端「综合题练习」出现
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400">
          没有符合条件的综合题
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((row) => {
            const on = row.practice_enabled;
            const open = expanded === row.id;
            return (
              <div key={row.id} className="rounded-xl border border-gray-200 bg-white">
                <div className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
                        {(row.cluster_id || '').split('/').pop() || '未分类'}
                      </span>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {row.subs_count} 小题
                      </span>
                      {row.exam_enabled && (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">可用于考试</span>
                      )}
                      {on ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">学生可练</span>
                      ) : (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">未开放练习</span>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-gray-700">
                      {String(row.sub_topic || row.content || '').replace(/<[^>]+>/g, '').slice(0, 90)}
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      onClick={() => setExpanded(open ? '' : row.id)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      {open ? '收起小题' : '看小题'}
                    </button>
                    <button
                      onClick={() => togglePractice(row)}
                      disabled={busyId === row.id}
                      className={`rounded-lg px-3 py-1.5 text-xs text-white transition-colors disabled:opacity-50 ${
                        on ? 'bg-gray-500 hover:bg-gray-600' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      {busyId === row.id ? '处理中…' : on ? '关闭练习' : '开放练习'}
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3">
                    <div className="space-y-1.5">
                      {row.subs_preview.map((sq, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-white text-[10px] text-gray-500">
                            {i + 1}
                          </span>
                          <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">
                            {sq.type === 'fill_blank' ? '填空' : sq.multiple ? '多选' : '单选'}
                            {sq.score ? ` ${sq.score}分` : ''}
                          </span>
                          <span className="min-w-0 flex-1">{sq.content || '（无题干）'}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] text-gray-400">
                      要改题干或答案，请到「题库管理 → 选题」里编辑（题型选「综合题」）。
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
