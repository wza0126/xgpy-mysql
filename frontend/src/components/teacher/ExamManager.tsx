import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Question } from '../../types';
import { formatDateTime } from '../../utils/dateUtils';
import * as XLSX from 'xlsx';
import { sanitizeHtml, htmlToPlainText } from '../../utils/htmlUtils';
import { PKBattleConfigTab } from './PKBattleConfigTab';
import { PKStatsTab } from './PKStatsTab';

type ExamTest = {
  id: string;
  title: string;
  description: string;
  question_ids: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  time_limit: number;
  passing_score: number;
  points_reward: number;
  class_ids: string[];
  allow_view_paper: boolean;
  allow_internet_code: boolean;
  internet_code_reward: number;
  pass_grant_browser?: boolean | number;
  pass_grant_exchange?: boolean | number;     // 及格后允许兑换（同步 profiles.can_open_exchange_module）
  pass_grant_app_center?: boolean | number;  // 及格后允许访问应用中心（同步 profiles.can_use_app）
  question_count: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
};

type ExamRecord = {
  id: string;
  test_id: string;
  student_id: string;
  selected_question_ids: string[];
  score: number;
  correct_count: number;
  total_count: number;
  points_earned: number;
  internet_codes_earned: number;
  is_passed: boolean;
  started_at: string;
  completed_at: string;
};

type ClassInfo = {
  id: string;
  name: string;
};

type StudentInfo = {
  id: string;
  username: string;
  real_name: string;
  class_id: string;
};

type QuestionMap = Record<string, Question>;

const parseJsonField = (field: any) => {
  if (typeof field === 'string') {
    try {
      return JSON.parse(field);
    } catch {
      return field;
    }
  }
  return field;
};

const getOptions = (options: any) => {
  const parsed = parseJsonField(options);
  return parsed?.options || parsed;
};

const getAnswers = (answers: any) => {
  const parsed = parseJsonField(answers);
  let result = parsed?.answers || parsed;
  if (!Array.isArray(result)) {
    if (typeof result === 'string') {
      return [result];
    }
    return [];
  }
  return result.map(ans => ans?.toString() || '');
};

const getQuestionTypeName = (type: string) => {
  switch (type) {
    case 'choice':
      return '选择题';
    case 'fill_blank':
      return '填空题';
    case 'judge':
      return '判断题';
    default:
      return '其他';
  }
};

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

// 聚类树：一级类目 → 二级类目集合（参考 PracticeModule 实现）
type ClusterTree = Record<string, Set<string>>;

// 把 cluster_id 拆成 [一级, 二级]；无斜杠时二级为空串
const splitCluster = (clusterId: string | null | undefined): [string, string] | null => {
  if (!clusterId || typeof clusterId !== 'string') return null;
  const trimmed = clusterId.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf('/');
  if (idx < 0) return [trimmed, ''];
  const primary = trimmed.slice(0, idx).trim();
  const secondary = trimmed.slice(idx + 1).trim();
  return primary ? [primary, secondary] : null;
};

export const ExamManager: React.FC = () => {
  const [tests, setTests] = useState<ExamTest[]>([]);
  const [examRecords, setExamRecords] = useState<ExamRecord[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionMap, setQuestionMap] = useState<QuestionMap>({});
  const [allTags, setAllTags] = useState<string[]>([]);
  const [clusterTree, setClusterTree] = useState<ClusterTree>({});  // AI 聚类：一级→二级集合
  const [filterClusterPrimary, setFilterClusterPrimary] = useState<string[]>([]);
  const [filterClusterSecondary, setFilterClusterSecondary] = useState<string[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingTest, setEditingTest] = useState<ExamTest | null>(null);
  const [showRecordsModal, setShowRecordsModal] = useState(false);
  const [selectedExam, setSelectedExam] = useState<ExamTest | null>(null);
  const [recordViewMode, setRecordViewMode] = useState<'student' | 'question'>('student');
  const [recordSortField, setRecordSortField] = useState<'username' | 'score'>('username');
  const [recordSortOrder, setRecordSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterClassId, setFilterClassId] = useState<string>('');
  const [selectedQuestion, setSelectedQuestion] = useState<{ question: Question; stats: { correct: number; total: number; rate: number } } | null>(null);
  const [studentAnswersForExam, setStudentAnswersForExam] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    question_ids: [] as string[],
    difficulty: 'medium' as 'easy' | 'medium' | 'hard',
    time_limit: 60,
    passing_score: 60,
    points_reward: 50,
    class_ids: [] as string[],
    allow_view_paper: false,
    allow_internet_code: false,
    internet_code_reward: 0,
    pass_grant_browser: false,
    pass_grant_exchange: false,
    pass_grant_app_center: false,
    question_count: 0,
    is_active: true,
  });
  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'exams' | 'pk_configs' | 'pk_stats'>('exams');

  useEffect(() => {
    fetchData();
  }, []);

  const parseJsonField = (value: any): any => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  };

  const fetchData = async () => {
    const [{ data: testsData }, { data: questionsData }, { data: classesData }, { data: profilesData }] = await Promise.all([
      backendClient.from('tests').select('*').eq('type', 'exam').order('created_at', { ascending: false }),
      backendClient.from('questions').select('*'),
      backendClient.from('classes').select('*'),
      backendClient.from('profiles').select('*').eq('role', 'student'),
    ]);

    if (testsData) {
      const parsedTests = (testsData as ExamTest[]).map(test => ({
        ...test,
        question_ids: Array.isArray(test.question_ids) 
          ? test.question_ids 
          : parseJsonField(test.question_ids) || [],
        class_ids: Array.isArray(test.class_ids)
          ? test.class_ids
          : parseJsonField(test.class_ids) || [],
      }));
      setTests(parsedTests);
    }

    if (questionsData) {
      setQuestions(questionsData as Question[]);
      const map: QuestionMap = {};
      const tagsSet = new Set<string>();
      const tree: ClusterTree = {};
      (questionsData as Question[]).forEach((q) => {
        map[q.id] = q;
        const tags = parseTags(q.tags);
        tags.forEach(tag => tagsSet.add(tag));
        // 聚合 AI 聚类：cluster_id 形如 "信息系统/分类与类型"
        const parts = splitCluster((q as any).cluster_id);
        if (parts) {
          const [primary, secondary] = parts;
          if (!tree[primary]) tree[primary] = new Set();
          if (secondary) tree[primary].add(secondary);
        }
      });
      setQuestionMap(map);
      setAllTags(Array.from(tagsSet).sort());
      // 转成普通对象，便于渲染与排序
      const sortedTree: ClusterTree = {};
      Object.keys(tree).sort().forEach((p) => {
        sortedTree[p] = new Set(Array.from(tree[p]).sort());
      });
      setClusterTree(sortedTree);
    }

    if (classesData) {
      setClasses(classesData as ClassInfo[]);
    }

    if (profilesData) {
      setStudents(profilesData as StudentInfo[]);
    }

    const { data: recordsData } = await backendClient.from('exam_records').select('*').order('completed_at', { ascending: false });
    if (recordsData) {
      setExamRecords(recordsData as ExamRecord[]);
    }

    setLoading(false);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      alert('请输入考试标题');
      return;
    }

    if (formData.question_ids.length === 0) {
      alert('请至少选择一道题目');
      return;
    }

    const data = {
      title: formData.title,
      description: formData.description,
      question_ids: formData.question_ids,
      difficulty: formData.difficulty,
      time_limit: formData.time_limit,
      passing_score: formData.passing_score,
      points_reward: formData.points_reward,
      class_ids: formData.class_ids,
      allow_view_paper: formData.allow_view_paper,
      allow_internet_code: formData.allow_internet_code,
      internet_code_reward: formData.internet_code_reward,
      pass_grant_browser: formData.pass_grant_browser,
      pass_grant_exchange: formData.pass_grant_exchange,
      pass_grant_app_center: formData.pass_grant_app_center,
      question_count: formData.question_ids.length,
      is_active: formData.is_active,
      type: 'exam',
    };

    if (editingTest) {
      await backendClient.from('tests').update(data).eq('id', editingTest.id);
    } else {
      await backendClient.from('tests').insert(data);
    }

    setShowModal(false);
    setEditingTest(null);
    resetForm();
    fetchData();
  };

  const handleDelete = async (testId: string) => {
    if (!window.confirm('确定要删除这场考试吗？')) return;

    await backendClient.from('tests').delete().eq('id', testId);
    fetchData();
  };

  const handleCloseExam = async (test: ExamTest) => {
    if (!window.confirm(`确定要结束考试「${test.title}」吗？\n\n结束后将按以下方式处理学生成绩：\n1. 未参加的学生：记为0分\n2. 已开始但未提交的：用系统保存的答题进度自动评分\n3. 已提交的学生：成绩不变\n\n此操作不可撤销！`)) return;

    try {
      const result = await backendClient.closeExam({ test_id: test.id });
      const data = result?.data || result;
      const msg = `考试已成功结束！\n\n共 ${data?.total_students || '?'} 名学生\n- 强行提交评分：${data?.forced_submit_count || 0} 人\n- 未参加记0分：${data?.no_attend_count || 0} 人`;
      alert(msg);
      fetchData();
    } catch (error) {
      console.error('结束考试失败:', error);
      alert('结束考试失败，请重试');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 场考试吗？此操作不可恢复！`)) return;

    try {
      const batchSize = 50;
      for (let i = 0; i < selectedIds.length; i += batchSize) {
        const batch = selectedIds.slice(i, i + batchSize);
        const { error } = await backendClient.from('tests').delete().in('id', batch);
        if (error) {
          console.error('批量删除失败:', error);
          alert('删除失败: ' + error.message);
          return;
        }
      }
      alert('删除成功！');
      setSelectedIds([]);
      fetchData();
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('删除失败！');
    }
  };

  const handleToggleActive = async (test: ExamTest) => {
    await backendClient.from('tests').update({ is_active: !test.is_active }).eq('id', test.id);
    fetchData();
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      question_ids: [],
      difficulty: 'medium',
      time_limit: 60,
      passing_score: 60,
      points_reward: 50,
      class_ids: [],
      allow_view_paper: false,
      allow_internet_code: false,
      internet_code_reward: 0,
      pass_grant_browser: false,
      pass_grant_exchange: false,
      pass_grant_app_center: false,
      question_count: 0,
      is_active: true,
    });
  };

  const openEditModal = (test?: ExamTest) => {
    if (test) {
      setEditingTest(test);
      const parsedQuestionIds = Array.isArray(test.question_ids) 
        ? test.question_ids 
        : parseJsonField(test.question_ids) || [];
      const parsedClassIds = Array.isArray(test.class_ids)
        ? test.class_ids
        : parseJsonField(test.class_ids) || [];
      setFormData({
        title: test.title,
        description: test.description || '',
        question_ids: parsedQuestionIds,
        difficulty: test.difficulty || 'medium',
        time_limit: test.time_limit || 60,
        passing_score: test.passing_score || 60,
        points_reward: test.points_reward || 50,
        class_ids: parsedClassIds,
        allow_view_paper: test.allow_view_paper || false,
        allow_internet_code: test.allow_internet_code || false,
        internet_code_reward: test.internet_code_reward || 0,
        pass_grant_browser: test.pass_grant_browser === true || test.pass_grant_browser === 1,
        pass_grant_exchange: test.pass_grant_exchange === true || test.pass_grant_exchange === 1,
        pass_grant_app_center: test.pass_grant_app_center === true || test.pass_grant_app_center === 1,
        question_count: test.question_count || parsedQuestionIds.length,
        is_active: test.is_active !== false,
      });
    } else {
      setEditingTest(null);
      resetForm();
    }
    setShowModal(true);
  };

  const openRecordsModal = async (test: ExamTest) => {
    setSelectedExam(test);
    setRecordViewMode('student');
    setFilterClassId('');
    setShowRecordsModal(true);
    
    const { data } = await backendClient
      .from('student_answers')
      .select('*')
      .eq('source', 'exam')
      .eq('test_id', test.id);
    
    setStudentAnswersForExam(data || []);
  };

  const exportExamRecordsToXlsx = () => {
    if (!selectedExam) return;
    
    const examStudentRecords = examRecords
      .filter(r => r.test_id === selectedExam.id)
      .map(record => {
        const student = students.find(s => s.id === record.student_id);
        const studentClass = classes.find(c => c.id === student?.class_id);
        return {
          '学生姓名': student?.real_name || student?.username || '未知学生',
          '用户名': student?.username || '-',
          '班级': studentClass?.name || '-',
          '得分': record.score || 0,
          '正确题数': `${record.correct_count || 0}/${record.total_count || 0}`,
          '正确率': record.total_count > 0 
            ? Math.round((record.correct_count || 0) / record.total_count * 100) + '%' 
            : '0%',
          '获得积分': record.points_earned || 0,
          '获得上网码': record.internet_codes_earned || 0,
          '是否通过': record.is_passed ? '通过' : '未通过',
          '完成时间': record.completed_at ? formatDateTime(record.completed_at) : '-',
        };
      });

    if (filterClassId) {
      const filterClass = classes.find(c => c.id === filterClassId);
      const filteredRecords = examStudentRecords.filter(r => r['班级'] === filterClass?.name);
      if (filteredRecords.length === 0) {
        alert('当前筛选条件下没有数据可导出');
        return;
      }
      const worksheet = XLSX.utils.json_to_sheet(filteredRecords);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '考试情况');
      const fileName = `${selectedExam.title}_${filterClass?.name}_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } else {
      if (examStudentRecords.length === 0) {
        alert('当前没有数据可导出');
        return;
      }
      const worksheet = XLSX.utils.json_to_sheet(examStudentRecords);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '考试情况');
      const fileName = `${selectedExam.title}_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    }
  };

  const toggleQuestionSelection = (questionId: string) => {
    setFormData((prev) => ({
      ...prev,
      question_ids: prev.question_ids.includes(questionId)
        ? prev.question_ids.filter((id) => id !== questionId)
        : [...prev.question_ids, questionId],
    }));
  };

  const selectAllFiltered = () => {
    const filteredIds = filteredQuestions.map(q => q.id);
    const allSelected = filteredIds.every(id => formData.question_ids.includes(id));
    
    if (allSelected) {
      // 取消全选 - 只取消当前筛选结果
      setFormData(prev => ({
        ...prev,
        question_ids: prev.question_ids.filter(id => !filteredIds.includes(id))
      }));
    } else {
      // 全选 - 添加当前筛选结果
      const newIds = new Set([...formData.question_ids, ...filteredIds]);
      setFormData(prev => ({
        ...prev,
        question_ids: Array.from(newIds)
      }));
    }
  };

  // 切换 AI 聚类一级类目：取消选中时同步移除其下属所有已选二级
  const toggleClusterPrimary = (primary: string) => {
    setFilterClusterPrimary((prev) => {
      if (prev.includes(primary)) {
        const prefix = `${primary}/`;
        setFilterClusterSecondary((sec) => sec.filter((s) => !s.startsWith(prefix)));
        return prev.filter((p) => p !== primary);
      }
      return [...prev, primary];
    });
  };

  // 切换 AI 聚类二级类目（full key 形如 "一级/二级"）
  const toggleClusterSecondary = (fullKey: string) => {
    setFilterClusterSecondary((prev) =>
      prev.includes(fullKey)
        ? prev.filter((s) => s !== fullKey)
        : [...prev, fullKey]
    );
  };

  const filteredQuestions = questions.filter((q) => {
    const matchesSearch = q.content.toLowerCase().includes(searchText.toLowerCase());
    let matchesType = true;
    if (filterType) {
      if (filterType === 'fill' || filterType === 'fill_blank') {
        matchesType = q.type === 'fill' || q.type === 'fill_blank';
      } else {
        matchesType = q.type === filterType;
      }
    }
    const tags = parseTags(q.tags);
    const matchesTags = filterTags.length === 0 || filterTags.some(tag => tags.includes(tag));
    // AI 聚类筛选：一级 OR、二级 OR；选了二级时必须命中二级且非空，仅选一级时命中一级即可
    let matchesCluster = true;
    if (filterClusterPrimary.length > 0 || filterClusterSecondary.length > 0) {
      const parts = splitCluster((q as any).cluster_id);
      if (!parts) { matchesCluster = false; }
      else {
        const [primary, secondary] = parts;
        const primaryHit = filterClusterPrimary.length === 0 || filterClusterPrimary.includes(primary);
        if (!primaryHit) {
          matchesCluster = false;
        } else if (filterClusterSecondary.length > 0) {
          if (!secondary) { matchesCluster = false; }
          else {
            const fullKey = `${primary}/${secondary}`;
            matchesCluster = filterClusterSecondary.includes(fullKey);
          }
        }
      }
    }
    return matchesSearch && matchesType && matchesTags && matchesCluster;
  });

  const getQuestionTypeName = (type: string) => {
    const typeMap: Record<string, string> = {
      choice: '选择题',
      fill: '填空题',
      fill_blank: '填空题',
      judge: '判断题',
      code: '编程题',
    };
    return typeMap[type] || type;
  };

  const getDifficultyName = (difficulty: string) => {
    const map: Record<string, string> = {
      easy: '简单',
      medium: '中等',
      hard: '困难',
    };
    return map[difficulty] || difficulty;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶层 tab 切换：考试管理 / 对战配置 */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('exams')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'exams'
              ? 'border-purple-500 text-purple-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className="fa-solid fa-file-pen mr-2"></i>考试管理
        </button>
        <button
          onClick={() => setActiveTab('pk_configs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'pk_configs'
              ? 'border-purple-500 text-purple-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className="fa-solid fa-trophy mr-2"></i>对战配置
        </button>
        <button
          onClick={() => setActiveTab('pk_stats')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'pk_stats'
              ? 'border-purple-500 text-purple-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className="fa-solid fa-chart-simple mr-2"></i>对战数据
        </button>
      </div>

      {activeTab === 'exams' && (
      <>
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-gray-800">考试管理</h3>
        <button
          onClick={() => openEditModal()}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
        >
          <i className="fa-solid fa-plus mr-2"></i>创建考试
        </button>
      </div>

      {tests.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <i className="fa-solid fa-file-alt text-6xl mb-4"></i>
          <p>暂无考试</p>
          <p className="text-sm mt-2">点击上方按钮创建第一场考试</p>
        </div>
      ) : (
        <>
          {/* 批量操作栏 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === tests.length && tests.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(tests.map(t => t.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                    className="rounded w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">
                    全选 {selectedIds.length > 0 && `(${selectedIds.length}/${tests.length})`}
                  </span>
                </label>
              </div>
              {selectedIds.length > 0 && (
                <button
                  onClick={handleBatchDelete}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  <i className="fa-solid fa-trash mr-2"></i>批量删除 ({selectedIds.length})
                </button>
              )}
            </div>
          </div>

          {/* 试卷列表 */}
          <div className="grid gap-4">
            {tests.map((test) => {
            const examRecordsCount = examRecords.filter(r => r.test_id === test.id).length;
            const examTest = test as ExamTest;
            const examClassIds = Array.isArray(examTest.class_ids) ? examTest.class_ids : [];
            const classNames = examClassIds.length > 0 
              ? examClassIds.map(id => classes.find(c => c.id === id)?.name).filter(Boolean).join('、')
              : '全部班级';
            
            return (
              <div key={test.id} className={`bg-white rounded-lg shadow-sm border p-4 ${test.is_active ? 'border-gray-200' : 'border-gray-300 bg-gray-50'}`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(test.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds([...selectedIds, test.id]);
                        } else {
                          setSelectedIds(selectedIds.filter(id => id !== test.id));
                        }
                      }}
                      className="mt-1 rounded w-4 h-4 cursor-pointer"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-gray-800">{test.title}</h4>
                        {!test.is_active && (
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-500 text-xs rounded">已禁用</span>
                        )}
                      </div>
                      {test.description && (
                        <p className="text-sm text-gray-500 mt-1">{test.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openRecordsModal(test)}
                      className="text-purple-600 hover:text-purple-800 text-sm px-2 py-1 bg-purple-50 rounded"
                      title="查看学生考试情况"
                    >
                      <i className="fa-solid fa-chart-bar"></i>
                    </button>
                    <button
                      onClick={() => openEditModal(test)}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      <i className="fa-solid fa-edit"></i>
                    </button>
                    {test.is_active && (
                      <button
                        onClick={() => handleCloseExam(test)}
                        className="text-orange-600 hover:text-orange-800 text-sm"
                        title="结束考试（未参加记0分，未提交的用答题进度评分）"
                      >
                        <i className="fa-solid fa-stop-circle"></i>
                      </button>
                    )}
                    <button
                      onClick={() => handleToggleActive(test)}
                      className={`text-sm ${test.is_active ? 'text-yellow-600 hover:text-yellow-800' : 'text-green-600 hover:text-green-800'}`}
                      title={test.is_active ? '禁用考试' : '启用考试'}
                    >
                      <i className={`fa-solid ${test.is_active ? 'fa-ban' : 'fa-check'}`}></i>
                    </button>
                    <button
                      onClick={() => handleDelete(test.id)}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3">
                  <span>
                    <i className="fa-solid fa-list mr-1"></i>
                    {test.question_ids ? (Array.isArray(test.question_ids) ? test.question_ids.length : 0) : 0} 道题
                  </span>
                  <span>
                    <i className="fa-solid fa-users mr-1"></i>
                    {classNames}
                  </span>
                  <span>
                    <i className="fa-solid fa-clock mr-1"></i>
                    {test.time_limit} 分钟
                  </span>
                  <span>
                    <i className="fa-solid fa-check-circle mr-1"></i>
                    及格 {test.passing_score} 分
                  </span>
                  <span>
                    <i className="fa-solid fa-gift mr-1"></i>
                    奖励 {examTest.points_reward || 50} 积分
                  </span>
                  {examTest.allow_internet_code && examTest.internet_code_reward > 0 && (
                    <span>
                      <i className="fa-solid fa-wifi mr-1"></i>
                      上网码 {examTest.internet_code_reward} 个
                    </span>
                  )}
                  {examTest.allow_view_paper && (
                    <span>
                      <i className="fa-solid fa-eye mr-1"></i>
                      可查看试卷
                    </span>
                  )}
                  <span className={examRecordsCount > 0 ? 'text-purple-600 font-medium' : ''}>
                    <i className="fa-solid fa-user-check mr-1"></i>
                    已参加 {examRecordsCount} 人
                  </span>
                </div>

                {(() => {
                  const questionIds = Array.isArray(test.question_ids) ? test.question_ids : [];
                  if (questionIds.length > 0) {
                    return (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-xs text-gray-500 mb-2">题目预览：</p>
                        <div className="space-y-2">
                          {questionIds.slice(0, 3).map((qId, index) => {
                            const question = questionMap[qId];
                            const questionType = question ? question.type : 'choice';
                            return (
                              <div key={qId} className="text-sm text-gray-700 flex gap-2">
                                <span className="text-gray-400">{index + 1}.</span>
                                <span className="flex-1 truncate">
                                  {question ? htmlToPlainText(question.content) : '题目已删除'}
                                </span>
                                <span className="text-xs text-gray-400">
                                  [{getQuestionTypeName(questionType)}]
                                </span>
                              </div>
                            );
                          })}
                          {questionIds.length > 3 && (
                            <p className="text-xs text-gray-400">
                              ... 还有 {questionIds.length - 3} 道题
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })}
        </div>
        </>
      )}
      </>
      )}

      {activeTab === 'pk_configs' && (
        <PKBattleConfigTab clusterTree={clusterTree} allTags={allTags} />
      )}

      {activeTab === 'pk_stats' && <PKStatsTab />}

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-xl font-bold text-gray-800">
                  {editingTest ? '编辑考试' : '创建考试'}
                </h3>
              </div>

              <div className="p-6 flex-1 overflow-y-auto space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">考试标题</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      placeholder="例如：Python单元测试一"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">难度</label>
                    <select
                      value={formData.difficulty}
                      onChange={(e) => setFormData({ ...formData, difficulty: e.target.value as any })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="easy">简单</option>
                      <option value="medium">中等</option>
                      <option value="hard">困难</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">考试描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    rows={2}
                    placeholder="可选：简要描述考试内容"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">选择班级</label>
                  <div className="space-y-2 border border-gray-300 rounded-lg p-3 max-h-40 overflow-y-auto">
                    <label className="flex items-center gap-2">
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
                    {classes.map((cls) => (
                      <label key={cls.id} className="flex items-center gap-2">
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
                        <span>{cls.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">时间限制（分钟）</label>
                    <input
                      type="number"
                      value={formData.time_limit}
                      onChange={(e) => setFormData({ ...formData, time_limit: parseInt(e.target.value) || 60 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">及格分数</label>
                    <input
                      type="number"
                      value={formData.passing_score}
                      onChange={(e) => setFormData({ ...formData, passing_score: parseInt(e.target.value) || 60 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      min="0"
                      max="100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">及格奖励积分</label>
                    <input
                      type="number"
                      value={formData.points_reward}
                      onChange={(e) => setFormData({ ...formData, points_reward: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      min="0"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                    <input
                      type="checkbox"
                      id="allowInternetCode"
                      checked={formData.allow_internet_code}
                      onChange={(e) => setFormData({ ...formData, allow_internet_code: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <label htmlFor="allowInternetCode" className="text-sm font-medium text-gray-700">
                      启用上网认证码奖励
                    </label>
                    {formData.allow_internet_code && (
                      <input
                        type="number"
                        value={formData.internet_code_reward}
                        onChange={(e) => setFormData({ ...formData, internet_code_reward: parseInt(e.target.value) || 0 })}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                        placeholder="数量"
                        min="0"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                    <input
                      type="checkbox"
                      id="allowViewPaper"
                      checked={formData.allow_view_paper}
                      onChange={(e) => setFormData({ ...formData, allow_view_paper: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <label htmlFor="allowViewPaper" className="text-sm font-medium text-gray-700">
                      允许学生查看试卷
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 border border-sky-200 bg-sky-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="passGrantBrowser"
                    checked={formData.pass_grant_browser}
                    onChange={(e) => setFormData({ ...formData, pass_grant_browser: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="passGrantBrowser" className="text-sm font-medium text-sky-700">
                    及格后允许上网
                  </label>
                  <span className="text-xs text-gray-500">学生及格后自动开通上网权限，并收到系统通知</span>
                </div>

                <div className="flex items-center gap-3 p-3 border border-emerald-200 bg-emerald-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="passGrantExchange"
                    checked={formData.pass_grant_exchange}
                    onChange={(e) => setFormData({ ...formData, pass_grant_exchange: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="passGrantExchange" className="text-sm font-medium text-emerald-700">
                    及格后允许兑换
                  </label>
                  <span className="text-xs text-gray-500">学生及格后自动开通积分兑换模块，并收到系统通知</span>
                </div>

                <div className="flex items-center gap-3 p-3 border border-violet-200 bg-violet-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="passGrantAppCenter"
                    checked={formData.pass_grant_app_center}
                    onChange={(e) => setFormData({ ...formData, pass_grant_app_center: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="passGrantAppCenter" className="text-sm font-medium text-violet-700">
                    及格后允许访问应用中心
                  </label>
                  <span className="text-xs text-gray-500">学生及格后自动开通应用中心访问权限，并收到系统通知</span>
                </div>

                <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="isActive" className="text-sm font-medium text-gray-700">
                    启用考试（关闭后学生无法参加）
                  </label>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="block text-sm font-medium text-gray-700">
                      选择题目（已选 {formData.question_ids.length} 道）
                    </label>
                    <button
                      onClick={() => setShowQuestionSelector(true)}
                      className="px-3 py-1 text-sm bg-purple-100 text-purple-600 rounded-lg hover:bg-purple-200 transition-colors"
                    >
                      <i className="fa-solid fa-plus mr-1"></i>添加题目
                    </button>
                  </div>

                  {formData.question_ids.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                      <i className="fa-solid fa-inbox text-4xl mb-2"></i>
                      <p>暂未选择题目</p>
                      <button
                        onClick={() => setShowQuestionSelector(true)}
                        className="mt-2 text-purple-500 hover:text-purple-700 text-sm"
                      >
                        点击选择题目
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {formData.question_ids.map((qId, index) => {
                        const question = questionMap[qId];
                        const questionType = question ? question.type : 'choice';
                        return (
                          <div
                            key={qId}
                            className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"
                          >
                            <span className="text-gray-400 text-sm">{index + 1}.</span>
                            <span className="flex-1 text-sm truncate">
                              {question ? question.content : '题目已删除'}
                            </span>
                            <span className="text-xs text-gray-400">
                              [{getQuestionTypeName(questionType)}]
                            </span>
                            <button
                              onClick={() => toggleQuestionSelection(qId)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <i className="fa-solid fa-times"></i>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQuestionSelector && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
            onClick={() => setShowQuestionSelector(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-[1400px] h-[92vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">选择题目</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    左侧筛选条件可滚动，右侧题目列表已加大浏览空间
                  </p>
                </div>
                <button
                  onClick={() => setShowQuestionSelector(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="fa-solid fa-times text-xl"></i>
                </button>
              </div>

              <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                {/* 左：筛选条件（独立滚动） */}
                <div className="lg:w-[380px] flex-shrink-0 border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col min-h-0 max-h-[45vh] lg:max-h-none">
                  <div className="p-4 space-y-4 overflow-y-auto flex-1">
                    <input
                      type="text"
                      placeholder="搜索题目内容..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">全部类型</option>
                      <option value="choice">选择题</option>
                      <option value="fill">填空题</option>
                      <option value="fill_blank">填空题</option>
                      <option value="judge">判断题</option>
                      <option value="code">编程题</option>
                    </select>

                    {allTags.length > 0 && (
                      <div>
                        <p className="text-sm text-gray-600 mb-2">
                          标签筛选：
                          {filterTags.length > 0 && (
                            <span className="ml-1 text-blue-600">已选 {filterTags.length}</span>
                          )}
                        </p>
                        <div className="flex flex-wrap gap-1.5 max-h-[150px] overflow-y-auto pr-1">
                          {allTags.map(tag => (
                            <button
                              key={tag}
                              onClick={() => {
                                setFilterTags(prev =>
                                  prev.includes(tag)
                                    ? prev.filter(t => t !== tag)
                                    : [...prev, tag]
                                );
                              }}
                              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                                filterTags.includes(tag)
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                        {filterTags.length > 0 && (
                          <button
                            onClick={() => setFilterTags([])}
                            className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                          >
                            清除标签筛选
                          </button>
                        )}
                      </div>
                    )}

                    {Object.keys(clusterTree).length > 0 && (
                      <div>
                        <p className="text-sm text-gray-600 mb-2">
                          AI 聚类筛选：
                          {(filterClusterPrimary.length > 0 || filterClusterSecondary.length > 0) && (
                            <span className="ml-2 text-violet-600">
                              一级 {filterClusterPrimary.length} / 二级 {filterClusterSecondary.length}
                            </span>
                          )}
                        </p>
                        <div className="space-y-3">
                          {/* 一级类目 */}
                          <div className="border border-gray-200 rounded-lg p-3">
                            <div className="text-xs text-gray-500 mb-2 font-semibold">一级类目</div>
                            <div className="flex flex-wrap gap-1.5 max-h-[130px] overflow-y-auto pr-1">
                              {Object.keys(clusterTree).map((primary) => {
                                const active = filterClusterPrimary.includes(primary);
                                const secondaryCount = (clusterTree[primary] || new Set()).size;
                                return (
                                  <button
                                    key={primary}
                                    onClick={() => toggleClusterPrimary(primary)}
                                    className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                                      active
                                        ? 'bg-violet-500 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                    title={secondaryCount > 0 ? `${secondaryCount} 个二级类目` : '仅一级'}
                                  >
                                    {primary}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {/* 二级类目 */}
                          <div className="border border-gray-200 rounded-lg p-3">
                            <div className="text-xs text-gray-500 mb-2 font-semibold">
                              二级类目
                              <span className="ml-1 text-gray-400">
                                {filterClusterPrimary.length === 0 ? '（先选一级）' : '（已选一级下）'}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 min-h-[32px] max-h-[150px] overflow-y-auto pr-1">
                              {filterClusterPrimary.length === 0 ? (
                                <span className="text-xs text-gray-400 self-center">未选一级类目</span>
                              ) : (() => {
                                const list: { fullKey: string; label: string }[] = [];
                                filterClusterPrimary.forEach((p) => {
                                  Array.from(clusterTree[p] || []).forEach((s) => {
                                    list.push({ fullKey: `${p}/${s}`, label: s });
                                  });
                                });
                                if (list.length === 0) {
                                  return <span className="text-xs text-gray-400 self-center">所选一级下无二级类目</span>;
                                }
                                const seen = new Set<string>();
                                return list.filter((item) => {
                                  if (seen.has(item.fullKey)) return false;
                                  seen.add(item.fullKey);
                                  return true;
                                }).map((item) => {
                                  const active = filterClusterSecondary.includes(item.fullKey);
                                  return (
                                    <button
                                      key={item.fullKey}
                                      onClick={() => toggleClusterSecondary(item.fullKey)}
                                      className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                                        active
                                          ? 'bg-indigo-500 text-white'
                                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                      }`}
                                    >
                                      {item.label}
                                    </button>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </div>
                        {(filterClusterPrimary.length > 0 || filterClusterSecondary.length > 0) && (
                          <button
                            onClick={() => { setFilterClusterPrimary([]); setFilterClusterSecondary([]); }}
                            className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                          >
                            清除聚类筛选
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 右：题目列表（主要浏览空间） */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap flex-shrink-0 bg-gray-50">
                    <span className="text-sm text-gray-600">
                      共 <b className="text-gray-800">{filteredQuestions.length}</b> 道题目
                      {formData.question_ids.length > 0 && (
                        <span className="ml-2 text-blue-600">已选 {formData.question_ids.length} 道</span>
                      )}
                    </span>
                    {filteredQuestions.length > 0 && (
                      <div className="flex gap-2 items-center">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            id="randomCount"
                            min="1"
                            max={filteredQuestions.length}
                            placeholder="数量"
                            className="w-20 px-3 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => {
                              const countInput = document.getElementById('randomCount') as HTMLInputElement;
                              const count = parseInt(countInput.value) || 1;
                              const shuffled = [...filteredQuestions].sort(() => Math.random() - 0.5);
                              const selected = shuffled.slice(0, Math.min(count, filteredQuestions.length));
                              const newIds = new Set([...formData.question_ids, ...selected.map(q => q.id)]);
                              setFormData(prev => ({
                                ...prev,
                                question_ids: Array.from(newIds)
                              }));
                              countInput.value = '';
                            }}
                            className="px-3 py-1 text-sm bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
                          >
                            <i className="fa-solid fa-shuffle mr-1"></i>随机选取
                          </button>
                        </div>
                        <button
                          onClick={selectAllFiltered}
                          className="px-3 py-1 text-sm bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                        >
                          {filteredQuestions.every(q => formData.question_ids.includes(q.id))
                            ? '取消全选'
                            : '一键全选'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
                    {filteredQuestions.map((question) => {
                      const isSelected = formData.question_ids.includes(question.id);
                      return (
                        <div
                          key={question.id}
                          onClick={() => toggleQuestionSelection(question.id)}
                          className={`p-3 rounded-lg cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-100 border-2 border-blue-500'
                              : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                isSelected
                                  ? 'bg-blue-500 border-blue-500'
                                  : 'border-gray-300'
                              }`}
                            >
                              {isSelected && (
                                <i className="fa-solid fa-check text-white text-xs"></i>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800">
                                {htmlToPlainText(question.content)}
                              </p>
                              <div className="flex gap-2 mt-1 text-xs text-gray-500">
                                <span>[{getQuestionTypeName(question.type)}]</span>
                                {(question as any).cluster_id && (
                                  <span className="text-violet-500">{(question as any).cluster_id}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {filteredQuestions.length === 0 && (
                      <div className="text-center py-8 text-gray-400">
                        <i className="fa-solid fa-search text-4xl mb-2"></i>
                        <p>没有找到符合条件的题目</p>
                        <p className="text-sm mt-1">
                          请确保题目开启了"可用于考试"选项
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center flex-shrink-0">
                <p className="text-sm text-gray-600">
                  已选择 {formData.question_ids.length} 道题目
                </p>
                <button
                  onClick={() => setShowQuestionSelector(false)}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  确定
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRecordsModal && selectedExam && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowRecordsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">{selectedExam.title} - 学生考试情况</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {filterClassId ? (
                        <span>班级筛选: {classes.find(c => c.id === filterClassId)?.name}，共 {examRecords.filter(r => r.test_id === selectedExam.id && students.find(s => s.id === r.student_id)?.class_id === filterClassId).length} 人参加</span>
                      ) : (
                        <span>共 {examRecords.filter(r => r.test_id === selectedExam.id).length} 人参加</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowRecordsModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <i className="fa-solid fa-times text-xl"></i>
                  </button>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setRecordViewMode('student')}
                    className={`px-4 py-2 rounded-lg transition-colors ${recordViewMode === 'student' ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                  >
                    <i className="fa-solid fa-user mr-2"></i>按学生查看
                  </button>
                  <button
                    onClick={() => setRecordViewMode('question')}
                    className={`px-4 py-2 rounded-lg transition-colors ${recordViewMode === 'question' ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                  >
                    <i className="fa-solid fa-question mr-2"></i>按题目查看
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {recordViewMode === 'student' ? (
                  <div className="space-y-4">
                    <div className="flex gap-4 items-center flex-wrap">
                      <div className="flex gap-2 items-center">
                        <span className="text-sm text-gray-600">排序：</span>
                        <button
                          onClick={() => {
                            if (recordSortField === 'username') {
                              setRecordSortOrder(recordSortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setRecordSortField('username');
                              setRecordSortOrder('asc');
                            }
                          }}
                          className={`px-3 py-1 text-sm rounded-lg ${recordSortField === 'username' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'}`}
                        >
                          用户名 {recordSortField === 'username' && (recordSortOrder === 'asc' ? '↑' : '↓')}
                        </button>
                        <button
                          onClick={() => {
                            if (recordSortField === 'score') {
                              setRecordSortOrder(recordSortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setRecordSortField('score');
                              setRecordSortOrder('desc');
                            }
                          }}
                          className={`px-3 py-1 text-sm rounded-lg ${recordSortField === 'score' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'}`}
                        >
                          成绩 {recordSortField === 'score' && (recordSortOrder === 'asc' ? '↑' : '↓')}
                        </button>
                      </div>
                      <div className="flex gap-2 items-center">
                        <span className="text-sm text-gray-600">班级筛选：</span>
                        <select
                          value={filterClassId}
                          onChange={(e) => setFilterClassId(e.target.value)}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="">全部班级</option>
                          {classes.map(cls => (
                            <option key={cls.id} value={cls.id}>{cls.name}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={exportExamRecordsToXlsx}
                        className="px-4 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                      >
                        <i className="fa-solid fa-file-excel mr-1"></i>导出Excel
                      </button>
                    </div>
                    
                    {(() => {
                      const examStudentRecords = examRecords
                        .filter(r => r.test_id === selectedExam.id)
                        .filter(r => {
                          if (!filterClassId) return true;
                          const student = students.find(s => s.id === r.student_id);
                          return student?.class_id === filterClassId;
                        })
                        .map(record => ({
                          ...record,
                          student: students.find(s => s.id === record.student_id),
                        }))
                        .sort((a, b) => {
                          if (recordSortField === 'username') {
                            const nameA = a.student?.real_name || a.student?.username || '';
                            const nameB = b.student?.real_name || b.student?.username || '';
                            return recordSortOrder === 'asc' 
                              ? nameA.localeCompare(nameB) 
                              : nameB.localeCompare(nameA);
                          } else {
                            return recordSortOrder === 'asc' 
                              ? (a.score || 0) - (b.score || 0)
                              : (b.score || 0) - (a.score || 0);
                          }
                        });

                      if (examStudentRecords.length === 0) {
                        return (
                          <div className="text-center py-12 text-gray-500">
                            <i className="fa-solid fa-users text-4xl mb-4"></i>
                            <p>暂无学生参加此考试</p>
                          </div>
                        );
                      }

                      return (
                        <div className="bg-gray-50 rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">学生</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">得分</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">正确率</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">获得积分</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">上网码</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">状态</th>
                                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">完成时间</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {examStudentRecords.map((record) => (
                                <tr key={record.id} className="hover:bg-gray-100">
                                  <td className="px-4 py-3">
                                    <div className="font-medium text-gray-800">
                                      {record.student?.real_name || record.student?.username || '未知学生'}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {record.student?.username}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center font-bold text-purple-600">
                                    {record.score || 0}
                                  </td>
                                  <td className="px-4 py-3 text-center text-gray-600">
                                    {record.total_count > 0 
                                      ? Math.round((record.correct_count || 0) / record.total_count * 100) 
                                      : 0}%
                                  </td>
                                  <td className="px-4 py-3 text-center text-green-600">
                                    +{record.points_earned || 0}
                                  </td>
                                  <td className="px-4 py-3 text-center text-purple-600">
                                    +{record.internet_codes_earned || 0}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className={`px-2 py-1 rounded-full text-xs ${
                                      record.is_passed 
                                        ? 'bg-green-100 text-green-600' 
                                        : 'bg-red-100 text-red-600'
                                    }`}>
                                      {record.is_passed ? '通过' : '未通过'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-500">
                                    {record.completed_at 
                                      ? formatDateTime(record.completed_at) 
                                      : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedExam.question_ids.map((qId, index) => {
                      const question = questionMap[qId];
                      if (!question) return null;

                      const answersForQuestion = studentAnswersForExam.filter(
                        (a: any) => a.question_id === qId
                      );
                      
                      const correctCount = answersForQuestion.filter(
                        (a: any) => a.is_correct
                      ).length;
                      
                      const totalCount = answersForQuestion.length;
                      const rate = totalCount > 0 ? Math.round(correctCount / totalCount * 100) : 0;

                      return (
                        <div
                          key={qId}
                          onClick={() => setSelectedQuestion({ 
                            question, 
                            stats: { correct: correctCount, total: totalCount, rate } 
                          })}
                          className="bg-white border border-gray-200 rounded-lg p-4 hover:border-purple-300 cursor-pointer transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-1 bg-purple-100 text-purple-600 rounded text-xs font-medium">
                                  第 {index + 1} 题
                                </span>
                                <span className="text-xs text-gray-500">
                                  [{getQuestionTypeName(question.type)}]
                                </span>
                              </div>
                              <p className="text-gray-800 line-clamp-2">{htmlToPlainText(question.content)}</p>
                            </div>
                            <div className="text-right ml-4">
                              <div className="text-2xl font-bold text-purple-600">{rate}%</div>
                              <div className="text-xs text-gray-500">
                                {correctCount}/{totalCount} 人答对
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedQuestion && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-bold text-gray-800">题目详情</h4>
                    <button
                      onClick={() => setSelectedQuestion(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <i className="fa-solid fa-times"></i>
                    </button>
                  </div>
                  <div className="bg-white rounded-lg p-4 mb-4">
                    <div className="font-medium text-gray-800 mb-4 question-rich-content">
                      <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedQuestion.question.content) }} />
                    </div>
                    {selectedQuestion.question.options && (
                      <div className="space-y-2 mb-4">
                        {getOptions(selectedQuestion.question.options).map((option: string, idx: number) => {
                          const letter = String.fromCharCode(65 + idx);
                          return (
                            <div key={idx} className="flex items-start gap-2">
                              <span className="font-medium">{letter}.</span>
                              <span className="question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(option) }} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="border-t border-gray-200 pt-4">
                      <p className="text-green-600 font-medium mb-2">
                        正确答案: {getAnswers(selectedQuestion.question.answers).join(' / ')}
                      </p>
                      {selectedQuestion.question.explanation && (
                        <div className="text-gray-600 text-sm question-rich-content">
                          <span className="font-medium">解析：</span>
                          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedQuestion.question.explanation) }} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">
                      正确率: <span className="font-bold text-purple-600">{selectedQuestion.stats.rate}%</span>
                      ({selectedQuestion.stats.correct}/{selectedQuestion.stats.total} 人)
                    </span>
                  </div>
                </div>
              )}

              <div className="p-6 border-t border-gray-200">
                <button
                  onClick={() => setShowRecordsModal(false)}
                  className="w-full py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
