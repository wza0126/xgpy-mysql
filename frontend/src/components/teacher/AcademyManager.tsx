import React, { useCallback, useEffect, useState } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 星卡学院 · 老师端配置（2026-11-16）
 *
 * 老师需要能管三件事：
 *   ① 开关（不想让学生玩时一键关掉）
 *   ② 每课首通发几颗钻石（0 = 不发；发放计入平台每日产出上限，不另开额度）
 *   ③ 每个班讲到第几课 —— 学生端的「本课委托」就取这里
 * 外加一个全班星卡分布，方便看谁在跟、谁掉队了。
 */

interface Overview {
  config: { enabled: boolean; diamond_per_lesson: number; cards_per_lesson: number };
  lesson: { idx: number; total: number; cards: { chapter_code: string; section: string }[] };
  lessons: { idx: number; titles: string[] }[];
  students: { student_id: string; name: string; username: string; stars: number; level: number; answered: number; percent: number }[];
  card_total: number;
}

export const AcademyManager: React.FC = () => {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classId, setClassId] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [draft, setDraft] = useState({ enabled: true, diamond_per_lesson: 1, cards_per_lesson: 2 });
  const [lessonIdx, setLessonIdx] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showPlan, setShowPlan] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r: any = await backendClient.get('/api/classes');
        const list = (r?.data || []).map((c: any) => ({ id: c.id, name: c.name }));
        setClasses(list);
        if (list.length) setClassId(list[0].id);
      } catch { setClasses([]); }
    })();
  }, []);

  const load = useCallback(async (cid: string) => {
    if (!cid) { setLoading(false); return; }
    setLoading(true);
    try {
      const r: any = await backendClient.get(`/api/teacher/academy/overview?class_id=${encodeURIComponent(cid)}`);
      const d: Overview = r?.data;
      setData(d);
      setDraft({
        enabled: !!d.config.enabled,
        diamond_per_lesson: Number(d.config.diamond_per_lesson) || 0,
        cards_per_lesson: Number(d.config.cards_per_lesson) || 2,
      });
      setLessonIdx(Number(d.lesson.idx) || 1);
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '加载失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(classId); }, [classId, load]);

  const save = async () => {
    if (!classId) return;
    setSaving(true);
    setMsg(null);
    try {
      await backendClient.put('/api/teacher/academy/config', {
        class_id: classId,
        enabled: draft.enabled ? 1 : 0,
        diamond_per_lesson: draft.diamond_per_lesson,
        cards_per_lesson: draft.cards_per_lesson,
        lesson_idx: lessonIdx,
      });
      setMsg({ type: 'ok', text: '已保存，学生刷新页面后生效' });
      await load(classId);
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const avgStars = data?.students?.length
    ? Math.round(data.students.reduce((s, x) => s + x.stars, 0) / data.students.length)
    : 0;
  const activeCount = data?.students?.filter((s) => s.stars > 0).length || 0;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">星卡学院</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            70 个知识点 = 70 张星卡，16 章 = 16 座建筑；按 35 节课设计，每课 2 个知识点。
          </p>
        </div>
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500"
        >
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading && <p className="text-sm text-gray-400">加载中…</p>}

      {!loading && data && (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-medium text-gray-700">基本设置</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-600">启用学院（关闭后学生打不开）</span>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  className="h-4 w-4 rounded"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm text-gray-600">每课首通奖励钻石</span>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    填 0 = 不发。发放计入「游戏时长池」里的每日钻石产出上限，和测试/考试/任务共用额度。
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={draft.diamond_per_lesson}
                  onChange={(e) => setDraft({ ...draft, diamond_per_lesson: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-sm text-center"
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                <div>
                  <span className="text-sm text-gray-600">本班当前课次</span>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    学生端「本课委托」就取这个。共 {data.lesson.total} 课，今天讲第几课就填几。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={data.lesson.total}
                    value={lessonIdx}
                    onChange={(e) => setLessonIdx(Math.max(1, Math.min(data.lesson.total, Number(e.target.value) || 1)))}
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-sm text-center"
                  />
                  <span className="text-xs text-gray-400">/ {data.lesson.total}</span>
                </div>
              </div>

              {data.lesson.cards?.length > 0 && (
                <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  第 {lessonIdx} 课内容：{data.lesson.cards.map((c) => `${c.chapter_code} ${c.section}`).join('、')}
                </p>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
              <button
                onClick={() => setShowPlan((v) => !v)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                {showPlan ? '收起课程表' : '查看 35 课课程表'}
              </button>
              {msg && (
                <span className={`text-xs ${msg.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>
              )}
            </div>

            {showPlan && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                {data.lessons.map((l) => (
                  <div
                    key={l.idx}
                    className={`flex gap-2 rounded px-2 py-1 text-xs ${l.idx === lessonIdx ? 'bg-indigo-100 text-indigo-800' : 'text-gray-600'}`}
                  >
                    <span className="w-12 flex-shrink-0 font-mono">第 {l.idx} 课</span>
                    <span className="flex-1">{l.titles.join(' · ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-gray-700">全班进度</h3>
              <p className="text-xs text-gray-500">
                已开始 {activeCount}/{data.students.length} 人 · 人均 {avgStars} 星（满 {data.card_total * 3} 星）
              </p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-xs text-gray-500">
                  <tr>
                    <th className="px-2 py-1 text-left font-normal">学号</th>
                    <th className="px-2 py-1 text-left font-normal">姓名</th>
                    <th className="px-2 py-1 text-right font-normal">星数</th>
                    <th className="px-2 py-1 text-right font-normal">等级</th>
                    <th className="px-2 py-1 text-right font-normal">答题</th>
                    <th className="px-2 py-1 text-right font-normal">完成度</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.student_id} className="border-t border-gray-100">
                      <td className="px-2 py-1 font-mono text-xs text-gray-500">{s.username}</td>
                      <td className="px-2 py-1 text-gray-800">{s.name}</td>
                      <td className="px-2 py-1 text-right text-indigo-700">{s.stars}</td>
                      <td className="px-2 py-1 text-right text-gray-600">Lv.{s.level}</td>
                      <td className="px-2 py-1 text-right text-gray-500">{s.answered}</td>
                      <td className="px-2 py-1 text-right">
                        <span className={`text-xs ${s.percent >= 50 ? 'text-emerald-600' : s.percent > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {s.percent}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            <p className="mb-1 font-medium">三条设计说明（避免误以为是 bug）</p>
            <p>· 同一张卡一天只能升一阶：学生当天重复做同一知识点不会继续涨星，这是为了防止一晚上把 210 星刷满。</p>
            <p>· 答错不扣任何东西，只提示重做；提示要花魔力（答对才产出魔力）。</p>
            <p>· 学生答满 3 次即「精通」，卡片不会消失，可以继续练。</p>
          </div>
        </>
      )}
    </div>
  );
};
