import React, { useEffect, useState } from 'react';
import { FarmConfig } from './FarmConfig';
import { StudyGalaxyConfig } from './StudyGalaxyConfig';

// ===== 教师后台 · 图层背景 =====
// 「壁纸之上、桌面图标之下」的装饰层统一入口。
// 目前两层：
//   1) 代码农场 —— 桌面即游戏场，学生写 Python 照顾地块
//   2) 学习星域 —— 随练习量成长的反馈层（星座 = 章，星点 = 小节）
// 两层互斥显示（农场开启时星域隐藏），所以放在同一个页面里配置最不容易漏。

type TabKey = 'farm' | 'galaxy';

const TABS: { key: TabKey; label: string; icon: string; desc: string }[] = [
  { key: 'farm', label: '代码农场', icon: 'fa-seedling', desc: '桌面即游戏场：播种、浇水、施肥、收获' },
  { key: 'galaxy', label: '学习星域', icon: 'fa-star', desc: '随练习量成长的星域，点亮知识点星座' },
];

const STORAGE_KEY = 'xgpy:layer-bg-tab';

export const LayerBackground: React.FC = () => {
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'galaxy' || saved === 'farm' ? saved : 'farm';
    } catch {
      return 'farm';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, tab);
    } catch {
      // 隐私模式忽略
    }
  }, [tab]);

  return (
    <div>
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm transition-all ${
                  on
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <i className={`fa-solid ${t.icon}`} />
                {t.label}
              </button>
            );
          })}
          <span className="ml-1 text-xs text-gray-400">
            图层铺在壁纸之上、桌面图标之下，不遮挡点击
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-500">{TABS.find((t) => t.key === tab)?.desc}</p>
      </div>

      {tab === 'farm' ? <FarmConfig /> : <StudyGalaxyConfig />}
    </div>
  );
};

export default LayerBackground;
