import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Test, Question } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { ExamManager } from './ExamManager';
import { ClusterFilter, buildClusterTree, type ClusterTree } from '../common/ClusterFilter';

const parseTags = (tags: any): string[] => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
  }
  return [];
};

export const TestManager: React.FC = () => {
  const [tests, setTests] = useState<Test[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTest, setEditingTest] = useState<Test | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    tag_filters: [] as string[],
    cluster_filters: [] as { primary: string; secondary: string }[],
    question_count: 20,
    points_reward: 50,
    time_limit: 30,
    passing_score: 60,
    is_active: true,
    class_ids: [] as string[],
    allow_internet_code: false,
    internet_code_reward: 1,
    pass_grant_browser: false,
    pass_grant_exchange: false,
    pass_grant_app_center: false,
    allow_equipment_drop: false,
    qualification_correct_count: 0,
    daily_test_limit: 0,
  });
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);
  /** AI 聚类：一级 → 二级集合（仅统计“可用于考试”的题目） */
  const [clusterTree, setClusterTree] = useState<ClusterTree>({});
  const [filterClusterPrimary, setFilterClusterPrimary] = useState<string[]>([]);
  const [filterClusterSecondary, setFilterClusterSecondary] = useState<string[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'tests' | 'exams'>('tests');
  const { profile } = useAuth();

  useEffect(() => {
    if (profile) {
      fetchData();
      fetchAllTags();
    }
  }, [profile]);

  const fetchAllTags = async () => {
    const { data: questions } = await backendClient.from('questions').select('*').eq('exam_enabled', true);
    if (questions) {
      const tagSet = new Set<string>();
      (questions as Question[]).forEach((q) => {
        const tags = parseTags(q.tags);
        tags.forEach((t) => tagSet.add(t));
      });
      setAllTags(Array.from(tagSet).sort());
      // 顺带构建 AI 聚类树（只用可用于考试的题目）
      setClusterTree(buildClusterTree((questions as any[]).map((q) => q.cluster_id)));
    }
  };

  const fetchData = async () => {
    if (!profile) return;
    setLoading(true);

    const [{ data: testsData }, { data: classesData }] = await Promise.all([
      backendClient.from('tests').select('*').eq('created_by', profile.id).eq('type', 'test').order('created_at', { ascending: false }),
      backendClient.from('classes').select('*').eq('teacher_id', profile.id),
    ]);

    if (testsData) setTests(testsData as Test[]);
    if (classesData) setClasses(classesData);
    setLoading(false);
  };

  const handleSave = async () => {
    if (!profile) return;

    const data: any = {
      ...formData,
      type: 'test',
      created_by: profile.id,
    };
    data.tag_filters = JSON.stringify(formData.tag_filters);
    // 聚类筛选：与标签筛选叠加；为空时写 null（后端按“不限”处理）
    data.cluster_filters = formData.cluster_filters.length > 0
      ? JSON.stringify(formData.cluster_filters)
      : null;

    if (!data.qualification_correct_count) {
      delete data.qualification_correct_count;
    }

    try {
      if (editingTest) {
        await backendClient.from('tests').update(data).eq('id', editingTest.id);
      } else {
        await backendClient.from('tests').insert(data);
      }

      setShowModal(false);
      setEditingTest(null);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('保存测试失败:', error);
      alert('保存失败：' + (error as Error).message);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteTargetId(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    await backendClient.from('tests').delete().eq('id', deleteTargetId);
    setShowDeleteConfirm(false);
    setDeleteTargetId(null);
    fetchData();
  };

  const resetForm = () => {
    setFormData({
      title: '',
      tag_filters: [],
      cluster_filters: [],
      question_count: 20,
      points_reward: 50,
      time_limit: 30,
      passing_score: 60,
      is_active: true,
      class_ids: [],
      allow_internet_code: false,
      internet_code_reward: 1,
      pass_grant_browser: false,
      pass_grant_exchange: false,
      pass_grant_app_center: false,
      allow_equipment_drop: false,
      qualification_correct_count: 0,
      daily_test_limit: 0,
    });
  };

  const toggleTag = (tag: string) => {
    setFormData((prev) => {
      const current = prev.tag_filters;
      if (current.includes(tag)) {
        return { ...prev, tag_filters: current.filter((t) => t !== tag) };
      }
      return { ...prev, tag_filters: [...current, tag] };
    });
  };

  const openEdit = (test: Test) => {
    setEditingTest(test);
    let classIds = [] as string[];
    const testData = test as any;
    if (testData.class_ids) {
      if (Array.isArray(testData.class_ids)) {
        classIds = testData.class_ids;
      } else if (typeof testData.class_ids === 'string') {
        try {
          classIds = JSON.parse(testData.class_ids);
        } catch {
          classIds = [];
        }
      }
    } else if (testData.class_id) {
      classIds = [testData.class_id];
    }

    let tagFilters: string[] = [];
    if (testData.tag_filters) {
      if (Array.isArray(testData.tag_filters)) {
        tagFilters = testData.tag_filters;
      } else if (typeof testData.tag_filters === 'string') {
        try {
          tagFilters = JSON.parse(testData.tag_filters);
        } catch {
          tagFilters = [];
        }
      }
    }

    let clusterFilters: { primary: string; secondary: string }[] = [];
    if (testData.cluster_filters) {
      let parsed: any = testData.cluster_filters;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      if (Array.isArray(parsed)) {
        clusterFilters = parsed
          .filter((c: any) => c && typeof c.primary === 'string' && c.primary)
          .map((c: any) => ({ primary: c.primary, secondary: typeof c.secondary === 'string' ? c.secondary : '' }));
      }
    }

    setFormData({
      title: testData.title || test.name || '',
      tag_filters: tagFilters,
      cluster_filters: clusterFilters,
      question_count: test.question_count || 20,
      points_reward: test.points_reward || 50,
      time_limit: test.time_limit || 30,
      passing_score: testData.passing_score || 60,
      is_active: test.is_active || false,
      class_ids: classIds,
      allow_internet_code: testData.allow_internet_code === true || testData.allow_internet_code === 1,
      internet_code_reward: testData.internet_code_reward || 1,
      pass_grant_browser: testData.pass_grant_browser === true || testData.pass_grant_browser === 1,
      pass_grant_exchange: testData.pass_grant_exchange === true || testData.pass_grant_exchange === 1,
      pass_grant_app_center: testData.pass_grant_app_center === true || testData.pass_grant_app_center === 1,
      allow_equipment_drop: testData.allow_equipment_drop === true || testData.allow_equipment_drop === 1,
      qualification_correct_count: testData.qualification_correct_count || 0,
      daily_test_limit: parseInt(testData.daily_test_limit, 10) || 0,
    });
    setShowModal(true);
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
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-800">考试管理</h2>
      </div>

      <div className="flex gap-4 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveSubTab('tests')}
          className={`px-4 py-3 font-medium transition-colors ${
            activeSubTab === 'tests'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className="fa-solid fa-clipboard-check mr-2"></i>
          普通测试
        </button>
        <button
          onClick={() => setActiveSubTab('exams')}
          className={`px-4 py-3 font-medium transition-colors ${
            activeSubTab === 'exams'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className="fa-solid fa-file-alt mr-2"></i>
          试卷
        </button>
      </div>

      {activeSubTab === 'tests' && (<>
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => {
            setEditingTest(null);
            resetForm();
            setShowModal(true);
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          <i className="fa-solid fa-plus mr-2"></i>
          创建测试
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">测试名称</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">班级</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">题目数</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">限时</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">奖励积分</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">状态</th>
              <th className="px-6 py-4 text-right text-sm font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {tests.map((test) => {
              let classNames = '全部班级';
              const testData = test as any;
              let classIds = [] as string[];

              if (testData.class_ids) {
                if (Array.isArray(testData.class_ids)) {
                  classIds = testData.class_ids;
                } else if (typeof testData.class_ids === 'string') {
                  try {
                    classIds = JSON.parse(testData.class_ids);
                  } catch {
                    classIds = [];
                  }
                }
              } else if (testData.class_id) {
                classIds = [testData.class_id];
              }

              if (classIds.length > 0) {
                const names = classIds.map(cid => {
                  const cls = classes.find(c => c.id === cid);
                  return cls?.name || cid;
                });
                classNames = names.join(', ');
              }

              return (
                <tr key={test.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-800">{testData.title || test.name}</td>
                  <td className="px-6 py-4 text-center text-gray-600">{classNames}</td>
                  <td className="px-6 py-4 text-center text-gray-600">{test.question_count}</td>
                  <td className="px-6 py-4 text-center text-gray-600">{test.time_limit}分钟</td>
                  <td className="px-6 py-4 text-center text-yellow-600 font-medium">{test.points_reward}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      test.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {test.is_active ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => openEdit(test)}
                        className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                      >
                        <i className="fa-solid fa-edit"></i>
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(test.id);
                        }}
                        className="text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                        type="button"
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {tests.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <i className="fa-solid fa-clipboard text-4xl mb-4"></i>
            <p>暂无测试</p>
          </div>
        )}
      </div>

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
              className="bg-white rounded-2xl p-6 max-w-xl w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4 shrink-0">
                {editingTest ? '编辑测试' : '创建测试'}
              </h3>

              <div className="space-y-4 overflow-y-auto pr-1 flex-1 min-h-0">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">测试名称</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    placeholder="请输入测试名称"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">选择班级</label>
                  <div className="border border-gray-300 rounded-lg p-3">
                    <label className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
                      <input
                        type="checkbox"
                        checked={formData.class_ids.length === 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, class_ids: [] });
                          }
                        }}
                      />
                      <span>全部班级</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                      {classes.map((cls) => (
                        <label key={cls.id} className="flex items-center gap-2 px-1 py-1.5 rounded hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={formData.class_ids.includes(cls.id)}
                            onChange={(e) => {
                              let newClassIds;
                              if (e.target.checked) {
                                newClassIds = [...formData.class_ids, cls.id];
                              } else {
                                newClassIds = formData.class_ids.filter(id => id !== cls.id);
                              }
                              setFormData({ ...formData, class_ids: newClassIds });
                            }}
                          />
                          <span className="text-sm truncate">{cls.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">题目数量</label>
                      <button
                        type="button"
                        onClick={() => setShowTagModal(true)}
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        {formData.tag_filters.length > 0 || formData.cluster_filters.length > 0
                          ? `题目范围：标签 ${formData.tag_filters.length} · 聚类 ${formData.cluster_filters.length}`
                          : '题目范围（可选）'}
                      </button>
                    </div>
                    <input
                      type="number"
                      value={formData.question_count}
                      onChange={(e) => setFormData({ ...formData, question_count: parseInt(e.target.value) || 20 })}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      min={5}
                      max={100}
                    />
                    {formData.tag_filters.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {formData.tag_filters.map((tag) => (
                          <span key={tag} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                            {tag}
                            <button
                              type="button"
                              onClick={() => toggleTag(tag)}
                              className="ml-1.5 text-blue-400 hover:text-blue-700"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {formData.cluster_filters.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {formData.cluster_filters.map((c, i) => (
                          <span key={`${c.primary}/${c.secondary}/${i}`} className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs">
                            {c.secondary ? `${c.primary} / ${c.secondary}` : `${c.primary}（整章）`}
                            <button
                              type="button"
                              onClick={() => setFormData((prev) => ({
                                ...prev,
                                cluster_filters: prev.cluster_filters.filter((_, idx) => idx !== i),
                              }))}
                              className="ml-1.5 text-violet-400 hover:text-violet-700"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">时间限制（分钟）</label>
                    <input
                      type="number"
                      value={formData.time_limit}
                      onChange={(e) => setFormData({ ...formData, time_limit: parseInt(e.target.value) || 30 })}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      min={5}
                      max={180}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">及格分数</label>
                    <input
                      type="number"
                      value={formData.passing_score}
                      onChange={(e) => setFormData({ ...formData, passing_score: parseInt(e.target.value) || 60 })}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      min={0}
                      max={100}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">完成奖励积分</label>
                    <input
                      type="number"
                      value={formData.points_reward}
                      onChange={(e) => setFormData({ ...formData, points_reward: parseInt(e.target.value) || 50 })}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      min={0}
                    />
                  </div>
                </div>

                <div className="p-4 bg-orange-50 rounded-xl">
                  <label className="block text-sm font-medium text-orange-800 mb-1">每日测试次数限制</label>
                  <p className="text-xs text-gray-500 mb-2">学生每天最多可以参加该测试几次（及格后正常发放奖励）</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 whitespace-nowrap">每天最多</span>
                    <input
                      type="number"
                      value={formData.daily_test_limit}
                      onChange={(e) => setFormData({ ...formData, daily_test_limit: parseInt(e.target.value) || 0 })}
                      className="w-24 p-2 border border-gray-300 rounded-lg text-center"
                      min={0}
                    />
                    <span className="text-sm text-gray-600 whitespace-nowrap">次</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">填 0 或留空表示不限制次数</p>
                </div>

                <div className="p-4 bg-blue-50 rounded-xl">
                  <label className="block text-sm font-medium text-blue-800 mb-1">测试资格验证（可选）</label>
                  <p className="text-xs text-gray-500 mb-2">设置学生参加此测试所需的最低做对题目数量</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 whitespace-nowrap">需要做对</span>
                    <input
                      type="number"
                      value={formData.qualification_correct_count}
                      onChange={(e) => setFormData({ ...formData, qualification_correct_count: parseInt(e.target.value) || 0 })}
                      className="w-24 p-2 border border-gray-300 rounded-lg text-center"
                      min={0}
                    />
                    <span className="text-sm text-gray-600 whitespace-nowrap">道题才能参加</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">留空或填0表示不限制</p>
                </div>

                <div className="p-4 bg-purple-50 rounded-xl">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_internet_code}
                      onChange={(e) => setFormData({ ...formData, allow_internet_code: e.target.checked })}
                      className="w-4 h-4 text-purple-500"
                    />
                    <span className="font-medium text-purple-700">完成奖励上网认证码</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">测试及格后从认证码管理取一个未使用的认证码奖励给学生</p>
                  {formData.allow_internet_code && (
                    <div className="mt-3 flex items-center gap-2">
                      <label className="text-xs font-medium text-gray-600 whitespace-nowrap">奖励数量</label>
                      <input
                        type="number"
                        value={formData.internet_code_reward}
                        onChange={(e) => setFormData({ ...formData, internet_code_reward: parseInt(e.target.value) || 1 })}
                        className="w-20 p-2 border border-gray-300 rounded-lg text-sm text-center"
                        min={1}
                        max={10}
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 bg-sky-50 rounded-xl">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.pass_grant_browser}
                      onChange={(e) => setFormData({ ...formData, pass_grant_browser: e.target.checked })}
                      className="w-4 h-4 text-sky-500"
                    />
                    <span className="font-medium text-sky-700">及格后允许上网</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">学生测试及格后自动开通上网权限，并收到系统通知</p>
                </div>

                <div className="p-4 bg-emerald-50 rounded-xl">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.pass_grant_exchange}
                      onChange={(e) => setFormData({ ...formData, pass_grant_exchange: e.target.checked })}
                      className="w-4 h-4 text-emerald-500"
                    />
                    <span className="font-medium text-emerald-700">及格后允许兑换</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">学生测试及格后自动开通积分兑换模块，并收到系统通知</p>
                </div>

                <div className="p-4 bg-violet-50 rounded-xl">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.pass_grant_app_center}
                      onChange={(e) => setFormData({ ...formData, pass_grant_app_center: e.target.checked })}
                      className="w-4 h-4 text-violet-500"
                    />
                    <span className="font-medium text-violet-700">及格后允许访问应用中心</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">学生测试及格后自动开通应用中心访问权限，并收到系统通知</p>
                </div>

                <div className="p-4 bg-amber-50 rounded-xl">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_equipment_drop}
                      onChange={(e) => setFormData({ ...formData, allow_equipment_drop: e.target.checked })}
                      className="w-4 h-4 text-amber-500"
                    />
                    <span className="font-medium text-amber-700">测试及格掉落装备</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">测试及格后随机掉落装备，掉率为练习时的10倍</p>
                </div>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded"
                  />
                  <span>启用测试</span>
                </label>
              </div>

              <div className="flex gap-3 mt-6 shrink-0">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formData.title}
                  className="flex-1 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTagModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
            onClick={() => setShowTagModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[88vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-2">选择题目范围</h3>
              <p className="text-sm text-gray-500 mb-4">
                可按标签、AI 聚类分别收窄抽题范围；两类都选时需同时满足。都不选则从全部题目中抽取。
              </p>

              <div className="mb-5">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  标签筛选
                  {formData.tag_filters.length > 0 && (
                    <span className="ml-2 text-xs text-blue-600">已选 {formData.tag_filters.length} 个</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto pr-1 border border-gray-100 rounded-lg p-3">
                  {allTags.length === 0 && (
                    <p className="text-sm text-gray-400">题库中暂无标签</p>
                  )}
                  {allTags.map((tag) => {
                    const selected = formData.tag_filters.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                          selected
                            ? 'bg-blue-500 text-white shadow-sm'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-4">
                <ClusterFilter
                  clusterTree={clusterTree}
                  selectedPrimary={filterClusterPrimary}
                  selectedSecondary={filterClusterSecondary}
                  onChange={(p, s) => { setFilterClusterPrimary(p); setFilterClusterSecondary(s); }}
                />
                {Object.keys(clusterTree).length === 0 && (
                  <p className="text-sm text-gray-400">题库中暂无 AI 聚类信息</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setFormData((prev) => ({ ...prev, tag_filters: [], cluster_filters: [] }));
                    setFilterClusterPrimary([]);
                    setFilterClusterSecondary([]);
                    setShowTagModal(false);
                  }}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
                >
                  清除选择
                </button>
                <button
                  onClick={() => {
                    // 把「一级 + 二级」的选中态固化成 cluster_filters（与后端 DB 结构一致）
                    const list: { primary: string; secondary: string }[] = [];
                    const covered = new Set<string>();
                    filterClusterSecondary.forEach((full) => {
                      const idx = full.indexOf('/');
                      if (idx < 0) return;
                      const primary = full.slice(0, idx);
                      const secondary = full.slice(idx + 1);
                      if (!primary || !secondary) return;
                      covered.add(primary);
                      list.push({ primary, secondary });
                    });
                    filterClusterPrimary.forEach((p) => {
                      if (covered.has(p)) return;
                      list.push({ primary: p, secondary: '' });
                    });
                    setFormData((prev) => ({ ...prev, cluster_filters: list }));
                    setShowTagModal(false);
                  }}
                  className="flex-1 py-2 bg-blue-500 text-white rounded-lg"
                >
                  确定（标签 {formData.tag_filters.length} · 聚类 {filterClusterPrimary.length + filterClusterSecondary.length}）
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
              <p className="text-gray-600 mb-6">确定要删除这个测试吗？此操作不可恢复！</p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteTargetId(null); }}
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
      </>)}
      {activeSubTab === 'exams' && <ExamManager />}
    </div>
  );
};
