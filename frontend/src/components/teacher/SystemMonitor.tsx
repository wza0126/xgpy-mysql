import React, { useCallback, useEffect, useRef, useState } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 教师端「运行状态」仪表台。
 *
 * 折叠时只占 header 右侧一个小胶囊（CPU / 内存 / 请求速率），点开才拉详细数据：
 * 进程信息、系统 CPU / 内存 / 磁盘、数据库连接池、实时流量、Top 接口、最近 30 分钟趋势。
 *
 * 刷新节奏：展开 5 秒、折叠 30 秒（折叠时没必要频繁打扰后端）；
 * 展开状态记在 localStorage，下次进来还是上次的样子。
 */

interface TopItem {
  key: string;
  n: number;
  avgMs: number;
  maxMs: number;
}

interface SysStatus {
  serverTime: string;
  app: {
    version: string;
    commit: string;
    buildTime: string;
    pid: number;
    uptimeSec: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    nodeVersion: string;
  };
  system: {
    hostname: string;
    platform: string;
    cpuModel: string;
    cpuCount: number;
    cpuPercent: number | null;
    memTotalMb: number;
    memFreeMb: number;
    memUsedMb: number;
    memPercent: number;
    disk: { totalGb: number; freeGb: number; usedGb: number; percent: number } | null;
    osUptimeSec: number;
  };
  traffic: {
    at: number;
    windowSecs: number;
    req: number;
    perSec: number;
    slow: number;
    errors: number;
    eluP99: number;
    eluMax: number;
    cpuPct: number;
    rssMb: number;
    heapMb: number;
    conns: number;
    top: TopItem[];
  } | null;
  pool: { total: number | null; free: number | null; queued: number | null; limit: number } | null;
  history: { t: string; req: number; rss: number; cpu: number; p99: number; slow: number; errors: number }[];
}

const OPEN_KEY = 'xgpy_sysmon_open';

/** 秒 -> 「3 天 4 小时」「2 小时 15 分」 */
function fmtUptime(sec: number): string {
  if (!sec || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

function barColor(pct: number | null): string {
  if (pct == null) return 'bg-gray-300';
  if (pct >= 85) return 'bg-rose-500';
  if (pct >= 65) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function textColor(pct: number | null): string {
  if (pct == null) return 'text-gray-400';
  if (pct >= 85) return 'text-rose-600';
  if (pct >= 65) return 'text-amber-600';
  return 'text-emerald-600';
}

const Bar: React.FC<{ label: string; pct: number | null; detail: string }> = ({ label, pct, detail }) => (
  <div>
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${textColor(pct)}`}>{pct == null ? '—' : `${pct}%`}</span>
    </div>
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
        style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%` }}
      />
    </div>
    <p className="mt-0.5 text-[11px] text-gray-400">{detail}</p>
  </div>
);

/** 迷你趋势线（只用一条折线，不引图表库） */
const Spark: React.FC<{ values: number[]; color: string; height?: number }> = ({ values, color, height = 28 }) => {
  if (!values.length) return <div style={{ height }} className="text-[11px] text-gray-300">暂无数据</div>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const w = 100;
  const pts = values
    .map((v, i) => {
      const x = values.length === 1 ? 0 : (i / (values.length - 1)) * w;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export const SystemMonitor: React.FC = () => {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [data, setData] = useState<SysStatus | null>(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res: any = await backendClient.get('/api/teacher/system-status');
      const payload = res?.data ?? res;
      if (!payload || !payload.app) throw new Error('返回数据为空');
      setData(payload as SysStatus);
      setError('');
      setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (e) {
      setError((e as Error)?.message || '读取失败');
    }
  }, []);

  useEffect(() => {
    load();
    const ms = open ? 5000 : 30000;
    const t = window.setInterval(() => { if (!paused) load(); }, ms);
    return () => window.clearInterval(t);
  }, [open, paused, load]);

  // 点面板外部自动收起
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(ev.target as Node)) {
        setOpen(false);
        localStorage.setItem(OPEN_KEY, '0');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(OPEN_KEY, next ? '1' : '0');
  };

  const cpu = data?.system.cpuPercent ?? null;
  const memPct = data?.system.memPercent ?? null;
  const perSec = data?.traffic?.perSec ?? 0;
  const rss = data?.app.rssMb ?? null;
  const traffic = data?.traffic;
  const pool = data?.pool;
  const hist = data?.history || [];

  const alertLevel = (cpu != null && cpu >= 85) || (memPct != null && memPct >= 90) || (data?.system.disk?.percent ?? 0) >= 92;

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={toggle}
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
          alertLevel
            ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
        }`}
        title="运行状态（点击展开/收起）"
      >
        <i className={`fa-solid ${alertLevel ? 'fa-triangle-exclamation' : 'fa-gauge-high'} text-[13px]`}></i>
        <span className="hidden sm:inline">运行状态</span>
        <span className="tabular-nums">CPU {cpu == null ? '—' : `${cpu}%`}</span>
        <span className="text-gray-300">|</span>
        <span className="tabular-nums">内存 {memPct == null ? '—' : `${memPct}%`}</span>
        {traffic && (
          <>
            <span className="text-gray-300">|</span>
            <span className="tabular-nums">{perSec}/s</span>
          </>
        )}
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-[10px] text-gray-400`}></i>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <i className="fa-solid fa-server text-gray-400"></i>
              <span className="font-medium text-gray-700">
                {data ? `v${data.app.version} · PID ${data.app.pid}` : '读取中…'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200"
                title={paused ? '继续自动刷新' : '暂停自动刷新'}
              >
                <i className={`fa-solid ${paused ? 'fa-play' : 'fa-pause'} mr-1`}></i>
                {paused ? '继续' : '暂停'}
              </button>
              <button
                type="button"
                onClick={load}
                className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200"
                title="立即刷新"
              >
                <i className="fa-solid fa-rotate mr-1"></i>刷新
              </button>
            </div>
          </div>

          {error && (
            <div className="border-b border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-600">
              <i className="fa-solid fa-circle-exclamation mr-1"></i>
              {error}
            </div>
          )}

          <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
            {/* 系统资源 */}
            <section className="space-y-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">本机资源</p>
              <Bar
                label="系统 CPU"
                pct={cpu}
                detail={data ? `${data.system.cpuCount} 核 · ${data.system.cpuModel || '未知型号'}` : ''}
              />
              <Bar
                label="系统内存"
                pct={memPct}
                detail={
                  data
                    ? `已用 ${data.system.memUsedMb} MB / 共 ${data.system.memTotalMb} MB（可用 ${data.system.memFreeMb} MB）`
                    : ''
                }
              />
              <Bar
                label="系统盘"
                pct={data?.system.disk?.percent ?? null}
                detail={
                  data?.system.disk
                    ? `已用 ${data.system.disk.usedGb} GB / 共 ${data.system.disk.totalGb} GB（剩余 ${data.system.disk.freeGb} GB）`
                    : '无法读取'
                }
              />
              <Bar
                label="应用内存（RSS）"
                pct={rss != null ? Math.min(100, Math.round((rss / 1024) * 100)) : null}
                detail={
                  data
                    ? `RSS ${data.app.rssMb} MB · 堆 ${data.app.heapUsedMb}/${data.app.heapTotalMb} MB · 已运行 ${fmtUptime(data.app.uptimeSec)}`
                    : ''
                }
              />
            </section>

            {/* 实时流量 */}
            {traffic && (
              <section className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">实时流量（本分钟）</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { v: traffic.req, l: '请求数', cls: 'text-gray-800' },
                    { v: `${traffic.perSec}/s`, l: '速率', cls: 'text-gray-800' },
                    { v: traffic.slow, l: '慢请求', cls: traffic.slow > 0 ? 'text-amber-600' : 'text-gray-800' },
                    { v: traffic.errors, l: '5xx', cls: traffic.errors > 0 ? 'text-rose-600' : 'text-gray-800' },
                  ].map((x) => (
                    <div key={x.l} className="rounded-lg bg-gray-50 py-1.5">
                      <p className={`text-sm font-semibold tabular-nums ${x.cls}`}>{x.v}</p>
                      <p className="text-[10px] text-gray-400">{x.l}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 py-1.5">
                    <p className={`text-sm font-semibold tabular-nums ${traffic.eluP99 > 100 ? 'text-amber-600' : 'text-gray-800'}`}>
                      {traffic.eluP99}ms
                    </p>
                    <p className="text-[10px] text-gray-400">事件循环 p99</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 py-1.5">
                    <p className="text-sm font-semibold tabular-nums text-gray-800">{traffic.conns}</p>
                    <p className="text-[10px] text-gray-400">socket 连接</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 py-1.5">
                    <p className="text-sm font-semibold tabular-nums text-gray-800">
                      {pool && pool.total != null ? `${pool.total}/${pool.limit}` : '—'}
                    </p>
                    <p className="text-[10px] text-gray-400">数据库连接</p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400">
                  CPU / 事件循环为每分钟整点采样值；请求数与 Top 接口是实时累计（{updatedAt || '—'} 更新）
                </p>
              </section>
            )}

            {/* 趋势 */}
            {hist.length > 1 && (
              <section className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  近 {hist.length} 分钟趋势
                </p>
                <div className="space-y-1 rounded-lg bg-gray-50 p-2">
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[10px] text-gray-400">请求/分</span>
                    <div className="min-w-0 flex-1"><Spark values={hist.map((h) => h.req)} color="#6366f1" /></div>
                    <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-gray-500">
                      {hist[hist.length - 1].req}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[10px] text-gray-400">内存 MB</span>
                    <div className="min-w-0 flex-1"><Spark values={hist.map((h) => h.rss)} color="#10b981" /></div>
                    <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-gray-500">
                      {hist[hist.length - 1].rss}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[10px] text-gray-400">CPU %</span>
                    <div className="min-w-0 flex-1"><Spark values={hist.map((h) => h.cpu)} color="#f59e0b" /></div>
                    <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-gray-500">
                      {hist[hist.length - 1].cpu}%
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* Top 接口 */}
            {traffic && traffic.top.length > 0 && (
              <section className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">本分钟最忙接口</p>
                <div className="space-y-0.5 rounded-lg bg-gray-50 p-1.5">
                  {traffic.top.slice(0, 6).map((t) => (
                    <div key={t.key} className="flex items-center justify-between gap-2 px-1 py-0.5 text-[11px]">
                      <span className="truncate text-gray-600" title={t.key}>{t.key}</span>
                      <span className="shrink-0 tabular-nums text-gray-500">
                        {t.n} 次 · {t.avgMs}ms
                        {t.maxMs > t.avgMs * 3 && <span className="ml-1 text-amber-600">峰 {t.maxMs}ms</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data && (
              <p className="border-t border-gray-100 pt-2 text-[10px] leading-4 text-gray-400">
                {data.system.hostname} · {data.system.platform} · Node {data.app.nodeVersion}
                <br />
                构建 {data.app.commit}（{new Date(data.app.buildTime).toLocaleString('zh-CN', { hour12: false })}）
                · 系统已开机 {fmtUptime(data.system.osUptimeSec)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
