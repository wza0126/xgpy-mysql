import React, { useEffect, useState, useCallback } from 'react';
import { backendClient } from '../../api/backendClient';
import { FARM_EXAMPLE_CODE } from '../../utils/farmPython';

// ===== 代码农场 · 教师后台 =====
// 教师在这里开总开关 / 选班级 / 调世界参数；学生桌面 10 秒轮询到后自动进入农场态。
// ⛔ 生长与收获结算全部在服务端（backend/src/farm.js），本页面只负责配置与查看。

interface ClassItem {
  id: string;
  name: string;
}

interface CropItem {
  key: string;
  name: string;
  icon: string;
  yield_mult: number;
}

interface FarmConfigShape {
  enabled: boolean;
  class_ids: string[];
  day_minutes: number;
  base_yield: number;
  max_ops_per_day: number;
  weather: string;
  notice: string;
  /** 编辑器默认代码（空串 = 用内置示例） */
  default_code: string;
  start_at: string | null;
}

interface PlotRow {
  student_id: string;
  name: string;
  username: string;
  class_name: string;
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

interface LogSummary {
  events?: { ok: boolean; text: string }[];
  acted?: number;
  gained?: number;
  harvests?: number;
  days_ticked?: number;
}

interface LogRow {
  id: string;
  student_id: string;
  code: string | null;
  ops: string | null;
  summary: string | null;
  created_at: string;
}

const STAGE_LABEL = ['空地', '幼苗', '成长中', '成熟'];
const STAGE_COLOR = ['#94a3b8', '#86efac', '#22c55e', '#f59e0b'];

const WEATHER_TIPS: Record<string, string> = {
  sunny: '晴天：生长与蒸发都正常，最中规中矩的练习环境',
  rainy: '雨天：生长 +20%、蒸发减半，水肥消耗慢，适合讲「条件不同策略不同」',
  drought: '旱天：生长 −40%、蒸发近两倍，必须勤浇水，适合讲「循环与判断」',
};

function safeParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function fmtTime(v: string | null): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const FarmConfig: React.FC = () => {
  const [tab, setTab] = useState<'config' | 'overview' | 'logs'>('config');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [crops, setCrops] = useState<CropItem[]>([]);
  const [weathers, setWeathers] = useState<{ key: string; label: string }[]>([]);
  const [stats, setStats] = useState({ plots: 0, harvests: 0, points: 0 });

  const [cfg, setCfg] = useState<FarmConfigShape>({
    enabled: false,
    class_ids: [],
    day_minutes: 10,
    base_yield: 10,
    max_ops_per_day: 15,
    weather: 'sunny',
    notice: '',
    default_code: '',
    start_at: null,
  });

  const [overview, setOverview] = useState<PlotRow[]>([]);
  const [ovClass, setOvClass] = useState<string>('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logLimit, setLogLimit] = useState(50);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    window.setTimeout(() => setMsg(null), 3000);
  };

  const loadConfig = useCallback(async () => {
    try {
      const r: any = await backendClient.get('/api/teacher/farm/config');
      const d = r?.data;
      if (d) {
        setCfg({ ...d.config, notice: d.config.notice || '', default_code: d.config.default_code || '' });
        setCrops(d.crops || []);
        setWeathers(d.weathers || []);
        setStats(d.stats || { plots: 0, harvests: 0, points: 0 });
      }
    } catch (e: any) {
      flash('err', e?.message || '读取农场配置失败');
    }
  }, []);

  const loadClasses = useCallback(async () => {
    try {
      const { data } = await backendClient.from('classes').select('*');
      if (Array.isArray(data)) setClasses(data as ClassItem[]);
    } catch {
      // 班级列表失败不影响配置编辑
    }
  }, []);

  const loadOverview = useCallback(async (classId?: string) => {
    try {
      const q = classId ? { class_id: classId } : {};
      const r: any = await backendClient.get('/api/teacher/farm/overview', q);
      setOverview(r?.data?.list || []);
    } catch (e: any) {
      flash('err', e?.message || '读取地块总览失败');
    }
  }, []);

  const loadLogs = useCallback(async (limit?: number) => {
    try {
      const r: any = await backendClient.get('/api/teacher/farm/logs', { limit: limit ?? logLimit });
      setLogs(r?.data?.list || []);
    } catch (e: any) {
      flash('err', e?.message || '读取劳作日志失败');
    }
  }, [logLimit]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadConfig(), loadClasses()]);
      setLoading(false);
    })();
  }, [loadConfig, loadClasses]);

  useEffect(() => {
    if (tab === 'overview') loadOverview(ovClass || undefined);
    if (tab === 'logs') loadLogs(logLimit);
  }, [tab, ovClass, logLimit, loadOverview, loadLogs]);

  const toggleClass = (id: string) => {
    setCfg((c) => {
      const has = c.class_ids.includes(id);
      return { ...c, class_ids: has ? c.class_ids.filter((x) => x !== id) : [...c.class_ids, id] };
    });
  };

  const selectAllClasses = () => {
    setCfg((c) => ({
      ...c,
      class_ids: c.class_ids.length === classes.length ? [] : classes.map((k) => k.id),
    }));
  };

  const save = async (extra?: { reset_world?: boolean }) => {
    if (extra?.reset_world) {
      const yes = window.confirm(
        '确定要「重置世界」吗？\n\n所有学生的地块会被清空（作物、成长、收获次数、农场积分记录清零），\n教师端操作不可撤销，请只在换教学单元时使用。'
      );
      if (!yes) return;
    }
    setSaving(true);
    try {
      await backendClient.put('/api/teacher/farm/config', {
        enabled: cfg.enabled,
        class_ids: cfg.class_ids,
        day_minutes: cfg.day_minutes,
        base_yield: cfg.base_yield,
        max_ops_per_day: cfg.max_ops_per_day,
        weather: cfg.weather,
        notice: cfg.notice,
        default_code: cfg.default_code,
        reset_world: extra?.reset_world === true,
      });
      await loadConfig();
      flash('ok', extra?.reset_world ? '世界已重置' : '已保存，学生桌面会在 10 秒内响应');
    } catch (e: any) {
      flash('err', e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
        <i className="fa-solid fa-spinner fa-spin mr-2" />
        加载农场配置…
      </div>
    );
  }

  const tabs: { key: 'config' | 'overview' | 'logs'; label: string; icon: string }[] = [
    { key: 'config', label: '农场设置', icon: 'fa-sliders' },
    { key: 'overview', label: '全班地块', icon: 'fa-table-cells-large' },
    { key: 'logs', label: '劳作日志', icon: 'fa-scroll' },
  ];

  return (
    <div className="space-y-5">
      {/* 顶部标题 + 开关 */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800">
              <i className="fa-solid fa-seedling text-emerald-600" />
              代码农场
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                桌面即游戏场
              </span>
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              开启后，命中班级的学生桌面会自动切换为农场世界（仍是同一套桌面，图标浮在田野之上）。
              学生写 Python 代码照顾自己的地，生长与收获积分由服务端结算。
            </p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
              className="peer sr-only"
            />
            <div className="peer h-7 w-14 rounded-full bg-gray-300 after:absolute after:left-[4px] after:top-0.5 after:h-6 after:w-6 after:rounded-full after:border after:border-gray-300 after:bg-white after:content-[''] after:transition-all peer-checked:bg-emerald-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500">
          <span className="rounded-lg bg-gray-50 px-2.5 py-1">
            已建地块 <b className="text-gray-800">{stats.plots}</b>
          </span>
          <span className="rounded-lg bg-gray-50 px-2.5 py-1">
            累计收获 <b className="text-gray-800">{stats.harvests}</b> 次
          </span>
          <span className="rounded-lg bg-gray-50 px-2.5 py-1">
            农场发出积分 <b className="text-gray-800">{stats.points}</b>
          </span>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-lg px-4 py-2.5 text-sm ${
            msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          <i className={`fa-solid ${msg.type === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'} mr-2`} />
          {msg.text}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-2 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-emerald-500 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className={`fa-solid ${t.icon}`} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== 设置 ===== */}
      {tab === 'config' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h4 className="mb-1 text-sm font-semibold text-gray-800">生效班级（多选）</h4>
            <p className="mb-3 text-xs text-gray-500">
              只有选中的班级在总开关打开后才会进入农场；不选任何班级 = 对全校学生生效。
            </p>
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={selectAllClasses}
                className="rounded-lg bg-gray-100 px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-200"
              >
                {cfg.class_ids.length === classes.length && classes.length > 0 ? '取消全选' : '全选'}
              </button>
              <span className="text-sm text-gray-500">
                {cfg.class_ids.length === 0 ? '当前：全校生效' : `已选择 ${cfg.class_ids.length} 个班级`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {classes.map((cls) => {
                const on = cfg.class_ids.includes(cls.id);
                return (
                  <label
                    key={cls.id}
                    className={`cursor-pointer rounded-full border-2 px-3 py-2 text-sm transition-all ${
                      on
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleClass(cls.id)} className="sr-only" />
                    {cls.name}
                  </label>
                );
              })}
              {classes.length === 0 && <span className="text-sm text-gray-400">暂无班级数据</span>}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h4 className="mb-3 text-sm font-semibold text-gray-800">世界设定</h4>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">一天时长（分钟）</label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={cfg.day_minutes}
                  onChange={(e) => setCfg({ ...cfg, day_minutes: Number(e.target.value) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-gray-400">越短生长越快；默认 10 分钟一天</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">成熟收获基础积分</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={cfg.base_yield}
                  onChange={(e) => setCfg({ ...cfg, base_yield: Number(e.target.value) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-gray-400">作物倍率：{crops.map((c) => `${c.name}×${c.yield_mult}`).join(' / ')}</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">每天劳作次数上限</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={cfg.max_ops_per_day}
                  onChange={(e) => setCfg({ ...cfg, max_ops_per_day: Number(e.target.value) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  ⛔ 按「动作次数」计，不按提交次数：播种 / 除草 / 收获 各 1 次，浇水、施肥按份数算（浇 3 份 = 3 次）。
                  一茬地从 水50/肥50 到成熟约需 12 次，默认 15。
                </p>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-gray-500">当前天气</label>
              <div className="flex flex-wrap gap-2">
                {weathers.map((w) => (
                  <button
                    key={w.key}
                    onClick={() => setCfg({ ...cfg, weather: w.key })}
                    className={`rounded-lg border-2 px-4 py-2 text-sm transition-all ${
                      cfg.weather === w.key
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">{WEATHER_TIPS[cfg.weather] || ''}</p>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-gray-500">全班公告（学生农场里显示）</label>
              <input
                type="text"
                maxLength={60}
                value={cfg.notice}
                placeholder="例：今天的任务是给旱地作物写自动浇水代码"
                onChange={(e) => setCfg({ ...cfg, notice: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* 编辑器默认代码（学生端「编写农活代码」的起始模板） */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <i className="fa-solid fa-file-code text-emerald-600" />
                编辑器默认代码
              </h4>
              <span className="text-xs text-gray-400">{cfg.default_code.length} / 4000 字</span>
            </div>
            <p className="mb-3 text-xs leading-5 text-gray-500">
              学生在「编写农活代码」窗口里看到的起始代码。可以故意放一段<b>低效率的代码</b>（例如写死份数、
              不带判断的暴力写法），让学生先运行看结果、再动手改好，比凭空写一行更容易上手。
              留空则用内置示例。
              <br />
              学生自己改过的代码不会被覆盖；改了这里之后，<b>没动过代码的学生</b>下次刷新会自动跟随新默认
              （想让全班立刻换题，可让学生点一下编辑器里的「恢复默认代码」）。
            </p>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCfg({ ...cfg, default_code: FARM_EXAMPLE_CODE })}
                className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-200"
              >
                <i className="fa-solid fa-file-import mr-1" />
                载入内置示例
              </button>
              <button
                onClick={() => setCfg({ ...cfg, default_code: '' })}
                className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-200"
              >
                <i className="fa-solid fa-eraser mr-1" />
                清空（改回内置示例）
              </button>
              <span className="text-[11px] text-gray-400">改完别忘了点下面的「保存设置」</span>
            </div>
            <textarea
              value={cfg.default_code}
              onChange={(e) => setCfg({ ...cfg, default_code: e.target.value })}
              spellCheck={false}
              maxLength={4000}
              rows={12}
              placeholder={`留空则用内置示例。例如故意留一份低效率代码让学生改：
plant("wheat")
water(10)
fertilize(10)
harvest()`}
              className="h-64 w-full resize-y overflow-auto rounded-lg border border-gray-300 bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => save()}
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
            >
              <i className="fa-solid fa-floppy-disk mr-2" />
              {saving ? '保存中…' : '保存设置'}
            </button>
            <button
              onClick={() => save({ reset_world: true })}
              disabled={saving}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60"
            >
              <i className="fa-solid fa-rotate-left mr-2" />
              重置世界（清空所有地块）
            </button>
            <span className="text-xs text-gray-400">
              世界起点：{cfg.start_at ? fmtTime(cfg.start_at) : '未开始'}
            </span>
          </div>
        </div>
      )}

      {/* ===== 全班地块 ===== */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <select
              value={ovClass}
              onChange={(e) => setOvClass(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="">全部班级</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => loadOverview(ovClass || undefined)}
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
            >
              <i className="fa-solid fa-rotate mr-1" />
              刷新
            </button>
            <span className="text-xs text-gray-400">共 {overview.length} 块地（最多显示 300）</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">学生</th>
                  <th className="px-3 py-2.5 text-left font-medium">班级</th>
                  <th className="px-3 py-2.5 text-left font-medium">作物</th>
                  <th className="px-3 py-2.5 text-left font-medium">阶段</th>
                  <th className="px-3 py-2.5 text-left font-medium">生长</th>
                  <th className="px-3 py-2.5 text-left font-medium">水 / 肥</th>
                  <th className="px-3 py-2.5 text-right font-medium">收获</th>
                  <th className="px-3 py-2.5 text-right font-medium">积分</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {overview.map((p) => (
                  <tr key={p.student_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{p.name || '-'}</div>
                      <div className="text-xs text-gray-400">{p.username}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{p.class_name || '-'}</td>
                    <td className="px-3 py-2 text-gray-700">{p.crop_name || '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ background: STAGE_COLOR[p.stage] + '22', color: STAGE_COLOR[p.stage] }}
                      >
                        {STAGE_LABEL[p.stage] || '?'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{Math.round(p.growth)}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {Math.round(p.moisture)} / {Math.round(p.nutrient)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">{p.total_harvest}</td>
                    <td className="px-3 py-2 text-right font-medium text-amber-600">{p.total_points}</td>
                  </tr>
                ))}
                {overview.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                      暂无地块数据（学生还没进过农场）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== 劳作日志 ===== */}
      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <select
              value={logLimit}
              onChange={(e) => setLogLimit(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            >
              {[20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  最近 {n} 条
                </option>
              ))}
            </select>
            <button
              onClick={() => loadLogs(logLimit)}
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
            >
              <i className="fa-solid fa-rotate mr-1" />
              刷新
            </button>
            <span className="text-xs text-gray-400">点开可看学生写的代码与结算摘要</span>
          </div>

          <div className="space-y-2">
            {logs.map((l) => {
              const sum = safeParse<LogSummary>(l.summary, {});
              const ops = safeParse<any[]>(l.ops, []);
              const open = expandedLog === l.id;
              return (
                <div key={l.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <button
                    onClick={() => setExpandedLog(open ? null : l.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                  >
                    <i className={`fa-solid ${open ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs text-gray-400`} />
                    <span className="text-sm text-gray-500">{fmtTime(l.created_at)}</span>
                    <span className="font-mono text-xs text-gray-400">{l.student_id.slice(0, 10)}</span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {ops.length} 步操作
                    </span>
                    {typeof sum.gained === 'number' && sum.gained > 0 && (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                        +{sum.gained} 积分
                      </span>
                    )}
                    {sum.days_ticked ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
                        跨 {sum.days_ticked} 天结算
                      </span>
                    ) : null}
                  </button>
                  {open && (
                    <div className="grid grid-cols-1 gap-3 border-t border-gray-100 bg-gray-50/60 p-4 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs font-medium text-gray-500">学生代码</div>
                        <pre className="max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
                          {l.code || '（空）'}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-gray-500">操作序列</div>
                        <pre className="max-h-28 overflow-auto rounded-lg bg-white p-3 text-xs text-gray-700">
                          {JSON.stringify(ops)}
                        </pre>
                        <div className="mb-1 mt-3 text-xs font-medium text-gray-500">结算摘要</div>
                        <pre className="max-h-28 overflow-auto rounded-lg bg-white p-3 text-xs text-gray-700">
                          {JSON.stringify(sum)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {logs.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white py-10 text-center text-gray-400">
                暂无劳作记录
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
