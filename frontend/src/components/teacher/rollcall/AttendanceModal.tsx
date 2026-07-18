import React, { useState, useEffect, useCallback } from 'react';

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

interface AttendanceModalProps {
  onClose: () => void;
  onSave: (note: string) => Promise<void>;
  onGetList: () => Promise<AttendanceRecord[]>;
  onGetDetail: (recordId: string) => Promise<AttendanceDetail | null>;
  onGetPublicToken?: () => Promise<void>;
}

export const AttendanceModal: React.FC<AttendanceModalProps> = ({
  onClose,
  onSave,
  onGetList,
  onGetDetail,
  onGetPublicToken,
}) => {
  const [tab, setTab] = useState<'save' | 'history'>('save');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [detail, setDetail] = useState<AttendanceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    const data = await onGetList();
    setRecords(data);
    setLoadingList(false);
  }, [onGetList]);

  useEffect(() => {
    if (tab === 'history' && records.length === 0) {
      loadList();
    }
  }, [tab, records.length, loadList]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(note);
    setSaving(false);
  };

  const handleViewDetail = async (recordId: string) => {
    setLoadingDetail(true);
    setDetail(null);
    const data = await onGetDetail(recordId);
    setDetail(data);
    setLoadingDetail(false);
  };

  const formatTime = (t: string) => {
    const d = new Date(t);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <i className="fa-solid fa-clipboard-check text-green-400"></i>
            考勤记录
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-slate-700">
          <button
            onClick={() => setTab('save')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              tab === 'save' ? 'text-green-300 border-b-2 border-green-400 bg-green-500/5' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <i className="fa-solid fa-floppy-disk mr-1.5"></i>
            保存当前考勤
          </button>
          <button
            onClick={() => setTab('history')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              tab === 'history' ? 'text-green-300 border-b-2 border-green-400 bg-green-500/5' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <i className="fa-solid fa-clock-rotate-left mr-1.5"></i>
            历史记录
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'save' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2">备注（可选）</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：第一节课、周三上午..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200 focus:outline-none focus:border-green-500 resize-none"
                  rows={3}
                />
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {saving ? (
                  <><i className="fa-solid fa-circle-notch fa-spin"></i>保存中...</>
                ) : (
                  <><i className="fa-solid fa-check"></i>保存考勤记录</>
                )}
              </button>

{onGetPublicToken && (
              <div className="pt-3 border-t border-slate-700">
                <button
                  onClick={onGetPublicToken}
                  className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                >
                  <i className="fa-solid fa-link"></i>
                  生成班主任查看链接
                </button>
                <p className="text-[11px] text-slate-500 mt-1.5 text-center">
                  生成免登录链接，班主任可在手机上查看学生在线状态和考勤记录
                </p>
              </div>
              )}
            </div>
          ) : (
            <div>
              {loadingList ? (
                <div className="flex items-center justify-center py-8">
                  <i className="fa-solid fa-circle-notch fa-spin text-2xl text-green-400"></i>
                </div>
              ) : records.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <i className="fa-solid fa-inbox text-3xl mb-2 block"></i>
                  <p className="text-sm">暂无考勤记录</p>
                </div>
              ) : detail ? (
                <div>
                  <button
                    onClick={() => setDetail(null)}
                    className="text-sm text-green-400 hover:text-green-300 mb-3 flex items-center gap-1"
                  >
                    <i className="fa-solid fa-arrow-left"></i>返回列表
                  </button>
                  {loadingDetail ? (
                    <div className="flex items-center justify-center py-8">
                      <i className="fa-solid fa-circle-notch fa-spin text-2xl text-green-400"></i>
                    </div>
                  ) : (
                    <div>
                      <div className="bg-slate-800/60 rounded p-3 mb-3">
                        <div className="text-sm text-slate-300 mb-1">
                          {formatTime(detail.record_time)}
                        </div>
                        <div className="flex gap-4 text-xs font-mono">
                          <span className="text-cyan-300">应到 {detail.total_count}</span>
                          <span className="text-green-300">实到 {detail.online_count}</span>
                          <span className="text-red-300">缺席 {detail.absent_count}</span>
                        </div>
                        {detail.note && <div className="text-xs text-slate-400 mt-1">备注：{detail.note}</div>}
                      </div>
                      <div className="space-y-1.5">
                        {detail.attendance_data.map((s, i) => (
                          <div
                            key={i}
                            className={`flex items-center justify-between px-3 py-1.5 rounded text-sm ${
                              s.is_online ? 'bg-cyan-500/10 text-cyan-200' : 'bg-red-500/10 text-red-200'
                            }`}
                          >
                            <span className="font-medium">{s.real_name || s.username}</span>
                            <span className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-slate-500">#{String(s.seat_number).padStart(2, '0')}</span>
                              <span className={`text-xs ${s.is_online ? 'text-cyan-300' : 'text-red-300'}`}>
                                {s.is_online ? '在线' : '缺席'}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {records.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => handleViewDetail(r.id)}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/60 hover:bg-slate-800 rounded text-left transition-colors border border-slate-700/50 hover:border-green-500/30"
                    >
                      <div>
                        <div className="text-sm text-slate-200">{formatTime(r.record_time)}</div>
                        {r.note && <div className="text-[11px] text-slate-500 mt-0.5">{r.note}</div>}
                      </div>
                      <div className="flex gap-3 text-xs font-mono">
                        <span className="text-cyan-300">{r.online_count}/{r.total_count}</span>
                        {r.absent_count > 0 && <span className="text-red-300">缺席{r.absent_count}</span>}
                      </div>
                    </button>
                  ))}
                  <button
                    onClick={loadList}
                    className="w-full text-center text-xs text-slate-500 hover:text-slate-300 py-2"
                  >
                    <i className="fa-solid fa-rotate-right mr-1"></i>刷新
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
