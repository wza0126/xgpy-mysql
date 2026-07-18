import React, { useRef } from 'react';
import { RollCallSeat, RollCallStudent } from '../../../hooks/useRollCall';
import { Seat } from './Seat';

interface SeatingCanvasProps {
  seats: RollCallSeat[];
  students: RollCallStudent[];
  selectedSeatNumber: number | null;
  isLayoutLocked: boolean;
  onSelectSeat: (seatNumber: number | null) => void;
  onDoubleClickSeat: (seatNumber: number) => void;
  onMoveStudent: (fromSeatNumber: number, toSeatNumber: number) => void;
  onAssignStudent: (studentId: string, toSeatNumber: number) => void;
  onUnassignSeat: (seatNumber: number) => void;
  onToggleSeatLock: (seatNumber: number) => void;
}

export const SeatingCanvas: React.FC<SeatingCanvasProps> = ({
  seats,
  students,
  selectedSeatNumber,
  isLayoutLocked,
  onSelectSeat,
  onDoubleClickSeat,
  onMoveStudent,
  onAssignStudent,
  onUnassignSeat,
  onToggleSeatLock,
}) => {
  // 8x8 = 64 座
  const COLS = 8;
  const ROWS = 8;
  const canvasRef = useRef<HTMLDivElement>(null);

  // 拖动时：座位 → 座位
  const handleSeatDragStart = (e: React.DragEvent, seat: RollCallSeat) => {
    if (!seat.student_id) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/x-seat', String(seat.seat_number));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleSeatDragOver = (e: React.DragEvent) => {
    if (isLayoutLocked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleSeatDrop = (e: React.DragEvent, targetSeat: RollCallSeat) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLayoutLocked) return;
    const targetIsLocked = !!targetSeat.is_locked;
    if (targetIsLocked) {
      alert('目标座位已锁定');
      return;
    }
    const sourceSeatNum = e.dataTransfer.getData('application/x-seat');
    if (sourceSeatNum) {
      // 座位 → 座位
      const fromNum = parseInt(sourceSeatNum, 10);
      if (fromNum === targetSeat.seat_number) return;
      const fromSeat = seats.find((s) => s.seat_number === fromNum);
      if (fromSeat?.is_locked) {
        alert('源座位已锁定');
        return;
      }
      onMoveStudent(fromNum, targetSeat.seat_number);
    } else {
      // 学生列表 → 座位
      const studentId = e.dataTransfer.getData('application/x-student');
      if (studentId) {
        onAssignStudent(studentId, targetSeat.seat_number);
      }
    }
  };

  // 空白网格处拖放：取消该座位
  const handleEmptyDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (isLayoutLocked) return;
    const sourceSeatNum = e.dataTransfer.getData('application/x-seat');
    if (sourceSeatNum) {
      const fromNum = parseInt(sourceSeatNum, 10);
      onUnassignSeat(fromNum);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* 装饰：网格背景 */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(56, 189, 248, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.08) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      ></div>

      {/* 黑板装饰 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-6 py-1.5 bg-slate-800/80 border border-slate-700 rounded-md">
        <span className="text-xs font-mono text-cyan-300 tracking-widest">CLASSROOM</span>
      </div>

      {/* 主座位网格 */}
      <div
        ref={canvasRef}
        className="relative z-[5] grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
          width: 'min(640px, 90%)',
          aspectRatio: '1 / 1',
        }}
        onDragOver={handleEmptyDrop as any}
        onDrop={handleEmptyDrop as any}
      >
        {Array.from({ length: 64 }, (_, idx) => {
          const position_x = idx % COLS;
          const position_y = Math.floor(idx / COLS);
          const seat = seats.find((s) => s.position_x === position_x && s.position_y === position_y) || {
            seat_number: idx + 1,
            student_id: null,
            position_x,
            position_y,
            is_locked: false,
          };
          const student = seat.student_id ? students.find((s) => s.id === seat.student_id) || null : null;
          return (
            <Seat
              key={`${position_x}-${position_y}`}
              seat={seat}
              student={student}
              isSelected={selectedSeatNumber === seat.seat_number}
              isLayoutLocked={isLayoutLocked}
              isSeatLocked={!!seat.is_locked}
              onClick={() => {
                onSelectSeat(seat.seat_number);
                if (selectedSeatNumber === seat.seat_number && !isLayoutLocked) {
                  if (student) {
                    onToggleSeatLock(seat.seat_number);
                  }
                }
              }}
              onDoubleClick={() => {
                if (student) onDoubleClickSeat(seat.seat_number);
              }}
              onDragStart={(e) => handleSeatDragStart(e, seat)}
              onDragOver={handleSeatDragOver}
              onDrop={(e) => handleSeatDrop(e, seat)}
            />
          );
        })}
      </div>

      {/* 底部信息 */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 text-[10px] font-mono text-slate-500 tracking-wider">
        单击选中 / 双击远程控制 / 拖动换位 / 单击选中后再点切换单座锁定
      </div>
    </div>
  );
};
