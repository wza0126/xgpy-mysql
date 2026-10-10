import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';
import { getAuthToken } from '../../utils/authToken';
import { CHAPTER_TAXONOMY } from '../../data/chapterTaxonomy';

/**
 * 教师端 · WPS 操作题录制
 * ============================================================
 * 目标是「题库录入方便」：
 *   1) 上传做好的「标准答案表」→ 自动解析 OOXML 生成评分点骨架（合并区/公式/数值/图表全自动认出）
 *   2) 骨架可继续在可视化面板里改分值、改标签；也可以直接编辑 JSON
 *   3) 模板文件上传后写进 spec.template，学生端一键下载
 *   4) 每一步预留 video_url（后期每步配演示视频）
 */

interface CheckDef {
  kind: string;
  label?: string;
  score?: number;
  [k: string]: any;
}

interface StepDef {
  id?: string;
  title: string;
  desc?: string;
  score: number;
  video_url?: string;
  checks: CheckDef[];
}

interface SpecDef {
  version: number;
  full_score: number;
  grader?: { sheet?: string };
  template?: { name?: string; path?: string; size?: number };
  steps: StepDef[];
}

interface Row {
  id: string;
  content: string;
  cluster_id: string | null;
  practice_enabled: number;
  wps_spec: any;
}

// 评分点类型 → 中文名 + 需要的字段（与后端 wps-grader.js 的 CHECKERS 一一对应）
const KIND_META: Record<string, { label: string; fields: { key: string; label: string; type: 'text' | 'number' | 'bool' | 'csv' }[] }> = {
  merged: { label: '合并单元格', fields: [{ key: 'range', label: '区域', type: 'text' }] },
  cell_text: { label: '单元格文本', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'text', label: '应填文字', type: 'text' }] },
  cell_value: { label: '单元格数值', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'value', label: '期望值', type: 'number' }, { key: 'tol', label: '容差', type: 'number' }] },
  cell_has_formula: { label: '必须使用公式', fields: [{ key: 'ref', label: '单元格', type: 'text' }] },
  cell_formula: { label: '公式内容一致', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'formula', label: '公式（不带=）', type: 'text' }] },
  formula_tokens: { label: '公式引用单元格', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'tokens', label: '须引用的单元格（逗号分隔）', type: 'csv' }] },
  sum_range: { label: 'SUM 求和且区间正确', fields: [{ key: 'ref', label: '结果单元格', type: 'text' }, { key: 'range', label: '求和区域', type: 'text' }] },
  range_formula: { label: '区域内全部使用公式', fields: [{ key: 'range', label: '区域', type: 'text' }] },
  range_values: { label: '区域内数值全部正确', fields: [{ key: 'range', label: '区域', type: 'text' }, { key: 'values', label: '期望值（逗号分隔，按从左到右/从上到下）', type: 'csv' }, { key: 'tol', label: '容差', type: 'number' }] },
  range_integer_display: { label: '区域内不保留小数', fields: [{ key: 'range', label: '区域', type: 'text' }] },
  integer_display: { label: '单元格不保留小数', fields: [{ key: 'ref', label: '单元格', type: 'text' }] },
  font: { label: '字体名称/加粗/字号', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'name', label: '字体名', type: 'text' }, { key: 'bold', label: '加粗', type: 'bool' }, { key: 'size', label: '字号', type: 'number' }] },
  align: { label: '水平对齐', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'horizontal', label: '对齐(center/left/right)', type: 'text' }] },
  number_format: { label: '数字格式小数位', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'decimals', label: '小数位', type: 'number' }, { key: 'mode', label: '判定(exact/atMost)', type: 'text' }] },
  chart: { label: '图表', fields: [{ key: 'chartType', label: '类型(bar/line/pie...)', type: 'text' }, { key: 'barDir', label: '柱形方向(col/bar)', type: 'text' }, { key: 'title', label: '标题', type: 'text' }, { key: 'catRange', label: '分类轴区域', type: 'text' }, { key: 'valRange', label: '数值轴区域', type: 'text' }] },
  sheet_exists: { label: '工作表存在', fields: [{ key: 'sheet', label: '工作表名', type: 'text' }] },
};

const emptyCheck = (kind: string): CheckDef => ({ kind, label: KIND_META[kind]?.label || kind, score: 1 });
const emptyStep = (i: number): StepDef => ({ id: 's' + (i + 1), title: '', desc: '', score: 1, video_url: '', checks: [emptyCheck('merged')] });

const defaultSpec = (): SpecDef => ({ version: 1, full_score: 10, grader: { sheet: 'Sheet1' }, steps: [emptyStep(0)] });

const parseSpec = (raw: any): SpecDef => {
  if (!raw) return defaultSpec();
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return defaultSpec(); } }
  if (!v || !Array.isArray(v.steps)) return defaultSpec();
  return {
    version: v.version || 1,
    full_score: Number(v.full_score) || 10,
    grader: v.grader || { sheet: 'Sheet1' },
    template: v.template || undefined,
    steps: v.steps.map((s: any, i: number) => ({
      id: s.id || 's' + (i + 1),
      title: s.title || '',
      desc: s.desc || '',
      score: Number(s.score) || 0,
      video_url: s.video_url || '',
      checks: Array.isArray(s.checks) ? s.checks.map((c: any) => ({ ...c })) : [],
    })),
  };
};

const stripHtml = (html: string) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

export const WpsOpManager: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [content, setContent] = useState('');
  const [cluster, setCluster] = useState('');
  const [practiceEnabled, setPracticeEnabled] = useState(true);
  const [spec, setSpec] = useState<SpecDef>(defaultSpec());
  const [specJson, setSpecJson] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [validation, setValidation] = useState<{ errors: string[]; warnings: string[]; total: number } | null>(null);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [inspectNote, setInspectNote] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const inspectRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await backendClient
        .from('questions')
        .select('*')
        .eq('type', 'wps_op')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.error || error.message || '加载失败');
      setRows((data as any[]) || []);
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '加载题库失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setSpecJson(JSON.stringify(spec, null, 2)); }, [spec]);

  const clusterOptions = useMemo(() => {
    const out: { primary: string; secondary: string; value: string }[] = [];
    CHAPTER_TAXONOMY.forEach((part) => {
      part.chapters.forEach((ch) => {
        if (ch.allowChapter) out.push({ primary: ch.name, secondary: '', value: ch.name });
        ch.sections.forEach((s) => out.push({ primary: ch.name, secondary: s, value: `${ch.name}/${s}` }));
      });
    });
    return out;
  }, []);

  const startNew = () => {
    setEditing({ id: '', content: '', cluster_id: null, practice_enabled: 1, wps_spec: null });
    setContent('');
    setCluster('');
    setPracticeEnabled(true);
    setSpec(defaultSpec());
    setValidation(null);
    setInspectNote('');
    setMsg(null);
  };

  const startEdit = (r: Row) => {
    setEditing(r);
    setContent(r.content || '');
    setCluster(r.cluster_id || '');
    setPracticeEnabled(Number(r.practice_enabled) === 1);
    setSpec(parseSpec(r.wps_spec));
    setValidation(null);
    setInspectNote('');
    setMsg(null);
  };

  // ---------- 评分点结构编辑 ----------
  const patchStep = (si: number, patch: Partial<StepDef>) => {
    setSpec((s) => ({ ...s, steps: s.steps.map((st, i) => (i === si ? { ...st, ...patch } : st)) }));
  };
  const addStep = () => setSpec((s) => ({ ...s, steps: [...s.steps, emptyStep(s.steps.length)] }));
  const delStep = (si: number) => setSpec((s) => ({ ...s, steps: s.steps.filter((_, i) => i !== si) }));

  const patchCheck = (si: number, ci: number, patch: Partial<CheckDef>) => {
    setSpec((s) => ({
      ...s,
      steps: s.steps.map((st, i) => (i === si
        ? { ...st, checks: st.checks.map((c, j) => (j === ci ? { ...c, ...patch } : c)) }
        : st)),
    }));
  };
  const addCheck = (si: number) => setSpec((s) => ({
    ...s, steps: s.steps.map((st, i) => (i === si ? { ...st, checks: [...st.checks, emptyCheck('cell_value')] } : st)),
  }));
  const delCheck = (si: number, ci: number) => setSpec((s) => ({
    ...s, steps: s.steps.map((st, i) => (i === si ? { ...st, checks: st.checks.filter((_, j) => j !== ci) } : st)),
  }));

  /** 把每个步骤的分值重算为"其评分点分值之和" */
  const recalcScores = () => {
    setSpec((s) => ({
      ...s,
      steps: s.steps.map((st) => ({ ...st, score: st.checks.reduce((a, c) => a + (Number(c.score) || 0), 0) })),
    }));
    setMsg({ type: 'ok', text: '已按评分点重算各步骤分值' });
  };

  /** 把总分等比缩放到满分（老师不用自己算） */
  const scaleToFull = () => {
    setSpec((s) => {
      const total = s.steps.reduce((a, st) => a + st.checks.reduce((b, c) => b + (Number(c.score) || 0), 0), 0);
      const full = Number(s.full_score) || 10;
      if (!total || Math.abs(total - full) < 1e-9) return s;
      const k = full / total;
      const steps = s.steps.map((st) => {
        const checks = st.checks.map((c) => ({ ...c, score: Math.round((Number(c.score) || 0) * k * 100) / 100 }));
        return { ...st, checks, score: Math.round(checks.reduce((a, c) => a + c.score, 0) * 100) / 100 };
      });
      return { ...s, steps };
    });
    setMsg({ type: 'ok', text: '已把评分点分值等比缩放到满分' });
  };

  // ---------- 文件上传 ----------
  const uploadFile = async (url: string, file: File) => {
    const token = getAuthToken();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_CONFIG.apiUrl}${url}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (res.status === 401) { const e: any = new Error('登录已失效，请重新登录'); e.isAuthError = true; throw e; }
    if (!res.ok) throw new Error(json?.error || `上传失败（${res.status}）`);
    return json?.data;
  };

  const onTemplatePicked = async (f: File | null) => {
    if (!f) return;
    setTemplateBusy(true);
    setMsg(null);
    try {
      const d = await uploadFile('/api/teacher/wps-op/template', f);
      setSpec((s) => ({ ...s, template: { name: d.name, path: d.path, size: d.size } }));
      setMsg({ type: 'ok', text: `模板已上传：${d.name}` });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.isAuthError ? '登录已失效，请重新登录' : (e?.message || '模板上传失败') });
    } finally {
      setTemplateBusy(false);
      if (templateRef.current) templateRef.current.value = '';
    }
  };

  const onInspectPicked = async (f: File | null) => {
    if (!f) return;
    setInspectBusy(true);
    setMsg(null);
    setInspectNote('');
    try {
      const d = await uploadFile('/api/teacher/wps-op/inspect', f);
      const sug = d?.suggested_spec;
      if (!sug || !Array.isArray(sug.steps) || !sug.steps.length) {
        setMsg({ type: 'err', text: '没能从这份文件里识别出可判分的内容（可能表格是空的）' });
        return;
      }
      const sh = d.summary?.sheets?.[0];
      const checks = sug.steps.reduce((a: number, s: any) => a + (s.checks || []).length, 0);
      setInspectNote(
        `识别到 ${sh?.merges?.length || 0} 个合并区、${(sh?.cells || []).filter((c: any) => c.formula).length} 个公式、`
        + `${sh?.charts?.length || 0} 个图表，已自动生成 ${sug.steps.length} 个步骤 / ${checks} 个评分点`
      );
      const parsed = parseSpec({ ...sug, full_score: spec.full_score || 10 });
      setSpec(parsed);
      setMsg({ type: 'ok', text: '已用标准答案生成评分点骨架，请核对分值与描述后保存' });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.isAuthError ? '登录已失效，请重新登录' : (e?.message || '解析失败') });
    } finally {
      setInspectBusy(false);
      if (inspectRef.current) inspectRef.current.value = '';
    }
  };

  // ---------- 校验与保存 ----------
  const validate = async () => {
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/teacher/wps-op/validate-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}) },
        body: JSON.stringify({ spec, full_score: spec.full_score }),
      });
      const json = await res.json();
      const d = json?.data || { errors: ['校验失败'], warnings: [], total: 0 };
      setValidation(d);
      if (!d.errors?.length) setMsg({ type: 'ok', text: `校验通过，评分点合计 ${d.total} 分` });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '校验请求失败' });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (!content.trim()) { setMsg({ type: 'err', text: '请填写题干' }); return; }
    if (!spec.steps.length) { setMsg({ type: 'err', text: '至少要有一个步骤' }); return; }
    const unlabeled = spec.steps.filter((s) => !s.title.trim());
    if (unlabeled.length) { setMsg({ type: 'err', text: '每个步骤都要填标题（学生端会显示）' }); return; }

    setSaving(true);
    setMsg(null);
    try {
      const payload: any = {
        type: 'wps_op',
        content: content.trim(),
        cluster_id: cluster || null,
        practice_enabled: practiceEnabled ? 1 : 0,
        wps_spec: spec,
        answers: JSON.stringify({ note: 'WPS 操作题由 wps_spec 判分，answers 列仅占位' }),
      };
      let err: any = null;
      if (editing.id) {
        const r = await backendClient.from('questions').update(payload).eq('id', editing.id);
        err = r.error;
      } else {
        const r = await backendClient.from('questions').insert(payload);
        err = r.error;
      }
      if (err) throw new Error(err.error || err.message || '保存失败');
      setMsg({ type: 'ok', text: '已保存' });
      await load();
      setEditing(null);
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: Row) => {
    if (!window.confirm('确定删除这道操作题？已产生的学生提交记录会保留。')) return;
    try {
      const { error } = await backendClient.from('questions').delete().eq('id', r.id);
      if (error) throw new Error(error.error || error.message);
      await load();
      setMsg({ type: 'ok', text: '已删除' });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '删除失败' });
    }
  };

  // ---------- 列表视图 ----------
  if (!editing) {
    return (
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">WPS 操作题</h2>
            <p className="mt-1 text-xs text-gray-500">
              学测操作题（每题 10 分、分步给分）。上传做好的「标准答案表」可自动生成评分点，再改分值与描述即可。
            </p>
          </div>
          <button onClick={startNew} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            <i className="fas fa-plus mr-1" /> 新建操作题
          </button>
        </div>

        {msg && (
          <div className={`mb-3 rounded-lg p-2.5 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white py-14 text-center text-sm text-gray-400">
            还没有操作题。点右上角「新建操作题」，或在编辑页上传标准答案表自动生成评分点。
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const sp = parseSpec(r.wps_spec);
              return (
                <div key={r.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        {sp.full_score} 分 · {sp.steps.length} 步
                      </span>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                        {r.cluster_id || '未分类'}
                      </span>
                      <span className={`rounded px-2 py-0.5 text-[11px] ${Number(r.practice_enabled) === 1 ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>
                        {Number(r.practice_enabled) === 1 ? '学生可练' : '已下架'}
                      </span>
                      {sp.template?.name && <span className="text-[11px] text-gray-400">模板：{sp.template.name}</span>}
                    </div>
                    <div className="line-clamp-2 text-sm text-gray-700">{stripHtml(r.content)}</div>
                  </div>
                  <div className="flex flex-none gap-2">
                    <button onClick={() => startEdit(r)} className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50">编辑</button>
                    <button onClick={() => remove(r)} className="rounded border border-rose-200 px-3 py-1 text-xs text-rose-600 hover:bg-rose-50">删除</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---------- 编辑视图 ----------
  const totalCheckScore = spec.steps.reduce((a, st) => a + st.checks.reduce((b, c) => b + (Number(c.score) || 0), 0), 0);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => setEditing(null)} className="text-sm text-gray-500 hover:text-gray-800">
          <i className="fas fa-arrow-left mr-1" /> 返回列表
        </button>
        <div className="flex items-center gap-2">
          <button onClick={validate} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">校验评分点</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`mb-3 rounded-lg p-2.5 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {msg.text}
        </div>
      )}

      {validation && (
        <div className={`mb-3 rounded-lg p-3 text-xs ${validation.errors.length ? 'bg-rose-50' : 'bg-sky-50'}`}>
          <div className="font-medium text-gray-700">评分点合计 {validation.total} 分 / 满分 {spec.full_score} 分</div>
          {validation.errors.map((e, i) => <div key={'e' + i} className="mt-1 text-rose-700">✗ {e}</div>)}
          {validation.warnings.map((w, i) => <div key={'w' + i} className="mt-1 text-amber-700">⚠ {w}</div>)}
          {!validation.errors.length && !validation.warnings.length && <div className="mt-1 text-emerald-700">✓ 一切正常</div>}
        </div>
      )}

      <div className="space-y-4">
        {/* 基本信息 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold text-gray-800">基本信息</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs text-gray-500">题干（支持简单 HTML，如 &lt;p&gt;、&lt;strong&gt;）</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="<p>下载「xxx.xlsx」，用 WPS 表格完成以下操作并保存：</p><p>1. ...</p>"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">所属分类（章/小节）</label>
              <select value={cluster} onChange={(e) => setCluster(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="">（未分类）</option>
                {clusterOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.primary}{o.secondary ? ' / ' + o.secondary : '（整章）'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">满分</label>
              <input
                type="number" min={1} step={0.5}
                value={spec.full_score}
                onChange={(e) => setSpec((s) => ({ ...s, full_score: Number(e.target.value) || 0 }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={practiceEnabled} onChange={(e) => setPracticeEnabled(e.target.checked)} />
                学生可练
              </label>
            </div>
          </div>
        </div>

        {/* 模板与自动生成 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold text-gray-800">模板与评分点</h3>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => templateRef.current?.click()}
              disabled={templateBusy}
              className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:bg-gray-300"
            >
              <i className="fas fa-upload mr-1" /> {templateBusy ? '上传中…' : '上传模板文件'}
            </button>
            <span className="text-xs text-gray-500">
              {spec.template?.name ? <>当前模板：<b>{spec.template.name}</b>（学生端可下载）</> : '还没有模板文件'}
            </span>
            <input ref={templateRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => onTemplatePicked(e.target.files?.[0] || null)} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
            <button
              onClick={() => inspectRef.current?.click()}
              disabled={inspectBusy}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300"
            >
              <i className="fas fa-wand-magic-sparkles mr-1" /> {inspectBusy ? '解析中…' : '上传标准答案表 → 自动生成评分点'}
            </button>
            <input ref={inspectRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => onInspectPicked(e.target.files?.[0] || null)} />
            <span className="text-xs text-gray-500">把做好的答案表丢进来，合并区/公式/数值/图表会自动识别成评分点</span>
          </div>
          {inspectNote && <div className="mt-2 rounded-lg bg-indigo-50 p-2.5 text-xs text-indigo-700">{inspectNote}</div>}
        </div>

        {/* 步骤与评分点 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-800">
              操作步骤与评分点
              <span className={`ml-2 text-xs font-normal ${Math.abs(totalCheckScore - spec.full_score) < 1e-9 ? 'text-emerald-600' : 'text-amber-600'}`}>
                评分点合计 {Math.round(totalCheckScore * 100) / 100} 分 / 满分 {spec.full_score} 分
              </span>
            </h3>
            <div className="flex gap-2">
              <button onClick={recalcScores} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">按评分点重算步骤分</button>
              <button onClick={scaleToFull} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">等比缩放到满分</button>
              <button onClick={() => setShowJson((v) => !v)} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                {showJson ? '收起 JSON' : '直接编辑 JSON'}
              </button>
              <button onClick={addStep} className="rounded bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700">+ 步骤</button>
            </div>
          </div>

          {showJson && (
            <div className="mb-4">
              <textarea
                value={specJson}
                onChange={(e) => setSpecJson(e.target.value)}
                rows={16}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
              />
              <button
                onClick={() => {
                  try {
                    const parsed = parseSpec(JSON.parse(specJson));
                    setSpec(parsed);
                    setMsg({ type: 'ok', text: 'JSON 已应用' });
                  } catch (e: any) {
                    setMsg({ type: 'err', text: 'JSON 格式有误：' + e.message });
                  }
                }}
                className="mt-2 rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-900"
              >
                应用 JSON
              </button>
            </div>
          )}

          <div className="space-y-3">
            {spec.steps.map((st, si) => (
              <div key={si} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">{si + 1}</span>
                  <input
                    value={st.title}
                    onChange={(e) => patchStep(si, { title: e.target.value })}
                    placeholder="步骤标题（学生端显示，如：合并单元格并设置标题格式）"
                    className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                  <input
                    type="number" min={0} step={0.5}
                    value={st.score}
                    onChange={(e) => patchStep(si, { score: Number(e.target.value) || 0 })}
                    className="w-20 flex-none rounded border border-gray-300 px-2 py-1 text-sm"
                    title="步骤分值"
                  />
                  <span className="text-xs text-gray-400">分</span>
                  <button onClick={() => delStep(si)} className="flex-none rounded border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">删除步骤</button>
                </div>

                <input
                  value={st.desc || ''}
                  onChange={(e) => patchStep(si, { desc: e.target.value })}
                  placeholder="步骤说明（学生端显示的操作要求，不要在这里写答案）"
                  className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                />
                <input
                  value={st.video_url || ''}
                  onChange={(e) => patchStep(si, { video_url: e.target.value })}
                  placeholder="这一步的演示视频链接（可留空，后期再补）"
                  className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                />

                <div className="space-y-1.5">
                  {st.checks.map((c, ci) => {
                    const meta = KIND_META[c.kind] || { label: c.kind, fields: [] };
                    return (
                      <div key={ci} className="rounded border border-gray-200 bg-white p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={c.kind}
                            onChange={(e) => patchCheck(si, ci, { kind: e.target.value, label: KIND_META[e.target.value]?.label || e.target.value })}
                            className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                          >
                            {Object.keys(KIND_META).map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
                          </select>
                          <input
                            value={c.label || ''}
                            onChange={(e) => patchCheck(si, ci, { label: e.target.value })}
                            placeholder="给学生的评分点描述"
                            className="min-w-[150px] flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs"
                          />
                          <input
                            type="number" min={0} step={0.5}
                            value={c.score ?? 1}
                            onChange={(e) => patchCheck(si, ci, { score: Number(e.target.value) || 0 })}
                            className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs"
                            title="该评分点分值"
                          />
                          <span className="text-[11px] text-gray-400">分</span>
                          <button onClick={() => delCheck(si, ci)} className="rounded border border-rose-200 px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50">删</button>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {meta.fields.map((f) => (
                            <label key={f.key} className="flex items-center gap-1 text-[11px] text-gray-500">
                              {f.label}
                              {f.type === 'bool' ? (
                                <input
                                  type="checkbox"
                                  checked={!!c[f.key]}
                                  onChange={(e) => patchCheck(si, ci, { [f.key]: e.target.checked })}
                                />
                              ) : (
                                <input
                                  type={f.type === 'number' ? 'number' : 'text'}
                                  value={Array.isArray(c[f.key]) ? c[f.key].join(',') : (c[f.key] ?? '')}
                                  onChange={(e) => {
                                    const v = f.type === 'number'
                                      ? (e.target.value === '' ? undefined : Number(e.target.value))
                                      : (f.type === 'csv'
                                        ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean)
                                        : e.target.value);
                                    patchCheck(si, ci, { [f.key]: v });
                                  }}
                                  className="w-28 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
                                />
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={() => addCheck(si)} className="rounded border border-dashed border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-white">+ 评分点</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
