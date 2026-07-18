import React, { useState, useEffect } from 'react';
import { backendClient } from '../../api/backendClient';
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

interface AccessConfig {
  enabled: boolean;
  hasPassword: boolean;
}

export const MentalHealthManager: React.FC = () => {
  const [alerts, setAlerts] = useState<MentalHealthAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'resolved'>('unresolved');
  const [selectedAlert, setSelectedAlert] = useState<MentalHealthAlert | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [accessConfig, setAccessConfig] = useState<AccessConfig | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const params: any = { limit: 100 };
      if (filter !== 'all') {
        params.is_resolved = (filter === 'resolved') ? 'true' : 'false';
      }
      const result = await backendClient.get('/api/mental-health/alerts', params);
      if (result.data) {
        setAlerts(result.data);
      }
    } catch (error) {
      console.error('获取预警列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [filter]);

  const handleResolve = async (alert: MentalHealthAlert) => {
    const confirmed = confirm('确定要标记此预警为已解决吗？');
    if (!confirmed) return;

    try {
      await backendClient.put(`/api/mental-health/alerts/${alert.id}/resolve`, {
        notes: resolveNotes || null
      });
      await fetchAlerts();
      setSelectedAlert(null);
      setResolveNotes('');
    } catch (error) {
      console.error('标记解决失败:', error);
      alert('操作失败，请重试');
    }
  };

  const handleDelete = async (alert: MentalHealthAlert) => {
    const confirmed = confirm('确定要删除此预警吗？此操作不可撤销。');
    if (!confirmed) return;

    try {
      await backendClient.delete(`/api/mental-health/alerts/${alert.id}`);
      await fetchAlerts();
      if (selectedAlert?.id === alert.id) {
        setSelectedAlert(null);
      }
    } catch (error) {
      console.error('删除失败:', error);
      alert('操作失败，请重试');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const fallbackCopy = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      alert('链接已复制到剪贴板！');
    } catch {
      alert('复制失败，请手动复制：\n' + text);
    }
    document.body.removeChild(textarea);
  };

  const fetchAccessConfig = async () => {
    try {
      const result = await backendClient.get('/api/mental-health/access-config');
      if (result.data) {
        setAccessConfig(result.data);
      }
    } catch (error) {
      console.error('获取访问配置失败:', error);
    }
  };

  useEffect(() => {
    fetchAccessConfig();
  }, []);

  const handleSavePassword = async (pwd?: string) => {
    setPasswordError('');
    setSaveSuccess(false);

    const passwordToSave = pwd !== undefined ? pwd : (newPassword.trim() || null);

    if (passwordToSave && passwordToSave !== confirmPassword.trim()) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    try {
      const response = await backendClient.put('/api/mental-health/access-config', {
        password: passwordToSave || ''
      });
      if (response && response.error) {
        setPasswordError(response.error);
        return;
      }
      setSaveSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      await fetchAccessConfig();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('保存密码失败:', error);
      setPasswordError('保存失败，请重试');
    }
  };

  const toggleAccessEnabled = async (enabled: boolean) => {
    try {
      await backendClient.put('/api/mental-health/access-config', {
        enabled
      });
      await fetchAccessConfig();
    } catch (error) {
      console.error('更新配置失败:', error);
    }
  };

  const externalUrl = `${window.location.origin}${window.location.pathname}#/mental-health`;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">心理健康预警管理</h2>
          <p className="text-gray-600 mt-1">关注学生心理健康，及时发现和处理问题</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('unresolved')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'unresolved'
                ? 'bg-red-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            待处理
            {alerts.filter(a => !a.is_resolved).length > 0 && (
              <span className="ml-2 bg-white text-red-700 rounded-full px-2 py-0.5 text-xs">
                {alerts.filter(a => !a.is_resolved).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setFilter('resolved')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'resolved'
                ? 'bg-green-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            已解决
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            全部
          </button>
          <button
            onClick={fetchAlerts}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <i className="fa-solid fa-rotate-right mr-2"></i>
            刷新
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
              showSettings
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <i className="fa-solid fa-gear"></i>
            设置
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="mb-6 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <i className="fa-solid fa-lock text-green-500"></i>
            外部访问配置
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800">启用外部访问</p>
                  <p className="text-sm text-gray-500">允许通过专用页面访问预警管理</p>
                </div>
                <button
                  onClick={() => toggleAccessEnabled(!accessConfig?.enabled)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    accessConfig?.enabled
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {accessConfig?.enabled ? '已启用' : '已禁用'}
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  访问密码
                </label>
                <div className="space-y-2">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={accessConfig?.hasPassword ? '设置新密码' : '设置访问密码'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入密码确认"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  
                  {passwordError && (
                    <p className="text-sm text-red-600">{passwordError}</p>
                  )}
                  
                  {saveSuccess && (
                    <p className="text-sm text-green-600 flex items-center gap-1">
                      <i className="fa-solid fa-check-circle"></i>
                      保存成功！
                    </p>
                  )}
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSavePassword()}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      <i className="fa-solid fa-save mr-2"></i>
                      保存
                    </button>
                    {accessConfig?.hasPassword && (
                      <button
                        onClick={() => {
                          if (confirm('确定要清除密码吗？清除后无需密码即可访问。')) {
                            handleSavePassword('');
                          }
                        }}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        <i className="fa-solid fa-key-slash mr-2"></i>
                        清除密码
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h4 className="font-medium text-green-800 mb-2 flex items-center gap-2">
                <i className="fa-solid fa-link"></i>
                外部访问链接
              </h4>
              <div className="bg-white p-3 rounded border border-green-200 mb-3">
                <code className="text-sm text-green-700 break-all">{externalUrl}</code>
              </div>
              <button
                onClick={() => {
                  const copyText = externalUrl;
                  if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(copyText).then(() => {
                      alert('链接已复制到剪贴板！');
                    }).catch(() => {
                      fallbackCopy(copyText);
                    });
                  } else {
                    fallbackCopy(copyText);
                  }
                }}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <i className="fa-solid fa-copy mr-2"></i>
                复制链接
              </button>
              <p className="text-xs text-green-700 mt-3">
                <i className="fa-solid fa-info-circle mr-1"></i>
                将此链接分享给相关人员，使用设置的密码即可访问
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 gap-6">
        {/* 预警列表 */}
        <div className="w-1/2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-800">
              预警列表 {alerts.length > 0 && `(${alerts.length})`}
            </h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            {loading ? (
              <div className="p-8 text-center text-gray-500">
                <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                <p>加载中...</p>
              </div>
            ) : alerts.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <i className="fa-solid fa-heart-circle-check text-4xl mb-4 text-green-500"></i>
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
                            <i className="fa-solid fa-exclamation-triangle"></i>
                            待处理
                          </span>
                        )}
                        {alert.is_resolved && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                            <i className="fa-solid fa-check"></i>
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
                      <p className="text-sm text-gray-600 mb-1">
                        {alert.alert_content.length > 100
                          ? alert.alert_content.substring(0, 100) + '...'
                          : alert.alert_content
                        }
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

        {/* 预警详情 */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {selectedAlert ? (
            <>
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">预警详情</h3>
                <div className="flex gap-2">
                  {!selectedAlert.is_resolved && (
                    <button
                      onClick={() => handleResolve(selectedAlert)}
                      className="px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm"
                    >
                      <i className="fa-solid fa-check mr-1"></i>
                      标记解决
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(selectedAlert)}
                    className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm"
                  >
                    <i className="fa-solid fa-trash mr-1"></i>
                    删除
                  </button>
                </div>
              </div>
              <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                <div className="mb-4">
                  <div className="grid grid-cols-2 gap-4 mb-4">
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
                      <div className="whitespace-pre-wrap text-gray-700">
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
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <i className="fa-solid fa-heart-circle text-4xl text-gray-300 mb-4"></i>
                <p>选择一条预警查看详情</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
