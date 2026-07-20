import React, { useState, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Desktop } from './pages/Desktop';
import { TeacherDashboard } from './pages/TeacherDashboard';
import MentalHealthExternal from './pages/MentalHealthExternal';
import PublicTaskView from './pages/PublicTaskView';
import RollCallPublic from './pages/RollCallPublic';
import { useAuth } from './hooks/useAuth';
import { backendClient } from './api/backendClient';

// IP 违规强制退出弹窗：3 秒倒计时后自动登出，不可关闭
const IpViolationOverlay: React.FC<{ seatNumber: number; onTimeout: () => void }> = ({ seatNumber, onTimeout }) => {
  const [countdown, setCountdown] = useState(3);
  // onTimeout 每次渲染都是新引用，用 ref 固定，保证倒计时只启动一次、不被打断
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onTimeoutRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur flex flex-col items-center justify-center text-center px-6">
      <i className="fa-solid fa-triangle-exclamation text-7xl text-red-500 mb-6 animate-pulse"></i>
      <p className="text-2xl md:text-3xl font-bold text-red-400 mb-4">
        请回自己的 {seatNumber} 号座位登录
      </p>
      <p className="text-sm text-slate-400 mb-8">检测到当前登录 IP 与座位绑定 IP 不符</p>
      <div className="w-16 h-16 rounded-full border-4 border-red-500/60 flex items-center justify-center">
        <span className="text-3xl font-bold text-red-400 font-mono">{countdown}</span>
      </div>
      <p className="text-xs text-slate-500 mt-4 font-mono">秒后将自动退出登录</p>
    </div>
  );
};

function App() {
  const { profile, loading: authLoading, checkAndEnforceLoginRestriction, checkIpViolation, ipViolation, isStudent, isProxyMode, signOut } = useAuth();
  const [initStatus, setInitStatus] = useState('Initializing...');
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const result = await backendClient.healthCheck();
        if (result.status === 'ok') {
          console.log('Backend database connected successfully');
          setInitStatus('Connected to database');
        }
      } catch (error) {
        setInitError('Cannot connect to database server. Please ensure the backend is running.');
        console.error('Database connection failed:', error);
      }
    };

    checkConnection();
  }, []);

  // 定期检查学生登录权限 + IP 绑定违规
  useEffect(() => {
    if (!isStudent) return;

    console.log('启动学生登录权限定期检查');

    // 立即检查一次
    checkAndEnforceLoginRestriction();
    checkIpViolation();

    // 每30秒检查一次
    const interval = setInterval(() => {
      checkAndEnforceLoginRestriction();
      checkIpViolation();
    }, 30000);

    return () => clearInterval(interval);
  }, [isStudent, checkAndEnforceLoginRestriction, checkIpViolation]);

  console.log('App.tsx: profile =', profile?.role, 'authLoading =', authLoading);

  if (initError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center text-red-500 max-w-md p-6">
          <i className="fa-solid fa-database text-6xl mb-4"></i>
          <p className="text-xl font-bold mb-2">数据库连接失败</p>
          <p className="text-sm text-gray-600 mb-4">{initError}</p>
          <div className="text-left bg-gray-100 p-4 rounded text-sm">
            <p className="font-semibold">请检查：</p>
            <ol className="list-decimal list-inside text-left text-gray-600">
              <li>后端服务是否已启动？</li>
              <li>MariaDB 服务器是否可访问？</li>
              <li>数据库是否已初始化？</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-4xl text-blue-500 mb-4"></i>
          <p className="text-gray-600">{initStatus}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* IP 违规强制退出遮罩（代理模式下不显示，不可关闭） */}
      {ipViolation && !isProxyMode && (
        <IpViolationOverlay seatNumber={ipViolation.seat_number} onTimeout={signOut} />
      )}
      <HashRouter>
      <Routes>
        <Route path="/mental-health" element={<MentalHealthExternal />} />
        <Route path="/public/task/:taskId" element={<PublicTaskView />} />
        <Route path="/roll-call-public" element={<RollCallPublic />} />
        <Route path="/" element={
          profile ? (
            profile.role === 'student' ? <Navigate to="/desktop" replace /> : <Navigate to="/teacher" replace />
          ) : <Login />
        } />
        <Route path="/desktop" element={
          // 代理模式或学生角色，渲染 Desktop
          isProxyMode || profile?.role === 'student' ? <Desktop /> : <Navigate to="/" replace />
        } />
        <Route path="/teacher" element={
          profile?.role === 'teacher' || profile?.role === 'super_admin' ? <TeacherDashboard /> : <Navigate to="/" replace />
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
    </>
  );
}

export default App;
