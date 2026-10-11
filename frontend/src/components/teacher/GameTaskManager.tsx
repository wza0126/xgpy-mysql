import React, { useState, useEffect, useCallback, useRef } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 游戏化任务管理（教师端 · 「刷题打怪系统 → 任务系统」页）
 * ------------------------------------------------------------
 * 任务是「自动统计的学习指标 + 目标值 + 奖励」：学生达标后桌面任务中心亮红点，
 * 点进去一键领取。本页负责发布 / 编辑 / 启停 / 设适用班级。
 *
 * 指标口径与奖励发放全部由后端裁定（game-task-metrics.js / game-task.js），
 * 前端只负责配置与展示。
 */

const ICON_MAP: Record<string, string> = {
  star: 'fa-star',
  bolt: 'fa-bolt',
  book: 'fa-book',
  trophy: 'fa-trophy',
  check: 'fa-circle-check',
  target: 'fa-bullseye',
  sword: 'fa-khanda',
  clock: 'fa-clock',
  crown: 'fa-crown',
  coin: 'fa-coins',
  fire: 'fa-fire',
  code: 'fa-code',
  paw: 'fa-paw',
  medal: 'fa-medal',
};

const REWARD_LABEL: Record<string, string> = {
  points: '积分',
  internet_code: '上网码',
  app: '应用解锁',
  equipment: '装备',
};

interface MetricParam {
  key: string;
  label: string;
  type?: string;
  default?: any;
  options?: { value: string; label: string }[];
}
interface MetricDef {
  key: string;
  label: string;
  unit: string;
  hint: string;
  scope: 'daily' | 'total';
  series: string;
  params: MetricParam[];
}
interface SeriesDef {
  id: string;
  name: string;
  icon: string;
  color: string;
}
interface RewardItem {
  type: string;
  value: number;
  target_id?: string | null;
}
interface GameTask {
  id: string;
  name: string;
  description: string;
  icon: string;
  task_type: 'daily' | 'once';
  metric: string;
  metric_params: any;
  target_value: number;
  unit: string;
  rewards: RewardItem[];
  class_ids: string[] | null;
  is_active: boolean;
  sort_order: number;
}
interface Meta {
  metrics: MetricDef[];
  series: SeriesDef[];
  rewardTypes: { type: string; label: string }[];
  classes: { id: string; name: string }[];
  apps: { id: string; name: string }[];
  equipments: { id: string; name: string; icon: string }[];
}

const emptyForm = (): GameTask => ({
  id: '',
  name: '',
  description: '',
  icon: 'star',
  task_type: 'daily',
  metric: 'answer_correct',
  metric_params: null,
  target_value: 100,
  unit: '题',
  rewards: [{ type: 'points', value: 10 }],
  class_ids: null,
  is_active: true,
  sort_order: 100,
});

export const GameTaskManager: React.FC = () => {
  const [tasks, setTasks] = useState<GameTask[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<GameTask>(emptyForm);
  // 多选与批量操作
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchWorking, setBatchWorking] = useState(false);
  const headCbRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m, s] = await Promise.all([
        backendClient.get('/api/teacher/game-tasks'),
        backendClient.get('/api/teacher/game-tasks/meta'),
        backendClient.get('/api/teacher/game-tasks/stats'),
      ]);
      setTasks((t.data as GameTask[]) || []);
      setMeta((m.data as Meta) || null);
      setStats((s.data as Record<string, number>) || {});
    } catch (e) {
      console.error('加载任务失败:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 任务列表刷新后，剔除已不存在的选中项（保持选择稳定）
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(tasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const someSelected = selected.size > 0 && !allSelected;

  // 全选框的「半选」态只能用 DOM 属性设置
  useEffect(() => {
    if (headCbRef.current) headCbRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(() => (allSelected ? new Set<string>() : new Set(tasks.map((t) => t.id))));

  const clearSelection = () => setSelected(new Set<string>());

  const metricDef = (key: string): MetricDef | undefined => {
    if (!meta) return undefined;
    return meta.metrics.find((m) => m.key === key);
  };

  /** 某任务类型可选的指标（每日→当日口径 / 一次性→累计口径） */
  const metricsForType = (tt: 'daily' | 'once'): MetricDef[] => {
    if (!meta) return [];
    const want = tt === 'once' ? 'total' : 'daily';
    return meta.metrics.filter((m) => m.scope === want);
  };

  /** 指标归属的系列（由指标派生） */
  const seriesOf = (metricKey: string): SeriesDef | undefined => {
    const def = metricDef(metricKey);
    if (!def || !meta) return undefined;
    return meta.series.find((s) => s.id === def.series);
  };

  const condText = (t: GameTask): string => {
    const def = metricDef(t.metric);
    if (t.metric === 'accuracy' && t.metric_params) {
      return `正确率 ≥${t.metric_params.rate}% 且作答 ≥${t.metric_params.min_count} 题`;
    }
    const base = def ? def.label : t.metric;
    return `${base} ≥ ${t.target_value}${t.unit}`;
  };

  const rewardText = (r: RewardItem): string => {
    if (r.type === 'points') return `+${r.value} 积分`;
    if (r.type === 'internet_code') return `上网码 ×${r.value}`;
    if (r.type === 'app') {
      const a = meta ? meta.apps.find((x) => x.id === r.target_id) : null;
      return `解锁应用「${a ? a.name : '未指定'}」`;
    }
    if (r.type === 'equipment') {
      const e = meta ? meta.equipments.find((x) => x.id === r.target_id) : null;
      return `${e ? (e.icon || '') + e.name : '装备'} ×${r.value}`;
    }
    return r.type;
  };

  const openCreate = () => {
    setForm(emptyForm());
    setIsEdit(false);
    setShowForm(true);
  };

  const openEdit = (t: GameTask) => {
    setForm({
      ...t,
      metric_params: t.metric_params || null,
      rewards: t.rewards.length ? t.rewards.map((r) => ({ ...r })) : [{ type: 'points', value: 10 }],
      class_ids: t.class_ids ? [...t.class_ids] : null,
    });
    setIsEdit(true);
    setShowForm(true);
  };

  const onMetricChange = (key: string) => {
    const def = metricDef(key);
    setForm((f) => {
      let params: any = null;
      if (def && def.params.length) {
        params = {};
        def.params.forEach((p) => {
          params[p.key] = p.default;
        });
      }
      // 保留已填的 kind 等参数（切换指标时按新指标默认值重置）
      return { ...f, metric: key, unit: def ? def.unit : f.unit, metric_params: params };
    });
  };

  /** 切换「每日 / 一次性」时，若当前指标口径不匹配，自动切到该类型的第一个指标 */
  const onTypeChange = (tt: 'daily' | 'once') => {
    setForm((f) => {
      const def = metricDef(f.metric);
      const want = tt === 'once' ? 'total' : 'daily';
      if (def && def.scope === want) return { ...f, task_type: tt };
      const first = metricsForType(tt)[0];
      if (!first) return { ...f, task_type: tt };
      let params: any = null;
      if (first.params.length) {
        params = {};
        first.params.forEach((p) => { params[p.key] = p.default; });
      }
      return { ...f, task_type: tt, metric: first.key, unit: first.unit, metric_params: params };
    });
  };

  const addReward = () => setForm((f) => ({ ...f, rewards: [...f.rewards, { type: 'points', value: 10 }] }));
  const updReward = (i: number, patch: Partial<RewardItem>) =>
    setForm((f) => ({ ...f, rewards: f.rewards.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const delReward = (i: number) =>
    setForm((f) => ({ ...f, rewards: f.rewards.filter((_, idx) => idx !== i) }));

  const toggleClass = (cid: string) =>
    setForm((f) => {
      const cur = f.class_ids || [];
      const next = cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid];
      return { ...f, class_ids: next.length ? next : null };
    });

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert('请填写任务名称');
      return;
    }
    if (!form.rewards.length) {
      alert('至少配置一项奖励');
      return;
    }
    if (form.rewards.some((r) => (r.type === 'app' || r.type === 'equipment') && !r.target_id)) {
      alert('应用解锁 / 装备奖励需要选择具体对象');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        icon: form.icon,
        task_type: form.task_type,
        metric: form.metric,
        metric_params: form.metric_params,
        target_value: form.target_value,
        unit: form.unit,
        rewards: form.rewards,
        class_ids: form.class_ids,
        is_active: form.is_active,
        sort_order: form.sort_order,
      };
      if (isEdit) {
        await backendClient.put(`/api/teacher/game-tasks/${form.id}`, payload);
      } else {
        await backendClient.post('/api/teacher/game-tasks', payload);
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      alert('保存失败：' + (e?.message || e));
    }
    setSaving(false);
  };

  const handleToggle = async (t: GameTask) => {
    try {
      await backendClient.put(`/api/teacher/game-tasks/${t.id}`, { is_active: !t.is_active });
      await load();
    } catch (e: any) {
      alert('操作失败：' + (e?.message || e));
    }
  };

  const handleDelete = async (t: GameTask) => {
    if (!confirm(`确定删除任务「${t.name}」吗？其历史领取记录也会一并清除。\n如果只是暂时不想发布，建议改用「停用」。`)) return;
    try {
      await backendClient.delete(`/api/teacher/game-tasks/${t.id}`);
      await load();
    } catch (e: any) {
      alert('删除失败：' + (e?.message || e));
    }
  };

  const handleBatchToggle = async (isActive: boolean) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBatchWorking(true);
    try {
      const r: any = await backendClient.post('/api/teacher/game-tasks/batch-update', { ids, is_active: isActive });
      await load();
      clearSelection();
      alert(`已${isActive ? '启用' : '停用'} ${(r?.data && r.data.affected) ?? ids.length} 个任务`);
    } catch (e: any) {
      alert('批量操作失败：' + (e?.message || e));
    }
    setBatchWorking(false);
  };

  const handleBatchDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const names = tasks.filter((t) => selected.has(t.id)).map((t) => `「${t.name}」`).join('、');
    if (!confirm(`确定删除选中的 ${ids.length} 个任务吗？\n${names}\n\n其历史领取记录也会一并清除。\n如果只是暂时不想发布，建议改用「批量停用」。`)) return;
    setBatchWorking(true);
    try {
      const r: any = await backendClient.post('/api/teacher/game-tasks/batch-delete', { ids });
      await load();
      clearSelection();
      alert(`已删除 ${(r?.data && r.data.affected) ?? ids.length} 个任务`);
    } catch (e: any) {
      alert('批量删除失败：' + (e?.message || e));
    }
    setBatchWorking(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <i className="fa-solid fa-circle-notch fa-spin text-2xl text-purple-500"></i>
      </div>
    );
  }

  const activeDef = metricDef(form.metric);

  return (
    <div>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <i className="fa-solid fa-clipboard-list text-purple-600"></i>任务系统
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            学生达标后，桌面「任务中心」会亮起红点提示，点进去即可一键领取奖励。
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm flex-shrink-0"
        >
          <i className="fa-solid fa-plus mr-1"></i>新建任务
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-4 py-2.5 bg-purple-50 border border-purple-200 rounded-lg flex-wrap">
          <span className="text-sm text-purple-800 mr-1">
            已选 <b>{selected.size}</b> 个任务
          </span>
          <button
            onClick={() => handleBatchToggle(true)}
            disabled={batchWorking}
            className="px-3 py-1.5 text-sm rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
          >
            <i className="fa-solid fa-circle-check mr-1"></i>批量启用
          </button>
          <button
            onClick={() => handleBatchToggle(false)}
            disabled={batchWorking}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-500 text-white hover:bg-gray-600 disabled:opacity-50"
          >
            <i className="fa-solid fa-circle-pause mr-1"></i>批量停用
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={batchWorking}
            className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
          >
            <i className="fa-solid fa-trash mr-1"></i>批量删除
          </button>
          <div className="flex-1"></div>
          <button
            onClick={clearSelection}
            disabled={batchWorking}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            取消选择
          </button>
          {batchWorking && <i className="fa-solid fa-circle-notch fa-spin text-purple-500"></i>}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <i className="fa-solid fa-clipboard-list text-3xl mb-2"></i>
          <p>暂无任务，点击「新建任务」创建</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 w-10">
                  <input
                    ref={headCbRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="cursor-pointer align-middle"
                    title={allSelected ? '取消全选' : '全选'}
                  />
                </th>
                <th className="px-3 py-2 text-left">任务</th>
                <th className="px-3 py-2 text-left">类型</th>
                <th className="px-3 py-2 text-left">系列</th>
                <th className="px-3 py-2 text-left">达成条件</th>
                <th className="px-3 py-2 text-left">奖励</th>
                <th className="px-3 py-2 text-left">适用班级</th>
                <th className="px-3 py-2 text-left">今日领取</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className={`border-t border-gray-100 align-top ${selected.has(t.id) ? 'bg-purple-50/50' : ''}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleOne(t.id)}
                      className="cursor-pointer align-middle"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
                        <i className={`fa-solid ${ICON_MAP[t.icon] || 'fa-star'} text-xs`}></i>
                      </span>
                      <div>
                        <div className="text-gray-800 font-medium">{t.name}</div>
                        {t.description && <div className="text-xs text-gray-400">{t.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 text-xs rounded ${t.task_type === 'daily' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                      {t.task_type === 'daily' ? '每日' : '一次性'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {(() => {
                      const s = seriesOf(t.metric);
                      return s
                        ? <span className="px-2 py-0.5 text-xs rounded whitespace-nowrap" style={{ background: s.color + '1a', color: s.color }}>{s.name}</span>
                        : <span className="text-xs text-gray-300">—</span>;
                    })()}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{condText(t)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-0.5">
                      {t.rewards.map((r, i) => (
                        <span key={i} className="text-xs text-gray-700">· {rewardText(r)}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-gray-600 text-xs">
                    {t.class_ids && t.class_ids.length
                      ? t.class_ids
                          .map((cid) => (meta ? meta.classes.find((c) => c.id === cid)?.name || '已删除班级' : cid))
                          .join('、')
                      : '全部班级'}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{stats[t.id] || 0} 人</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => handleToggle(t)}
                      className={`px-2 py-0.5 text-xs rounded cursor-pointer ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}
                      title={t.is_active ? '点击停用' : '点击启用'}
                    >
                      {t.is_active ? '启用中' : '已停用'}
                    </button>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <button onClick={() => openEdit(t)} className="text-blue-500 hover:text-blue-700 mr-3">
                      <i className="fa-solid fa-edit"></i>编辑
                    </button>
                    <button onClick={() => handleDelete(t)} className="text-red-500 hover:text-red-700">
                      <i className="fa-solid fa-trash"></i>删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="mt-6 p-5 bg-purple-50 border border-purple-200 rounded-xl">
          <h4 className="font-semibold text-purple-800 mb-4">
            {isEdit ? '编辑任务' : '新建任务'}
          </h4>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">任务名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：每日百题达人"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">展示图标</label>
              <select
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              >
                {Object.keys(ICON_MAP).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">任务说明（学生端展示）</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="如：今日做对 100 道题"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">任务类型</label>
              <div className="flex gap-2">
                {(['daily', 'once'] as const).map((tt) => (
                  <label key={tt} className={`flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer text-sm ${form.task_type === tt ? 'border-purple-400 bg-white text-purple-700 font-medium' : 'border-gray-300 text-gray-600'}`}>
                    <input type="radio" checked={form.task_type === tt} onChange={() => onTypeChange(tt)} />
                    {tt === 'daily' ? '每日重复（0 点重置）' : '一次性成就（永不重置）'}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {form.task_type === 'once'
                  ? '成就用「累计口径」指标，达成后永久点亮。'
                  : '每日任务用「当日口径」指标，0 点重置。'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">排序（小的靠前）</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">统计指标</label>
                {(() => {
                  const s = seriesOf(form.metric);
                  return s
                    ? <span className="px-2 py-0.5 text-xs rounded" style={{ background: s.color + '1a', color: s.color }}>系列：{s.name}</span>
                    : null;
                })()}
              </div>
              <select
                value={form.metric}
                onChange={(e) => onMetricChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              >
                {metricsForType(form.task_type).map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              {activeDef && <p className="text-xs text-gray-500 mt-1">{activeDef.hint}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">达成目标值</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={form.target_value}
                  onChange={(e) => setForm({ ...form, target_value: parseFloat(e.target.value) || 0 })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
                <span className="text-gray-500 text-sm w-8">{form.unit || '—'}</span>
              </div>
            </div>
          </div>

          {activeDef && activeDef.params.length > 0 && (
            <div className="grid grid-cols-2 gap-4 mb-4 p-3 bg-white rounded-lg border border-purple-100">
              {activeDef.params.map((p) => (
                <div key={p.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{p.label}</label>
                  {p.options ? (
                    <select
                      value={(form.metric_params && form.metric_params[p.key]) ?? p.default}
                      onChange={(e) => setForm({ ...form, metric_params: { ...(form.metric_params || {}), [p.key]: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    >
                      {p.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      value={(form.metric_params && form.metric_params[p.key]) ?? p.default}
                      onChange={(e) => setForm({ ...form, metric_params: { ...(form.metric_params || {}), [p.key]: parseFloat(e.target.value) || 0 } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                奖励（可组合，如：积分 + 上网码）
              </label>
              <button onClick={addReward} className="text-purple-600 hover:text-purple-800 text-sm">
                <i className="fa-solid fa-plus mr-1"></i>添加奖励
              </button>
            </div>
            <div className="space-y-2">
              {form.rewards.map((r, i) => (
                <div key={i} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200">
                  <select
                    value={r.type}
                    onChange={(e) => updReward(i, { type: e.target.value, target_id: null })}
                    className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm w-32"
                  >
                    {Object.keys(REWARD_LABEL).map((t) => (
                      <option key={t} value={t}>{REWARD_LABEL[t]}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={r.value}
                    onChange={(e) => updReward(i, { value: parseInt(e.target.value) || 0 })}
                    className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm w-24"
                    placeholder="数量"
                  />
                  {r.type === 'app' && (
                    <select
                      value={r.target_id || ''}
                      onChange={(e) => updReward(i, { target_id: e.target.value || null })}
                      className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-1"
                    >
                      <option value="">选择应用…</option>
                      {(meta?.apps || []).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  )}
                  {r.type === 'equipment' && (
                    <select
                      value={r.target_id || ''}
                      onChange={(e) => updReward(i, { target_id: e.target.value || null })}
                      className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-1"
                    >
                      <option value="">选择装备…</option>
                      {(meta?.equipments || []).map((a) => (
                        <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                      ))}
                    </select>
                  )}
                  <button onClick={() => delReward(i)} className="text-red-400 hover:text-red-600 px-2">
                    <i className="fa-solid fa-times"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              适用班级（不选 = 全部班级）
            </label>
            <div className="flex flex-wrap gap-2">
              {(meta?.classes || []).map((c) => {
                const on = !!(form.class_ids && form.class_ids.includes(c.id));
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleClass(c.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${on ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-600 border-gray-300 hover:border-purple-300'}`}
                  >
                    {on && <i className="fa-solid fa-check mr-1"></i>}
                    {c.name}
                  </button>
                );
              })}
              {(!meta || meta.classes.length === 0) && <span className="text-sm text-gray-400">暂无班级</span>}
            </div>
          </div>

          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              立即启用（启用后学生端可见）
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-white"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50"
            >
              {saving ? <i className="fa-solid fa-spinner fa-spin mr-1"></i> : <i className="fa-solid fa-save mr-1"></i>}
              {isEdit ? '保存修改' : '保存并发布'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameTaskManager;
