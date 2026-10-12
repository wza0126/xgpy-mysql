// 代码农场 · 桌面游戏层
// ============================================================
// 教师开关打开且本班命中时，由 Desktop 挂载本组件：整屏变成农田（覆盖桌面壁纸，
// 但仍位于桌面图标之下），学生在这里看自己的地、看同学的地的长势、写 Python 农活。
//
// ⛔ 判分边界：本组件只负责「解释学生代码 → 得到操作序列 → 提交」，并在本地镜像上
//    即时反馈（让 moisture() 读到刚浇完的值）；真实生长 / 收获 / 积分全在后端结算。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { runFarmCode, FARM_API_DOC } from '../../utils/farmPython';
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
  crops: { key: string; name: string; icon: string; yield_mult: number }[];
}

export interface FarmState {
  enabled: boolean;
  world: FarmWorld;
  me: FarmPlot;
  peers: FarmPlot[];
}

const DEFAULT_CODE = `# 用 Python 照顾你的地
# 先播下种子（可选 wheat 小麦 / carrot 胡萝卜 / corn 玉米）
if crop() == None:
    plant("wheat")

# 水分不够就浇水（水分满了再浇是浪费）
while moisture() < 100:
    water()

# 养分不够就施肥
if nutrient() < 80:
    fertilize(2)

print("水分", moisture(), "养分", nutrient())
`;

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
  const [editorOpen, setEditorOpen] = useState(false);
  const [code, setCode] = useState<string>(() => {
    try {
      return window.localStorage.getItem('farm_code') || DEFAULT_CODE;
    } catch {
      return DEFAULT_CODE;
    }
  });
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<{ ok: boolean; text: string }[]>([]);
  const [prints, setPrints] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [gained, setGained] = useState<number | null>(null);
  // 本次提交实际消耗的劳作次数（由服务端结算后回传，权威值）
  const [laborUsed, setLaborUsed] = useState<number | null>(null);
  const [showDoc, setShowDoc] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem('farm_code', code);
    } catch {
      /* 忽略隐私模式写入失败 */
    }
  }, [code]);

  useEffect(() => {
    if (editorOpen && taRef.current) taRef.current.focus();
  }, [editorOpen]);

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
              <div
                key={p.student_id}
                className={`w-[104px] shrink-0 rounded-xl border p-2 ${
                  p.student_id === me.student_id ? 'border-emerald-600 bg-white/85' : 'border-amber-900/15 bg-white/65'
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
              </div>
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

      {/* ===== 代码编辑器（浮在最上层） ===== */}
      {editorOpen ? (
        <div className="fixed inset-0 z-[1200] flex justify-end bg-black/40" onClick={() => setEditorOpen(false)}>
          <div
            className="flex h-full w-[520px] max-w-[92vw] flex-col bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
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

            {showDoc ? (
              <div className="max-h-52 overflow-y-auto border-b border-gray-100 bg-gray-50 px-4 py-2">
                {FARM_API_DOC.map((d) => (
                  <div key={d.call} className="flex gap-2 py-0.5 text-xs">
                    <code className="shrink-0 font-mono text-emerald-700">{d.call}</code>
                    <span className="text-gray-500">{d.desc}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <textarea
              ref={taRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none border-0 bg-slate-900 p-4 font-mono text-[13px] leading-6 text-slate-100 outline-none"
              placeholder='例如：\nplant("wheat")\nwhile moisture() < 100:\n    water()'
            />

            <div className="border-t border-gray-200 px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <button
                  onClick={run}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <i className="fa-solid fa-play mr-1.5" />
                  {busy ? '执行中…' : '运行'}
                </button>
                <button
                  onClick={() => setCode(DEFAULT_CODE)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  重置示例
                </button>
                <span className="ml-auto text-[11px] text-gray-400">代码保存在本机，不上传</span>
              </div>

              {error ? (
                <div className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <i className="fa-solid fa-circle-exclamation mr-1" />
                  {error}
                </div>
              ) : null}

              {prints.length ? (
                <div className="mb-2 max-h-24 overflow-y-auto rounded-lg bg-slate-100 px-3 py-2 font-mono text-[11px] text-slate-700">
                  {prints.map((p, i) => (
                    <div key={i}>{p}</div>
                  ))}
                </div>
              ) : null}

              {laborUsed !== null ? (
                <div className="mb-2 flex items-center gap-3 rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800">
                  <span>本次消耗劳作 <b>{laborUsed}</b> 次</span>
                  <span className="text-emerald-700/70">今天还剩 <b>{opsLeft}</b> 次</span>
                </div>
              ) : null}

              {events.length ? (
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {events.map((e, i) => (
                    <div key={i} className={`flex items-start gap-1.5 text-xs ${e.ok ? 'text-slate-700' : 'text-amber-700'}`}>
                      <i className={`fa-solid ${e.ok ? 'fa-check' : 'fa-triangle-exclamation'} mt-0.5 text-[10px]`} />
                      <span>{e.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {!error && !events.length && !prints.length ? (
                <p className="text-[11px] leading-5 text-gray-400">
                  提示：每一次农活都花劳作次数（播种 / 除草 / 收获 各 1 次；浇水、施肥按份数算，浇 3 份 = 3 次），
                  今天用完就要等明天。水满了别再浇、肥满了别再施——先读 moisture() / nutrient()，
                  再用 while 浇到刚好，才是高手。
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
