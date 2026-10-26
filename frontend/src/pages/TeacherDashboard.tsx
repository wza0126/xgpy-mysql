import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { useSiteConfig } from '../hooks/useSiteConfig';
import { API_CONFIG } from '../api/config';
import { loadBaiduAnalytics, trackPageview } from '../utils/analytics';
import { ClassManager } from '../components/teacher/ClassManager';
import { StudentManager } from '../components/teacher/StudentManager';
import { QuestionBank } from '../components/teacher/QuestionBank';
import { WpsOpManager } from '../components/teacher/WpsOpManager';
import { TestManager } from '../components/teacher/TestManager';
import { PrizeManager } from '../components/teacher/PrizeManager';
import { PetConfig } from '../components/teacher/PetConfig';
import { SystemSettings } from '../components/teacher/SystemSettings';
import { Analytics } from '../components/teacher/Analytics';
import { AppManager } from '../components/teacher/AppManager';
import { GameSettings } from '../components/teacher/GameSettings';
import { FarmConfig } from '../components/teacher/FarmConfig';
import { LayerBackground } from '../components/teacher/LayerBackground';
import { NotificationManager } from '../components/teacher/NotificationManager';
import { MessageManager } from '../components/teacher/MessageManager';
import { PythonManager } from '../components/teacher/PythonManager';
import { MentalHealthManager } from '../components/teacher/MentalHealthManager';
import { KnowledgeBaseManager } from '../components/teacher/KnowledgeBaseManager';
import { LessonWorkbench } from '../components/teacher/LessonWorkbench';
import { RollCallApp } from '../components/teacher/RollCallApp';
import { ProxyManager } from '../components/teacher/ProxyManager';
import { CreativeWorkshopManager } from '../components/teacher/CreativeWorkshopManager';
import { SystemMonitor } from '../components/teacher/SystemMonitor';

const API_BASE = API_CONFIG.apiUrl;

interface LicenseStatus {
  machineCode: string | null;
  licenseCode: string | null;
  isActivated: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  isInTrial: boolean;
  isValid: boolean;
  isFreeOpenDay: boolean;
  daysRemaining: number;
  isExpiringSoon: boolean;
}

const PAID_MENU_ITEMS = ['apps', 'prizes', 'pets', 'taskManager', 'proxyNet', 'game', 'rollCall', 'analytics', 'creativeWorkshop'];

// 菜单按「一节课的使用顺序」分组：备课 → 上课 → 复盘 → 管人 → 资源 → 配置。
// 2026-10-26 之前是一个 21 项的平铺列表，顺序等于开发追加顺序（通知/消息这类低频配置
// 占了最前面，班级/学生/题库/考试被拆成四段）。分组只是重排，功能一个没增没减。
// ⚠️ id 一律不许改：activeTab、旧收藏链接、PAID_MENU_ITEMS、components 映射全靠它。
const MENU_GROUPS: { title: string; items: { id: string; title: string; icon: string }[] }[] = [
  {
    title: '日常教学',
    items: [
      { id: 'taskManager', title: '备课工作台', icon: 'fa-chalkboard-user' },
      { id: 'rollCall', title: '课堂点名', icon: 'fa-hand-pointer' },
      { id: 'analytics', title: '学情分析', icon: 'fa-chart-line' },
      { id: 'tests', title: '考试管理', icon: 'fa-clipboard-check' },
    ],
  },
  {
    title: '班级与学生',
    items: [
      { id: 'classes', title: '班级管理', icon: 'fa-users' },
      { id: 'students', title: '学生管理', icon: 'fa-user-graduate' },
      { id: 'mentalHealth', title: '心理健康', icon: 'fa-heart-pulse' },
      { id: 'proxyNet', title: '上网管理', icon: 'fa-earth-asia' },
    ],
  },
  {
    title: '教学资源',
    items: [
      { id: 'questions', title: '题库管理', icon: 'fa-book' },
      { id: 'wpsOp', title: 'WPS/ACCESS', icon: 'fa-file-excel' },
      { id: 'python', title: 'Python编程', icon: 'fa-code' },
      { id: 'knowledgeBase', title: '答疑库管理', icon: 'fa-graduation-cap' },
    ],
  },
  {
    title: '激励体系',
    items: [
      { id: 'prizes', title: '积分兑换管理', icon: 'fa-gift' },
      { id: 'pets', title: '萌宠配置', icon: 'fa-paw' },
      { id: 'game', title: '刷题打怪系统', icon: 'fa-gamepad' },
    ],
  },
  {
    title: '学生桌面',
    items: [
      { id: 'apps', title: '应用管理', icon: 'fa-th-large' },
      { id: 'layers', title: '图层背景', icon: 'fa-layer-group' },
      { id: 'creativeWorkshop', title: 'AI创意工坊', icon: 'fa-wand-magic-sparkles' },
    ],
  },
  {
    title: '通知与系统',
    items: [
      { id: 'notifications', title: '通知管理', icon: 'fa-bell' },
      { id: 'messageManager', title: '消息设置', icon: 'fa-comments' },
      { id: 'settings', title: '系统配置', icon: 'fa-cog' },
    ],
  },
];

// 扁平列表：标题栏文字、授权判断、组件映射都按 id 查，顺序无所谓
const menuItems = MENU_GROUPS.flatMap((g) => g.items);

/** 侧边栏单个菜单项（桌面栏与移动端抽屉共用，避免两处各写一遍） */
const MenuButton: React.FC<{
  item: { id: string; title: string; icon: string };
  active: boolean;
  locked: boolean;
  collapsed?: boolean;
  dense?: boolean;
  onClick: (id: string) => void;
}> = ({ item, active, locked, collapsed, dense, onClick }) => (
  <button
    onClick={() => onClick(item.id)}
    className={`w-full flex items-center gap-3 px-4 ${dense ? 'py-2.5' : 'py-3'} rounded-lg transition-all ${
      active
        ? 'bg-blue-600 text-white shadow-lg'
        : locked
        ? 'text-gray-500 hover:bg-gray-800 hover:text-gray-400'
        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
    } ${collapsed ? 'justify-center' : ''}`}
    title={collapsed ? item.title : locked ? `${item.title}（需授权）` : ''}
  >
    <div className="relative">
      <i className={`fa-solid ${item.icon} ${collapsed ? 'text-lg' : ''}`}></i>
      {locked && !collapsed && (
        <i className="fa-solid fa-lock text-[10px] absolute -bottom-1 -right-2 text-amber-400"></i>
      )}
    </div>
    {!collapsed && <span className="font-medium flex-1 text-left">{item.title}</span>}
    {locked && !collapsed && (
      <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">授权</span>
    )}
  </button>
);

/** 分组标题：折叠态不显示文字，只靠组间的分割线分隔 */
const MenuGroupTitle: React.FC<{ title: string }> = ({ title }) => (
  <p className="px-4 pb-1 pt-1 text-[11px] font-medium tracking-wider text-gray-500">{title}</p>
);

const components: Record<string, React.ReactNode> = {
  notifications: <NotificationManager />,
  messageManager: <MessageManager />,
  // 备课工作台 = 课堂任务 + AI 讲堂 两个页签（外壳见 LessonWorkbench）
  taskManager: <LessonWorkbench />,
  rollCall: <RollCallApp />,
  proxyNet: <ProxyManager />,
  creativeWorkshop: <CreativeWorkshopManager />,
  mentalHealth: <MentalHealthManager />,
  classes: <ClassManager />,
  students: <StudentManager />,
  questions: <QuestionBank />,
  wpsOp: <WpsOpManager />,
  knowledgeBase: <KnowledgeBaseManager />,
  tests: <TestManager />,
  python: <PythonManager />,
  apps: <AppManager />,
  prizes: <PrizeManager />,
  pets: <PetConfig />,
  game: <GameSettings />,
  farm: <FarmConfig />,
  // 「图层背景」把代码农场与学习星域收到同一个入口；farm 保留映射，兼容旧链接/收藏
  layers: <LayerBackground />,
  analytics: <Analytics />,
  settings: <SystemSettings />,
};

export const TeacherDashboard: React.FC = () => {
  // 默认落地页从「通知管理」改成「学情分析」：打开后台先看班里谁掉队，而不是一份通知列表
  const [activeTab, setActiveTab] = useState('analytics');
  // 学情分析是付费菜单，授权不可用时不该落在它上面 —— 见 fetchLicenseStatus 里的「一次性纠正」
  const landingResolvedRef = useRef(false);
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

  // 百度统计：仅教师后台（学生端不上报）
  useEffect(() => {
    loadBaiduAnalytics();
    trackPageview('/teacher');
  }, []);

  // 落地页兜底：默认页是付费的「学情分析」，授权不可用（过期/未激活/接口拿不到）时退回免费的
  // 「通知管理」，否则一打开后台就是一屏授权提示。只纠正一次 —— 用 ref 记账，
  // 免得把这个页面之后手动切走的标签再拉回来。
  const fallbackLanding = () => {
    if (landingResolvedRef.current) return;
    landingResolvedRef.current = true;
    setActiveTab('notifications');
  };

  const fetchLicenseStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/license/status`);
      const result = await res.json();
      if (result.data) {
        setLicenseStatus(result.data);
        if (result.data.isExpiringSoon || !result.data.isValid) {
          setShowLicenseAlert(true);
        }
        if (!landingResolvedRef.current) {
          landingResolvedRef.current = true;
          if (!result.data.isValid && !result.data.isFreeOpenDay) {
            setActiveTab('notifications');
          }
        }
      } else {
        fallbackLanding();
      }
    } catch (error) {
      // 拿不到授权状态时按「不可用」处理，别让付费页当落地页
      console.error('获取授权状态失败:', error);
      fallbackLanding();
    }
  };

  useEffect(() => {
    fetchLicenseStatus();
  }, []);

  const canAccessMenu = (menuId: string): boolean => {
    if (!PAID_MENU_ITEMS.includes(menuId)) return true;
    return licenseStatus?.isValid || licenseStatus?.isFreeOpenDay || false;
  };

  const isPaidMenu = (menuId: string): boolean => {
    return PAID_MENU_ITEMS.includes(menuId);
  };

  const visibleMenuItems = menuItems;

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

            {/* 导航菜单：按组渲染，组间用分割线隔开；折叠态不显示组名，只留分割线 */}
            <nav className="flex-1 overflow-y-auto py-4">
              <div className={isCollapsed ? 'px-2' : 'px-4'}>
                {MENU_GROUPS.map((group, gi) => {
                  const items = group.items.filter((it) => visibleMenuItems.some((v) => v.id === it.id));
                  if (items.length === 0) return null;
                  return (
                    <div key={group.title} className={gi === 0 ? '' : 'mt-2 border-t border-gray-800 pt-2'}>
                      {!isCollapsed && <MenuGroupTitle title={group.title} />}
                      <div className="space-y-1">
                        {items.map((item) => (
                          <MenuButton
                            key={item.id}
                            item={item}
                            active={activeTab === item.id}
                            locked={isPaidMenu(item.id) && !canAccessMenu(item.id)}
                            collapsed={isCollapsed}
                            onClick={handleMenuClick}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
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
                  {MENU_GROUPS.map((group, gi) => (
                    <div key={group.title} className={gi === 0 ? '' : 'mt-3 border-t border-gray-800 pt-3'}>
                      <p className="px-4 pb-1 text-[11px] font-medium tracking-wider text-gray-500">{group.title}</p>
                      <div className="space-y-1">
                        {group.items.map((item) => (
                          <MenuButton
                            key={item.id}
                            item={item}
                            active={activeTab === item.id}
                            locked={isPaidMenu(item.id) && !canAccessMenu(item.id)}
                            dense
                            onClick={handleMenuClick}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
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

      {/* 运行状态仪表台：固定右上角，默认折叠成一个胶囊，点开看详情。
          用 fixed 而不是塞进布局里，是不想给每个标签页都加一条工具条（也免得挤占内容）。 */}
      <div className={`fixed right-3 z-40 md:right-5 ${isMobile ? 'top-16' : 'top-3'}`}>
        <SystemMonitor />
      </div>

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
