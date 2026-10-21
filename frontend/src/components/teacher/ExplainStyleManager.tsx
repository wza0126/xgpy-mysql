import React, { useCallback, useEffect, useState } from 'react';
import { API_CONFIG } from '../../api/config';
import { authHeaders } from '../../utils/authToken';

/**
 * AI 讲解风格管理（系统配置 → AI设置）
 *
 * 老师能改的只有「怎么讲」：风格片段 + 名称 + 字数上限 + 启用。输出结构（JSON 分镜）固定在
 * 后端 explain-styles.js，不开放编辑 —— 结构改坏会让讲解退化成一句话。
 *
 * 内置风格可改可停用，但**不可删除**（启动时会补种，删了也会回来）；
 * 想恢复出厂用「恢复默认」。
 */

interface StyleRow {
  style_key: string;
  name: string;
  summary: string;
  snippet: string;
  max_chars: number;
  enabled: number;
  builtin: number;
  sort_order: number;
}

type Draft = {
  name: string;
  summary: string;
  snippet: string;
  max_chars: number;
  enabled: boolean;
  sort_order: number;
};

const toDraft = (s: Partial<StyleRow>): Draft => ({
  name: s.name || '',
  summary: s.summary || '',
  snippet: s.snippet || '',
  max_chars: Number(s.max_chars) || 260,
  enabled: Number(s.enabled ?? 1) ? true : false,
  sort_order: Number(s.sort_order) || 0,
});

export const ExplainStyleManager: React.FC = () => {
  const api = `${API_CONFIG.apiUrl}/api/teacher/explain/styles`;
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(toDraft({ name: '', max_chars: 260, enabled: 1, sort_order: 60 }));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(api, { headers: authHeaders() });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `读取失败（${res.status}）`);
      setStyles((json?.data?.styles || []) as StyleRow[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (s: StyleRow) => {
    setCreating(false);
    setEditingKey(s.style_key);
    setDraft(toDraft(s));
  };

  const saveEdit = async () => {
    if (!editingKey || !draft) return;
    setBusy(true);
    try {
      const res = await fetch(`${api}/${editingKey}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: draft.name,
          summary: draft.summary,
          snippet: draft.snippet,
          max_chars: draft.max_chars,
          enabled: draft.enabled ? 1 : 0,
          sort_order: draft.sort_order,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `保存失败（${res.status}）`);
      setEditingKey(null);
      setDraft(null);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createStyle = async () => {
    if (!newDraft.name.trim() || newDraft.snippet.trim().length < 10) {
      alert('请填写风格名称，并写至少 10 个字的风格要求');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: newDraft.name,
          summary: newDraft.summary,
          snippet: newDraft.snippet,
          max_chars: newDraft.max_chars,
          enabled: newDraft.enabled ? 1 : 0,
          sort_order: newDraft.sort_order,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `新建失败（${res.status}）`);
      setCreating(false);
      setNewDraft(toDraft({ name: '', max_chars: 260, enabled: 1, sort_order: 60 }));
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (s: StyleRow) => {
    setBusy(true);
    try {
      const res = await fetch(`${api}/${s.style_key}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: s.enabled ? 0 : 1 }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `操作失败（${res.status}）`);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetStyle = async (s: StyleRow) => {
    if (!confirm(`把「${s.name}」恢复成内置默认内容？你改过的文字会被覆盖。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${api}/${s.style_key}/reset`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `恢复失败（${res.status}）`);
      setEditingKey(null);
      setDraft(null);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeStyle = async (s: StyleRow) => {
    if (!confirm(`删除自定义风格「${s.name}」？该风格已生成的讲解缓存也会一起清掉。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${api}/${s.style_key}`, {
        method: 'DELETE',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `删除失败（${res.status}）`);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderEditor = (value: Draft, onChange: (next: Draft) => void) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">名称（讲解器上显示的 chip）</label>
          <input
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            maxLength={20}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            placeholder="例如：接地气唠嗑"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">一句话说明（鼠标悬停提示）</label>
          <input
            value={value.summary}
            onChange={(e) => onChange({ ...value, summary: e.target.value })}
            maxLength={60}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            placeholder="例如：像本班老师聊天，先点坑再讲理"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          风格要求（只写「怎么说」，别写输出格式 —— 格式后端已固定）
        </label>
        <textarea
          value={value.snippet}
          onChange={(e) => onChange({ ...value, snippet: e.target.value })}
          rows={6}
          maxLength={1200}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed"
          placeholder={'例如：\n像本班老师在课间跟学生聊这道题，不端架子。\n开头用「我们看这道题哈」这类口语。\n不玩网络梗，知识点必须准确。'}
        />
        <p className="mt-1 text-xs text-gray-400">{value.snippet.length}/1200 字</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">讲解字数上限</label>
          <input
            type="number"
            min={120}
            max={600}
            value={value.max_chars}
            onChange={(e) => onChange({ ...value, max_chars: Number(e.target.value) })}
            className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">排序（小的在前）</label>
          <input
            type="number"
            value={value.sort_order}
            onChange={(e) => onChange({ ...value, sort_order: Number(e.target.value) })}
            className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <label className="mb-1.5 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
            className="h-4 w-4"
          />
          启用（停用后讲解器里不出现，已生成的缓存保留）
        </label>
      </div>
    </div>
  );

  return (
    <div className="mt-8 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h4 className="text-base font-bold text-gray-800">
            <i className="fa-solid fa-headphones-simple mr-2 text-indigo-600"></i>
            AI 讲解风格
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            讲解器顶部的风格 chip 就是这里配置的。切换风格会重新生成一份讲解（按「题目 × 风格」缓存，切回去不再花额度）。
            <br />
            <strong>公共规则不可改</strong>：第一句先给答案、专业名词必须翻译一次、禁止否定式评价与网络烂梗 —— 这几条是后进生听得进去的关键，任何风格都受它约束。
          </p>
        </div>
        <button
          onClick={() => { setCreating(true); setEditingKey(null); setDraft(null); }}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
        >
          <i className="fa-solid fa-plus mr-1"></i>
          新建风格
        </button>
      </div>

      {loading && <p className="py-4 text-center text-sm text-gray-500">加载中…</p>}
      {!loading && error && (
        <div className="py-4 text-center text-sm text-rose-600">
          {error}
          <button onClick={load} className="ml-3 rounded border border-rose-300 px-2 py-0.5 text-xs">重试</button>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {styles.map((st) => {
            const isEditing = editingKey === st.style_key;
            return (
              <div key={st.style_key} className={`rounded-lg border bg-white p-3 ${st.enabled ? 'border-gray-200' : 'border-gray-200 opacity-70'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">{st.name}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{st.style_key}</span>
                  {st.builtin ? (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-700">内置</span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700">自定义</span>
                  )}
                  {!st.enabled && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600">已停用</span>}
                  <span className="text-xs text-gray-500">≤{st.max_chars} 字</span>
                  <span className="text-xs text-gray-400">|</span>
                  <span className="text-xs text-gray-500">{st.summary || '（无说明）'}</span>

                  <div className="ml-auto flex items-center gap-1.5">
                    {!isEditing && (
                      <button onClick={() => startEdit(st)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                        编辑
                      </button>
                    )}
                    <button
                      onClick={() => toggleEnabled(st)}
                      disabled={busy}
                      className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
                    >
                      {st.enabled ? '停用' : '启用'}
                    </button>
                    {st.builtin ? (
                      <button
                        onClick={() => resetStyle(st)}
                        disabled={busy}
                        className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                      >
                        恢复默认
                      </button>
                    ) : (
                      <button
                        onClick={() => removeStyle(st)}
                        disabled={busy}
                        className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && draft && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    {renderEditor(draft, setDraft)}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={saveEdit}
                        disabled={busy}
                        className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busy ? '保存中…' : '保存'}
                      </button>
                      <button
                        onClick={() => { setEditingKey(null); setDraft(null); }}
                        className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
                      >
                        取消
                      </button>
                      <span className="self-center text-xs text-gray-400">
                        保存后，新生成的讲解会用新风格；用旧风格生成的缓存会自动失效（提示词版本变了）。
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {creating && (
            <div className="rounded-lg border border-indigo-300 bg-white p-3">
              <div className="mb-2 text-sm font-medium text-gray-800">新建风格</div>
              {renderEditor(newDraft, setNewDraft)}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={createStyle}
                  disabled={busy}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy ? '创建中…' : '创建'}
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExplainStyleManager;
