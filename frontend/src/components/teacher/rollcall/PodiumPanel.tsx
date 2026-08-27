// 讲台面板：选中讲台时在右侧显示班级备忘录文本框（可直接编辑保存）
import React, { useState } from 'react';

interface PodiumPanelProps {
  className: string;
  memo: string;
  loading: boolean;
  onMemoChange: (text: string) => void;
  onSave: (memo: string) => Promise<boolean>;
}

export const PodiumPanel: React.FC<PodiumPanelProps> = ({ className, memo, loading, onMemoChange, onSave }) => {
  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSave(memo);
    setSaving(false);
    if (ok) {
      setSavedTip(true);
      setTimeout(() => setSavedTip(false), 2000);
    }
  };

  return (
    <div className="h-full bg-slate-900/50 border-l border-slate-700 flex flex-col">
      {/* 顶部：讲台标题 */}
      <div className="px-4 py-3 border-b border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-slate-500 tracking-wider">PODIUM</span>
          <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] rounded">
            <i className="fa-solid fa-chalkboard-user mr-1"></i>讲台
          </span>
        </div>
      </div>

      {/* 讲台标题区 */}
      <div className="px-4 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-2xl text-white shadow-lg shadow-amber-500/30">
            <i className="fa-solid fa-chalkboard-user"></i>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-slate-100 truncate">讲台</div>
            <div className="text-xs font-mono text-slate-400 truncate">{className || '未选择班级'}</div>
          </div>
        </div>
        <p className="text-xs text-slate-500 flex items-center gap-1">
          <i className="fa-solid fa-circle-info text-cyan-500"></i>
          在这里维护本班的班级备忘录
        </p>
      </div>

      {/* 备忘录编辑区 */}
      <div className="flex-1 px-4 py-4 flex flex-col overflow-hidden">
        <label className="text-[10px] font-mono text-slate-500 mb-1 flex items-center gap-1">
          <i className="fa-solid fa-book-open text-cyan-500"></i>班级备忘录
        </label>
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
            </div>
          ) : (
            <textarea
              value={memo}
              onChange={(e) => onMemoChange(e.target.value)}
              placeholder="记录本班的教学安排、注意事项、待跟进事项等..."
              className="w-full h-full min-h-[160px] bg-slate-800/60 border border-slate-700 rounded p-3 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none resize-none"
            />
          )}
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className={`text-xs text-green-400 transition-opacity ${savedTip ? 'opacity-100' : 'opacity-0'}`}>
            <i className="fa-solid fa-check mr-1"></i>已保存
          </span>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className={`
              px-4 py-2 rounded text-sm flex items-center justify-center gap-1.5 transition-all
              bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/30
              ${saving || loading ? 'opacity-60 cursor-wait' : ''}
            `}
          >
            <i className={`fa-solid ${saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'}`}></i>
            {saving ? '保存中...' : '保存备忘录'}
          </button>
        </div>
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-2 border-t border-slate-700 text-[10px] text-slate-500 font-mono">
        <i className="fa-solid fa-lightbulb mr-1 text-amber-500"></i>
        点选讲台可快速编辑本班备忘录
      </div>
    </div>
  );
};
