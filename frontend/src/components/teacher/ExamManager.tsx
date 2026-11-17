import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Question } from '../../types';
import { formatDateTime } from '../../utils/dateUtils';
import * as XLSX from 'xlsx';
import { sanitizeHtml, htmlToPlainText } from '../../utils/htmlUtils';
import { RichDescription, richTextToPlain } from '../../utils/richDescription';
import { isOperationType } from '../../utils/questionType';
import { AiExplainPlayer, ExplainQuestion } from './AiExplainPlayer';
import { PKBattleConfigTab } from './PKBattleConfigTab';
import { PKStatsTab } from './PKStatsTab';
import { useAuth } from '../../hooks/useAuth';

type ExamTest = {
  id: string;
  title: string;
  description: string;
  question_ids: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  time_limit: number;
  passing_score: number;
  points_reward: number;
  /** 及格奖励钻石（2026-11-11 补）：与普通测试同口径，计入每日钻石产出上限 */
  diamond_reward?: number;
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

/**
 * 「试卷学生考试情况」的一行。
 * is_absent=true 表示该生属于应考范围但**没有交卷**（用学生名单补出来的占位行，
 * 不是真实 exam_records 记录），表格里显示为「未参加」。
 */
type RosterRow = ExamRecord & { student?: StudentInfo; is_absent: boolean };

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
  // AI 语音讲评队列（按题目查看里，单题或高频错题）
  const [explainQueue, setExplainQueue] = useState<ExplainQuestion[] | null>(null);
  const [selectedExam, setSelectedExam] = useState<ExamTest | null>(null);
  const [recordViewMode, setRecordViewMode] = useState<'student' | 'question'>('student');
  const [recordSortField, setRecordSortField] = useState<'username' | 'score'>('username');
  const [recordSortOrder, setRecordSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterClassId, setFilterClassId] = useState<string>('');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    question_ids: [] as string[],
    difficulty: 'medium' as 'easy' | 'medium' | 'hard',
    time_limit: 60,
    passing_score: 60,
    points_reward: 50,
    diamond_reward: 0,
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
  // ---- 2026-11-17 三题型试卷 + 按老师筛选 + 强制开考/结束 ----
  /** 出卷老师筛选：'__mine' = 只看自己出的（默认），'' = 全部 */
  const [filterTeacherId, setFilterTeacherId] = useState<string>('__mine');
  const [teachers, setTeachers] = useState<{ id: string; username: string; real_name: string }[]>([]);
  const me = useAuth().profile;
  /** 编程填空题（python_tasks）当作可选题型，id 统一写成 py: 前缀 */
  const [pythonTasks, setPythonTasks] = useState<any[]>([]);
  const [forceStates, setForceStates] = useState<Record<string, { force_start: boolean; force_end: boolean }>>({});
  /** 整场考试的逐题明细（服务端算好，含选项分布/小题/每空答案分布） */
  const [examAnalysis, setExamAnalysis] = useState<any | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  /** 按题目查看里当前展开的题（一次只展开一张，避免一屏全是明细） */
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  /** 按学生查看里勾选的人（批量重考用） */
  const [selectedRetakeIds, setSelectedRetakeIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  /** 学生的答卷详情弹窗 */
  const [detailStudent, setDetailStudent] = useState<{ id: string; name: string } | null>(null);

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
      // 组卷预览要显示正确答案与解析 → 题库仍需完整字段（教师端，非学生端脱敏路径）。
      // 真正的体积大头是 content/options/explanation，都是预览必需的，暂不投影。
      backendClient.from('questions').select('*'),
      backendClient.from('classes').select('*'),
      // ⛔ 学生名单绝不能 select('*')：profiles 里有 password_hash 等敏感列，
      //    组卷只需要认人（id/账号/姓名/班级）。
      backendClient.from('profiles').selectExact('id, username, real_name, class_id, current_points').eq('role', 'student'),
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

    // 2026-11-17：试卷可混三种题 → 编程填空题要从作业表取（不在 questions 里）
    try {
      const py = await backendClient.from('python_tasks')
        .selectExact('id, title, description, task_type, category, blank_template, blank_answers, total_score, is_active')
        .eq('task_type', 'fill_blank');
      const raw = ((py as any)?.data || []).filter((t: any) => t.is_active !== 0);
      // 按题号排序（第01题、第05题…第65题）：作业表的自然顺序是按创建时间，
      // 组卷时看起来是乱的（2026-11-17 吴老反馈）。没有题号的排到最后。
      const numOf = (t: any) => {
        const m = String(t.title || '').match(/第\s*0*(\d+)\s*题/);
        return m ? parseInt(m[1], 10) : 99999;
      };
      const list = raw.slice().sort((a: any, b: any) =>
        numOf(a) - numOf(b) || String(a.title || '').localeCompare(String(b.title || ''), 'zh')
      );
      setPythonTasks(list);
      // 同时并进 questionMap：已选题目列表、题目预览都靠它按 id 取内容
      setQuestionMap((prev) => {
        const next: QuestionMap = { ...prev };
        list.forEach((t: any) => {
          next[`py:${t.id}`] = {
            id: `py:${t.id}`,
            type: 'python_fill',
            content: t.title || '编程填空',
            options: '[]',
            answers: '{}',
            explanation: '',
            blank_template: t.blank_template || '',
          } as any;
        });
        return next;
      });
    } catch (e) {
      console.warn('[ExamManager] 编程填空题加载失败:', e);
    }

    // 出卷老师清单（按老师筛选用）
    try {
      const t = await backendClient.from('profiles')
        .selectExact('id, username, real_name, role')
        .in('role', ['teacher', 'admin']);
      setTeachers(((t as any)?.data || []).map((x: any) => ({
        id: x.id, username: x.username || '', real_name: x.real_name || '',
      })));
    } catch (e) {
      console.warn('[ExamManager] 老师列表加载失败:', e);
    }

    // 强制开考/强制结束的当前状态
    try {
      const f = await backendClient.getAllExamForce();
      const map: Record<string, { force_start: boolean; force_end: boolean }> = {};
      ((f as any)?.data || []).forEach((x: any) => {
        map[x.test_id] = { force_start: !!x.force_start, force_end: !!x.force_end };
      });
      setForceStates(map);
    } catch (e) {
      console.warn('[ExamManager] 强制状态加载失败:', e);
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
      diamond_reward: formData.diamond_reward,
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

  /** 列表里直接开关「允许学生查看试卷」（2026-11-17） */
  const handleToggleViewPaper = async (test: ExamTest) => {
    const next = !(test as any).allow_view_paper;
    if (next) {
      const ok = window.confirm(
        `允许学生查看「${test.title}」的试卷？\n\n` +
        `· 学生交卷后（或考试结束后）可以在「我的考试记录」里双击这条记录，` +
        `回看题目、正确答案和自己的作答\n` +
        `· 不想让学生看到答案的，考试期间请不要打开这个开关`
      );
      if (!ok) return;
    }
    try {
      await backendClient.from('tests').update({ allow_view_paper: next }).eq('id', test.id);
      await fetchData();
    } catch (e: any) {
      alert(`操作失败：${e?.message || e}`);
    }
  };

  /**
   * 强制开始 / 强制结束（2026-11-17）
   * 只是往 exam_force_controls 写一个指令，真正的执行在学生端心跳里：
   *   force_start → 学生端 5 秒内弹全屏考试窗口（不可关闭/最小化）
   *   force_end   → 学生端显示 60 秒倒计时，到点自动交卷
   * ⛔ 不要在这里直接改 exam_records / student_answers：学生可能还没登录，
   *    由服务端在交卷时统一结算才不会有半截数据。
   */
  const handleForce = async (test: ExamTest, kind: 'start' | 'end') => {
    const cur = forceStates[test.id] || { force_start: false, force_end: false };
    const isOn = kind === 'start' ? cur.force_start : cur.force_end;
    const action: 'start' | 'cancel_start' | 'end' | 'cancel_end' = kind === 'start'
      ? (isOn ? 'cancel_start' : 'start')
      : (isOn ? 'cancel_end' : 'end');
    const msg = kind === 'start'
      ? (isOn
          ? '取消「强制开始」？学生端不再自动弹出这场考试。'
          : `强制全班立即开始「${test.title}」？\n\n学生端会在 5 秒内全屏弹出这场考试，交卷前不能关闭或最小化。`)
      : (isOn
          ? '取消「强制结束」？正在倒计时的学生端会停止倒计时。'
          : `强制结束「${test.title}」？\n\n正在考试的学生端会出现 60 秒倒计时，到点自动交卷。`);
    if (!window.confirm(msg)) return;
    try {
      const r: any = await backendClient.setExamForce(test.id, action);
      if (r?.error) {
        alert(r.error);
        return;
      }
      setForceStates((prev) => ({
        ...prev,
        [test.id]: { force_start: !!r.data.force_start, force_end: !!r.data.force_end },
      }));
    } catch (e: any) {
      alert(e?.message || '操作失败，请重试');
    }
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
      diamond_reward: 0,
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
        diamond_reward: test.diamond_reward || 0,
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

  /** 只刷新逐题明细（不动筛选、不动视图模式） */
  const loadAnalysis = async (test: ExamTest) => {
    setAnalysisLoading(true);
    try {
      const r: any = await backendClient.getExamAnalysis(test.id);
      if (r?.error) console.warn('[考试情况] 统计失败:', r.error);
      else setExamAnalysis(r?.data || null);
    } catch (e) {
      console.warn('[考试情况] 统计失败:', e);
    } finally {
      setAnalysisLoading(false);
    }
  };

  /**
   * 考试情况页的「刷新」（2026-11-17 吴老要求）：
   * 边考试边看的时候，老师不可能每看一次就去刷新整个浏览器。
   * 这里同时刷新两样东西：交卷名单（exam_records）+ 逐题明细（analysis）。
   */
  const refreshRecords = async () => {
    if (!selectedExam || refreshing) return;
    setRefreshing(true);
    try {
      await fetchData();
      await loadAnalysis(selectedExam);
    } finally {
      setRefreshing(false);
    }
  };

  const openRecordsModal = async (test: ExamTest) => {
    setSelectedExam(test);
    setRecordViewMode('student');
    setFilterClassId('');
    setExpandedItem(null);
    setExamAnalysis(null);
    setSelectedRetakeIds([]);
    setShowRecordsModal(true);
    await loadAnalysis(test);
  };

  /**
   * 构造「应考名单」：已交卷的用真实 exam_records，没交卷的补占位行（is_absent=true）。
   *
   * 应考范围 = 试卷指定的班级（class_ids 为空 = 全校学生），再叠加老师在弹窗里选的班级筛选。
   * 这样老师能看到「谁没考」，而不是只看到交了卷的那几个人。
   */
  const buildExamRoster = (exam: ExamTest, classFilter = ''): RosterRow[] => {
    const targetClassIds = Array.isArray(exam.class_ids) ? exam.class_ids : [];
    const recMap = new Map<string, ExamRecord>();
    for (const r of examRecords) {
      if (r.test_id === exam.id && !recMap.has(r.student_id)) recMap.set(r.student_id, r);
    }
    return students
      .filter((s) => {
        if (targetClassIds.length > 0 && !targetClassIds.includes(s.class_id || '')) return false;
        if (classFilter && s.class_id !== classFilter) return false;
        return true;
      })
      .map<RosterRow>((s) => {
        const rec = recMap.get(s.id);
        if (rec) return { ...rec, student: s, is_absent: false };
        return {
          id: `absent:${s.id}`,
          test_id: exam.id,
          student_id: s.id,
          selected_question_ids: [],
          score: 0,
          correct_count: 0,
          total_count: 0,
          points_earned: 0,
          internet_codes_earned: 0,
          is_passed: false,
          started_at: '',
          completed_at: '',
          student: s,
          is_absent: true,
        };
      });
  };

  /**
   * 让某个学生重考：作废他这次成绩，删掉 exam_records 与未交卷的进度。
   * ⛔ 后端按 (test_id, student_id) 精确删，只影响这一个人这一场，其他学生不动。
   */
  const retakeExamFor = async (studentId: string, studentName: string, score?: number | null) => {
    if (!selectedExam) return;
    const scoreText = score == null ? '' : `（当前 ${score} 分）`;
    const ok = window.confirm(
      `让「${studentName}」重考「${selectedExam.title}」？\n\n` +
      `· 这次的成绩${scoreText}将作废，学生可以立刻重新作答\n` +
      `· 已经拿到的积分、上网码不会退回\n` +
      `· 只影响这一个学生，其他同学不受影响`
    );
    if (!ok) return;
    try {
      const res: any = await backendClient.post(`/api/teacher/exams/${selectedExam.id}/retake`, {
        student_ids: [studentId],
      });
      await fetchData();
      alert(
        res?.data?.removed
          ? `已作废，${studentName} 现在可以重考了`
          : `${studentName} 原本就没有交卷记录，现在可以直接重考`
      );
    } catch (e) {
      alert(`操作失败：${(e as Error).message}`);
    }
  };

  /**
   * AI 语音讲评。
   * 传了 question → 只讲这一题；不传 → 讲本卷「正确率最低」的前 10 题（只算有人作答的题）。
   */
  /**
   * 批量重考（2026-11-17）：按学生查看里勾几个人一起作废重考。
   * 后端 /retake 本来就收 student_ids 数组，这里只是补上批量入口。
   * ⛔ 已发的积分/上网码不退回（和单人重考口径一致）。
   */
  const retakeMany = async (ids: string[]) => {
    if (!selectedExam || ids.length === 0) return;
    const ok = window.confirm(
      `让这 ${ids.length} 名学生重考「${selectedExam.title}」？\n\n` +
      `· 他们的本次成绩将作废，可以立刻重新作答\n` +
      `· 已经拿到的积分、上网码不会退回\n` +
      `· 只影响勾选的这些人`
    );
    if (!ok) return;
    try {
      const res: any = await backendClient.post(`/api/teacher/exams/${selectedExam.id}/retake`, {
        student_ids: ids,
      });
      const removed = Number(res?.data?.removed) || 0;
      setSelectedRetakeIds([]);
      await fetchData();
      await loadAnalysis(selectedExam);
      alert(`已作废 ${removed} 人的成绩（其余人原本就没有交卷记录），他们现在可以重考了`);
    } catch (e: any) {
      alert(`操作失败：${e?.message || e}`);
    }
  };

  /**
   * AI 语音讲评（2026-11-17 改口径）
   * 传了 question → 只讲这一题；不传 → 讲本卷「错误率最高」的前 10 道**选择题**。
   *
   * ⛔ 三条规矩：
   *   1. 只讲选择题。综合题没有单一大题答案、编程题是逐空判的，硬塞进选择题讲评器
   *      会把「选项 A/B/C/D」讲成一段错乱的话，吴老明确不要综合题的 AI 讲解。
   *   2. 排序必须是**错误率降序**（正确率升序），第 1 题就是最差的题。
   *      以前列表和讲评各算各的，老师看到「第 10 题才是最差的」，这里统一到一处。
   *   3. 排序依据换成服务端 analysis（不再用前端过滤 student_answers），
   *      抽题考试里每人做的题不同，前端那份列表会漏题。
   */
  const startExamExplain = (only?: Question) => {
    if (only) {
      setExplainQueue([only as unknown as ExplainQuestion]);
      return;
    }
    if (!selectedExam) return;
    const items: any[] = (examAnalysis && examAnalysis.items) || [];
    const rows = items
      .filter((it) => it.kind === 'choice' && Number(it.answered) > 0)
      .slice()
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 10)
      .map((it) => ({
        ...(questionMap[it.item_id] as any),
        id: it.item_id,
        type: 'choice',
        content: it.content,
        options: JSON.stringify(it.options || []),
        wrong_count: Number(it.answered) - Number(it.correct),
        total_attempts: Number(it.answered),
      }))
      .filter((x) => !!x.content);
    if (!rows.length) {
      alert('这场考试没有可讲评的选择题作答数据（AI 讲评只针对选择题）');
      return;
    }
    setExplainQueue(rows as unknown as ExplainQuestion[]);
  };

  const exportExamRecordsToXlsx = () => {
    if (!selectedExam) return;
    
    // 与弹窗用同一份名单（含未参加的占位行），导出时状态列标注「未参加」
    const examStudentRecords = buildExamRoster(selectedExam, filterClassId).map(record => {
        const student = record.student;
        const studentClass = classes.find(c => c.id === student?.class_id);
        const absent = record.is_absent;
        return {
          '学生姓名': student?.real_name || student?.username || '未知学生',
          '用户名': student?.username || '-',
          '班级': studentClass?.name || '-',
          '得分': absent ? '' : (record.score || 0),
          '正确题数': absent ? '' : `${record.correct_count || 0}/${record.total_count || 0}`,
          '正确率': absent
            ? ''
            : (record.total_count > 0
                ? Math.round((record.correct_count || 0) / record.total_count * 100) + '%'
                : '0%'),
          '获得积分': absent ? '' : (record.points_earned || 0),
          '获得上网码': absent ? '' : (record.internet_codes_earned || 0),
          '是否通过': absent ? '未参加' : (record.is_passed ? '通过' : '未通过'),
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

  /**
   * 编程填空题伪装成 Question（2026-11-17）
   * 它们来自 python_tasks（不在 questions 表），id 一律加 `py:` 前缀，
   * 与后端 exam-paper.js 的前缀约定必须一致 —— 改前缀就是改协议。
   */
  const pythonAsQuestions: Question[] = pythonTasks.map((t: any) => ({
    id: `py:${t.id}`,
    type: 'python_fill',
    content: t.title || '编程填空',
    options: '[]',
    answers: '{}',
    explanation: '',
    blank_template: t.blank_template || '',
    _python_task: true,
  } as any));

  /**
   * 组卷可选题目 = 选择题 + 综合题 + 编程填空题。
   * ⛔ 题库里还有 fill_blank / wps_op / access_op，它们**不能**进试卷：
   *    操作题要判文件、题库填空题没启用，混进来交卷时必然判 0 分。
   */
  const paperSelectable = [
    ...questions.filter((q) => q.type === 'choice' || q.type === 'composite'),
    ...pythonAsQuestions,
  ];

  /**
   * 当前组卷的卷面满分（绝对分制，2026-11-17）
   * 与后端 exam-paper.js 的常量必须一致：选择 2 / 综合 20 / 编程填空 10。
   * 后端保存时也会算一遍落库（tests.paper_total），这里是给老师当场看的。
   */
  const formPaperTotal = formData.question_ids.reduce((sum, id) => {
    const q = questionMap[id];
    if (!q) return sum;
    if (q.type === 'composite') return sum + 20;
    if (q.type === 'python_fill') return sum + 10;
    return sum + 2;
  }, 0);

  const filteredQuestions = paperSelectable.filter((q) => {
    if (isOperationType(q.type)) return false;
    const matchesSearch = String(q.content || '').toLowerCase().includes(searchText.toLowerCase());
    let matchesType = true;
    if (filterType) {
      matchesType = q.type === filterType;
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
      composite: '综合题',
      python_fill: '编程填空',
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

  // 按出卷老师筛选后的试卷列表（2026-11-17）
  // ⛔ 「我出的试卷」必须把 created_by 为空的也算进来：v3.6.43 之前创建的试卷
  //    根本没记出卷人（2026-11-17 吴老的 teacher 账号建的卷子只能在全部分类里找到）。
  const mineId = me?.id || '';
  const visibleTests = filterTeacherId === '__mine'
    ? (mineId
        ? tests.filter((t) => (t as any).created_by === mineId || !(t as any).created_by)
        : tests)
    : filterTeacherId === ''
      ? tests
      : tests.filter((t) => (t as any).created_by === filterTeacherId);

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
          <i className="fa-solid fa-file-pen mr-2"></i>试卷管理
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
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-gray-800">试卷管理</h3>
          {/* 按出卷老师筛选（2026-11-17）：默认只看自己出的卷，同科老师共用平台时列表不至于混成一锅 */}
          <select
            value={filterTeacherId}
            onChange={(e) => setFilterTeacherId(e.target.value)}
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 focus:border-purple-400 focus:outline-none"
          >
            <option value="__mine">我出的试卷</option>
            <option value="">全部老师</option>
            {teachers
              .filter((t) => t.id !== (me?.id || ''))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.real_name || t.username || t.id}
                </option>
              ))}
          </select>
          <span className="text-xs text-gray-400">
            共 {visibleTests.length} 份
          </span>
        </div>
        <button
          onClick={() => openEditModal()}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
        >
          <i className="fa-solid fa-plus mr-2"></i>创建考试
        </button>
      </div>

      {visibleTests.length === 0 ? (
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
                    checked={selectedIds.length === visibleTests.length && visibleTests.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(visibleTests.map(t => t.id));
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
            {visibleTests.map((test) => {
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
                      </div>
                      {test.description && (
                        <p className="text-sm text-gray-500 mt-1">{test.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {/* 启用/禁用：放在按钮区最左边、和「可看试卷」同一号字（2026-11-17 吴老反馈原来太小） */}
                    <button
                      onClick={() => handleToggleActive(test)}
                      className={`text-xs px-2 py-1 rounded border ${
                        test.is_active
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-gray-300 bg-gray-100 text-gray-500 hover:border-emerald-300 hover:text-emerald-600'
                      }`}
                      title={test.is_active
                        ? '已启用：学生可以看到并参加这场考试（点此禁用）'
                        : '已禁用：学生看不到这场考试（点此启用）'}
                    >
                      <i className={`fa-solid ${test.is_active ? 'fa-toggle-on' : 'fa-toggle-off'} mr-1`}></i>
                      {test.is_active ? '已启用' : '已禁用'}
                    </button>
                    {/* 强制开始 / 强制结束（2026-11-17）：靠学生端心跳下发指令。
                        不是同一件事：强制开始是把学生"抓进"考试窗口，强制结束是让他们 1 分钟后交卷。 */}
                    <button
                      onClick={() => handleForce(test, 'start')}
                      className={`text-xs px-2 py-1 rounded border ${
                        forceStates[test.id]?.force_start
                          ? 'border-rose-300 bg-rose-50 text-rose-600'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-rose-300 hover:text-rose-600'
                      }`}
                      title={forceStates[test.id]?.force_start
                        ? '取消强制开始（学生端不再自动弹出这场考试）'
                        : '强制开始：学生端全屏弹出这场考试，不能关闭或最小化'}
                    >
                      <i className={`fa-solid ${forceStates[test.id]?.force_start ? 'fa-toggle-on' : 'fa-toggle-off'} mr-1`}></i>
                      强制开始
                    </button>
                    <button
                      onClick={() => handleForce(test, 'end')}
                      className={`text-xs px-2 py-1 rounded border ${
                        forceStates[test.id]?.force_end
                          ? 'border-red-300 bg-red-50 text-red-600'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-red-300 hover:text-red-600'
                      }`}
                      title={forceStates[test.id]?.force_end
                        ? '取消强制结束（倒计时停止）'
                        : '强制结束：学生端 1 分钟倒计时后自动交卷'}
                    >
                      <i className={`fa-solid ${forceStates[test.id]?.force_end ? 'fa-toggle-on' : 'fa-toggle-off'} mr-1`}></i>
                      强制结束
                    </button>
                    {/* 允许学生查看试卷：原来只能进编辑弹窗改，列表里直接给个开关（2026-11-17） */}
                    <button
                      onClick={() => handleToggleViewPaper(test)}
                      className={`text-xs px-2 py-1 rounded border ${
                        (test as any).allow_view_paper
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-300 hover:text-emerald-600'
                      }`}
                      title={(test as any).allow_view_paper
                        ? '学生可以看到这场考试的试卷（点此关闭）'
                        : '学生看不到试卷（点此打开：允许学生交卷后回看题目与答案）'}
                    >
                      <i className={`fa-solid ${(test as any).allow_view_paper ? 'fa-eye' : 'fa-eye-slash'} mr-1`}></i>
                      可看试卷
                    </button>
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
                  {(examTest.diamond_reward || 0) > 0 && (
                    <span>
                      <i className="fa-solid fa-gem mr-1"></i>
                      奖励 {examTest.diamond_reward} 钻石
                    </span>
                  )}
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

                {/* 卷面满分（绝对分制）：老师排完题就能看到这张卷值多少分、怎么算的 */}
                {(test as any).paper_total > 0 && (
                  <p className="mt-2 text-xs text-gray-400">
                    卷面满分 <b className="text-gray-600">{(test as any).paper_total}</b> 分
                    <span className="ml-1">
                      （选择 2 分 / 综合 20 分 / 编程 10 分，共{' '}
                      {Array.isArray(test.question_ids) ? test.question_ids.length : 0} 题）
                    </span>
                  </p>
                )}
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      及格分数
                      {formPaperTotal > 0 && (
                        <span className="ml-1.5 rounded bg-purple-50 px-1.5 py-0.5 text-xs font-normal text-purple-700">
                          卷面满分 {formPaperTotal} 分
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={formData.passing_score}
                        onChange={(e) => setFormData({ ...formData, passing_score: parseInt(e.target.value) || 0 })}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 ${
                          formPaperTotal > 0 && formData.passing_score > formPaperTotal
                            ? 'border-red-400 bg-red-50'
                            : 'border-gray-300'
                        }`}
                        min="0"
                        max={formPaperTotal || 100}
                      />
                      {formPaperTotal > 0 && (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, passing_score: Math.round(formPaperTotal * 0.6) })}
                          className="flex-shrink-0 rounded-lg border border-purple-200 bg-purple-50 px-2 py-2 text-xs text-purple-700 hover:bg-purple-100"
                          title={`按卷面满分的 60% 填入：${Math.round(formPaperTotal * 0.6)} 分`}
                        >
                          按 60%
                        </button>
                      )}
                    </div>
                    {formPaperTotal > 0 && formData.passing_score > formPaperTotal && (
                      <p className="mt-1 text-xs font-medium text-red-500">
                        及格线比卷面满分（{formPaperTotal} 分）还高，全班都会不及格
                      </p>
                    )}
                    {formPaperTotal > 0 && formData.passing_score <= formPaperTotal && (
                      <p className="mt-1 text-xs text-gray-400">
                        这张卷满分 {formPaperTotal} 分（选择 2 分 / 综合 20 分 / 编程填空 10 分）
                      </p>
                    )}
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      及格奖励钻石
                      <span className="ml-1.5 text-xs font-normal text-gray-400">计入每日上限</span>
                    </label>
                    <input
                      type="number"
                      value={formData.diamond_reward}
                      onChange={(e) => setFormData({ ...formData, diamond_reward: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      min="0"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">
                      及格才发，与测试 / 任务共用「每日钻石产出上限」；填 0 = 不发
                    </p>
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
                      选择题目（已选 {formData.question_ids.length} 道
                      {formPaperTotal > 0 && <span className="ml-1 text-purple-600">· 卷面 {formPaperTotal} 分</span>}）
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
                      <option value="">全部题型</option>
                      <option value="choice">选择题（2 分/题）</option>
                      <option value="composite">综合题（20 分/题）</option>
                      <option value="python_fill">编程填空（10 分/题）</option>
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
                      {(() => {
                        const roster = buildExamRoster(selectedExam, filterClassId);
                        const joined = roster.filter((r) => !r.is_absent).length;
                        // 平均分只算真正交卷的（completed_at 非空）：缺考与开考未交都按 0 计入会把平均分拉低
                        const submittedRows = roster.filter((r) => !r.is_absent && !!r.completed_at);
                        const absent = roster.length - joined;
                        const clsName = classes.find((c) => c.id === filterClassId)?.name;
                        const avg = submittedRows.length
                          ? Math.round(
                              (submittedRows.reduce((sum, r) => sum + (Number(r.score) || 0), 0) /
                                submittedRows.length) *
                                10
                            ) / 10
                          : null;
                        return (
                          <span>
                            {filterClassId ? `班级筛选: ${clsName}，` : ''}
                            应考 <b className="text-gray-700">{roster.length}</b> 人 ·
                            已参加 <b className="text-purple-600">{joined}</b> 人 ·
                            未参加 <b className={absent > 0 ? 'text-amber-600' : 'text-gray-400'}>{absent}</b> 人 ·
                            平均分 <b className="text-blue-600">{avg == null ? '—' : avg}</b>
                          </span>
                        );
                      })()}
                    </p>

                    {/* 各班平均分：点一下直接按该班筛选，再点一下取消（与下方班级下拉联动） */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-gray-500 mr-0.5">各班平均分：</span>
                      {(() => {
                        const full = buildExamRoster(selectedExam, '');
                        const map = new Map<
                          string,
                          { name: string; sum: number; n: number; absent: number; total: number }
                        >();
                        for (const r of full) {
                          const cid = r.student?.class_id || '';
                          const nm = classes.find((c) => c.id === cid)?.name || '未分班';
                          const e = map.get(cid) || { name: nm, sum: 0, n: 0, absent: 0, total: 0 };
                          e.total += 1;
                          // 没交卷（缺考或开考未交）都不计入平均分，只记在"缺考"里
                          if (r.is_absent || !r.completed_at) e.absent += 1;
                          else {
                            e.sum += Number(r.score) || 0;
                            e.n += 1;
                          }
                          map.set(cid, e);
                        }
                        const list = [...map.entries()].sort((a, b) =>
                          a[1].name.localeCompare(b[1].name, 'zh-CN')
                        );
                        if (!list.length) return <span className="text-xs text-gray-400">—</span>;
                        return list.map(([cid, e]) => {
                          const classAvg = e.n ? Math.round((e.sum / e.n) * 10) / 10 : null;
                          const active = filterClassId === cid;
                          return (
                            <button
                              key={cid || 'no-class'}
                              type="button"
                              onClick={() => setFilterClassId(active ? '' : cid)}
                              title={`${e.name}：应考 ${e.total} 人，已交 ${e.n} 人，缺考 ${e.absent} 人${
                                classAvg == null ? '，尚无人交卷' : `，平均 ${classAvg} 分`
                              }`}
                              className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                                active
                                  ? 'bg-purple-100 border-purple-300 text-purple-700 font-medium'
                                  : 'bg-white border-gray-200 text-gray-600 hover:border-purple-300 hover:text-purple-600'
                              }`}
                            >
                              {e.name}
                              <span className="mx-1 text-gray-300">|</span>
                              <span className={classAvg == null ? 'text-gray-300' : 'font-medium'}>
                                {classAvg == null ? '无人交卷' : `均 ${classAvg}`}
                              </span>
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 刷新：边考边看时不用再刷浏览器（2026-11-17 吴老要求） */}
                    <button
                      onClick={refreshRecords}
                      disabled={refreshing}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:border-purple-300 hover:text-purple-600 disabled:opacity-60"
                      title="重新拉取交卷名单与逐题统计（不用刷新浏览器）"
                    >
                      <i className={`fa-solid fa-rotate ${refreshing ? 'fa-spin' : ''}`}></i>
                      {refreshing ? '刷新中' : '刷新'}
                    </button>
                    <button
                      onClick={() => setShowRecordsModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <i className="fa-solid fa-times text-xl"></i>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
                  <div className="flex gap-2">
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
                  {recordViewMode === 'student' && selectedRetakeIds.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">已选 {selectedRetakeIds.length} 人</span>
                      <button
                        onClick={() => setSelectedRetakeIds([])}
                        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        清空
                      </button>
                      <button
                        onClick={() => retakeMany(selectedRetakeIds)}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm text-white hover:bg-amber-600"
                        title="作废这些人的本次成绩，让他们重新做一遍"
                      >
                        <i className="fa-solid fa-rotate-left mr-1"></i>
                        批量重考
                      </button>
                    </div>
                  )}
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
                      // 应考名单（含未参加的学生，占位行排在后面并标注「未参加」）
                      const examStudentRecords = buildExamRoster(selectedExam, filterClassId)
                        .sort((a, b) => {
                          if (recordSortField === 'username') {
                            const nameA = a.student?.real_name || a.student?.username || '';
                            const nameB = b.student?.real_name || b.student?.username || '';
                            return recordSortOrder === 'asc' 
                              ? nameA.localeCompare(nameB) 
                              : nameB.localeCompare(nameA);
                          } else {
                            // 按成绩排序时未参加的恒排最后（0 分不是最差，是没考）
                            if (a.is_absent !== b.is_absent) return a.is_absent ? 1 : -1;
                            return recordSortOrder === 'asc' 
                              ? (a.score || 0) - (b.score || 0)
                              : (b.score || 0) - (a.score || 0);
                          }
                        });

                      if (examStudentRecords.length === 0) {
                        return (
                          <div className="text-center py-12 text-gray-500">
                            <i className="fa-solid fa-users text-4xl mb-4"></i>
                            <p>该筛选范围内没有学生</p>
                          </div>
                        );
                      }

                      return (
                        <div className="bg-gray-50 rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-10">
                                  {/* 全选：只勾「能重考的人」（缺考的本来就能直接参加，不用作废成绩） */}
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded cursor-pointer"
                                    title="全选（只选已交卷的人）"
                                    checked={
                                      examStudentRecords.filter((r) => !r.is_absent).length > 0 &&
                                      examStudentRecords.filter((r) => !r.is_absent)
                                        .every((r) => selectedRetakeIds.includes(r.student_id))
                                    }
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedRetakeIds(examStudentRecords.filter((r) => !r.is_absent).map((r) => r.student_id));
                                      } else {
                                        setSelectedRetakeIds([]);
                                      }
                                    }}
                                  />
                                </th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">学生</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">得分</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">正确率</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">获得积分</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">上网码</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">状态</th>
                                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">完成时间</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {examStudentRecords.map((record) => (
                                <tr
                                  key={record.id}
                                  className={record.is_absent ? 'bg-gray-50/60' : 'hover:bg-gray-100'}
                                >
                                  <td className="px-4 py-3 text-center">
                                    {!record.is_absent && (
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded cursor-pointer"
                                        checked={selectedRetakeIds.includes(record.student_id)}
                                        onChange={(e) => {
                                          setSelectedRetakeIds((prev) => e.target.checked
                                            ? [...prev, record.student_id]
                                            : prev.filter((x) => x !== record.student_id));
                                        }}
                                      />
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className={`flex flex-wrap items-center gap-2 font-medium ${record.is_absent ? 'text-gray-500' : 'text-gray-800'}`}>
                                      <button
                                        type="button"
                                        onClick={() => setDetailStudent({ id: record.student_id, name: record.student?.real_name || record.student?.username || '未知学生' })}
                                        className="text-left text-purple-700 underline decoration-dotted underline-offset-2 hover:text-purple-900"
                                        title="查看这名学生的逐题作答"
                                      >
                                        {record.student?.real_name || record.student?.username || '未知学生'}
                                      </button>
                                      {/* 取卷电脑的 IP（2026-11-17）：按 IP 找同桌机器，比对答案是否雷同 */}
                                      {(record as any).client_ip && (
                                        <span
                                          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-normal text-slate-600"
                                          title="这场考试取卷时用的电脑 IP，同一台机器 IP 相同"
                                        >
                                          {(record as any).client_ip}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {record.student?.username}
                                      {(record as any).inactive_count > 0 && (
                                        <span className="ml-1 text-amber-600" title="考试期间切出平台的次数">
                                          · 切屏 {(record as any).inactive_count} 次
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className={`px-4 py-3 text-center font-bold ${record.is_absent ? 'text-gray-300' : 'text-purple-600'}`}>
                                    {record.is_absent ? '—' : `${record.score || 0} / ${(record as any).paper_total || 100}`}
                                  </td>
                                  <td className="px-4 py-3 text-center text-gray-600">
                                    {record.is_absent
                                      ? '—'
                                      : `${record.total_count > 0
                                          ? Math.round((record.correct_count || 0) / record.total_count * 100)
                                          : 0}%`}
                                  </td>
                                  <td className="px-4 py-3 text-center text-green-600">
                                    {record.is_absent ? '—' : `+${record.points_earned || 0}`}
                                  </td>
                                  <td className="px-4 py-3 text-center text-purple-600">
                                    {record.is_absent ? '—' : `+${record.internet_codes_earned || 0}`}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {record.is_absent ? (
                                      <span className="px-2 py-1 rounded-full text-xs bg-gray-200 text-gray-500">
                                        未参加
                                      </span>
                                    ) : (
                                      <span className={`px-2 py-1 rounded-full text-xs ${
                                        record.is_passed 
                                          ? 'bg-green-100 text-green-600' 
                                          : 'bg-red-100 text-red-600'
                                      }`}>
                                        {record.is_passed ? '通过' : '未通过'}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-500">
                                    {record.is_absent
                                      ? '-'
                                      : (record.completed_at ? formatDateTime(record.completed_at) : '-')}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {record.is_absent ? (
                                      <span className="text-xs text-gray-400">可直接参加</span>
                                    ) : (
                                      <button
                                        onClick={() => retakeExamFor(record.student_id, record.student?.real_name || record.student?.username || '该学生', record.score)}
                                        className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
                                        title="作废这次成绩，让学生重新做一遍"
                                      >
                                        <i className="fa-solid fa-rotate-left mr-1"></i>重考
                                      </button>
                                    )}
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
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-indigo-50 px-4 py-2.5">
                      <div className="text-sm text-indigo-800">
                        按正确率从低到高排列，<b>第 1 张就是错得最多的题</b>。
                        <span className="ml-1 text-indigo-500">
                          （选择 2 分 / 综合 20 分 / 编程填空 10 分，综合题按小题、编程题按空结分；AI 讲评只针对选择题）
                        </span>
                      </div>
                      <button
                        onClick={() => startExamExplain()}
                        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
                      >
                        <i className="fa-solid fa-volume-high"></i>
                        AI 讲评高频错题（10 题）
                      </button>
                    </div>

                    {analysisLoading && (
                      <div className="py-10 text-center text-gray-400">
                        <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>正在统计作答明细…
                      </div>
                    )}

                    {!analysisLoading && !examAnalysis && (
                      <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-gray-400">
                        暂无作答数据
                      </div>
                    )}

                    {!analysisLoading && examAnalysis && examAnalysis.items.length === 0 && (
                      <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-gray-400">
                        这场考试还没有可统计的题目（题目可能已被删除）
                      </div>
                    )}

                    {!analysisLoading && examAnalysis && (examAnalysis.items as any[])
                      .slice()
                      .sort((a, b) => a.rate - b.rate)
                      .map((it, idx) => (
                        <div key={it.item_id} className="rounded-lg border border-gray-200 bg-white">
                          <button
                            type="button"
                            onClick={() => setExpandedItem(expandedItem === it.item_id ? null : it.item_id)}
                            className="flex w-full items-start justify-between gap-4 p-4 text-left hover:bg-gray-50"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-600">
                                  第 {idx + 1} 题
                                </span>
                                <span className={`rounded px-2 py-0.5 text-xs ${
                                  it.kind === 'composite'
                                    ? 'bg-indigo-100 text-indigo-600'
                                    : it.kind === 'python'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : 'bg-blue-100 text-blue-600'
                                }`}>
                                  {it.kind === 'composite' ? '综合题' : it.kind === 'python' ? '编程填空' : '选择题'}
                                </span>
                                <span className="text-xs text-gray-500">{it.score} 分</span>
                                <span className="text-xs text-gray-400">作答 {it.answered} 人</span>
                              </div>
                              <p className="line-clamp-2 text-gray-800">{htmlToPlainText(it.content)}</p>
                            </div>
                            <div className="flex-none text-right">
                              <div className={`text-2xl font-bold ${it.rate < 50 ? 'text-red-500' : 'text-purple-600'}`}>
                                {it.rate}%
                              </div>
                              <div className="text-xs text-gray-500">
                                {it.correct}/{it.answered} 全对
                              </div>
                              <div className="text-xs text-gray-400">均 {it.avg_score} 分</div>
                              <i className={`fa-solid fa-chevron-${expandedItem === it.item_id ? 'up' : 'down'} mt-1 text-xs text-gray-300`}></i>
                            </div>
                          </button>

                          {expandedItem === it.item_id && (
                            <div className="space-y-4 border-t border-gray-100 p-4">
                              {it.kind === 'choice' && (
                                <div className="space-y-2">
                                  <p className="text-xs text-gray-500">
                                    各选项被选比例（正确答案 <b className="text-green-600">{it.correct_answer || '—'}</b>）
                                  </p>
                                  {(it.options_stats || []).map((o: any) => (
                                    <div key={o.letter} className="flex items-center gap-2">
                                      <span className={`w-4 flex-none text-sm font-bold ${o.is_correct ? 'text-green-600' : 'text-gray-500'}`}>
                                        {o.letter}
                                      </span>
                                      <span className={`min-w-0 flex-1 break-words text-xs leading-4 ${o.is_correct ? 'text-green-700' : 'text-gray-600'}`} title={o.text}>
                                        {o.text || '（图片选项）'}
                                      </span>
                                      <div className="h-3 w-24 flex-none overflow-hidden rounded bg-gray-100">
                                        <div
                                          className={`h-full rounded ${o.is_correct ? 'bg-green-400' : 'bg-gray-400'}`}
                                          style={{ width: `${Math.min(100, o.ratio)}%` }}
                                        ></div>
                                      </div>
                                      <span className="w-24 flex-none text-right text-xs text-gray-500">
                                        {o.count} 人 · {o.ratio}%
                                      </span>
                                      {o.is_correct && <i className="fa-solid fa-check flex-none text-xs text-green-500"></i>}
                                    </div>
                                  ))}
                                  {it.answered === 0 && (
                                    <p className="text-xs text-gray-400">还没有人作答这道题</p>
                                  )}
                                  <div className="flex justify-end pt-1">
                                    <button
                                      onClick={() => {
                                        const q = questionMap[it.item_id];
                                        if (q) startExamExplain(q);
                                      }}
                                      className="flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
                                    >
                                      <i className="fa-solid fa-volume-high"></i>
                                      AI 讲解这一题
                                    </button>
                                  </div>
                                </div>
                              )}

                              {it.kind === 'composite' && (
                                <div className="space-y-3">
                                  <p className="text-xs text-gray-500">
                                    综合题按小题给分：答对几个小题就拿几个小题的分（整题 {it.score} 分）
                                  </p>
                                  {(it.subs_stats || []).map((s: any, si: number) => (
                                    <div key={si} className="rounded border border-gray-100 bg-gray-50 p-3">
                                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                                        <span className="rounded bg-white px-1.5 py-0.5 font-medium text-purple-600">第 {s.index ?? si + 1} 小题</span>
                                        <span className="text-gray-500">{s.type === 'choice' ? '选择' : '填空'} · {s.score} 分</span>
                                        <span className="text-gray-400">作答 {s.answered} 人</span>
                                      </div>
                                      <div className="mb-2 line-clamp-2 text-sm text-gray-700">{htmlToPlainText(s.content)}</div>
                                      {s.type === 'choice' && (s.options_stats || []).length > 0 && (
                                        <div className="space-y-1">
                                          {(s.options_stats || []).map((o: any) => (
                                            <div key={o.letter} className="rounded border border-gray-100 bg-white p-1.5">
                                              <div className="flex items-start gap-1.5">
                                                <span className={`w-4 flex-none text-xs font-bold ${o.is_correct ? 'text-green-600' : 'text-gray-500'}`}>
                                                  {o.letter}
                                                </span>
                                                {/* 选项正文：只给 A/B/C/D 没法边投屏边讲（2026-11-17 吴老反馈） */}
                                                <span className={`flex-1 text-[11px] leading-4 question-rich-content ${o.is_correct ? 'text-green-700' : 'text-gray-700'}`}>
                                                  {o.text || '（图片选项）'}
                                                </span>
                                                <span className="w-20 flex-none text-right text-[11px] text-gray-500">
                                                  {o.count} 人 · {o.ratio}%
                                                </span>
                                                {o.is_correct && <i className="fa-solid fa-check flex-none text-[10px] text-green-500"></i>}
                                              </div>
                                              <div className="ml-5 mt-1 h-1.5 overflow-hidden rounded bg-gray-100">
                                                <div
                                                  className={`h-full rounded ${o.is_correct ? 'bg-green-400' : 'bg-indigo-400'}`}
                                                  style={{ width: `${Math.min(100, o.ratio)}%` }}
                                                ></div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {s.type === 'fill_blank' && (
                                        <div className="space-y-1">
                                          {(s.answers || []).length === 0 && (
                                            <p className="text-xs text-gray-400">还没有人填这一小题</p>
                                          )}
                                          {(s.answers || []).map((a: any, ai: number) => (
                                            <div key={ai} className="flex items-center gap-2 text-xs">
                                              <span className="flex-1 truncate font-mono text-gray-700" title={a.text}>{a.text}</span>
                                              <span className="flex-none text-gray-500">{a.count} 人</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {it.kind === 'python' && (
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs text-gray-500">
                                      每一空的实际填充（不论对错，按人数排序）—— 老师一眼能看出全班卡在哪一空
                                    </p>
                                    <button
                                      onClick={() => startExamExplain({
                                        id: it.item_id,
                                        type: 'python_fill',
                                        content: `${it.content}${it.description ? `\n\n【题目要求】\n${richTextToPlain(it.description, '（此处是图片）')}` : ''}\n\n【代码模板】\n${it.blank_template}\n\n【每空标准答案】\n${(it.blanks_stats || [])
                                          .map((b: any) => `第${b.index}空：${(b.accept || []).join('  或  ') || '（未配置）'}`)
                                          .join('\n')}`,
                                        options: '[]',
                                        answers: '{}',
                                      } as any)}
                                      className="flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
                                    >
                                      <i className="fa-solid fa-volume-high"></i>
                                      AI 讲解
                                    </button>
                                  </div>
                                  <pre className="overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs leading-6 text-slate-700">
                                    {it.blank_template || '（无模板）'}
                                  </pre>
                                  {/* 题目要求（含图片）：老师按题目查看时也要能看到题干，不只是模板 */}
                                  {it.description && (
                                    <RichDescription
                                      text={it.description}
                                      className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-gray-700"
                                    />
                                  )}
                                  {(it.blanks_stats || []).map((b: any) => (
                                    <div key={b.index} className="rounded border border-gray-100 bg-white p-3">
                                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">第 {b.index} 空</span>
                                        <span className="text-gray-500">{b.answered} 人作答</span>
                                        <span className="text-amber-600">{b.distinct} 种不同答案</span>
                                      </div>
                                      {(b.answers || []).length === 0 && (
                                        <p className="text-xs text-gray-400">这一空没有人填</p>
                                      )}
                                      <div className="space-y-1">
                                        {(b.answers || []).map((a: any, ai: number) => {
                                          const isStd = (b.accept || []).some(
                                            (x: string) => String(x).replace(/\s+/g, '').toLowerCase() === String(a.text).replace(/\s+/g, '').toLowerCase()
                                          );
                                          return (
                                            <div key={ai} className="flex items-center gap-2 text-xs">
                                              <span className={`flex-1 truncate font-mono ${isStd ? 'text-green-700' : 'text-gray-700'}`} title={a.text}>
                                                {a.text}
                                              </span>
                                              {isStd && <span className="flex-none rounded bg-green-50 px-1 text-[10px] text-green-600">标准答案</span>}
                                              <span className="w-14 flex-none text-right text-gray-500">{a.count} 人</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {(b.accept || []).length > 0 && (
                                        <p className="mt-2 text-[11px] text-gray-400">
                                          可接受答案：<span className="font-mono text-gray-600">{(b.accept || []).join('  或  ')}</span>
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>


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

      {/* 学生答卷详情（2026-11-17）：点姓名弹出，逐题看作答与对错 */}
      <AnimatePresence>
        {detailStudent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setDetailStudent(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">
                    {detailStudent.name} 的答卷
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {selectedExam?.title} · 每题显示「得分 / 满分」与作答内容
                  </p>
                </div>
                <button
                  onClick={() => setDetailStudent(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="fa-solid fa-times text-lg"></i>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {(() => {
                  const items: any[] = (examAnalysis && examAnalysis.items) || [];
                  const mine = new Map<string, any>(
                    ((examAnalysis && examAnalysis.answers) || [])
                      .filter((a: any) => a.student_id === detailStudent.id)
                      .map((a: any) => [a.question_id, a])
                  );
                  if (!items.length) {
                    return <p className="py-10 text-center text-gray-400">暂无数据</p>;
                  }
                  const totalScore = [...mine.values()].reduce((s, a) => s + (Number(a.credit) || 0), 0);
                  const totalMax = [...mine.values()].reduce((s, a) => s + (Number(a.max) || 0), 0);
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between rounded-lg bg-purple-50 px-4 py-2 text-sm text-purple-800">
                        <span>
                          已作答 <b>{mine.size}</b> / {items.length} 题
                        </span>
                        <span>
                          作答部分合计 <b>{totalScore}</b> / {totalMax} 分
                        </span>
                      </div>

                      {items.map((it, idx) => {
                        const a = mine.get(it.item_id);
                        const credit = a ? Number(a.credit) || 0 : 0;
                        const ok = !!a && a.is_correct === true;
                        let raw = '';
                        try {
                          const p = typeof a?.answer === 'string' ? JSON.parse(a.answer) : null;
                          raw = p ? '' : String(a?.answer || '');
                        } catch {
                          raw = String(a?.answer || '');
                        }
                        return (
                          <div
                            key={it.item_id}
                            className={`rounded-lg border p-3 ${
                              !a ? 'border-gray-200 bg-gray-50' : ok ? 'border-green-200 bg-green-50/40' : 'border-red-200 bg-red-50/30'
                            }`}
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded bg-white px-1.5 py-0.5 font-medium text-purple-600">
                                第 {idx + 1} 题
                              </span>
                              <span className="text-gray-500">
                                {it.kind === 'composite' ? '综合题' : it.kind === 'python' ? '编程填空' : '选择题'}
                              </span>
                              <span className={`font-medium ${ok ? 'text-green-600' : a ? 'text-red-500' : 'text-gray-400'}`}>
                                {a ? `${credit} / ${it.score} 分` : '未作答'}
                              </span>
                              {a && !ok && credit > 0 && (
                                <span className="text-amber-600">（部分得分）</span>
                              )}
                            </div>
                            <p className="mb-2 line-clamp-2 text-sm text-gray-700">
                              {htmlToPlainText(it.content)}
                            </p>

                            {!a && <p className="text-xs text-gray-400">这一题没有作答记录</p>}

                            {a && it.kind === 'choice' && (
                              <p className="text-sm text-gray-800">
                                选了 <b className={ok ? 'text-green-600' : 'text-red-500'}>{raw || '（空）'}</b>
                                <span className="ml-2 text-xs text-gray-500">
                                  正确答案 {it.correct_answer || '—'}
                                </span>
                              </p>
                            )}

                            {a && it.kind === 'composite' && (
                              <div className="space-y-1">
                                {((a.detail && a.detail.subs) || []).map((sub: any, si: number) => {
                                  let shown = '';
                                  try {
                                    const p = JSON.parse(a.answer);
                                    const c = (p.choice_answers || {})[si];
                                    const b = (p.blank_answers || {})[si];
                                    shown = c != null && c !== ''
                                      ? String(c)
                                      : Array.isArray(b) ? b.filter(Boolean).join(' | ') : String(b == null ? '' : b);
                                  } catch { shown = ''; }
                                  return (
                                    <div key={si} className="flex items-center gap-2 text-xs">
                                      <span className="text-gray-500">第 {sub.index} 小题</span>
                                      <span className="flex-1 truncate font-mono text-gray-700">{shown || '（空）'}</span>
                                      <span className="text-gray-400">{sub.score} 分</span>
                                      <span className={sub.correct ? 'text-green-600' : 'text-red-500'}>
                                        {sub.correct ? '✓' : '✗'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {a && it.kind === 'python' && (
                              <div className="space-y-1">
                                {(() => {
                                  let blanks: any[] = [];
                                  try {
                                    const p = JSON.parse(a.answer);
                                    blanks = Array.isArray(p.blanks) ? p.blanks : [];
                                  } catch { blanks = []; }
                                  const detailBlanks: any[] = (a.detail && a.detail.blanks) || [];
                                  return (detailBlanks.length ? detailBlanks : blanks.map((v, i) => ({ blank: i + 1, answer: v })))
                                    .map((b: any, bi: number) => (
                                      <div key={bi} className="flex items-center gap-2 text-xs">
                                        <span className="text-gray-500">第 {b.blank ?? bi + 1} 空</span>
                                        <span className="flex-1 truncate font-mono text-gray-700">{b.answer || '（空）'}</span>
                                        {b.correct != null && (
                                          <span className={b.correct ? 'text-green-600' : 'text-red-500'}>
                                            {b.correct ? '✓' : '✗'}
                                          </span>
                                        )}
                                      </div>
                                    ));
                                })()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              <div className="border-t border-gray-200 p-4">
                <button
                  onClick={() => setDetailStudent(null)}
                  className="w-full rounded-lg bg-gray-200 py-2 text-gray-700 hover:bg-gray-300"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {explainQueue && (
        <AiExplainPlayer
          questions={explainQueue}
          title={selectedExam ? `${selectedExam.title} 讲评` : '试卷讲评'}
          onClose={() => setExplainQueue(null)}
        />
      )}
    </div>
  );
};
