import React, { useCallback, useEffect, useState } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 生存游戏 · 教师端（考试管理 → 生存游戏，2026-10-27）
 *
 * 三块：
 *   ① 班级开放：按班开关（同步到该班每个学生）+ 各班战况
 *   ② 难度参数：初始血量 / 加减血 / 限时 / 强制订正，随时改，立即生效
 *   ③ 关卡管理：70 关的标题、停用、补题、单元内顺序随机化
 *
 * ⛔ 班级开关必须同步写 profiles，学生端只认自己的 profiles 字段。
 */

interface Cfg {
  hp_init: number;
  hp_gain: number;
  hp_repeat_gain: number;
  hp_penalty: number;
  time_choice: number;
  time_blank: number;
  require_correction: number;
  rank_limit: number;
}

interface ClassRow {
  id: string;
  name: string;
  enabled: boolean;
  students: number;
  players: number;
  avg_levels: number;
  max_levels: number;
  avg_hp: number;
  deaths: number;
  active_today: number;
}

interface LevelRow {
  seq: number;
  code: string;
  title: string;
  unit_index: number;
  unit_name: string;
  chapter_name: string;
  cluster_id: string;
  question_count: number;
  extra_question_ids: string[];
  is_active: boolean;
  /** 重生点：血尽后回到这里（到达即解锁） */
  is_checkpoint: boolean;
  checkpoint_story: string;
  attempts: number;
}

const FIELD_DEFS: { key: keyof Cfg; label: string; hint: string; min: number; max: number }[] = [
  { key: 'hp_init', label: '初始信号', hint: '进入游戏时的血量（100 = 10 格）', min: 10, max: 10000 },
  { key: 'hp_gain', label: '答对加分', hint: '当天首次做对这道题', min: 0, max: 1000 },
  { key: 'hp_repeat_gain', label: '重复答对加分', hint: '同一题当天再做对（防刷分）', min: 0, max: 1000 },
  { key: 'hp_penalty', label: '答错扣血', hint: '扣到 0 即断线', min: 0, max: 1000 },
  { key: 'time_choice', label: '选择题限时(秒)', hint: '0 = 不限时', min: 0, max: 600 },
  { key: 'time_blank', label: '填空题限时(秒)', hint: '要打字，一般比选择多给', min: 0, max: 600 },
  { key: 'rank_limit', label: '排行榜条数', hint: '全校榜显示前多少名', min: 10, max: 500 },
];

export const SurvivalManager: React.FC = () => {
  const [tab, setTab] = useState<'classes' | 'config' | 'levels'>('classes');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [draft, setDraft] = useState<Cfg | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [levelsEnabled, setLevelsEnabled] = useState(0);
  const [editing, setEditing] = useState<LevelRow | null>(null);
  const [extraInput, setExtraInput] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, o] = await Promise.all([
        backendClient.get('/api/teacher/survival/config'),
        backendClient.get('/api/teacher/survival/overview'),
      ]);
      const cd: any = c?.data || {};
      setCfg(cd.config || null);
      setDraft(cd.config || null);
      setLevelsEnabled(Number(cd.levels_enabled) || 0);
      setClasses((o?.data as ClassRow[]) || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLevels = useCallback(async () => {
    try {
      const res = await backendClient.get('/api/teacher/survival/levels');
      setLevels((res?.data as LevelRow[]) || []);
    } catch (e) {
      alert(`关卡加载失败：${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);
  useEffect(() => {
    if (tab === 'levels' && !levels.length) loadLevels();
  }, [tab, levels.length, loadLevels]);

  const toggleClass = async (row: ClassRow) => {
    setBusy(row.id);
    try {
      const res: any = await backendClient.post('/api/teacher/survival/class-toggle', {
        class_id: row.id,
        enabled: !row.enabled,
      });
      await loadAll();
      const n = res?.data?.students;
      if (n) console.log(`已同步 ${n} 名学生`);
    } catch (e) {
      alert(`操作失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const saveConfig = async () => {
    if (!draft) return;
    setBusy('cfg');
    try {
      const res: any = await backendClient.put('/api/teacher/survival/config', draft);
      setCfg(res?.data?.config || draft);
      setDraft(res?.data?.config || draft);
      alert('参数已保存，立即生效');
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const saveLevel = async (row: LevelRow, patch: Record<string, unknown>) => {
    try {
      await backendClient.put(`/api/teacher/survival/levels/${row.seq}`, patch);
      await loadLevels();
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    }
  };

  const shuffle = async () => {
    if (!window.confirm('把每个单元内的关卡顺序打乱一次？\n学生正在进行的关卡不会被打断，但之后的推进顺序会变。')) return;
    setBusy('shuffle');
    try {
      const res: any = await backendClient.post('/api/teacher/survival/shuffle', {});
      await loadLevels();
      alert(`已重排 ${res?.data?.count || 0} 关`);
    } catch (e) {
      alert(`重排失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>加载中…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-800">
            <i className="fa-solid fa-heart-pulse mr-2 text-cyan-600"></i>生存游戏 · 信号深潜
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            一关一题，答对加分下潜，答错扣血并要求订正；血量耗尽断线，从最近的中继站（重生点）重新接入，累计深度不清零。
            当前启用 <span className="font-medium text-gray-700">{levelsEnabled}</span> 关。
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {([['classes', '班级开放'], ['config', '难度参数'], ['levels', '关卡管理']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 transition-colors ${tab === k ? 'bg-white font-medium text-cyan-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'classes' && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">班级</th>
                <th className="px-3 py-3 text-center font-medium">开放</th>
                <th className="px-3 py-3 text-center font-medium">学生</th>
                <th className="px-3 py-3 text-center font-medium">参与</th>
                <th className="px-3 py-3 text-center font-medium">平均深度</th>
                <th className="px-3 py-3 text-center font-medium">最深</th>
                <th className="px-3 py-3 text-center font-medium">平均信号</th>
                <th className="px-3 py-3 text-center font-medium">今日活跃</th>
                <th className="px-3 py-3 text-center font-medium">断线次数</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-cyan-50/40">
                  <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => toggleClass(r)}
                      disabled={busy === r.id}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                        r.enabled ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                      }`}
                      title={r.enabled ? '点击关闭（该班学生进不去）' : '点击开放'}
                    >
                      {busy === r.id ? '…' : r.enabled ? '已开放' : '已关闭'}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{r.students}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{r.players}</td>
                  <td className="px-3 py-2.5 text-center font-medium text-cyan-700">{r.avg_levels}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{r.max_levels}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{r.avg_hp}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{r.active_today}</td>
                  <td className="px-3 py-2.5 text-center text-gray-500">{r.deaths}</td>
                </tr>
              ))}
              {classes.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-gray-400">还没有班级</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'config' && draft && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {FIELD_DEFS.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-sm font-medium text-gray-700">{f.label}</label>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  value={Number(draft[f.key])}
                  onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-gray-400">{f.hint}</p>
              </div>
            ))}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">答错必须订正</label>
              <button
                onClick={() => setDraft({ ...draft, require_correction: draft.require_correction ? 0 : 1 })}
                className={`w-full rounded-lg px-3 py-2 text-sm font-medium ${
                  draft.require_correction ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {draft.require_correction ? '已开启（答对才能继续）' : '已关闭（可直接跳过）'}
              </button>
              <p className="mt-1 text-xs text-gray-400">建议开启，否则「看解析」会变成点一下就走</p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-400">
              改动保存后立即生效；已在局中的学生适用新参数。
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDraft(cfg)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                还原
              </button>
              <button
                onClick={saveConfig}
                disabled={busy === 'cfg'}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                {busy === 'cfg' ? '保存中…' : '保存参数'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'levels' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">
              共 {levels.length} 关，启用 {levels.filter((l) => l.is_active).length} 关。
              停用的关卡会被跳过；题量只有 1 道的关卡可以用「补题」从别处再挂几道。
            </p>
            <div className="flex gap-2">
              <button
                onClick={shuffle}
                disabled={busy === 'shuffle'}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                title="解决「学生总在同一个单元卡死」的问题"
              >
                <i className="fa-solid fa-shuffle mr-1"></i>单元内顺序随机化
              </button>
              <button
                onClick={loadLevels}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                <i className="fa-solid fa-rotate mr-1"></i>刷新
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="max-h-[58vh] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">关卡</th>
                    <th className="px-3 py-2 text-left font-medium">知识点</th>
                    <th className="px-3 py-2 text-center font-medium">题量</th>
                    <th className="px-3 py-2 text-center font-medium">作答次数</th>
                    <th className="px-3 py-2 text-center font-medium">补充题</th>
                    <th className="px-3 py-2 text-center font-medium">中继站</th>
                    <th className="px-3 py-2 text-center font-medium">启用</th>
                    <th className="px-3 py-2 text-center font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((l) => (
                    <tr key={l.seq} className={`border-t border-gray-100 ${l.is_active ? '' : 'bg-gray-50 text-gray-400'}`}>
                      <td className="px-3 py-2 font-mono text-xs text-cyan-700">{l.code}</td>
                      <td className="px-3 py-2">
                        <div className="text-gray-800">{l.title}</div>
                        <div className="text-[11px] text-gray-400">{l.unit_name} · {l.chapter_name}</div>
                      </td>
                      <td className={`px-3 py-2 text-center ${l.question_count <= 1 ? 'font-medium text-amber-600' : 'text-gray-600'}`}>
                        {l.question_count}
                      </td>
                      <td className="px-3 py-2 text-center text-gray-500">{l.attempts}</td>
                      <td className="px-3 py-2 text-center text-gray-500">{l.extra_question_ids.length || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => saveLevel(l, { is_checkpoint: !l.is_checkpoint })}
                          title={l.is_checkpoint ? (l.checkpoint_story || '血尽后回到这里') : '设为重生点'}
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            l.is_checkpoint ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          }`}
                        >
                          {l.is_checkpoint ? '★ 重生点' : '设为'}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => saveLevel(l, { is_active: !l.is_active })}
                          className={`rounded-full px-2 py-0.5 text-xs ${l.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}
                        >
                          {l.is_active ? '启用' : '停用'}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => {
                            setEditing(l);
                            setExtraInput((l.extra_question_ids || []).join(','));
                          }}
                          className="text-xs text-cyan-600 hover:underline"
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-1 text-base font-bold text-gray-800">
              编辑关卡 <span className="font-mono text-cyan-700">{editing.code}</span>
            </h3>
            <p className="mb-3 text-xs text-gray-500">
              原知识点：{editing.cluster_id}（{editing.question_count} 题）
            </p>

            <label className="mb-1 block text-sm font-medium text-gray-700">关卡名</label>
            <input
              defaultValue={editing.title}
              id="sv-level-title"
              className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />

            <label className="mb-1 block text-sm font-medium text-gray-700">
              重生点剧情（这一关是重生点时才会显示，可留空）
            </label>
            <textarea
              defaultValue={editing.checkpoint_story}
              id="sv-level-story"
              rows={2}
              placeholder="例：深度 200m · 中继站 ALPHA 已激活。断线后会回到这里重新接入。"
              className="mb-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs"
            />
            <p className="mb-3 text-xs text-gray-400">
              学生第一次走到这一关时会看到这段话，之后不再重复。
            </p>

            <label className="mb-1 block text-sm font-medium text-gray-700">
              补充题目 ID（英文逗号分隔，可留空）
            </label>
            <textarea
              value={extraInput}
              onChange={(e) => setExtraInput(e.target.value)}
              rows={3}
              placeholder="用于只有 1 道题的关卡，从别处再挂几道题"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono"
            />
            <p className="mb-3 text-xs text-gray-400">
              不确定题 ID 时可以留空：系统会在该知识点的题里随机抽，题不够才会重复。
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  const titleEl = document.getElementById('sv-level-title') as HTMLInputElement | null;
                  const storyEl = document.getElementById('sv-level-story') as HTMLTextAreaElement | null;
                  const ids = extraInput.split(',').map((x) => x.trim()).filter(Boolean);
                  await saveLevel(editing, {
                    title: titleEl?.value?.trim() || editing.title,
                    extra_question_ids: ids,
                    checkpoint_story: storyEl?.value?.trim() || '',
                  });
                  setEditing(null);
                }}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
