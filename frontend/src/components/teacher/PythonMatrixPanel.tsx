import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { TaskMatrix, type MatrixColumn, type MatrixRow } from './TaskMatrix';

/**
 * Python 作业 · 班级明细矩阵（教师端，2026-10-27）
 *
 * 与「题库管理 → 综合题」同一套交互：上方多选题目做批量操作，下方是学生 × 题目的明细表。
 *
 * 和综合题不同的是，Python 作业有自己的竖列语义：
 *   · 格子有三种状态 —— 已批改（分数）/ 已交但还没批改 / 没交（—）
 *   · 每道题是独立的一次提交（python_submissions 有 unique(task_id, student_id)），
 *     所以「重置」删的是提交记录本身，学生重新打开作业就能重做
 * ⛔ 批量启用/禁用走 /api/python/teacher/tasks/class-status：按班级生效，
 *    启用时后端会把这些题补进该班 class_ids（否则「启用了却看不见」）。
 */

interface MatrixQuestion {
  id: string;
  idx: number;
  title: string;
  task_type: 'code' | 'fill_blank';
  full_score: number;
  deadline: string | null;
  enabled: boolean;
}

interface MatrixCellRaw {
  value: number | null;
  score: number | null;
  submitted: boolean;
  graded: boolean;
  is_late: boolean;
  submitted_at: string | null;
  status: string;
  text: string;
  kind: 'full' | 'normal' | 'warn';
}

interface MatrixStudentRaw {
  id: string;
  username: string;
  real_name: string;
  cells: Record<string, MatrixCellRaw>;
  done: number;
  graded: number;
  earned: number;
  full: number;
}

interface MatrixData {
  questions: MatrixQuestion[];
  students: MatrixStudentRaw[];
  total_full?: number;
  /** 对该班开放的题数（关闭的题不计入「已交 x/N」的分母） */
  visible_count?: number;
}

const fmtTime = (v: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const PythonMatrixPanel: React.FC = () => {
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
        `/api/python/teacher/matrix?class_id=${encodeURIComponent(classId)}`,
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
  // 换班级清空选中：操作范围按班算，把上一班的选择带过来容易误伤
  useEffect(() => { setSelectedQids([]); }, [classId]);

  const questions = data?.questions || [];
  const students = data?.students || [];
  const classLabel = classes.find((c) => c.id === classId)?.name || '';
  const totalFull = data?.total_full || questions.reduce((s, q) => s + q.full_score, 0);

  const columns: MatrixColumn[] = useMemo(
    () =>
      questions.map((q) => ({
        id: q.id,
        label: `第${q.idx}题`,
        full: q.full_score,
        enabled: q.enabled,
        title: `${q.title}（${q.task_type === 'fill_blank' ? '编程填空' : '编程作业'} · 满分 ${q.full_score}）`,
      })),
    [questions],
  );

  const matrixRows: MatrixRow[] = useMemo(
    () =>
      students.map((stu) => {
        const cells: MatrixRow['cells'] = {};
        for (const q of questions) {
          const c = stu.cells[q.id];
          if (!c || !c.submitted) continue;
          cells[q.id] = {
            value: c.score,
            // 待批改的格子显示「待批改」，排序时与没交一样靠前（都算没完成）
            text: c.text || (c.score != null ? `${c.score}/${q.full_score}` : '待批改'),
            title:
              (c.score != null ? `得分 ${c.score}/${q.full_score}` : '已提交，还没批改') +
              (c.is_late ? '（迟交）' : '') +
              (c.submitted_at ? `｜提交于 ${fmtTime(c.submitted_at)}` : ''),
            kind: c.kind === 'full' ? 'full' : c.kind === 'warn' ? 'warn' : 'normal',
          };
        }
        return {
          id: stu.id,
          username: stu.username,
          real_name: stu.real_name,
          cells,
          done: stu.done,
          doneTotal: data?.visible_count,
          earned: stu.earned,
          full: stu.full || totalFull,
        };
      }),
    [students, questions, totalFull, data?.visible_count],
  );

  const toggleQid = (id: string) => {
    setSelectedQids((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const allSelected = questions.length > 0 && selectedQids.length === questions.length;
  const toggleAll = () => setSelectedQids(allSelected ? [] : questions.map((q) => q.id));

  const batchSetActive = async (isActive: boolean) => {
    if (!selectedQids.length) return;
    setBusy(isActive ? 'enable' : 'disable');
    try {
      const res: any = await backendClient.post('/api/python/teacher/tasks/class-status', {
        task_ids: selectedQids,
        class_id: classId,
        is_active: isActive,
      });
      await loadMatrix();
      const attached = Number(res?.data?.attached) || 0;
      alert(
        `已对【${classLabel}】${isActive ? '启用' : '禁用'} ${selectedQids.length} 道题。` +
        (attached ? `\n其中 ${attached} 道原本没布置给这个班，已一并加入。` : ''),
      );
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
      selectedQids.some((qid) => s.cells[qid] && s.cells[qid].submitted),
    ).length;
    const ok = window.confirm(
      `重置这些作业的提交记录？\n\n` +
        `范围：${classLabel} · ${names}（共 ${selectedQids.length} 道）\n` +
        `影响：约 ${hitStudents} 名学生在这几道题上的提交与批改记录会被删除，删除后不可恢复。\n` +
        `学生重新打开作业就能重做；其他班级不受影响。`,
    );
    if (!ok) return;
    setBusy('reset');
    try {
      const res: any = await backendClient.post('/api/python/teacher/reset-homework', {
        class_id: classId,
        task_ids: selectedQids,
      });
      const d = (res && res.data) || {};
      await loadMatrix();
      setSelectedQids([]);
      alert(`已删除 ${d.deleted || 0} 条提交、${d.gradings || 0} 条批改记录`);
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
          格子里是每道题的<strong>分数</strong>，「待批改」表示交了还没批，<strong>「—」表示没交</strong>。
          点表头可按该列排序。
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
                  onClick={() => batchSetActive(true)}
                  disabled={!!busy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <i className="fa-solid fa-lock-open mr-1"></i>批量启用
                </button>
                <button
                  onClick={() => batchSetActive(false)}
                  disabled={!!busy}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <i className="fa-solid fa-lock mr-1"></i>批量禁用
                </button>
                <button
                  onClick={batchReset}
                  disabled={!!busy}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <i className="fa-solid fa-rotate-left mr-1"></i>重置提交
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
                  title={`${q.title}（${q.task_type === 'fill_blank' ? '编程填空' : '编程作业'} · 满分 ${q.full_score}）`}
                  className={`rounded-lg border px-2 py-1 text-xs transition-colors ${
                    on
                      ? 'border-purple-400 bg-purple-50 font-medium text-purple-700'
                      : q.enabled
                        ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        : 'border-dashed border-gray-200 text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  {on && <i className="fa-solid fa-check mr-1"></i>}
                  第{q.idx}题
                  <span className="ml-1 text-[10px] opacity-70">
                    {q.task_type === 'fill_blank' ? '填' : '码'}
                  </span>
                  {!q.enabled && <span className="ml-1 text-[10px]">·关</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 明细矩阵：点表头排序 */}
      <TaskMatrix
        columns={columns}
        rows={matrixRows}
        loading={loading}
        emptyText="这个班还没有学生"
        doneLabel="已交"
        earnedLabel="得分"
        footerLabel={`全班 ${students.length} 人`}
      />
    </div>
  );
};
