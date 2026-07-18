import React, { useState, useEffect, useCallback } from 'react';
import { API_CONFIG } from '../api/config';

interface PublicStudent {
  id: string;
  username: string;
  real_name: string;
  is_online: boolean;
}

interface PublicSeat {
  seat_number: number;
  student_id: string | null;
  position_x: number;
  position_y: number;
}

interface PublicData {
  class_name: string;
  students: PublicStudent[];
  seats: PublicSeat[];
  online_count: number;
  total_count: number;
}

interface AttendanceRecord {
  id: string;
  record_time: string;
  total_count: number;
  online_count: number;
  absent_count: number;
  note: string | null;
}

interface AttendanceDetail {
  id: string;
  record_time: string;
  total_count: number;
  online_count: number;
  absent_count: number;
  attendance_data: Array<{
    student_id: string;
    username: string;
    real_name: string;
    seat_number: number;
    is_online: boolean;
  }>;
  note: string | null;
}

export default function RollCallPublic() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<PublicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'seats' | 'list' | 'history'>('seats');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [detail, setDetail] = useState<AttendanceDetail | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 从 URL 获取 token
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.split('?')[1] || '');
    const t = params.get('token');
    if (t) {
      setToken(t);
    } else {
      setError('缺少访问令牌');
      setLoading(false);
    }
  }, []);

  // 动态设置 Open Graph meta 标签
  useEffect(() => {
    if (data?.class_name) {
      // 设置 og:title
      let ogTitle = document.querySelector('meta[property="og:title"]');
      if (!ogTitle) {
        ogTitle = document.createElement('meta');
        ogTitle.setAttribute('property', 'og:title');
        document.head.appendChild(ogTitle);
      }
      ogTitle.setAttribute('content', `${data.class_name} 信息课点名系统`);

      // 设置 og:description
      let ogDesc = document.querySelector('meta[property="og:description"]');
      if (!ogDesc) {
        ogDesc = document.createElement('meta');
        ogDesc.setAttribute('property', 'og:description');
        document.head.appendChild(ogDesc);
      }
      ogDesc.setAttribute('content', '点击查看考勤记录');

      // 设置 og:image
      let ogImage = document.querySelector('meta[property="og:image"]');
      if (!ogImage) {
        ogImage = document.createElement('meta');
        ogImage.setAttribute('property', 'og:image');
        document.head.appendChild(ogImage);
      }
      const baseUrl = window.location.origin;
      ogImage.setAttribute('content', `${baseUrl}/logo.png`);

      // 设置 document.title
      document.title = `${data.class_name} - 课堂点名`;
    }
  }, [data?.class_name]);

  // 加载数据
  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/public/roll-call/${token}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setData(json.data);
        setError(null);
      }
    } catch (e) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 自动刷新（15秒）
  useEffect(() => {
    if (!autoRefresh || !token) return;
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, token, loadData]);

  // 加载考勤记录
  const loadRecords = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/public/roll-call/${token}/attendance`);
      const json = await res.json();
      if (json.data) setRecords(json.data);
    } catch (e) {
      console.error('加载考勤记录失败', e);
    }
  }, [token]);

  // 查看考勤详情
  const loadDetail = useCallback(async (recordId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/public/roll-call/${token}/attendance/${recordId}`);
      const json = await res.json();
      if (json.data) setDetail(json.data);
    } catch (e) {
      console.error('加载考勤详情失败', e);
    }
  }, [token]);

  useEffect(() => {
    if (view === 'history' && records.length === 0) {
      loadRecords();
    }
  }, [view, records.length, loadRecords]);

  const formatTime = (t: string) => {
    const d = new Date(t);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-cyan-400"></i>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-6">
        <div className="text-center">
          <i className="fa-solid fa-link-slash text-5xl text-slate-600 mb-4"></i>
          <p className="text-slate-400 text-lg mb-2">访问失败</p>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const absentCount = data.total_count - data.online_count;
  const seatMap = new Map(data.seats.map(s => [s.student_id, s]));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ maxWidth: '600px', margin: '0 auto' }}>
      {/* 顶部信息 */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <i className="fa-solid fa-clipboard-check text-green-400"></i>
            {data.class_name}
          </h1>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-xs px-2 py-1 rounded ${autoRefresh ? 'bg-green-500/20 text-green-300' : 'bg-slate-800 text-slate-400'}`}
          >
            <i className={`fa-solid ${autoRefresh ? 'fa-pause' : 'fa-play'} mr-1`}></i>
            {autoRefresh ? '自动刷新' : '已暂停'}
          </button>
        </div>
        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2 text-center">
            <div className="text-2xl font-bold text-cyan-300">{data.online_count}</div>
            <div className="text-[10px] text-slate-400">在线</div>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-center">
            <div className="text-2xl font-bold text-red-300">{absentCount}</div>
            <div className="text-[10px] text-slate-400">缺席</div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-center">
            <div className="text-2xl font-bold text-slate-300">{data.total_count}</div>
            <div className="text-[10px] text-slate-400">总数</div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-slate-800 sticky top-[112px] z-10 bg-slate-950">
        <button
          onClick={() => setView('seats')}
          className={`flex-1 py-2.5 text-sm font-medium ${view === 'seats' ? 'text-cyan-300 border-b-2 border-cyan-400' : 'text-slate-500'}`}
        >
          <i className="fa-solid fa-grip mr-1"></i>座位
        </button>
        <button
          onClick={() => setView('list')}
          className={`flex-1 py-2.5 text-sm font-medium ${view === 'list' ? 'text-cyan-300 border-b-2 border-cyan-400' : 'text-slate-500'}`}
        >
          <i className="fa-solid fa-list mr-1"></i>名单
        </button>
        <button
          onClick={() => setView('history')}
          className={`flex-1 py-2.5 text-sm font-medium ${view === 'history' ? 'text-cyan-300 border-b-2 border-cyan-400' : 'text-slate-500'}`}
        >
          <i className="fa-solid fa-clock-rotate-left mr-1"></i>记录
        </button>
      </div>

      {/* 内容区 */}
      <div className="p-3 pb-8">
        {view === 'seats' && (
          <div className="grid grid-cols-8 gap-1">
            {data.seats.length > 0 ? (
              data.seats
                .sort((a, b) => a.seat_number - b.seat_number)
                .map(seat => {
                  const student = seat.student_id ? data.students.find(s => s.id === seat.student_id) : null;
                  return (
                    <div
                      key={seat.seat_number}
                      className={`relative rounded p-1 text-center min-h-[48px] flex flex-col items-center justify-center ${
                        !student
                          ? 'bg-slate-800/30 border border-dashed border-slate-700'
                          : student.is_online
                          ? 'bg-cyan-500/10 border border-cyan-500/30'
                          : 'bg-red-500/10 border border-red-500/30'
                      }`}
                    >
                      <div className="absolute top-0 left-0.5 text-[8px] font-mono text-slate-600 leading-none">#{seat.seat_number}</div>
                      {student ? (
                        <>
                          <div className={`w-1.5 h-1.5 rounded-full mb-0.5 ${student.is_online ? 'bg-cyan-400' : 'bg-red-400'}`}></div>
                          <div className={`text-[10px] font-bold leading-tight ${student.is_online ? 'text-cyan-200' : 'text-red-200'}`}>
                            {(student.real_name || student.username).slice(0, 3)}
                          </div>
                        </>
                      ) : (
                        <i className="fa-solid fa-chair text-slate-700 text-xs mt-1"></i>
                      )}
                    </div>
                  );
                })
            ) : (
              <div className="col-span-8 text-center py-8 text-slate-500 text-sm">暂无座位布局</div>
            )}
          </div>
        )}

        {view === 'list' && (
          <div className="space-y-1.5">
            {/* 缺席学生优先显示 */}
            {data.students.filter(s => !s.is_online).length > 0 && (
              <>
                <div className="text-xs text-red-400 font-medium pt-2 pb-1">
                  <i className="fa-solid fa-circle-exclamation mr-1"></i>
                  缺席 ({data.students.filter(s => !s.is_online).length})
                </div>
                {data.students.filter(s => !s.is_online).map(s => {
                  const seat = seatMap.get(s.id);
                  return (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-sm font-bold text-red-300">
                          {(s.real_name || s.username).charAt(0)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-200">{s.real_name || s.username}</div>
                          {seat && <div className="text-[10px] font-mono text-slate-500">座位 #{seat.seat_number}</div>}
                        </div>
                      </div>
                      <span className="text-xs text-red-300">缺席</span>
                    </div>
                  );
                })}
              </>
            )}
            {/* 在线学生 */}
            <div className="text-xs text-cyan-400 font-medium pt-3 pb-1">
              <i className="fa-solid fa-circle-check mr-1"></i>
              在线 ({data.students.filter(s => s.is_online).length})
            </div>
            {data.students.filter(s => s.is_online).map(s => {
              const seat = seatMap.get(s.id);
              return (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm font-bold text-cyan-300">
                      {(s.real_name || s.username).charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-200">{s.real_name || s.username}</div>
                      {seat && <div className="text-[10px] font-mono text-slate-500">座位 #{seat.seat_number}</div>}
                    </div>
                  </div>
                  <span className="text-xs text-cyan-300">在线</span>
                </div>
              );
            })}
          </div>
        )}

        {view === 'history' && (
          <div>
            {detail ? (
              <div>
                <button
                  onClick={() => setDetail(null)}
                  className="text-sm text-cyan-400 mb-3 flex items-center gap-1"
                >
                  <i className="fa-solid fa-arrow-left"></i>返回列表
                </button>
                <div className="bg-slate-800/60 rounded-lg p-3 mb-3">
                  <div className="text-sm text-slate-300 mb-2">{formatTime(detail.record_time)}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-slate-700/50 rounded p-1.5">
                      <div className="text-lg font-bold text-slate-200">{detail.total_count}</div>
                      <div className="text-[10px] text-slate-500">应到</div>
                    </div>
                    <div className="bg-cyan-500/10 rounded p-1.5">
                      <div className="text-lg font-bold text-cyan-300">{detail.online_count}</div>
                      <div className="text-[10px] text-slate-500">实到</div>
                    </div>
                    <div className="bg-red-500/10 rounded p-1.5">
                      <div className="text-lg font-bold text-red-300">{detail.absent_count}</div>
                      <div className="text-[10px] text-slate-500">缺席</div>
                    </div>
                  </div>
                  {detail.note && <div className="text-xs text-slate-400 mt-2">备注：{detail.note}</div>}
                </div>
                <div className="space-y-1">
                  {detail.attendance_data.map((s, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                        s.is_online ? 'bg-cyan-500/10 text-cyan-200' : 'bg-red-500/10 text-red-200'
                      }`}
                    >
                      <span className="font-medium">{s.real_name || s.username}</span>
                      <span className="text-xs">{s.is_online ? '在线' : '缺席'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : records.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <i className="fa-solid fa-inbox text-3xl mb-2 block"></i>
                <p className="text-sm">暂无考勤记录</p>
              </div>
            ) : (
              <div className="space-y-2">
                {records.map(r => (
                  <button
                    key={r.id}
                    onClick={() => loadDetail(r.id)}
                    className="w-full flex items-center justify-between px-3 py-3 bg-slate-800/60 hover:bg-slate-800 rounded-lg text-left border border-slate-700/50"
                  >
                    <div>
                      <div className="text-sm text-slate-200">{formatTime(r.record_time)}</div>
                      {r.note && <div className="text-[11px] text-slate-500 mt-0.5">{r.note}</div>}
                    </div>
                    <div className="flex gap-2 text-xs font-mono">
                      <span className="text-cyan-300">{r.online_count}/{r.total_count}</span>
                      {r.absent_count > 0 && <span className="text-red-300">缺{r.absent_count}</span>}
                    </div>
                  </button>
                ))}
                <button onClick={loadRecords} className="w-full text-center text-xs text-slate-500 py-2">
                  <i className="fa-solid fa-rotate-right mr-1"></i>刷新
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部刷新时间 */}
      <div className="fixed bottom-0 left-0 right-0 text-center text-[10px] text-slate-600 py-1.5 bg-slate-950/80 border-t border-slate-800" style={{ maxWidth: '600px', margin: '0 auto' }}>
        {autoRefresh ? '每15秒自动刷新' : '已暂停自动刷新'} · {new Date().toLocaleTimeString('zh-CN')}
      </div>
    </div>
  );
}
