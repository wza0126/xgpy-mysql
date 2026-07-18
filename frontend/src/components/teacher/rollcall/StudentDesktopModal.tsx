import React, { useEffect, useState } from 'react';
import { API_CONFIG } from '../../../api/config';

interface StudentDesktopModalProps {
  token: string;
  sessionId: string;
  studentName: string;
  studentUsername: string;
  expiresAt: string;
  onClose: () => void;
  onRevoke: (sessionId: string) => void;
}

export const StudentDesktopModal: React.FC<StudentDesktopModalProps> = ({
  token,
  sessionId,
  studentName,
  studentUsername,
  expiresAt,
  onClose,
  onRevoke,
}) => {
  const [mode, setMode] = useState<'control' | 'observe'>('control');
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    const updateRemaining = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const handleClose = () => {
    if (confirm('关闭远程控制后，token 将立即失效，确定吗？')) {
      onRevoke(sessionId);
      onClose();
    }
  };

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isExpired = remaining <= 0;

  // iframe URL：使用 hash router 格式，加 proxy_token 参数
  const iframeUrl = `${API_CONFIG.apiUrl}/#/desktop?proxy_token=${encodeURIComponent(token)}`;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-cyan-500/40 rounded-xl shadow-2xl shadow-cyan-500/20 w-[90vw] h-[85vh] flex flex-col overflow-hidden">
        {/* 顶部信息栏 */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-800/80 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
            <div>
              <div className="text-slate-100 font-bold flex items-center gap-2">
                <i className="fa-solid fa-desktop text-cyan-400"></i>
                查看学生桌面 - {studentName}
              </div>
              <div className="text-[10px] font-mono text-slate-500">{studentUsername}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 模式切换 */}
            <div className="flex bg-slate-900/60 rounded p-0.5 border border-slate-700">
              <button
                onClick={() => setMode('control')}
                className={`px-2.5 py-1 text-xs rounded ${
                  mode === 'control' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <i className="fa-solid fa-hand-pointer mr-1"></i>接管控制
              </button>
              <button
                onClick={() => setMode('observe')}
                className={`px-2.5 py-1 text-xs rounded ${
                  mode === 'observe' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <i className="fa-solid fa-eye mr-1"></i>只读查看
              </button>
            </div>

            {/* 倒计时 */}
            <div
              className={`px-3 py-1 rounded text-xs font-mono ${
                isExpired
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                  : remaining < 60
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30'
              }`}
            >
              <i className="fa-regular fa-clock mr-1"></i>
              {isExpired ? '已过期' : `${minutes}:${String(seconds).padStart(2, '0')}`}
            </div>

            <button
              onClick={handleClose}
              className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-xs border border-red-500/40"
            >
              <i className="fa-solid fa-xmark mr-1"></i>关闭并失效
            </button>
          </div>
        </div>

        {/* iframe */}
        {isExpired ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <i className="fa-solid fa-hourglass-end text-5xl mb-3 text-amber-400"></i>
            <p className="mb-2">访问凭证已过期</p>
            <p className="text-xs text-slate-500 font-mono">关闭此窗口并重新查看学生桌面</p>
          </div>
        ) : (
          <iframe
            key={mode}
            src={iframeUrl}
            className="flex-1 w-full bg-white"
            sandbox={
              mode === 'control'
                ? 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'
                : 'allow-scripts allow-same-origin allow-forms allow-popups'
            }
            title={`远程控制 - ${studentName}`}
          />
        )}

        {/* 底部安全提示 */}
        <div className="px-5 py-2 bg-slate-800/60 border-t border-slate-700 text-[10px] text-slate-500 flex items-center justify-between">
          <span>
            <i className="fa-solid fa-shield-halved text-cyan-500 mr-1"></i>
            本次访问仅为只读查看，不会影响学生端操作；关闭后凭证立即失效
          </span>
          <span className="font-mono text-slate-600">SESSION {sessionId.slice(0, 8).toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
};
