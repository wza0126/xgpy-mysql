import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { TaskMatrix, type MatrixColumn, type MatrixRow } from './TaskMatrix';

/**
 * 综合题 · 班级明细与批量操作（教师端，2026-10-27 三改）
 *
 * 吴老的原话：「我要看到每个班级每个人每个题目的完成情况，还要能批量多选、批量启用、重置」。
 *
 * 所以这一版把「按题目一行」的汇总，换成 **学生 × 题目** 的矩阵：
 *   行 = 该班每个学生，列 = 每道综合题，格子 = 该生这道题的历史最好分。
 * 一眼能看出「谁练了、谁没练、哪道题全班都没做」。
 *
 * 上方是可以多选的题目条：选中若干题 → 批量开放 / 批量关闭 / 重置练习。
 * ⛔ 重置只删 source='practice' 的记录，考试成绩与随堂任务的作答不受影响（后端保证）。
 * ⛔ 口径与「练习反馈」「学生端历史最好分」同一个 getCompositeCredit，三处数字必须对得上。
 */

interface MatrixQuestion {
  id: string;
  idx: number;
  subs_count: number;
  full_score: number;
  practice_enabled: boolean;
  cluster: string;
  sub_topic: string;
}

interface MatrixStudent {
  id: string;
  username: string;
  real_name: string;
  cells: Record<string, { best: number; attempts: number }>;
  practiced: number;
  earned: number;
  full: number;
}

interface MatrixData {
  questions: MatrixQuestion[];
  students: MatrixStudent[];
  total_full?: number;
  /** 对该班开放的题数（关闭的题不计入「已练 x/N」的分母） */
  visible_count?: number;
}

export const CompositeManager: React.FC = () => {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classId, setClassId] = useState('');
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selectedQids, setSelectedQids] = useState<string[]>([]);
  const [busy, setBusy] = useState('');

  const loadClasses = useCallback(async () => {
    try {
      const res: any = await backendClient.get('/api/classes');
      const list = (res && res.data) || [];
      setClasses(list);
      // 明细必须落到一个班，默认选第一个，省一次点击
      setClassId((prev) => prev || (list.length ? list[0].id : ''));
    } catch {
      setClasses([]);
    }
  }, []);

  const loadMatrix = useCallback(async () => {
    if (!classId) { setData(null); setLoading(false); return; }
    setLoading(true);
    setErr('');
    try {
      const res: any = await backendClient.get(
        `/api/teacher/composite/matrix?class_id=${encodeURIComponent(classId)}`,
      );
      setData((res && res.data) || null);
    } catch (e) {
      setErr((e as Error).message || '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => { loadClasses(); }, [loadClasses]);
  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  // 换班级时清掉选中：操作范围按班算，把上一班的选择带过来容易误伤
  useEffect(() => { setSelectedQids([]); }, [classId]);

  const questions = data?.questions || [];
  const students = data?.students || [];
  const totalFull = data?.total_full || questions.reduce((s, q) => s + q.full_score, 0);
  const classLabel = classes.find((c) => c.id === classId)?.name || '';

  const toggleQid = (id: string) => {
    setSelectedQids((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const allSelected = questions.length > 0 && selectedQids.length === questions.length;
  const toggleAll = () => setSelectedQids(allSelected ? [] : questions.map((q) => q.id));

  // 矩阵表格用通用组件：列 / 行映射成 TaskMatrix 的形状，排序（点表头）由它统一处理
  const columns: MatrixColumn[] = useMemo(
    () =>
      questions.map((q) => ({
        id: q.id,
        label: `第${q.idx}题`,
        full: q.full_score,
        enabled: q.practice_enabled,
        title: `${q.cluster}${q.sub_topic ? ' · ' + q.sub_topic : ''}（满分 ${q.full_score}）`,
      })),
    [questions],
  );

  const matrixRows: MatrixRow[] = useMemo(
    () =>
      students.map((stu) => {
        const cells: MatrixRow['cells'] = {};
        for (const q of questions) {
          const c = stu.cells[q.id];
          if (!c || c.attempts === 0) continue;
          cells[q.id] = {
            value: c.best,
            text: `${c.best}/${q.full_score}`,
            title: `作答 ${c.attempts} 次，最好 ${c.best} 分`,
            kind: c.best >= q.full_score ? 'full' : 'normal',
          };
        }
        return {
          id: stu.id,
          username: stu.username,
          real_name: stu.real_name,
          cells,
          done: stu.practiced,
          doneTotal: data?.visible_count,
          earned: stu.earned,
          full: stu.full || totalFull,
        };
      }),
    [students, questions, totalFull, data?.visible_count],
  );

  const batchPractice = async (enabled: boolean) => {
    if (!selectedQids.length) return;
    setBusy(enabled ? 'enable' : 'disable');
    try {
      await backendClient.post('/api/teacher/composite/practice', {
        question_ids: selectedQids,
        practice_enabled: enabled,
      });
      await loadMatrix();
      alert(`已${enabled ? '开放' : '关闭'} ${selectedQids.length} 道题的练习`);
    } catch (e) {
      alert(`操作失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const batchReset = async () => {
    if (!selectedQids.length) return;
    const names = questions
      .filter((q) => selectedQids.includes(q.id))
      .map((q) => `第${q.idx}题`)
      .join('、');
    const hitStudents = students.filter((s) =>
      selectedQids.some((qid) => s.cells[qid] && s.cells[qid].attempts > 0),
    ).length;
    const ok = window.confirm(
      `重置这些题的练习记录？\n\n` +
        `范围：${classLabel} · ${names}（共 ${selectedQids.length} 道）\n` +
        `影响：约 ${hitStudents} 名学生在这几道题上的练习记录会被删除，删除后不可恢复。\n` +
        `考试与随堂任务的作答不受影响；学生重新进入「综合题」就能再做。`,
    );
    if (!ok) return;
    setBusy('reset');
    try {
      const res: any = await backendClient.post('/api/teacher/composite/reset', {
        question_ids: selectedQids,
        class_id: classId,
      });
      const deleted = (res && res.data && res.data.deleted) || 0;
      await loadMatrix();
      setSelectedQids([]);
      alert(`已删除 ${deleted} 条练习记录`);
    } catch (e) {
      alert(`重置失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  if (!classes.length) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        还没有班级，先去「班级管理」建班。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 顶部：班级与说明 */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600">班级</label>
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-purple-500"
        >
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          onClick={() => loadMatrix()}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <i className="fa-solid fa-rotate mr-1"></i>刷新
        </button>
        <p className="text-xs text-gray-400">
          格子里是每个学生对每道题的<strong>历史最好分</strong>，「—」表示没做过。
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>
      )}

      {/* 题目多选条 + 批量操作 */}
      {questions.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-600">选择题目（可多选）</span>
            <button
              onClick={toggleAll}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              {allSelected ? '清空' : '全选'}
            </button>
            <span className="text-xs text-gray-400">已选 {selectedQids.length} / {questions.length}</span>
            {selectedQids.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => batchPractice(true)}
                  disabled={!!busy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <i className="fa-solid fa-lock-open mr-1"></i>批量开放
                </button>
                <button
                  onClick={() => batchPractice(false)}
                  disabled={!!busy}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <i className="fa-solid fa-lock mr-1"></i>批量关闭
                </button>
                <button
                  onClick={batchReset}
                  disabled={!!busy}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <i className="fa-solid fa-rotate-left mr-1"></i>重置练习
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {questions.map((q) => {
              const on = selectedQids.includes(q.id);
              return (
                <button
                  key={q.id}
                  onClick={() => toggleQid(q.id)}
                  title={`${q.cluster}${q.sub_topic ? ' · ' + q.sub_topic : ''}（满分 ${q.full_score}）`}
                  className={`rounded-lg border px-2 py-1 text-xs transition-colors ${
                    on
                      ? 'border-purple-400 bg-purple-50 font-medium text-purple-700'
                      : q.practice_enabled
                        ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        : 'border-dashed border-gray-200 text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  {on && <i className="fa-solid fa-check mr-1"></i>}
                  第{q.idx}题
                  <span className="ml-1 text-[10px] opacity-70">{q.subs_count}小问</span>
                  {!q.practice_enabled && <span className="ml-1 text-[10px]">·关</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 矩阵表：点表头可排序（学号 / 姓名 / 每题 / 已完成 / 得分） */}
      <TaskMatrix
        columns={columns}
        rows={matrixRows}
        loading={loading}
        emptyText="这个班还没有学生"
        doneLabel="已练"
        earnedLabel="得分"
        footerLabel={`全班 ${students.length} 人`}
      />
    </div>
  );
};
