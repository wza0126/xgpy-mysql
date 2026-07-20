import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Profile, Class, StudentAnswer, TestRecord, StudentPet } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, Line, Legend } from 'recharts';
import { API_CONFIG } from '../../api/config';

interface StudentWithStats extends Profile {
  class?: Class;
  total_answers?: number;
  correct_answers?: number;
  accuracy?: number;
  has_pet?: boolean;
  pet_level?: number;
}

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
  const [licenseDenied, setLicenseDenied] = useState(false);

  useEffect(() => {
    if (!profile) return;
    // 数据分析为授权功能：进入模块前先校验授权状态
    (async () => {
      try {
        const token = localStorage.getItem('xgpy_token');
        const res = await fetch(`${API_CONFIG.apiUrl}/api/teacher/analytics/access`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 403) {
          setLicenseDenied(true);
          setLoading(false);
          return;
        }
        fetchClasses();
      } catch {
        fetchClasses();
      }
    })();
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

  if (licenseDenied) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <i className="fa-solid fa-lock text-6xl text-amber-500 mb-6"></i>
        <h2 className="text-xl font-bold text-gray-800 mb-2">学情分析为授权功能</h2>
        <p className="text-sm text-gray-500 mb-1">系统授权已到期或尚未激活，激活后即可继续使用</p>
        <p className="text-xs text-gray-400">请联系平台提供方获取授权，或在 系统配置 → 授权管理 中输入授权码</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
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
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">姓名</th>
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
                <td className="px-6 py-3 font-medium text-gray-800">{student.real_name}</td>
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
  option_stats?: Record<string, number>;
  correct_answer?: string | null;
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

const SectionSpinner: React.FC = () => (
  <div className="flex items-center justify-center h-40">
    <i className="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
  </div>
);

const sectionTitleCls = 'text-lg font-bold text-gray-800';
const sectionSubCls = 'text-sm text-gray-500 mt-1 mb-4';

// 1. 错题排行 TOP 10
const WrongQuestionsSection: React.FC<{ classId: string }> = ({ classId }) => {
  const [data, setData] = useState<WrongQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    analyticsFetch<WrongQuestion[]>(`/api/teacher/analytics/wrong-questions/${classId}`)
      .then(setData)
      .catch((e) => {
        console.error('获取错题排行失败:', e);
        setData([]);
      })
      .finally(() => setLoading(false));
  }, [classId]);

  const typeLabel = (t: string | null) => {
    switch (t) {
      case 'choice': return '选择题';
      case 'fill_blank': return '填空题';
      case 'code': return '编程题';
      case 'composite': return '综合题';
      default: return '未知';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className={sectionTitleCls}>错题排行 TOP 10</h3>
      <p className={sectionSubCls}>全班错误次数最多的题目，帮助定位共性薄弱点</p>
      {loading ? (
        <SectionSpinner />
      ) : data.length === 0 ? (
        <div className="text-center text-gray-400 py-10">
          <i className="fa-regular fa-circle-check text-3xl mb-2"></i>
          <p>暂无错题数据</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-12">排名</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">题干</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-20">题型</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-20">错误次数</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-20">正确率</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">选项分布</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.map((q, idx) => {
                const letters = Object.keys(q.option_stats || {}).sort();
                const maxWrong = letters.reduce((max, l) => {
                  if (q.correct_answer && l === q.correct_answer) return max;
                  const cnt = q.option_stats?.[l] || 0;
                  return cnt > max.count ? { letter: l, count: cnt } : max;
                }, { letter: '', count: 0 });
                return (
                  <tr key={q.question_id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${idx < 3 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      <div>{q.content || '（无题干）'}</div>
                      {q.knowledge_point && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{q.knowledge_point}</span>
                      )}
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
            <option key={s.id} value={s.id}>{s.real_name || s.username}</option>
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
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">姓名</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">预警标签</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">近7天正确率</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">前7天正确率</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">近30天答题数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{s.real_name || s.username}</td>
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
