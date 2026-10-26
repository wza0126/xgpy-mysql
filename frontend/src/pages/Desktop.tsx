import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSiteConfig } from '../hooks/useSiteConfig';
import { getAuthToken } from '../utils/authToken';
import { useDesktopStore, desktopIcons, setModuleGuard } from '../store/desktopStore';
import { useNotificationStore } from '../store/notificationStore';
import { useTaskStore } from '../store/taskStore';
import { TaskBadge } from '../components/common/TaskBadge';
import { DesktopIcon } from '../components/common/DesktopIcon';
import { WindowFrame } from '../components/common/WindowFrame';
import { Taskbar } from '../components/common/Taskbar';
import { DesktopPet } from '../components/common/DesktopPet';
import { QuickAccessPanel } from '../components/common/QuickAccessPanel';
import { LearnModule } from '../components/student/LearnModule';
import { PracticeModule } from '../components/student/PracticeModule';
import { CompositePracticeModule } from '../components/student/CompositePractice';
import { TestModule } from '../components/student/TestModule';
import { WpsOpApp } from '../components/student/WpsOpApp';
import { WrongQuestions } from '../components/student/WrongQuestions';
import { AiExplainApp } from '../components/student/AiExplainApp';
import { AiLectureApp } from '../components/student/AiLectureApp';
import { Notebook } from '../components/student/Notebook';
import { PetModule } from '../components/student/PetModule';
import { ExchangeModule } from '../components/student/ExchangeModule';
import { Leaderboard } from '../components/student/Leaderboard';
import { ProfileModule } from '../components/student/ProfileModule';
import { AppCenter } from '../components/student/AppCenter';
import { NotificationCenter } from '../components/student/NotificationCenter';
import { SecuritySettings } from '../components/student/SecuritySettings';
import { PythonProgramming } from '../components/student/PythonProgramming';
import { AiQaApp } from '../components/student/AiQaApp';
import { BuffBadge } from '../components/student/BuffBadge';
import { PaintBoard } from '../components/student/PaintBoard';
import { TaskCenter } from '../components/student/TaskCenter';
import { StudentRollCall } from '../components/student/StudentRollCall';
import { ProxyBrowser } from '../components/student/ProxyBrowser';
import { CreativeWorkshop } from '../components/student/CreativeWorkshop';
import { FarmOverlay } from '../components/student/FarmOverlay';
import type { FarmState } from '../components/student/FarmOverlay';
import { StudyGalaxyLayer } from '../components/student/StudyGalaxyLayer';
import type { GalaxyData } from '../components/student/StudyGalaxyLayer';
import { requestLearnChapter } from '../utils/learnNav';
import { FarmGuideApp } from '../components/student/FarmGuideApp';
import { RollCallApp } from '../components/teacher/RollCallApp';
import { backendClient } from '../api/backendClient';
import { API_CONFIG } from '../api/config';
import { useSkinStore } from '../store/skinStore';
import { getSkinById } from '../config/windowSkins';

interface FocusModeConfig {
  focus_mode_enabled: boolean;
  focus_mode_show_learn: boolean;
  focus_mode_show_practice: boolean;
  focus_mode_show_test: boolean;
  focus_mode_show_wrong: boolean;
  focus_mode_show_notebook: boolean;
  focus_mode_show_python: boolean;
  focus_mode_show_apps: boolean;
  focus_mode_show_pet: boolean;
  focus_mode_show_exchange: boolean;
  focus_mode_show_leaderboard: boolean;
  focus_mode_show_profile: boolean;
  focus_mode_show_security: boolean;
  focus_mode_show_proxyBrowser: boolean;
  focus_mode_show_creative: boolean;
  // 2026-10-24 补全：原先漏了这两个，导致「操作题」「AI讲解」在专注模式下无法隐藏
  focus_mode_show_wpsOp: boolean;
  focus_mode_show_aiExplain: boolean;
  focus_mode_quick_access: string[];
  focus_mode_classes: string[];
}

const moduleComponents: Record<string, React.ReactNode> = {
  learn: <LearnModule />,
  practice: <PracticeModule />,
  composite: <CompositePracticeModule />,
  test: <TestModule />,
  wpsOp: <WpsOpApp />,
  wrong: <WrongQuestions />,
  aiExplain: <AiExplainApp />,
  aiLecture: <AiLectureApp />,
  notebook: <Notebook />,
  python: <PythonProgramming />,
  apps: <AppCenter />,
  pet: <PetModule />,
  exchange: <ExchangeModule />,
  leaderboard: <Leaderboard />,
  profile: <ProfileModule />,
  security: <SecuritySettings />,
  taskCenter: <TaskCenter />,
  studentRollCall: <StudentRollCall />,
  proxyBrowser: <ProxyBrowser />,
  creative: <CreativeWorkshop />,
  rollCall: <RollCallApp onClose={() => { const { closeWindow } = useDesktopStore.getState(); closeWindow('rollCall'); }} />,
};

/** 受班级开关控制的模块：桌面图标 id → profiles 上的开关字段（2026-10-24 新增） */
type ModuleGuardKey = 'practice_enabled' | 'test_enabled' | 'op_enabled' | 'pet_enabled';

const MODULE_GUARD_MAP: Record<string, ModuleGuardKey> = {
  practice: 'practice_enabled',
  // 综合题练习跟「练习」同一个班级开关：老师关掉练习，综合题也一并关掉
  composite: 'practice_enabled',
  test: 'test_enabled',
  wpsOp: 'op_enabled',
  pet: 'pet_enabled',
};

export const Desktop: React.FC = () => {
  const { profile, signOut, checkAndEnforceLoginRestriction, isProxyMode, loading, proxyError } = useAuth();
  const { windows, background, openWindow, activateWindow, setBackground } = useDesktopStore();
  const { setActiveSkin } = useSkinStore();
  const { checkForNewNotifications } = useNotificationStore();
  const siteConfig = useSiteConfig();
  const [focusModeConfig, setFocusModeConfig] = useState<FocusModeConfig | null>(null);
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const [isFocusModeActive, setIsFocusModeActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    !!(document.fullscreenElement || (document as any).webkitFullscreenElement)
  );
  const [isPaintBoardOpen, setIsPaintBoardOpen] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<{ isValid: boolean; isFreeOpenDay: boolean } | null>(null);
  const [licenseLoaded, setLicenseLoaded] = useState(false);
  // 代码农场（桌面游戏层）：教师开关打开且本班命中时自动进入
  const [farmState, setFarmState] = useState<FarmState | null>(null);
  const [farmDismissed, setFarmDismissed] = useState(false);
  // 学习星域（桌面反馈层）：null = 未开启/不生效；galaxyLoaded 用来「先探再决定要不要拉背景图」
  const [galaxy, setGalaxy] = useState<GalaxyData | null>(null);
  const [galaxyLoaded, setGalaxyLoaded] = useState(false);
  const galaxyOn = !!galaxy;
  // 班级模块开关（练习 / 测试 / 操作题 / 萌宠）：老师在「班级管理」里关掉后，
  // 桌面图标双击直接拦住，已打开的窗口在下一轮权限轮询里强制关闭。
  // 数据来自 /api/student/desktop-permissions（同一次请求，不额外加轮询）。
  const [moduleSwitches, setModuleSwitches] = useState<Record<ModuleGuardKey, boolean>>({
    practice_enabled: true,
    test_enabled: true,
    op_enabled: true,
    pet_enabled: true,
  });

  // 考试期间自动关闭学习模块：学生可能先开着学习再进考试，
  // openWindow 的互斥只拦「新打开」，已经开着的要在这里收掉。
  const learnAutoClosedRef = useRef(false);
  useEffect(() => {
    const testOpen = windows.some((w) => w.id === 'test' && w.isOpen);
    const learnOpen = windows.some((w) => w.id === 'learn' && w.isOpen);
    if (testOpen && learnOpen) {
      useDesktopStore.getState().closeWindow('learn');
      if (!learnAutoClosedRef.current) {
        learnAutoClosedRef.current = true;
        alert('考试期间不能查看学习模块，已自动关闭');
      }
    }
    if (!testOpen) learnAutoClosedRef.current = false;
  }, [windows]);

  // 把当前开关注册到 store：openWindow 统一拦截，覆盖桌面图标 / 学习模块跳转 / 宠物点击等所有入口
  useEffect(() => {
    setModuleGuard((id) => {
      const k = MODULE_GUARD_MAP[id];
      if (!k || moduleSwitches[k]) return null;
      const titles: Record<string, string> = {
        practice: '练习', test: '测试', wpsOp: '操作题', pet: '萌宠',
      };
      return `${titles[id] || '该功能'}已被老师关闭`;
    });
    return () => setModuleGuard(null);
  }, [moduleSwitches]);

  // 代理模式下 profile 由 useAuth 直接设置为目标学生
  const effectiveProfile = profile;

  const PAID_STUDENT_FEATURES = ['taskCenter', 'apps', 'pet', 'exchange', 'proxyBrowser', 'studentRollCall', 'creative'];

  const isPaidFeature = (featureId: string): boolean => {
    return PAID_STUDENT_FEATURES.includes(featureId);
  };

  const canUseFeature = (featureId: string): boolean => {
    if (!isPaidFeature(featureId)) return true;
    return licenseStatus?.isValid || licenseStatus?.isFreeOpenDay || false;
  };

  const fetchLicenseStatus = async () => {
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/license/status`);
      const result = await res.json();
      if (result.data) {
        setLicenseStatus({
          isValid: result.data.isValid,
          isFreeOpenDay: result.data.isFreeOpenDay,
        });
      }
    } catch (error) {
      console.error('获取授权状态失败:', error);
    } finally {
      setLicenseLoaded(true);
    }
  };

  const hiddenFeatures = effectiveProfile?.hidden_features
    ? (typeof effectiveProfile.hidden_features === 'string'
        ? (() => { try { return JSON.parse(effectiveProfile.hidden_features); } catch { return []; } })()
        : effectiveProfile.hidden_features)
    : ['paint_board', 'roll_call', 'ai_explain'];
  const isPaintBoardHidden = !effectiveProfile || (effectiveProfile?.role === 'student' && hiddenFeatures.includes('paint_board'));
  const isRollCallHidden = !effectiveProfile || (effectiveProfile?.role === 'student' && hiddenFeatures.includes('roll_call'));
  // AI 讲解：默认关闭（hidden_features 内含 ai_explain），且只对学生开放 —— 教师端没有学生错题
  const isExplainHidden = !effectiveProfile
    || effectiveProfile.role !== 'student'
    || hiddenFeatures.includes('ai_explain');

  const applyFsStyle = (enable: boolean) => {
    if (enable) {
      document.body.style.overflow = 'hidden';
      document.body.style.height = '100vh';
      const root = document.getElementById('root');
      if (root) {
        root.style.height = '100vh';
        root.style.overflow = 'hidden';
      }
    } else {
      document.body.style.overflow = '';
      document.body.style.height = '';
      const root = document.getElementById('root');
      if (root) {
        root.style.height = '';
        root.style.overflow = '';
      }
    }
  };

  const toggleFullscreen = async () => {
    console.log('toggleFullscreen called, current state:', isFullscreen);
    try {
      if (!isFullscreen) {
        const el = document.documentElement;
        console.log('Attempting to enter fullscreen...');
        if (el.requestFullscreen) {
          await el.requestFullscreen();
          console.log('requestFullscreen called');
        } else if ((el as any).webkitRequestFullscreen) {
          await (el as any).webkitRequestFullscreen();
          console.log('webkitRequestFullscreen called');
        } else if ((el as any).mozRequestFullScreen) {
          await (el as any).mozRequestFullScreen();
          console.log('mozRequestFullScreen called');
        } else if ((el as any).msRequestFullscreen) {
          await (el as any).msRequestFullscreen();
          console.log('msRequestFullscreen called');
        } else {
          console.error('浏览器不支持全屏API');
          alert('当前浏览器不支持全屏模式');
        }
      } else {
        console.log('Attempting to exit fullscreen...');
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          console.log('exitFullscreen called');
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
          console.log('webkitExitFullscreen called');
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
          console.log('mozCancelFullScreen called');
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
          console.log('msExitFullscreen called');
        }
      }
    } catch (err) {
      console.error('全屏操作失败:', err);
      alert('全屏操作失败: ' + (err as Error).message);
    }
  };

  useEffect(() => {
    const handleChange = () => {
      const fs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(fs);
      applyFsStyle(fs);
    };
    document.addEventListener('fullscreenchange', handleChange);
    document.addEventListener('webkitfullscreenchange', handleChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
    };
  }, []);

  useEffect(() => {
    if (effectiveProfile) {
      const title = `${effectiveProfile.username}${effectiveProfile.real_name || ''}的桌面`;
      document.title = siteConfig.site_title ? `${title} - ${siteConfig.site_title}` : title;
    }
  }, [effectiveProfile, siteConfig.site_title]);

  useEffect(() => {
    fetchLicenseStatus();
  }, []);

  useEffect(() => {
    if (effectiveProfile?.role === 'student') {
      // 代理模式下跳过登录限制检查
      if (!isProxyMode) {
        checkAndEnforceLoginRestriction();
      }
      // 权限一次拿齐（原来这里是 4 个 check + 专注模式，共 6~7 次查询）
      syncDesktopPermissions();
      fetchFarmState();
      fetchGalaxy();

      // ⛔ 30 秒不再是 10 秒：这一轮原来要打 7 次查询（profiles ×4、classes、pet_config、
      // 各自独立），实测一节课占全部请求的 62%。现在 1 次请求，且频率降到 1/3。
      // 老师禁用某项权限后最多 30 秒生效，对课堂场景足够。
      const interval = setInterval(() => {
        if (!isProxyMode) {
          checkAndEnforceLoginRestriction();
        }
        syncDesktopPermissions();
        fetchFarmState();
        fetchGalaxy();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [effectiveProfile, isProxyMode]);

  /**
   * 把 pet_config 的一行（或 null）落到组件状态：专注模式开关 + 各入口显隐。
   * 抽成纯函数，好让「一次拉齐权限」的轮询复用同一套解析，避免两处逻辑漂移。
   */
  // forceFocus：学生个人的「强制专注」开关（profiles.focus_force_enabled）。
  // 语义是「并集」不是「交集」—— 班级没开、甚至不在班级名单里，只要这个人被开了，
  // 他登录后就进专注模式。老师用它单独处理练习不认真的学生。
  const applyFocusConfig = (data: any | null, forceFocus?: any) => {
    const forced = forceFocus === 1 || forceFocus === true || forceFocus === '1';
    if (data) {
      const quickAccess = data.focus_mode_quick_access
        ? (typeof data.focus_mode_quick_access === 'string'
            ? JSON.parse(data.focus_mode_quick_access)
            : data.focus_mode_quick_access)
        : ['apps', 'ai_qa', 'notebook'];

      const focusClasses = data.focus_mode_classes
        ? (typeof data.focus_mode_classes === 'string'
            ? JSON.parse(data.focus_mode_classes)
            : data.focus_mode_classes)
        : [];

      const toBool = (v: any) => v !== false && v !== 0 && v !== '0' && v !== null && v !== undefined;

      const config: FocusModeConfig = {
        focus_mode_enabled: data.focus_mode_enabled === true || data.focus_mode_enabled === 1 || data.focus_mode_enabled === '1',
        focus_mode_show_learn: toBool(data.focus_mode_show_learn),
        focus_mode_show_practice: toBool(data.focus_mode_show_practice),
        focus_mode_show_test: toBool(data.focus_mode_show_test),
        focus_mode_show_wrong: toBool(data.focus_mode_show_wrong),
        focus_mode_show_notebook: toBool(data.focus_mode_show_notebook),
        focus_mode_show_python: toBool(data.focus_mode_show_python),
        focus_mode_show_apps: toBool(data.focus_mode_show_apps),
        focus_mode_show_pet: toBool(data.focus_mode_show_pet),
        focus_mode_show_exchange: toBool(data.focus_mode_show_exchange),
        focus_mode_show_leaderboard: toBool(data.focus_mode_show_leaderboard),
        focus_mode_show_profile: toBool(data.focus_mode_show_profile),
        focus_mode_show_security: toBool(data.focus_mode_show_security),
        focus_mode_show_proxyBrowser: toBool(data.focus_mode_show_proxyBrowser),
        focus_mode_show_creative: toBool(data.focus_mode_show_creative),
        focus_mode_show_wpsOp: toBool(data.focus_mode_show_wpsOp),
        focus_mode_show_aiExplain: toBool(data.focus_mode_show_aiExplain),
        focus_mode_quick_access: quickAccess,
        focus_mode_classes: focusClasses,
      };

      setFocusModeConfig(config);

      if (effectiveProfile) {
        const studentClassId = effectiveProfile.class_id;
        const isInFocusClass = config.focus_mode_enabled && (
          config.focus_mode_classes.length === 0 ||
          config.focus_mode_classes.includes(studentClassId)
        );
        // 个人强制专注优先：班级没开也会进
        setIsFocusModeActive(isInFocusClass || forced);
      } else {
        setIsFocusModeActive(forced);
      }
    } else {
      setFocusModeConfig({
        focus_mode_enabled: false,
        focus_mode_show_learn: true,
        focus_mode_show_practice: true,
        focus_mode_show_test: true,
        focus_mode_show_wrong: true,
        focus_mode_show_notebook: true,
        focus_mode_show_python: true,
        focus_mode_show_apps: true,
        focus_mode_show_pet: true,
        focus_mode_show_exchange: true,
        focus_mode_show_leaderboard: true,
        focus_mode_show_profile: true,
        focus_mode_show_security: true,
        focus_mode_show_proxyBrowser: true,
        focus_mode_show_creative: true,
        focus_mode_show_wpsOp: true,
        focus_mode_show_aiExplain: true,
        focus_mode_quick_access: ['apps', 'ai_qa', 'notebook'],
        focus_mode_classes: [],
      });
      // 配置行缺失时也要尊重个人强制专注（此时图标全显示，只是萌宠收成小按钮）
      setIsFocusModeActive(forced);
    }
  };

  /**
   * 一次拉齐「可能被老师随时关掉」的所有权限，替代原来每 10 秒 7 次独立查询。
   *
   * 原来 Desktop 每轮要查：profiles(can_use_app) / profiles(can_exchange_internet_code) /
   * profiles(class_id) + classes(ai_enabled) / profiles(python_enabled) / pet_config。
   * 实测一节课 14.7 万次 profiles 查询（占全部请求 38%）、三张静态表合计 62%。
   * 现在一次 /api/student/desktop-permissions 全拿到，轮询也从 10 秒放宽到 30 秒。
   */
  const syncDesktopPermissions = async () => {
    if (!effectiveProfile?.id) return;
    try {
      const res: any = await backendClient.get('/api/student/desktop-permissions');
      const perm = res?.data ?? res;
      if (!perm) return;

      const { closeWindow, windows } = useDesktopStore.getState();
      const isOn = (v: any) => !(v === 0 || v === false || v === '0');

      if (!isOn(perm.can_use_app) && windows.some((w) => w.id === 'apps' && w.isOpen)) {
        closeWindow('apps');
        alert('您的应用访问权限已被管理员禁用');
      }
      if (!isOn(perm.can_exchange_internet_code) && windows.some((w) => w.id === 'exchange' && w.isOpen)) {
        closeWindow('exchange');
        alert('您的积分兑换权限已被管理员禁用');
      }
      // AI 答疑是班级级开关：没有班级时不判断（与原逻辑一致）
      if (perm.class_id && !perm.ai_enabled) {
        if (windows.some((w) => (w.id === 'app_ai_qa' || w.id === 'app_app_ai_qa') && w.isOpen)) {
          closeWindow('app_ai_qa');
          closeWindow('app_app_ai_qa');
          alert('AI答疑功能已被老师关闭');
        }
      }
      if (!isOn(perm.python_enabled) && windows.some((w) => w.id === 'python' && w.isOpen)) {
        closeWindow('python');
        alert('您的 Python 编程权限已被管理员禁用');
      }

      // 班级模块开关（练习 / 测试 / 操作题 / 萌宠）：老师关掉后，已打开的窗口立即关闭。
      // 多个模块同时被关只弹一次提示，避免连环弹窗挡屏。
      const moduleSwitchState: Record<ModuleGuardKey, boolean> = {
        practice_enabled: isOn(perm.practice_enabled),
        test_enabled: isOn(perm.test_enabled),
        op_enabled: isOn(perm.op_enabled),
        pet_enabled: isOn(perm.pet_enabled),
      };
      setModuleSwitches(moduleSwitchState);
      const guardLabels: Record<ModuleGuardKey, string> = {
        practice_enabled: '练习',
        test_enabled: '测试',
        op_enabled: '操作题',
        pet_enabled: '萌宠',
      };
      const closedLabels: string[] = [];
      Object.keys(MODULE_GUARD_MAP).forEach((winId) => {
        const k = MODULE_GUARD_MAP[winId];
        if (!moduleSwitchState[k] && windows.some((w) => w.id === winId && w.isOpen)) {
          closeWindow(winId);
          closedLabels.push(guardLabels[k]);
        }
      });
      if (closedLabels.length > 0) {
        alert(`${closedLabels.join('、')}功能已被老师关闭`);
      }

      applyFocusConfig(perm.focus || null, perm.focus_force_enabled);
    } catch (error) {
      console.error('同步桌面权限失败:', error);
    }
  };

  // ===== 代码农场（桌面游戏层） =====
  // 教师后台开启 + 本班命中 → 学生桌面自动进入农场态；关闭则立即退出。
  // 与专注模式同一套 10 秒轮询节奏，不额外增加请求频率。
  const farmPrevEnabled = useRef(false);

  const fetchFarmState = async () => {
    if (!effectiveProfile || effectiveProfile.role !== 'student') return;
    // 代理模式下教师正在远程控制学生桌面，不叠加游戏层，避免遮挡教师视图
    if (isProxyMode) return;
    try {
      const r: any = await backendClient.get('/api/student/farm/state');
      const d = r?.data;
      if (d && d.enabled) {
        // 教师本次「新开启」→ 作废学生之前的收起动作，重新弹出
        if (!farmPrevEnabled.current) setFarmDismissed(false);
        farmPrevEnabled.current = true;
        setFarmState(d as FarmState);
      } else {
        farmPrevEnabled.current = false;
        setFarmState(null);
      }
    } catch {
      // 静默：农场是可选玩法，失败不影响桌面主流程（401 已由 backendClient 统一处理）
    }
  };

  // ===== 学习星域（桌面反馈层）=====
  // 与农场同一套 10 秒轮询节奏。后端已按班级开关做过判定，这里只认 enabled。
  // 代理模式下教师正在看学生桌面，不叠图层，避免挡住教师视图。
  // ⛔ 性能：图层是一整套 SVG（第 5 档约 500 个节点、125 个动画）。如果每 10 秒都把新对象
  //    塞进 state，React 会整层重算一遍 —— 数据没变就别动 state，用序列化签名比一下即可。
  //    另外窗口最小化/切到后台（document.hidden）时不发请求，省带宽也省服务器查询。
  const galaxySigRef = useRef('');
  const fetchGalaxy = async () => {
    if (!effectiveProfile || effectiveProfile.role !== 'student' || isProxyMode) {
      galaxySigRef.current = '';
      setGalaxy(null);
      setGalaxyLoaded(true);
      return;
    }
    if (document.hidden) return; // 后台不轮询；恢复可见后下一拍（≤10s）自动补上
    try {
      const r: any = await backendClient.get('/api/student/study-galaxy');
      const d = r?.data;
      const next = d && d.enabled ? (d as GalaxyData) : null;
      const sig = next ? JSON.stringify(next) : '';
      if (sig === galaxySigRef.current) return; // 数据没变 → 不动 state，避免整层重渲染
      galaxySigRef.current = sig;
      setGalaxy(next);
    } catch {
      galaxySigRef.current = '';
      setGalaxy(null);
    } finally {
      setGalaxyLoaded(true);
    }
  };

  useEffect(() => {
    if (effectiveProfile?.role === 'student') {
      checkForNewNotifications(effectiveProfile.id);
      // 任务中心红点（有奖励可领的数量）
      useTaskStore.getState().fetchPendingCount();

      // ⛔ 两个节奏必须分开：
      //   · 通知要「及时」→ 30 秒
      //   · 任务红点只表示「有没有奖可领」，5 分钟一次完全够（2026-10-23 吴老确认）
      //   原来两者共用一个 30 秒定时器：pending-count 每次要跑十几次查询
      //   （27 个任务串行算进度），40 人在线就是每分钟 80 次刷新，
      //   实测它是全场最慢的常规接口（均 202ms、峰值 7.7s）。
      const notificationInterval = setInterval(() => {
        checkForNewNotifications(effectiveProfile.id);
      }, 30000);

      const taskBadgeInterval = setInterval(() => {
        useTaskStore.getState().fetchPendingCount();
      }, 5 * 60 * 1000);

      return () => {
        clearInterval(notificationInterval);
        clearInterval(taskBadgeInterval);
      };
    }
  }, [effectiveProfile, checkForNewNotifications]);

  useEffect(() => {
    let cancelled = false;

    // ⛔ 星域开启时**不拉背景图**：星域层自己就是一张深空画面，再下载壁纸纯属浪费带宽
    //    （每台机器每 30 秒一次）。先等第一次星域探测回来（galaxyLoaded）再决定，
    //    否则会出现「先拉一次图、发现星域开着、再丢掉」的浪费。
    if (!galaxyLoaded) return;
    if (galaxyOn) {
      if (useDesktopStore.getState().background !== '') setBackground('');
      return;
    }

    const fetchBackground = async () => {
      try {
        // 先检查学生是否有自定义背景（仅学生且已登录时才请求）
        if (effectiveProfile?.role === 'student' && effectiveProfile?.id) {
          const token = getAuthToken();
          if (token) {
            const headers: HeadersInit = { Authorization: `Bearer ${token}` };

            // 获取学生自定义背景配置
            const studentBgResponse = await fetch(`${API_CONFIG.apiUrl}/api/student/custom-background`, { headers });
            const studentBgResult = await studentBgResponse.json();

            if (!cancelled && studentBgResult.data && studentBgResult.data.customBackground) {
              // 学生有自定义背景，使用学生的（仅在变化时更新，避免重渲染）
              if (useDesktopStore.getState().background !== studentBgResult.data.customBackground) {
                setBackground(studentBgResult.data.customBackground);
              }
              return;
            }
          }
        }

        // 没有自定义背景，使用教师设置的默认背景
        const response = await fetch(`${API_CONFIG.apiUrl}/api/desktop-background`);
        const result = await response.json();
        if (!cancelled && result.data && result.data.url) {
          if (useDesktopStore.getState().background !== result.data.url) {
            setBackground(result.data.url);
          }
        }
      } catch (error) {
        console.error('获取桌面背景失败:', error);
      }
    };

    fetchBackground();
    // 每30秒检查一次背景更新
    const interval = setInterval(fetchBackground, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setBackground, effectiveProfile, galaxyLoaded, galaxyOn]);

  // 拉取学生激活的窗口皮肤
  useEffect(() => {
    const fetchActiveSkin = async () => {
      if (effectiveProfile?.role !== 'student' || !effectiveProfile?.id) {
        setActiveSkin(null);
        return;
      }
      try {
        const token = getAuthToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetch(`${API_CONFIG.apiUrl}/api/student/my-skins`, { headers });
        const result = await response.json();
        if (result.data) {
          const skinConfig = getSkinById(result.data.activeSkinId);
          setActiveSkin(skinConfig || null);
        }
      } catch (error) {
        console.error('获取激活皮肤失败:', error);
      }
    };

    fetchActiveSkin();
    const skinInterval = setInterval(fetchActiveSkin, 30000);
    return () => clearInterval(skinInterval);
  }, [effectiveProfile, setActiveSkin]);

  const handleIconDoubleClick = async (icon: typeof desktopIcons[0]) => {
    if (isPaidFeature(icon.id) && !canUseFeature(icon.id)) {
      alert(`${icon.title}功能需要系统授权后才能使用，请联系管理员激活授权。`);
      return;
    }

    // 班级模块开关（练习 / 测试 / 操作题 / 萌宠）：老师关掉后直接在入口拦住，窗口根本不打开
    const guardKey = MODULE_GUARD_MAP[icon.id];
    if (guardKey && !moduleSwitches[guardKey]) {
      alert(`${icon.title}功能已被老师关闭`);
      return;
    }

    // 农场手册：独立窗口，iframe 直接加载服务端给的手册地址
    if (icon.id === 'farmGuide') {
      if (!guideAvailable) {
        alert('学生手册暂时不可用，请让老师检查「代码农场 → 学生手册」。');
        return;
      }
      openWindow({
        id: 'farmGuide',
        title: '农场手册',
        icon: 'fa-book-open-reader',
        isMinimized: false,
        isMaximized: false,
        component: <FarmGuideApp url={guideUrl} />,
      });
      activateWindow('farmGuide');
      return;
    }

    if (icon.id === 'apps') {
      if (!effectiveProfile) {
        alert('请先登录');
        return;
      }

      try {
        const result = await backendClient.from('profiles').select('can_use_app').eq('id', effectiveProfile.id).maybeSingle();

        if (result.error || !result.data) {
          alert('检查权限失败');
          return;
        }

        const canUseAppValue = result.data.can_use_app;
        let canUseApp: boolean;
        if (canUseAppValue === 0 || canUseAppValue === false) {
          canUseApp = false;
        } else {
          canUseApp = true;
        }

        if (!canUseApp) {
          alert('您当前无法使用应用中心');
          return;
        }
      } catch (error) {
        alert('检查权限失败');
        return;
      }
    }

    if (icon.id === 'exchange') {
      if (!effectiveProfile) {
        alert('请先登录');
        return;
      }

      try {
        const result = await backendClient.from('profiles').select('can_open_exchange_module').eq('id', effectiveProfile.id).maybeSingle();

        if (result.error || !result.data) {
          alert('检查权限失败');
          return;
        }

        const canExchangeValue = result.data.can_open_exchange_module;
        let canExchange: boolean;
        if (canExchangeValue === 0 || canExchangeValue === false) {
          canExchange = false;
        } else {
          canExchange = true;
        }

        if (!canExchange) {
          alert('您当前无法使用积分兑换功能');
          return;
        }
      } catch (error) {
        alert('检查权限失败');
        return;
      }
    }

    if (icon.id === 'python') {
      if (!effectiveProfile) {
        alert('请先登录');
        return;
      }

      try {
        const result = await backendClient.from('profiles').select('python_enabled').eq('id', effectiveProfile.id).maybeSingle();

        if (result.error || !result.data) {
          alert('检查权限失败');
          return;
        }

        const pythonEnabledValue = result.data.python_enabled;
        const pythonEnabled = pythonEnabledValue !== 0 && pythonEnabledValue !== false;

        if (!pythonEnabled) {
          alert('Python 编程功能已被老师关闭');
          return;
        }
      } catch (error) {
        alert('检查权限失败');
        return;
      }
    }

    openWindow({
      id: icon.id,
      title: icon.title,
      icon: icon.icon,
      isMinimized: false,
      isMaximized: false,
      component: moduleComponents[icon.id],
    });
    activateWindow(icon.id);
  };

  // 星域「知识点地图」/「下一个目标」点击 → 打开学习模块并定位到该章（带小节时再滚到该小节）。
  // 窗口已开时 openWindow 只会置前（不换组件），所以切章靠 requestLearnChapter 派事件完成。
  const handleOpenLearnChapter = useCallback((clusterId: string, section?: string) => {
    if (!clusterId) return;
    requestLearnChapter(clusterId, section);
    openWindow({
      id: 'learn',
      title: '学习',
      icon: 'fa-book',
      isMinimized: false,
      isMaximized: false,
      component: <LearnModule />,
    });
    activateWindow('learn');
  }, [openWindow, activateWindow]);

  const handleOpenAiQa = async (initialData?: { question?: string }) => {
    if (effectiveProfile) {
      const { data: profileData } = await backendClient
        .from('profiles')
        .select('class_id')
        .eq('id', effectiveProfile.id)
        .maybeSingle();
      if (profileData?.class_id) {
        const { data } = await backendClient
          .from('classes')
          .select('ai_enabled')
          .eq('id', profileData.class_id)
          .maybeSingle();
        if (data && !data.ai_enabled) {
          alert('AI答疑功能已被老师关闭');
          return;
        }
      }
    }

    const existing = windows.find(w => w.id === 'app_ai_qa');

    openWindow({
      id: 'app_ai_qa',
      title: 'AI答疑',
      icon: 'fa-robot',
      isMinimized: false,
      isMaximized: false,
      initialData,
      component: <AiQaApp
        initialData={initialData}
        onClose={() => {
          const { closeWindow } = useDesktopStore.getState();
          closeWindow('app_ai_qa');
        }}
      />,
    });
    activateWindow('app_ai_qa');

    // 如果窗口已存在，通过自定义事件传递问题并自动发送
    if (existing && initialData?.question) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('aiqa:set-question', {
          detail: { question: initialData.question, autoSend: true }
        }));
      }, 100);
    }
  };

  // 挂载全局函数供子组件调用AI答疑
  useEffect(() => {
    (window as any).openAiQaWindow = handleOpenAiQa;
    return () => {
      delete (window as any).openAiQaWindow;
    };
  }, [handleOpenAiQa]);

  // 练习 / 错题本里的「相关知识点」按钮 → 打开学习模块并定位到该题的知识点。
  // 复用星域那套 handleOpenLearnChapter（打开窗口 + requestLearnChapter 双通道导航）。
  useEffect(() => {
    (window as any).openLearnChapter = handleOpenLearnChapter;
    return () => {
      delete (window as any).openLearnChapter;
    };
  }, [handleOpenLearnChapter]);

  // ===== 代码农场 · 学生手册 =====
  // 农场启用且手册可用时，桌面图标区多出一个「农场手册」入口。
  // ⛔ 手册地址由服务端解析好（老师上传的那份，或随包内置的默认手册 /code-farm-guide.html），
  //    前端不猜路径；guide_enabled=0（老师临时收起）时不显示入口。
  const guideUrl = farmState?.enabled ? String(farmState.world?.guide_url || '') : '';
  const guideAvailable = !!guideUrl && farmState?.world?.guide_enabled !== false;

  const getFilteredIcons = () => {
    const base = guideAvailable
      ? [...desktopIcons, { id: 'farmGuide', title: '农场手册', icon: 'fa-book-open-reader', color: 'bg-lime-600' }]
      : desktopIcons;
    // AI 讲解按 hidden_features 的 ai_explain 开关显示（默认关闭），与学生管理里的「讲解」按钮联动
    const all = isExplainHidden ? base.filter((icon) => icon.id !== 'aiExplain') : base;

    if (!isFocusModeActive || !focusModeConfig) {
      return all;
    }

    return all.filter(icon => {
      const showField = `focus_mode_show_${icon.id}`;
      return focusModeConfig[showField as keyof FocusModeConfig] !== false;
    });
  };

  const filteredIcons = getFilteredIcons();

  // 检测是否在 iframe 代理模式中（URL 有 proxy_token 参数）
  const hashQueryStr = window.location.hash.split('?')[1] || '';
  const hasProxyToken = new URLSearchParams(hashQueryStr).has('proxy_token');

  // 代理模式下的加载状态
  if (hasProxyToken && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <i className="fa-solid fa-spinner fa-spin text-4xl text-cyan-400 mb-4"></i>
          <p className="text-slate-300">正在加载学生桌面...</p>
        </div>
      </div>
    );
  }

  // 代理模式下验证失败（没有获取到 profile）
  if (hasProxyToken && !loading && !effectiveProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <i className="fa-solid fa-triangle-exclamation text-5xl text-red-400 mb-4"></i>
          <p className="text-red-300 mb-2">访问凭证验证失败</p>
          <p className="text-slate-400 text-sm mb-4">{proxyError || '凭证无效或已过期'}</p>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
          >
            关闭窗口
          </button>
        </div>
      </div>
    );
  }

  // 内置渐变兜底背景（叠在背景图下层）：
  // 1) 未配置背景时使用内置渐变；2) 外链背景在内网加载失败时渐变自动显现，避免灰蒙蒙
  const DESKTOP_BG_FALLBACK = 'linear-gradient(160deg, #10162b 0%, #14243f 45%, #0f3460 100%)';

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{
        backgroundImage: background
          ? `url(${background}), ${DESKTOP_BG_FALLBACK}`
          : DESKTOP_BG_FALLBACK,
        backgroundSize: background ? 'cover, cover' : 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-black/20"></div>

      {/* ===== 代码农场（桌面即游戏场）=====
          世界层挂在壁纸之上、桌面图标之下（z-[5]），所以图标仍浮在田野上；
          编辑器/收起草帽等交互层由 FarmOverlay 内部自行抬到 z-[1200]。 */}
      {farmState?.enabled && !farmDismissed ? (
        <FarmOverlay
          data={farmState}
          onRefresh={fetchFarmState}
          onDismiss={() => setFarmDismissed(true)}
        />
      ) : null}

      {/* 收起后的小挂件：随时能回到农场 */}
      {farmState?.enabled && farmDismissed ? (
        <button
          onClick={() => setFarmDismissed(false)}
          className="absolute bottom-20 right-5 z-[9997] flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-600/90 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur transition hover:bg-emerald-500"
          title="回到代码农场"
        >
          <i className="fa-solid fa-seedling" />
          代码农场
          <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px]">
            第 {farmState.world?.day ?? 1} 天
          </span>
        </button>
      ) : null}

      {/* ===== 学习星域（桌面反馈层）=====
          与农场同层（z-[5]）且互斥：农场开着时不叠星域，避免两层抢屏。
          专注模式退化为「只留星点 + 进度线」，关掉一切动画。 */}
      {galaxyOn && !(farmState?.enabled && !farmDismissed) ? (
        <StudyGalaxyLayer data={galaxy as GalaxyData} simple={isFocusModeActive || Number(galaxy?.low_motion) === 1} onOpenChapter={handleOpenLearnChapter} />
      ) : null}

      <DesktopPet 
        onOpenPetModule={() => {
          if (isPaidFeature('pet') && !canUseFeature('pet')) {
            alert('萌宠功能需要系统授权后才能使用，请联系管理员激活授权。');
            return;
          }
          // 班级萌宠开关：点桌面宠物也不能打开萌宠窗口
          if (!moduleSwitches.pet_enabled) {
            alert('萌宠功能已被老师关闭');
            return;
          }
          openWindow({
            id: 'pet',
            title: '我的萌宠',
            icon: 'fa-paw',
            isMinimized: false,
            isMaximized: false,
            component: <PetModule />,
          });
        }}
        onOpenAiQa={handleOpenAiQa}
        focusModeEnabled={isFocusModeActive}
        onToggleQuickAccess={() => setQuickAccessOpen(!quickAccessOpen)}
      />

      <QuickAccessPanel
        isOpen={quickAccessOpen}
        onClose={() => setQuickAccessOpen(false)}
        quickAccessIds={focusModeConfig?.focus_mode_quick_access || ['apps', 'ai_qa', 'notebook']}
        onOpenAiQa={handleOpenAiQa}
        moduleComponents={moduleComponents}
        canUsePaidFeatures={licenseStatus?.isValid || licenseStatus?.isFreeOpenDay || false}
        paidFeatures={PAID_STUDENT_FEATURES}
        onCheckAppPermission={async () => {
          if (!effectiveProfile) return false;
          const { data } = await backendClient.from('profiles').select('can_use_app').eq('id', effectiveProfile.id).maybeSingle();
          if (!data) return false;
          return data.can_use_app !== 0 && data.can_use_app !== false;
        }}
        onCheckExchangePermission={async () => {
          if (!effectiveProfile) return false;
          const { data } = await backendClient.from('profiles').select('can_open_exchange_module').eq('id', effectiveProfile.id).maybeSingle();
          if (!data) return false;
          return data.can_open_exchange_module === 1 || data.can_open_exchange_module === true || data.can_open_exchange_module === '1';
        }}
      />

      <div className="absolute top-4 left-4 z-[9998] flex items-center gap-2">
        {/* 代理模式下不显示退出登录按钮 */}
        {!isProxyMode && (
          <button
            onClick={signOut}
            className="bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          >
            <i className="fa-solid fa-sign-out-alt"></i>
            退出登录
            {effectiveProfile && (
              <span className="text-gray-200 ml-1 border-l border-gray-600 pl-2">
                {effectiveProfile.username}
              </span>
            )}
          </button>
        )}
        {/* 代理模式下显示提示 */}
        {isProxyMode && effectiveProfile && (
          <div className="bg-cyan-800/80 text-white px-4 py-2 rounded-lg flex items-center gap-2">
            <i className="fa-solid fa-satellite-dish"></i>
            查看学生桌面: {effectiveProfile.real_name || effectiveProfile.username}
          </div>
        )}
        <button
          onClick={toggleFullscreen}
          className="bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          title={isFullscreen ? '退出全屏' : '全屏模式'}
        >
          <i className={`fa-solid ${isFullscreen ? 'fa-compress' : 'fa-expand'}`}></i>
          {isFullscreen ? '退出全屏' : '全屏模式'}
        </button>
        <button
          onClick={() => {
            if (isPaidFeature('taskCenter') && !canUseFeature('taskCenter')) {
              alert('任务中心功能需要系统授权后才能使用，请联系管理员激活授权。');
              return;
            }
            openWindow({
              id: 'taskCenter',
              title: '任务中心',
              icon: 'fa-clipboard-list',
              isMinimized: false,
              isMaximized: false,
              component: moduleComponents['taskCenter'],
            });
          }}
          className="relative bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          title={licenseLoaded && isPaidFeature('taskCenter') && !canUseFeature('taskCenter') ? '任务中心（需授权）' : '任务中心'}
        >
          <i className={`fa-solid fa-clipboard-list ${licenseLoaded && isPaidFeature('taskCenter') && !canUseFeature('taskCenter') ? 'text-gray-500' : ''}`}></i>
          任务中心
          {licenseLoaded && isPaidFeature('taskCenter') && !canUseFeature('taskCenter') && (
            <i className="fa-solid fa-lock text-[10px] text-amber-400 ml-1"></i>
          )}
          <TaskBadge />
        </button>
        {/* AI 讲堂：与桌面「AI讲解」图标同一个开关（hidden_features 的 ai_explain），只对学生开放。
            ⛔ 放任务中心右边、点名前面，是因为它和任务中心一样属于「上课时点一下就能用」的入口，
               而「AI讲解」是要学生自己找错题的，留在桌面上更合适。 */}
        {!isExplainHidden && effectiveProfile?.role === 'student' && (
          <button
            onClick={() => {
              openWindow({
                id: 'aiLecture',
                title: 'AI 讲堂',
                icon: 'fa-chalkboard-user',
                isMinimized: false,
                isMaximized: false,
                component: moduleComponents['aiLecture'],
              });
            }}
            className="bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            title="AI 讲堂：老师做好的语音微课程"
          >
            <i className="fa-solid fa-chalkboard-user"></i>
            AI 讲堂
          </button>
        )}
        {effectiveProfile?.role === 'teacher' && (
          <button
            onClick={() => {
              const teacherRollCallPaid = true;
              const canUseRollCall = licenseStatus?.isValid || licenseStatus?.isFreeOpenDay || false;
              // 先处理加载中状态——不能误报「未授权」也不能直接放行，
              // 而是明确提示加载中，避免 UI 显示正常（无锁图标）但点击报错的不一致。
              if (!licenseLoaded) {
                alert('授权状态加载中，请稍候再试...');
                return;
              }
              if (teacherRollCallPaid && !canUseRollCall) {
                alert('课堂点名功能需要系统授权后才能使用，请联系管理员激活授权。');
                return;
              }
              openWindow({
                id: 'rollCall',
                title: '课堂点名',
                icon: 'fa-hand-pointer',
                isMinimized: false,
                isMaximized: false,
                component: moduleComponents['rollCall'],
              });
            }}
            className="bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            title={licenseLoaded && !(licenseStatus?.isValid || licenseStatus?.isFreeOpenDay) ? '课堂点名（需授权）' : '课堂点名'}
          >
            <i className={`fa-solid fa-hand-pointer ${licenseLoaded && !(licenseStatus?.isValid || licenseStatus?.isFreeOpenDay) ? 'text-gray-500' : ''}`}></i>
            点名
            {licenseLoaded && !(licenseStatus?.isValid || licenseStatus?.isFreeOpenDay) && (
              <i className="fa-solid fa-lock text-[10px] text-amber-400 ml-1"></i>
            )}
          </button>
        )}
        {!isRollCallHidden && effectiveProfile?.role === 'student' && (
          <button
            onClick={() => {
              if (isPaidFeature('studentRollCall') && !canUseFeature('studentRollCall')) {
                alert('课堂点名功能需要系统授权后才能使用，请联系管理员激活授权。');
                return;
              }
              openWindow({
                id: 'studentRollCall',
                title: '课堂点名',
                icon: 'fa-hand-pointer',
                isMinimized: false,
                isMaximized: true,
                component: moduleComponents['studentRollCall'],
              });
            }}
            className="bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            title={licenseLoaded && isPaidFeature('studentRollCall') && !canUseFeature('studentRollCall') ? '课堂点名（需授权）' : '课堂点名'}
          >
            <i className={`fa-solid fa-hand-pointer ${licenseLoaded && isPaidFeature('studentRollCall') && !canUseFeature('studentRollCall') ? 'text-gray-500' : ''}`}></i>
            点名
            {licenseLoaded && isPaidFeature('studentRollCall') && !canUseFeature('studentRollCall') && (
              <i className="fa-solid fa-lock text-[10px] text-amber-400 ml-1"></i>
            )}
          </button>
        )}
        {!isPaintBoardHidden && (
          <button
            onClick={() => setIsPaintBoardOpen(!isPaintBoardOpen)}
            className="bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            title="画笔"
          >
            <i className="fa-solid fa-pen-to-square"></i>
            画笔
          </button>
        )}
      </div>

      {/* Buff状态显示 */}
      {effectiveProfile && (
        <BuffBadge studentId={effectiveProfile.id} compact className="fixed top-4 right-4" />
      )}

      <div className="z-10" style={{ position: 'absolute', top: '76px', left: '16px', maxWidth: '340px' }}>
        <div className="grid gap-3 grid-cols-4">
          {filteredIcons.map((icon) => (
            <DesktopIcon
              key={icon.id}
              icon={icon}
              onDoubleClick={() => handleIconDoubleClick(icon)}
              isLocked={licenseLoaded && isPaidFeature(icon.id) && !canUseFeature(icon.id)}
            />
          ))}
        </div>
      </div>

      <div>
        {windows
          .filter((w) => w.isOpen)
          .map((window) => (
            <WindowFrame
              key={window.id}
              id={window.id}
              title={window.title}
              isMaximized={window.isMaximized}
              isMinimized={window.isMinimized}
              zIndex={window.zIndex}
            >
              {window.component}
            </WindowFrame>
          ))}
      </div>

      <Taskbar />
      <NotificationCenter />
      <PaintBoard
        isOpen={isPaintBoardOpen}
        onClose={() => setIsPaintBoardOpen(false)}
      />
    </div>
  );
};
