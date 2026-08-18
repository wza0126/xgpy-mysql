import React, { useState } from 'react';
import { LessonView } from './keyboard-galaxy/LessonView';
import { SingleGame } from './keyboard-galaxy/SingleGame';
import { DuelLobby } from './keyboard-galaxy/DuelLobby';
import { LeaderboardView } from './keyboard-galaxy/LeaderboardView';

type Tab = 'lesson' | 'single' | 'duel' | 'leaderboard';

export const TypingTrainer: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [tab, setTab] = useState<Tab>('lesson');

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'lesson', label: '指法学堂', icon: 'fa-graduation-cap' },
    { key: 'single', label: '单人游戏', icon: 'fa-rocket' },
    { key: 'duel', label: '双人对战', icon: 'fa-people-arrows' },
    { key: 'leaderboard', label: '排行榜', icon: 'fa-trophy' },
  ];

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-[#0B1026] via-[#141B3D] to-[#1A1035] text-gray-100 overflow-hidden relative">
      {/* 星空装饰 */}
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,.7) 0, transparent 100%), radial-gradient(1px 1px at 70% 15%, rgba(255,255,255,.6) 0, transparent 100%), radial-gradient(1.5px 1.5px at 45% 65%, rgba(232,199,102,.7) 0, transparent 100%), radial-gradient(1px 1px at 85% 50%, rgba(255,255,255,.5) 0, transparent 100%)' }}></div>

      {/* 顶栏 */}
      <div className="shrink-0 px-4 py-2 flex items-center gap-3 border-b border-indigo-500/20 bg-black/20 backdrop-blur relative z-10">
        <span className="text-xl">⌨️</span>
        <span className="font-bold text-amber-300 tracking-widest">键盘星域</span>
        <div className="ml-4 flex items-center gap-1.5">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === t.key
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-900/40'
                  : 'bg-white/5 hover:bg-white/10 text-indigo-200'
              }`}
            >
              <i className={`fa-solid ${t.icon} mr-1.5`}></i>{t.label}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto px-2.5 py-1 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-gray-300 transition-colors"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto relative z-10">
        {tab === 'lesson' && <LessonView />}
        {tab === 'single' && <SingleGame />}
        {tab === 'duel' && <DuelLobby onEnterGame={() => {}} />}
        {tab === 'leaderboard' && <LeaderboardView />}
      </div>
    </div>
  );
};
