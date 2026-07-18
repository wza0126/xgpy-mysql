import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';

export const GameSettings: React.FC = () => {
  const defaultConfigs: Record<string, any> = {
    points_correct_answer: 10,
    points_wrong_answer: -5,
    master_question_threshold: 3,
    pet_adoption_threshold: 100,
    pet_change_threshold: 100,
    crit_base_rate: 5,
    crit_max_rate: 30,
    honor_perfect_buff_crit: 5,
    honor_perfect_buff_minutes: 10,
    honor_critstreak_buff_crit: 10,
    honor_critstreak_buff_minutes: 10,
    honor_wrong_debuff_crit: 10,
    honor_wrong_debuff_minutes: 1,
    honor_studious_buff_crit: 8,
    honor_studious_buff_minutes: 30,
  };

  const [configs, setConfigs] = useState<Record<string, any>>(defaultConfigs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('points');

  const [equipments, setEquipments] = useState<any[]>([]);
  const [showEquipForm, setShowEquipForm] = useState(false);
  const [editingEquip, setEditingEquip] = useState<any>(null);
  const [equipForm, setEquipForm] = useState({ name: '', drop_rate: 1, crit_bonus: 1, icon: '⚔️' });

  const tabs = [
    { id: 'points', label: '积分规则', icon: 'fa-coins' },
    { id: 'game', label: '打怪系统', icon: 'fa-swords' },
  ];

  useEffect(() => {
    fetchConfigs();
    loadEquipments();
  }, []);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const { data } = await backendClient.from('system_config').select('*');
      if (data) {
        const configMap: Record<string, any> = { ...defaultConfigs };
        data.forEach((item: any) => {
          const configKey = item.key || item.config_key;
          if (!configKey) return;
          
          let parsedValue = item.value;
          if (typeof item.value === 'string') {
            try {
              parsedValue = JSON.parse(item.value);
            } catch {}
          }
          if (typeof parsedValue === 'object' && parsedValue !== null && parsedValue.value !== undefined) {
            parsedValue = parsedValue.value;
          }
          configMap[configKey] = parsedValue;
        });
        setConfigs(configMap);
      }
    } catch (error) {
      console.error('获取配置失败:', error);
    }
    setLoading(false);
  };

  const handleSaveConfigs = async () => {
    setSaving(true);
    
    try {
      const { data: existingData } = await backendClient.from('system_config').select('*');
      const existingMap: Record<string, any> = {};
      if (existingData) {
        existingData.forEach((item: any) => {
          existingMap[item.key] = item.value;
        });
      }

      for (const [key, value] of Object.entries(configs)) {
        const id = `config_${key}`;
        const record = { id, key, value: { value } };
        const { error } = await backendClient.from('system_config').insert(record);
        
        if (error) {
          console.error(`保存配置 ${key} 失败:`, error);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      await fetchConfigs();
      alert('保存成功');
    } catch (error) {
      console.error('保存配置失败:', error);
      alert('保存失败: ' + (error as Error).message);
    }
    
    setSaving(false);
  };

  const loadEquipments = async () => {
    try {
      const result = await backendClient.get('/api/teacher/equipments');
      setEquipments(result.data || []);
    } catch (e) { console.error('加载装备失败:', e); }
  };

  const handleSaveEquip = async () => {
    try {
      if (editingEquip) {
        await backendClient.put(`/api/teacher/equipments/${editingEquip.id}`, equipForm);
      } else {
        await backendClient.post('/api/teacher/equipments', equipForm);
      }
      setShowEquipForm(false);
      setEditingEquip(null);
      setEquipForm({ name: '', drop_rate: 1, crit_bonus: 1, icon: '⚔️' });
      loadEquipments();
    } catch (e) { console.error('保存装备失败:', e); }
  };

  const handleDeleteEquip = async (id: string) => {
    if (!confirm('确定要禁用此装备吗？已拥有该装备的学生不受影响。')) return;
    try {
      await backendClient.delete(`/api/teacher/equipments/${id}`);
      loadEquipments();
    } catch (e) { console.error('删除装备失败:', e); }
  };

  const getConfigDescription = (key: string): string => {
    const descriptions: Record<string, string> = {
      points_correct_answer: '答对积分',
      points_wrong_answer: '答错积分',
      master_question_threshold: '掌握题目阈值',
      pet_adoption_threshold: '领养萌宠积分',
      pet_change_threshold: '换养萌宠积分',
      crit_base_rate: '基础暴击率(%)',
      crit_max_rate: '暴击率上限(%)',
      honor_perfect_buff_crit: '十连对Buff暴击加成(%)',
      honor_perfect_buff_minutes: '十连对Buff时长(分钟)',
      honor_critstreak_buff_crit: '三连暴击Buff暴击加成(%)',
      honor_critstreak_buff_minutes: '三连暴击Buff时长(分钟)',
      honor_studious_buff_crit: '勤学好问Buff暴击加成(%)',
      honor_studious_buff_minutes: '勤学好问Buff时长(分钟)',
      honor_wrong_debuff_crit: '三连错Debuff暴击降低(%)',
      honor_wrong_debuff_minutes: '三连错Debuff时长(分钟)',
    };
    return descriptions[key] || key;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
        <i className="fa-solid fa-gamepad text-purple-600"></i>
        刷题打怪系统
      </h2>

      <div className="flex gap-4 mb-6 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className={`fa-solid ${tab.icon} mr-2`}></i>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <AnimatePresence mode="wait">
          {activeTab === 'points' && (
            <motion.div
              key="points"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-6">积分规则设置</h3>

              <div className="space-y-6">
                <div>
                  <h4 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-pencil"></i>练习模式
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">答对积分</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={configs.points_correct_answer ?? ''}
                          onChange={(e) => setConfigs({ ...configs, points_correct_answer: parseFloat(e.target.value) || 0 })}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-gray-500 text-sm">分</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">答错积分</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={configs.points_wrong_answer ?? ''}
                          onChange={(e) => setConfigs({ ...configs, points_wrong_answer: parseFloat(e.target.value) || 0 })}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-gray-500 text-sm">分</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-star"></i>其他设置
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">掌握题目阈值</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={configs.master_question_threshold ?? ''}
                          onChange={(e) => setConfigs({ ...configs, master_question_threshold: parseFloat(e.target.value) || 0 })}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-gray-500 text-sm">次</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">练习时题目做对次数达到此阈值将不再显示</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">换养萌宠积分</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={configs.pet_change_threshold ?? ''}
                          onChange={(e) => setConfigs({ ...configs, pet_change_threshold: parseFloat(e.target.value) || 0 })}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-gray-500 text-sm">分</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'game' && (
            <motion.div
              key="game"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-6">打怪系统设置</h3>

              <div className="space-y-6">
                <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                  <h4 className="font-semibold text-purple-800 mb-3 flex items-center gap-2">
                    <i className="fa-solid fa-gamepad"></i>
                    系统说明
                  </h4>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li>• <strong>暴击机制：</strong>答题时有概率触发暴击，获得额外积分奖励</li>
                    <li>• <strong>连对奖励：</strong>连续答对10题可获得额外积分和暴击加成Buff</li>
                    <li>• <strong>三连暴击：</strong>连续3次暴击触发更强的暴击Buff</li>
                    <li>• <strong>勤学好问：</strong>学习模块每日看满10题获得暴击加成Buff</li>
                    <li>• <strong>三连错惩罚：</strong>连续答错3题会降低暴击率</li>
                    <li>• <strong>装备掉落：</strong>练习答对随机掉落装备，考试及格掉率为10倍，装备暴击加成永久叠加</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-bullseye"></i>暴击设置
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">基础暴击率(%)</label>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={configs.crit_base_rate ?? 5}
                        onChange={(e) => setConfigs({ ...configs, crit_base_rate: parseFloat(e.target.value) || 5 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">暴击率上限(%)</label>
                      <input
                        type="number"
                        min="5"
                        max="100"
                        value={configs.crit_max_rate ?? 30}
                        onChange={(e) => setConfigs({ ...configs, crit_max_rate: parseFloat(e.target.value) || 30 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-trophy"></i>奖励Buff
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">十连对Buff暴击加成(%)</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={configs.honor_perfect_buff_crit ?? 5}
                        onChange={(e) => setConfigs({ ...configs, honor_perfect_buff_crit: parseFloat(e.target.value) || 0 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">十连对Buff时长(分钟)</label>
                      <input
                        type="number"
                        min="1"
                        value={configs.honor_perfect_buff_minutes ?? 10}
                        onChange={(e) => setConfigs({ ...configs, honor_perfect_buff_minutes: parseInt(e.target.value) || 10 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">三连暴击Buff暴击加成(%)</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={configs.honor_critstreak_buff_crit ?? 10}
                        onChange={(e) => setConfigs({ ...configs, honor_critstreak_buff_crit: parseFloat(e.target.value) || 0 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">三连暴击Buff时长(分钟)</label>
                      <input
                        type="number"
                        min="1"
                        value={configs.honor_critstreak_buff_minutes ?? 10}
                        onChange={(e) => setConfigs({ ...configs, honor_critstreak_buff_minutes: parseInt(e.target.value) || 10 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">勤学好问Buff暴击加成(%)</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={configs.honor_studious_buff_crit ?? 8}
                        onChange={(e) => setConfigs({ ...configs, honor_studious_buff_crit: parseFloat(e.target.value) || 0 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">勤学好问Buff时长(分钟)</label>
                      <input
                        type="number"
                        min="1"
                        value={configs.honor_studious_buff_minutes ?? 30}
                        onChange={(e) => setConfigs({ ...configs, honor_studious_buff_minutes: parseInt(e.target.value) || 30 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-skull"></i>惩罚Debuff
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">三连错Debuff暴击降低(%)</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={configs.honor_wrong_debuff_crit ?? 10}
                        onChange={(e) => setConfigs({ ...configs, honor_wrong_debuff_crit: parseFloat(e.target.value) || 0 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">三连错Debuff时长(分钟)</label>
                      <input
                        type="number"
                        min="1"
                        value={configs.honor_wrong_debuff_minutes ?? 1}
                        onChange={(e) => setConfigs({ ...configs, honor_wrong_debuff_minutes: parseInt(e.target.value) || 1 })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-gray-700 mb-4 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <i className="fa-solid fa-shield-halved"></i>装备掉落管理
                    </span>
                    <button
                      onClick={() => {
                        setEditingEquip(null);
                        setEquipForm({ name: '', drop_rate: 1, crit_bonus: 1, icon: '⚔️' });
                        setShowEquipForm(true);
                      }}
                      className="px-3 py-1.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm"
                    >
                      <i className="fa-solid fa-plus mr-1"></i>添加装备
                    </button>
                  </h4>

                  {equipments.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      <i className="fa-solid fa-shield-halved text-3xl mb-2"></i>
                      <p>暂无装备，点击"添加装备"创建</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="px-3 py-2 text-left">图标</th>
                            <th className="px-3 py-2 text-left">名称</th>
                            <th className="px-3 py-2 text-left">掉落概率(%)</th>
                            <th className="px-3 py-2 text-left">暴击加成(%)</th>
                            <th className="px-3 py-2 text-left">状态</th>
                            <th className="px-3 py-2 text-left">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {equipments.map((equip) => (
                            <tr key={equip.id} className="border-t border-gray-100">
                              <td className="px-3 py-2 text-xl">{equip.icon}</td>
                              <td className="px-3 py-2 text-gray-800">{equip.name}</td>
                              <td className="px-3 py-2 text-gray-600">{equip.drop_rate}</td>
                              <td className="px-3 py-2 text-gray-600">{equip.crit_bonus}</td>
                              <td className="px-3 py-2">
                                {equip.is_active === false ? (
                                  <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded">已禁用</span>
                                ) : (
                                  <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">启用</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => {
                                    setEditingEquip(equip);
                                    setEquipForm({
                                      name: equip.name || '',
                                      drop_rate: equip.drop_rate ?? 1,
                                      crit_bonus: equip.crit_bonus ?? 1,
                                      icon: equip.icon || '⚔️',
                                    });
                                    setShowEquipForm(true);
                                  }}
                                  className="text-blue-500 hover:text-blue-700 mr-3"
                                >
                                  <i className="fa-solid fa-edit"></i>编辑
                                </button>
                                <button
                                  onClick={() => handleDeleteEquip(equip.id)}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  <i className="fa-solid fa-trash"></i>删除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {showEquipForm && (
                    <div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                      <h5 className="font-medium text-purple-800 mb-3">
                        {editingEquip ? '编辑装备' : '添加装备'}
                      </h5>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">图标(emoji)</label>
                          <input
                            type="text"
                            value={equipForm.icon}
                            onChange={(e) => setEquipForm({ ...equipForm, icon: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            placeholder="⚔️"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">名称</label>
                          <input
                            type="text"
                            value={equipForm.name}
                            onChange={(e) => setEquipForm({ ...equipForm, name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            placeholder="装备名称"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">掉落概率(%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={equipForm.drop_rate}
                            onChange={(e) => setEquipForm({ ...equipForm, drop_rate: parseFloat(e.target.value) || 0 })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">暴击加成(%)</label>
                          <input
                            type="number"
                            min="0"
                            value={equipForm.crit_bonus}
                            onChange={(e) => setEquipForm({ ...equipForm, crit_bonus: parseFloat(e.target.value) || 0 })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-4">
                        <button
                          onClick={() => {
                            setShowEquipForm(false);
                            setEditingEquip(null);
                            setEquipForm({ name: '', drop_rate: 1, crit_bonus: 1, icon: '⚔️' });
                          }}
                          className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSaveEquip}
                          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-end mt-8 pt-6 border-t border-gray-200">
          <button
            onClick={handleSaveConfigs}
            disabled={saving}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <i className="fa-solid fa-spinner fa-spin"></i>
                保存中...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <i className="fa-solid fa-save"></i>
                保存设置
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
