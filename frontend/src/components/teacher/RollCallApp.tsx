import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useRollCall, RollCallSeat, ProxyTokenInfo, RollCallMode } from '../../hooks/useRollCall';
import { backendClient } from '../../api/backendClient';
import { Class } from '../../types';
import { Toolbar } from './rollcall/Toolbar';
import { StudentList } from './rollcall/StudentList';
import { SeatingCanvas } from './rollcall/SeatingCanvas';
import { StudentDetailPanel } from './rollcall/StudentDetailPanel';
import { StudentDesktopModal } from './rollcall/StudentDesktopModal';
import { API_CONFIG } from '../../api/config';
import { RandomRollCallModal } from './rollcall/RandomRollCallModal';
import { AttendanceModal } from './rollcall/AttendanceModal';

interface RollCallAppProps {
  onClose?: () => void;
  mode?: RollCallMode;
}

export const RollCallApp: React.FC<RollCallAppProps> = ({ onClose, mode = 'teacher' }) => {
  const { profile } = useAuth();
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [proxyToken, setProxyToken] = useState<ProxyTokenInfo | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRollCallModalOpen, setIsRollCallModalOpen] = useState(false);
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const [rollCallCount, setRollCallCount] = useState(1);

  const rollCall = useRollCall(selectedClassId, mode);

  // 加载班级列表
  useEffect(() => {
    const loadClasses = async () => {
      if (!profile) return;
      try {
        if (mode === 'teacher') {
          const { data } = await backendClient
            .from('classes')
            .select('*')
            .eq('teacher_id', profile.id)
            .order('created_at', { ascending: true });
          if (data) {
            setClasses(data as Class[]);
            if (data.length > 0 && !selectedClassId) {
              setSelectedClassId((data[0] as Class).id);
            }
          }
        } else {
          const token = localStorage.getItem('xgpy_token');
          const res = await fetch(`${API_CONFIG.apiUrl}/api/student/class-info`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const json = await res.json();
          if (json.data && json.data.class_id) {
            const cls: Class = {
              id: json.data.class_id,
              name: json.data.name || '',
              teacher_id: json.data.teacher_id,
              created_at: '',
            };
            setClasses([cls]);
            setSelectedClassId(json.data.class_id);
          }
        }
      } catch (e) {
        console.error('加载班级失败:', e);
      }
    };
    loadClasses();
  }, [profile, mode]);

  const debounceTimerRef = useRef<number | null>(null);

  const triggerSave = useCallback(
    (seats: RollCallSeat[], isLocked: boolean) => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(async () => {
        setIsSaving(true);
        await rollCall.saveSeating(seats, isLocked);
        setIsSaving(false);
        debounceTimerRef.current = null;
      }, 300);
    },
    [rollCall]
  );

  // 操作：座位之间移动（换人 / 互换）
  const handleMoveStudent = useCallback(
    (fromSeatNumber: number, toSeatNumber: number) => {
      if (rollCall.isLocked) return;
      const fromSeat = rollCall.seats.find((s) => s.seat_number === fromSeatNumber);
      if (!fromSeat) return;

      const next = rollCall.seats.map((s) => ({ ...s }));
      let toIdx = next.findIndex((s) => s.seat_number === toSeatNumber);
      let targetSeat;
      if (toIdx < 0) {
        targetSeat = {
          seat_number: toSeatNumber,
          student_id: null,
          position_x: (toSeatNumber - 1) % 8,
          position_y: Math.floor((toSeatNumber - 1) / 8),
          is_locked: false,
        };
        next.push(targetSeat);
        toIdx = next.length - 1;
      } else {
        targetSeat = next[toIdx];
      }

      // 临时保存 student_id
      const fromStudentId = fromSeat.student_id;
      const toStudentId = targetSeat.student_id;

      // 同步位置
      const fromX = fromSeat.position_x;
      const fromY = fromSeat.position_y;
      const toX = targetSeat.position_x;
      const toY = targetSeat.position_y;

      next.forEach((s) => {
        if (s.seat_number === fromSeatNumber) {
          s.student_id = toStudentId;
          s.position_x = toX;
          s.position_y = toY;
        } else if (s.seat_number === toSeatNumber) {
          s.student_id = fromStudentId;
          s.position_x = fromX;
          s.position_y = fromY;
        }
      });
      triggerSave(next, rollCall.isLocked);
    },
    [rollCall.seats, rollCall.isLocked, triggerSave]
  );

  // 操作：学生 → 座位
  const handleAssignStudent = useCallback(
    (studentId: string, toSeatNumber: number) => {
      if (rollCall.isLocked) return;
      const next = rollCall.seats.map((s) => ({ ...s }));

      // 找到目标座位
      let toIdx = next.findIndex((s) => s.seat_number === toSeatNumber);
      let targetSeat;
      if (toIdx < 0) {
        // 目标座位不在数组中，新建一个
        targetSeat = {
          seat_number: toSeatNumber,
          student_id: null,
          position_x: (toSeatNumber - 1) % 8,
          position_y: Math.floor((toSeatNumber - 1) / 8),
          is_locked: false,
        };
        next.push(targetSeat);
        toIdx = next.length - 1;
      } else {
        targetSeat = next[toIdx];
      }
      const oldStudentId = targetSeat.student_id;

      // 检查学生是否已经在其他座位
      const fromIdx = next.findIndex((s) => s.student_id === studentId);
      if (fromIdx >= 0) {
        // 互换
        const fromSeat = next[fromIdx];
        const fx = fromSeat.position_x, fy = fromSeat.position_y;
        const tx = targetSeat.position_x, ty = targetSeat.position_y;
        next[fromIdx] = {
          ...fromSeat,
          student_id: oldStudentId,
          position_x: tx,
          position_y: ty,
        };
        next[toIdx] = {
          ...targetSeat,
          student_id: studentId,
          position_x: fx,
          position_y: fy,
        };
      } else {
        // 目标座位之前没人，直接赋值
        next[toIdx] = { ...targetSeat, student_id: studentId };
        // 目标座位之前有人但不在其他座位 → 直接顶替
      }
      triggerSave(next, rollCall.isLocked);
    },
    [rollCall.seats, rollCall.isLocked, triggerSave]
  );

  // 操作：清空某座位
  const handleUnassignSeat = useCallback(
    (seatNumber: number) => {
      if (rollCall.isLocked) return;
      const next = rollCall.seats.map((s) =>
        s.seat_number === seatNumber ? { ...s, student_id: null } : s
      );
      triggerSave(next, rollCall.isLocked);
    },
    [rollCall.seats, rollCall.isLocked, triggerSave]
  );

  // 操作：切换单座锁定
  const handleToggleSeatLock = useCallback(
    (seatNumber: number) => {
      if (rollCall.isLocked) return;
      const next = rollCall.seats.map((s) =>
        s.seat_number === seatNumber ? { ...s, is_locked: !s.is_locked } : s
      );
      triggerSave(next, rollCall.isLocked);
    },
    [rollCall.seats, rollCall.isLocked, triggerSave]
  );

  // 双击查看学生桌面（仅教师可用：学生端无 proxy-token 权限，避免冒充同班同学）
  const handleDoubleClickSeat = useCallback(
    async (seatNumber: number) => {
      if (mode === 'student') return;
      const student = rollCall.getStudentBySeatNumber(seatNumber);
      if (!student) return;
      const info = await rollCall.requestProxyToken(student.id);
      if (info) {
        setProxyToken(info);
      }
    },
    [rollCall, mode]
  );

  // 拖放源：学生列表
  const handleStudentListDragStart = useCallback((e: React.DragEvent, studentId: string) => {
    if (rollCall.isLocked) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/x-student', studentId);
    e.dataTransfer.effectAllowed = 'move';
  }, [rollCall.isLocked]);

  const selectedStudent =
    rollCall.selectedSeatNumber != null
      ? rollCall.getStudentBySeatNumber(rollCall.selectedSeatNumber)
      : null;
  const selectedSeat =
    rollCall.selectedSeatNumber != null
      ? rollCall.seats.find((s) => s.seat_number === rollCall.selectedSeatNumber) || null
      : null;

  const onlineCount = rollCall.students.filter((s) => s.is_online).length;
  const assignedCount = rollCall.seats.filter((s) => s.student_id).length;

  // 授权到期/未激活：整组接口被 403 拦截，显示锁定界面
  if (rollCall.licenseDenied) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-950 text-slate-200 p-8">
        <i className="fa-solid fa-lock text-6xl text-amber-500 mb-6"></i>
        <h2 className="text-xl font-bold mb-2">课堂点名为授权功能</h2>
        <p className="text-sm text-slate-400 mb-1">系统授权已到期或尚未激活，激活后即可继续使用</p>
        <p className="text-xs text-slate-500">请联系平台提供方获取授权，或在 系统配置 → 授权管理 中输入授权码</p>
        {onClose && (
          <button onClick={onClose} className="mt-6 px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm transition-colors">
            关闭
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-200">
      <Toolbar
        classes={classes}
        selectedClassId={selectedClassId}
        onSelectClass={(id) => {
          setSelectedClassId(id);
          rollCall.setSelectedSeatNumber(null);
        }}
        isLocked={rollCall.isLocked}
        isSaving={isSaving}
        onAutoArrange={async () => {
          if (!confirm('自动排座将覆盖当前座位布局，确定吗？')) return;
          await rollCall.autoArrange();
        }}
        onReverseArrange={async () => {
          if (!confirm('反向排座将覆盖当前座位布局，确定吗？')) return;
          await rollCall.reverseArrange();
        }}
        onToggleLock={rollCall.toggleLock}
        onClearAll={rollCall.clearAll}
        onRandomRollCall={() => {
          setIsRollCallModalOpen(true);
        }}
        onAttendance={() => setIsAttendanceModalOpen(true)}
        rollCallCount={rollCallCount}
        onRollCallCountChange={setRollCallCount}
        onlineCount={onlineCount}
        totalCount={rollCall.students.length}
        assignedCount={assignedCount}
        onClose={onClose}
        hideClassSelector={mode === 'student'}
        mode={mode}
        ipRestriction={rollCall.ipRestriction}
        onBindAllIp={rollCall.bindAllIp}
        onToggleIpRestriction={rollCall.toggleIpRestriction}
      />

      {/* 主体三栏 */}
      <div className="flex-1 grid grid-cols-[280px_1fr_320px] overflow-hidden">
        {/* 左：学生列表 */}
        <StudentList
          students={rollCall.students}
          unassignedStudents={rollCall.unassignedStudents()}
          onDragStartStudent={handleStudentListDragStart}
        />

        {/* 中：座位画布 */}
        {!selectedClassId ? (
          <div className="flex items-center justify-center text-slate-500">
            <div className="text-center">
              <i className="fa-solid fa-arrow-left text-3xl mb-3 text-slate-700 block"></i>
              <p>请从顶部选择一个班级</p>
            </div>
          </div>
        ) : rollCall.loading ? (
          <div className="flex items-center justify-center">
            <i className="fa-solid fa-circle-notch fa-spin text-3xl text-cyan-500"></i>
          </div>
        ) : (
          <SeatingCanvas
            seats={rollCall.seats}
            students={rollCall.students}
            selectedSeatNumber={rollCall.selectedSeatNumber}
            isLayoutLocked={rollCall.isLocked || mode === 'student'}
            onSelectSeat={rollCall.setSelectedSeatNumber}
            onDoubleClickSeat={handleDoubleClickSeat}
            onMoveStudent={handleMoveStudent}
            onAssignStudent={handleAssignStudent}
            onUnassignSeat={handleUnassignSeat}
            onToggleSeatLock={handleToggleSeatLock}
          />
        )}

        {/* 右：详情面板 */}
        <StudentDetailPanel
          student={selectedStudent}
          seatNumber={rollCall.selectedSeatNumber}
          isSeatLocked={!!selectedSeat?.is_locked}
          isLayoutLocked={rollCall.isLocked}
          mode={mode}
          onRemoteControl={() => {
            if (selectedStudent) handleDoubleClickSeat(rollCall.selectedSeatNumber!);
          }}
          onUnassign={() => {
            if (rollCall.selectedSeatNumber != null) {
              handleUnassignSeat(rollCall.selectedSeatNumber);
            }
          }}
          onToggleSeatLock={() => {
            if (rollCall.selectedSeatNumber != null) {
              handleToggleSeatLock(rollCall.selectedSeatNumber);
            }
          }}
          onBindIp={rollCall.bindIp}
        />
      </div>

      {/* 远程控制 Modal */}
      {proxyToken && (
        <StudentDesktopModal
          token={proxyToken.token}
          sessionId={proxyToken.session_id}
          studentName={proxyToken.student.real_name}
          studentUsername={proxyToken.student.username}
          expiresAt={proxyToken.expires_at}
          onClose={() => setProxyToken(null)}
          onRevoke={async (sid) => {
            await rollCall.revokeProxyToken(sid);
            setProxyToken(null);
          }}
        />
      )}

      {/* 随机点名 Modal */}
      <RandomRollCallModal
        isOpen={isRollCallModalOpen}
        onClose={() => setIsRollCallModalOpen(false)}
        onlineStudents={rollCall.students.filter((s) => s.is_online)}
        count={rollCallCount}
      />

      {/* 考勤记录 Modal */}
      {isAttendanceModalOpen && (
        <AttendanceModal
          onClose={() => setIsAttendanceModalOpen(false)}
          onSave={async (note) => {
            const result = await rollCall.saveAttendance(note);
            if (result) {
              alert(`保存成功！应到 ${result.total_count} 人，实到 ${result.online_count} 人，缺席 ${result.absent_count} 人`);
              setIsAttendanceModalOpen(false);
            }
          }}
          onGetList={rollCall.getAttendanceList}
          onGetDetail={rollCall.getAttendanceDetail}
          {...(mode === 'teacher' && {
            onGetPublicToken: async () => {
              const token = await rollCall.getPublicToken();
              if (token) {
                // 应用使用 HashRouter，公开链接必须带 /#/ 前缀，token 以查询参数传递
                const url = `${window.location.origin}/#/roll-call-public?token=${token}`;
                try {
                  await navigator.clipboard.writeText(url);
                  alert(`公开链接已复制到剪贴板！\n\n${url}`);
                } catch {
                  prompt('请复制公开链接：', url);
                }
              }
            },
          })}
        />
      )}
    </div>
  );
};
