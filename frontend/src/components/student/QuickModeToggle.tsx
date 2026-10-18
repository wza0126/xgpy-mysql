import React from 'react';

interface QuickModeToggleProps {
  quickMode: boolean;
  onToggle: () => void;
}

// 「快速模式」开关：放在练习组件底部按钮行最左侧（提交/AI 按钮左边）。
// 鼠标悬浮弹出用法说明；点击切换开/关，偏好由 useQuickMode 持久化到 localStorage。
export const QuickModeToggle: React.FC<QuickModeToggleProps> = ({ quickMode, onToggle }) => (
  <div className="relative group flex items-center flex-shrink-0">
    <button
      type="button"
      onClick={onToggle}
      title="快速模式"
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
        quickMode
          ? 'bg-blue-50 border-blue-400 text-blue-700'
          : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'
      }`}
    >
      <i className={`fa-solid fa-bolt ${quickMode ? 'text-blue-500' : 'text-gray-400'}`}></i>
      快速模式
      {/* 滑动小开关 */}
      <span
        className={`relative inline-block w-8 h-4 rounded-full transition-colors ${
          quickMode ? 'bg-blue-500' : 'bg-gray-300'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${
            quickMode ? 'left-4' : 'left-0.5'
          }`}
        ></span>
      </span>
    </button>

    {/* 悬浮说明弹窗（向上展开） */}
    <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg bg-gray-900 text-white text-xs leading-relaxed p-3 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
      <div className="font-bold text-yellow-300 mb-1.5">
        <i className="fa-solid fa-bolt mr-1"></i>
        快速模式{quickMode ? '(已开启)' : '(已关闭)'}
      </div>
      <ul className="space-y-1">
        <li>· 单选题：点一下选项，立即判分</li>
        <li>· 填空题：输入完按回车，立即判分</li>
        <li>· 看完解析按回车：直接进入下一题</li>
      </ul>
      <div className="mt-1.5 pt-1.5 border-t border-white/20 text-gray-300">
        关闭后恢复传统方式：选好答案点「提交答案」
      </div>
      {/* 指向开关的小箭头 */}
      <div className="absolute top-full left-6 w-0 h-0 border-8 border-transparent border-t-gray-900"></div>
    </div>
  </div>
);
