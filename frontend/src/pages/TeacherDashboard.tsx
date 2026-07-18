import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { useSiteConfig } from '../hooks/useSiteConfig';
import { API_CONFIG } from '../api/config';
import { ClassManager } from '../components/teacher/ClassManager';
import { StudentManager } from '../components/teacher/StudentManager';
import { QuestionBank } from '../components/teacher/QuestionBank';
import { TestManager } from '../components/teacher/TestManager';
import { PrizeManager } from '../components/teacher/PrizeManager';
import { PetConfig } from '../components/teacher/PetConfig';
import { SystemSettings } from '../components/teacher/SystemSettings';
import { Analytics } from '../components/teacher/Analytics';
import { AppManager } from '../components/teacher/AppManager';
import { GameSettings } from '../components/teacher/GameSettings';
import { NotificationManager } from '../components/teacher/NotificationManager';
import { PythonManager } from '../components/teacher/PythonManager';
import { MentalHealthManager } from '../components/teacher/MentalHealthManager';
import { KnowledgeBaseManager } from '../components/teacher/KnowledgeBaseManager';
import { TaskManager } from '../components/teacher/TaskManager';
import { RollCallApp } from '../components/teacher/RollCallApp';

const API_BASE = API_CONFIG.apiUrl;

interface LicenseStatus {
  machineCode: string | null;
  licenseCode: string | null;
  isActivated: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  isInTrial: boolean;
  isValid: boolean;
  daysRemaining: number;
  isExpiringSoon: boolean;
}

const PAID_MENU_ITEMS = ['apps', 'prizes', 'pets'];

const menuItems = [
  { id: 'notifications', title: '通知管理', icon: 'fa-bell' },
  { id: 'taskManager', title: '备课工作台', icon: 'fa-chalkboard-user' },
  { id: 'rollCall', title: '课堂点名', icon: 'fa-hand-pointer' },
  { id: 'mentalHealth', title: '心理健康', icon: 'fa-heart-pulse' },
  { id: 'classes', title: '班级管理', icon: 'fa-users' },
  { id: 'students', title: '学生管理', icon: 'fa-user-graduate' },
  { id: 'questions', title: '题库管理', icon: 'fa-book' },
  { id: 'knowledgeBase', title: '答疑库管理', icon: 'fa-graduation-cap' },
  { id: 'tests', title: '考试管理', icon: 'fa-clipboard-check' },
  { id: 'python', title: 'Python编程', icon: 'fa-code' },
  { id: 'apps', title: '应用管理', icon: 'fa-th-large' },
  { id: 'prizes', title: '积分兑换管理', icon: 'fa-gift' },
  { id: 'pets', title: '萌宠配置', icon: 'fa-paw' },
  { id: 'game', title: '刷题打怪系统', icon: 'fa-gamepad' },
  { id: 'analytics', title: '学情分析', icon: 'fa-chart-line' },
  { id: 'settings', title: '系统配置', icon: 'fa-cog' },
];

const components: Record<string, React.ReactNode> = {
  notifications: <NotificationManager />,
  taskManager: <TaskManager />,
  rollCall: <RollCallApp />,
  mentalHealth: <MentalHealthManager />,
  classes: <ClassManager />,
  students: <StudentManager />,
  questions: <QuestionBank />,
  knowledgeBase: <KnowledgeBaseManager />,
  tests: <TestManager />,
  python: <PythonManager />,
  apps: <AppManager />,
  prizes: <PrizeManager />,
  pets: <PetConfig />,
  game: <GameSettings />,
  analytics: <Analytics />,
  settings: <SystemSettings />,
};

export const TeacherDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('notifications');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [showLicenseAlert, setShowLicenseAlert] = useState(false);
  const { profile, signOut } = useAuth();
  const siteConfig = useSiteConfig();

  // 浏览器标签页标题与「系统配置 → 站点设置」保持一致
  useEffect(() => {
    if (siteConfig.site_title) {
      document.title = siteConfig.site_title;
    }
  }, [siteConfig.site_title]);

  const fetchLicenseStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/license/status`);
      const result = await res.json();
      if (result.data) {
        setLicenseStatus(result.data);
        if (result.data.isExpiringSoon || !result.data.isValid) {
          setShowLicenseAlert(true);
        }
      }
    } catch (error) {
      console.error('获取授权状态失败:', error);
    }
  };

  useEffect(() => {
    fetchLicenseStatus();
  }, []);

  const canAccessMenu = (menuId: string): boolean => {
    if (!PAID_MENU_ITEMS.includes(menuId)) return true;
    return licenseStatus?.isValid ?? false;
  };

  const visibleMenuItems = menuItems.filter(item => canAccessMenu(item.id));

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setIsCollapsed(true);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleMenuClick = (menuId: string) => {
    if (!canAccessMenu(menuId)) {
      setShowLicenseAlert(true);
      return;
    }
    setActiveTab(menuId);
    if (isMobile) {
      setIsMobileMenuOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 移动端顶部导航栏 */}
      {isMobile && (
        <div className="fixed top-0 left-0 right-0 h-14 bg-gray-900 text-white flex items-center justify-between px-4 z-50 shadow-lg">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <i className="fa-solid fa-bars text-xl"></i>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
              <i className="fa-solid fa-chalkboard-teacher text-sm"></i>
            </div>
            <span className="font-bold">{menuItems.find(m => m.id === activeTab)?.title || '教师后台'}</span>
          </div>
          <button
            onClick={signOut}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <i className="fa-solid fa-sign-out-alt text-lg"></i>
          </button>
        </div>
      )}

      <div className="flex h-screen pt-14 md:pt-0">
        {/* 桌面端侧边栏 */}
        {!isMobile && (
          <motion.div
            initial={false}
            animate={{ width: isCollapsed ? 80 : 256 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="bg-gray-900 text-white flex flex-col overflow-hidden relative"
          >
            {/* 头部 */}
            <div className={`border-b border-gray-800 ${isCollapsed ? 'p-4' : 'p-6'}`}>
              <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <i className="fa-solid fa-chalkboard-teacher"></i>
                </div>
                {!isCollapsed && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <p className="font-bold">{profile?.real_name}</p>
                    <p className="text-xs text-gray-400">教师</p>
                  </motion.div>
                )}
              </div>
            </div>

            {/* 折叠按钮 */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="absolute top-20 -right-3 w-6 h-6 bg-gray-800 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors shadow-lg z-10 border-2 border-gray-700"
            >
              <i className={`fa-solid fa-chevron-left text-xs transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}></i>
            </button>

            {/* 导航菜单 */}
            <nav className="flex-1 overflow-y-auto py-4">
              <div className={`space-y-1 ${isCollapsed ? 'px-2' : 'px-4'}`}>
                {visibleMenuItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleMenuClick(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                      activeTab === item.id
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    } ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? item.title : ''}
                  >
                    <i className={`fa-solid ${item.icon} ${isCollapsed ? 'text-lg' : ''}`}></i>
                    {!isCollapsed && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="font-medium"
                      >
                        {item.title}
                      </motion.span>
                    )}
                  </button>
                ))}
              </div>
            </nav>

            {/* 退出登录 */}
            <div className={`border-t border-gray-800 ${isCollapsed ? 'p-2' : 'p-4'}`}>
              <button
                onClick={signOut}
                className={`w-full flex items-center gap-3 px-4 py-3 text-gray-300 hover:bg-gray-800 hover:text-white rounded-lg transition-colors ${
                  isCollapsed ? 'justify-center' : ''
                }`}
                title={isCollapsed ? '退出登录' : ''}
              >
                <i className={`fa-solid fa-sign-out-alt ${isCollapsed ? 'text-lg' : ''}`}></i>
                {!isCollapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="font-medium"
                  >
                    退出登录
                  </motion.span>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* 移动端侧边栏 */}
        <AnimatePresence>
          {isMobile && isMobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 z-40"
                onClick={() => setIsMobileMenuOpen(false)}
              />
              <motion.div
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 left-0 bottom-0 w-64 bg-gray-900 text-white flex flex-col z-50 shadow-2xl"
              >
                <div className="p-6 border-b border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                      <i className="fa-solid fa-chalkboard-teacher"></i>
                    </div>
                    <div>
                      <p className="font-bold">{profile?.real_name}</p>
                      <p className="text-xs text-gray-400">教师</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-times"></i>
                  </button>
                </div>

                <nav className="flex-1 overflow-y-auto p-4">
                  <div className="space-y-1">
                    {visibleMenuItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleMenuClick(item.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                          activeTab === item.id
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        <i className={`fa-solid ${item.icon}`}></i>
                        <span className="font-medium">{item.title}</span>
                      </button>
                    ))}
                  </div>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* 主内容区域 */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full p-4 md:p-6 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {components[activeTab]}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* 授权提醒弹窗 */}
      <AnimatePresence>
        {showLicenseAlert && licenseStatus && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowLicenseAlert(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={`bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`p-6 ${
                licenseStatus.isValid
                  ? 'bg-amber-50'
                  : 'bg-red-50'
              }`}>
                <div className="flex items-center gap-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                    licenseStatus.isValid
                      ? 'bg-amber-100 text-amber-600'
                      : 'bg-red-100 text-red-600'
                  }`}>
                    <i className={`fa-solid text-3xl ${
                      licenseStatus.isValid ? 'fa-clock' : 'fa-exclamation-triangle'
                    }`}></i>
                  </div>
                  <div>
                    <h3 className={`text-xl font-bold ${
                      licenseStatus.isValid ? 'text-amber-800' : 'text-red-800'
                    }`}>
                      {licenseStatus.isValid 
                        ? '授权即将到期' 
                        : licenseStatus.isInTrial
                          ? '试用期已结束'
                          : '授权已过期'}
                    </h3>
                    <p className={`text-sm mt-1 ${
                      licenseStatus.isValid ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {licenseStatus.isValid 
                        ? `剩余 ${licenseStatus.daysRemaining} 天到期`
                        : licenseStatus.isInTrial
                          ? '试用期已结束，请激活授权'
                          : '授权已过期，请续期'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {licenseStatus.expiresAt && (
                  <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">到期时间</span>
                      <span className="font-medium text-gray-800">
                        {new Date(licenseStatus.expiresAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  </div>
                )}
                
                <p className="text-sm text-gray-600 mb-6">
                  {licenseStatus.isValid 
                    ? '为了不影响您的正常使用，请及时联系吴志安老师（QQ1026913）获取授权码进行续期。'
                    : '应用管理、AI功能、萌宠功能、积分兑换管理等付费功能已无法使用。请联系吴志安老师（QQ1026913）获取授权码激活系统。'}
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowLicenseAlert(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                  >
                    稍后再说
                  </button>
                  <button
                    onClick={() => {
                      setShowLicenseAlert(false);
                      setActiveTab('settings');
                    }}
                    className={`flex-1 px-4 py-2.5 text-white rounded-lg font-medium transition-colors ${
                      licenseStatus.isValid
                        ? 'bg-amber-500 hover:bg-amber-600'
                        : 'bg-red-500 hover:bg-red-600'
                    }`}
                  >
                    <i className="fa-solid fa-key mr-1"></i>
                    {licenseStatus.isValid ? '立即续期' : '立即激活'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
