import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotificationStore, Notification } from '../../store/notificationStore';
import { useAuth } from '../../hooks/useAuth';
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

  useEffect(() => {
    if (profile) {
      fetchNotifications(profile.id);
      fetchUnreadCount(profile.id);
    }
  }, [profile, fetchNotifications, fetchUnreadCount]);

  const handleNotificationClick = async (notification: Notification) => {
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
                  <i className="fa-solid fa-bell text-blue-500 text-lg"></i>
                  <span className="font-semibold text-gray-800">新通知</span>
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
                来自：{showNotificationPopup.teacher_name || '老师'} · {formatDate(showNotificationPopup.published_at || showNotificationPopup.created_at)}
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
              </div>

              {/* 操作栏 */}
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

              {/* 通知列表 */}
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