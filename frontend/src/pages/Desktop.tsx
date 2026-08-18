import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSiteConfig } from '../hooks/useSiteConfig';
import { useDesktopStore, desktopIcons } from '../store/desktopStore';
import { useNotificationStore } from '../store/notificationStore';
import { DesktopIcon } from '../components/common/DesktopIcon';
import { WindowFrame } from '../components/common/WindowFrame';
import { Taskbar } from '../components/common/Taskbar';
import { DesktopPet } from '../components/common/DesktopPet';
import { QuickAccessPanel } from '../components/common/QuickAccessPanel';
import { LearnModule } from '../components/student/LearnModule';
import { PracticeModule } from '../components/student/PracticeModule';
import { TestModule } from '../components/student/TestModule';
import { WrongQuestions } from '../components/student/WrongQuestions';
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
import { SimilarPracticeWindow } from '../components/student/SimilarPracticeWindow';
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
  focus_mode_quick_access: string[];
  focus_mode_classes: string[];
}

const moduleComponents: Record<string, React.ReactNode> = {
  learn: <LearnModule />,
  practice: <PracticeModule />,
  test: <TestModule />,
  wrong: <WrongQuestions />,
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

export const Desktop: React.FC = () => {
  const { profile, signOut, checkAndEnforceLoginRestriction, isProxyMode, loading, proxyError } = useAuth();
  const { windows, background, openWindow, setBackground } = useDesktopStore();
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
    : ['paint_board', 'roll_call'];
  const isPaintBoardHidden = !effectiveProfile || (effectiveProfile?.role === 'student' && hiddenFeatures.includes('paint_board'));
  const isRollCallHidden = !effectiveProfile || (effectiveProfile?.role === 'student' && hiddenFeatures.includes('roll_call'));

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
      checkAppAccessPermission();
      checkAiAccessPermission();
      checkExchangePermission();
      fetchFocusModeConfig();

      const interval = setInterval(() => {
        if (!isProxyMode) {
          checkAndEnforceLoginRestriction();
        }
        checkAppAccessPermission();
        checkAiAccessPermission();
        checkExchangePermission();
        fetchFocusModeConfig();
      }, 10000);

      return () => clearInterval(interval);
    }
  }, [effectiveProfile, isProxyMode]);

  const fetchFocusModeConfig = async () => {
    try {
      const { data } = await backendClient.from('pet_config').select('*').maybeSingle();
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
          focus_mode_quick_access: quickAccess,
          focus_mode_classes: focusClasses,
        };
        
        setFocusModeConfig(config);
        
        if (config.focus_mode_enabled && effectiveProfile) {
          const studentClassId = effectiveProfile.class_id;
          const isInFocusClass = config.focus_mode_classes.length === 0 || 
            config.focus_mode_classes.includes(studentClassId);
          setIsFocusModeActive(isInFocusClass);
        } else {
          setIsFocusModeActive(false);
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
          focus_mode_quick_access: ['apps', 'ai_qa', 'notebook'],
          focus_mode_classes: [],
        });
        setIsFocusModeActive(false);
      }
    } catch (error) {
      console.error('获取专注模式配置失败:', error);
    }
  };

  const checkAppAccessPermission = async () => {
    const { closeWindow, windows } = useDesktopStore.getState();

    if (!effectiveProfile) return;

    try {
      const result = await backendClient.from('profiles').select('can_use_app').eq('id', effectiveProfile.id).maybeSingle();

      if (result.error || !result.data) return;

      const canUseAppValue = result.data.can_use_app;
      let canUseApp: boolean;
      if (canUseAppValue === 0 || canUseAppValue === false) {
        canUseApp = false;
      } else {
        canUseApp = true;
      }

      const appsWindowOpen = windows.some(w => w.id === 'apps' && w.isOpen);

      if (!canUseApp && appsWindowOpen) {
        closeWindow('apps');
        alert('您的应用访问权限已被管理员禁用');
      }
    } catch (error) {
      console.error('检查应用权限失败:', error);
    }
  };

  const checkExchangePermission = async () => {
    const { closeWindow, windows } = useDesktopStore.getState();

    if (!effectiveProfile) return;

    try {
      const result = await backendClient.from('profiles').select('can_exchange_internet_code').eq('id', effectiveProfile.id).maybeSingle();

      if (result.error || !result.data) return;

      const canExchangeValue = result.data.can_exchange_internet_code;
      let canExchange: boolean;
      if (canExchangeValue === 0 || canExchangeValue === false) {
        canExchange = false;
      } else {
        canExchange = true;
      }

      const exchangeWindowOpen = windows.some(w => w.id === 'exchange' && w.isOpen);

      if (!canExchange && exchangeWindowOpen) {
        closeWindow('exchange');
        alert('您的积分兑换权限已被管理员禁用');
      }
    } catch (error) {
      console.error('检查兑换权限失败:', error);
    }
  };

  const checkAiAccessPermission = async () => {
    const { closeWindow, windows } = useDesktopStore.getState();
    if (!effectiveProfile) return;

    try {
      const { data: profileData } = await backendClient
        .from('profiles')
        .select('class_id')
        .eq('id', effectiveProfile.id)
        .maybeSingle();
      if (!profileData?.class_id) return;

      const { data } = await backendClient
        .from('classes')
        .select('ai_enabled')
        .eq('id', profileData.class_id)
        .maybeSingle();

      if (data && !data.ai_enabled) {
        const aiWindowOpen = windows.some(w => (w.id === 'app_ai_qa' || w.id === 'app_app_ai_qa') && w.isOpen);
        if (aiWindowOpen) {
          closeWindow('app_ai_qa');
          closeWindow('app_app_ai_qa');
          alert('AI答疑功能已被老师关闭');
        }
      }
    } catch (error) {
      console.error('检查AI答疑权限失败:', error);
    }
  };

  useEffect(() => {
    if (effectiveProfile?.role === 'student') {
      checkForNewNotifications(effectiveProfile.id);

      const notificationInterval = setInterval(() => {
        checkForNewNotifications(effectiveProfile.id);
      }, 30000);

      return () => clearInterval(notificationInterval);
    }
  }, [effectiveProfile, checkForNewNotifications]);

  useEffect(() => {
    let cancelled = false;

    const fetchBackground = async () => {
      try {
        // 先检查学生是否有自定义背景（仅学生且已登录时才请求）
        if (effectiveProfile?.role === 'student' && effectiveProfile?.id) {
          const token = localStorage.getItem('xgpy_token');
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
  }, [setBackground, effectiveProfile]);

  // 拉取学生激活的窗口皮肤
  useEffect(() => {
    const fetchActiveSkin = async () => {
      if (effectiveProfile?.role !== 'student' || !effectiveProfile?.id) {
        setActiveSkin(null);
        return;
      }
      try {
        const token = localStorage.getItem('xgpy_token');
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

    openWindow({
      id: icon.id,
      title: icon.title,
      icon: icon.icon,
      isMinimized: false,
      isMaximized: false,
      component: moduleComponents[icon.id],
    });
  };

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

  // 同类题强化练习窗口（独立窗口，不影响当前练习）
  const handleOpenSimilarPractice = (initialData?: { questionId?: string }) => {
    if (!initialData?.questionId) return;
    openWindow({
      id: 'app_similar_practice',
      title: '同类题强化练习',
      icon: 'fa-layer-group',
      isMinimized: false,
      isMaximized: false,
      initialData,
      component: <SimilarPracticeWindow
        initialData={initialData}
        onClose={() => {
          const { closeWindow } = useDesktopStore.getState();
          closeWindow('app_similar_practice');
        }}
      />,
    });
  };

  useEffect(() => {
    (window as any).openSimilarPracticeWindow = handleOpenSimilarPractice;
    return () => {
      delete (window as any).openSimilarPracticeWindow;
    };
  }, [handleOpenSimilarPractice]);

  const getFilteredIcons = () => {
    if (!isFocusModeActive || !focusModeConfig) {
      return desktopIcons;
    }
    
    return desktopIcons.filter(icon => {
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

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{
        backgroundColor: background ? 'transparent' : '#1a202c',
        backgroundImage: background ? `url(${background})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-black/20"></div>

      <DesktopPet 
        onOpenPetModule={() => {
          if (isPaidFeature('pet') && !canUseFeature('pet')) {
            alert('萌宠功能需要系统授权后才能使用，请联系管理员激活授权。');
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
              alert('课堂任务功能需要系统授权后才能使用，请联系管理员激活授权。');
              return;
            }
            openWindow({
              id: 'taskCenter',
              title: '课堂任务',
              icon: 'fa-chalkboard-user',
              isMinimized: false,
              isMaximized: false,
              component: moduleComponents['taskCenter'],
            });
          }}
          className="bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          title={licenseLoaded && isPaidFeature('taskCenter') && !canUseFeature('taskCenter') ? '课堂任务（需授权）' : '课堂任务'}
        >
          <i className={`fa-solid fa-chalkboard-user ${licenseLoaded && isPaidFeature('taskCenter') && !canUseFeature('taskCenter') ? 'text-gray-500' : ''}`}></i>
          课堂任务
          {licenseLoaded && isPaidFeature('taskCenter') && !canUseFeature('taskCenter') && (
            <i className="fa-solid fa-lock text-[10px] text-amber-400 ml-1"></i>
          )}
        </button>
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
