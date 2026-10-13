// 代码农场 · 桌面游戏层
// ============================================================
// 教师开关打开且本班命中时，由 Desktop 挂载本组件：整屏变成农田（覆盖桌面壁纸，
// 但仍位于桌面图标之下），学生在这里看自己的地、看同学的地的长势、写 Python 农活。
//
// ⛔ 判分边界：本组件只负责「解释学生代码 → 得到操作序列 → 提交」，并在本地镜像上
//    即时反馈（让 moisture() 读到刚浇完的值）；真实生长 / 收获 / 积分全在后端结算。
//
// 编辑器布局约定（2026-10-13 改）：
//   · 面板宽 720px（窄屏按 94vw 收），上下分栏：上=代码、下=运行输出；
//   · 两栏各占剩余高度的一半，各自独立滚动；屏幕太矮时整个面板出现滚动条，
//     保证「运行过程」永远不会被裁掉看不见。
//
// 代码容器（2026-10-13 新增，迁移 100）：
//   · 每人 5 格，存在**服务器**（farm_code_slots 表），不是本机 localStorage，
//     所以换个座位 / 换台机器 / 清了浏览器缓存，写好的脚本都还在；
//   · 点一下标签就把那一格的代码取进编辑器，改完存回去，直接运行 —— 一节课里
//     可以「自动浇一茬」「手动收尾」各存一格，随时切换；
//   · 切格子时会**自动保存**当前格（防手滑丢代码），运行前也会顺手存一次。
//   · localStorage 只剩两个用途：未保存草稿的兜底 + 记住上次用的是哪一格。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { runFarmCode, FARM_API_DOC, FARM_EXAMPLE_CODE } from '../../utils/farmPython';
import type { FarmMirror } from '../../utils/farmPython';

export interface FarmPlot {
  student_id: string;
  name: string;
  crop: string | null;
  crop_name: string;
  growth: number;
  moisture: number;
  nutrient: number;
  stage: number;
  total_harvest: number;
  total_points: number;
  ops_left_today?: number;
}

export interface FarmWorld {
  day: number;
  day_minutes: number;
  day_progress: number;
  weather: string;
  weather_label: string;
  notice: string;
  base_yield: number;
  max_ops_per_day: number;
  /** 教师后台配置的编辑器默认代码（空串/缺省 = 用内置示例） */
  default_code?: string;
  /** 学生手册地址（服务端已解析：老师上传的那份，或随包内置的默认手册） */
  guide_url?: string;
  /** 是否在桌面显示「农场手册」入口 */
  guide_enabled?: boolean;
  crops: { key: string; name: string; icon: string; yield_mult: number }[];
}

export interface FarmState {
  enabled: boolean;
  world: FarmWorld;
  me: FarmPlot;
  peers: FarmPlot[];
}

/** 一个代码容器（服务端 GET /api/student/farm/code-slots 固定返回 5 个） */
interface CodeSlot {
  slot: number;
  name: string;
  code: string;
  empty?: boolean;
  updated_at?: string | null;
}

// ⛔ 与后端 MAX_CODE_SLOTS 一一对应，改数量要前后端同改
const SLOT_COUNT = 5;
const SLOT_LAST_KEY = 'farm_slot_last'; // 记住上次打开的是哪一格
const SLOT_NAME_MAX = 16;

function blankSlots(): CodeSlot[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i + 1, name: '', code: '', empty: true }));
}

const WEATHER_STYLE: Record<string, { sky: string; label: string }> = {
  sunny: { sky: 'linear-gradient(180deg, #7dd3fc 0%, #bae6fd 45%, #fde68a 100%)', label: '晴' },
  rainy: { sky: 'linear-gradient(180deg, #64748b 0%, #94a3b8 50%, #cbd5e1 100%)', label: '雨' },
  drought: { sky: 'linear-gradient(180deg, #fdba74 0%, #fed7aa 45%, #fef3c7 100%)', label: '旱' },
};

const CROP_ICON: Record<string, string> = {
  wheat: 'fa-wheat-awn',
  carrot: 'fa-carrot',
  corn: 'fa-seedling',
};

function pct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v || 0)));
}

// 一株作物的示意图：按生长值决定株高与颜色，成熟转金黄
const CropSprite: React.FC<{ stage: number; growth: number; scale?: number }> = ({ stage, growth, scale = 1 }) => {
  if (!stage) {
    return (
      <div className="flex items-end justify-center gap-1" style={{ height: 56 * scale }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-sm" style={{ width: 14 * scale, height: 5 * scale, background: '#a16207', opacity: 0.45 }} />
        ))}
      </div>
    );
  }
  const n = Math.max(1, Math.min(5, Math.round(growth / 20)));
  const h = (10 + pct(growth) * 0.5) * scale;
  const color = stage >= 3 ? '#f59e0b' : stage >= 2 ? '#22c55e' : '#86efac';
  return (
    <div className="flex items-end justify-center gap-1" style={{ height: 56 * scale }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="relative" style={{ width: 5 * scale }}>
          <div className="rounded-t" style={{ height: h, background: color, width: 4 * scale, margin: '0 auto' }} />
          <div
            className="absolute rounded-full"
            style={{ width: 9 * scale, height: 9 * scale, background: color, left: -2 * scale, top: -3 * scale, opacity: 0.9 }}
          />
        </div>
      ))}
    </div>
  );
};

const PlotBar: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="flex items-center gap-2">
    <span className="w-8 shrink-0 text-[11px] text-slate-600">{label}</span>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: pct(value) + '%', background: color }} />
    </div>
    <span className="w-7 shrink-0 text-right text-[11px] font-medium text-slate-700">{pct(value)}</span>
  </div>
);

export const FarmOverlay: React.FC<{
  data: FarmState;
  onRefresh: () => void;
  onDismiss: () => void;
}> = ({ data, onRefresh, onDismiss }) => {
  const { me, peers, world } = data;

  // 编辑器默认代码：优先用教师后台配好的（world.default_code），没配则用内置示例。
  const defaultCode = (world.default_code || '').trim() ? (world.default_code as string) : FARM_EXAMPLE_CODE;

  const [editorOpen, setEditorOpen] = useState(false);
  const [code, setCode] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem('farm_code');
      return saved && saved.trim() ? saved : defaultCode;
    } catch {
      return defaultCode;
    }
  });
  // 「上一次见到的默认代码」：学生没动过代码时，老师换题能自动跟随；
  // 学生自己写过的代码则原样保留（不被悄悄覆盖）。
  const codeBaseRef = useRef<string>(defaultCode);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<{ ok: boolean; text: string }[]>([]);
  const [prints, setPrints] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [gained, setGained] = useState<number | null>(null);
  // 本次提交实际消耗的劳作次数（由服务端结算后回传，权威值）
  const [laborUsed, setLaborUsed] = useState<number | null>(null);
  const [showDoc, setShowDoc] = useState(false);
  // 点「全班的地」里某位同学 → 看他的地（只展示公开的长势，不涉及代码/私密内容）
  const [peerDetail, setPeerDetail] = useState<FarmPlot | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // ---------- 代码容器（每人 5 格，存服务器） ----------
  const [slots, setSlots] = useState<CodeSlot[]>(blankSlots);
  const slotsRef = useRef<CodeSlot[]>(slots); // 异步流程里读最新值（avoid stale closure）
  const [curSlot, setCurSlot] = useState(1);
  const [slotBusy, setSlotBusy] = useState(false);
  const [slotHint, setSlotHint] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const slotsReadyRef = useRef(false); // 每个挂载周期只拉一次容器

  const slotLabel = (n: number): string => {
    const s = slotsRef.current[n - 1];
    return (s && s.name) || `容器 ${n}`;
  };

  const patchSlot = (slot: number, patch: Partial<CodeSlot>) => {
    const next = slotsRef.current.map((s) => (s.slot === slot ? { ...s, ...patch } : s));
    slotsRef.current = next;
    setSlots(next);
  };

  const readLastSlot = (): number => {
    try {
      const n = Number(window.localStorage.getItem(SLOT_LAST_KEY) || '');
      return n >= 1 && n <= SLOT_COUNT ? n : 0;
    } catch {
      return 0;
    }
  };
  const writeLastSlot = (n: number) => {
    try {
      window.localStorage.setItem(SLOT_LAST_KEY, String(n));
    } catch {
      /* 隐私模式忽略 */
    }
  };

  useEffect(() => {
    try {
      window.localStorage.setItem('farm_code', code);
    } catch {
      /* 忽略隐私模式写入失败 */
    }
  }, [code]);

  // 教师改了默认代码 → 只跟随「没动过」的学生（空 or 仍等于上一版默认）
  useEffect(() => {
    if (codeBaseRef.current === defaultCode) return;
    const prevBase = codeBaseRef.current;
    codeBaseRef.current = defaultCode;
    setCode((prev) => (prev.trim() === '' || prev === prevBase ? defaultCode : prev));
  }, [defaultCode]);

  useEffect(() => {
    if (editorOpen && taRef.current) taRef.current.focus();
  }, [editorOpen]);

  // 打开编辑器时把 5 个容器拉回来，并选出这次要显示的那一格
  useEffect(() => {
    if (!editorOpen || slotsReadyRef.current) return;
    slotsReadyRef.current = true;
    (async () => {
      try {
        const r: any = await backendClient.get('/api/student/farm/code-slots');
        const list: CodeSlot[] = (r?.data?.slots || []).map((s: any) => ({
          slot: Number(s.slot),
          name: String(s.name || ''),
          code: String(s.code || ''),
          empty: !!s.empty,
          updated_at: s.updated_at || null,
        }));
        const full: CodeSlot[] = [];
        for (let i = 1; i <= SLOT_COUNT; i++) {
          full.push(list.find((s) => s.slot === i) || { slot: i, name: '', code: '', empty: true });
        }
        slotsRef.current = full;
        setSlots(full);

        const allEmpty = full.every((s) => !s.code.trim());
        let pick = readLastSlot() || 1;
        if (allEmpty) {
          // 容器还没用过：保留编辑器里现有的内容（可能是上一版留在本机的草稿），
          // 学生点「保存到容器」就能把它收进当前格，不会白写。
          setSlotHint('这 5 个容器还空着 —— 把编辑器里的代码点「保存到容器」存起来，以后换电脑也还在。');
        } else {
          // 记住的那格是空的（比如被清空过）→ 退到第一个有代码的格，别让学生看到空编辑器
          if (!full[pick - 1].code.trim()) {
            const first = full.find((s) => s.code.trim());
            if (first) pick = first.slot;
          }
          setCode(full[pick - 1].code);
          // ⛔ 这是学生自己的代码，不能再被「老师换默认代码」覆盖
          codeBaseRef.current = '';
          try {
            window.localStorage.removeItem('farm_code');
          } catch {
            /* ignore */
          }
        }
        setCurSlot(pick);
        writeLastSlot(pick);
      } catch {
        // 读不到就让下次打开重试，编辑器照常可用（不至于因为容器挂了就写不了代码）
        slotsReadyRef.current = false;
        setSlotHint('容器暂时没读出来（网络或登录问题），代码照常可以写和运行。');
      }
    })();
  }, [editorOpen]);

  /** 写一格容器；silent=true 时成功不打扰（失败仍提示） */
  const putSlot = async (slot: number, body: { name?: string; code?: string }, silent = false): Promise<boolean> => {
    try {
      const r: any = await backendClient.put(`/api/student/farm/code-slots/${slot}`, body);
      const s = r?.data?.slot;
      if (s) {
        patchSlot(slot, {
          name: String(s.name || ''),
          code: String(s.code || ''),
          empty: !!s.empty,
          updated_at: s.updated_at || null,
        });
      }
      if (!silent) setSlotHint('已保存到「' + (String(s?.name || '') || `容器 ${slot}`) + '」，下次打开还在。');
      return true;
    } catch (err: any) {
      if (err?.isAuthError || err?.status === 401) setSlotHint('登录状态已失效，保存失败。');
      else setSlotHint('保存失败：' + (err?.response?.data?.error || err?.message || '请稍后再试'));
      return false;
    }
  };

  /** 切换容器：先把当前格存一下（防手滑丢代码），再把目标格的代码取进编辑器 */
  const switchSlot = async (n: number) => {
    if (n === curSlot || slotBusy) return;
    setSlotHint(null);
    setRenaming(false);
    setSlotBusy(true);
    await putSlot(curSlot, { code }, true);
    setCurSlot(n);
    writeLastSlot(n);
    const text = slotsRef.current[n - 1]?.code || '';
    setCode(text);
    codeBaseRef.current = '';
    setSlotBusy(false);
    setSlotHint(text.trim() ? null : `「${slotLabel(n)}」还是空的 —— 写完点「保存到容器」。`);
  };

  const saveCurrent = async () => {
    setSlotBusy(true);
    await putSlot(curSlot, { code });
    setSlotBusy(false);
  };

  const startRename = () => {
    setNameDraft(slotsRef.current[curSlot - 1]?.name || '');
    setRenaming(true);
  };

  const commitRename = async () => {
    const nm = nameDraft.replace(/[\r\n]+/g, ' ').trim().slice(0, SLOT_NAME_MAX);
    setRenaming(false);
    setSlotBusy(true);
    const done = await putSlot(curSlot, { name: nm }, true);
    if (done) setSlotHint(nm ? `容器已改名为「${nm}」` : '容器名已清空，显示默认名。');
    setSlotBusy(false);
  };

  const clearSlot = async () => {
    if (!window.confirm(`清空「${slotLabel(curSlot)}」？里面的代码和名字都会删掉。`)) return;
    setSlotBusy(true);
    try {
      await backendClient.delete(`/api/student/farm/code-slots/${curSlot}`);
      patchSlot(curSlot, { name: '', code: '', empty: true, updated_at: null });
      setCode('');
      codeBaseRef.current = '';
      setSlotHint('容器已清空。');
    } catch (err: any) {
      setSlotHint('清空失败：' + (err?.response?.data?.error || err?.message || '请稍后再试'));
    } finally {
      setSlotBusy(false);
    }
  };

  const sky = (WEATHER_STYLE[world.weather] || WEATHER_STYLE.sunny).sky;
  const mirror: FarmMirror = useMemo(
    () => ({
      crop: me.crop,
      growth: me.growth,
      moisture: me.moisture,
      nutrient: me.nutrient,
      stage: me.stage,
      opsLeft: me.ops_left_today ?? 0,
      day: world.day,
      weather: world.weather,
    }),
    [me, world.day, world.weather]
  );

  const run = async () => {
    setError(null);
    setGained(null);
    setEvents([]);
    setPrints([]);
    setLaborUsed(null);

    const res = runFarmCode(code, mirror, { maxOps: 80 });
    setPrints(res.prints);
    if (res.error) {
      setError(res.error + (res.errorLine ? '（第 ' + res.errorLine + ' 行）' : ''));
      return;
    }
    if (!res.ops.length) {
      setError('这段代码没有做出任何农活操作（试试 plant / water / fertilize）');
      return;
    }

    setBusy(true);
    try {
      // 跑之前顺手把当前容器存一次：跑出好结果才想起来「刚才没存」最气人
      void putSlot(curSlot, { code }, true);
      const r: any = await backendClient.post('/api/student/farm/run', { ops: res.ops, code, prints: res.prints });
      const d = r?.data;
      if (!d) {
        setError('提交失败：服务器没有返回结果');
        return;
      }
      setEvents(d.events || []);
      if (typeof d.labor_used === 'number') setLaborUsed(d.labor_used);
      if (typeof d.points_gained === 'number' && d.points_gained > 0) setGained(d.points_gained);
      onRefresh();
    } catch (err: any) {
      if (err?.isAuthError || err?.status === 401) {
        setError('登录状态已失效，请重新登录');
      } else {
        setError(err?.response?.data?.error || err?.message || '提交失败，请稍后再试');
      }
    } finally {
      setBusy(false);
    }
  };

  const harvest = async () => {
    setError(null);
    setBusy(true);
    try {
      const r: any = await backendClient.post('/api/student/farm/run', { ops: [{ op: 'harvest' }], code: 'harvest()' });
      const d = r?.data;
      if (d) {
        setEvents(d.events || []);
        if (typeof d.points_gained === 'number' && d.points_gained > 0) setGained(d.points_gained);
        onRefresh();
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '收获失败');
    } finally {
      setBusy(false);
    }
  };

  const canHarvest = !!me.crop && me.growth >= 100;
  const opsLeft = me.ops_left_today ?? 0;
  const nothingYet = !error && !events.length && !prints.length;

  return (
    <>
      {/* ===== 农场世界（覆盖桌面壁纸，但在桌面图标之下） ===== */}
      <div className="pointer-events-none absolute inset-0 z-[5] select-none" style={{ background: sky }}>
        {/* 太阳 / 云 */}
        <div className="absolute right-16 top-10 h-16 w-16 rounded-full bg-yellow-200/90" />
        <div className="absolute right-40 top-16 h-8 w-24 rounded-full bg-white/70" />
        <div className="absolute right-28 top-24 h-7 w-16 rounded-full bg-white/50" />

        {/* 田地：我的那块 */}
        <div className="pointer-events-auto absolute left-1/2 top-[46%] w-[520px] max-w-[76vw] -translate-x-1/2 -translate-y-1/3">
          <div className="rounded-2xl border border-amber-900/20 bg-amber-100/70 p-4 shadow-sm backdrop-blur-[2px]">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-house-chimney text-amber-700" />
                <span className="text-sm font-medium text-amber-900">我的地</span>
                {world.notice ? <span className="text-[11px] text-amber-700/80">· {world.notice}</span> : null}
              </div>
              <span
                className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                title="每次农活都花劳作次数：播种 / 除草 / 收获 各 1 次；浇水、施肥按份数算（浇 3 份 = 3 次）"
              >
                今天还能劳作 {opsLeft} 次
              </span>
            </div>

            <div className="flex items-end gap-4">
              <div className="flex w-[150px] shrink-0 flex-col items-center justify-end rounded-xl bg-gradient-to-b from-amber-200/50 to-amber-700/30 p-3" style={{ minHeight: 110 }}>
                <CropSprite stage={me.stage} growth={me.growth} scale={1.4} />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  {me.crop ? (
                    <>
                      <i className={`fa-solid ${CROP_ICON[me.crop] || 'fa-seedling'} text-emerald-700`} />
                      <span className="text-sm font-medium text-slate-800">{me.crop_name}</span>
                      <span className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] text-slate-600">
                        {me.stage >= 3 ? '已成熟' : me.stage === 2 ? '生长中' : '幼苗'}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-slate-600">空地 —— 写一行 plant("wheat") 播下种子</span>
                  )}
                </div>
                <PlotBar label="生长" value={me.growth} color="linear-gradient(90deg,#22c55e,#f59e0b)" />
                <PlotBar label="水分" value={me.moisture} color="#38bdf8" />
                <PlotBar label="养分" value={me.nutrient} color="#a78bfa" />
                <div className="flex items-center gap-3 pt-0.5 text-[11px] text-slate-600">
                  <span>累计收获 {me.total_harvest} 次</span>
                  <span>农场积分 {me.total_points}</span>
                  <span>单次收获约 +{world.base_yield} 分</span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setEditorOpen(true)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
              >
                <i className="fa-solid fa-code mr-1.5" />
                编写农活代码
              </button>
              <button
                onClick={harvest}
                disabled={!canHarvest || busy}
                className="rounded-lg border border-amber-700/40 bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <i className="fa-solid fa-basket-shopping mr-1.5" />
                收获
              </button>
              {gained ? (
                <span className="ml-1 rounded-full bg-yellow-200 px-2 py-0.5 text-xs font-medium text-amber-900">+{gained} 积分</span>
              ) : null}
            </div>
          </div>
        </div>

        {/* 全班田地的缩影 */}
        <div className="pointer-events-auto absolute bottom-20 left-4 right-4">
          <div className="mb-1.5 flex items-center gap-2 pl-1">
            <i className="fa-solid fa-users text-emerald-900/70" />
            <span className="text-xs font-medium text-emerald-900/80">全班的地（按农场积分排序）</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {peers.map((p) => (
              <button
                key={p.student_id}
                type="button"
                onClick={() => setPeerDetail(p)}
                title={'点一下看看 ' + (p.name || '这位同学') + ' 的地'}
                className={`w-[104px] shrink-0 rounded-xl border p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                  p.student_id === me.student_id
                    ? 'border-emerald-600 bg-white/85 hover:border-emerald-700'
                    : 'border-amber-900/15 bg-white/65 hover:border-emerald-400'
                }`}
              >
                <div className="mb-1 truncate text-[11px] font-medium text-slate-700">
                  {p.name || '同学'}
                  {p.student_id === me.student_id ? ' ·我' : ''}
                </div>
                <div className="flex items-end justify-center rounded-lg bg-amber-100/70" style={{ height: 54 }}>
                  <CropSprite stage={p.stage} growth={p.growth} scale={0.8} />
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full"
                    style={{ width: pct(p.growth) + '%', background: p.stage >= 3 ? '#f59e0b' : '#22c55e' }}
                  />
                </div>
                <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                  <span>{p.crop_name || '空地'}</span>
                  <span>{p.total_points}分</span>
                </div>
              </button>
            ))}
            {!peers.length ? <span className="text-xs text-slate-600">这个班还没有人开垦……</span> : null}
          </div>
        </div>

        {/* 顶部信息条 */}
        <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2">
          <div className="flex items-center gap-3 rounded-xl bg-white/75 px-3 py-1.5 text-xs text-slate-700 backdrop-blur-sm">
            <span>
              <i className="fa-solid fa-sun mr-1 text-amber-500" />
              第 {world.day} 天 · {world.weather_label}
            </span>
            <span className="text-slate-400">|</span>
            <span>
              <i className="fa-solid fa-clock mr-1 text-sky-500" />
              {world.day_minutes} 分钟一天
            </span>
            <span className="text-slate-400">|</span>
            <span title="当前这一天已经过的时间">
              进度 {Math.round((world.day_progress || 0) * 100)}%
            </span>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-xl bg-white/75 px-3 py-1.5 text-xs text-slate-700 backdrop-blur-sm hover:bg-white"
            title="先收起农场，回到普通桌面"
          >
            <i className="fa-solid fa-eye-slash mr-1" />
            收起
          </button>
        </div>
      </div>

      {/* ===== 同学的地 · 详情（点「全班的地」里的卡片打开） ===== */}
      {peerDetail ? (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPeerDetail(null)}
        >
          <div className="w-[380px] max-w-[92vw] rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <i className="fa-solid fa-house-chimney text-amber-600" />
              <span className="font-medium text-slate-800">
                {peerDetail.name || '同学'} 的地
                {peerDetail.student_id === me.student_id ? '（我自己）' : ''}
              </span>
              <button
                onClick={() => setPeerDetail(null)}
                title="关闭"
                className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="flex items-end gap-4">
              <div
                className="flex w-[120px] shrink-0 flex-col items-center justify-end rounded-xl bg-gradient-to-b from-amber-200/50 to-amber-700/30 p-3"
                style={{ minHeight: 96 }}
              >
                <CropSprite stage={peerDetail.stage} growth={peerDetail.growth} scale={1.2} />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  {peerDetail.crop ? (
                    <>
                      <i className={`fa-solid ${CROP_ICON[peerDetail.crop] || 'fa-seedling'} text-emerald-700`} />
                      <span className="text-sm font-medium text-slate-800">{peerDetail.crop_name}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                        {peerDetail.stage >= 3 ? '已成熟' : peerDetail.stage === 2 ? '生长中' : '幼苗'}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-slate-600">空地 —— 还没播种</span>
                  )}
                </div>
                <PlotBar label="生长" value={peerDetail.growth} color="linear-gradient(90deg,#22c55e,#f59e0b)" />
                <PlotBar label="水分" value={peerDetail.moisture} color="#38bdf8" />
                <PlotBar label="养分" value={peerDetail.nutrient} color="#a78bfa" />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              <span>
                累计收获 <b className="text-slate-800">{peerDetail.total_harvest}</b> 次
              </span>
              <span>
                农场积分 <b className="text-slate-800">{peerDetail.total_points}</b>
              </span>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-gray-400">
              这里只看得到长势，看不到同学写的代码 —— 每个人自己的脚本只有自己能看到。
            </p>
          </div>
        </div>
      ) : null}

      {/* ===== 代码编辑器（浮在最上层） ===== */}
      {editorOpen ? (
        <div className="fixed inset-0 z-[1200] flex justify-end bg-black/40" onClick={() => setEditorOpen(false)}>
          <div
            className="flex h-full w-[720px] max-w-[94vw] flex-col overflow-y-auto bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-code text-emerald-600" />
                <span className="font-medium text-gray-800">编写农活代码</span>
                <span className="text-xs text-gray-400">Python</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowDoc((s) => !s)} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                  <i className="fa-solid fa-book mr-1" />
                  可用函数
                </button>
                <button onClick={() => setEditorOpen(false)} className="rounded px-2 py-1 text-gray-400 hover:bg-gray-100">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            </div>

            {/* ===== 代码容器条：点一下就把那格的代码取进编辑器 ===== */}
            <div className="shrink-0 border-b border-gray-100 bg-slate-50 px-4 py-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <i className="fa-solid fa-box-archive text-emerald-600" />
                <span className="text-[11px] font-medium text-gray-600">代码容器</span>
                <span className="text-[10px] text-gray-400">
                  点一下就把里面的代码取出来，改完存回去 · 存在服务器，换台电脑也还在
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {slots.map((s) => {
                  const active = s.slot === curSlot;
                  return (
                    <button
                      key={s.slot}
                      onClick={() => switchSlot(s.slot)}
                      disabled={slotBusy}
                      title={s.empty ? `${s.name || `容器 ${s.slot}`}：空容器` : `${s.name || `容器 ${s.slot}`}：已存代码`}
                      className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                        active
                          ? 'border-emerald-500 bg-emerald-600 font-medium text-white'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:text-emerald-700'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="max-w-[86px] truncate">{s.name || `容器 ${s.slot}`}</span>
                      {!s.empty ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-white' : 'bg-emerald-500'}`} /> : null}
                    </button>
                  );
                })}
                {renaming ? (
                  <span className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={nameDraft}
                      maxLength={SLOT_NAME_MAX}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenaming(false);
                      }}
                      onBlur={commitRename}
                      placeholder="给这格起个名字"
                      className="w-[120px] rounded border border-emerald-300 px-2 py-1 text-xs outline-none"
                    />
                    <button onClick={commitRename} className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
                      确定
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={startRename}
                    title="给当前容器改个名字（比如「自动浇一茬」）"
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    <i className="fa-solid fa-pen mr-1" />
                    重命名
                  </button>
                )}
                <button
                  onClick={saveCurrent}
                  disabled={slotBusy}
                  title="把编辑器里的代码存进当前容器"
                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <i className="fa-solid fa-floppy-disk mr-1" />
                  {slotBusy ? '处理中…' : '保存到容器'}
                </button>
                <button
                  onClick={clearSlot}
                  disabled={slotBusy}
                  title="清空当前容器（代码和名字都删掉）"
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                >
                  <i className="fa-solid fa-trash-can mr-1" />
                  清空
                </button>
                <span className="ml-auto text-[10px] text-gray-400">
                  当前：<b className="text-gray-600">{slotLabel(curSlot)}</b>
                </span>
              </div>
              {slotHint ? <div className="mt-1.5 text-[10px] leading-4 text-emerald-700">{slotHint}</div> : null}
            </div>

            {showDoc ? (
              <div className="max-h-52 shrink-0 overflow-y-auto border-b border-gray-100 bg-gray-50 px-4 py-2">
                {FARM_API_DOC.map((d) => (
                  <div key={d.call} className="flex gap-2 py-0.5 text-xs">
                    <code className="shrink-0 font-mono text-emerald-700">{d.call}</code>
                    <span className="text-gray-500">{d.desc}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* 上半：代码区（独立滚动） */}
            <textarea
              ref={taRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              className="min-h-[220px] w-full flex-1 resize-none overflow-auto border-0 bg-slate-900 p-4 font-mono text-[13px] leading-6 text-slate-100 outline-none"
              placeholder='例如：\nplant("wheat")\nwhile moisture() < 100:\n    water()'
            />

            {/* 下半：运行输出（独立滚动） */}
            <div className="flex min-h-[200px] shrink-0 flex-1 flex-col border-t border-gray-200">
              <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
                <button
                  onClick={run}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <i className="fa-solid fa-play mr-1.5" />
                  {busy ? '执行中…' : '运行'}
                </button>
                <button
                  onClick={() => setCode(defaultCode)}
                  title="载入老师为你准备的起始代码"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  <i className="fa-solid fa-rotate-left mr-1" />
                  恢复默认代码
                </button>
                <span className="ml-auto text-[11px] text-gray-400">
                  代码存进容器后跟着你走，换台电脑也还在
                </span>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border-t border-gray-100 bg-slate-50 px-4 py-3">
                {error ? (
                  <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    <i className="fa-solid fa-circle-exclamation mr-1" />
                    {error}
                  </div>
                ) : null}

                {prints.length ? (
                  <div className="rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] leading-5 text-emerald-200">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">print 输出</div>
                    {prints.map((p, i) => (
                      <div key={i}>{p}</div>
                    ))}
                  </div>
                ) : null}

                {laborUsed !== null ? (
                  <div className="flex items-center gap-3 rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800">
                    <span>本次消耗劳作 <b>{laborUsed}</b> 次</span>
                    <span className="text-emerald-700/70">今天还剩 <b>{opsLeft}</b> 次</span>
                  </div>
                ) : null}

                {events.length ? (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">结算过程</div>
                    {events.map((e, i) => (
                      <div key={i} className={`flex items-start gap-1.5 text-xs ${e.ok ? 'text-slate-700' : 'text-amber-700'}`}>
                        <i className={`fa-solid ${e.ok ? 'fa-check' : 'fa-triangle-exclamation'} mt-0.5 text-[10px]`} />
                        <span>{e.text}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {nothingYet ? (
                  <p className="text-[11px] leading-5 text-gray-400">
                    提示：每一次农活都花劳作次数（播种 / 除草 / 收获 各 1 次；浇水、施肥按份数算，浇 3 份 = 3 次），
                    今天用完就要等明天。水满了别再浇、肥满了别再施——先读 moisture() / nutrient()，
                    再用 while 浇到刚好，才是高手。
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
