import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Profile, Class, StudentAnswer, TestRecord, StudentPet } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, Line, Legend } from 'recharts';
import { API_CONFIG } from '../../api/config';
import { sanitizeHtml } from '../../utils/htmlUtils';
import { studentLabel } from '../../utils/studentLabel';
import { LicenseGuard } from '../common/LicenseGuard';

interface StudentWithStats extends Profile {
  class?: Class;
  total_answers?: number;
  correct_answers?: number;
  accuracy?: number;
  has_pet?: boolean;
  pet_level?: number;
}

/**
 * 表格里的学生显示名：账号在前、姓名在后，合成一个字段（如「20230101 张三」）。
 * 实现见 utils/studentLabel.ts（同名同姓靠账号区分；缺账号/姓名自动退化）。
 */


export const Analytics: React.FC = () => {
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<StudentWithStats[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalStudents: 0,
    avgPoints: 0,
    avgAccuracy: 0,
    petAdoptionRate: 0,
  });
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile) return;
    fetchClasses();
  }, [profile]);

  useEffect(() => {
    if (selectedClass) {
      fetchStudents();
    }
  }, [selectedClass]);

  const fetchClasses = async () => {
    if (!profile) return;
    setLoading(true);
    const { data } = await backendClient
      .from('classes')
      .select('*')
      .eq('teacher_id', profile.id);
    if (data) {
      setClasses(data as Class[]);
      if (data.length > 0 && !selectedClass) {
        setSelectedClass(data[0].id);
      }
    }
    setLoading(false);
  };

  const fetchStudents = async () => {
    if (!selectedClass) return;
    setLoading(true);

    const { data: studentsData, error: studentsError } = await backendClient
      .from('profiles')
      .select('*')
      .eq('class_id', selectedClass)
      .eq('role', 'student');

    if (studentsError) {
      console.error('获取学生数据失败:', studentsError);
      setLoading(false);
      return;
    }

    if (studentsData && studentsData.length > 0) {
      const studentsWithStats: StudentWithStats[] = await Promise.all(
        (studentsData as StudentWithStats[]).map(async (student) => {
          const [{ data: answers, error: answersError }, { data: petData, error: petError }] = await Promise.all([
            backendClient.from('student_answers').select('is_correct').eq('student_id', student.id),
            backendClient.from('student_pets').select('*').eq('student_id', student.id).maybeSingle(),
          ]);

          if (answersError) {
            console.error(`获取学生 ${student.id} 答题记录失败:`, answersError);
          }

          const total = answers?.length || 0;
          const correct = answers?.filter((a: any) => a.is_correct).length || 0;

          return {
            ...student,
            total_answers: total,
            correct_answers: correct,
            accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
            has_pet: !!petData,
            pet_level: petData?.growth_level || 0,
          };
        })
      );

      setStudents(studentsWithStats);

      const totalStudents = studentsWithStats.length;
      const avgPoints = totalStudents > 0
        ? Math.round(studentsWithStats.reduce((sum, s) => sum + (s.current_points || 0), 0) / totalStudents)
        : 0;
      const avgAccuracy = totalStudents > 0
        ? Math.round(studentsWithStats.reduce((sum, s) => sum + (s.accuracy || 0), 0) / totalStudents)
        : 0;
      const petAdoptionRate = totalStudents > 0
        ? Math.round((studentsWithStats.filter((s) => s.has_pet).length / totalStudents) * 100)
        : 0;

      setStats({
        totalStudents,
        avgPoints,
        avgAccuracy,
        petAdoptionRate,
      });
    } else {
      setStudents([]);
      setStats({
        totalStudents: 0,
        avgPoints: 0,
        avgAccuracy: 0,
        petAdoptionRate: 0,
      });
    }
    setLoading(false);
  };

  const handleRefresh = () => {
    if (selectedClass) {
      fetchStudents();
    }
  };

  const pointsData = students
    .sort((a, b) => (b.current_points || 0) - (a.current_points || 0))
    .slice(0, 10)
    .map((s) => ({
      name: s.real_name || s.username,
      points: s.current_points || 0,
    }));

  const accuracyData = students
    .filter((s) => s.total_answers && s.total_answers > 0)
    .sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0))
    .slice(0, 10)
    .map((s) => ({
      name: s.real_name || s.username,
      accuracy: s.accuracy || 0,
    }));

  const petLevelData = [
    { name: '未领养', value: students.filter((s) => !s.has_pet).length },
    { name: 'Lv.1', value: students.filter((s) => s.has_pet && s.pet_level === 1).length },
    { name: 'Lv.2', value: students.filter((s) => s.has_pet && s.pet_level === 2).length },
    { name: 'Lv.3+', value: students.filter((s) => s.has_pet && (s.pet_level || 0) >= 3).length },
  ].filter((d) => d.value > 0);

  const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A'];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <LicenseGuard featureName="学情分析" featureIcon="fa-chart-line">
      <div>
        <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">学情分析</h2>
        <div className="flex items-center gap-3">
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="p-2 border border-gray-300 rounded-lg"
          >
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <i className="fa-solid fa-refresh mr-2"></i>刷新
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <p className="text-3xl font-bold text-blue-600">{stats.totalStudents}</p>
          <p className="text-gray-600">学生总数</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <p className="text-3xl font-bold text-yellow-600">{stats.avgPoints}</p>
          <p className="text-gray-600">平均积分</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <p className="text-3xl font-bold text-green-600">{stats.avgAccuracy}%</p>
          <p className="text-gray-600">平均正确率</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <p className="text-3xl font-bold text-pink-600">{stats.petAdoptionRate}%</p>
          <p className="text-gray-600">萌宠领养率</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">积分排行榜 TOP10</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pointsData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={80} />
                <Tooltip />
                <Bar dataKey="points" fill="#F59E0B" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">正确率排行榜 TOP10</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={accuracyData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} />
                <YAxis dataKey="name" type="category" width={80} />
                <Tooltip />
                <Bar dataKey="accuracy" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">萌宠等级分布</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={petLevelData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {petLevelData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <h3 className="text-lg font-bold text-gray-800 p-6 border-b border-gray-200">学生详细数据</h3>
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">账号 姓名</th>
              <th className="px-6 py-3 text-center text-sm font-medium text-gray-600">当前积分</th>
              <th className="px-6 py-3 text-center text-sm font-medium text-gray-600">最高积分</th>
              <th className="px-6 py-3 text-center text-sm font-medium text-gray-600">做题量</th>
              <th className="px-6 py-3 text-center text-sm font-medium text-gray-600">正确率</th>
              <th className="px-6 py-3 text-center text-sm font-medium text-gray-600">萌宠</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {students.map((student) => (
              <tr key={student.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-800">{studentLabel(student)}</td>
                <td className="px-6 py-3 text-center text-yellow-600 font-medium">{student.current_points || 0}</td>
                <td className="px-6 py-3 text-center text-purple-600">{student.max_points || 0}</td>
                <td className="px-6 py-3 text-center text-gray-600">{student.total_answers || 0}</td>
                <td className="px-6 py-3 text-center text-gray-600">{student.accuracy || 0}%</td>
                <td className="px-6 py-3 text-center">
                  {student.has_pet ? (
                    <span className="px-2 py-1 bg-pink-100 text-pink-600 rounded-full text-xs">
                      Lv.{student.pet_level}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <ChapterMasterySection classId={selectedClass} />
      </div>

      <div className="mt-6">
        <WrongQuestionsSection classId={selectedClass} />
      </div>
      <div className="mt-6">
        <StudentTrendSection classId={selectedClass} students={students} />
      </div>
      <div className="mt-6">
        <AtRiskSection classId={selectedClass} />
      </div>
      <div className="mt-6">
        <ExamDistributionSection classId={selectedClass} />
      </div>
      </div>
    </LicenseGuard>
  );
};

// ==================== 学情分析扩展区块 ====================

interface WrongQuestion {
  question_id: string;
  type: string | null;
  content: string;
  wrong_count: number;
  total_attempts: number;
  correct_rate: number;
  knowledge_point: string | null;
  explained: boolean;
  option_stats?: Record<string, number>;
  correct_answer?: string | null;
}

interface WrongQuestionsPage {
  items: WrongQuestion[];
  total: number;
  page: number;
  pageSize: number;
}

interface TrendPoint {
  week_start: string;
  answers: number;
  correct_rate: number | null;
  active_days: number;
}

interface AtRiskStudent {
  id: string;
  real_name: string;
  username: string;
  flags: string[];
  inactive_days: number | null;
  recent7_correct_rate: number | null;
  prev7_correct_rate: number | null;
  answers30: number;
}

interface ExamBucket {
  range: string;
  count: number;
}

interface ChapterMasteryChapter {
  cluster_id: string;
  question_count: number;
}

interface ChapterMasteryStudent {
  id: string;
  real_name: string;
  username: string;
  total_mastered: number;
  by_chapter: Record<string, number>;
}

interface ChapterMasteryData {
  chapters: ChapterMasteryChapter[];
  students: ChapterMasteryStudent[];
  master_threshold: number;
}

interface ExamDistribution {
  test_id: string;
  title: string;
  passing_score: number;
  submit_count: number;
  class_size: number;
  absent_count?: number;
  avg_score: number | null;
  max_score: number | null;
  min_score: number | null;
  pass_rate: number;
  excellent_rate: number;
  buckets: ExamBucket[];
}

const analyticsFetch = async <T,>(path: string): Promise<T> => {
  const token = localStorage.getItem('xgpy_token');
  const res = await fetch(`${API_CONFIG.apiUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || '请求失败');
  return json.data as T;
};

const analyticsPost = async <T,>(path: string, body: unknown): Promise<T> => {
  const token = localStorage.getItem('xgpy_token');
  const res = await fetch(`${API_CONFIG.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || '请求失败');
  return json.data as T;
};

const SectionSpinner: React.FC = () => (
  <div className="flex items-center justify-center h-40">
    <i className="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
  </div>
);

const sectionTitleCls = 'text-lg font-bold text-gray-800';
const sectionSubCls = 'text-sm text-gray-500 mt-1 mb-4';

// 解析题目 JSON 字段（options / answers 可能是字符串或已解析对象）
const parseQuestionJson = (raw: any): any => {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
};

const getQuestionOptions = (raw: any): string[] => {
  const parsed = parseQuestionJson(raw);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.options;
  if (!Array.isArray(list)) return [];
  return list.map((o: any) => (o == null ? '' : String(o)));
};

const getQuestionAnswers = (raw: any): string[] => {
  const parsed = parseQuestionJson(raw);
  if (!parsed) return [];
  let r = parsed.answers !== undefined ? parsed.answers : parsed;
  if (Array.isArray(r) && r.length > 0 && r[0] && Array.isArray(r[0].answers)) r = r[0].answers;
  if (!Array.isArray(r)) return typeof r === 'string' ? [r] : [];
  return r.map((a: any) => (a == null ? '' : String(a)));
};

// 错题详情弹窗：展示完整题干（消毒后渲染 HTML）、选项、答案、解析、知识点
const WrongQuestionDetailModal: React.FC<{
  question: any;
  knowledgePoint: string | null;
  onClose: () => void;
}> = ({ question, knowledgePoint, onClose }) => {
  const options = getQuestionOptions(question.options);
  const answers = getQuestionAnswers(question.answers);
  const correctLetters = answers.map(a => a.trim().toUpperCase());
  // 去掉选项文本自带的字母前缀（如 "A. xxx"），统一用序号渲染
  const stripLetterPrefix = (opt: string, letter: string) =>
    opt.replace(new RegExp(`^\\s*${letter}[.、．:]\\s*`, 'i'), '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h4 className="text-base font-bold text-gray-800">题目详情</h4>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors"
            title="关闭"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="px-6 py-5">
          <div className="text-gray-800 leading-relaxed question-rich-content">
            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(question.content || '') }} />
          </div>

          {question.type === 'choice' && options.length > 0 && (
            <div className="mt-4 space-y-2">
              {options.map((opt, oIdx) => {
                const letter = String.fromCharCode(65 + oIdx);
                const isCorrect = correctLetters.includes(letter);
                return (
                  <div
                    key={oIdx}
                    className={`flex items-start gap-3 p-3 rounded-xl border-2 ${isCorrect ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'}`}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isCorrect ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                      {letter}
                    </span>
                    <span className="flex-1 text-sm text-gray-700 question-rich-content">
                      <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(stripLetterPrefix(opt, letter)) }} />
                    </span>
                    {isCorrect && <i className="fa-solid fa-check text-green-600 mt-1"></i>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-gray-500 flex-shrink-0 w-16">正确答案</span>
              <span className="text-sm font-bold text-green-700">{answers.join('、') || '（未设置）'}</span>
            </div>
            {question.explanation && (
              <div className="flex items-start gap-2">
                <span className="text-sm font-medium text-gray-500 flex-shrink-0 w-16">解析</span>
                <div className="flex-1 text-sm text-gray-600 bg-amber-50/50 p-3 rounded-lg question-rich-content">
                  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(question.explanation) }} />
                </div>
              </div>
            )}
            {knowledgePoint && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-500 flex-shrink-0 w-16">知识点</span>
                <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{knowledgePoint}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// 1. 错题排行（分页 + 已讲解标记 + 批量打标签）
const WrongQuestionsSection: React.FC<{ classId: string }> = ({ classId }) => {
  const [pageData, setPageData] = useState<WrongQuestionsPage>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'unexplained' | 'explained'>('all');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [detail, setDetail] = useState<{ question: any; knowledgePoint: string | null } | null>(null);
  const pageSize = 20;

  const fetchPage = async (targetPage = page) => {
    if (!classId) return;
    setLoading(true);
    try {
      const data = await analyticsFetch<WrongQuestionsPage>(
        `/api/teacher/analytics/wrong-questions/${classId}?page=${targetPage}&pageSize=${pageSize}&filter=${filter}`
      );
      setPageData(data);
    } catch (e) {
      console.error('获取错题排行失败:', e);
      setPageData({ items: [], total: 0, page: targetPage, pageSize });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [classId, filter]);

  useEffect(() => {
    fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, page, filter]);

  const refresh = async () => {
    setSelected(new Set());
    await fetchPage(page);
  };

  const openDetail = async (q: WrongQuestion) => {
    try {
      const { data, error } = await backendClient.from('questions').select('*').eq('id', q.question_id).single();
      if (error || !data) throw error || new Error('题目不存在');
      setDetail({ question: data, knowledgePoint: q.knowledge_point });
    } catch (e) {
      console.error('获取题目详情失败:', e);
      alert('获取题目详情失败');
    }
  };

  const items = pageData.items;
  const totalPages = Math.max(1, Math.ceil(pageData.total / pageData.pageSize));
  const allPageSelected = items.length > 0 && items.every(q => selected.has(q.question_id));

  const toggleSelectAll = () => {
    const next = new Set(selected);
    if (allPageSelected) {
      items.forEach(q => next.delete(q.question_id));
    } else {
      items.forEach(q => next.add(q.question_id));
    }
    setSelected(next);
  };

  const toggleSelect = (qid: string) => {
    const next = new Set(selected);
    if (next.has(qid)) next.delete(qid); else next.add(qid);
    setSelected(next);
  };

  const runBatch = async (action: 'explain' | 'unexplain' | 'tag') => {
    const questionIds = Array.from(selected);
    if (questionIds.length === 0) return;
    setActionLoading(true);
    try {
      if (action === 'tag') {
        const tag = tagInput.trim();
        if (!tag) {
          alert('请输入标签');
          return;
        }
        await analyticsPost<{ updated: number }>(`/api/teacher/analytics/wrong-questions/tag/${classId}`, { question_ids: questionIds, tag });
        setTagInput('');
      } else {
        await analyticsPost<{ updated: number }>(`/api/teacher/analytics/explained/${classId}`, {
          question_ids: questionIds,
          explained: action === 'explain',
        });
      }
      await refresh();
    } catch (e: any) {
      console.error('批量操作失败:', e);
      alert(e?.message || '批量操作失败');
    } finally {
      setActionLoading(false);
    }
  };

  const typeLabel = (t: string | null) => {
    switch (t) {
      case 'choice': return '选择题';
      case 'fill_blank': return '填空题';
      case 'code': return '编程题';
      case 'composite': return '综合题';
      default: return '未知';
    }
  };

  const filterTabs: { key: 'all' | 'unexplained' | 'explained'; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'unexplained', label: '未讲解' },
    { key: 'explained', label: '已讲解' },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className={sectionTitleCls}>错题排行</h3>
          <p className={sectionSubCls}>全班错误次数最多的题目（最多统计前 100 题），双击行可查看完整题目</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {filterTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${filter === t.key ? 'bg-white text-blue-600 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
          <span className="text-sm text-blue-700 font-medium">已选 {selected.size} 题</span>
          <div className="flex items-center gap-2 ml-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runBatch('tag'); }}
              placeholder="错题专攻"
              className="px-3 py-1.5 border border-blue-300 rounded-lg text-sm w-36 focus:outline-none focus:border-blue-500 bg-white"
            />
            <button
              onClick={() => runBatch('tag')}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              添加标签
            </button>
          </div>
          <button
            onClick={() => runBatch('explain')}
            disabled={actionLoading}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            标记已讲解
          </button>
          <button
            onClick={() => runBatch('unexplain')}
            disabled={actionLoading}
            className="px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            取消已讲解
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-sm text-gray-400 hover:text-gray-600"
          >
            清空选择
          </button>
        </div>
      )}

      {loading ? (
        <SectionSpinner />
      ) : items.length === 0 ? (
        <div className="text-center text-gray-400 py-10">
          <i className="fa-regular fa-circle-check text-3xl mb-2"></i>
          <p>{filter === 'all' ? '暂无错题数据' : filter === 'explained' ? '暂无已讲解的错题' : '暂无未讲解的错题'}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                      title="全选本页"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-12">排名</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">题干</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-20">题型</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-20">错误次数</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-20">正确率</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">选项分布</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((q, idx) => {
                  const rank = (pageData.page - 1) * pageData.pageSize + idx + 1;
                  const letters = Object.keys(q.option_stats || {}).sort();
                  const maxWrong = letters.reduce((max, l) => {
                    if (q.correct_answer && l === q.correct_answer) return max;
                    const cnt = q.option_stats?.[l] || 0;
                    return cnt > max.count ? { letter: l, count: cnt } : max;
                  }, { letter: '', count: 0 });
                  return (
                    <tr
                      key={q.question_id}
                      className={`hover:bg-gray-50 align-top cursor-pointer ${q.explained ? 'opacity-50' : ''}`}
                      onDoubleClick={() => openDetail(q)}
                      title="双击查看完整题目"
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(q.question_id)}
                          onChange={() => toggleSelect(q.question_id)}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 accent-blue-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${rank <= 3 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                          {rank}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-800">
                        <div>{q.content || '（无题干）'}</div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          {q.knowledge_point && (
                            <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{q.knowledge_point}</span>
                          )}
                          {q.explained && (
                            <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                              <i className="fa-solid fa-check mr-1"></i>已讲解
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-gray-600">{typeLabel(q.type)}</td>
                      <td className="px-4 py-3 text-center text-sm font-bold text-red-600">{q.wrong_count}</td>
                      <td className="px-4 py-3 text-center text-sm text-gray-600">{q.correct_rate}%</td>
                      <td className="px-4 py-3">
                        {q.type === 'choice' && q.option_stats ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {letters.length === 0 && <span className="text-xs text-gray-400">-</span>}
                            {letters.map((l) => {
                              const isCorrect = q.correct_answer === l;
                              const isTopDistractor = maxWrong.letter === l && maxWrong.count > 0;
                              return (
                                <span
                                  key={l}
                                  className={`px-2 py-0.5 rounded text-xs border ${
                                    isCorrect
                                      ? 'border-green-500 bg-green-50 text-green-700 font-bold'
                                      : isTopDistractor
                                        ? 'border-red-500 bg-red-50 text-red-600 font-bold'
                                        : 'border-gray-200 bg-gray-50 text-gray-600'
                                  }`}
                                  title={isTopDistractor ? '最强迷惑项' : undefined}
                                >
                                  {l}×{q.option_stats?.[l]}
                                  {isTopDistractor && ' 最强迷惑项'}
                                </span>
                              );
                            })}
                            {q.correct_answer && !letters.includes(q.correct_answer) && (
                              <span className="px-2 py-0.5 rounded text-xs border border-green-500 bg-green-50 text-green-700 font-bold">
                                {q.correct_answer}×0
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-gray-500">共 {pageData.total} 题</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={pageData.page <= 1}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <i className="fa-solid fa-chevron-left mr-1"></i>上一页
              </button>
              <span className="text-sm text-gray-600">第 {pageData.page} 页 / 共 {totalPages} 页</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={pageData.page >= totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                下一页<i className="fa-solid fa-chevron-right ml-1"></i>
              </button>
            </div>
          </div>
        </>
      )}

      {detail && (
        <WrongQuestionDetailModal
          question={detail.question}
          knowledgePoint={detail.knowledgePoint}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};

// 2. 个人学情曲线
const StudentTrendSection: React.FC<{ classId: string; students: StudentWithStats[] }> = ({ classId, students }) => {
  const [studentId, setStudentId] = useState<string>('');
  const [data, setData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (students.length > 0 && !students.find((s) => s.id === studentId)) {
      setStudentId(students[0].id);
    } else if (students.length === 0) {
      setStudentId('');
    }
  }, [students]);

  useEffect(() => {
    if (!classId || !studentId) {
      setData([]);
      return;
    }
    setLoading(true);
    analyticsFetch<TrendPoint[]>(`/api/teacher/analytics/student-trend/${classId}/${studentId}?weeks=8`)
      .then(setData)
      .catch((e) => {
        console.error('获取学情曲线失败:', e);
        setData([]);
      })
      .finally(() => setLoading(false));
  }, [classId, studentId]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className={sectionTitleCls}>个人学情曲线</h3>
          <p className={sectionSubCls}>最近 8 周每周答题数与正确率走势</p>
        </div>
        <select
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="p-2 border border-gray-300 rounded-lg"
        >
          {students.map((s) => (
            <option key={s.id} value={s.id}>{studentLabel(s)}</option>
          ))}
        </select>
      </div>
      {students.length === 0 ? (
        <div className="text-center text-gray-400 py-10">该班暂无学生</div>
      ) : loading ? (
        <SectionSpinner />
      ) : data.length === 0 ? (
        <div className="text-center text-gray-400 py-10">暂无学情数据</div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week_start" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" />
              <Tooltip
                formatter={(value: any, name: any) => {
                  if (name === '正确率') return [value === null || value === undefined ? '无答题' : `${value}%`, name];
                  return [value, name];
                }}
              />
              <Legend />
              <Bar yAxisId="left" dataKey="answers" name="答题数" fill="#60A5FA" />
              <Line yAxisId="right" type="monotone" dataKey="correct_rate" name="正确率" stroke="#10B981" strokeWidth={2} connectNulls dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

// 3. 掉队预警名单
const AtRiskSection: React.FC<{ classId: string }> = ({ classId }) => {
  const [days, setDays] = useState<number>(3);
  const [data, setData] = useState<AtRiskStudent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    const timer = setTimeout(() => {
      analyticsFetch<AtRiskStudent[]>(`/api/teacher/analytics/at-risk/${classId}?days=${days}`)
        .then(setData)
        .catch((e) => {
          console.error('获取掉队预警失败:', e);
          setData([]);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [classId, days]);

  const flagBadges = (s: AtRiskStudent) => {
    const badges: { key: string; text: string }[] = [];
    if (s.flags.includes('inactive')) {
      badges.push({
        key: 'inactive',
        text: s.inactive_days === null ? '从未登录' : `${s.inactive_days}天未登录`,
      });
    }
    if (s.flags.includes('declining')) badges.push({ key: 'declining', text: '正确率下滑' });
    if (s.flags.includes('low_activity')) badges.push({ key: 'low_activity', text: '练习量偏低' });
    return badges;
  };

  const fmtRate = (v: number | null) => (v === null ? '-' : `${v}%`);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className={sectionTitleCls}>掉队预警名单</h3>
          <p className={sectionSubCls}>长时间未登录、正确率下滑或练习量明显偏低的学生</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          未登录天数 ≥
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 p-1.5 border border-gray-300 rounded-lg text-center"
          />
          天
        </label>
      </div>
      {loading ? (
        <SectionSpinner />
      ) : data.length === 0 ? (
        <div className="text-center py-10">
          <i className="fa-solid fa-circle-check text-3xl text-green-500 mb-2"></i>
          <p className="text-green-600 font-medium">全班状态良好</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">账号 姓名</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">预警标签</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">近7天正确率</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">前7天正确率</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">近30天答题数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{studentLabel(s)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {flagBadges(s).map((b) => (
                        <span key={b.key} className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-medium">
                          {b.text}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600">{fmtRate(s.recent7_correct_rate)}</td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600">{fmtRate(s.prev7_correct_rate)}</td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600">{s.answers30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// 4+. 章节掌握进度（每名学生 × 每章）
const ChapterMasterySection: React.FC<{ classId: string }> = ({ classId }) => {
  const [data, setData] = useState<ChapterMasteryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyStarted, setOnlyStarted] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'mastered' | 'rate'>('name');

  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    analyticsFetch<ChapterMasteryData>(`/api/teacher/analytics/chapter-mastery/${classId}`)
      .then((d) => setData(d))
      .catch((e) => {
        console.error('获取章节掌握进度失败:', e);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [classId]);

  const chapters = data?.chapters || [];
  const allStudents = data?.students || [];
  const threshold = data?.master_threshold ?? 3;

  const students = React.useMemo(() => {
    const list = onlyStarted ? allStudents.filter((s) => s.total_mastered > 0) : allStudents.slice();
    if (sortBy === 'mastered') list.sort((a, b) => b.total_mastered - a.total_mastered);
    else if (sortBy === 'rate') list.sort((a, b) => (b.total_mastered / Math.max(1, totalQuestions(b))) - (a.total_mastered / Math.max(1, totalQuestions(a))));
    else list.sort((a, b) => (a.real_name || a.username).localeCompare(b.real_name || b.username, 'zh-Hans-CN'));
    return list;
  }, [allStudents, onlyStarted, sortBy, chapters]);

  const totalQuestions = (s: ChapterMasteryStudent) =>
    chapters.reduce((sum, c) => sum + c.question_count, 0);

  // 单元格底色：按该章掌握数 / 该章题量分档
  const cellClass = (n: number, total: number) => {
    if (n <= 0) return 'text-gray-300';
    const rate = total > 0 ? n / total : 0;
    if (rate >= 0.6) return 'bg-emerald-100 text-emerald-700 font-bold';
    if (rate >= 0.3) return 'bg-blue-100 text-blue-700 font-semibold';
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className={sectionTitleCls}>章节掌握进度</h3>
          <p className={sectionSubCls}>
            每名学生在各章「已掌握」的题目数（同一道题练习答对 {threshold} 次记为掌握，与刷题模块口径一致）
          </p>
        </div>
        {data && allStudents.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'mastered' | 'rate')}
              className="p-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="name">按姓名排序</option>
              <option value="mastered">按掌握总数排序</option>
              <option value="rate">按掌握率排序</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyStarted}
                onChange={(e) => setOnlyStarted(e.target.checked)}
                className="w-4 h-4"
              />
              只看有进度的学生
            </label>
          </div>
        )}
      </div>

      {loading ? (
        <SectionSpinner />
      ) : !data || allStudents.length === 0 ? (
        <div className="text-center text-gray-400 py-10">该班级暂无学生数据</div>
      ) : (
        <>
          {/* 章节总题量概览 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {chapters.map((c) => (
              <span key={c.cluster_id} className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
                {c.cluster_id}
                <span className="text-gray-400 ml-1">{c.question_count}</span>
              </span>
            ))}
          </div>

          <div className="overflow-auto border border-gray-200 rounded-lg" style={{ maxHeight: '520px' }}>
            <table className="w-full border-collapse">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[160px] border-b border-gray-200">
                    账号 姓名
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-600 border-b border-l border-gray-200 min-w-[70px]">
                    掌握总数
                  </th>
                  {chapters.map((c) => (
                    <th
                      key={c.cluster_id}
                      className="px-2 py-2 text-center text-xs font-medium text-gray-600 border-b border-l border-gray-200 whitespace-nowrap"
                      title={`${c.cluster_id}　本章题量 ${c.question_count}`}
                    >
                      {c.cluster_id}
                      <div className="text-[10px] text-gray-400 font-normal">题量 {c.question_count}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {students.map((s) => (
                  <tr key={s.id} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-sm text-gray-800 sticky left-0 bg-white whitespace-nowrap border-r border-gray-100">
                      {studentLabel(s)}
                    </td>
                    <td className="px-3 py-2 text-center text-sm font-bold text-indigo-600 border-l border-gray-100">
                      {s.total_mastered}
                    </td>
                    {chapters.map((c) => {
                      const n = s.by_chapter[c.cluster_id] || 0;
                      return (
                        <td key={c.cluster_id} className="px-2 py-2 text-center border-l border-gray-100">
                          <span
                            className={`inline-block min-w-[28px] px-1.5 py-0.5 rounded text-xs ${cellClass(n, c.question_count)}`}
                          >
                            {n}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            共 {students.length} 名学生 · 数值为「已掌握题数」；颜色越绿表示该章掌握比例越高
          </p>
        </>
      )}
    </div>
  );
};

// 4. 考试成绩分布
const ExamDistributionSection: React.FC<{ classId: string }> = ({ classId }) => {
  const [exams, setExams] = useState<ExamDistribution[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    analyticsFetch<ExamDistribution[]>(`/api/teacher/analytics/exam-distribution/${classId}`)
      .then((list) => {
        setExams(list);
        setSelectedId((prev) => (list.find((e) => e.test_id === prev) ? prev : (list[0]?.test_id || '')));
      })
      .catch((e) => {
        console.error('获取考试成绩分布失败:', e);
        setExams([]);
      })
      .finally(() => setLoading(false));
  }, [classId]);

  const exam = exams.find((e) => e.test_id === selectedId);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className={sectionTitleCls}>考试成绩分布</h3>
          <p className={sectionSubCls}>各场考试的参考情况与分数段分布</p>
        </div>
        {exams.length > 0 && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="p-2 border border-gray-300 rounded-lg max-w-xs"
          >
            {exams.map((e) => (
              <option key={e.test_id} value={e.test_id}>{e.title}</option>
            ))}
          </select>
        )}
      </div>
      {loading ? (
        <SectionSpinner />
      ) : exams.length === 0 ? (
        <div className="text-center text-gray-400 py-10">暂无相关考试</div>
      ) : exam ? (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">
                {exam.submit_count}/{exam.class_size}
              </p>
              <p className="text-sm text-gray-600">
                参考率 {exam.class_size > 0 ? Math.round((exam.submit_count / exam.class_size) * 100) : 0}%
                {(exam.absent_count ?? 0) > 0 && (
                  <span className="text-red-500 ml-1">（{exam.absent_count} 人未参加）</span>
                )}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">{exam.avg_score === null ? '-' : exam.avg_score}</p>
              <p className="text-sm text-gray-600">平均分</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{exam.pass_rate}%</p>
              <p className="text-sm text-gray-600">及格率（≥{exam.passing_score}分）</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{exam.excellent_rate}%</p>
              <p className="text-sm text-gray-600">优秀率（≥85分）</p>
            </div>
          </div>
          {exam.submit_count === 0 ? (
            <div className="text-center text-gray-400 py-10">
              <i className="fa-regular fa-folder-open text-3xl mb-2"></i>
              <p>该考试暂无答卷</p>
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={exam.buckets}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value: any) => [`${value} 人`, '人数']} />
                  <Bar dataKey="count" name="人数" fill="#818CF8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
