import React, { useState, useEffect, useCallback } from 'react';
import { backendClient } from '../../api/backendClient';
import { useAuth } from '../../hooks/useAuth';
import { LicenseGuard } from '../common/LicenseGuard';

interface App {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: 'learning_tool' | 'coding_practice' | 'game' | 'simulation' | 'external_link' | 'html_page' | 'ai_qa' | 'mental_health' | 'python_magic_academy' | 'code_realm' | 'typing_trainer';
  price_type: 'free' | 'points' | 'per_use';
  points_price: number;
  category: string;
  is_active: boolean;
  is_marketplace: boolean;
  config: Record<string, unknown>;
  external_url: string;
  iframe_enabled: boolean;
  created_at: string;
}

interface AppVisibility {
  id: string;
  app_id: string;
  class_id: string;
  is_visible: boolean;
}

interface Class {
  id: string;
  name: string;
}

type AppTypeOption = { value: App['type']; label: string };
const appTypes: AppTypeOption[] = [
  { value: 'learning_tool', label: '学习工具' },
  { value: 'coding_practice', label: '编程实训' },
  { value: 'ai_qa', label: 'AI 答疑' },
  { value: 'mental_health', label: '心理健康' },
  { value: 'game', label: '游戏' },
  { value: 'simulation', label: '模拟' },
  { value: 'external_link', label: '外部链接' },
  { value: 'html_page', label: 'HTML 网页' },
  { value: 'python_magic_academy', label: 'Python魔法学院' },
  { value: 'code_realm', label: '代码秘境' },
  { value: 'typing_trainer', label: '键盘星域' }
];

interface Equipment {
  id: string;
  name: string;
  icon: string;
  drop_rate: number;
  crit_bonus: number;
}

interface ProgressRow {
  user_id: string;
  name: string;
  class_name: string;
  chapterNo: number;      // 当前章节序号（用于排序/展示）
  completed: boolean;     // 是否通关/毕业
  count: number;          // 已完成项数（图鉴 或 挑战）
  countTotal: number;     // 总数（36 或 14）
  xp: number;
  badges: number;         // 徽章数
  badgeTotal: number;     // 7
  reward_claimed: boolean;
}

type ProgressSortKey = 'xp' | 'name' | 'class' | 'chapter' | 'count' | 'badges' | 'reward';

interface TypingRoomRow {
  id: string;
  table_no: number;
  status: string;
  player1_id: string | null;
  player2_id: string | null;
  p1_name: string | null;
  p2_name: string | null;
  p1_ready: boolean;
  p2_ready: boolean;
  p1_score: number;
  p2_score: number;
}

export function AppManager() {
  const { user } = useAuth();
  const [apps, setApps] = useState<App[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [appVisibility, setAppVisibility] = useState<AppVisibility[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('📚');
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  // 游戏进度查看（代码秘境 / Python魔法学院）
  const [progressApp, setProgressApp] = useState<App | null>(null);
  const [realmProgress, setRealmProgress] = useState<ProgressRow[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressClassFilter, setProgressClassFilter] = useState('all');
  const [progressSortKey, setProgressSortKey] = useState<ProgressSortKey>('xp');
  const [progressSortDir, setProgressSortDir] = useState<'asc' | 'desc'>('desc');
  // 键盘星域对战桌查看
  const [showTypingRooms, setShowTypingRooms] = useState(false);
  const [typingRooms, setTypingRooms] = useState<TypingRoomRow[]>([]);
  const [typingRoomsLoading, setTypingRoomsLoading] = useState(false);
  // 键盘星域历史对战记录
  const [showDuelHistory, setShowDuelHistory] = useState(false);
  const [duelHistory, setDuelHistory] = useState<any[]>([]);
  const [duelHistoryLoading, setDuelHistoryLoading] = useState(false);
  const [duelClassFilter, setDuelClassFilter] = useState('all');
  // 键盘星域双人对决奖励档位（动态行）
  const [rewardRows, setRewardRows] = useState<{ score: number; points: number; equipment_id: string }[]>([]);

  // 常用 emoji 图标选项
  const iconOptions = [
    '📚', '📖', '🎓', '✏️', '🖊️', '📝', '📐', '📊',
    '🧮', '🔢', '🎯', '💡', '🔬', '🌍', '🎨', '🎵',
    '🎮', '🎪', '🎭', '🏆', '⭐', '💎', '🎁', '🎉',
    '🎈', '🎨', '🎭', '🎪', '🎬', '🎤', '🎧', '🎹',
    '🎸', '🎺', '🎻', '🎼', '🎽', '🏀', '⚽', '🎾',
    '🏈', '⚾', '🎳', '🏆', '🏅', '🎖️', '🏵️', '🎗️',
    '🚀', '🛸', '🚁', '✈️', '🚂', '🚗', '🚕', '🚌',
    '🏠', '🏢', '🏬', '🏭', '🏪', '🏫', '🏥', '🏦',
    '🌱', '🌲', '🌳', '🌴', '🌵', '🌷', '🌸', '🌹',
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'
  ];

  const fetchApps = useCallback(async () => {
    try {
      const { data } = await backendClient.from('apps').select('*').order('created_at', { ascending: false });
      setApps(data as App[]);
    } catch (error) {
      console.error('Failed to fetch apps:', error);
    }
  }, []);

  const fetchClasses = useCallback(async () => {
    try {
      const { data } = await backendClient.from('classes').select('*').order('name', { ascending: true });
      setClasses(data as Class[]);
    } catch (error) {
      console.error('Failed to fetch classes:', error);
    }
  }, []);

  const fetchVisibility = useCallback(async () => {
    try {
      const { data } = await backendClient.from('app_visibility').select('*');
      setAppVisibility(data as AppVisibility[]);
    } catch (error) {
      console.error('Failed to fetch visibility:', error);
    }
  }, []);

  const fetchEquipments = useCallback(async () => {
    try {
      const { data } = await backendClient.get('/api/teacher/equipments');
      setEquipments(data || []);
    } catch (error) {
      console.error('Failed to fetch equipments:', error);
    }
  }, []);

  useEffect(() => {
    fetchApps();
    fetchClasses();
    fetchVisibility();
    fetchEquipments();
  }, [fetchApps, fetchClasses, fetchVisibility, fetchEquipments]);

  const handleSubmit = async (data: Partial<App>) => {
    const timestamp = Date.now().toString(36);
    const appId = editingApp?.id || `app_${timestamp}`;
    const appData = {
      ...data,
      id: appId,
      config: JSON.stringify(data.config || {}),
      external_url: data.external_url || '',
      iframe_enabled: data.iframe_enabled || false,
      created_by: user?.id
    };

    try {
      if (editingApp) {
        await backendClient.from('apps').update(appData).eq('id', editingApp.id);
      } else {
        await backendClient.from('apps').insert(appData);
      }

      // 更新可见性：不勾选任何班级 = 全部班级可见
      if (selectedClasses.length === 0) {
        for (const cls of classes) {
          const existing = appVisibility.find(v => v.app_id === appId && v.class_id === cls.id);
          if (existing) {
            await backendClient.from('app_visibility').update({ is_visible: true }).eq('id', existing.id);
          }
        }
      } else {
        for (const cls of classes) {
          const existing = appVisibility.find(v => v.app_id === appId && v.class_id === cls.id);
          const isVisible = selectedClasses.includes(cls.id);

          if (existing) {
            await backendClient.from('app_visibility').update({ is_visible: isVisible }).eq('id', existing.id);
          } else if (isVisible) {
            const visId = `av_${timestamp}_${cls.id.slice(-8)}`;
            await backendClient.from('app_visibility').insert({
              id: visId.length > 50 ? visId.slice(0, 50) : visId,
              app_id: appId,
              class_id: cls.id,
              is_visible: true
            });
          }
        }
      }

      setShowModal(false);
      setEditingApp(null);
      setSelectedClasses([]);
      fetchApps();
      fetchVisibility();
    } catch (error) {
      console.error('Failed to save app:', error);
      alert('保存失败，请查看控制台错误信息');
    }
  };

  const handleDelete = async (appId: string) => {
    if (!confirm('确定要删除这个应用吗？')) return;
    
    try {
      await backendClient.from('apps').delete().eq('id', appId);
      const { data } = await backendClient.from('app_visibility').select('*').eq('app_id', appId);
      if (data) {
        for (const vis of data as AppVisibility[]) {
          await backendClient.from('app_visibility').delete().eq('id', vis.id);
        }
      }
      fetchApps();
      fetchVisibility();
    } catch (error) {
      console.error('Failed to delete app:', error);
    }
  };

  const handleBatchDelete = async () => {
    if (!confirm(`确定要删除选中的 ${selectedApps.length} 个应用吗？`)) return;
    
    for (const appId of selectedApps) {
      await handleDelete(appId);
    }
    setSelectedApps([]);
  };

  const toggleClass = (classId: string) => {
    setSelectedClasses(prev =>
      prev.includes(classId) ? prev.filter(id => id !== classId) : [...prev, classId]
    );
  };

  const openEditModal = (app: App) => {
    setEditingApp(app);
    const rows = appVisibility.filter(v => v.app_id === app.id);
    // 全部可见（无隐藏记录）→ 默认全选所有班级；部分隐藏 → 只预选可见班级
    const visibleClasses = rows.some(v => !v.is_visible)
      ? rows.filter(v => v.is_visible).map(v => v.class_id)
      : classes.map(c => c.id);
    setSelectedClasses(visibleClasses);
    setSelectedIcon(app.icon || '📚');
    const cfg = getParsedConfig(app);
    setRewardRows(
      (Array.isArray(cfg.rewards) ? cfg.rewards : []).map((r: any) => ({
        score: parseInt(r.score) || 0,
        points: parseInt(r.points) || 0,
        equipment_id: r.equipment_id || '',
      }))
    );
    setShowModal(true);
  };

  const openCreateModal = () => {
    setEditingApp(null);
    setSelectedClasses(classes.map(c => c.id));
    setSelectedIcon('📚');
    setRewardRows([]);
    setShowModal(true);
  };

  // 查看游戏学生通关进度（代码秘境 / Python魔法学院）
  const openProgressModal = async (app: App) => {
    setProgressApp(app);
    setProgressLoading(true);
    setProgressError(null);
    setRealmProgress([]);
    setProgressClassFilter('all');
    setProgressSortKey('xp');
    setProgressSortDir('desc');
    try {
      const url = app.type === 'python_magic_academy'
        ? '/api/python-magic/teacher/progress'
        : '/api/code-realm/teacher/progress';
      const { data } = await backendClient.get(url);
      const rows: ProgressRow[] = (data || []).map((r: any) => {
        if (app.type === 'python_magic_academy') {
          return {
            user_id: r.user_id,
            name: r.real_name || r.username || '未知学生',
            class_name: r.class_name || '',
            chapterNo: r.current_chapter || 0,
            completed: r.current_step === 'completed' && r.current_chapter >= 7,
            count: Array.isArray(r.completed_challenges) ? r.completed_challenges.length : 0,
            countTotal: 14,
            xp: r.total_xp || 0,
            badges: Array.isArray(r.badges) ? r.badges.length : 0,
            badgeTotal: 7,
            reward_claimed: !!r.reward_claimed,
          };
        }
        return {
          user_id: r.user_id,
          name: r.real_name || r.username || '未知学生',
          class_name: r.class_name || '',
          chapterNo: r.current_chapter || 0,
          completed: r.current_step === 'completed',
          count: Array.isArray(r.completed_keywords) ? r.completed_keywords.length : 0,
          countTotal: 36,
          xp: r.total_xp || 0,
          badges: Array.isArray(r.badges) ? r.badges.length : 0,
          badgeTotal: 7,
          reward_claimed: !!r.reward_claimed,
        };
      });
      setRealmProgress(rows);
    } catch (error) {
      console.error('获取学生进度失败:', error);
      setProgressError('获取学生进度失败，请稍后重试');
    } finally {
      setProgressLoading(false);
    }
  };

  // 查看键盘星域对战桌状态
  const openTypingRooms = async () => {
    setShowTypingRooms(true);
    setTypingRoomsLoading(true);
    try {
      const { data } = await backendClient.get('/api/typing/teacher/rooms');
      setTypingRooms(data || []);
    } catch (error) {
      console.error('获取键盘星域对战桌失败:', error);
    } finally {
      setTypingRoomsLoading(false);
    }
  };

  // 查看键盘星域历史对战记录（可按班级筛选）
  const fetchDuelHistory = async (classId: string) => {
    setDuelHistoryLoading(true);
    try {
      const params = classId !== 'all' ? `?class_id=${encodeURIComponent(classId)}` : '';
      const { data } = await backendClient.get(`/api/typing/teacher/duels${params}`);
      setDuelHistory(data || []);
    } catch (error) {
      console.error('获取键盘星域对战记录失败:', error);
    } finally {
      setDuelHistoryLoading(false);
    }
  };
  const openDuelHistory = async () => {
    setShowDuelHistory(true);
    setDuelClassFilter('all');
    await fetchDuelHistory('all');
  };
  const changeDuelClassFilter = async (classId: string) => {
    setDuelClassFilter(classId);
    await fetchDuelHistory(classId);
  };

  // 解析 config 配置
  const getParsedConfig = (app: App) => {
    try {
      if (typeof app.config === 'string') {
        return JSON.parse(app.config);
      }
      return app.config || {};
    } catch {
      return {};
    }
  };

  const getVisibleClasses = (appId: string) => {
    const rows = appVisibility.filter(v => v.app_id === appId);
    // 没有隐藏记录 = 全部班级可见
    if (!rows.some(v => !v.is_visible)) return '全部班级';
    const visibleNames = rows
      .filter(v => v.is_visible)
      .map(v => classes.find(c => c.id === v.class_id)?.name)
      .filter(Boolean);
    return visibleNames.length > 0 ? visibleNames.join(', ') : '无（已全部隐藏）';
  };

  const filteredApps = apps.filter(app =>
    app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    app.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ===== 进度弹窗：班级筛选 + 字段排序 =====
  const isRealmGame = progressApp?.type === 'code_realm';
  const countLabel = isRealmGame ? '图鉴' : '挑战';
  const progressClasses = Array.from(new Set(realmProgress.map(r => r.class_name).filter(Boolean)));
  const filteredProgress = realmProgress.filter(r => progressClassFilter === 'all' || r.class_name === progressClassFilter);
  const sortedProgress = [...filteredProgress].sort((a, b) => {
    let cmp = 0;
    switch (progressSortKey) {
      case 'name': cmp = a.name.localeCompare(b.name, 'zh'); break;
      case 'class': cmp = a.class_name.localeCompare(b.class_name, 'zh'); break;
      case 'chapter': cmp = (a.completed ? 999 : a.chapterNo) - (b.completed ? 999 : b.chapterNo); break;
      case 'count': cmp = a.count - b.count; break;
      case 'xp': cmp = a.xp - b.xp; break;
      case 'badges': cmp = a.badges - b.badges; break;
      case 'reward': cmp = Number(a.reward_claimed) - Number(b.reward_claimed); break;
      default: cmp = 0;
    }
    return progressSortDir === 'asc' ? cmp : -cmp;
  });
  const toggleProgressSort = (key: ProgressSortKey) => {
    if (progressSortKey === key) {
      setProgressSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setProgressSortKey(key);
      setProgressSortDir('desc');
    }
  };
  const renderProgressTh = (key: ProgressSortKey, label: string) => (
    <th className="py-2 pr-4 whitespace-nowrap">
      <button
        type="button"
        onClick={() => toggleProgressSort(key)}
        className={`inline-flex items-center gap-1 font-medium transition-colors ${progressSortKey === key ? 'text-indigo-600' : 'hover:text-indigo-600'}`}
      >
        {label}
        {progressSortKey === key && (
          <span className="text-[10px]">{progressSortDir === 'asc' ? '▲' : '▼'}</span>
        )}
      </button>
    </th>
  );

  return (
    <LicenseGuard featureName="应用管理" featureIcon="fa-th-large">
      <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">应用管理</h2>
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="搜索应用..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg"
          />
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            + 创建应用
          </button>
        </div>
      </div>

      {selectedApps.length > 0 && (
        <div className="mb-4 flex items-center gap-4 p-4 bg-red-50 rounded-lg">
          <span className="text-red-700 font-medium">已选择 {selectedApps.length} 个应用</span>
          <button
            onClick={handleBatchDelete}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            批量删除
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredApps.map(app => (
          <div
            key={app.id}
            className={`p-6 border rounded-xl transition-all ${
              selectedApps.includes(app.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-4">
              <input
                type="checkbox"
                checked={selectedApps.includes(app.id)}
                onChange={(e) => setSelectedApps(prev =>
                  e.target.checked ? [...prev, app.id] : prev.filter(id => id !== app.id)
                )}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{app.icon || '📦'}</span>
                  <h3 className="text-lg font-semibold text-gray-800">{app.name}</h3>
                </div>
                
                <p className="text-gray-600 text-sm mb-3">{app.description}</p>
                
                <div className="flex flex-wrap gap-2 mb-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        app.price_type === 'free' ? 'bg-green-100 text-green-700' :
                        app.price_type === 'per_use' ? 'bg-orange-100 text-orange-700' : 
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {app.price_type === 'free' ? '免费' :
                         app.price_type === 'per_use' ? `${app.points_price} 积分/次` : 
                         `${app.points_price} 积分`}
                      </span>
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {appTypes.find(t => t.value === app.type)?.label || app.type}
                      </span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        app.is_active ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {app.is_active ? '已上架' : '已下架'}
                      </span>
                    </div>

                <div className="text-sm text-gray-500 mb-3">
                  可见班级: {getVisibleClasses(app.id)}
                </div>

                {app.type === 'learning_tool' && app.config && (
                  <div className="text-xs text-gray-500">
                    <div>单词范围: {getParsedConfig(app)?.wordRange || '全部'}</div>
                    <div>每日目标: {getParsedConfig(app)?.dailyGoal || 20} 个</div>
                  </div>
                )}
                {app.type === 'ai_qa' && app.config && (
                  <div className="text-xs text-gray-500">
                    <div>🧠 AI 答疑</div>
                    <div>每次提问: {getParsedConfig(app)?.pointsPerQuestion || 5} 积分</div>
                    <div>学科: {getParsedConfig(app)?.subjectScope || '全部'}</div>
                  </div>
                )}
                {app.type === 'external_link' && app.external_url && (
                  <div className="text-xs text-gray-500">
                    <div>链接: {app.external_url}</div>
                    {app.iframe_enabled && <div>✅ 嵌入显示</div>}
                  </div>
                )}
                {app.type === 'html_page' && (
                  <div className="text-xs text-gray-500">
                    <div>📄 HTML 网页应用</div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => openEditModal(app)}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(app.id)}
                    className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                  >
                    删除
                  </button>
                  {(app.type === 'code_realm' || app.type === 'python_magic_academy') && (
                    <button
                      onClick={() => openProgressModal(app)}
                      className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200"
                    >
                      查看进度
                    </button>
                  )}
                  {app.type === 'typing_trainer' && (
                    <button
                      onClick={openTypingRooms}
                      className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200"
                    >
                      查看对战桌
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      await backendClient.from('apps').update({ is_active: !app.is_active }).eq('id', app.id);
                      fetchApps();
                    }}
                    className={`px-3 py-1 text-sm rounded-lg ${
                      app.is_active ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {app.is_active ? '下架' : '上架'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold">
                {editingApp ? '编辑应用' : '创建应用'}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingApp(null);
                  setSelectedClasses([]);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const appType = formData.get('type') as App['type'];
              
              let config: Record<string, unknown> = {};
              
              if (appType === 'learning_tool') {
                config = {
                  wordRange: formData.get('wordRange') as string,
                  dailyGoal: parseInt(formData.get('dailyGoal') as string) || 20
                };
              } else if (appType === 'html_page') {
                config = {
                  htmlContent: formData.get('htmlContent') as string
                };
              } else if (appType === 'ai_qa') {
                const suggestedRaw = formData.get('suggestedQuestions') as string || '';
                const suggestedQuestions = suggestedRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                config = {
                  pointsPerQuestion: parseInt(formData.get('pointsPerQuestion') as string) || 5,
                  subjectScope: formData.get('subjectScope') as string,
                  difficulty: formData.get('difficulty') as string,
                  answerLength: formData.get('answerLength') as string,
                  codeCheckEnabled: formData.get('codeCheckEnabled') === 'on',
                  codeRunEnabled: formData.get('codeRunEnabled') === 'on',
                  autoMatchExam: formData.get('autoMatchExam') === 'on',
                  examPointPush: formData.get('examPointPush') === 'on',
                  systemPrompt: formData.get('systemPrompt') as string,
                  suggestedQuestions
                };
              } else if (appType === 'mental_health') {
                config = {
                  alertSensitivity: formData.get('alertSensitivity') as string || 'medium',
                  isFree: formData.get('isFree') === 'true',
                  systemPrompt: formData.get('systemPrompt') as string
                };
              } else if (appType === 'python_magic_academy' || appType === 'code_realm') {
                config = {
                  chapters: 7,
                  aiAssistant: true,
                  xpSystem: true,
                  badgeSystem: true,
                  keywordCount: appType === 'code_realm' ? 36 : undefined,
                  reward_enabled: formData.get('reward_enabled') === 'on',
                  points_reward: parseInt(formData.get('points_reward') as string) || 100,
                  equipment_id: formData.get('equipment_id') as string || ''
                };
              } else if (appType === 'typing_trainer') {
                config = {
                  tables: parseInt(formData.get('tables') as string) || 6,
                  difficulty: formData.get('difficulty') as string || 'standard',
                  duel_seconds: parseInt(formData.get('duel_seconds') as string) || 180,
                  duel_speed: parseInt(formData.get('duel_speed') as string) || 85,
                  duel_spawn_ms: parseInt(formData.get('duel_spawn_ms') as string) || 1800,
                  duel_step_pct: parseInt(formData.get('duel_step_pct') as string) || 20,
                  duel_min_wpm: parseInt(formData.get('duel_min_wpm') as string) || 0,
                  duel_entry_fee: parseInt(formData.get('duel_entry_fee') as string) || 0,
                  single_reward: {
                    wpm: parseInt(formData.get('single_reward_wpm') as string) || 0,
                    points: parseInt(formData.get('single_reward_points') as string) || 0,
                  },
                  rewards: rewardRows.filter(r => (r.score > 0 && (r.points > 0 || r.equipment_id)))
                };
              }
              
              const data: Partial<App> = {
                name: formData.get('name') as string,
                description: formData.get('description') as string,
                icon: selectedIcon,
                type: appType,
                price_type: formData.get('price_type') as App['price_type'],
                points_price: parseInt(formData.get('points_price') as string) || 0,
                category: formData.get('category') as string,
                is_active: formData.get('is_active') === 'on',
                is_marketplace: formData.get('is_marketplace') === 'on',
                external_url: formData.get('external_url') as string,
                iframe_enabled: formData.get('iframe_enabled') === 'on',
                config
              };
              handleSubmit(data);
            }}>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    应用名称 *
                  </label>
                  <input
                    type="text"
                    name="name"
                    defaultValue={editingApp?.name}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    应用图标
                  </label>
                  <div className="flex gap-2 flex-wrap p-2 border border-gray-300 rounded-lg max-h-32 overflow-y-auto">
                    {iconOptions.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setSelectedIcon(icon)}
                        className={`text-2xl p-1 rounded cursor-pointer transition-all ${
                          selectedIcon === icon
                            ? 'ring-2 ring-blue-500 bg-blue-100'
                            : 'hover:bg-gray-100'
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    已选择: <span className="text-xl">{selectedIcon}</span>
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  应用描述
                </label>
                <textarea
                  name="description"
                  defaultValue={editingApp?.description}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    应用类型 *
                  </label>
                  <select
                    name="type"
                    defaultValue={editingApp?.type || 'learning_tool'}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {appTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    分类
                  </label>
                  <input
                    type="text"
                    name="category"
                    defaultValue={editingApp?.category}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    价格类型 *
                  </label>
                  <select
                    name="price_type"
                    defaultValue={editingApp?.price_type || 'free'}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="free">免费</option>
                    <option value="points">积分兑换</option>
                    <option value="per_use">按次收费</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    积分价格
                  </label>
                  <input
                    type="number"
                    name="points_price"
                    defaultValue={editingApp?.points_price || 0}
                    min="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    根据价格类型：积分兑换 = 一次性，按次收费 = 每次使用扣积分
                  </p>
                </div>
              </div>

              {(() => {
                const currentType = editingApp?.type || 'learning_tool';
                const config = editingApp ? getParsedConfig(editingApp) : {};
                
                if (currentType === 'learning_tool') {
                  return (
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          单词范围
                        </label>
                        <select
                          name="wordRange"
                          defaultValue={config.wordRange || 'all'}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        >
                          <option value="all">全部单词</option>
                          <option value="easy">简单单词</option>
                          <option value="medium">中等单词</option>
                          <option value="hard">困难单词</option>
                          <option value="easy-medium">简单+中等</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          每日目标（单词数）
                        </label>
                        <input
                          type="number"
                          name="dailyGoal"
                          defaultValue={config.dailyGoal || 20}
                          min="1"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                    </div>
                  );
                } else if (currentType === 'ai_qa') {
                  return (
                    <div className="space-y-4 mb-4">
                      <h4 className="font-medium text-gray-800">AI 答疑配置</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            每次提问消耗积分
                          </label>
                          <input
                            type="number"
                            name="pointsPerQuestion"
                            defaultValue={config.pointsPerQuestion || 5}
                            min="1"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            学科范围
                          </label>
                          <select
                            name="subjectScope"
                            defaultValue={config.subjectScope || 'information_tech,python'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="information_tech,python">信息技术 + Python</option>
                            <option value="information_tech">仅信息技术</option>
                            <option value="python">仅 Python</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            回答难度
                          </label>
                          <select
                            name="difficulty"
                            defaultValue={config.difficulty || 'high_school_basic'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="high_school_basic">高中基础</option>
                            <option value="exam_prep">学考冲刺</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            回答长度
                          </label>
                          <select
                            name="answerLength"
                            defaultValue={config.answerLength || 'concise'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="concise">简洁版</option>
                            <option value="detailed">详细版</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="codeCheckEnabled"
                            defaultChecked={config.codeCheckEnabled !== false}
                            className="rounded"
                          />
                          <span className="text-sm text-gray-700">启用代码纠错</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="codeRunEnabled"
                            defaultChecked={config.codeRunEnabled !== false}
                            className="rounded"
                          />
                          <span className="text-sm text-gray-700">启用代码运行</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="autoMatchExam"
                            defaultChecked={config.autoMatchExam !== false}
                            className="rounded"
                          />
                          <span className="text-sm text-gray-700">自动匹配学考真题</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="examPointPush"
                            defaultChecked={config.examPointPush !== false}
                            className="rounded"
                          />
                          <span className="text-sm text-gray-700">推送相关考点</span>
                        </label>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          系统提示词（可选）
                        </label>
                        <textarea
                          name="systemPrompt"
                          defaultValue={config.systemPrompt || ''}
                          rows={4}
                          placeholder="为 AI 设置自定义的系统提示词，控制其回答风格和范围"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          留空则使用默认的江苏省高中信息技术答疑老师提示词
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          预置问题（欢迎页展示）
                        </label>
                        <textarea
                          name="suggestedQuestions"
                          defaultValue={config.suggestedQuestions ? (Array.isArray(config.suggestedQuestions) ? config.suggestedQuestions.join('\n') : config.suggestedQuestions) : '什么是二进制？\nPython中for循环怎么用？\n什么是递归？\n列表和元组有什么区别？\n什么是面向对象编程？\nPython中字典怎么用？'}
                          rows={6}
                          placeholder="每行一个问题，打开AI答疑时随机抽取4个展示"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          每行一个问题，学生打开AI答疑时随机抽取4个展示在欢迎页
                        </p>
                      </div>
                    </div>
                  );
                } else if (currentType === 'mental_health') {
                  return (
                    <div className="space-y-4 mb-4">
                      <h4 className="font-medium text-gray-800">心理健康应用配置</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            预警敏感度
                          </label>
                          <select
                            name="alertSensitivity"
                            defaultValue={config.alertSensitivity || 'medium'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="low">低</option>
                            <option value="medium">中</option>
                            <option value="high">高</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            是否免费
                          </label>
                          <select
                            name="isFree"
                            defaultValue={config.isFree !== undefined ? String(config.isFree) : 'true'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="true">是（免费）</option>
                            <option value="false">否</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          系统提示词（可选）
                        </label>
                        <textarea
                          name="systemPrompt"
                          defaultValue={config.systemPrompt || ''}
                          rows={4}
                          placeholder="为AI设置自定义的系统提示词"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          留空则使用默认的心理健康咨询师提示词
                        </p>
                      </div>
                    </div>
                  );
                } else if (currentType === 'external_link') {
                  return (
                    <div className="mb-4">
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          外部链接地址 *
                        </label>
                        <input
                          type="url"
                          name="external_url"
                          defaultValue={editingApp?.external_url || ''}
                          placeholder="https://example.com"
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="iframe_enabled"
                          defaultChecked={editingApp?.iframe_enabled ?? false}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-700">在应用中嵌入显示（iframe）</span>
                      </label>
                    </div>
                  );
                } else if (currentType === 'html_page') {
                  return (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        HTML 内容
                      </label>
                      <textarea
                        name="htmlContent"
                        defaultValue={config.htmlContent || ''}
                        placeholder="<html><body><h1>你的内容</h1></body></html>"
                        rows={10}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        可以直接输入完整的 HTML 代码，包括 CSS 和 JavaScript
                      </p>
                    </div>
                  );
                } else if (currentType === 'python_magic_academy' || currentType === 'code_realm') {
                  const gameLabel = currentType === 'code_realm' ? '代码秘境（7大秘境36考点）' : 'Python魔法学院（7大章节）';
                  return (
                    <div className="space-y-4 mb-4">
                      <h4 className="font-medium text-gray-800">通关奖励配置</h4>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="reward_enabled"
                          defaultChecked={config.reward_enabled !== false}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-700">启用通关奖励</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            积分奖励
                          </label>
                          <input
                            type="number"
                            name="points_reward"
                            defaultValue={config.points_reward || 100}
                            min="0"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            学生通关{gameLabel}后获得的积分数量
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            装备奖励（可选）
                          </label>
                          <select
                            name="equipment_id"
                            defaultValue={config.equipment_id || ''}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="">不发放装备</option>
                            {equipments.map(eq => (
                              <option key={eq.id} value={eq.id}>
                                {eq.icon} {eq.name} (暴击加成 +{eq.crit_bonus}%)
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            从打怪系统的装备中选择一件作为奖励
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                } else if (currentType === 'typing_trainer') {
                  return (
                    <div className="space-y-4 mb-4">
                      <h4 className="font-medium text-gray-800">键盘星域配置</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            双人对战桌子数量
                          </label>
                          <input
                            type="number"
                            name="tables"
                            defaultValue={config.tables || 6}
                            min="1"
                            max="50"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            双人大厅显示的桌子数，每桌 2 个座位
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            单人游戏默认难度
                          </label>
                          <select
                            name="difficulty"
                            defaultValue={config.difficulty || 'standard'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="easy">轻松</option>
                            <option value="standard">标准</option>
                            <option value="extreme">极限</option>
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            作为单人 5 关的速度/密度基准档
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            双人对局时长（秒）
                          </label>
                          <input
                            type="number"
                            name="duel_seconds"
                            defaultValue={config.duel_seconds || 180}
                            min="60"
                            max="600"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            每局时长，时间到无人死亡则按分数判定，平分比 WPM
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            入座门槛 WPM
                          </label>
                          <input
                            type="number"
                            name="duel_min_wpm"
                            defaultValue={config.duel_min_wpm ?? 0}
                            min="0"
                            max="300"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            单人模式最高打字速度达到该值才可入座（0 表示不限）
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            双人基础速度（px/s）
                          </label>
                          <input
                            type="number"
                            name="duel_speed"
                            defaultValue={config.duel_speed || 85}
                            min="30"
                            max="300"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            开局 30 秒内的下落速度
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            双人基础生成间隔（毫秒）
                          </label>
                          <input
                            type="number"
                            name="duel_spawn_ms"
                            defaultValue={config.duel_spawn_ms || 1800}
                            min="500"
                            max="5000"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            开局 30 秒内新词出现的间隔，越小密度越大
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            每 30 秒增幅（%）
                          </label>
                          <input
                            type="number"
                            name="duel_step_pct"
                            defaultValue={config.duel_step_pct ?? 20}
                            min="0"
                            max="100"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            每过 30 秒，速度与密度（1/间隔）按该百分比提升
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            双人对局门票（积分/人/局）
                          </label>
                          <input
                            type="number"
                            name="duel_entry_fee"
                            defaultValue={config.duel_entry_fee ?? 0}
                            min="0"
                            max="10000"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            每局每位玩家扣除的积分，双方同意开赛时自动扣除（0 表示免费）
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            单人达标速度（WPM）
                          </label>
                          <input
                            type="number"
                            name="single_reward_wpm"
                            defaultValue={config.single_reward?.wpm ?? 0}
                            min="0"
                            max="300"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            单人游戏本局打字速度达到该值，发放下方奖励（0 表示不启用）
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            单人达标积分奖励
                          </label>
                          <input
                            type="number"
                            name="single_reward_points"
                            defaultValue={config.single_reward?.points ?? 0}
                            min="0"
                            max="10000"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            达标后奖励的积分，同时获得「运指如飞」荣誉与暴击 Buff
                          </p>
                        </div>
                      </div>

                      {/* 双人对决奖励档位 */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700">
                            双人对决奖励档位
                          </label>
                          <button
                            type="button"
                            onClick={() => setRewardRows([...rewardRows, { score: 0, points: 0, equipment_id: '' }])}
                            className="px-2.5 py-1 rounded-lg text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                          >
                            <i className="fa-solid fa-plus mr-1"></i>添加档位
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">
                          对局得分达到档位阈值即发放奖励（积分/装备，可叠加）。未达标时结算页会显示条件。
                        </p>
                        {rewardRows.length === 0 && (
                          <p className="text-xs text-gray-400">暂无奖励档位</p>
                        )}
                        <div className="space-y-2">
                          {rewardRows.map((row, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <div className="flex-1">
                                <label className="block text-[10px] text-gray-500">得分 ≥</label>
                                <input
                                  type="number"
                                  min="0"
                                  value={row.score || ''}
                                  onChange={e => {
                                    const rows = [...rewardRows];
                                    rows[idx] = { ...rows[idx], score: parseInt(e.target.value) || 0 };
                                    setRewardRows(rows);
                                  }}
                                  placeholder="100"
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="block text-[10px] text-gray-500">积分</label>
                                <input
                                  type="number"
                                  min="0"
                                  value={row.points || ''}
                                  onChange={e => {
                                    const rows = [...rewardRows];
                                    rows[idx] = { ...rows[idx], points: parseInt(e.target.value) || 0 };
                                    setRewardRows(rows);
                                  }}
                                  placeholder="20"
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="block text-[10px] text-gray-500">装备（可选）</label>
                                <select
                                  value={row.equipment_id}
                                  onChange={e => {
                                    const rows = [...rewardRows];
                                    rows[idx] = { ...rows[idx], equipment_id: e.target.value };
                                    setRewardRows(rows);
                                  }}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                                >
                                  <option value="">不发放装备</option>
                                  {equipments.map(eq => (
                                    <option key={eq.id} value={eq.id}>
                                      {eq.icon} {eq.name} (暴击 +{eq.crit_bonus}%)
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <button
                                type="button"
                                onClick={() => setRewardRows(rewardRows.filter((_, i) => i !== idx))}
                                className="px-2 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 transition-colors"
                                title="删除档位"
                              >
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={editingApp?.is_active ?? true}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">上架应用</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="is_marketplace"
                    defaultChecked={editingApp?.is_marketplace ?? true}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">显示在应用市场</span>
                </label>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  可见班级
                </label>
                <div className="flex flex-wrap gap-2">
                  {classes.map(cls => (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => toggleClass(cls.id)}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                        selectedClasses.includes(cls.id)
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {cls.name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-amber-600 mt-2">
                  💡 一个都不勾选 = 全部班级可见；勾选部分班级时，未勾选的班级将被隐藏
                </p>
              </div>

              <div className="flex justify-end gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingApp(null);
                    setSelectedClasses([]);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  {editingApp ? '保存修改' : '创建应用'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {progressApp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold">
                {progressApp.icon} {progressApp.name} · 学生通关进度
              </h3>
              <button
                onClick={() => setProgressApp(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            {progressLoading && <p className="text-gray-500 text-center py-8">加载中...</p>}
            {progressError && <p className="text-red-500 text-center py-8">{progressError}</p>}

            {!progressLoading && !progressError && (
              realmProgress.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  暂无学生游玩记录，学生开始游戏后进度会自动上报
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <label className="text-sm text-gray-500">班级筛选</label>
                    <select
                      value={progressClassFilter}
                      onChange={(e) => setProgressClassFilter(e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="all">全部班级（{realmProgress.length} 人）</option>
                      {progressClasses.map(c => (
                        <option key={c} value={c}>
                          {c}（{realmProgress.filter(r => r.class_name === c).length} 人）
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-400">当前显示 {sortedProgress.length} 人 · 点击表头可排序</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-left text-gray-500">
                          {renderProgressTh('name', '学生')}
                          {renderProgressTh('class', '班级')}
                          {renderProgressTh('chapter', '进度')}
                          {renderProgressTh('count', countLabel)}
                          {renderProgressTh('xp', '经验')}
                          {renderProgressTh('badges', '徽章')}
                          {renderProgressTh('reward', '奖励')}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedProgress.map(row => (
                          <tr key={row.user_id} className="border-b border-gray-100">
                            <td className="py-2 pr-4 font-medium whitespace-nowrap">{row.name}</td>
                            <td className="py-2 pr-4">{row.class_name || '-'}</td>
                            <td className="py-2 pr-4 whitespace-nowrap">
                              {row.completed
                                ? '🏆 已通关'
                                : `第 ${Math.min(Math.max(row.chapterNo, 1), 7)} 章`}
                            </td>
                            <td className="py-2 pr-4">
                              <span className="inline-flex items-center gap-1">
                                <span className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                  <span
                                    className={`block h-full rounded-full ${row.completed ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                    style={{ width: `${row.countTotal ? Math.min((row.count / row.countTotal) * 100, 100) : 0}%` }}
                                  ></span>
                                </span>
                                {row.count} / {row.countTotal}
                              </span>
                            </td>
                            <td className="py-2 pr-4">{row.xp}</td>
                            <td className="py-2 pr-4">{row.badges} / {row.badgeTotal}</td>
                            <td className="py-2">
                              {row.completed
                                ? (row.reward_claimed ? '✅ 已发放' : '⏳ 待发放')
                                : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}

      {showTypingRooms && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold">⌨️ 键盘星域 · 对战桌状态</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={openDuelHistory}
                  className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                >
                  🕘 历史对战记录
                </button>
                <button onClick={() => setShowTypingRooms(false)} className="text-gray-500 hover:text-gray-700">✕</button>
              </div>
            </div>
            {typingRoomsLoading ? (
              <p className="text-gray-500 text-center py-8">加载中...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 pr-4">桌子</th>
                    <th className="py-2 pr-4">左座</th>
                    <th className="py-2 pr-4">右座</th>
                    <th className="py-2 pr-4">状态</th>
                    <th className="py-2">比分</th>
                  </tr>
                </thead>
                <tbody>
                  {typingRooms.map(r => (
                    <tr key={r.id} className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-medium">#{r.table_no}</td>
                      <td className="py-2 pr-4">{r.player1_id ? (r.p1_name || '玩家') : '-'}</td>
                      <td className="py-2 pr-4">{r.player2_id ? (r.p2_name || '玩家') : '-'}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          r.status === 'playing' ? 'bg-red-100 text-red-700'
                          : r.status === 'ready' ? 'bg-amber-100 text-amber-700'
                          : r.status === 'waiting' ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          {{ idle: '空闲', waiting: '等待对手', ready: '双方就绪', playing: '🔥 比赛中', finished: '已结束' }[r.status] || r.status}
                        </span>
                      </td>
                      <td className="py-2">
                        {r.status === 'playing' ? `${r.p1_score} : ${r.p2_score}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {showDuelHistory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">🕘 键盘星域 · 历史对战记录</h3>
              <div className="flex items-center gap-3">
                <select
                  value={duelClassFilter}
                  onChange={(e) => changeDuelClassFilter(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                >
                  <option value="all">全部班级</option>
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button onClick={() => setShowDuelHistory(false)} className="text-gray-500 hover:text-gray-700">✕</button>
              </div>
            </div>
            {duelHistoryLoading ? (
              <p className="text-gray-500 text-center py-8">加载中...</p>
            ) : duelHistory.length === 0 ? (
              <p className="text-gray-500 text-center py-8">暂无对战记录</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 pr-4">桌子</th>
                    <th className="py-2 pr-4">对战双方</th>
                    <th className="py-2 pr-4">比分</th>
                    <th className="py-2">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {duelHistory.map(d => (
                    <tr key={d.id} className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-medium">{d.table_no ? `#${d.table_no}` : '—'}</td>
                      <td className="py-2 pr-4">
                        <span className="font-medium text-gray-800">{d.p1_name || d.p1_username || '玩家'}</span>
                        <span className="text-gray-400 mx-1">vs</span>
                        <span className="font-medium text-gray-800">{d.p2_name || d.p2_username || '玩家'}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="font-mono font-bold text-emerald-600">{d.p1_score}</span>
                        <span className="text-gray-400 mx-1">:</span>
                        <span className="font-mono font-bold text-red-500">{d.p2_score}</span>
                      </td>
                      <td className="py-2 text-gray-500">
                        {d.created_at ? String(d.created_at).replace('T', ' ').slice(0, 19) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
    </LicenseGuard>
  );
}
