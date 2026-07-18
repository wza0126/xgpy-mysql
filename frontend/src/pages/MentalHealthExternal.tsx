import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MentalHealthAlert {
  id: string;
  user_id: string;
  user_type: 'student' | 'parent' | 'teacher';
  chat_id: string | null;
  alert_type: string;
  alert_content: string;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  username: string | null;
  real_name: string | null;
  class_id: string | null;
  class_name: string | null;
}

const MentalHealthExternal: React.FC = () => {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [alerts, setAlerts] = useState<MentalHealthAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'resolved'>('unresolved');
  const [selectedAlert, setSelectedAlert] = useState<MentalHealthAlert | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [error, setError] = useState('');

  // 从 localStorage 中恢复认证状态
  useEffect(() => {
    const savedPassword = localStorage.getItem('mental_health_password');
    if (savedPassword) {
      setPassword(savedPassword);
      verifyPassword(savedPassword, true).then(success => {
        if (!success) setPassword('');
      });
    }
  }, []);

  const verifyPassword = async (pwd: string, silent = false) => {
    try {
      const response = await fetch('/api/mental-health/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const data = await response.json();
      
      if (response.status === 403) {
        if (!silent) setError('心理健康预警功能未启用，请联系管理员');
        localStorage.removeItem('mental_health_password');
        setAuthenticated(false);
        return false;
      }
      
      if (response.status === 401 || data.error) {
        if (!silent) setError(data.error || '密码错误');
        if (silent) localStorage.removeItem('mental_health_password');
        setAuthenticated(false);
        return false;
      }
      
      if (data.data && data.data.valid) {
        setAuthenticated(true);
        localStorage.setItem('mental_health_password', pwd);
        await loadAlerts(pwd);
        return true;
      }
      
      const verifyError = '密码验证失败，请重试';
      if (!silent) setError(verifyError);
      return false;
    } catch (err) {
      const netError = '无法连接到服务器，请检查网络连接';
      if (!silent) setError(netError);
      return false;
    }
  };

  const loadAlerts = async (pwd: string) => {
    try {
      setLoading(true);
      const params: any = { password: pwd, limit: 100 };
      if (filter !== 'all') {
        params.is_resolved = filter === 'resolved';
      }
      
      const response = await fetch('/api/mental-health/external/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      const data = await response.json();
      
      if (data.error) {
        setError(data.error);
        return;
      }
      
      setAlerts(data.data || []);
    } catch (err) {
      setError('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const success = await verifyPassword(password);
    if (!success) {
      setError('密码错误，请重试');
    }
  };

  const handleLogout = () => {
    setAuthenticated(false);
    setPassword('');
    localStorage.removeItem('mental_health_password');
  };

  const handleResolve = async (alert: MentalHealthAlert) => {
    try {
      const response = await fetch(`/api/mental-health/external/alerts/${alert.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          password: password, 
          notes: resolveNotes || null 
        })
      });
      const data = await response.json();
      
      if (data.error) {
        setError(data.error);
        return;
      }
      
      await loadAlerts(password);
      setSelectedAlert(null);
      setResolveNotes('');
    } catch (err) {
      setError('操作失败');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-teal-100">
        <div className="max-w-md w-full p-8 bg-white rounded-2xl shadow-xl">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-teal-600 rounded-full flex items-center justify-center mx-auto mb-4 text-white text-3xl">
              💚
            </div>
            <h1 className="text-2xl font-bold text-gray-800">润心伴学</h1>
            <p className="text-gray-600 mt-2">心理健康预警管理</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                访问密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入访问密码"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                autoFocus
              />
            </div>
            
            {error && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}
            
            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-green-500 to-teal-600 text-white font-semibold rounded-xl hover:from-green-600 hover:to-teal-700 transition-all shadow-lg hover:shadow-xl"
            >
              进入
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-teal-600 rounded-lg flex items-center justify-center text-white text-xl">
                💚
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">润心伴学</h1>
                <p className="text-sm text-gray-600">心理健康预警管理</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          <button
            onClick={() => setFilter('unresolved')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              filter === 'unresolved'
                ? 'bg-red-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            待处理
            {alerts.filter(a => !a.is_resolved).length > 0 && (
              <span className="ml-2 bg-white/20 text-white rounded-full px-2 py-0.5 text-xs">
                {alerts.filter(a => !a.is_resolved).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setFilter('resolved')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              filter === 'resolved'
                ? 'bg-green-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            已解决
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              filter === 'all'
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => loadAlerts(password)}
            className="px-4 py-2 bg-white text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors ml-auto"
          >
            刷新
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-800">
                预警列表 {alerts.length > 0 && `(${alerts.length})`}
              </h2>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
              {loading ? (
                <div className="p-8 text-center text-gray-500">
                  <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                  <p>加载中...</p>
                </div>
              ) : alerts.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <div className="text-4xl mb-4 text-green-500">💚</div>
                  <p className="text-gray-600">暂无心理健康预警</p>
                  <p className="text-sm text-gray-400 mt-1">所有学生心理健康状态良好</p>
                </div>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert.id}
                    onClick={() => setSelectedAlert(alert)}
                    className={`p-4 border-b border-gray-100 cursor-pointer transition-colors ${
                      selectedAlert?.id === alert.id
                        ? 'bg-blue-50 border-l-4 border-l-blue-500'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {!alert.is_resolved && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                              待处理
                            </span>
                          )}
                          {alert.is_resolved && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              已解决
                            </span>
                          )}
                          <span className="text-sm font-medium text-gray-800">
                            {alert.real_name || alert.username || '未知用户'}
                          </span>
                          {alert.class_name && (
                            <span className="text-sm text-gray-500">
                              ({alert.class_name})
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-1 line-clamp-2">
                          {alert.alert_content}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatDate(alert.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {selectedAlert ? (
              <>
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-800">预警详情</h2>
                  <div className="flex gap-2">
                    {!selectedAlert.is_resolved && (
                      <button
                        onClick={() => handleResolve(selectedAlert)}
                        className="px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm"
                      >
                        标记解决
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                  <div className="mb-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          用户姓名
                        </label>
                        <div className="text-gray-900">
                          {selectedAlert.real_name || selectedAlert.username || '未知'}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          用户类型
                        </label>
                        <div className="text-gray-900">
                          {selectedAlert.user_type === 'student' ? '学生' :
                           selectedAlert.user_type === 'parent' ? '家长' : '教师'}
                        </div>
                      </div>
                      {selectedAlert.class_name && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            班级
                          </label>
                          <div className="text-gray-900">{selectedAlert.class_name}</div>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          创建时间
                        </label>
                        <div className="text-gray-900">{formatDate(selectedAlert.created_at)}</div>
                      </div>
                    </div>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        预警内容
                      </label>
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <div className="text-gray-700">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedAlert.alert_content}</ReactMarkdown>
                        </div>
                      </div>
                    </div>

                    {selectedAlert.is_resolved && (
                      <div className="mb-4">
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              解决时间
                            </label>
                            <div className="text-gray-900">
                              {selectedAlert.resolved_at ? formatDate(selectedAlert.resolved_at) : '-'}
                            </div>
                          </div>
                        </div>
                        {selectedAlert.notes && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              处理备注
                            </label>
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                              <div className="text-gray-700">{selectedAlert.notes}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {!selectedAlert.is_resolved && (
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          处理备注（选填）
                        </label>
                        <textarea
                          value={resolveNotes}
                          onChange={(e) => setResolveNotes(e.target.value)}
                          placeholder="记录处理过程、后续安排等信息..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          rows={4}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 p-8">
                <div className="text-center">
                  <div className="text-4xl mb-4 text-gray-300">💚</div>
                  <p>选择一条预警查看详情</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default MentalHealthExternal;
