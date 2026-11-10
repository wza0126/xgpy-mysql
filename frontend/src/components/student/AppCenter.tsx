import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useDesktopStore } from '../../store/desktopStore';
import { backendClient } from '../../api/backendClient';
import { TimeExchangeModal } from './TimeExchangeModal';
import { WordApp } from './WordApp';
import { AiQaApp } from './AiQaApp';
import { ExternalLinkApp } from './ExternalLinkApp';
import { HtmlPageApp } from './HtmlPageApp';
import { MentalHealthApp } from './MentalHealthApp';
import { PythonMagicAcademy } from './PythonMagicAcademy';
import { CodeRealm } from './CodeRealm';
import { TypingTrainer } from './TypingTrainer';
import { toDatabaseDateTime } from '../../utils/dateUtils';

interface App {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: string;
  // time = 按时长（消耗全局时长池，不扣积分），2026-11-08 新增
  price_type: 'free' | 'points' | 'per_use' | 'time';
  points_price: number;
  category: string;
  is_active: boolean;
  config?: any;
  external_url?: string;
  iframe_enabled?: boolean;
}

interface StudentAppUsage {
  id: string;
  app_id: string;
  student_id: string;
  usage_count: number;
  last_used_at: string;
}

interface Class {
  id: string;
  name: string;
}

interface AppVisibility {
  id: string;
  app_id: string;
  class_id: string;
  is_visible: boolean;
}

interface AppCenterProps {
  /** 桌面推荐图标专用：挂载后自动启动这个应用（2026-11-11） */
  forceAppId?: string;
  /** 外壳窗口 id：启动成功后自动关闭它，学生只看到应用本身 */
  shellWindowId?: string;
}

export const AppCenter: React.FC<AppCenterProps> = ({ forceAppId, shellWindowId }) => {
  const { user, profile, refreshProfile } = useAuth();
  const { openWindow, closeWindow, activateWindow } = useDesktopStore();
  const [activeTab, setActiveTab] = useState<'myApps' | 'marketplace'>('myApps');
  const [apps, setApps] = useState<App[]>([]);
  const [myApps, setMyApps] = useState<StudentAppUsage[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [appVisibility, setAppVisibility] = useState<AppVisibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [processingAppId, setProcessingAppId] = useState<string | null>(null);
  // 游戏时长池（2026-11-08）：钻石换分钟，按时长应用打开时消耗
  const [playtime, setPlaytime] = useState<any>(null);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [timeDiamonds, setTimeDiamonds] = useState(1);
  const [exchangingTime, setExchangingTime] = useState(false);

  const loadPlaytime = async () => {
    try {
      const r: any = await backendClient.get('/api/student/playtime');
      if (r?.data) setPlaytime(r.data);
    } catch { /* 未开启时长功能时静默失败 */ }
  };

  useEffect(() => { loadPlaytime(); }, []);

  const doExchangeTime = async () => {
    if (exchangingTime) return;
    setExchangingTime(true);
    try {
      const r: any = await backendClient.post('/api/student/playtime/exchange', { diamonds: timeDiamonds });
      if (r?.error) { alert(r.error); return; }
      if (r?.data?.wallet) setPlaytime(r.data.wallet);
      await refreshProfile();
      setShowTimeModal(false);
      alert(`兑换成功：${r?.data?.minutes ?? 0} 分钟游戏时间`);
    } catch (e: any) {
      alert('兑换失败：' + (e?.message || '请重试'));
    } finally {
      setExchangingTime(false);
    }
  };

  // 图标映射表 - 根据应用ID或名称提供合适的图标
  const getIconForApp = (app: App) => {
    const iconMap: Record<string, { icon: string, color: string, bgColor: string }> = {
      'app_word': { icon: 'fa-book', color: 'text-green-500', bgColor: 'bg-green-100' },
      'app_ai_qa': { icon: 'fa-robot', color: 'text-blue-500', bgColor: 'bg-blue-100' },
      'app_python_magic_academy': { icon: 'fa-hat-wizard', color: 'text-purple-500', bgColor: 'bg-purple-100' },
      'app_mental_health': { icon: 'fa-heart-pulse', color: 'text-green-500', bgColor: 'bg-green-100' },
      'app_calculator': { icon: 'fa-calculator', color: 'text-blue-500', bgColor: 'bg-blue-100' },
      'app_notepad': { icon: 'fa-file-lines', color: 'text-yellow-500', bgColor: 'bg-yellow-100' },
      'app_calendar': { icon: 'fa-calendar', color: 'text-purple-500', bgColor: 'bg-purple-100' },
      'app_timer': { icon: 'fa-clock', color: 'text-orange-500', bgColor: 'bg-orange-100' },
      'app_dictionary': { icon: 'fa-book-atlas', color: 'text-indigo-500', bgColor: 'bg-indigo-100' },
      'app_code': { icon: 'fa-code', color: 'text-cyan-500', bgColor: 'bg-cyan-100' },
      'app_game': { icon: 'fa-gamepad', color: 'text-pink-500', bgColor: 'bg-pink-100' },
      'app_simulation': { icon: 'fa-flask-vial', color: 'text-teal-500', bgColor: 'bg-teal-100' },
      'app_browser': { icon: 'fa-globe', color: 'text-slate-500', bgColor: 'bg-slate-100' },
    };
    
    // 尝试通过应用ID匹配
    if (iconMap[app.id]) {
      return iconMap[app.id];
    }
    
    // 通过名称匹配
    const name = app.name.toLowerCase();
    if (name.includes('单词') || name.includes('word')) {
      return { icon: 'fa-book', color: 'text-green-500', bgColor: 'bg-green-100' };
    } else if (name.includes('计算') || name.includes('calculator')) {
      return { icon: 'fa-calculator', color: 'text-blue-500', bgColor: 'bg-blue-100' };
    } else if (name.includes('笔记') || name.includes('notepad')) {
      return { icon: 'fa-file-lines', color: 'text-yellow-500', bgColor: 'bg-yellow-100' };
    } else if (name.includes('游戏') || name.includes('game')) {
      return { icon: 'fa-gamepad', color: 'text-pink-500', bgColor: 'bg-pink-100' };
    } else if (name.includes('浏览器') || name.includes('browser')) {
      return { icon: 'fa-globe', color: 'text-slate-500', bgColor: 'bg-slate-100' };
    } else if (name.includes('编程') || name.includes('code')) {
      return { icon: 'fa-code', color: 'text-cyan-500', bgColor: 'bg-cyan-100' };
    }
    
    // 通过类别匹配
    if (app.category === '学习工具') {
      return { icon: 'fa-graduation-cap', color: 'text-blue-500', bgColor: 'bg-blue-100' };
    } else if (app.category === '编程实训') {
      return { icon: 'fa-laptop-code', color: 'text-cyan-500', bgColor: 'bg-cyan-100' };
    } else if (app.category === '游戏') {
      return { icon: 'fa-gamepad', color: 'text-purple-500', bgColor: 'bg-purple-100' };
    } else if (app.category === '模拟') {
      return { icon: 'fa-flask-vial', color: 'text-orange-500', bgColor: 'bg-orange-100' };
    }
    
    // 默认图标
    return { icon: 'fa-cube', color: 'text-gray-500', bgColor: 'bg-gray-100' };
  };

  // 渲染图标的组件
  const renderAppIcon = (app: App, size: 'md' | 'lg' = 'lg') => {
    const iconInfo = getIconForApp(app);
    const sizeClasses = size === 'lg' 
      ? 'w-16 h-16 text-2xl'
      : 'w-12 h-12 text-xl';
      
    return (
      <div className={`${sizeClasses} ${iconInfo.bgColor} rounded-xl flex items-center justify-center mx-auto`}>
        <i className={`fa-solid ${iconInfo.icon} ${iconInfo.color}`}></i>
      </div>
    );
  };

  const categories = [
    { value: 'all', label: '全部' },
    { value: '学习工具', label: '学习工具' },
    { value: '编程实训', label: '编程实训' },
    { value: '游戏', label: '游戏' },
    { value: '模拟', label: '模拟' }
  ];

  const fetchApps = async () => {
    const { data } = await backendClient.from('apps').select('*').eq('is_active', true);
    if (data) {
      // 解析 config 字段
      const appsWithParsedConfig = data.map((app: any) => {
        let parsedConfig = app.config;
        if (typeof parsedConfig === 'string') {
          try {
            parsedConfig = JSON.parse(parsedConfig);
          } catch (e) {
            parsedConfig = {};
          }
        }
        return { ...app, config: parsedConfig };
      });
      setApps(appsWithParsedConfig as App[]);
    }
  };

  const fetchMyApps = async () => {
    if (!user) {
      console.log('fetchMyApps: 没有用户，跳过');
      return;
    }
    console.log('fetchMyApps: 获取用户应用，用户ID:', user.id);
    const { data, error } = await backendClient.from('student_app_usage').select('*').eq('student_id', user.id);
    if (error) {
      console.error('fetchMyApps: 查询出错', error);
      return;
    }
    console.log('fetchMyApps: 查询结果', data);
    if (data) setMyApps(data as StudentAppUsage[]);
  };

  const fetchClasses = async () => {
    const { data } = await backendClient.from('classes').select('*');
    if (data) setClasses(data as Class[]);
  };

  const fetchVisibility = async () => {
    const { data } = await backendClient.from('app_visibility').select('*');
    if (data) setAppVisibility(data as AppVisibility[]);
  };

  useEffect(() => {
    Promise.all([fetchApps(), fetchMyApps(), fetchClasses(), fetchVisibility()]).finally(() => setLoading(false));
  }, [user]);

  const isVisibleToStudent = (appId: string) => {
    if (!profile?.class_id) return true;
    const visibility = appVisibility.find(v => v.app_id === appId && v.class_id === profile.class_id);
    return !visibility || visibility.is_visible;
  };

  const isAppOwned = (appId: string) => {
    return myApps.some(u => u.app_id === appId);
  };

  const getUsageCount = (appId: string) => {
    const usage = myApps.find(u => u.app_id === appId);
    return usage?.usage_count || 0;
  };

  const acquireApp = async (app: App): Promise<boolean> => {
    if (!user) return false;
    
    try {
      console.log('acquireApp: 开始处理应用', app.id, '用户', user.id);
      
      const { data: existingRecord } = await backendClient
        .from('student_app_usage')
        .select('*')
        .eq('student_id', user.id)
        .eq('app_id', app.id)
        .single();
      
      console.log('acquireApp: 查询到现有记录', existingRecord);
      
      if (existingRecord) {
        console.log('acquireApp: 更新现有记录');
        const { error } = await backendClient.from('student_app_usage').update({
          usage_count: (existingRecord.usage_count || 0) + 1,
          last_used_at: toDatabaseDateTime(new Date())
        }).eq('id', existingRecord.id);
        if (error) throw error;
      } else {
        console.log('acquireApp: 创建新记录');
        const timestamp = Date.now().toString(36);
        const { error } = await backendClient.from('student_app_usage').insert({
          id: `sau_${timestamp}`,
          student_id: user.id,
          app_id: app.id,
          points_spent: app.price_type === 'points' ? app.points_price : 0,
          usage_count: 1,
          acquired_at: toDatabaseDateTime(new Date())
        });
        if (error) throw error;
      }
      
      console.log('acquireApp: 操作完成，重新获取应用列表');
      await fetchMyApps();
      return true;
    } catch (error: any) {
      console.error('acquireApp: 失败', error);
      return false;
    }
  };

  const handlePurchase = async (app: App) => {
    if (!user) {
      alert('请先登录！');
      return;
    }
    
    setProcessingAppId(app.id);
    
    try {
      if (app.price_type === 'points') {
        // 扣费一律交给服务端：按 apps 表定价原子扣减，积分不足直接拒绝，
        // 且有下限保护。旧写法是前端读 current_points 再绝对值写回，
        // 无锁无事务、无下限，会写出负分。
        const chargeResult: any = await backendClient.post('/api/student/apps/charge', {
          app_id: app.id,
        });
        if (chargeResult?.error) {
          alert(chargeResult.error);
          return;
        }
        await refreshProfile();
      }
      
      const success = await acquireApp(app);
      if (success) {
        // 按时长应用获取时也不扣积分，只说「获取成功」
        alert(app.price_type === 'points' ? '兑换成功！' : '获取成功！');
        setActiveTab('myApps');
      } else {
        alert('获取应用失败，请重试！');
      }
    } catch (error: any) {
      console.error('Purchase error:', error);
      alert('操作失败: ' + (error?.message || '未知错误'));
    } finally {
      setProcessingAppId(null);
    }
  };

  const handleLaunchApp = async (app: App) => {
    // AI 答疑应用是特殊的按次收费（每次提问扣积分，而不是打开就扣）
    if (app.type !== 'ai_qa' && app.price_type === 'per_use') {
      if (!user) {
        alert('请先登录！');
        return;
      }

      // 检查积分是否足够
      const { data: studentData } = await backendClient.from('profiles').select('*').eq('id', user.id).single();
      if (!studentData) {
        alert('获取用户信息失败！');
        return;
      }
      
      if (studentData.current_points < app.points_price) {
        alert(`积分不足！需要 ${app.points_price} 积分，当前只有 ${studentData.current_points} 积分`);
        return;
      }

      // 确认是否要打开
      const confirmed = confirm(`打开此应用将扣除 ${app.points_price} 积分，确定要打开吗？`);
      if (!confirmed) {
        return;
      }

      // 扣费交给服务端原子处理（不足则拒绝，且不会扣成负数）
      try {
        const chargeResult: any = await backendClient.post('/api/student/apps/charge', {
          app_id: app.id,
        });
        if (chargeResult?.error) {
          alert(chargeResult.error);
          return;
        }
        await refreshProfile();
      } catch (chargeError: any) {
        alert(chargeError?.message || '积分扣除失败，请重试！');
        return;
      }
    }

    console.log('Python魔法学院调试 - app:', { id: app.id, type: app.type, name: app.name });

    // 按时长计费：先向服务端确认「有没有时间玩」，有就进，没有就引导去赚钻石
    if (app.price_type === 'time') {
      try {
        const chargeResult: any = await backendClient.post('/api/student/apps/charge', { app_id: app.id });
        if (chargeResult?.error) { alert(chargeResult.error); return; }
        const d = chargeResult?.data || {};
        if (!d.can_play) {
          alert('游戏时间不够了。\n做测试、考试或完成任务可以赚钻石，1 颗钻石换几分钟游戏时间。');
          setShowTimeModal(true);
          return;
        }
        if (typeof d.play_minutes_balance === 'number') {
          setPlaytime((prev: any) => prev ? { ...prev, balance_minutes: d.play_minutes_balance, balance_seconds: d.play_seconds_balance } : prev);
        }
      } catch (e: any) {
        alert('检查游戏时间失败：' + (e?.message || '请重试'));
        return;
      }
    }

    // Python魔法学院：免费应用，直接同步打开窗口，不触发后台状态更新
    if (app.type === 'python_magic_academy' || app.id === 'app_python_magic_academy') {
      const windowId = `app_${app.id}`;
      openWindow({
        id: windowId,
        title: app.name,
        icon: 'fa-hat-wizard',
        isMinimized: false,
        isMaximized: false,
        component: <PythonMagicAcademy onClose={() => closeWindow(windowId)} />
      });
      activateWindow(windowId);
      return;
    }

    // 代码秘境：免费应用，直接同步打开窗口
    if (app.type === 'code_realm' || app.id === 'app_code_realm') {
      const windowId = `app_${app.id}`;
      openWindow({
        id: windowId,
        title: app.name,
        icon: 'fa-book-open',
        isMinimized: false,
        isMaximized: false,
        component: <CodeRealm onClose={() => closeWindow(windowId)} />
      });
      activateWindow(windowId);
      return;
    }

    // 键盘星域：盲打练习，免费应用直接打开
    if (app.type === 'typing_trainer' || app.id === 'app_typing_trainer') {
      const windowId = `app_${app.id}`;
      openWindow({
        id: windowId,
        title: app.name,
        icon: 'fa-keyboard',
        isMinimized: false,
        isMaximized: false,
        component: <TypingTrainer onClose={() => closeWindow(windowId)} />
      });
      activateWindow(windowId);
      return;
    }

    const success = await acquireApp(app);
    
    if (!success) {
      alert('启动应用失败，请重试！');
      return;
    }
    
    if (app.type === 'learning_tool' && app.id === 'app_word') {
      const wid = `app_${app.id}`;
      openWindow({
        id: wid,
        title: app.name,
        icon: 'fa-book',
        isMinimized: false,
        isMaximized: false,
        component: <WordApp onClose={() => closeWindow(wid)} />
      });
      activateWindow(wid);
    } else if (app.type === 'ai_qa') {
      // 检查班级 AI 答疑权限
      if (profile) {
        const { data: profileData } = await backendClient
          .from('profiles')
          .select('class_id')
          .eq('id', (profile as any).id)
          .maybeSingle();
        if (profileData?.class_id) {
          const { data: classData } = await backendClient
            .from('classes')
            .select('ai_enabled')
            .eq('id', profileData.class_id)
            .maybeSingle();
          if (classData && !classData.ai_enabled) {
            alert('AI答疑功能已被老师关闭');
            return;
          }
        }
      }
      const wid = `app_${app.id}`;
      openWindow({
        id: wid,
        title: app.name,
        icon: 'fa-robot',
        isMinimized: false,
        isMaximized: false,
        component: <AiQaApp onClose={() => closeWindow(wid)} />
      });
      activateWindow(wid);
    } else if (app.type === 'mental_health') {
      const wid = `app_${app.id}`;
      openWindow({
        id: wid,
        title: app.name,
        icon: 'fa-heart-pulse',
        isMinimized: false,
        isMaximized: false,
        component: <MentalHealthApp onClose={() => closeWindow(wid)} />
      });
      activateWindow(wid);
    } else if (app.type === 'external_link' && app.external_url) {
      const wid = `app_${app.id}`;
      openWindow({
        id: wid,
        title: app.name,
        icon: 'fa-globe',
        isMinimized: false,
        isMaximized: false,
        component: (
          <ExternalLinkApp
            url={app.external_url}
            title={app.name}
            useIframe={app.iframe_enabled}
            onClose={() => closeWindow(wid)}
          />
        )
      });
      activateWindow(wid);
    } else if (app.type === 'html_page') {
      // 调试信息
      console.log('HTML Page App - app:', app);
      console.log('HTML Page App - config:', app.config);

      let htmlContent = '<html><body><h1>内容加载中...</h1></body></html>';

      // 尝试获取 HTML 内容
      if (app.config) {
        if (typeof app.config === 'string') {
          // 如果 config 是字符串，直接用它
          htmlContent = app.config;
        } else if (app.config.htmlContent) {
          // 如果有 htmlContent 字段
          htmlContent = app.config.htmlContent;
        }
      }

      console.log('HTML Page App - final content:', htmlContent);

      const wid = `app_${app.id}`;
      openWindow({
        id: wid,
        title: app.name,
        icon: 'fa-code',
        isMinimized: false,
        isMaximized: false,
        component: (
          <HtmlPageApp
            htmlContent={htmlContent}
            title={app.name}
            onClose={() => closeWindow(wid)}
          />
        )
      });
      activateWindow(wid);
    } else {
      alert(`应用 "${app.name}" 正在开发中...`);
    }
  };

  // ===== 桌面推荐图标：自动启动指定应用（2026-11-11）=====
  // 不打开完整应用中心，所以「应用中心」被老师关掉也不影响推荐应用。
  // ⛔ 只复用 handleLaunchApp，绝不再写一套打开逻辑 —— 购买/时长/iframe 分支太多，两套迟早分叉。
  const forcedRef = useRef(false);
  const [forceFailed, setForceFailed] = useState(false);
  useEffect(() => {
    if (!forceAppId || loading || forcedRef.current) return;
    const app = apps.find(a => a.id === forceAppId);
    if (!app) { setForceFailed(true); return; }
    forcedRef.current = true;
    (async () => {
      await handleLaunchApp(app);
      const opened = useDesktopStore.getState().windows.some(w => w.id === `app_${app.id}` && w.isOpen);
      if (opened) {
        if (shellWindowId) closeWindow(shellWindowId);
      } else {
        setForceFailed(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceAppId, loading, apps]);

  if (forceAppId) {
    const app = apps.find(a => a.id === forceAppId);
    return (
      <div className="h-full flex flex-col bg-white">
        <div className="flex-1 overflow-y-auto p-6">
          {loading && <div className="text-center text-gray-500 py-10">正在加载…</div>}
          {!loading && !app && (
            <div className="text-center text-gray-500 py-10">这个应用已经下架了，请联系老师。</div>
          )}
          {!loading && app && !forceFailed && (
            <div className="text-center text-gray-500 py-10">
              <div className="text-4xl mb-2">{app.icon || '📦'}</div>
              正在打开 {app.name}…
            </div>
          )}
          {!loading && app && forceFailed && (
            <div className="max-w-sm mx-auto">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-4xl">{app.icon || '📦'}</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">{app.name}</h3>
                  <p className="text-xs text-gray-500">{app.description}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                还没能打开：可能是还没获取、积分不够，或者游戏时长不足。
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => { setForceFailed(false); handleLaunchApp(app); }}
                  className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium"
                >
                  再试一次
                </button>
                {app.price_type === 'time' && (
                  <button
                    onClick={() => setShowTimeModal(true)}
                    className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium"
                  >
                    用钻石换游戏时间
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <TimeExchangeModal
          open={showTimeModal}
          onClose={() => setShowTimeModal(false)}
          playtime={playtime}
          profile={profile}
          diamonds={timeDiamonds}
          setDiamonds={setTimeDiamonds}
          onExchange={doExchangeTime}
          exchanging={exchangingTime}
        />
      </div>
    );
  }

  const visibleApps = apps.filter(app => isVisibleToStudent(app.id));
  const myAppsData = visibleApps.filter(app => isAppOwned(app.id));
  const filteredMarketplaceApps = visibleApps.filter(app => {
    if (selectedCategory === 'all') return true;
    return app.category === selectedCategory;
  });

  if (loading) {
    return <div className="p-4 text-center">加载中...</div>;
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center gap-4 border-b border-gray-200 p-4">
        <button
          onClick={() => setActiveTab('myApps')}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'myApps' 
              ? 'bg-blue-500 text-white' 
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          我的应用
        </button>
        <button
          onClick={() => setActiveTab('marketplace')}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'marketplace' 
              ? 'bg-blue-500 text-white' 
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          应用市场
        </button>
        <button
          onClick={() => { loadPlaytime(); setShowTimeModal(true); }}
          className="ml-auto flex items-center gap-2 bg-sky-100 hover:bg-sky-200 px-4 py-2 rounded-full transition-colors"
          title="游戏时间：只有标了「按时长」的应用才消耗这里的时间。每 30 秒扣一次，关掉窗口或点别的窗口就停止。用钻石兑换。"
        >
          <i className="fa-solid fa-hourglass-half text-sky-600"></i>
          <span className="font-bold text-sky-700">{playtime?.balance_minutes ?? 0} 分钟</span>
        </button>
        {activeTab === 'marketplace' && (
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              {categories.map(cat => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'myApps' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {myAppsData.length > 0 ? (
              myAppsData.map(app => (
                <div
                  key={app.id}
                  className="p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => handleLaunchApp(app)}
                >
                  <div className="text-center">
                    {renderAppIcon(app)}
                    <h3 className="font-medium text-gray-800 mb-1 mt-3">{app.name}</h3>
                    <p className="text-sm text-gray-500 mb-2">{app.description}</p>
                    {app.price_type === 'time' && (
                      <div className="inline-block px-2 py-0.5 rounded-full text-xs bg-sky-100 text-sky-700 mb-2">
                        <i className="fa-solid fa-hourglass-half mr-1"></i>
                        按时长
                      </div>
                    )}
                    <div className="text-xs text-gray-400">
                      使用次数: {getUsageCount(app.id)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center h-64">
                <div className="text-6xl mb-4">📭</div>
                <p className="text-gray-500">还没有应用，去应用市场看看吧！</p>
                <button
                  onClick={() => setActiveTab('marketplace')}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  去应用市场
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredMarketplaceApps.length > 0 ? (
              filteredMarketplaceApps.map(app => {
                const owned = isAppOwned(app.id);
                return (
                  <div
                    key={app.id}
                    className="p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all"
                  >
                    <div className="text-center">
                    {renderAppIcon(app)}
                    <h3 className="font-medium text-gray-800 mb-1 mt-3">{app.name}</h3>
                    <p className="text-sm text-gray-500 mb-3">{app.description}</p>
                    <div className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                      app.price_type === 'free'
                        ? 'bg-green-100 text-green-700'
                        : app.price_type === 'per_use'
                        ? 'bg-orange-100 text-orange-700'
                        : app.price_type === 'time'
                        ? 'bg-sky-100 text-sky-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {app.price_type === 'free' ? '免费' :
                       app.price_type === 'per_use' ? `${app.points_price} 积分/次` :
                       app.price_type === 'time' ? '按时长' :
                       `${app.points_price} 积分`}
                    </div>
                    {app.price_type === 'time' && (
                      <p className="text-xs text-sky-600 mt-2">
                        <i className="fa-solid fa-hourglass-half mr-1"></i>
                        打开后按分钟消耗「游戏时间」，用钻石兑换
                      </p>
                    )}
                    {owned || app.price_type === 'per_use' ? (
                      <button
                        onClick={() => handleLaunchApp(app)}
                        disabled={processingAppId === app.id}
                        className={`mt-3 w-full py-2 rounded-lg font-medium transition-colors ${
                          app.price_type === 'per_use'
                            ? 'bg-orange-500 text-white hover:bg-orange-600'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                        } disabled:opacity-50`}
                      >
                        {processingAppId === app.id ? '启动中...' : '打开应用'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePurchase(app)}
                        disabled={processingAppId === app.id}
                        className={`mt-3 w-full py-2 rounded-lg font-medium transition-colors ${
                          app.price_type === 'free'
                            ? 'bg-green-500 text-white hover:bg-green-600'
                            : app.price_type === 'time'
                            ? 'bg-sky-500 text-white hover:bg-sky-600'
                            : 'bg-yellow-500 text-white hover:bg-yellow-600'
                        } disabled:opacity-50`}
                      >
                        {processingAppId === app.id ? '处理中...' :
                         app.price_type === 'free' ? '免费获取' :
                         app.price_type === 'time' ? '获取' : '积分兑换'}
                      </button>
                    )}
                  </div>
                  </div>
                );
              })
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center h-64">
                <div className="text-6xl mb-4">🔍</div>
                <p className="text-gray-500">没有找到符合条件的应用</p>
              </div>
            )}
          </div>
        )}
      </div>

      <TimeExchangeModal
        open={showTimeModal}
        onClose={() => setShowTimeModal(false)}
        playtime={playtime}
        profile={profile}
        diamonds={timeDiamonds}
        setDiamonds={setTimeDiamonds}
        onExchange={doExchangeTime}
        exchanging={exchangingTime}
      />
    </div>
  );
};
