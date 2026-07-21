import React from 'react';
import { RollCallStudent, RollCallMode } from '../../../hooks/useRollCall';

interface StudentDetailPanelProps {
  student: RollCallStudent | null;
  seatNumber: number | null;
  isSeatLocked: boolean;
  isLayoutLocked: boolean;
  mode?: RollCallMode;
  onRemoteControl: () => void;
  onUnassign: () => void;
  onToggleSeatLock: () => void;
  onBindIp?: (studentId: string, action: 'bind' | 'unbind') => void;
  onToggleBrowser?: (studentId: string, canUse: boolean) => void;
}

export const StudentDetailPanel: React.FC<StudentDetailPanelProps> = ({
  student,
  seatNumber,
  isSeatLocked,
  isLayoutLocked,
  mode = 'teacher',
  onRemoteControl,
  onUnassign,
  onToggleSeatLock,
  onBindIp,
  onToggleBrowser,
}) => {
  if (!student || seatNumber == null) {
    return (
      <div className="h-full bg-slate-900/50 border-l border-slate-700 p-6 flex flex-col items-center justify-center text-slate-500">
        <i className="fa-solid fa-user-astronaut text-5xl mb-3 text-slate-700"></i>
        <p className="text-sm">未选中座位</p>
        <p className="text-[11px] font-mono text-slate-600 mt-2">单击座位查看详情</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-900/50 border-l border-slate-700 flex flex-col">
      {/* 顶部：座位 + 状态 */}
      <div className="px-4 py-3 border-b border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-slate-500 tracking-wider">SEAT #{String(seatNumber).padStart(2, '0')}</span>
          <div className="flex items-center gap-1">
            {isSeatLocked && (
              <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] rounded">
                <i className="fa-solid fa-lock mr-1"></i>座位锁定
              </span>
            )}
            <span
              className={`px-1.5 py-0.5 text-[10px] rounded ${
                student.is_online
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'bg-slate-700 text-slate-400'
              }`}
            >
              <i className={`fa-solid ${student.is_online ? 'fa-circle' : 'fa-circle-dot'} mr-1`}></i>
              {student.is_online ? '在线' : '离线'}
            </span>
          </div>
        </div>
      </div>

      {/* 头像 + 姓名 */}
      <div className="px-4 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`
            w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold
            ${student.is_online ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white' : 'bg-slate-700 text-slate-300'}
          `}
          >
            {(student.real_name || student.username).charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-slate-100 truncate">
              {student.real_name || student.username}
            </div>
            <div className="text-xs font-mono text-slate-400 truncate">{student.username}</div>
          </div>
        </div>

        {/* 数据指标 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-800/60 rounded p-2">
            <div className="text-[10px] text-slate-500 font-mono">当前积分</div>
            <div className="text-lg font-bold text-amber-400">{student.current_points || 0}</div>
          </div>
          <div className="bg-slate-800/60 rounded p-2">
            <div className="text-[10px] text-slate-500 font-mono">做对题数</div>
            <div className="text-lg font-bold text-slate-200">{student.total_correct || 0}</div>
          </div>
        </div>

        {/* IP 信息（仅教师可见） */}
        {mode === 'teacher' && (
          <div className="mt-3 bg-slate-800/60 rounded p-2 space-y-1.5">
            <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
              <i className="fa-solid fa-network-wired text-cyan-500"></i>IP 信息
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500">当前 IP</span>
              <span className="text-slate-200">{student.current_ip || '离线/未知'}</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500">绑定 IP</span>
              <span className="text-slate-200">{student.bound_ip || '未绑定'}</span>
            </div>
            {student.is_ip_mismatch && (
              <div className="text-[11px] font-mono text-red-400 flex items-center gap-1">
                <i className="fa-solid fa-triangle-exclamation"></i>
                ⚠ 当前IP与绑定不符
              </div>
            )}
            {onBindIp && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => onBindIp(student.id, 'bind')}
                  disabled={!student.is_online}
                  className={`
                    px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1 transition-colors
                    ${
                      student.is_online
                        ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white'
                        : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    }
                  `}
                  title={student.is_online ? '将该学生当前IP绑定到座位' : '学生离线或无座位，无法绑定'}
                >
                  <i className="fa-solid fa-link"></i>
                  绑定IP
                </button>
                <button
                  onClick={() => onBindIp(student.id, 'unbind')}
                  disabled={!student.bound_ip}
                  className={`
                    px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1 transition-colors border
                    ${
                      student.bound_ip
                        ? 'bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 border-slate-700 hover:border-red-500/50'
                        : 'bg-slate-700 text-slate-500 border-slate-700 cursor-not-allowed'
                    }
                  `}
                  title={student.bound_ip ? '解除该座位的IP绑定' : '该学生未绑定IP'}
                >
                  <i className="fa-solid fa-link-slash"></i>
                  解绑
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 操作区 */}
      <div className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
        {mode === 'teacher' && (
        <button
          onClick={onRemoteControl}
          disabled={!student.is_online}
          className={`
            w-full px-4 py-2.5 rounded text-sm font-medium flex items-center justify-center gap-2
            transition-all
            ${
              student.is_online
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/30'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }
          `}
          title={student.is_online ? '远程实时访问该学生虚拟桌面' : '学生不在线，无法远程控制'}
        >
          <i className="fa-solid fa-display"></i>
          远程控制桌面
        </button>
        )}

        {mode === 'teacher' && (
        <button
          onClick={onToggleSeatLock}
          disabled={isLayoutLocked}
          className={`
            w-full px-4 py-2 rounded text-sm flex items-center justify-center gap-2
            ${isSeatLocked
              ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }
            ${isLayoutLocked ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <i className={`fa-solid ${isSeatLocked ? 'fa-lock-open' : 'fa-lock'}`}></i>
          {isSeatLocked ? '解锁该座位' : '锁定该座位'}
        </button>
        )}

        {mode === 'teacher' && onToggleBrowser && (() => {
          const canUseBrowser = student.can_use_browser === 1 || student.can_use_browser === true;
          return (
            <button
              onClick={() => onToggleBrowser(student.id, !canUseBrowser)}
              className={`
                w-full px-4 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors
                ${canUseBrowser
                  ? 'bg-sky-500/20 text-sky-300 hover:bg-red-500/20 hover:text-red-300 border border-sky-500/30 hover:border-red-500/40'
                  : 'bg-slate-800 hover:bg-sky-500/20 text-slate-200 hover:text-sky-300 border border-slate-700 hover:border-sky-500/40'
                }
              `}
              title={canUseBrowser ? '该学生已开通上网，点击关闭' : '开通该学生的上网冲浪权限'}
            >
              <i className={`fa-solid ${canUseBrowser ? 'fa-ban' : 'fa-earth-asia'}`}></i>
              {canUseBrowser ? '关闭上网权限（当前已开通）' : '开通上网权限'}
            </button>
          );
        })()}

        {mode === 'teacher' && (
        <button
          onClick={onUnassign}
          disabled={isLayoutLocked || isSeatLocked}
          className={`
            w-full px-4 py-2 rounded text-sm flex items-center justify-center gap-2
            bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-500/50
            ${isLayoutLocked || isSeatLocked ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <i className="fa-solid fa-user-minus"></i>
          清空该座位
        </button>
        )}
      </div>

      {/* 底部：安全提示 */}
      {mode === 'teacher' && (
      <div className="px-4 py-2 border-t border-slate-700 text-[10px] text-slate-500 font-mono">
        <i className="fa-solid fa-shield-halved mr-1 text-cyan-500"></i>
        远程控制会话 5 分钟自动失效
      </div>
      )}
    </div>
  );
};
