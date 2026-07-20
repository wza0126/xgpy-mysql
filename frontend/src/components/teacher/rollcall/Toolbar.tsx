import React from 'react';
import { Class } from '../../../types';
import { RollCallMode } from '../../../hooks/useRollCall';

interface ToolbarProps {
  classes: Class[];
  selectedClassId: string | null;
  onSelectClass: (id: string) => void;
  isLocked: boolean;
  isSaving: boolean;
  onAutoArrange: () => void;
  onReverseArrange: () => void;
  onToggleLock: () => void;
  onClearAll: () => void;
  onRandomRollCall: () => void;
  onAttendance: () => void;
  rollCallCount: number;
  onRollCallCountChange: (count: number) => void;
  onlineCount: number;
  totalCount: number;
  assignedCount: number;
  onClose?: () => void;
  hideClassSelector?: boolean;
  mode?: RollCallMode;
  ipRestriction?: boolean;
  onBindAllIp?: () => void;
  onToggleIpRestriction?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  classes,
  selectedClassId,
  onSelectClass,
  isLocked,
  isSaving,
  onAutoArrange,
  onReverseArrange,
  onToggleLock,
  onClearAll,
  onRandomRollCall,
  onAttendance,
  rollCallCount,
  onRollCallCountChange,
  onlineCount,
  totalCount,
  assignedCount,
  onClose,
  hideClassSelector = false,
  mode = 'teacher',
  ipRestriction = false,
  onBindAllIp,
  onToggleIpRestriction,
}) => {
  const currentClass = classes.find((c) => c.id === selectedClassId);
  // 学生端（课代表/班长）：仅保留反向排座和考勤记录
  const isStudent = mode === 'student';

  return (
    <div className="flex items-center justify-between px-5 py-3 bg-slate-900/80 border-b border-slate-700 backdrop-blur">
      {/* 左：标题 + 班级选择 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-hand-pointer text-cyan-400 text-lg"></i>
          <h2
            className="text-xl font-bold text-slate-100"
            style={{ fontFamily: "'Cormorant Garamond', 'Songti SC', serif" }}
          >
            课堂点名
          </h2>
        </div>

        {!hideClassSelector && <div className="h-6 w-px bg-slate-700"></div>}

        {hideClassSelector ? (
          <span className="text-sm text-cyan-300 font-medium">
            {currentClass?.name || '加载中...'}
          </span>
        ) : (
          <select
            value={selectedClassId || ''}
            onChange={(e) => onSelectClass(e.target.value)}
            className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="" disabled>
              选择班级...
            </option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {isSaving && (
          <span className="text-[10px] font-mono text-cyan-300 flex items-center gap-1">
            <i className="fa-solid fa-circle-notch fa-spin"></i>保存中
          </span>
        )}
      </div>

      {/* 中：实时统计 */}
      <div className="flex items-center gap-4 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-cyan-400 shadow shadow-cyan-400"></span>
          <span className="text-slate-400">在线</span>
          <span className="text-cyan-300 font-bold">{onlineCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-400 shadow shadow-red-400"></span>
          <span className="text-slate-400">缺席</span>
          <span className="text-red-300 font-bold">{assignedCount - onlineCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">已排</span>
          <span className="text-amber-300 font-bold">{assignedCount}</span>
          <span className="text-slate-600">/ {totalCount}</span>
        </div>
        {!isStudent && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">锁定</span>
            <span className={isLocked ? 'text-red-300 font-bold' : 'text-slate-500'}>
              {isLocked ? '已锁定' : '未锁定'}
            </span>
          </div>
        )}
      </div>

      {/* 右：操作按钮 */}
      <div className="flex items-center gap-2">
        {/* 反向排座 - 师生都可 */}
        <button
          onClick={onReverseArrange}
          disabled={!selectedClassId}
          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded flex items-center gap-1.5 transition-colors"
        >
          <i className="fa-solid fa-arrow-rotate-right"></i>
          反向排座
        </button>

        {/* 自动排座 - 仅教师 */}
        {!isStudent && (
          <button
            onClick={onAutoArrange}
            disabled={!selectedClassId || isLocked}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded flex items-center gap-1.5 transition-colors"
          >
            <i className="fa-solid fa-wand-magic-sparkles"></i>
            自动排座
          </button>
        )}

        <div className="h-6 w-px bg-slate-700"></div>

        {/* 随机点名 - 师生都可 */}
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max={onlineCount}
            value={rollCallCount}
            onChange={(e) => onRollCallCountChange(Math.max(1, Math.min(onlineCount, parseInt(e.target.value) || 1)))}
            className="w-16 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200 focus:outline-none focus:border-cyan-500 text-center"
          />
          <button
            onClick={onRandomRollCall}
            disabled={!selectedClassId || onlineCount < 1}
            className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded flex items-center gap-1.5 transition-all shadow-lg shadow-amber-500/30"
          >
            <i className="fa-solid fa-shuffle"></i>
            随机点名
          </button>
        </div>

        <div className="h-6 w-px bg-slate-700"></div>

        {/* 考勤记录 - 师生都可 */}
        <button
          onClick={onAttendance}
          disabled={!selectedClassId}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded flex items-center gap-1.5 transition-colors"
        >
          <i className="fa-solid fa-clipboard-check"></i>
          考勤记录
        </button>

        {/* IP 绑定与登录限制 - 仅教师 */}
        {!isStudent && onBindAllIp && onToggleIpRestriction && (
          <>
            <div className="h-6 w-px bg-slate-700"></div>
            <button
              onClick={() => {
                if (!confirm('将本班所有在线学生的当前IP绑定到座位，覆盖已有绑定，继续？')) return;
                onBindAllIp();
              }}
              disabled={!selectedClassId}
              className="px-3 py-1.5 bg-slate-800 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 text-xs rounded flex items-center gap-1.5 border border-slate-700 hover:border-cyan-500/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="将本班所有在线学生的当前IP绑定到座位"
            >
              <i className="fa-solid fa-link"></i>
              一键绑定IP
            </button>

            <button
              onClick={onToggleIpRestriction}
              disabled={!selectedClassId}
              className={`
                px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors border
                ${
                  ipRestriction
                    ? 'bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }
                ${!selectedClassId ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              title="开启后学生须从绑定IP的座位登录，否则将被强制退出"
            >
              <i className="fa-solid fa-network-wired"></i>
              登录限制
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  ipRestriction ? 'bg-red-500/30 text-red-200' : 'bg-slate-700 text-slate-400'
                }`}
              >
                {ipRestriction ? '开' : '关'}
              </span>
            </button>
          </>
        )}

        {/* 锁定布局、清空 - 仅教师 */}
        {!isStudent && (
          <>
            <div className="h-6 w-px bg-slate-700"></div>
            <button
              onClick={onToggleLock}
              disabled={!selectedClassId}
              className={`
                px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors
                ${
                  isLocked
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }
                ${!selectedClassId ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <i className={`fa-solid ${isLocked ? 'fa-lock' : 'fa-lock-open'}`}></i>
              {isLocked ? '解锁布局' : '锁定布局'}
            </button>

            <button
              onClick={onClearAll}
              disabled={!selectedClassId || isLocked}
              className="px-3 py-1.5 bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 text-xs rounded flex items-center gap-1.5 border border-slate-700 hover:border-red-500/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-eraser"></i>
              清空
            </button>
          </>
        )}

        {onClose && (
          <>
            <div className="h-6 w-px bg-slate-700"></div>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded flex items-center gap-1.5"
              title="关闭点名窗口"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
