import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../hooks/useAuth';

interface Session {
  id: string;
  device_info: string;
  ip_address: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
}

interface LoginHistory {
  id: string;
  login_time: string;
  logout_time: string | null;
  device_info: string;
  ip_address: string;
  login_status: 'success' | 'failed' | 'forced_logout';
  failure_reason: string | null;
}

interface SecurityStats {
  activeSessions: number;
  totalLogins: number;
  failedLogins: number;
}

export const SecuritySettings: React.FC = () => {
  const { getUserSessions, getLoginHistory, getSecurityStats, forceLogoutSession, logoutOtherDevices } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<LoginHistory[]>([]);
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'sessions' | 'history' | 'stats'>('sessions');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sessionsData, historyData, statsData] = await Promise.all([
        getUserSessions(),
        getLoginHistory(30),
        getSecurityStats()
      ]);
      
      console.log('Loaded sessions:', sessionsData); // 添加调试日志
      setSessions(sessionsData || []);
      setHistory(historyData || []);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load security data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleForceLogout = async (sessionId: string, deviceInfo: string) => {
    if (!confirm(`确定要踢出该设备吗？\n设备：${deviceInfo}`)) return;
    
    try {
      const result = await forceLogoutSession(sessionId);
      console.log('Force logout result:', result); // 添加调试日志
      if (result.success) {
        alert('该设备已下线');
        // 延迟一点时间再加载数据，确保后端状态已更新
        await new Promise(resolve => setTimeout(resolve, 100));
        await loadData();
      } else {
        alert('操作失败：' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('Force logout error:', error);
      alert('操作失败');
    }
  };

  const handleLogoutOthers = async () => {
    if (!confirm('确定要踢出所有其他设备吗？')) return;
    
    try {
      const result = await logoutOtherDevices();
      console.log('Logout others result:', result); // 添加调试日志
      if (result.success) {
        alert(result.message || '已踢出所有其他设备');
        // 延迟一点时间再加载数据，确保后端状态已更新
        await new Promise(resolve => setTimeout(resolve, 100));
        await loadData();
      } else {
        alert('操作失败：' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('Logout others error:', error);
      alert('操作失败');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return `${Math.floor(diff / 86400)}天前`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <i className="fa-solid fa-spinner fa-spin text-4xl text-blue-500 mb-4"></i>
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">登录安全</h1>
          <p className="text-gray-500 mt-1">管理登录设备，保护账号安全</p>
        </div>
        {sessions.length > 1 && (
          <button
            onClick={handleLogoutOthers}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <i className="fa-solid fa-sign-out-alt"></i>
            踢出所有其他设备
          </button>
        )}
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-blue-500"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <i className="fa-solid fa-laptop text-2xl text-blue-500"></i>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">{stats.activeSessions}</div>
                <div className="text-sm text-gray-500">活跃设备</div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-green-500"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <i className="fa-solid fa-check-circle text-2xl text-green-500"></i>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">{stats.totalLogins}</div>
                <div className="text-sm text-gray-500">30天登录</div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-red-500"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <i className="fa-solid fa-exclamation-circle text-2xl text-red-500"></i>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">{stats.failedLogins}</div>
                <div className="text-sm text-gray-500">失败尝试</div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* 标签页 */}
      <div className="bg-white rounded-xl shadow-sm">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('sessions')}
            className={`flex-1 px-6 py-4 text-center font-medium transition-colors ${
              activeTab === 'sessions'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fa-solid fa-laptop-house mr-2"></i>
            当前设备 ({sessions.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-6 py-4 text-center font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fa-solid fa-history mr-2"></i>
            登录历史
          </button>
        </div>

        <div className="p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'sessions' && (
              <motion.div
                key="sessions"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                {sessions.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <i className="fa-solid fa-laptop text-4xl mb-4"></i>
                    <p>暂无登录设备</p>
                  </div>
                ) : (
                  sessions.map((session, index) => (
                    <div
                      key={session.id}
                      className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-4">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                            index === 0 ? 'bg-blue-100' : 'bg-gray-200'
                          }`}>
                            <i className={`fa-solid ${index === 0 ? 'fa-star text-blue-500' : 'fa-laptop text-gray-500'}`}></i>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-gray-800">{session.device_info}</h3>
                              {index === 0 && (
                                <span className="px-2 py-1 bg-blue-100 text-blue-600 text-xs rounded-full">
                                  当前设备
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                              <i className="fa-solid fa-globe mr-1"></i>
                              IP: {session.ip_address}
                            </p>
                            <p className="text-sm text-gray-500">
                              <i className="fa-solid fa-clock mr-1"></i>
                              最后活跃: {getTimeAgo(session.last_active_at)}
                            </p>
                            <p className="text-sm text-gray-400 mt-1">
                              登录时间: {formatDate(session.created_at)}
                            </p>
                          </div>
                        </div>
                        {index !== 0 && (
                          <button
                            onClick={() => handleForceLogout(session.id, session.device_info)}
                            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <i className="fa-solid fa-sign-out-alt mr-1"></i>
                            踢出
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-2"
              >
                {history.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <i className="fa-solid fa-history text-4xl mb-4"></i>
                    <p>暂无登录历史</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <div
                      key={item.id}
                      className={`p-4 rounded-lg border ${
                        item.login_status === 'success'
                          ? 'bg-gray-50 border-gray-200'
                          : item.login_status === 'failed'
                          ? 'bg-red-50 border-red-200'
                          : 'bg-yellow-50 border-yellow-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            item.login_status === 'success'
                              ? 'bg-green-100'
                              : item.login_status === 'failed'
                              ? 'bg-red-100'
                              : 'bg-yellow-100'
                          }`}>
                            <i className={`${
                              item.login_status === 'success'
                                ? 'fa-solid fa-check text-green-500'
                                : item.login_status === 'failed'
                                ? 'fa-solid fa-times text-red-500'
                                : 'fa-solid fa-sign-out-alt text-yellow-500'
                            }`}></i>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-gray-800">
                                {item.login_status === 'success'
                                  ? '登录成功'
                                  : item.login_status === 'failed'
                                  ? '登录失败'
                                  : '被踢下线'}
                              </h3>
                              {item.login_status === 'failed' && item.failure_reason && (
                                <span className="px-2 py-1 bg-red-100 text-red-600 text-xs rounded-full">
                                  {item.failure_reason}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                              {item.device_info}
                            </p>
                            <p className="text-sm text-gray-500">
                              <i className="fa-solid fa-globe mr-1"></i>
                              {item.ip_address}
                            </p>
                            <p className="text-sm text-gray-400 mt-1">
                              {formatDate(item.login_time)}
                            </p>
                          </div>
                        </div>
                        {item.logout_time && (
                          <div className="text-right">
                            <p className="text-sm text-gray-500">
                              <i className="fa-solid fa-sign-out-alt mr-1"></i>
                              登出时间
                            </p>
                            <p className="text-sm text-gray-400">
                              {formatDate(item.logout_time)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 安全提示 */}
      <div className="mt-6 bg-blue-50 rounded-xl p-4 border border-blue-200">
        <div className="flex items-start gap-3">
          <i className="fa-solid fa-info-circle text-blue-500 mt-1"></i>
          <div>
            <h4 className="font-medium text-blue-800">安全提示</h4>
            <ul className="text-sm text-blue-700 mt-2 space-y-1">
              <li>• 定期查看登录历史，检查是否有异常登录</li>
              <li>• 发现可疑设备请立即踢出并修改密码</li>
              <li>• 建议使用强密码，并定期更换</li>
              <li>• 不要在公共设备上保存登录状态</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
