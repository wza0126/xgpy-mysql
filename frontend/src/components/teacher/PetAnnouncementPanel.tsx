import React, { useState, useEffect, useCallback } from 'react';
import { API_CONFIG } from '../../api/config';
import { authHeaders } from '../../utils/authToken';
import { backendClient } from '../../api/backendClient';

interface ClassInfo {
  id: string;
  name: string;
}

interface Announcement {
  id: string;
  content: string;
  class_ids: string[];
  created_by_name: string | null;
  remaining_seconds: number;
  ends_at: string;
  active: boolean;
}

const DURATION_PRESETS = [
  { label: '30 秒', value: 30 },
  { label: '1 分钟', value: 60 },
  { label: '3 分钟', value: 180 },
  { label: '5 分钟', value: 300 },
  { label: '10 分钟', value: 600 },
];

/**
 * 萌宠公告面板（教师端）
 *
 * 用途：发一条「萌宠气泡」公告，学生端优先用醒目的公告气泡显示，倒计时结束自动消失；
 *      公告期间提示语不再弹。支持**多条并存**（多位老师各自发布互不影响）。
 * 入口：萌宠配置 →「提示语」栏目；通知管理页顶部「萌宠公告」按钮。
 */
export const PetAnnouncementPanel: React.FC = () => {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [items, setItems] = useState<Announcement[]>([]);
  const [content, setContent] = useState('');
  const [duration, setDuration] = useState(60);
  const [customDuration, setCustomDuration] = useState('');
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]); // 空数组 = 全部班级
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/pet/announcement/teacher`, { headers: authHeaders() });
      const json = await res.json();
      if (json && json.data && Array.isArray(json.data.items)) {
        setItems(json.data.items as Announcement[]);
      }
    } catch {
      // 网络抖动时保留上一份列表
    }
  }, []);

  useEffect(() => {
    loadItems();
    // backendClient 返回的是 PromiseLike（没有 .catch），用 async IIFE 包一层
    (async () => {
      try {
        const { data } = await backendClient.from('classes').select('*');
        if (data) setClasses(data as ClassInfo[]);
      } catch {
        // 班级拉取失败不影响发布（仍可选「全部班级」）
      }
    })();

    // 本地每秒递减倒计时（不额外打接口）；每 20 秒与服务端对齐一次
    const tick = setInterval(() => {
      setItems((prev) =>
        prev
          .map((a) => ({ ...a, remaining_seconds: Math.max(0, a.remaining_seconds - 1) }))
          .filter((a) => a.remaining_seconds > 0)
      );
    }, 1000);
    const poll = setInterval(loadItems, 20000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [loadItems]);

  const handleStart = async () => {
    const text = content.trim();
    if (!text) {
      setMsg('请先填写公告内容');
      return;
    }
    if (duration < 5 || duration > 3600) {
      setMsg('自动关闭时间需在 5 秒 ~ 1 小时之间');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/pet/announcement`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content: text, duration_seconds: duration, class_ids: selectedClasses }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `发布失败（${res.status}）`);
      setContent('');
      setMsg('已发布：学生端萌宠气泡会立即显示，倒计时结束后自动消失');
      await loadItems();
    } catch (e) {
      setMsg((e as Error).message || '发布失败');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await fetch(`${API_CONFIG.apiUrl}/api/pet/announcement/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setMsg('停止失败，请重试');
    }
  };

  const toggleClass = (id: string) =>
    setSelectedClasses((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const className = (id: string) => classes.find((c) => c.id === id)?.name || '未知班级';
  const targetText = (ids: string[]) =>
    ids.length === 0 ? '全部班级' : ids.slice(0, 3).map(className).join('、') + (ids.length > 3 ? ` 等 ${ids.length} 个班` : '');

  const applyCustomDuration = (raw: string) => {
    setCustomDuration(raw);
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 5 && n <= 3600) setDuration(n);
  };

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow">
            <i className="fa-solid fa-bullhorn"></i>
          </span>
          <div>
            <p className="text-sm font-bold text-amber-900">萌宠公告</p>
            <p className="text-[11px] text-amber-700">
              发布后学生萌宠气泡优先显示，倒计时结束自动关闭；期间提示语不再弹
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white">
            生效中 {items.length} 条
          </span>
        )}
      </div>

      {/* 生效中的公告（多条并存） */}
      {items.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {items.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-white/90 px-3 py-2"
            >
              <i className="fa-solid fa-bullhorn mt-0.5 flex-none text-amber-500"></i>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-800 break-words">{a.content}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {targetText(a.class_ids)}
                  <span className="mx-1">·</span>
                  <span className="font-semibold text-rose-600">{a.remaining_seconds} 秒后关闭</span>
                  {a.created_by_name && (
                    <>
                      <span className="mx-1">·</span>
                      {a.created_by_name}
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleStop(a.id)}
                className="flex-none rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:border-rose-300 hover:text-rose-600"
              >
                停止
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 发布表单 */}
      <div className="space-y-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="公告内容，例如：今天第四节课后到机房补交作业"
          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-amber-800">自动关闭：</span>
          {DURATION_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                setDuration(p.value);
                setCustomDuration('');
              }}
              className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${
                duration === p.value && !customDuration
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : 'border-amber-300 bg-white text-amber-800 hover:border-amber-500'
              }`}
            >
              {p.label}
            </button>
          ))}
          <input
            type="number"
            min={5}
            max={3600}
            value={customDuration}
            onChange={(e) => applyCustomDuration(e.target.value)}
            placeholder="自定义秒"
            className="w-20 rounded border border-amber-300 px-2 py-0.5 text-[11px] focus:border-amber-500 focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] text-amber-800">目标班级：</span>
            <button
              type="button"
              onClick={() => setSelectedClasses([])}
              className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${
                selectedClasses.length === 0
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-amber-300 bg-white text-amber-800 hover:border-emerald-400'
              }`}
            >
              全部班级
            </button>
            <span className="text-[11px] text-amber-600">
              {selectedClasses.length === 0 ? '（当前：全部班级）' : `已选 ${selectedClasses.length} 个班`}
            </span>
          </div>
          <div className="max-h-24 overflow-y-auto rounded-lg border border-amber-200 bg-white p-1.5 flex flex-wrap gap-1.5">
            {classes.length === 0 && <span className="text-[11px] text-gray-400">加载班级中…</span>}
            {classes.map((c) => {
              const on = selectedClasses.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleClass(c.id)}
                  className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${
                    on
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:border-emerald-400'
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStart}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-3 py-1.5 text-xs font-medium text-white shadow hover:from-rose-600 hover:to-orange-600 disabled:opacity-60"
          >
            {busy ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-paper-plane"></i>}
            发布公告
          </button>
          {msg && <span className="text-[11px] text-amber-800">{msg}</span>}
        </div>
      </div>
    </div>
  );
};
