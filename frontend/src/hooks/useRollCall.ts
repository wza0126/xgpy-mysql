import { useEffect, useRef, useState, useCallback } from 'react';
import { API_CONFIG } from '../api/config';

export interface RollCallStudent {
  id: string;
  username: string;
  real_name: string;
  current_points: number;
  max_points: number;
  total_correct: number;
  is_online: boolean | number;
}

export interface RollCallSeat {
  id?: string;
  class_id?: string;
  seat_number: number;
  student_id: string | null;
  position_x: number;
  position_y: number;
  is_locked: boolean | number;
}

export interface RollCallLayout {
  is_locked: boolean;
  layout_data: any;
}

export interface ProxyTokenInfo {
  token: string;
  session_id: string;
  expires_at: string;
  student: {
    id: string;
    username: string;
    real_name: string;
  };
}

const getToken = () => localStorage.getItem('xgpy_token');

const authHeaders = (): HeadersInit => {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export type RollCallMode = 'teacher' | 'student';

export function useRollCall(classId: string | null, mode: RollCallMode = 'teacher') {
  const [students, setStudents] = useState<RollCallStudent[]>([]);
  const [seats, setSeats] = useState<RollCallSeat[]>([]);
  const [layout, setLayout] = useState<RollCallLayout>({ is_locked: false, layout_data: { version: 1 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const apiPrefix = mode === 'teacher' ? '/api/teacher/roll-call' : '/api/student/roll-call';

  const loadStudents = useCallback(async (cid: string) => {
    try {
      const url = mode === 'teacher'
        ? `${API_CONFIG.apiUrl}${apiPrefix}/students/${cid}`
        : `${API_CONFIG.apiUrl}${apiPrefix}/students`;
      const res = await fetch(url, { headers: authHeaders() });
      const json = await res.json();
      if (json.error) {
        console.error('loadStudents error:', json.error);
        setError(json.error);
      } else {
        setStudents(json.data || []);
      }
    } catch (e) {
      console.error('loadStudents fetch error:', e);
      setError((e as Error).message);
    }
  }, [mode, apiPrefix]);

  const loadSeating = useCallback(async (cid: string) => {
    try {
      const url = mode === 'teacher'
        ? `${API_CONFIG.apiUrl}${apiPrefix}/seating/${cid}`
        : `${API_CONFIG.apiUrl}${apiPrefix}/seating`;
      const res = await fetch(url, { headers: authHeaders() });
      const json = await res.json();
      if (json.error) {
        console.error('loadSeating error:', json.error);
        setError(json.error);
      } else {
        setSeats(json.data?.seats || []);
        setLayout(json.data?.layout || { is_locked: false, layout_data: { version: 1 } });
      }
    } catch (e) {
      console.error('loadSeating fetch error:', e);
      setError((e as Error).message);
    }
  }, [mode, apiPrefix]);

  const loadAll = useCallback(
    async (cid: string) => {
      setLoading(true);
      setError(null);
      await Promise.all([loadStudents(cid), loadSeating(cid)]);
      setLoading(false);
    },
    [loadStudents, loadSeating]
  );

  // 班级变化时整体加载
  useEffect(() => {
    if (classId) {
      loadAll(classId);
    } else {
      setStudents([]);
      setSeats([]);
      setLayout({ is_locked: false, layout_data: { version: 1 } });
    }
  }, [classId, loadAll]);

  // 每 30 秒轮询在线状态
  useEffect(() => {
    if (!classId) return;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      loadStudents(classId);
    }, 30000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [classId, loadStudents]);

  const saveSeating = useCallback(
    async (nextSeats: RollCallSeat[], nextIsLocked: boolean) => {
      if (!classId) return false;
      try {
        const url = mode === 'teacher'
          ? `${API_CONFIG.apiUrl}${apiPrefix}/seating/${classId}/save`
          : `${API_CONFIG.apiUrl}${apiPrefix}/seating/save`;
        const res = await fetch(url, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ seats: nextSeats, is_locked: nextIsLocked }),
        });
        const json = await res.json();
        if (json.error) {
          console.error('saveSeating error:', json.error);
          alert(json.error);
          return false;
        }
        setSeats(nextSeats);
        setLayout((prev) => ({ ...prev, is_locked: nextIsLocked }));
        return true;
      } catch (e) {
        console.error('saveSeating fetch error:', e);
        alert('保存失败：' + (e as Error).message);
        return false;
      }
    },
    [classId, mode, apiPrefix]
  );

  const autoArrange = useCallback(async () => {
    if (!classId) return false;
    try {
      const url = mode === 'teacher'
        ? `${API_CONFIG.apiUrl}${apiPrefix}/seating/${classId}/auto-arrange`
        : `${API_CONFIG.apiUrl}${apiPrefix}/seating/auto-arrange`;
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.error) {
        console.error('autoArrange error:', json.error);
        alert(json.error);
        return false;
      }
      await loadSeating(classId);
      return true;
    } catch (e) {
      console.error('autoArrange fetch error:', e);
      alert('自动排座失败：' + (e as Error).message);
      return false;
    }
  }, [classId, mode, apiPrefix, loadSeating]);

  const reverseArrange = useCallback(async () => {
    if (!classId) return false;
    try {
      const url = mode === 'teacher'
        ? `${API_CONFIG.apiUrl}${apiPrefix}/seating/${classId}/reverse-arrange`
        : `${API_CONFIG.apiUrl}${apiPrefix}/seating/reverse-arrange`;
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.error) {
        console.error('reverseArrange error:', json.error);
        alert(json.error);
        return false;
      }
      await loadSeating(classId);
      return true;
    } catch (e) {
      console.error('reverseArrange fetch error:', e);
      alert('反向排座失败：' + (e as Error).message);
      return false;
    }
  }, [classId, mode, apiPrefix, loadSeating]);

  const toggleLock = useCallback(async () => {
    if (!classId) return;
    const next = !layout.is_locked;
    try {
      const url = mode === 'teacher'
        ? `${API_CONFIG.apiUrl}${apiPrefix}/lock/${classId}`
        : `${API_CONFIG.apiUrl}${apiPrefix}/lock`;
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ is_locked: next }),
      });
      const json = await res.json();
      if (json.error) {
        console.error('toggleLock error:', json.error);
        alert(json.error);
        return;
      }
      setLayout((prev) => ({ ...prev, is_locked: json.data.is_locked }));
    } catch (e) {
      console.error('toggleLock fetch error:', e);
    }
  }, [classId, mode, apiPrefix, layout.is_locked]);

  const clearAll = useCallback(async () => {
    if (!classId) return false;
    if (!confirm('确认清空当前班级的所有座位安排？')) return false;
    return saveSeating([], false);
  }, [classId, saveSeating]);

  const requestProxyToken = useCallback(async (studentId: string): Promise<ProxyTokenInfo | null> => {
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}${apiPrefix}/proxy-token/${studentId}`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (json.error) {
        console.error('requestProxyToken error:', json.error);
        alert(json.error);
        return null;
      }
      return json.data;
    } catch (e) {
      console.error('requestProxyToken fetch error:', e);
      alert('获取远程控制凭证失败：' + (e as Error).message);
      return null;
    }
  }, [apiPrefix]);

  const revokeProxyToken = useCallback(async (sessionId: string) => {
    try {
      await fetch(`${API_CONFIG.apiUrl}${apiPrefix}/proxy-token/${sessionId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    } catch (e) {
      console.error('revokeProxyToken error:', e);
    }
  }, [apiPrefix]);

  // 工具：根据座位号查学生
  const getStudentBySeatNumber = useCallback(
    (seatNumber: number): RollCallStudent | null => {
      const seat = seats.find((s) => s.seat_number === seatNumber);
      if (!seat || !seat.student_id) return null;
      return students.find((s) => s.id === seat.student_id) || null;
    },
    [seats, students]
  );

  // 工具：未排座位的学生（用于左侧列表）
  const unassignedStudents = useCallback(() => {
    const assignedIds = new Set(seats.map((s) => s.student_id).filter(Boolean) as string[]);
    return students.filter((s) => !assignedIds.has(s.id));
  }, [students, seats]);

  const saveAttendance = useCallback(async (note?: string): Promise<any | null> => {
    if (mode === 'teacher' && !classId) return null;
    try {
      const attendanceData = seats
        .filter(s => s.student_id)
        .map(s => {
          const student = students.find(st => st.id === s.student_id);
          return {
            student_id: s.student_id,
            username: student?.username || '',
            real_name: student?.real_name || '',
            seat_number: s.seat_number,
            is_online: !!student?.is_online,
          };
        });
      const url = mode === 'teacher'
        ? `${API_CONFIG.apiUrl}${apiPrefix}/attendance/${classId}`
        : `${API_CONFIG.apiUrl}${apiPrefix}/attendance`;
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ attendance_data: attendanceData, note: note || '' }),
      });
      const json = await res.json();
      if (json.error) {
        alert(json.error);
        return null;
      }
      return json.data;
    } catch (e) {
      console.error('saveAttendance error:', e);
      alert('保存考勤记录失败：' + (e as Error).message);
      return null;
    }
  }, [classId, apiPrefix, seats, students]);

  const getAttendanceList = useCallback(async (): Promise<any[]> => {
    if (mode === 'teacher' && !classId) return [];
    try {
      const url = mode === 'teacher'
        ? `${API_CONFIG.apiUrl}${apiPrefix}/attendance/${classId}`
        : `${API_CONFIG.apiUrl}${apiPrefix}/attendance`;
      const res = await fetch(url, {
        headers: authHeaders(),
      });
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.error('getAttendanceList error:', e);
      return [];
    }
  }, [classId, apiPrefix, mode]);

  const getAttendanceDetail = useCallback(async (recordId: string): Promise<any | null> => {
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}${apiPrefix}/attendance-detail/${recordId}`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (json.error) return null;
      return json.data;
    } catch (e) {
      console.error('getAttendanceDetail error:', e);
      return null;
    }
  }, [apiPrefix]);

  const getPublicToken = useCallback(async (): Promise<string | null> => {
    if (!classId) return null;
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}${apiPrefix}/public-token/${classId}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (json.error) {
        alert(json.error);
        return null;
      }
      return json.data.token;
    } catch (e) {
      console.error('getPublicToken error:', e);
      return null;
    }
  }, [classId, apiPrefix]);

  return {
    students,
    seats,
    layout,
    loading,
    error,
    selectedSeatNumber,
    setSelectedSeatNumber,
    isLocked: layout.is_locked,
    saveSeating,
    autoArrange,
    reverseArrange,
    toggleLock,
    clearAll,
    requestProxyToken,
    revokeProxyToken,
    getStudentBySeatNumber,
    unassignedStudents,
    saveAttendance,
    getAttendanceList,
    getAttendanceDetail,
    getPublicToken,
    reload: () => classId && loadAll(classId),
  };
}
