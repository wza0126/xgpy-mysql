import React, { useState, useMemo } from 'react';
import { RollCallStudent } from '../../../hooks/useRollCall';

interface StudentListProps {
  students: RollCallStudent[];
  unassignedStudents: RollCallStudent[];
  onDragStartStudent: (e: React.DragEvent, studentId: string) => void;
}

export const StudentList: React.FC<StudentListProps> = ({ students, unassignedStudents, onDragStartStudent }) => {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const list = useMemo(() => {
    const base = showAll ? students : unassignedStudents;
    if (!search.trim()) return base;
    const q = search.trim().toLowerCase();
    return base.filter(
      (s) => s.username.toLowerCase().includes(q) || (s.real_name || '').toLowerCase().includes(q)
    );
  }, [students, unassignedStudents, showAll, search]);

  const onlineCount = students.filter((s) => s.is_online).length;

  return (
    <div className="flex flex-col h-full bg-slate-900/50 border-r border-slate-700">
      {/* 标题区 */}
      <div className="px-4 py-3 border-b border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-cyan-300 font-bold text-sm flex items-center gap-2">
            <i className="fa-solid fa-users"></i>
            班级学生
          </h3>
          <span className="text-xs font-mono text-slate-400">
            <span className="text-cyan-300">{onlineCount}</span>
            <span className="text-slate-500"> / </span>
            <span className="text-slate-200">{students.length}</span>
          </span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索用户名 / 姓名"
          className="w-full px-3 py-1.5 text-xs bg-slate-800/80 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
        />
        <div className="flex items-center justify-between mt-2 text-[11px]">
          <button
            onClick={() => setShowAll(!showAll)}
            className={`px-2 py-0.5 rounded ${
              showAll ? 'bg-cyan-600/30 text-cyan-200' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {showAll ? '显示全部' : '仅未排座'}
          </button>
          <span className="text-slate-500 font-mono">
            {list.length} 人
          </span>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {list.length === 0 ? (
          <div className="text-center text-slate-500 text-xs py-8">
            <i className="fa-solid fa-inbox text-2xl mb-2 block"></i>
            {showAll ? '班级暂无学生' : '所有学生都已排座'}
          </div>
        ) : (
          list.map((s) => (
            <div
              key={s.id}
              draggable
              onDragStart={(e) => onDragStartStudent(e, s.id)}
              className={`
                group flex items-center gap-2 px-2.5 py-1.5 rounded
                border border-slate-700/50 bg-slate-800/40
                cursor-grab active:cursor-grabbing
                hover:bg-slate-700/60 hover:border-cyan-500/50
                transition-all
              `}
              title={`${s.real_name || s.username}（${s.username}）`}
            >
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  s.is_online ? 'bg-cyan-300 shadow shadow-cyan-400' : 'bg-slate-500'
                }`}
              ></div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-100 truncate font-medium">
                  {s.real_name || s.username}
                </div>
                <div className="text-[10px] font-mono text-slate-500 truncate">{s.username}</div>
              </div>
              <div className="text-[10px] font-mono text-amber-400 flex-shrink-0">
                {s.current_points || 0}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
