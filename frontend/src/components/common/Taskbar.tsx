import React from 'react';
import { motion } from 'framer-motion';
import { useDesktopStore } from '../../store/desktopStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useAuth } from '../../hooks/useAuth';

export const Taskbar: React.FC = () => {
  const { windows, activeWindowId, restoreWindow, activateWindow, minimizeWindow, minimizeAllWindows } = useDesktopStore();
  const { unreadCount, setShowNotificationCenter, showNotificationCenter } = useNotificationStore();
  const { profile } = useAuth();

  const openWindows = windows.filter((w) => w.isOpen);

  return (
    <div className="fixed bottom-0 left-0 right-0 h-12 bg-gray-900/90 backdrop-blur-md flex items-center px-4 gap-2 z-[9999]">
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={minimizeAllWindows}
        className="p-2 rounded-lg hover:bg-gray-700/50 text-gray-300 hover:text-white transition-all"
        title="最小化所有窗口"
      >
        <i className="fa-solid fa-minimize text-sm"></i>
      </motion.button>
      <div className="flex items-center gap-2 flex-1">
        {openWindows.map((window) => (
          <motion.button
            key={window.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              if (window.isMinimized) {
                restoreWindow(window.id);
              } else if (activeWindowId === window.id) {
                minimizeWindow(window.id);
              } else {
                activateWindow(window.id);
              }
            }}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeWindowId === window.id && !window.isMinimized
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <i className={`fa-solid ${window.icon} text-sm`}></i>
            <span className="text-sm font-medium truncate max-w-[120px]">{window.title}</span>
          </motion.button>
        ))}
      </div>
      
      {/* 通知图标 */}
      {profile?.role === 'student' && (
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowNotificationCenter(!showNotificationCenter)}
          className="relative p-2 rounded-lg hover:bg-gray-700/50 text-gray-300 hover:text-white transition-all"
        >
          <i className="fa-solid fa-bell text-lg"></i>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </motion.span>
          )}
        </motion.button>
      )}
      
      <div className="text-gray-400 text-sm">
        {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
};
