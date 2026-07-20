import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Profile, Class, StudentAnswer, TestRecord, StudentPet } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
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
    </div>
  );
};
