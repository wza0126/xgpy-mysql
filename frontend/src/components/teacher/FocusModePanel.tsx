import React, { useEffect, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { Class } from '../../types';

/**
 * 专注模式配置面板（2026-10-24 从「萌宠配置」整体搬到这里）
 *
 * 为什么搬：专注模式本质是课堂纪律工具，不是萌宠玩法。放在萌宠配置里，
 * 一是难找（老师上课前不会想到去点萌宠），二是和「图层背景」这一栏的定位更接近
 * （都是「学生桌面上显示什么」）。搬过来后归入「图层背景」第三个标签页。
 *
 * 配置存在 pet_config 单行表（历史原因，字段名沿用 focus_mode_*，不迁移表）。
 */

type IconOpt = { id: string; label: string; icon: string };

// 桌面图标显示设置：必须与 store/desktopStore.ts 的 desktopIcons 完全对齐，
// 少一个就意味着那个图标在专注模式下无法隐藏。
// 2026-10-24 补上原先漏掉的「操作题」和「AI讲解」。
const ICON_SHOW_OPTIONS: IconOpt[] = [
  { id: 'learn', label: '学习中心', icon: 'fa-book' },
  { id: 'practice', label: '练习', icon: 'fa-pen-to-square' },
  { id: 'test', label: '测试', icon: 'fa-clipboard-check' },
  { id: 'wpsOp', label: '操作题', icon: 'fa-file-excel' },
  { id: 'wrong', label: '错题集', icon: 'fa-circle-xmark' },
  { id: 'aiExplain', label: 'AI讲解', icon: 'fa-headphones-simple' },
  { id: 'notebook', label: '记事本', icon: 'fa-note-sticky' },
  { id: 'python', label: 'Python编程', icon: 'fa-code' },
  { id: 'apps', label: '应用中心', icon: 'fa-rocket' },
  { id: 'pet', label: '萌宠', icon: 'fa-paw' },
  { id: 'exchange', label: '兑换', icon: 'fa-gift' },
  { id: 'leaderboard', label: '排行榜', icon: 'fa-trophy' },
  { id: 'security', label: '登录安全', icon: 'fa-shield-halved' },
  { id: 'proxyBrowser', label: '上网冲浪', icon: 'fa-earth-asia' },
  { id: 'creative', label: 'AI创意工坊', icon: 'fa-wand-magic-sparkles' },
  { id: 'profile', label: '我的', icon: 'fa-user' },
];

// 快捷入口：点萌宠小按钮后弹出的那一排，比桌面图标多一个「AI答疑」（它是浮动按钮，不是桌面图标）
const QUICK_ACCESS_OPTIONS: IconOpt[] = [
  ...ICON_SHOW_OPTIONS.filter((i) => i.id !== 'profile'),
  { id: 'ai_qa', label: 'AI答疑', icon: 'fa-robot' },
];

const toBool = (v: any) => v !== false && v !== 0 && v !== '0' && v !== null && v !== undefined;

interface FocusState {
  enabled: boolean;
  classes: string[];
  quickAccess: string[];
  show: Record<string, boolean>;
}

const EMPTY: FocusState = {
  enabled: false,
  classes: [],
  quickAccess: ['apps', 'ai_qa', 'notebook'],
  show: ICON_SHOW_OPTIONS.reduce((acc, i) => ({ ...acc, [i.id]: true }), {}),
};

export const FocusModePanel: React.FC = () => {
  const [state, setState] = useState<FocusState>(EMPTY);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: cfg }, { data: cls }] = await Promise.all([
        backendClient.from('pet_config').select('*').maybeSingle(),
        backendClient.from('classes').select('*'),
      ]);
      if (!alive) return;
      if (cls) setClasses(cls as Class[]);
      if (cfg) {
        setConfigId(cfg.id || null);
        const parseArr = (v: any, fallback: string[]) => {
          if (!v) return fallback;
          if (Array.isArray(v)) return v;
          try { return JSON.parse(v); } catch { return fallback; }
        };
        const show: Record<string, boolean> = {};
        ICON_SHOW_OPTIONS.forEach((o) => {
          show[o.id] = toBool(cfg[`focus_mode_show_${o.id}`]);
        });
        setState({
          enabled: cfg.focus_mode_enabled === true || cfg.focus_mode_enabled === 1 || cfg.focus_mode_enabled === '1',
          classes: parseArr(cfg.focus_mode_classes, []),
          quickAccess: parseArr(cfg.focus_mode_quick_access, ['apps', 'ai_qa', 'notebook']),
          show,
        });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const patch = (p: Partial<FocusState>) => {
    setState((prev) => ({ ...prev, ...p }));
    setDirty(true);
  };

  const toggleShow = (id: string) => {
    setState((prev) => {
      const next = { ...prev.show, [id]: !prev.show[id] };
      return { ...prev, show: next };
    });
    setDirty(true);
  };

  const toggleQuick = (id: string) => {
    setState((prev) => ({
      ...prev,
      quickAccess: prev.quickAccess.includes(id)
        ? prev.quickAccess.filter((x) => x !== id)
        : [...prev.quickAccess, id],
    }));
    setDirty(true);
  };

  const toggleClass = (id: string) => {
    setState((prev) => ({
      ...prev,
      classes: prev.classes.includes(id)
        ? prev.classes.filter((x) => x !== id)
        : [...prev.classes, id],
    }));
    setDirty(true);
  };

  const toggleAllClasses = () => {
    setState((prev) => ({
      ...prev,
      classes: prev.classes.length === classes.length ? [] : classes.map((c) => c.id),
    }));
    setDirty(true);
  };

  const save = async () => {
    if (!configId) {
      alert('没有找到萌宠配置记录，请先到「萌宠配置」里保存一次');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        focus_mode_enabled: state.enabled,
        focus_mode_classes: JSON.stringify(state.classes),
        focus_mode_quick_access: JSON.stringify(state.quickAccess),
      };
      ICON_SHOW_OPTIONS.forEach((o) => {
        payload[`focus_mode_show_${o.id}`] = state.show[o.id] ? 1 : 0;
      });
      const { error } = await backendClient.from('pet_config').update(payload).eq('id', configId);
      if (error) {
        alert('保存失败：' + (error.message || JSON.stringify(error)));
        return;
      }
      setDirty(false);
    } catch (e: any) {
      alert('保存失败：' + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <i className="fa-solid fa-circle-notch fa-spin text-2xl text-purple-500"></i>
      </div>
    );
  }

  const showCount = ICON_SHOW_OPTIONS.filter((o) => state.show[o.id]).length;

  return (
    <div className="space-y-6">
      {/* 总开关 + 应用班级 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex-1 pr-4">
            <h3 className="text-lg font-bold text-gray-800">专注模式</h3>
            <p className="text-sm text-gray-500 mt-1">
              开启后，学生桌面只显示指定的图标，萌宠变成左下角一个小按钮。适合课堂做题时用。
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              checked={state.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-14 h-7 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-500"></div>
          </label>
        </div>

        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-2">应用班级（多选）</h4>
          <p className="text-xs text-gray-500 mb-3">
            只对选中的班级生效。一个都不选 = 全部班级都生效。
            个别学生要单独强制专注，请到「学生管理」给他打开「专注」开关。
          </p>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={toggleAllClasses}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {state.classes.length === classes.length && classes.length > 0 ? '取消全选' : '全选'}
            </button>
            <span className="text-sm text-gray-500">
              已选择 {state.classes.length} / {classes.length} 个班级
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {classes.map((cls) => {
              const on = state.classes.includes(cls.id);
              return (
                <button
                  key={cls.id}
                  onClick={() => toggleClass(cls.id)}
                  className={`px-3 py-2 rounded-full text-sm transition-all border-2 ${
                    on
                      ? 'bg-purple-100 text-purple-700 border-purple-300'
                      : 'bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200'
                  }`}
                >
                  {on && <i className="fa-solid fa-check mr-1.5 text-xs"></i>}
                  {cls.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {state.enabled && (
        <>
          {/* 桌面图标显示 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-800">桌面图标显示设置</h3>
                <p className="text-sm text-gray-500 mt-1">
                  勾选的图标在专注模式下仍然显示，未勾选的隐藏。当前显示 {showCount} / {ICON_SHOW_OPTIONS.length} 个。
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    const all: Record<string, boolean> = {};
                    ICON_SHOW_OPTIONS.forEach((o) => { all[o.id] = true; });
                    patch({ show: all });
                  }}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                >
                  全显示
                </button>
                <button
                  onClick={() => {
                    const none: Record<string, boolean> = {};
                    ICON_SHOW_OPTIONS.forEach((o) => { none[o.id] = false; });
                    patch({ show: none });
                  }}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                >
                  全隐藏
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ICON_SHOW_OPTIONS.map((o) => {
                const on = !!state.show[o.id];
                return (
                  <button
                    key={o.id}
                    onClick={() => toggleShow(o.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      on ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <i className={`fa-solid ${o.icon} text-lg ${on ? 'text-purple-600' : 'text-gray-400'}`}></i>
                    <span className={`text-sm ${on ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{o.label}</span>
                    {on && <i className="fa-solid fa-check-circle text-purple-500 ml-auto"></i>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 快捷入口 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-1">快捷入口设置</h3>
            <p className="text-sm text-gray-500 mb-4">点左下角萌宠小按钮后弹出的入口（可多选）</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {QUICK_ACCESS_OPTIONS.map((o) => {
                const on = state.quickAccess.includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggleQuick(o.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      on ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <i className={`fa-solid ${o.icon} text-lg ${on ? 'text-green-600' : 'text-gray-400'}`}></i>
                    <span className={`text-sm ${on ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{o.label}</span>
                    {on && <i className="fa-solid fa-check-circle text-green-500 ml-auto"></i>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 保存条：吸底，长列表下也不用滚回去找按钮 */}
      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-gradient-to-t from-white via-white to-transparent">
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-6 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '保存中...' : dirty ? '保存专注模式设置' : '已保存'}
          </button>
          {dirty && <span className="text-sm text-amber-600">有未保存的修改</span>}
        </div>
      </div>
    </div>
  );
};

export default FocusModePanel;
