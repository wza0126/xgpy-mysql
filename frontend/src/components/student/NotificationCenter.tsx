import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotificationStore, Notification } from '../../store/notificationStore';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';
import { formatRelativeTime, formatDate } from '../../utils/dateUtils';

export const NotificationCenter: React.FC = () => {
  const { 
    notifications, 
    unreadCount, 
    isLoading, 
    showNotificationCenter, 
    showNotificationPopup,
    fetchNotifications, 
    fetchUnreadCount, 
    markAsRead, 
    markAllAsRead,
    setShowNotificationCenter,
    clearPopup 
  } = useNotificationStore();
  const { profile } = useAuth();
  const [dmTab, setDmTab] = useState<'notifications' | 'send' | 'inbox'>('notifications');
  const [dmReceiver, setDmReceiver] = useState('');
  const [dmContent, setDmContent] = useState('');
  const [dmSending, setDmSending] = useState(false);
  const [dmResult, setDmResult] = useState<string | null>(null);
  const [dmSentToday, setDmSentToday] = useState(0);
  const [dmRemaining, setDmRemaining] = useState(10);
  const [dmInbox, setDmInbox] = useState<any[]>([]);
  const [classmates, setClassmates] = useState<{ id: string; username: string; real_name: string }[]>([]);
  const [dmEnabled, setDmEnabled] = useState(false);

  useEffect(() => {
    if (profile) {
      fetchNotifications(profile.id);
      fetchUnreadCount(profile.id);
    }
  }, [profile, fetchNotifications, fetchUnreadCount]);

  // 打开通知中心时加载数字消息数据和同班同学
  useEffect(() => {
    if (showNotificationCenter && profile) {
      loadDigitalMessages();
      loadClassmates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNotificationCenter, profile?.id]);

  const loadClassmates = async () => {
    try {
      const res = await backendClient.get('/api/student/classmates');
      setClassmates(res?.data || []);
    } catch {
      setClassmates([]);
    }
  };

  const loadDigitalMessages = async () => {
    try {
      const res = await backendClient.get('/api/student/digital-messages/my');
      const d = res?.data;
      setDmInbox(d?.messages || []);
      setDmSentToday(d?.sent_today || 0);
      setDmRemaining(d?.remaining ?? Math.max(10 - (d?.sent_today || 0), 0));
      setDmEnabled(!!d?.dm_enabled);
    } catch {
      // 忽略加载失败
    }
  };

  const sendDigitalMessage = async () => {
    setDmResult(null);
    if (!dmReceiver.trim()) { setDmResult('请输入对方账号'); return; }
    if (!/^\d{1,8}$/.test(dmContent)) { setDmResult('内容仅限数字，最长 8 位'); return; }
    setDmSending(true);
    try {
      const res = await backendClient.post('/api/student/digital-messages/send', {
        receiver_username: dmReceiver.trim(),
        content: dmContent,
      });
      if (res?.error) { setDmResult(res.error); return; }
      const d = res?.data;
      setDmResult(`发送成功！今日已发 ${d?.sent_today} 条，剩余 ${d?.remaining} 条`);
      setDmReceiver('');
      setDmContent('');
      await loadDigitalMessages();
    } catch (e: any) {
      setDmResult(e?.message || '发送失败，请重试');
    } finally {
      setDmSending(false);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    // 数字消息弹窗点击：标记已读 + 打开通知中心并切换到"收到的消息"tab
    if ((notification as any).notification_type === 'digital_message') {
      // 自动标记已读
      try {
        const token = localStorage.getItem('xgpy_token');
        if (token) {
          await backendClient.post('/api/student/digital-messages/read', { id: (notification as any).id });
        }
      } catch {}
      setDmTab('inbox');
      return;
    }
    if (!notification.is_read && profile) {
      await markAsRead(notification.id, profile.id);
    }
  };

  

  const unreadNotifications = notifications.filter(n => !n.is_read);
  const readNotifications = notifications.filter(n => n.is_read);

  return (
    <>
      {/* 通知弹窗 */}
      <AnimatePresence>
        {showNotificationPopup && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            className="fixed top-4 right-4 w-80 bg-white rounded-lg shadow-2xl border border-gray-200 z-[10000]"
            onClick={() => {
              handleNotificationClick(showNotificationPopup);
              clearPopup();
              setShowNotificationCenter(true);
            }}
          >
            <div className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {(showNotificationPopup as any).notification_type === 'digital_message' ? (
                    <i className="fa-solid fa-envelope text-emerald-500 text-lg"></i>
                  ) : (
                    <i className="fa-solid fa-bell text-blue-500 text-lg"></i>
                  )}
                  <span className="font-semibold text-gray-800">
                    {(showNotificationPopup as any).notification_type === 'digital_message' ? '新数字消息' : '新通知'}
                  </span>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    clearPopup();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="fa-solid fa-times"></i>
                </button>
              </div>
              <h4 className="font-medium text-gray-900 mb-1">{showNotificationPopup.title}</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">{showNotificationPopup.content}</p>
              <p className="text-xs text-gray-400 mt-2">
                {(showNotificationPopup as any).notification_type === 'digital_message'
                  ? `来自：${showNotificationPopup.teacher_name || '同学'}`
                  : `来自：${showNotificationPopup.teacher_name || '老师'}`}
                {' · '}
                {formatDate(showNotificationPopup.published_at || showNotificationPopup.created_at)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 通知中心 */}
      <AnimatePresence>
        {showNotificationCenter && (
          <>
            {/* 遮罩层 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-[9997]"
              onClick={() => setShowNotificationCenter(false)}
            />
            
            {/* 通知面板 */}
            <motion.div
              initial={{ x: 450, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 450, opacity: 0 }}
              className="fixed top-0 right-0 h-full w-[450px] bg-white shadow-2xl z-[9998] flex flex-col"
            >
              {/* 头部 */}
              <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-bell text-xl"></i>
                    <h2 className="text-xl font-bold">通知中心</h2>
                  </div>
                  <button 
                    onClick={() => setShowNotificationCenter(false)}
                    className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-times text-lg"></i>
                  </button>
                </div>
                <p className="text-blue-100 text-sm">共 {notifications.length} 条通知，{unreadCount} 条未读</p>

                {/* Tab 切换 */}
                <div className="mt-3 flex gap-1 bg-blue-800/40 rounded-lg p-1">
                  <button
                    onClick={() => setDmTab('notifications')}
                    className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      dmTab === 'notifications' ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    <i className="fa-solid fa-bell mr-1"></i>通知
                  </button>
                  {dmEnabled && (
                    <button
                      onClick={() => setDmTab('send')}
                      className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        dmTab === 'send' ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-white/10'
                      }`}
                    >
                      <i className="fa-solid fa-paper-plane mr-1"></i>发送数字消息
                    </button>
                  )}
                  <button
                    onClick={() => setDmTab('inbox')}
                    className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      dmTab === 'inbox' ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    <i className="fa-solid fa-envelope mr-1"></i>收到的消息{dmInbox.length > 0 ? `(${dmInbox.length})` : ''}
                  </button>
                </div>
              </div>

              {/* 操作栏（仅通知 tab） */}
              {dmTab === 'notifications' && (
                <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  {unreadCount > 0 && profile && (
                    <button
                      onClick={() => markAllAsRead(profile.id)}
                      className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <i className="fa-solid fa-check-double"></i>
                      全部标为已读
                    </button>
                  )}
                </div>
              )}

              {/* 发送数字消息 tab */}
              {dmTab === 'send' && (
                <div className="p-4 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700">
                      <i className="fa-solid fa-paper-plane text-blue-500 mr-1"></i>发送数字消息
                    </h3>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      dmRemaining > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                    }`}>
                      今日剩余 {dmRemaining} 条
                    </span>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">从同班同学中选择</label>
                    <select
                      value={dmReceiver ? classmates.find(c => c.username === dmReceiver)?.id || '' : ''}
                      onChange={e => {
                        const selected = classmates.find(c => c.id === e.target.value);
                        if (selected) {
                          setDmReceiver(selected.username);
                          setDmResult(null);
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    >
                      <option value="">-- 选择同学 --</option>
                      {classmates.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.real_name} ({c.username})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">对方账号（也可手动输入）</label>
                    <input
                      type="text"
                      value={dmReceiver}
                      onChange={e => { setDmReceiver(e.target.value); setDmResult(null); }}
                      placeholder="对方学生账号"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">发送内容（仅数字，最长 8 位）</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      value={dmContent}
                      onChange={e => setDmContent(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="例如：12345678"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm tracking-widest focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <button
                    onClick={sendDigitalMessage}
                    disabled={dmSending}
                    className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {dmSending ? '发送中...' : '发送'}
                  </button>
                  {dmResult && (
                    <p className={`mt-2 text-xs ${dmResult.startsWith('发送成功') ? 'text-emerald-600' : 'text-red-500'}`}>
                      {dmResult}
                    </p>
                  )}
                </div>
              )}

              {/* 收到的数字消息 tab */}
              {dmTab === 'inbox' && (
                <div className="flex-1 overflow-y-auto">
                  {dmInbox.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      <i className="fa-regular fa-envelope text-4xl mb-2"></i>
                      <p>暂无收到消息</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {dmInbox.map(m => (
                        <div key={m.id} className={`p-4 ${m.is_read ? 'bg-white' : 'bg-blue-50/50'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-800">
                              <i className="fa-solid fa-user text-blue-500 mr-1"></i>
                              {m.sender_real_name || m.sender_username}
                              <span className="text-xs text-gray-400 ml-1">({m.sender_username})</span>
                            </span>
                            <span className="text-xs text-gray-400">
                              {formatDate(m.sent_at)}
                            </span>
                          </div>
                          <p className="text-lg font-mono font-bold text-blue-700 tracking-widest">{m.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 通知列表 */}
              {dmTab === 'notifications' && (
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="p-8 text-center text-gray-500">
                    <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                    <p>加载中...</p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <i className="fa-regular fa-inbox text-4xl mb-2"></i>
                    <p>暂无通知</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {/* 未读通知 */}
                    {unreadNotifications.length > 0 && (
                      <>
                        <div className="px-4 py-2 bg-yellow-50 text-yellow-700 text-sm font-medium border-b border-yellow-100">
                          未读通知 ({unreadNotifications.length})
                        </div>
                        {unreadNotifications.map((notification) => (
                          <NotificationItem
                            key={notification.id}
                            notification={notification}
                            formatDate={formatDate}
                            onClick={() => handleNotificationClick(notification)}
                          />
                        ))}
                      </>
                    )}

                    {/* 已读通知 */}
                    {readNotifications.length > 0 && (
                      <>
                        <div className="px-4 py-2 bg-gray-50 text-gray-600 text-sm font-medium border-b border-gray-200">
                          已读通知 ({readNotifications.length})
                        </div>
                        {readNotifications.map((notification) => (
                          <NotificationItem
                            key={notification.id}
                            notification={notification}
                            formatDate={formatDate}
                            onClick={() => {}}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

interface NotificationItemProps {
  notification: Notification;
  formatDate: (date: string) => string;
  onClick: () => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notification, formatDate, onClick }) => {
  const hasPointChange = !!(notification.point_change && notification.point_change !== 0);
  
  return (
    <motion.div
      whileHover={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}
      onClick={onClick}
      className={`p-4 cursor-pointer transition-colors ${
        !notification.is_read ? 'bg-blue-50/50' : 'bg-white'
      }`}
    >
      <div className="flex gap-3">
        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          !notification.is_read ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
        }`}>
          {hasPointChange ? (
            <i className={`fa-solid ${(notification.point_change || 0) > 0 ? 'fa-gift' : 'fa-triangle-exclamation'}`}></i>
          ) : (
            <i className="fa-solid fa-bell"></i>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-1">
            <h3 className={`font-medium ${
              !notification.is_read ? 'text-gray-900' : 'text-gray-600'
            }`}>
              {notification.title}
              {!notification.is_read && (
                <span className="inline-block w-2 h-2 bg-red-500 rounded-full ml-2 align-middle"></span>
              )}
            </h3>
            <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
              {formatDate(notification.published_at || notification.created_at)}
            </span>
          </div>
          <p className={`text-sm ${
            !notification.is_read ? 'text-gray-700' : 'text-gray-500'
          } whitespace-pre-wrap break-words`}>
            {notification.content}
          </p>
          
          {/* 积分变动提示 */}
          {hasPointChange && (
            <div className={`mt-2 flex items-center gap-1 text-sm font-medium ${
              (notification.point_change || 0) > 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              <i className={`fa-solid ${(notification.point_change || 0) > 0 ? 'fa-plus-circle' : 'fa-minus-circle'}`}></i>
              {(notification.point_change || 0) > 0 ? '+' : ''}{notification.point_change} 积分
              {notification.point_change_reason && (
                <span className="text-gray-500 text-xs ml-1">({notification.point_change_reason})</span>
              )}
            </div>
          )}
          
          <p className="text-xs text-gray-400 mt-1">
            来自：{notification.teacher_name || '老师'}
          </p>
        </div>
      </div>
    </motion.div>
  );
};