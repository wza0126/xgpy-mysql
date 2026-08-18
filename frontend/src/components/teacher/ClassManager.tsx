import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Class } from '../../types';
import { useAuth } from '../../hooks/useAuth';

export const ClassManager: React.FC = () => {
  const [classes, setClasses] = useState<Class[]>([]);
  const [newClassName, setNewClassName] = useState('');
  const [editingClass, setEditingClass] = useState<Class | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const { profile } = useAuth();

  useEffect(() => {
    if (profile) {
      fetchClasses();
    }
  }, [profile]);

  const fetchClasses = async () => {
    if (!profile) return;
    setLoading(true);
    console.log('=== fetchClasses ===');
    const { data } = await backendClient
      .from('classes')
      .select('*')
      .eq('teacher_id', profile.id)
      .order('created_at', { ascending: false });
    console.log('Fetched classes data:', data);
    if (data) {
      setClasses(data as Class[]);
      console.log('Updated classes state:', data);
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!profile || !newClassName.trim()) return;

    await backendClient.from('classes').insert({
      name: newClassName,
      teacher_id: profile.id,
      allow_login: true, // 默认允许登录
    });

    setNewClassName('');
    fetchClasses();
  };

  const handleUpdate = async () => {
    if (!editingClass) return;
    console.log('=== handleUpdate ===');
    console.log('editingClass:', editingClass);

    await backendClient
      .from('classes')
      .update({ name: editingClass.name, allow_login: editingClass.allow_login, ai_enabled: editingClass.ai_enabled, dm_enabled: editingClass.dm_enabled })
      .eq('id', editingClass.id);

    setEditingClass(null);
    fetchClasses();
  };

  const toggleAllowLogin = async (cls: Class) => {
    const newValue = !cls.allow_login;
    console.log(`切换班级 ${cls.name} 的登录状态:`, newValue);
    
    if (!newValue) {
      const confirmed = window.confirm(
        `确定要禁止班级「${cls.name}」的学生登录吗？\n\n已登录的学生将在30秒内被强制退出。`
      );
      if (!confirmed) return;
    }

    const { error } = await backendClient
      .from('classes')
      .update({ allow_login: newValue })
      .eq('id', cls.id);
    if (error) {
      console.error('更新班级登录状态失败:', error);
      alert('更新失败: ' + error.message);
    } else {
      console.log('更新成功');
      if (!newValue) {
        alert(`已禁止班级「${cls.name}」登录。\n该班级已登录的学生将在30秒内被强制退出。`);
      }
    }
    fetchClasses();
  };

  const toggleAiEnabled = async (cls: Class) => {
    const newValue = !cls.ai_enabled;

    const { error } = await backendClient
      .from('classes')
      .update({ ai_enabled: newValue })
      .eq('id', cls.id);
    if (error) {
      console.error('更新班级AI答疑状态失败:', error);
      alert('更新失败: ' + error.message);
    }
    fetchClasses();
  };

  const toggleDmEnabled = async (cls: Class) => {
    const newValue = !cls.dm_enabled;

    const { error } = await backendClient
      .from('classes')
      .update({ dm_enabled: newValue })
      .eq('id', cls.id);
    if (error) {
      console.error('更新班级数字消息状态失败:', error);
      alert('更新失败: ' + error.message);
    }
    fetchClasses();
  };

  const handleDelete = async (id: string) => {
    setDeleteTargetId(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;

    const { count, error } = await backendClient
      .from('profiles')
      .select('*')
      .eq('class_id', deleteTargetId)
      .eq('role', 'student')
      .count();

    if (error) {
      console.error('检查班级学生数量失败:', error);
      alert('检查班级学生数量失败');
      return;
    }

    if (count && count > 0) {
      alert(`该班级还有 ${count} 名学生，无法删除。请先转移或删除学生。`);
      setShowDeleteConfirm(false);
      setDeleteTargetId(null);
      return;
    }

    await backendClient.from('classes').delete().eq('id', deleteTargetId);
    setShowDeleteConfirm(false);
    setDeleteTargetId(null);
    fetchClasses();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">班级管理</h2>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <i className="fa-solid fa-info-circle text-blue-600 text-lg mt-0.5"></i>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">登录控制说明：</p>
            <ul className="list-disc list-inside space-y-1">
              <li>禁止登录后，该班级学生无法登录，会提示「平台暂未开放」</li>
              <li>已登录的学生将在30秒内被强制退出</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">创建班级</h3>
        <div className="flex gap-4">
          <input
            type="text"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            placeholder="班级名称"
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          <button
            onClick={handleCreate}
            disabled={!newClassName.trim()}
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <i className="fa-solid fa-plus mr-2"></i>
            创建
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">班级名称</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">允许登录</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">AI答疑</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">数字消息</th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">创建时间</th>
              <th className="px-6 py-4 text-right text-sm font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {classes.map((cls) => (
              <tr key={cls.id} className={`hover:bg-gray-50 ${!cls.allow_login ? 'bg-red-50' : ''}`}>
                <td className="px-6 py-4">
                  {editingClass?.id === cls.id ? (
                    <input
                      type="text"
                      value={editingClass!.name}
                      onChange={(e) => setEditingClass({ ...editingClass!, name: e.target.value })}
                      className="p-2 border border-gray-300 rounded-lg"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{cls.name}</span>
                      {!cls.allow_login && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">
                          <i className="fa-solid fa-ban text-xs"></i>
                          已禁止
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-center">
                  {editingClass?.id === cls.id ? (
                    <label className="flex items-center justify-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingClass!.allow_login ?? true}
                        onChange={(e) => setEditingClass({ ...editingClass!, allow_login: e.target.checked })}
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600">
                        {editingClass!.allow_login ? '允许' : '禁止'}
                      </span>
                    </label>
                  ) : (
                    <button
                      onClick={() => toggleAllowLogin(cls)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        cls.allow_login
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                      }`}
                    >
                      <i className={`fa-solid mr-2 ${cls.allow_login ? 'fa-check' : 'fa-ban'}`}></i>
                      {cls.allow_login ? '允许登录' : '禁止登录'}
                    </button>
                  )}
                </td>
                <td className="px-6 py-4 text-center">
                  {editingClass?.id === cls.id ? (
                    <label className="flex items-center justify-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingClass!.ai_enabled ?? true}
                        onChange={(e) => setEditingClass({ ...editingClass!, ai_enabled: e.target.checked })}
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600">
                        {editingClass!.ai_enabled ? '启用' : '禁用'}
                      </span>
                    </label>
                  ) : (
                    <button
                      onClick={() => toggleAiEnabled(cls)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        cls.ai_enabled
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <i className={`fa-solid mr-2 ${cls.ai_enabled ? 'fa-check' : 'fa-times'}`}></i>
                      {cls.ai_enabled ? '已启用' : '已禁用'}
                    </button>
                  )}
                </td>
                <td className="px-6 py-4 text-center">
                  {editingClass?.id === cls.id ? (
                    <label className="flex items-center justify-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingClass!.dm_enabled ?? false}
                        onChange={(e) => setEditingClass({ ...editingClass!, dm_enabled: e.target.checked })}
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600">
                        {editingClass!.dm_enabled ? '启用' : '禁用'}
                      </span>
                    </label>
                  ) : (
                    <button
                      onClick={() => toggleDmEnabled(cls)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        cls.dm_enabled
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <i className={`fa-solid mr-2 ${cls.dm_enabled ? 'fa-check' : 'fa-times'}`}></i>
                      {cls.dm_enabled ? '已启用' : '已禁用'}
                    </button>
                  )}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {new Date(cls.created_at || '').toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-right">
                  {editingClass?.id === cls.id ? (
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={handleUpdate}
                        className="px-3 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingClass(null)}
                        className="px-3 py-1 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingClass(cls)}
                        className="px-3 py-1 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="编辑班级"
                      >
                        <i className="fa-solid fa-edit"></i>
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(cls.id);
                        }}
                        className="px-3 py-1 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        type="button"
                        title="删除班级"
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {classes.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <i className="fa-solid fa-users text-4xl mb-4"></i>
            <p>暂无班级</p>
          </div>
        )}
      </div>

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
                确定要删除这个班级吗？此操作不可恢复！
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
  );
};
