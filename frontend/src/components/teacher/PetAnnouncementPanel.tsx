import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  scheduled_at: string | null;
  remaining_seconds: number;
  starts_in_seconds: number;
  pending: boolean;
  ends_at: string;
  active: boolean;
}

/** 预设时长（秒）：课堂上一条公告通常要挂半节课，5 秒/1 分钟那种等于没发 */
const DURATION_PRESETS = [
  { label: '5 分钟', value: 300 },
  { label: '15 分钟', value: 900 },
  { label: '20 分钟', value: 1200 },
  { label: '25 分钟', value: 1500 },
  { label: '30 分钟', value: 1800 },
];

const DRAFT_KEY = 'xgpy_pet_announce_draft';
const DRAFT_AT_KEY = 'xgpy_pet_announce_draft_at';

/** 秒 → 「1 小时 5 分」这种便于老师扫一眼的说法 */
function fmtSpan(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} 分 ${s % 60} 秒` : `${m} 分`;
  const h = Math.floor(m / 60);
  return `${h} 小时${m % 60 ? ` ${m % 60} 分` : ''}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** datetime-local 需要 'YYYY-MM-DDTHH:mm'（本地时间，不带秒） */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 萌宠公告面板（教师端）
 *
 * 用途：发一条「萌宠气泡」公告，学生端优先用醒目的公告气泡显示，倒计时结束自动消失；
 *      公告期间提示语不再弹。支持**多条并存**（多位老师各自发布互不影响）。
 * 入口：萌宠配置 →「提示语」栏目；通知管理页顶部「萌宠公告」按钮。
 *
 * 2026-11-02 三处增强：
 *   · 自动关闭时长改成 5/15/20/25/30 分钟 + 自定义（原来 5 秒起，等于没发）；
 *   · 支持**定时发布**：提前把第四节课的公告定好，到点自动出现；
 *   · 新增「公告草稿」文本框，输入自动存本机（localStorage），下次打开还在。
 */
export const PetAnnouncementPanel: React.FC = () => {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [items, setItems] = useState<Announcement[]>([]);
  const [content, setContent] = useState('');
  const [duration, setDuration] = useState(1800);
  const [customMinutes, setCustomMinutes] = useState('');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]); // 空数组 = 全部班级
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // 草稿本：输入即存，避免「课前来不及发，先记一下」的内容丢掉
  const [draft, setDraft] = useState(() => {
    try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
  });
  const [draftSavedAt, setDraftSavedAt] = useState(() => {
    try { return localStorage.getItem(DRAFT_AT_KEY) || ''; } catch { return ''; }
  });
  const draftTimer = useRef<number | null>(null);

  useEffect(() => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, draft);
        const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        localStorage.setItem(DRAFT_AT_KEY, now);
        setDraftSavedAt(now);
      } catch {
        // 隐私模式/存储满：静默失败，不影响发布
      }
    }, 400);
    return () => { if (draftTimer.current) window.clearTimeout(draftTimer.current); };
  }, [draft]);

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
          .map((a) => {
            const startsIn = Math.max(0, (a.starts_in_seconds || 0) - 1);
            return {
              ...a,
              starts_in_seconds: startsIn,
              // 定时公告到点了：本地直接翻成「生效中」，不用等下一次轮询
              pending: a.pending && startsIn > 0,
              remaining_seconds: Math.max(0, a.remaining_seconds - 1),
            };
          })
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
    if (duration < 60 || duration > 86400) {
      setMsg('自动关闭时间需在 1 分钟 ~ 24 小时之间');
      return;
    }
    let scheduledPayload: string | undefined;
    if (scheduleMode === 'later') {
      if (!scheduledAt) {
        setMsg('请选择定时发布的时间');
        return;
      }
      const t = new Date(scheduledAt);
      if (Number.isNaN(t.getTime())) {
        setMsg('定时时间格式不对');
        return;
      }
      if (t.getTime() < Date.now() - 60 * 1000) {
        setMsg('定时时间已经过去了，请重新选');
        return;
      }
      scheduledPayload = scheduledAt;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/pet/announcement`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          content: text,
          duration_seconds: duration,
          class_ids: selectedClasses,
          scheduled_at: scheduledPayload,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `发布失败（${res.status}）`);
      setContent('');
      setMsg(
        scheduledPayload
          ? `已排期：${fmtTime(json?.data?.scheduled_at || scheduledPayload)} 自动开始，${fmtSpan(duration)}后自动关闭`
          : `已发布：学生端萌宠气泡会立即显示，${fmtSpan(duration)}后自动消失`,
      );
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

  /** 自定义时长按「分钟」输入（老师习惯说 12 分钟，不会说 720 秒） */
  const applyCustomMinutes = (raw: string) => {
    setCustomMinutes(raw);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 1440) setDuration(Math.round(n * 60));
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
              发布后学生萌宠气泡优先显示，到点自动关闭；期间提示语不再弹
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white">
            {items.filter((a) => a.pending).length > 0
              ? `${items.filter((a) => !a.pending).length} 条生效 · ${items.filter((a) => a.pending).length} 条待发`
              : `生效中 ${items.length} 条`}
          </span>
        )}
      </div>

      {/* 生效中 / 待发布的公告（多条并存） */}
      {items.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {items.map((a) => (
            <div
              key={a.id}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                a.pending ? 'border-sky-200 bg-sky-50/80' : 'border-amber-200 bg-white/90'
              }`}
            >
              <i className={`fa-solid mt-0.5 flex-none ${a.pending ? 'fa-clock text-sky-500' : 'fa-bullhorn text-amber-500'}`}></i>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-800 break-words">{a.content}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {a.pending ? (
                    <>
                      待发布 · {fmtTime(a.scheduled_at)}
                      <span className="mx-1">·</span>
                      <span className="font-semibold text-sky-600">{fmtSpan(a.starts_in_seconds)}后开始</span>
                      <span className="mx-1">·</span>
                      持续 {fmtSpan(a.remaining_seconds + a.starts_in_seconds)}
                    </>
                  ) : (
                    <>
                      {targetText(a.class_ids)}
                      <span className="mx-1">·</span>
                      <span className="font-semibold text-rose-600">{fmtSpan(a.remaining_seconds)}后关闭</span>
                    </>
                  )}
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
                {a.pending ? '取消' : '停止'}
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
                setCustomMinutes('');
              }}
              className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${
                duration === p.value && !customMinutes
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : 'border-amber-300 bg-white text-amber-800 hover:border-amber-500'
              }`}
            >
              {p.label}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={1440}
            value={customMinutes}
            onChange={(e) => applyCustomMinutes(e.target.value)}
            placeholder="自定义"
            className="w-16 rounded border border-amber-300 px-2 py-0.5 text-[11px] focus:border-amber-500 focus:outline-none"
          />
          <span className="text-[11px] text-amber-700">分钟</span>
          <span className="text-[11px] text-gray-500">当前：{fmtSpan(duration)}</span>
        </div>

        {/* 发布时机 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-amber-800">发布时机：</span>
          <button
            type="button"
            onClick={() => setScheduleMode('now')}
            className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${
              scheduleMode === 'now'
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-amber-300 bg-white text-amber-800 hover:border-emerald-400'
            }`}
          >
            立即发布
          </button>
          <button
            type="button"
            onClick={() => {
              setScheduleMode('later');
              // 没填过就给个「下一个整点」，省得老师自己算
              if (!scheduledAt) {
                const d = new Date(Date.now() + 60 * 60 * 1000);
                d.setMinutes(0, 0, 0);
                setScheduledAt(toLocalInput(d));
              }
            }}
            className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${
              scheduleMode === 'later'
                ? 'border-sky-500 bg-sky-500 text-white'
                : 'border-amber-300 bg-white text-amber-800 hover:border-sky-400'
            }`}
          >
            定时发布
          </button>
          {scheduleMode === 'later' && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="rounded border border-sky-300 px-2 py-0.5 text-[11px] focus:border-sky-500 focus:outline-none"
            />
          )}
          {scheduleMode === 'later' && scheduledAt && (
            <span className="text-[11px] text-sky-700">
              到点自动出现，持续 {fmtSpan(duration)}
            </span>
          )}
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
            {scheduleMode === 'later' ? '定时发布' : '发布公告'}
          </button>
          {msg && <span className="text-[11px] text-amber-800">{msg}</span>}
        </div>
      </div>

      {/* 草稿本：输入自动保存，关掉页面也还在（存本机，不上传） */}
      <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-white/70 p-2">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-medium text-amber-800">
            <i className="fa-regular fa-file-lines mr-1"></i>公告草稿
          </span>
          <span className="text-[10px] text-gray-400">
            {draftSavedAt ? `已自动保存 ${draftSavedAt}` : '输入即自动保存到本机'}
          </span>
          <span className="flex-1"></span>
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => { setContent(draft.trim()); setMsg('草稿已填到上方公告内容里'); }}
            className="rounded border border-amber-300 px-2 py-0.5 text-[11px] text-amber-800 hover:border-amber-500 disabled:opacity-40"
          >
            填到公告
          </button>
          <button
            type="button"
            disabled={!draft}
            onClick={() => setDraft('')}
            className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-40"
          >
            清空
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="随手记的公告草稿（可以写好几条，发之前再挑一条填上去）&#10;例：&#10;· 明天带 U 盘&#10;· 周五前交作业到学习平台"
          className="w-full resize-y rounded border border-amber-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-amber-400 focus:outline-none"
        />
      </div>
    </div>
  );
};
