import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RollCallStudent } from '../../../hooks/useRollCall';

interface RandomRollCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onlineStudents: RollCallStudent[];
  count: number;
}

export const RandomRollCallModal: React.FC<RandomRollCallModalProps> = ({
  isOpen,
  onClose,
  onlineStudents,
  count,
}) => {
  const [isRolling, setIsRolling] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedStudents, setSelectedStudents] = useState<RollCallStudent[]>([]);
  const intervalRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      clear();
      setIsRolling(false);
      setSelectedStudents([]);
      setCurrentIndex(0);
    }
    return clear;
  }, [isOpen, clear]);

  const startRoll = useCallback(() => {
    if (onlineStudents.length === 0) return;
    setIsRolling(true);
    setSelectedStudents([]);
    
    let speed = 50;
    let rounds = 0;
    const maxRounds = 3 + Math.random() * 2;
    
    clear();
    intervalRef.current = window.setInterval(() => {
      setCurrentIndex(Math.floor(Math.random() * onlineStudents.length));
      rounds += 50 / speed;
      
      if (rounds >= maxRounds && speed >= 400) {
        clear();
        setIsRolling(false);
        const shuffled = [...onlineStudents].sort(() => Math.random() - 0.5);
        setSelectedStudents(shuffled.slice(0, Math.min(count, onlineStudents.length)));
      } else if (rounds >= maxRounds * 0.7) {
        speed = Math.min(speed + 20, 400);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = window.setInterval(() => {
            setCurrentIndex(Math.floor(Math.random() * onlineStudents.length));
            speed = Math.min(speed + 30, 500);
            if (speed >= 500) {
              clear();
              setIsRolling(false);
              const shuffled = [...onlineStudents].sort(() => Math.random() - 0.5);
              setSelectedStudents(shuffled.slice(0, Math.min(count, onlineStudents.length)));
            }
          }, speed);
        }
      }
    }, speed);
  }, [onlineStudents, count, clear]);

  useEffect(() => {
    if (isOpen && onlineStudents.length > 0) {
      const timer = setTimeout(startRoll, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onlineStudents, startRoll]);

  if (!isOpen) return null;

  const currentStudent = onlineStudents[currentIndex] || null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-8 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <i className="fa-solid fa-shuffle text-amber-400"></i>
            随机点名
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {selectedStudents.length === 0 ? (
          <div className="text-center py-8">
            <div
              className={`
                w-32 h-32 mx-auto mb-4 rounded-full flex items-center justify-center
                text-4xl font-bold transition-all duration-100
                ${isRolling 
                  ? 'bg-gradient-to-br from-amber-500/30 to-orange-500/30 border-2 border-amber-400 shadow-lg shadow-amber-500/50 animate-pulse' 
                  : 'bg-slate-800 border border-slate-700'
                }
              `}
            >
              {currentStudent ? (
                currentStudent.real_name.charAt(0)
              ) : (
                '-'
              )}
            </div>
            <div className="text-lg text-slate-200 font-bold mb-1">
              {currentStudent?.real_name || '???'}
            </div>
            <div className="text-sm text-slate-500 font-mono">
              {currentStudent?.username || '...'}
            </div>
            {isRolling && (
              <div className="mt-4">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-300 rounded-full text-sm">
                  <i className="fa-solid fa-spinner fa-spin"></i>
                  抽取中...
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center text-sm text-slate-400 mb-4">
              本次抽取 <span className="text-amber-400 font-bold">{selectedStudents.length}</span> 名学生
            </div>
            <div className="grid grid-cols-2 gap-3">
              {selectedStudents.map((student, index) => (
                <div
                  key={student.id}
                  className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 hover:border-amber-500/50 transition-all"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-xs font-bold text-white">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-100 truncate">
                        {student.real_name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono truncate">
                        {student.username}
                      </div>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-center gap-3">
          {selectedStudents.length > 0 ? (
            <>
              <button
                onClick={startRoll}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
              >
                <i className="fa-solid fa-rotate-right"></i>
                重新抽取
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition-colors"
              >
                关闭
              </button>
            </>
          ) : (
            <button
              onClick={startRoll}
              disabled={isRolling}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
            >
              <i className="fa-solid fa-play"></i>
              {isRolling ? '抽取中...' : '开始抽取'}
            </button>
          )}
        </div>

        <div className="mt-4 text-center text-xs text-slate-600">
          从 <span className="text-cyan-400">{onlineStudents.length}</span> 名在线学生中随机抽取
        </div>
      </div>
    </div>
  );
};
