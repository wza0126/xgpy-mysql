import React, { useState, useEffect, useCallback } from 'react';
import { backendClient } from '../../api/backendClient';
import { useAuth } from '../../hooks/useAuth';
import { LicenseGuard } from '../common/LicenseGuard';

interface App {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: 'learning_tool' | 'coding_practice' | 'game' | 'simulation' | 'external_link' | 'html_page' | 'ai_qa';
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
  { value: 'python_magic_academy', label: 'Python魔法学院' }
];

interface Equipment {
  id: string;
  name: string;
  icon: string;
  drop_rate: number;
  crit_bonus: number;
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

      // 更新可见性
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
    const visibleClasses = appVisibility
      .filter(v => v.app_id === app.id && v.is_visible)
      .map(v => v.class_id);
    setSelectedClasses(visibleClasses);
    setSelectedIcon(app.icon || '📚');
    setShowModal(true);
  };

  const openCreateModal = () => {
    setEditingApp(null);
    setSelectedClasses(classes.map(c => c.id));
    setSelectedIcon('📚');
    setShowModal(true);
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
    return appVisibility
      .filter(v => v.app_id === appId && v.is_visible)
      .map(v => classes.find(c => c.id === v.class_id)?.name)
      .join(', ') || '全部班级';
  };

  const filteredApps = apps.filter(app =>
    app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    app.description.toLowerCase().includes(searchTerm.toLowerCase())
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
              } else if (appType === 'python_magic_academy') {
                config = {
                  chapters: 7,
                  aiAssistant: true,
                  xpSystem: true,
                  badgeSystem: true,
                  reward_enabled: formData.get('reward_enabled') === 'on',
                  points_reward: parseInt(formData.get('points_reward') as string) || 100,
                  equipment_id: formData.get('equipment_id') as string || ''
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
                } else if (currentType === 'python_magic_academy') {
                  return (
                    <div className="space-y-4 mb-4">
                      <h4 className="font-medium text-gray-800">毕业奖励配置</h4>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="reward_enabled"
                          defaultChecked={config.reward_enabled !== false}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-700">启用毕业奖励</span>
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
                            学生完成7章后获得的积分数量
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
    </div>
    </LicenseGuard>
  );
}
