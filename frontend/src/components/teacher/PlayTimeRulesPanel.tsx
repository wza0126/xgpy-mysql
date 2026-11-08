import React, { useEffect, useState } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 游戏时间规则（老师端 · 应用管理页顶部）
 * ============================================================
 * 这四个数字决定「学生要做多少题才能玩多久」。⛔ 不要写死在代码里 ——
 * 每个班的情况不同，吴老需要随时微调，改完立即生效（存 system_config）。
 *
 * 换算关系：学习 2 份时间 → 玩耍 1 份时间（吴老 2026-11-08 定）
 *   约 25 题（≈6-10 分钟）及格 = 1 颗钻石 = 5 分钟游戏时间
 */

type Rules = {
  diamond_to_minutes: number;
  daily_earn_cap: number;
  daily_minutes_cap: number;
  max_exchange_minutes: number;
};

const FIELDS: Array<{ key: keyof Rules; label: string; unit: string; hint: string; min: number; max: number }> = [
  {
    key: 'diamond_to_minutes', label: '1 颗钻石换多少分钟', unit: '分钟',
    hint: '建议 5 分钟：约 25 题（6-10 分钟）换 5 分钟玩，接近 2:1', min: 1, max: 60,
  },
  {
    key: 'daily_earn_cap', label: '每日最多能赚钻石', unit: '颗',
    hint: '只算测试/考试/任务，老师手动发放不受限；设 0 表示不限制', min: 0, max: 50,
  },
  {
    key: 'daily_minutes_cap', label: '每日最多能玩', unit: '分钟',
    hint: '防攒一周猛玩一下午；设 0 表示不限制', min: 0, max: 240,
  },
  {
    key: 'max_exchange_minutes', label: '单次最多兑换', unit: '分钟',
    hint: '一次最多换多少，防止换错量', min: 1, max: 120,
  },
];

export const PlayTimeRulesPanel: React.FC = () => {
  const [rules, setRules] = useState<Rules | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r: any = await backendClient.get('/api/teacher/playtime/rules');
      if (r?.data) setRules(r.data);
    } catch { /* 读取失败不阻塞页面 */ }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!rules || saving) return;
    setSaving(true);
    try {
      const r: any = await backendClient.post('/api/teacher/playtime/rules', rules);
      if (r?.error) { alert(r.error); return; }
      if (r?.data) setRules(r.data);
      alert('已保存，立即生效（学生刷新页面后按新规则执行）');
    } catch (e: any) {
      alert('保存失败：' + (e?.message || '请重试'));
    } finally {
      setSaving(false);
    }
  };

  if (!rules) return null;

  return (
    <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <i className="fa-solid fa-hourglass-half text-sky-500"></i>
        <span className="font-medium text-sky-800">游戏时间规则</span>
        <span className="text-xs text-sky-600">
          1 颗钻石 = {rules.diamond_to_minutes} 分钟 · 每日最多赚 {rules.daily_earn_cap} 颗 · 每日最多玩 {rules.daily_minutes_cap} 分钟
        </span>
        <i className={`fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'} ml-auto text-sky-400 text-xs`}></i>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <p className="text-xs text-gray-500 mb-4">
            学生的游戏时间只能用钻石兑换（不能用积分）。开启方式：在下面的应用列表里，把某个应用的
            「价格类型」改成「按时长」，它就会开始消耗这里的时间。
          </p>

          <div className="grid grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    value={rules[f.key]}
                    onChange={(e) => {
                      const v = Math.max(f.min, Math.min(f.max, parseInt(e.target.value) || 0));
                      setRules({ ...rules, [f.key]: v });
                    }}
                    className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-center"
                  />
                  <span className="text-sm text-gray-500">{f.unit}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{f.hint}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 bg-white/70 rounded-lg p-3 text-xs text-gray-500 space-y-1">
            <p className="font-medium text-gray-600 mb-1">学生端的计时行为（改参数不会改变这些）</p>
            <p>· 只有「按时长」的应用、且它是学生当前操作的窗口时才计时，每 30 秒扣一次。</p>
            <p>· 学生关掉窗口、最小化，或点一下别的窗口，立刻停止扣时——不会出现「没在玩还在扣」。</p>
            <p>· 切到浏览器其他标签页时，那一次不扣。</p>
            <p>· 时长池全局共用，不按应用分池；余额不清零，可以攒到以后用。</p>
            <p>· 时长用完或当天额度用完，应用会自动关闭并弹出提示。</p>
          </div>

          <div className="flex justify-end mt-4">
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存规则'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayTimeRulesPanel;
