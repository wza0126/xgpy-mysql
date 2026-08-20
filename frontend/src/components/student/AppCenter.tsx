import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useDesktopStore } from '../../store/desktopStore';
import { backendClient } from '../../api/backendClient';
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
  price_type: 'free' | 'points' | 'per_use';
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

export const AppCenter: React.FC = () => {
  const { user, profile } = useAuth();
  const { openWindow, closeWindow, activateWindow } = useDesktopStore();
  const [activeTab, setActiveTab] = useState<'myApps' | 'marketplace'>('myApps');
  const [apps, setApps] = useState<App[]>([]);
  const [myApps, setMyApps] = useState<StudentAppUsage[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [appVisibility, setAppVisibility] = useState<AppVisibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [processingAppId, setProcessingAppId] = useState<string | null>(null);

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
        const { data: studentData } = await backendClient.from('profiles').select('*').eq('id', user?.id).single();
        if (!studentData) {
          alert('获取用户信息失败！');
          return;
        }
        if (studentData?.current_points < app.points_price) {
          alert('积分不足！');
          return;
        }
        const { error: updateError } = await backendClient.from('profiles').update({ current_points: studentData.current_points - app.points_price }).eq('id', user?.id);
        if (updateError) throw updateError;
      }
      
      const success = await acquireApp(app);
      if (success) {
        alert(app.price_type === 'free' ? '获取成功！' : '兑换成功！');
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

      // 扣除积分
      const { error: updateError } = await backendClient
        .from('profiles')
        .update({ current_points: studentData.current_points - app.points_price })
        .eq('id', user.id);
      
      if (updateError) {
        alert('积分扣除失败，请重试！');
        return;
      }
    }

    console.log('Python魔法学院调试 - app:', { id: app.id, type: app.type, name: app.name });

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
        {activeTab === 'marketplace' && (
          <div className="ml-auto">
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
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {app.price_type === 'free' ? '免费' : 
                       app.price_type === 'per_use' ? `${app.points_price} 积分/次` :
                       `${app.points_price} 积分`}
                    </div>
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
                            : 'bg-yellow-500 text-white hover:bg-yellow-600'
                        } disabled:opacity-50`}
                      >
                        {processingAppId === app.id ? '处理中...' : 
                         app.price_type === 'free' ? '免费获取' : '积分兑换'}
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
    </div>
  );
};
