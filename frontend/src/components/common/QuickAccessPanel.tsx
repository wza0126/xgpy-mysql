import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDesktopStore } from '../../store/desktopStore';

interface QuickAccessPanelProps {
  isOpen: boolean;
  onClose: () => void;
  quickAccessIds: string[];
  onOpenAiQa: () => void;
  moduleComponents: Record<string, React.ReactNode>;
  onCheckAppPermission?: () => Promise<boolean>;
  onCheckExchangePermission?: () => Promise<boolean>;
}

const iconMap: Record<string, { icon: string; label: string }> = {
  learn: { icon: 'fa-graduation-cap', label: '学习中心' },
  practice: { icon: 'fa-pencil-alt', label: '练习中心' },
  test: { icon: 'fa-file-alt', label: '考试中心' },
  wrong: { icon: 'fa-exclamation-triangle', label: '错题本' },
  notebook: { icon: 'fa-sticky-note', label: '记事本' },
  python: { icon: 'fa-code', label: 'Python编程' },
  apps: { icon: 'fa-th-large', label: '应用中心' },
  pet: { icon: 'fa-paw', label: '我的萌宠' },
  exchange: { icon: 'fa-gift', label: '积分兑换' },
  leaderboard: { icon: 'fa-trophy', label: '积分排行' },
  profile: { icon: 'fa-user', label: '个人信息' },
  security: { icon: 'fa-shield-alt', label: '安全设置' },
  ai_qa: { icon: 'fa-robot', label: 'AI答疑' },
};

export const QuickAccessPanel: React.FC<QuickAccessPanelProps> = ({
  isOpen,
  onClose,
  quickAccessIds,
  onOpenAiQa,
  moduleComponents,
  onCheckAppPermission,
  onCheckExchangePermission,
}) => {
  const { openWindow } = useDesktopStore();

  const handleOpenApp = async (id: string) => {
    if (id === 'ai_qa') {
      if (onCheckAppPermission) {
        const allowed = await onCheckAppPermission();
        if (!allowed) {
          alert('您当前无法使用AI答疑应用');
          return;
        }
      }
      onOpenAiQa();
      onClose();
      return;
    }

    if (id === 'apps') {
      if (onCheckAppPermission) {
        const allowed = await onCheckAppPermission();
        if (!allowed) {
          alert('您当前无法使用应用中心');
          return;
        }
      }
    }

    if (id === 'exchange') {
      if (onCheckExchangePermission) {
        const allowed = await onCheckExchangePermission();
        if (!allowed) {
          alert('您当前无法使用积分兑换');
          return;
        }
      }
    }

    const iconInfo = iconMap[id] || { icon: 'fa-folder', label: id };

    openWindow({
      id,
      title: iconInfo.label,
      icon: iconInfo.icon,
      isMinimized: false,
      isMaximized: false,
      component: moduleComponents[id],
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9997]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: -10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: -10 }}
            className="fixed left-4 bottom-20 z-[9999] w-56 bg-white/95 backdrop-blur-lg rounded-2xl shadow-2xl border border-purple-200 overflow-hidden"
          >
            <div className="p-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white">
              <h3 className="font-bold text-sm">快捷入口</h3>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto">
              {quickAccessIds.map((id) => {
                const info = iconMap[id];
                if (!info) return null;
                return (
                  <button
                    key={id}
                    onClick={() => handleOpenApp(id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-purple-50 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                      <i className={`fa-solid ${info.icon} text-purple-600 text-sm`}></i>
                    </div>
                    <span className="text-sm font-medium text-gray-700">{info.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
