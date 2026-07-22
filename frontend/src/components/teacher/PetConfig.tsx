import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';
import { Pet, PetFood, PetTip, Class } from '../../types';
import { LicenseGuard } from '../common/LicenseGuard';

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
  focus_mode_quick_access: string[];
  focus_mode_classes: string[];
}

interface PetConfigState {
  tip_interval_seconds: number;
  tip_display_seconds: number;
  double_click_aiqa: boolean;
  focus_mode: FocusModeConfig;
  level_base_threshold: number;
  level_threshold_increment: number;
  max_stage: number;
}

export const PetConfig: React.FC = () => {
  const [pets, setPets] = useState<Pet[]>([]);
  const [foods, setFoods] = useState<PetFood[]>([]);
  const [tips, setTips] = useState<PetTip[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [petConfig, setPetConfig] = useState<PetConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pets' | 'foods' | 'tips' | 'config'>('pets');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'pet' | 'food' | 'tip'>('pet');
  const [formData, setFormData] = useState<any>({});
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const [{ data: petsData }, { data: foodsData }, { data: tipsData }, { data: configData }, { data: classesData }] = await Promise.all([
      backendClient.from('pets').select('*'),
      backendClient.from('pet_foods').select('*'),
      backendClient.from('pet_tips').select('*'),
      backendClient.from('pet_config').select('*').maybeSingle(),
      backendClient.from('classes').select('*'),
    ]);

    if (petsData) setPets(petsData as Pet[]);
    if (foodsData) setFoods(foodsData as PetFood[]);
    if (tipsData) setTips(tipsData as PetTip[]);
    if (classesData) setClasses(classesData as Class[]);
    
    if (configData) {
      const quickAccess = configData.focus_mode_quick_access 
        ? (typeof configData.focus_mode_quick_access === 'string' 
            ? JSON.parse(configData.focus_mode_quick_access) 
            : configData.focus_mode_quick_access)
        : ['apps', 'ai_qa', 'notebook'];
      
      const focusClasses = configData.focus_mode_classes
        ? (typeof configData.focus_mode_classes === 'string'
            ? JSON.parse(configData.focus_mode_classes)
            : configData.focus_mode_classes)
        : [];
      
      const toBool = (v: any) => v !== false && v !== 0 && v !== '0' && v !== null && v !== undefined;

      setPetConfig({
        tip_interval_seconds: configData.tip_interval_seconds || 30,
        tip_display_seconds: configData.tip_display_seconds || 5,
        double_click_aiqa: configData.double_click_aiqa !== false && configData.double_click_aiqa !== 0 && configData.double_click_aiqa !== '0',
        level_base_threshold: configData.level_base_threshold || 50,
        level_threshold_increment: configData.level_threshold_increment || 50,
        max_stage: configData.max_stage || 5,
        focus_mode: {
          focus_mode_enabled: configData.focus_mode_enabled === true || configData.focus_mode_enabled === 1 || configData.focus_mode_enabled === '1',
          focus_mode_show_learn: toBool(configData.focus_mode_show_learn),
          focus_mode_show_practice: toBool(configData.focus_mode_show_practice),
          focus_mode_show_test: toBool(configData.focus_mode_show_test),
          focus_mode_show_wrong: toBool(configData.focus_mode_show_wrong),
          focus_mode_show_notebook: toBool(configData.focus_mode_show_notebook),
          focus_mode_show_python: toBool(configData.focus_mode_show_python),
          focus_mode_show_apps: toBool(configData.focus_mode_show_apps),
          focus_mode_show_pet: toBool(configData.focus_mode_show_pet),
          focus_mode_show_exchange: toBool(configData.focus_mode_show_exchange),
          focus_mode_show_leaderboard: toBool(configData.focus_mode_show_leaderboard),
          focus_mode_show_profile: toBool(configData.focus_mode_show_profile),
          focus_mode_show_security: toBool(configData.focus_mode_show_security),
          focus_mode_show_proxyBrowser: toBool(configData.focus_mode_show_proxyBrowser),
          focus_mode_quick_access: quickAccess,
          focus_mode_classes: focusClasses,
        },
      });
    } else {
      setPetConfig({
        tip_interval_seconds: 30,
        tip_display_seconds: 5,
        double_click_aiqa: true,
        level_base_threshold: 50,
        level_threshold_increment: 50,
        max_stage: 5,
        focus_mode: {
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
          focus_mode_quick_access: ['apps', 'ai_qa', 'notebook'],
          focus_mode_classes: [],
        },
      });
    }
    setLoading(false);
  };

  const handleSaveConfig = async () => {
    if (!petConfig) return;
    try {
      const { data: existing } = await backendClient.from('pet_config').select('id').maybeSingle();

      const updateData = {
        tip_interval_seconds: petConfig.tip_interval_seconds,
        tip_display_seconds: petConfig.tip_display_seconds,
        double_click_aiqa: petConfig.double_click_aiqa,
        level_base_threshold: petConfig.level_base_threshold,
        level_threshold_increment: petConfig.level_threshold_increment,
        max_stage: petConfig.max_stage,
        focus_mode_enabled: petConfig.focus_mode.focus_mode_enabled,
        focus_mode_show_learn: petConfig.focus_mode.focus_mode_show_learn,
        focus_mode_show_practice: petConfig.focus_mode.focus_mode_show_practice,
        focus_mode_show_test: petConfig.focus_mode.focus_mode_show_test,
        focus_mode_show_wrong: petConfig.focus_mode.focus_mode_show_wrong,
        focus_mode_show_notebook: petConfig.focus_mode.focus_mode_show_notebook,
        focus_mode_show_python: petConfig.focus_mode.focus_mode_show_python,
        focus_mode_show_apps: petConfig.focus_mode.focus_mode_show_apps,
        focus_mode_show_pet: petConfig.focus_mode.focus_mode_show_pet,
        focus_mode_show_exchange: petConfig.focus_mode.focus_mode_show_exchange,
        focus_mode_show_leaderboard: petConfig.focus_mode.focus_mode_show_leaderboard,
        focus_mode_show_profile: petConfig.focus_mode.focus_mode_show_profile,
        focus_mode_show_security: petConfig.focus_mode.focus_mode_show_security,
        focus_mode_show_proxyBrowser: petConfig.focus_mode.focus_mode_show_proxyBrowser,
        focus_mode_quick_access: JSON.stringify(petConfig.focus_mode.focus_mode_quick_access),
        focus_mode_classes: JSON.stringify(petConfig.focus_mode.focus_mode_classes),
      };

      console.log('保存萌宠配置:', updateData);

      let result;
      if (existing) {
        result = await backendClient.from('pet_config').update(updateData).eq('id', existing.id);
      } else {
        result = await backendClient.from('pet_config').insert(updateData);
      }

      console.log('保存结果:', result);

      if (result && result.error) {
        console.error('保存失败:', result.error);
        alert('保存失败: ' + result.error);
        return;
      }

      await fetchData();
      alert('配置已保存');
    } catch (error) {
      console.error('保存配置异常:', error);
      alert('保存失败: ' + (error as Error).message);
    }
  };

  const handleSave = async () => {
    const table = modalType === 'pet' ? 'pets' : modalType === 'food' ? 'pet_foods' : 'pet_tips';

    if (formData.id) {
      await backendClient.from(table).update(formData).eq('id', formData.id);
    } else {
      await backendClient.from(table).insert(formData);
    }

    setShowModal(false);
    setFormData({});
    fetchData();
  };

  const handleImageUpload = async (level: number, file: File) => {
    if (!formData.id) {
      alert('请先保存萌宠基本信息');
      return;
    }

    setUploading(true);

    try {
      const formDataUpload = new FormData();
      formDataUpload.append('image', file);
      formDataUpload.append('pet_id', formData.id);
      formDataUpload.append('level', level.toString());

      const token = localStorage.getItem('xgpy_token');
      const response = await fetch(`${API_CONFIG.apiUrl}/api/uploads/pet-image`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formDataUpload
      });

      const result = await response.json();

      if (result.data && result.data.success) {
        setFormData({ ...formData, [result.data.fieldName]: result.data.url });
        alert('图片上传成功');
      } else {
        throw new Error(result.error || '上传失败');
      }
    } catch (error) {
      console.error('上传图片失败:', error);
      alert('上传图片失败: ' + (error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetType, setDeleteTargetType] = useState<'pet' | 'food' | 'tip'>('pet');

  const handleDelete = (id: string, type: 'pet' | 'food' | 'tip') => {
    setDeleteTargetId(id);
    setDeleteTargetType(type);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    const table = deleteTargetType === 'pet' ? 'pets' : deleteTargetType === 'food' ? 'pet_foods' : 'pet_tips';
    await backendClient.from(table).delete().eq('id', deleteTargetId);
    setShowDeleteConfirm(false);
    setDeleteTargetId(null);
    fetchData();
  };

  const openModal = (type: 'pet' | 'food' | 'tip', item?: any) => {
    setModalType(type);
    setFormData(item || {});
    setShowModal(true);
  };

  const toggleQuickAccess = (id: string) => {
    if (!petConfig) return;
    const current = petConfig.focus_mode.focus_mode_quick_access;
    let newList: string[];
    if (current.includes(id)) {
      newList = current.filter(item => item !== id);
    } else {
      newList = [...current, id];
    }
    setPetConfig({
      ...petConfig,
      focus_mode: {
        ...petConfig.focus_mode,
        focus_mode_quick_access: newList,
      },
    });
  };

  const toggleFocusIcon = (field: keyof Omit<FocusModeConfig, 'focus_mode_enabled' | 'focus_mode_quick_access' | 'focus_mode_classes'>) => {
    if (!petConfig) return;
    setPetConfig({
      ...petConfig,
      focus_mode: {
        ...petConfig.focus_mode,
        [field]: !petConfig.focus_mode[field],
      },
    });
  };

  const toggleFocusClass = (classId: string) => {
    if (!petConfig) return;
    const current = petConfig.focus_mode.focus_mode_classes;
    let newList: string[];
    if (current.includes(classId)) {
      newList = current.filter(id => id !== classId);
    } else {
      newList = [...current, classId];
    }
    setPetConfig({
      ...petConfig,
      focus_mode: {
        ...petConfig.focus_mode,
        focus_mode_classes: newList,
      },
    });
  };

  const toggleSelectAllClasses = () => {
    if (!petConfig) return;
    if (petConfig.focus_mode.focus_mode_classes.length === classes.length) {
      setPetConfig({
        ...petConfig,
        focus_mode: {
          ...petConfig.focus_mode,
          focus_mode_classes: [],
        },
      });
    } else {
      setPetConfig({
        ...petConfig,
        focus_mode: {
          ...petConfig.focus_mode,
          focus_mode_classes: classes.map(c => c.id),
        },
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  const iconOptions = [
    { id: 'learn', label: '学习中心', icon: 'fa-graduation-cap' },
    { id: 'practice', label: '练习中心', icon: 'fa-pencil-alt' },
    { id: 'test', label: '考试中心', icon: 'fa-file-alt' },
    { id: 'wrong', label: '错题本', icon: 'fa-exclamation-triangle' },
    { id: 'notebook', label: '记事本', icon: 'fa-sticky-note' },
    { id: 'python', label: 'Python编程', icon: 'fa-code' },
    { id: 'apps', label: '应用中心', icon: 'fa-th-large' },
    { id: 'pet', label: '我的萌宠', icon: 'fa-paw' },
    { id: 'exchange', label: '积分兑换', icon: 'fa-gift' },
    { id: 'leaderboard', label: '积分排行', icon: 'fa-trophy' },
    { id: 'profile', label: '个人信息', icon: 'fa-user' },
    { id: 'security', label: '安全设置', icon: 'fa-shield-alt' },
    { id: 'ai_qa', label: 'AI答疑', icon: 'fa-robot' },
    { id: 'proxyBrowser', label: '上网冲浪', icon: 'fa-earth-asia' },
  ];

  return (
    <LicenseGuard featureName="萌宠配置" featureIcon="fa-paw">
      <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">萌宠配置</h2>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab('pets')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'pets' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            萌宠
          </button>
          <button
            onClick={() => setActiveTab('foods')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'foods' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            食物
          </button>
          <button
            onClick={() => setActiveTab('tips')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'tips' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            提示语
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'config' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            桌面设置
          </button>
          <button
            onClick={() => setActiveTab('focus')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'focus' ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            专注模式
          </button>
        </div>
      </div>

      {activeTab === 'pets' && (
        <div>
          <button
            onClick={() => openModal('pet')}
            className="mb-4 px-4 py-2 bg-blue-500 text-white rounded-lg"
          >
            <i className="fa-solid fa-plus mr-2"></i>
            添加萌宠
          </button>
          <div className="grid grid-cols-4 gap-4">
            {pets.map((pet) => (
              <div key={pet.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <div className="w-16 h-16 bg-gradient-to-br from-pink-400 to-purple-400 rounded-full mx-auto mb-3 flex items-center justify-center overflow-hidden">
                  {pet.image_level_1 ? (
                    <img src={pet.image_level_1} alt={pet.name} className="w-full h-full object-contain" />
                  ) : (
                    <i className="fa-solid fa-paw text-white text-2xl"></i>
                  )}
                </div>
                <h3 className="font-bold text-center text-gray-800">{pet.name}</h3>
                <p className="text-sm text-gray-500 text-center">领养门槛: {pet.min_points_to_adopt}积分</p>
                <div className="flex gap-2 justify-center mt-3">
                  <button onClick={() => openModal('pet', pet)} className="text-blue-600">
                    <i className="fa-solid fa-edit"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(pet.id, 'pet');
                    }}
                    className="text-red-600"
                    type="button"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'foods' && (
        <div>
          <button
            onClick={() => openModal('food')}
            className="mb-4 px-4 py-2 bg-blue-500 text-white rounded-lg"
          >
            <i className="fa-solid fa-plus mr-2"></i>
            添加食物
          </button>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left">名称</th>
                  <th className="px-6 py-3 text-center">所需积分</th>
                  <th className="px-6 py-3 text-center">成长值</th>
                  <th className="px-6 py-3 text-center">状态</th>
                  <th className="px-6 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {foods.map((food) => (
                  <tr key={food.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium">{food.name}</td>
                    <td className="px-6 py-3 text-center text-yellow-600">{food.points_cost}</td>
                    <td className="px-6 py-3 text-center text-green-600">+{food.growth_value}</td>
                    <td className="px-6 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs ${food.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}>
                        {food.is_active ? '启用' : '禁用'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => openModal('food', food)} className="text-blue-600 mr-2">
                        <i className="fa-solid fa-edit"></i>
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(food.id, 'food');
                        }}
                        className="text-red-600"
                        type="button"
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'tips' && (
        <div>
          <button
            onClick={() => openModal('tip')}
            className="mb-4 px-4 py-2 bg-blue-500 text-white rounded-lg"
          >
            <i className="fa-solid fa-plus mr-2"></i>
            添加提示语
          </button>
          <div className="space-y-3">
            {tips.map((tip) => (
              <div key={tip.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between">
                <p className="text-gray-700">{tip.content}</p>
                <div className="flex gap-2">
                  <button onClick={() => openModal('tip', tip)} className="text-blue-600">
                    <i className="fa-solid fa-edit"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(tip.id, 'tip');
                    }}
                    className="text-red-600"
                    type="button"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'config' && petConfig && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">桌面萌宠设置</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  小贴士间隔时间（秒）
                </label>
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={petConfig.tip_interval_seconds}
                  onChange={(e) => setPetConfig({ ...petConfig, tip_interval_seconds: parseInt(e.target.value) || 30 })}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">萌宠自动发送小贴士的时间间隔</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  小贴士显示时间（秒）
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={petConfig.tip_display_seconds}
                  onChange={(e) => setPetConfig({ ...petConfig, tip_display_seconds: parseInt(e.target.value) || 5 })}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">小贴士在桌面上显示的时长</p>
              </div>
              <div className="pt-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={petConfig.double_click_aiqa}
                    onChange={(e) => setPetConfig({ ...petConfig, double_click_aiqa: e.target.checked })}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-700">双击萌宠打开AI答疑应用</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-8">开启后，双击桌面萌宠可快速打开AI答疑</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">成长等级设置</h3>
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700 mb-4">
                <p>宠物共有5个阶段（对应5张图片），阶段达到第5阶段后仍可继续升级，等级上限不设限制。</p>
                <p className="mt-1">升级公式：第N级需要累计成长值 = 基础阈值 + (N-1) x 增量</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    基础成长值阈值
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="10000"
                    value={petConfig.level_base_threshold}
                    onChange={(e) => setPetConfig({ ...petConfig, level_base_threshold: parseInt(e.target.value) || 50 })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">1级升到2级需要的成长值</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    每级增量
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    value={petConfig.level_threshold_increment}
                    onChange={(e) => setPetConfig({ ...petConfig, level_threshold_increment: parseInt(e.target.value) || 50 })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">每升一级阈值增加量</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    最大阶段数
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={petConfig.max_stage}
                    onChange={(e) => setPetConfig({ ...petConfig, max_stage: parseInt(e.target.value) || 5 })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">用于图片显示的阶段数（1-5）</p>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">等级预览</h4>
                <div className="grid grid-cols-5 gap-2 text-xs">
                  {Array.from({ length: 10 }, (_, i) => {
                    const level = i + 1;
                    const base = petConfig.level_base_threshold;
                    const inc = petConfig.level_threshold_increment;
                    let cum = 0;
                    for (let j = 1; j < level; j++) {
                      cum += base + (j - 1) * inc;
                    }
                    const stage = Math.min(level, petConfig.max_stage);
                    return (
                      <div key={level} className={`p-2 rounded text-center ${level <= 5 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                        <div className="font-bold">Lv.{level}</div>
                        <div className="text-gray-500">需{cum}</div>
                        <div className="text-xs">阶段{stage}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleSaveConfig}
            className="w-full py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
          >
            保存设置
          </button>
        </div>
      )}

      {activeTab === 'focus' && petConfig && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-800">专注模式</h3>
                <p className="text-sm text-gray-500 mt-1">开启后，学生桌面将只显示指定的图标，萌宠将变为侧边悬浮小按钮</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={petConfig.focus_mode.focus_mode_enabled}
                  onChange={(e) => setPetConfig({
                    ...petConfig,
                    focus_mode: {
                      ...petConfig.focus_mode,
                      focus_mode_enabled: e.target.checked,
                    },
                  })}
                  className="sr-only peer"
                />
                <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-500"></div>
              </label>
            </div>

            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-700 mb-3">应用班级（多选）</h4>
              <p className="text-xs text-gray-500 mb-3">只有选中的班级在开启专注模式后，学生端才会起效</p>
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={toggleSelectAllClasses}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {petConfig.focus_mode.focus_mode_classes.length === classes.length ? '取消全选' : '全选'}
                </button>
                <span className="text-sm text-gray-500">
                  已选择 {petConfig.focus_mode.focus_mode_classes.length} 个班级
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {classes.map((cls) => {
                  const isSelected = petConfig.focus_mode.focus_mode_classes.includes(cls.id);
                  return (
                    <label
                      key={cls.id}
                      className={`px-3 py-2 rounded-full text-sm cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-purple-100 text-purple-700 border-2 border-purple-300'
                          : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleFocusClass(cls.id)}
                        className="sr-only"
                      />
                      {cls.name}
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handleSaveConfig}
              className="w-full py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
            >
              保存专注模式设置
            </button>
          </div>

          {petConfig.focus_mode.focus_mode_enabled && (
            <>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4">桌面图标显示设置</h3>
                <p className="text-sm text-gray-500 mb-4">选择专注模式下学生桌面显示的图标</p>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {iconOptions.map((icon) => {
                    const fieldName = `focus_mode_show_${icon.id}` as keyof Omit<FocusModeConfig, 'focus_mode_enabled' | 'focus_mode_quick_access' | 'focus_mode_classes'>;
                    const isEnabled = petConfig.focus_mode[fieldName] as boolean;
                    return (
                      <label
                        key={icon.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          isEnabled
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => toggleFocusIcon(fieldName)}
                          className="sr-only"
                        />
                        <i className={`fa-solid ${icon.icon} text-lg ${isEnabled ? 'text-purple-600' : 'text-gray-400'}`}></i>
                        <span className={`text-sm ${isEnabled ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{icon.label}</span>
                        {isEnabled && (
                          <i className="fa-solid fa-check-circle text-purple-500 ml-auto"></i>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4">快捷入口设置</h3>
                <p className="text-sm text-gray-500 mb-4">点击萌宠小按钮后显示的快捷入口（可多选）</p>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {iconOptions.map((icon) => {
                    const isSelected = petConfig.focus_mode.focus_mode_quick_access.includes(icon.id);
                    return (
                      <label
                        key={icon.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleQuickAccess(icon.id)}
                          className="sr-only"
                        />
                        <i className={`fa-solid ${icon.icon} text-lg ${isSelected ? 'text-green-600' : 'text-gray-400'}`}></i>
                        <span className={`text-sm ${isSelected ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{icon.label}</span>
                        {isSelected && (
                          <i className="fa-solid fa-check-circle text-green-500 ml-auto"></i>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                {formData.id ? '编辑' : '添加'}
                {modalType === 'pet' ? '萌宠' : modalType === 'food' ? '食物' : '提示语'}
              </h3>

              <div className="space-y-4">
                {modalType === 'pet' && (
                  <>
                    <input
                      type="text"
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="萌宠名称"
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    />
                    <input
                      type="number"
                      value={formData.min_points_to_adopt || 100}
                      onChange={(e) => setFormData({ ...formData, min_points_to_adopt: parseInt(e.target.value) || 100 })}
                      placeholder="领养门槛"
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    />

                    {formData.id && (
                      <div className="space-y-4 border-t border-gray-200 pt-4">
                        <h4 className="font-medium text-gray-700">成长阶段图片</h4>
                        <div className="grid grid-cols-5 gap-3">
                          {[1, 2, 3, 4, 5].map((level) => (
                            <div key={level} className="text-center">
                              <p className="text-xs text-gray-500 mb-2">阶段 {level}</p>
                              <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden mb-2">
                                {formData[`image_level_${level}`] ? (
                                  <img
                                    src={formData[`image_level_${level}`]}
                                    alt={`阶段${level}`}
                                    className="w-full h-full object-contain"
                                  />
                                ) : (
                                  <i className="fa-solid fa-image text-gray-400"></i>
                                )}
                              </div>
                              <label className="cursor-pointer">
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleImageUpload(level, file);
                                  }}
                                />
                                <span className="text-xs text-blue-500 hover:text-blue-600">
                                  {uploading ? '上传中...' : '上传'}
                                </span>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {modalType === 'food' && (
                  <>
                    <input
                      type="text"
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="食物名称"
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    />
                    <input
                      type="number"
                      value={formData.points_cost || 10}
                      onChange={(e) => setFormData({ ...formData, points_cost: parseInt(e.target.value) || 10 })}
                      placeholder="所需积分"
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    />
                    <input
                      type="number"
                      value={formData.growth_value || 5}
                      onChange={(e) => setFormData({ ...formData, growth_value: parseInt(e.target.value) || 5 })}
                      placeholder="成长值"
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    />
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.is_active || false}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="rounded"
                      />
                      <span>启用</span>
                    </label>
                  </>
                )}

                {modalType === 'tip' && (
                  <textarea
                    value={formData.content || ''}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    placeholder="提示语内容"
                    className="w-full h-32 p-3 border border-gray-300 rounded-lg"
                  />
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 py-2 bg-blue-500 text-white rounded-lg"
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                <i className="fa-solid fa-exclamation-triangle text-red-500 mr-2"></i>
                确认删除
              </h3>
              <p className="text-gray-600 mb-6">
                确定要删除这个{deleteTargetType === 'pet' ? '萌宠' : deleteTargetType === 'food' ? '食物' : '提示语'}吗？此操作不可恢复！
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteTargetId(null);
                  }}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  确认删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </LicenseGuard>
  );
};
