import React, { useState, useEffect, useMemo } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 奖励发放（教师端 · 「通知管理」页）
 * ------------------------------------------------------------
 * 按「指标筛选条件」圈定学生 → 发放积分 / 上网码 / 装备 → 同时给学生发一条通知。
 * 指标口径与发放全部由后端裁定（game-task-metrics.js / game-task.js：
 *   POST /api/teacher/rewards/grant，dry_run=true 仅预览）。
 */

interface ClassRow { id: string; name: string; }
interface StudentRow { id: string; username: string; real_name: string; class_id: string; }

interface MetricParam {
  key: string; label: string; type?: string; default?: any;
  options?: { value: string; label: string }[];
}
interface MetricDef {
  key: string; label: string; unit: string; hint: string;
  scope: 'daily' | 'total'; series: string; params: MetricParam[];
}
interface EquipRow { id: string; name: string; icon: string; }

interface Condition { metric: string; op: string; value: number; params: Record<string, any>; }
interface RewardRow { type: string; value: number; target_id: string | null; }

interface PreviewStudent {
  id: string; username: string; real_name: string; class_id: string;
  reasons: string[];
  checks: { label: string; value: number; pass: boolean; error: string | null }[];
}
interface Preview {
  candidates: number; matched_count: number; logic: string;
  condition_text: string; matched: PreviewStudent[];
}

interface GrantDetail {
  student_id: string;
  real_name: string;
  granted: { type: string; value: number; label?: string; codes?: string[] }[];
}

const OPS = [
  { value: 'gte', label: '≥' },
  { value: 'gt', label: '>' },
  { value: 'lte', label: '≤' },
  { value: 'lt', label: '<' },
  { value: 'eq', label: '=' },
];

const REWARD_TYPES = [
  { type: 'points', label: '积分' },
  { type: 'internet_code', label: '上网码' },
  { type: 'equipment', label: '装备' },
];

const emptyCondition = (metric: string, def?: MetricDef): Condition => {
  const params: Record<string, any> = {};
  (def?.params || []).forEach((p) => { params[p.key] = p.default; });
  return { metric, op: 'gte', value: 10, params };
};

export const RewardGrantModal: React.FC<{
  open: boolean;
  onClose: () => void;
  classes: ClassRow[];
  onGranted?: () => void;
}> = ({ open, onClose, classes, onGranted }) => {
  const [metrics, setMetrics] = useState<MetricDef[]>([]);
  const [equipments, setEquipments] = useState<EquipRow[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);

  const [selClasses, setSelClasses] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selStudents, setSelStudents] = useState<string[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [rewards, setRewards] = useState<RewardRow[]>([{ type: 'points', value: 10, target_id: null }]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // 发放成功后回写的逐人明细（含上网码），便于老师核对 / 代为转达
  const [grantResult, setGrantResult] = useState<GrantDetail[] | null>(null);

  // 打开时拉取指标 / 装备元数据
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setMetaLoading(true);
      try {
        const r: any = await backendClient.get('/api/teacher/game-tasks/meta');
        if (!alive) return;
        const m = (r?.data?.metrics || []) as MetricDef[];
        setMetrics(m);
        setEquipments((r?.data?.equipments || []) as EquipRow[]);
        // 默认给一条「累计掌握题数」条件，贴近"一次性任务指标"用法
        setConditions((prev) => (prev.length ? prev : [emptyCondition(m.find((x) => x.key === 'total_mastered')?.key || (m[0] && m[0].key) || '', m.find((x) => x.key === 'total_mastered') || m[0])]));
      } catch {
        /* ignore */
      } finally {
        if (alive) setMetaLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open]);

  // 选中班级变化 → 拉取候选学生
  useEffect(() => {
    if (!open) return;
    if (!selClasses.length) { setStudents([]); setSelStudents([]); return; }
    let alive = true;
    (async () => {
      setLoadingStudents(true);
      try {
        const lists = await Promise.all(selClasses.map((cid) =>
          backendClient.from('profiles').select('id, username, real_name, class_id').eq('class_id', cid).eq('role', 'student')
        ));
        if (!alive) return;
        const merged: StudentRow[] = [];
        lists.forEach((r: any) => { (r?.data || []).forEach((s: StudentRow) => merged.push(s)); });
        merged.sort((a, b) => (a.class_id + a.username).localeCompare(b.class_id + b.username));
        setStudents(merged);
        setSelStudents((prev) => prev.filter((id) => merged.some((s) => s.id === id)));
      } catch {
        if (alive) setStudents([]);
      } finally {
        if (alive) setLoadingStudents(false);
      }
    })();
    return () => { alive = false; };
  }, [open, selClasses]);

  // 条件 / 奖励 / 范围变化时，作废旧预览（避免"看到旧名单却按新配置发放"）
  useEffect(() => { setPreview(null); }, [logic, conditions, rewards, selClasses, selStudents, title, content]);

  const metricDef = (key: string) => metrics.find((m) => m.key === key);

  const toggleClass = (cid: string) =>
    setSelClasses((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));

  const toggleStudent = (sid: string) =>
    setSelStudents((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));

  const addCondition = () => {
    const def = metrics.find((m) => m.key === 'total_mastered') || metrics[0];
    setConditions((prev) => [...prev, emptyCondition(def?.key || '', def)]);
  };
  const updCondition = (i: number, patch: Partial<Condition>) =>
    setConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const onConditionMetric = (i: number, key: string) => {
    const def = metricDef(key);
    const params: Record<string, any> = {};
    (def?.params || []).forEach((p) => { params[p.key] = p.default; });
    updCondition(i, { metric: key, params });
  };
  const delCondition = (i: number) => setConditions((prev) => prev.filter((_, idx) => idx !== i));

  const addReward = () => setRewards((prev) => [...prev, { type: 'points', value: 10, target_id: null }]);
  const updReward = (i: number, patch: Partial<RewardRow>) =>
    setRewards((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const delReward = (i: number) => setRewards((prev) => prev.filter((_, idx) => idx !== i));

  const canPreview = selClasses.length > 0 || selStudents.length > 0;

  const buildPayload = (dryRun: boolean) => ({
    dry_run: dryRun,
    scope: { class_ids: selClasses, student_ids: selStudents },
    logic,
    conditions: conditions.map((c) => ({ metric: c.metric, op: c.op, value: c.value, params: c.params })),
    rewards,
    title,
    content,
  });

  const doPreview = async () => {
    if (!canPreview) { setMsg({ kind: 'err', text: '请先选择班级或学生' }); return; }
    setBusy(true); setMsg(null); setGrantResult(null);
    try {
      const r: any = await backendClient.post('/api/teacher/rewards/grant', buildPayload(true));
      setPreview((r?.data || null) as Preview);
    } catch (e: any) {
      setMsg({ kind: 'err', text: '预览失败：' + (e?.message || e) });
      setPreview(null);
    }
    setBusy(false);
  };

  const doGrant = async () => {
    if (!canPreview) { setMsg({ kind: 'err', text: '请先选择班级或学生' }); return; }
    if (!rewards.length) { setMsg({ kind: 'err', text: '至少配置一项奖励' }); return; }
    if (rewards.some((r) => r.type === 'equipment' && !r.target_id)) {
      setMsg({ kind: 'err', text: '装备奖励需要选择具体装备' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      // 未预览则先跑一次预览拿名单，供确认文案使用
      let pv = preview;
      if (!pv) {
        const pr: any = await backendClient.post('/api/teacher/rewards/grant', buildPayload(true));
        pv = (pr?.data || null) as Preview;
        setPreview(pv);
      }
      const n = pv?.matched_count || 0;
      if (!n) { setMsg({ kind: 'err', text: '没有学生符合条件' }); setBusy(false); return; }
      if (!confirm(`将为 ${n} 名学生发放奖励，并同时发送通知。\n\n确定继续吗？`)) { setBusy(false); return; }

      const r: any = await backendClient.post('/api/teacher/rewards/grant', buildPayload(false));
      const cnt = r?.data?.granted_count ?? 0;
      setMsg({ kind: 'ok', text: `已向 ${cnt} 名学生发放奖励并发送通知（上网码已随通知送达，学生可在通知中心查看）` });
      setGrantResult((r?.data?.granted || []) as GrantDetail[]);
      setPreview(null);
      onGranted?.();
    } catch (e: any) {
      setMsg({ kind: 'err', text: '发放失败：' + (e?.message || e) });
    }
    setBusy(false);
  };

  const rewardText = (r: RewardRow) => {
    const n = Math.max(1, Math.round(r.value || 0));
    if (r.type === 'points') return `+${n} 积分`;
    if (r.type === 'internet_code') return `上网码 ×${n}`;
    if (r.type === 'equipment') {
      const e = equipments.find((x) => x.id === r.target_id);
      return `${e ? (e.icon || '') + e.name : '装备'} ×${n}`;
    }
    return r.type;
  };

  const condPreviewText = useMemo(() => {
    if (!conditions.length) return '（未设筛选条件，按所选范围）';
    return conditions.map((c) => {
      const d = metricDef(c.metric);
      const name = d ? d.label : c.metric;
      let extra = '';
      if (c.params && c.params.kind === 'wps') extra = '（WPS）';
      else if (c.params && c.params.kind === 'access') extra = '（Access）';
      const op = OPS.find((o) => o.value === c.op)?.label || '≥';
      return `${name}${extra} ${op} ${c.value}${d ? (d.unit || '') : ''}`;
    }).join(logic === 'or' ? ' 或 ' : ' 且 ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditions, logic, metrics]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[9998]" onClick={busy ? undefined : onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-[9999] p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
            <div>
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <i className="fa-solid fa-gift text-amber-500"></i>奖励发放
              </h2>
              <p className="text-sm text-gray-500 mt-1">按学习指标筛选学生 → 发放积分 / 上网码 / 装备，并同时发送通知</p>
            </div>
            <button onClick={busy ? undefined : onClose} className="text-gray-400 hover:text-gray-600">
              <i className="fa-solid fa-times text-xl"></i>
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* 1. 发放范围 */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                <span className="inline-flex w-5 h-5 mr-1 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs">1</span>
                发放范围（选择班级，可再勾选具体学生；不勾学生 = 全班）
              </h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {classes.map((c) => {
                  const on = selClasses.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleClass(c.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${on ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'}`}
                    >
                      {on && <i className="fa-solid fa-check mr-1"></i>}{c.name}
                    </button>
                  );
                })}
                {!classes.length && <span className="text-sm text-gray-400">暂无班级</span>}
              </div>

              {selClasses.length > 0 && (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">
                      候选学生 {students.length} 人
                      {selStudents.length > 0 && <span className="text-blue-600 ml-1">（已指定 {selStudents.length} 人）</span>}
                    </span>
                    {students.length > 0 && (
                      <button
                        onClick={() => setSelStudents(selStudents.length === students.length ? [] : students.map((s) => s.id))}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        {selStudents.length === students.length ? '清空指定（发给全班）' : '全选指定'}
                      </button>
                    )}
                  </div>
                  {loadingStudents ? (
                    <div className="text-center py-3 text-gray-400 text-sm"><i className="fa-solid fa-circle-notch fa-spin mr-1"></i>加载学生…</div>
                  ) : students.length ? (
                    <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
                      {students.map((s) => (
                        <label key={s.id} className="flex items-center gap-1.5 p-1.5 rounded hover:bg-white cursor-pointer text-sm">
                          <input type="checkbox" checked={selStudents.includes(s.id)} onChange={() => toggleStudent(s.id)} className="w-3.5 h-3.5 text-blue-500" />
                          <span className="truncate" title={`${s.real_name} (${s.username})`}>{s.real_name || s.username}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-3 text-gray-400 text-sm">该班级暂无学生</div>
                  )}
                </div>
              )}
            </section>

            {/* 2. 筛选条件 */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  <span className="inline-flex w-5 h-5 mr-1 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs">2</span>
                  筛选条件（与/或组合，指标口径同"一次性任务"）
                </h3>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                    {(['and', 'or'] as const).map((l) => (
                      <button
                        key={l}
                        onClick={() => setLogic(l)}
                        className={`px-3 py-1 ${logic === l ? 'bg-blue-500 text-white' : 'bg-white text-gray-600'}`}
                      >
                        {l === 'and' ? '全部满足(与)' : '任一满足(或)'}
                      </button>
                    ))}
                  </div>
                  <button onClick={addCondition} className="text-blue-600 hover:text-blue-800 text-sm whitespace-nowrap">
                    <i className="fa-solid fa-plus mr-1"></i>加条件
                  </button>
                </div>
              </div>

              {conditions.length === 0 ? (
                <p className="text-xs text-gray-400 mb-2">未设条件 → 所选范围内全部学生都会获得奖励。</p>
              ) : (
                <div className="space-y-2">
                  {conditions.map((c, i) => {
                    const def = metricDef(c.metric);
                    return (
                      <div key={i} className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200 flex-wrap">
                        <select
                          value={c.metric}
                          onChange={(e) => onConditionMetric(i, e.target.value)}
                          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-1 min-w-[180px]"
                        >
                          {metrics.map((m) => (
                            <option key={m.key} value={m.key}>{m.scope === 'total' ? '累计' : '当日'} · {m.label}</option>
                          ))}
                        </select>
                        <select
                          value={c.op}
                          onChange={(e) => updCondition(i, { op: e.target.value })}
                          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm w-16"
                        >
                          {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input
                          type="number"
                          value={c.value}
                          onChange={(e) => updCondition(i, { value: Number(e.target.value) })}
                          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm w-24"
                        />
                        <span className="text-xs text-gray-500 w-8">{def ? (def.unit || '—') : '—'}</span>
                        {(def?.params || []).map((p) => (
                          <select
                            key={p.key}
                            value={c.params?.[p.key] ?? p.default}
                            onChange={(e) => updCondition(i, { params: { ...(c.params || {}), [p.key]: e.target.value } })}
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                            title={p.label}
                          >
                            {(p.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ))}
                        <button onClick={() => delCondition(i)} className="text-red-400 hover:text-red-600 px-1">
                          <i className="fa-solid fa-times"></i>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2">条件：{condPreviewText}</p>
            </section>

            {/* 3. 奖励 */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  <span className="inline-flex w-5 h-5 mr-1 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs">3</span>
                  奖励（可组合，如：积分 + 上网码 + 装备）
                </h3>
                <button onClick={addReward} className="text-blue-600 hover:text-blue-800 text-sm">
                  <i className="fa-solid fa-plus mr-1"></i>加奖励
                </button>
              </div>
              <div className="space-y-2">
                {rewards.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200 flex-wrap">
                    <select
                      value={r.type}
                      onChange={(e) => updReward(i, { type: e.target.value, target_id: null })}
                      className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm w-28"
                    >
                      {REWARD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={r.value}
                      onChange={(e) => updReward(i, { value: Number(e.target.value) })}
                      className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm w-24"
                      placeholder="数量"
                    />
                    {r.type === 'equipment' && (
                      <select
                        value={r.target_id || ''}
                        onChange={(e) => updReward(i, { target_id: e.target.value || null })}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-1 min-w-[160px]"
                      >
                        <option value="">选择装备…</option>
                        {equipments.map((eq) => <option key={eq.id} value={eq.id}>{eq.icon} {eq.name}</option>)}
                      </select>
                    )}
                    <button onClick={() => delReward(i)} className="text-red-400 hover:text-red-600 px-1">
                      <i className="fa-solid fa-times"></i>
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                每人发放：{rewards.length ? rewards.map(rewardText).join('、') : '—'}
              </p>
            </section>

            {/* 4. 通知文案 */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                <span className="inline-flex w-5 h-5 mr-1 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs">4</span>
                通知文案（发放的同时发送给学生）
              </h3>
              <div className="grid grid-cols-1 gap-2">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="通知标题（留空默认：🎁 奖励发放）"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="通知正文（可留空）。系统会自动附带「奖励物项」与「发放条件」"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm h-20 resize-none"
                />
              </div>
            </section>

            {msg && (
              <div className={`text-sm px-4 py-2.5 rounded-lg ${msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {msg.text}
              </div>
            )}

            {/* 发放结果里的上网码明细：学生已在通知中心看到，这里方便老师核对/备用转达 */}
            {grantResult && grantResult.some((d) => d.granted.some((g) => g.codes && g.codes.length)) && (
              <section className="border border-amber-200 bg-amber-50 rounded-xl p-4">
                <div className="text-sm text-amber-800 mb-2">
                  <i className="fa-solid fa-wifi mr-1"></i>本次发出的上网码
                  <span className="text-xs text-amber-600 ml-2">（已随通知送达学生，此处仅作核对 / 备用转达）</span>
                </div>
                <div className="max-h-40 overflow-y-auto bg-white rounded-lg border border-amber-100 divide-y divide-gray-100">
                  {grantResult.map((d) => {
                    const codes = d.granted.flatMap((g) => g.codes || []);
                    if (!codes.length) return null;
                    return (
                      <div key={d.student_id} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
                        <span className="font-medium text-gray-800 flex-none">{d.real_name || d.student_id}</span>
                        <span className="flex flex-wrap gap-1.5 justify-end">
                          {codes.map((c, i) => (
                            <span key={i} className="font-mono text-xs text-gray-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 select-all">{c}</span>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 预览结果 */}
            {preview && (
              <section className="border border-blue-200 bg-blue-50 rounded-xl p-4">
                <div className="text-sm text-blue-800 mb-2">
                  候选 <b>{preview.candidates}</b> 人 → 符合条件 <b className="text-blue-700">{preview.matched_count}</b> 人
                  <span className="text-xs text-blue-500 ml-2">（{preview.condition_text}）</span>
                </div>
                {preview.matched.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto bg-white rounded-lg border border-blue-100 divide-y divide-gray-100">
                    {preview.matched.map((s) => (
                      <div key={s.id} className="px-3 py-2 text-sm flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-medium text-gray-800">{s.real_name || s.username}</span>
                          <span className="text-xs text-gray-400 ml-1">{s.username}</span>
                        </div>
                        <div className="text-xs text-gray-500 text-right flex-1 min-w-0">
                          {s.checks.map((c, idx) => (
                            <div key={idx} className={c.pass ? 'text-green-600' : 'text-gray-400'}>
                              {c.label} — 实测 {c.value}{c.error ? `（${c.error}）` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">没有符合条件的学生</div>
                )}
              </section>
            )}
          </div>

          <div className="p-5 border-t border-gray-100 flex items-center justify-end gap-3 sticky bottom-0 bg-white">
            <button onClick={busy ? undefined : onClose} className="px-5 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
              取消
            </button>
            <button
              onClick={doPreview}
              disabled={busy || !canPreview}
              className="px-5 py-2.5 border border-blue-400 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
            >
              {busy ? <i className="fa-solid fa-circle-notch fa-spin mr-1"></i> : <i className="fa-solid fa-magnifying-glass mr-1"></i>}
              预览名单
            </button>
            <button
              onClick={doGrant}
              disabled={busy || !canPreview}
              className="px-5 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              {busy ? <i className="fa-solid fa-circle-notch fa-spin mr-1"></i> : <i className="fa-solid fa-gift mr-1"></i>}
              发放奖励并通知
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default RewardGrantModal;
