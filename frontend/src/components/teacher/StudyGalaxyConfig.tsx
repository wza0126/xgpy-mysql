import React, { useEffect, useState } from 'react';
import { backendClient } from '../../api/backendClient';

// ===== 教师端 · 学习星域图层配置 =====
// 入口：教师后台 → 图层背景 → 学习星域
// 与「代码农场」同一套模式：总开关 + 班级白名单（不选 = 全校）。
// 老机房可以在班级里只勾新机房，避免低配机器掉帧。

interface ClassItem {
  id: string;
  name: string;
}

interface GalaxyCfg {
  enabled: boolean;
  class_ids: string[];
  daily_goal: number;
  tiers: number[];
  tier_names: string[];
  lit_ratio: number;
  /** 低动效模式：关掉星域持续动画，只留静态星空 */
  low_motion: boolean;
}

const TIER_HINT = [
  '只有零散暗星，安静的深空',
  '薄雾浮现，出现第一条星线',
  '星座成线，第一颗行星入轨',
  '银河带贯穿，流星偶尔划过',
  '极光铺开，满屏星海',
];

const EMPTY: GalaxyCfg = {
  enabled: false,
  class_ids: [],
  daily_goal: 30,
  tiers: [0, 50, 200, 500, 1000],
  tier_names: ['星尘', '初亮', '成图', '银河', '星海'],
  lit_ratio: 0.5,
  low_motion: false,
};

export const StudyGalaxyConfig: React.FC = () => {
  const [cfg, setCfg] = useState<GalaxyCfg>(EMPTY);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [stats, setStats] = useState({ today_students: 0, today_answers: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const r: any = await backendClient.get('/api/teacher/study-galaxy/config');
      const d = r?.data || {};
      if (d.config) {
        const t = Array.isArray(d.config.tiers) && d.config.tiers.length === 5
          ? d.config.tiers
          : EMPTY.tiers;
        setCfg({
          enabled: !!d.config.enabled,
          class_ids: Array.isArray(d.config.class_ids) ? d.config.class_ids.map(String) : [],
          daily_goal: Number(d.config.daily_goal) || 30,
          tiers: t.map((x: any) => Number(x) || 0),
          tier_names: Array.isArray(d.config.tier_names) ? d.config.tier_names : EMPTY.tier_names,
          lit_ratio: Number(d.config.lit_ratio) || 0.5,
        low_motion: !!d.config.low_motion,
        });
      }
      if (d.stats) setStats(d.stats);
    } catch (e: any) {
      setMsg({ type: 'err', text: '读取配置失败：' + (e?.message || '未知错误') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    (async () => {
      try {
        const { data } = await backendClient.from('classes').select('*');
        setClasses(
          (data || [])
            .map((c: any) => ({ id: String(c.id), name: String(c.name || c.id) }))
            .sort((a: ClassItem, b: ClassItem) => a.name.localeCompare(b.name, 'zh'))
        );
      } catch {
        // 班级列表失败不影响其余配置
      }
    })();
  }, []);

  const toggleClass = (id: string) =>
    setCfg((c) => ({
      ...c,
      class_ids: c.class_ids.includes(id) ? c.class_ids.filter((x) => x !== id) : [...c.class_ids, id],
    }));

  const selectAllClasses = () =>
    setCfg((c) => ({
      ...c,
      class_ids: c.class_ids.length === classes.length ? [] : classes.map((x) => x.id),
    }));

  const setTier = (i: number, v: number) =>
    setCfg((c) => {
      const t = [...c.tiers];
      t[i] = v;
      return { ...c, tiers: t };
    });

  const save = async () => {
    setMsg(null);
    for (let i = 2; i < 5; i++) {
      if (!(cfg.tiers[i] > cfg.tiers[i - 1])) {
        setMsg({ type: 'err', text: '五档阈值必须严格递增（星尘 0 < 初亮 < 成图 < 银河 < 星海）' });
        return;
      }
    }
    setSaving(true);
    try {
      const r: any = await backendClient.put('/api/teacher/study-galaxy/config', {
        enabled: cfg.enabled,
        class_ids: cfg.class_ids,
        daily_goal: cfg.daily_goal,
        tiers: cfg.tiers,
        low_motion: cfg.low_motion,
      });
      if (r?.error) throw new Error(r.error);
      setMsg({
        type: 'ok',
        text: cfg.enabled
          ? `已保存并开启${cfg.class_ids.length ? `（${cfg.class_ids.length} 个班级）` : '（全校生效）'}`
          : '已保存，图层当前为关闭状态',
      });
    } catch (e: any) {
      setMsg({ type: 'err', text: '保存失败：' + (e?.message || '未知错误') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-gray-500">
        <i className="fa-solid fa-spinner fa-spin" />
        正在读取星域配置…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="mb-1 text-sm font-semibold text-gray-800">总开关</h4>
            <p className="text-xs text-gray-500">
              开启后，命中班级的学生桌面会铺一层「学习星域」：随练习量长出星座与行星。
              图层只做展示、不挡点击，图标仍浮在星域之上。
            </p>
          </div>
          <button
            onClick={() => setCfg((c) => ({ ...c, enabled: !c.enabled }))}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              cfg.enabled ? 'bg-emerald-500' : 'bg-gray-300'
            }`}
            aria-label="切换总开关"
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                cfg.enabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <i className="fa-solid fa-circle-info mr-1.5" />
          星域开启时，学生桌面<b>不再请求背景图</b>（改用内置深空底色），可省掉每台机器每 30 秒一次的图片流量。
          老机房想保留原壁纸，就别把该班选进来。
        </div>
      </div>

      {/* 低动效模式：机房机器卡顿时的应急开关（2026-10-24 加） */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="mb-1 text-sm font-semibold text-gray-800">低动效模式</h4>
            <p className="text-xs text-gray-500">
              开启后关掉星域的闪烁、呼吸、流星、极光等持续动画，只保留静态星空与星座。
              星星密度和档位颜色都不变，只是「不动了」。
              <b className="text-amber-700">上课时学生电脑明显卡顿时，打开这个能立刻省掉一大截 CPU。</b>
            </p>
          </div>
          <button
            onClick={() => setCfg((c) => ({ ...c, low_motion: !c.low_motion }))}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              cfg.low_motion ? 'bg-sky-500' : 'bg-gray-300'
            }`}
            aria-label="切换低动效模式"
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                cfg.low_motion ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h4 className="mb-1 text-sm font-semibold text-gray-800">生效班级（多选）</h4>
        <p className="mb-3 text-xs text-gray-500">
          只有选中的班级才会显示星域；不选任何班级 = 对全校学生生效。建议只勾新机房。
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
        <h4 className="mb-1 text-sm font-semibold text-gray-800">今日目标</h4>
        <p className="mb-3 text-xs text-gray-500">
          学生桌面右侧进度环按这个题数算。只统计当天作答次数（含答错）。
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={500}
            value={cfg.daily_goal}
            onChange={(e) => setCfg((c) => ({ ...c, daily_goal: Math.max(1, Number(e.target.value) || 1) }))}
            className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <span className="text-sm text-gray-500">题 / 天</span>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h4 className="mb-1 text-sm font-semibold text-gray-800">五档阈值（累计作答次数）</h4>
        <p className="mb-3 text-xs text-gray-500">
          档位只看累计作答次数（允许多次练同一题），<b>只升不降</b>，学生不会因为某天没练就掉档。
          星尘固定从 0 开始，后面四档必须严格递增。
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {cfg.tiers.map((v, i) => (
            <div key={i} className="rounded-lg border border-gray-200 px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">{cfg.tier_names[i] || `第 ${i + 1} 档`}</span>
                <span className="text-[11px] text-gray-400">档 {i + 1}</span>
              </div>
              <input
                type="number"
                min={i === 0 ? 0 : cfg.tiers[i - 1] + 1}
                max={1000000}
                value={v}
                disabled={i === 0}
                onChange={(e) => setTier(i, Math.max(0, Number(e.target.value) || 0))}
                className={`w-full rounded border px-2 py-1 text-sm ${
                  i === 0 ? 'border-gray-200 bg-gray-100 text-gray-400' : 'border-gray-300'
                }`}
              />
              <div className="mt-1 text-[11px] leading-snug text-gray-400">{TIER_HINT[i]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h4 className="mb-2 text-sm font-semibold text-gray-800">知识点点亮规则</h4>
        <ul className="space-y-1 text-xs text-gray-600">
          <li>
            · 星座 = 16 个章，星点 = 该章下的小节（AI 聚类的 <code className="rounded bg-gray-100 px-1">cluster_id</code> 二级）。
          </li>
          <li>
            · 小节点亮 = 该知识点里达到掌握阈值的题目占比 ≥ {Math.round((cfg.lit_ratio || 0.5) * 100)}%；
            章点亮 = 该章所有小节都点亮。
          </li>
          <li>· 掌握只算「练习」来源的作答，测试/考试答对不计入，避免考前刷一遍就全亮。</li>
          <li>· 今日全校已有 {stats.today_students} 名学生作答 {stats.today_answers} 次。</li>
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存配置'}
        </button>
        {msg && (
          <span className={`text-sm ${msg.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>
        )}
      </div>
    </div>
  );
};

export default StudyGalaxyConfig;
