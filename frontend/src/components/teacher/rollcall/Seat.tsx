import React from 'react';
import { RollCallSeat, RollCallStudent } from '../../../hooks/useRollCall';

interface SeatProps {
  seat: RollCallSeat;
  student: RollCallStudent | null;
  isSelected: boolean;
  isLayoutLocked: boolean;
  isSeatLocked: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export const Seat: React.FC<SeatProps> = ({
  seat,
  student,
  isSelected,
  isLayoutLocked,
  isSeatLocked,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragOver,
  onDrop,
}) => {
  const isOnline = !!student?.is_online;
  const isEmpty = !student;
  const isDraggable = !isLayoutLocked && !isSeatLocked && !isEmpty;
  const isIpMismatch = !!student?.is_ip_mismatch;

  // 状态色彩
  let bgClass = '';
  let textClass = 'text-slate-400';
  let ringClass = '';

  if (isEmpty) {
    bgClass = 'bg-slate-800/30 border-2 border-dashed border-slate-600';
  } else if (isOnline) {
    // 在线：青色边框，不闪烁
    bgClass = 'bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border-2 border-cyan-400/60';
    textClass = 'text-cyan-100';
  } else {
    // 离线/缺席：红橙色醒目提示
    bgClass = 'bg-gradient-to-br from-red-500/15 to-orange-600/15 border-2 border-red-400/50';
    textClass = 'text-red-200';
  }

  // IP 异常：红色警示描边 + 脉冲
  if (isIpMismatch) {
    bgClass = 'bg-gradient-to-br from-red-500/25 to-red-700/25 border-2 border-red-500';
    ringClass = 'ring-2 ring-red-500/60 animate-pulse';
  }

  if (isSelected) {
    ringClass = 'ring-4 ring-amber-400/80 shadow-2xl shadow-amber-500/30';
  }

  const name = student?.real_name || student?.username || '';
  const shortName = name.length > 2 ? name.slice(0, 2) : name;
  const isOffline = student && !isOnline;

  return (
    <div
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`
        relative w-full h-full rounded-lg cursor-pointer
        flex flex-col items-center justify-center
        transition-all duration-200 select-none
        ${bgClass} ${textClass} ${ringClass}
        hover:scale-105 hover:z-10
      `}
      style={{ minHeight: '70px' }}
    >
      {/* 座位号 */}
      <div className="absolute top-1 left-1.5 text-[10px] font-mono text-slate-500">
        {String(seat.seat_number).padStart(2, '0')}
      </div>

      {/* 锁定图标 */}
      {(isLayoutLocked || isSeatLocked) && (
        <i
          className="fa-solid fa-lock absolute top-1 right-1.5 text-[10px] text-amber-400"
          title={isLayoutLocked ? '整体已锁定' : '该座位已锁定'}
        ></i>
      )}

      {/* IP 异常红点角标 */}
      {isIpMismatch && (
        <span
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-slate-900 shadow-lg shadow-red-500/60 animate-pulse"
          title="IP异常：当前IP与绑定IP不符"
        ></span>
      )}

      {/* 学生内容 */}
      {student ? (
        <>
          {/* 在线指示灯 */}
          <div
            className={`w-2 h-2 rounded-full mb-1 ${
              isOnline
                ? 'bg-cyan-300 shadow-lg shadow-cyan-400/80'
                : 'bg-red-400 shadow-lg shadow-red-500/80'
            }`}
          ></div>
          {/* 姓名 */}
          <div className={`text-base font-bold ${isOffline ? 'opacity-90' : ''}`}>{shortName || '?'}</div>
          {/* 学号截断 */}
          {student.username && (
            <div className="text-[9px] font-mono text-slate-500 mt-0.5 truncate max-w-[90%]">
              {student.username}
            </div>
          )}
        </>
      ) : (
        <div className="text-slate-600 text-2xl">
          <i className="fa-solid fa-chair"></i>
        </div>
      )}
    </div>
  );
};
