import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Profile, Class, StudentAnswer, TestRecord, StudentPet } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, Line, Legend } from 'recharts';
import { API_CONFIG } from '../../api/config';
import { sanitizeHtml } from '../../utils/htmlUtils';
import { studentLabel } from '../../utils/studentLabel';
import { DetailSortKey, sortStudentRows, masteryRate, sortMasteryRows } from '../../utils/tableSort';
import { LicenseGuard } from '../common/LicenseGuard';
import { authHeaders } from '../../utils/authToken';
import { pickExplainQueue } from '../../utils/explainQueue';
import { AiExplainPlayer, ExplainQuestion } from './AiExplainPlayer';

interface StudentWithStats extends Profile {
  class?: Class;
  total_answers?: number;
  correct_answers?: number;
  accuracy?: number;
  has_pet?: boolean;
  pet_level?: number;
  /** 已掌握题数（与「章节掌握进度」同源同口径：同一道题答对 threshold 次记为掌握） */
  total_mastered?: number;
}

/**
 * 表格里的学生显示名：账号在前、姓名在后，合成一个字段（如「20230101 张三」）。
 * 实现见 utils/studentLabel.ts（同名同姓靠账号区分；缺账号/姓名自动退化）。
 * 两张表的排序逻辑见 utils/tableSort.ts（纯函数，可独立验证）。
 */


/** 学情分析分页：页面原来一屏要滚很久（学生表 + 6 个分析区块），按使用场景切成 4 页 */
const ANALYTICS_TABS = [
  { key: 'overview', label: '总览', icon: 'fa-chart-pie' },
  { key: 'students', label: '学生', icon: 'fa-users' },
  { key: 'study', label: '学业', icon: 'fa-book-open' },
  { key: 'warnings', label: '预警', icon: 'fa-triangle-exclamation' },
] as const;
type AnalyticsTab = (typeof ANALYTICS_TABS)[number]['key'];

export const Analytics: React.FC = () => {
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<StudentWithStats[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  // 「学生详细数据」表排序状态：点表头切换字段 / 再点切升降序
  const [detailSort, setDetailSort] = useState<{ key: DetailSortKey; asc: boolean }>({ key: 'label', asc: true });
  const [activeSection, setActiveSection] = useState<AnalyticsTab>('overview');
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
      // 全班统计一次聚合拿回（原来逐学生各发 2 个请求 + 一次 chapter-mastery，
      // 50 人班级约 101 个请求，而且每个请求都是 student_answers 整表拉取）。
      const statMap = new Map<string, any>();
      try {
        const overview: any = await backendClient.get('/api/teacher/students/overview', {
          class_id: selectedClass,
        });
        (overview?.data?.students || []).forEach((s: any) => statMap.set(String(s.id), s));
      } catch (e) {
        console.error('获取学生概览失败:', e);
      }

      const studentsWithStats: StudentWithStats[] = (studentsData as StudentWithStats[]).map((student) => {
        const s: any = statMap.get(String(student.id)) || {};
        return {
          ...student,
          total_answers: Number(s.total_answers) || 0,
          correct_answers: Number(s.correct_answers) || 0,
          accuracy: Number(s.accuracy) || 0,
          has_pet: !!s.has_pet,
          pet_level: Number(s.pet_level) || 0,
          // 「总掌握」与下方「章节掌握进度」同源（同一个后端口径：practice 答对次数 >= 阈值）
          total_mastered: Number(s.total_mastered) || 0,
        };
      });

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

      {/* 分页标签：切换不重新拉数据（各区块自己带 loading） */}
      <div className="mb-5 flex flex-wrap gap-2 border-b border-gray-200">
        {ANALYTICS_TABS.map((t) => {
          const on = activeSection === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveSection(t.key)}
              className={`-mb-px flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                on ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <i className={`fa-solid ${t.icon} text-xs`} />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeSection === 'overview' && (
        <>
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

      {/* 移动端学情分析入口：手机随时查（v2.7.1） */}
      <MobileAnalyticsCard />

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

        </>
      )}

      {activeSection === 'students' && (
        <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex items-baseline justify-between flex-wrap gap-2 p-6 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">学生详细数据</h3>
          <p className="text-xs text-gray-400">点击表头按该字段排序，再点一次切换升降序；表格固定显示约 15 行，超出可滚动</p>
        </div>
        {/* 表头 44px(h-11) + 每行 48px(h-12)：44 + 15×48 ≈ 764 → 取 768 固定显示约 15 行 */}
        <div className="overflow-auto" style={{ maxHeight: '768px' }}>
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                {([
                  { key: 'label', label: '账号 姓名', align: 'left' },
                  { key: 'current_points', label: '当前积分', align: 'center' },
                  { key: 'max_points', label: '最高积分', align: 'center' },
                  { key: 'total_answers', label: '做题量', align: 'center' },
                  { key: 'accuracy', label: '正确率', align: 'center' },
                  { key: 'total_mastered', label: '总掌握', align: 'center' },
                  { key: 'pet_level', label: '萌宠', align: 'center' },
                ] as { key: DetailSortKey; label: string; align: 'left' | 'center' }[]).map((col) => (
                  <th
                    key={col.key}
                    onClick={() =>
                      setDetailSort((s) =>
                        s.key === col.key
                          ? { key: col.key, asc: !s.asc }
                          : { key: col.key, asc: col.key === 'label' }
                      )
                    }
                    title={`按「${col.label}」排序`}
                    className={`h-11 px-6 text-sm font-medium text-gray-600 cursor-pointer select-none hover:text-blue-600 whitespace-nowrap ${
                      col.align === 'left' ? 'text-left' : 'text-center'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {col.label}
                      {detailSort.key === col.key ? (
                        <i className={`fa-solid fa-caret-${detailSort.asc ? 'up' : 'down'} text-blue-500`}></i>
                      ) : (
                        <i className="fa-solid fa-sort text-gray-300"></i>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortStudentRows(students, detailSort).map((student) => (
                <tr key={student.id} className="hover:bg-gray-50">
                  <td className="h-12 px-6 font-medium text-gray-800 whitespace-nowrap">{studentLabel(student)}</td>
                  <td className="h-12 px-6 text-center text-yellow-600 font-medium">{student.current_points || 0}</td>
                  <td className="h-12 px-6 text-center text-purple-600">{student.max_points || 0}</td>
                  <td className="h-12 px-6 text-center text-gray-600">{student.total_answers || 0}</td>
                  <td className="h-12 px-6 text-center text-gray-600">{student.accuracy || 0}%</td>
                  <td className="h-12 px-6 text-center font-semibold text-indigo-600" title="同一道题练习答对若干次记为掌握，与下方「章节掌握进度」同口径">
                    {student.total_mastered || 0}
                  </td>
                  <td className="h-12 px-6 text-center">
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
              {students.length === 0 && (
                <tr>
                  <td colSpan={7} className="h-12 px-6 text-center text-gray-400">该班级暂无学生数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6">
        <StudentTrendSection classId={selectedClass} students={students} />
      </div>
        </>
      )}

      {activeSection === 'study' && (
        <>
      <div>
        <ChapterMasterySection classId={selectedClass} />
      </div>

      <div className="mt-6">
        <WrongQuestionsSection classId={selectedClass} />
      </div>

      <div className="mt-6">
        <ExamDistributionSection classId={selectedClass} />
      </div>
        </>
      )}

      {activeSection === 'warnings' && (
        <>
      <div>
        <PracticeAbuseSection classId={selectedClass} />
      </div>
      <div className="mt-6">
        <AtRiskSection classId={selectedClass} />
      </div>
        </>
      )}
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

/** 错题排行的题型筛选值（与后端白名单一致；op = WPS + Access 操作题合并） */
type WrongQuestionTypeFilter = 'all' | 'choice' | 'fill_blank' | 'composite' | 'code' | 'op';

const WRONG_QUESTION_TYPE_OPTIONS: { value: WrongQuestionTypeFilter; label: string }[] = [
  { value: 'all', label: '全部题型' },
  { value: 'choice', label: '选择题' },
  { value: 'fill_blank', label: '填空题' },
  { value: 'composite', label: '综合题' },
  { value: 'op', label: '操作题（WPS / Access）' },
];

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

// 0. 移动端学情分析入口（v2.7.1）
// 手机浏览器打开即可用教师账号查看各班学生情况；地址由当前访问来源推导，
// 避免把 localhost 写死导致别的老师拿到打不开的链接。
const MobileAnalyticsCard: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/mobile-analytics.html`
    : '/mobile-analytics.html';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 剪贴板不可用（非 HTTPS / 旧浏览器）时退回手动复制
      window.prompt('请手动复制下面的地址：', url);
    }
  };

  return (
    <div className="bg-gradient-to-r from-sky-50 to-cyan-50 rounded-xl border border-sky-200 p-5 mb-6">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-11 h-11 rounded-xl bg-sky-500 text-white flex items-center justify-center flex-shrink-0">
          <i className="fa-solid fa-mobile-screen-button text-lg"></i>
        </div>
        <div className="flex-1 min-w-[240px]">
          <h3 className="font-bold text-gray-800 mb-1">
            移动端学情分析
            <span className="ml-2 text-[11px] font-normal px-2 py-0.5 rounded-full bg-sky-500 text-white align-middle">
              手机查看
            </span>
          </h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            用手机浏览器打开下面的地址，教师账号登录后即可查看各班级学生的
            <span className="font-medium text-sky-700">总掌握数</span>、积分、做题量、正确率等；
            账号与姓名始终显示，其余字段可自由勾选并按所选字段排序。
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <code className="px-3 py-2 rounded-lg bg-white border border-sky-200 text-xs text-sky-800 break-all font-mono">
              {url}
            </code>
            <button
              onClick={copy}
              className="px-3 py-2 rounded-lg bg-sky-500 text-white text-xs hover:bg-sky-600 transition-colors whitespace-nowrap"
            >
              <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'} mr-1`}></i>
              {copied ? '已复制' : '复制地址'}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg bg-white border border-sky-300 text-sky-700 text-xs hover:bg-sky-50 transition-colors whitespace-nowrap"
            >
              <i className="fa-solid fa-arrow-up-right-from-square mr-1"></i>打开
            </a>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            <i className="fa-solid fa-circle-info mr-1"></i>
            手机需与本系统在同一网络（或能访问本地址）才能打开。
          </p>
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
  /** 题型筛选（后端白名单：all/choice/fill_blank/composite/code/op，op = WPS+Access 操作题合并） */
  const [typeFilter, setTypeFilter] = useState<WrongQuestionTypeFilter>('all');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [detail, setDetail] = useState<{ question: any; knowledgePoint: string | null } | null>(null);
  const [pageSize] = useState(20);
  // AI 语音讲解：菜单开关 + 待讲队列（null 表示播放器未打开）
  const [explainMenu, setExplainMenu] = useState(false);
  const [explainQueue, setExplainQueue] = useState<ExplainQuestion[] | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  /** 连续讲解时被跳过的综合题数量，讲完提示一下，避免老师以为漏题 */
  const [explainHint, setExplainHint] = useState<string>('');
  /** 同一批跳过信息的短版本，塞进播放器顶栏（播放器是全屏的，页面横幅会被挡住） */
  const [explainSkipNote, setExplainSkipNote] = useState<string>('');

  const fetchPage = async (targetPage = page) => {
    if (!classId) return;
    setLoading(true);
    try {
      const data = await analyticsFetch<WrongQuestionsPage>(
        `/api/teacher/analytics/wrong-questions/${classId}?page=${targetPage}&pageSize=${pageSize}&filter=${filter}&type=${typeFilter}`
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
  }, [classId, filter, typeFilter]);

  useEffect(() => {
    fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, page, filter, typeFilter]);

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

  /**
   * 打开 AI 语音讲解。
   * mode: wrong = 错得最多的 20 题；rate = 错误率最高的 20 题；selected = 当前勾选的题。
   */
  const startExplain = async (mode: 'wrong' | 'rate' | 'selected') => {
    setExplainMenu(false);
    setExplainLoading(true);
    setExplainHint('');
    setExplainSkipNote('');
    try {
      let ids: string[] = [];
      if (mode === 'selected') {
        ids = Array.from(selected);
        if (!ids.length) {
          alert('请先在列表中勾选要讲的题');
          return;
        }
      } else {
        // ⛔ 只在「未讲解」里挑：讲过就打标记，下次自动换一批，不会永远重复那 20 题
        // 题型筛选生效时只在该题型里挑（老师看着「填空题」榜点讲解，理应只讲填空题）
        const batchType = typeFilter === 'composite' ? 'all' : typeFilter;
        const data = await analyticsFetch<WrongQuestionsPage>(
          `/api/teacher/analytics/wrong-questions/${classId}?page=1&pageSize=100&filter=unexplained&type=${batchType}`
        );
        const allItems = data.items || [];
        // ⛔ 综合题 / 操作题不进连播（见 utils/explainQueue.ts）：题目太复杂，讲不清。
        // 过滤在截断到 20 之前完成，否则前 20 的名额会被它们占掉。
        // 老师在列表里勾选后「讲勾选的」不受此限制（明确意图优先）。
        const picked = pickExplainQueue(allItems, mode);
        ids = picked.ids;
        if (!ids.length) {
          alert('该班的错题都已讲解过了，没有新的可讲。\n可以在「已讲解」里取消标记，或直接勾选题讲。');
          return;
        }
        if (picked.skipped > 0) {
          const parts: string[] = [];
          if (picked.skippedComposite > 0) parts.push(`${picked.skippedComposite} 道综合题`);
          if (picked.skippedOperation > 0) parts.push(`${picked.skippedOperation} 道操作题`);
          const why = picked.skippedOperation === 0
            ? '内含多个小题，逐小题讲反而更糊'
            : picked.skippedComposite === 0
              ? '没有选项可辨析，讲也讲不清'
              : '内含多个小题 / 没有选项可辨析';
          setExplainHint(`已跳过 ${parts.join('、')}（${why}，不适合连续讲解；需要讲可在列表里勾选后单独讲）`);
          setExplainSkipNote(`已跳过 ${parts.join('、')}`);
        }
      }

      // 错题排行只给摘要，这里取完整题干/选项/答案用于讲解器展示
      const res = await fetch(`${API_CONFIG.apiUrl}/api/teacher/explain/questions`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ question_ids: ids }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.questions?.length) throw new Error(json?.error || '取题失败');
      setExplainQueue(json.data.questions as ExplainQuestion[]);
    } catch (e) {
      console.error('准备 AI 讲解失败:', e);
      alert((e as Error).message || '准备讲解失败，请重试');
    } finally {
      setExplainLoading(false);
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

  /** 当前题型筛选的显示名，用于「讲前 20」按钮后缀 */
  const typeLabelOf = WRONG_QUESTION_TYPE_OPTIONS.find((o) => o.value === typeFilter)?.label || '全部题型';
  /** 综合题不能连播（题目本身含多个小题），筛到综合题时直接禁用批讲入口 */
  const batchExplainDisabled = typeFilter === 'composite';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className={sectionTitleCls}>错题排行</h3>
          <p className={sectionSubCls}>全班错误次数最多的题目（最多统计前 100 题），双击行可查看完整题目</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <button
              onClick={() => setExplainMenu((v) => !v)}
              disabled={explainLoading}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1.5"
            >
              <i className={`fa-solid ${explainLoading ? 'fa-circle-notch fa-spin' : 'fa-volume-high'}`}></i>
              {explainLoading ? '准备中…' : 'AI 语音讲解'}
            </button>
            {explainMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExplainMenu(false)}></div>
                <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                  <button
                    onClick={() => startExplain('wrong')}
                    disabled={batchExplainDisabled}
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    讲未讲解 · 错次前 20{typeFilter !== 'all' ? `（${typeLabelOf}）` : ''}
                  </button>
                  <button
                    onClick={() => startExplain('rate')}
                    disabled={batchExplainDisabled}
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    讲未讲解 · 错误率前 20{typeFilter !== 'all' ? `（${typeLabelOf}）` : ''}
                  </button>
                  <button
                    onClick={() => startExplain('selected')}
                    disabled={selected.size === 0}
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-40"
                  >
                    讲勾选的 {selected.size} 题
                  </button>
                  <p className="px-3 pb-1 pt-1.5 text-[11px] leading-snug text-gray-400 border-t border-gray-100 mt-1">
                    {batchExplainDisabled
                      ? '综合题内含多个小题，不适合语音讲解 — 请在列表里勾选后单独讲。'
                      : '前 20 自动跳过综合题 / 操作题；勾选的题不受限制。'}
                  </p>
                </div>
              </>
            )}
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as WrongQuestionTypeFilter)}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 focus:outline-none focus:border-blue-500"
            title="按题型筛选错题排行"
          >
            {WRONG_QUESTION_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
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
      </div>

      {explainHint && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <i className="fa-solid fa-circle-info mt-0.5"></i>
          <span className="flex-1">{explainHint}</span>
          <button onClick={() => setExplainHint('')} className="text-amber-500 hover:text-amber-700" title="知道了">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}

      {explainQueue && (
        <AiExplainPlayer
          questions={explainQueue}
          title="错题讲评"
          classId={classId}
          skipNote={explainSkipNote || undefined}
          onClose={() => {
            setExplainQueue(null);
            refresh();
          }}
        />
      )}

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

  // 切换班级时，props 里的 students 仍是**上一个班级**的列表（新班级数据还在请求中），
  // 此时 classId 已变、studentId 未变 → 直接请求必然 404（学生不属于该班级）。
  // 用学生行自带的 class_id 判定「列表是否已切换到当前班级」，未切换就先不发请求。
  const studentsForThisClass = students.length > 0 && students[0].class_id === classId;
  const validStudentId = studentsForThisClass && students.some((s) => s.id === studentId) ? studentId : '';

  useEffect(() => {
    if (!classId || !validStudentId) {
      setData([]);
      return;
    }
    setLoading(true);
    analyticsFetch<TrendPoint[]>(`/api/teacher/analytics/student-trend/${classId}/${validStudentId}?weeks=8`)
      .then(setData)
      .catch((e) => {
        console.error('获取学情曲线失败:', e);
        setData([]);
      })
      .finally(() => setLoading(false));
  }, [classId, validStudentId]);

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

  /** 全部章节题目总量（掌握率的分母，与学习模块分母同口径） */
  const totalQuestions = React.useMemo(
    () => chapters.reduce((sum, c) => sum + c.question_count, 0),
    [chapters]
  );

  const students = React.useMemo(
    () => sortMasteryRows(allStudents, sortBy, totalQuestions, onlyStarted),
    [allStudents, onlyStarted, sortBy, totalQuestions]
  );

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
            每名学生在各章「已掌握」的题目数（同一道题练习答对 {threshold} 次记为掌握，与刷题模块口径一致）；点击表头或右侧下拉均可排序
          </p>
        </div>
        {data && allStudents.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'mastered' | 'rate')}
              className="p-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="name">按账号 姓名排序</option>
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
                  <th
                    onClick={() => setSortBy('name')}
                    title="按前面的账号排序（同名同姓也能区分）"
                    className="px-3 py-2 text-left text-xs font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[160px] border-b border-gray-200 cursor-pointer select-none hover:text-blue-600"
                  >
                    账号 姓名
                    {sortBy === 'name' && <i className="fa-solid fa-caret-down text-blue-500 ml-1"></i>}
                  </th>
                  <th
                    onClick={() => setSortBy('mastered')}
                    title="按掌握总数排序"
                    className="px-3 py-2 text-center text-xs font-medium text-gray-600 border-b border-l border-gray-200 min-w-[84px] whitespace-nowrap cursor-pointer select-none hover:text-blue-600"
                  >
                    掌握总数
                    {sortBy === 'mastered' && <i className="fa-solid fa-caret-down text-blue-500 ml-1"></i>}
                  </th>
                  <th
                    onClick={() => setSortBy('rate')}
                    title="按掌握率排序（已掌握题数 ÷ 章节总题量）"
                    className="px-3 py-2 text-center text-xs font-medium text-gray-600 border-b border-l border-gray-200 min-w-[84px] whitespace-nowrap cursor-pointer select-none hover:text-blue-600"
                  >
                    掌握率
                    {sortBy === 'rate' && <i className="fa-solid fa-caret-down text-blue-500 ml-1"></i>}
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
                    <td className="px-3 py-2 text-center text-sm text-gray-600 border-l border-gray-100">
                      {masteryRate(s, totalQuestions)}%
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
            共 {students.length} 名学生 · 数值为「已掌握题数」；掌握率 = 已掌握题数 ÷ 章节总题量（{totalQuestions} 题）；颜色越绿表示该章掌握比例越高
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
// 4. 疑似刷题名单（闭眼连点）
// 判定口径见后端 /api/teacher/practice-suspicious：正确率偏低 + 提交间隔过密 + 同题反复提交，
// 三路信号叠加打分，只提示不自动处罚。老师可据此约谈，或让学生先去看知识点。
interface PracticeAbuseItem {
  student_id: string;
  username: string;
  real_name: string;
  class_id: string;
  class_name: string;
  answers: number;
  distinct_questions: number;
  correct: number;
  accuracy: number;
  max_repeat: number;
  fast_ratio: number;
  score: number;
  level: 'high' | 'mid' | 'low';
}

const PracticeAbuseSection: React.FC<{ classId: string }> = ({ classId }) => {
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<PracticeAbuseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    analyticsFetch<{ date: string; items: PracticeAbuseItem[]; total: number }>(
      `/api/teacher/practice-suspicious?date=${date}`
    )
      .then((d) => {
        setItems(Array.isArray(d?.items) ? d.items : []);
        setTotal(Number(d?.total) || 0);
      })
      .catch((e) => {
        console.error('获取疑似刷题名单失败:', e);
        setError(e?.message || '加载失败');
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [date]);

  // 按班级过滤（后端返回全校，前端只显示当前班级）
  const rows = classId ? items.filter((it) => it.class_id === classId) : items;

  const levelBadge = (level: PracticeAbuseItem['level']) => {
    if (level === 'high') return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">高度疑似</span>;
    if (level === 'mid') return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">可疑</span>;
    return <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">关注</span>;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className={sectionTitleCls}>疑似刷题名单</h3>
          <p className={sectionSubCls}>
            当天练习中提交过密、正确率偏低、同题反复提交的学生（判定信号：正确率 &lt; 60%、相邻提交 ≤2 秒占比高、同题最多提交 5 次以上）。只做提示，不自动处罚。
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 flex-shrink-0">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="p-1.5 border border-gray-300 rounded-lg"
          />
        </label>
      </div>

      {loading ? (
        <SectionSpinner />
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          {total === 0 ? '当天还没有练习记录' : '当前班级没有发现异常刷题行为'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="h-10 px-4 text-left text-sm font-medium text-gray-600">账号 姓名</th>
                <th className="h-10 px-4 text-center text-sm font-medium text-gray-600">提交次数</th>
                <th className="h-10 px-4 text-center text-sm font-medium text-gray-600">不同题</th>
                <th className="h-10 px-4 text-center text-sm font-medium text-gray-600">正确率</th>
                <th className="h-10 px-4 text-center text-sm font-medium text-gray-600">同题最多</th>
                <th className="h-10 px-4 text-center text-sm font-medium text-gray-600">≤2秒占比</th>
                <th className="h-10 px-4 text-center text-sm font-medium text-gray-600">判定</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((it) => (
                <tr key={it.student_id} className="hover:bg-gray-50">
                  <td className="h-12 px-4 text-gray-800 whitespace-nowrap">
                    {it.username} {it.real_name}
                  </td>
                  <td className="h-12 px-4 text-center text-gray-700 font-medium">{it.answers}</td>
                  <td className="h-12 px-4 text-center text-gray-600">{it.distinct_questions}</td>
                  <td className={`h-12 px-4 text-center font-semibold ${it.accuracy < 45 ? 'text-red-600' : 'text-gray-700'}`}>
                    {it.accuracy}%
                  </td>
                  <td className="h-12 px-4 text-center text-gray-600">{it.max_repeat} 次</td>
                  <td className={`h-12 px-4 text-center ${it.fast_ratio >= 70 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                    {it.fast_ratio}%
                  </td>
                  <td className="h-12 px-4 text-center">{levelBadge(it.level)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
