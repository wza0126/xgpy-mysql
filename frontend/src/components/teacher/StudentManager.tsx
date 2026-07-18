import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Class, Profile } from '../../types';
import { useAuth } from '../../hooks/useAuth';

interface StudentWithStats extends Profile {
  class?: Class;
  total_answers?: number;
  correct_answers?: number;
  wrong_count?: number;
  has_pet?: boolean;
  pet_level?: number;
  can_exchange_internet_code?: boolean;
  hidden_features?: string[];
}

type SortField = 'real_name' | 'username' | 'current_points' | 'max_points' | 'total_answers' | 'accuracy' | 'is_online';
type SortOrder = 'asc' | 'desc';

export const StudentManager: React.FC = () => {
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<StudentWithStats[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [showNoClassStudents, setShowNoClassStudents] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBatchEditModal, setShowBatchEditModal] = useState(false);
  const [showBatchResetPasswordModal, setShowBatchResetPasswordModal] = useState(false);
  const [newStudent, setNewStudent] = useState({ username: '', real_name: '', password: '' });
  const [batchText, setBatchText] = useState('');
  const [batchResults, setBatchResults] = useState<{ success: number; failed: number; errors: string[] }>({ success: 0, failed: 0, errors: [] });
  const [editingStudent, setEditingStudent] = useState<StudentWithStats | null>(null);
  const [editForm, setEditForm] = useState({ real_name: '', username: '', current_points: 0, max_points: 0, class_id: '' });
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [batchEditField, setBatchEditField] = useState<'current_points' | 'max_points'>('current_points');
  const [batchEditValue, setBatchEditValue] = useState(0);
  const [batchResetPassword, setBatchResetPassword] = useState('');
  const [sortField, setSortField] = useState<SortField>('real_name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const { profile } = useAuth();

  useEffect(() => {
    if (profile) {
      fetchClasses();
    }
  }, [profile]);

  useEffect(() => {
    fetchStudents();
  }, [selectedClass, showNoClassStudents]);

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
    let query = backendClient
      .from('profiles')
      .select('*')
      .eq('role', 'student');

    if (showNoClassStudents) {
      query = query.is('class_id', null);
    } else if (selectedClass) {
      query = query.eq('class_id', selectedClass);
    } else {
      setStudents([]);
      return;
    }

    const { data: studentsData, error } = await query;

    if (error) {
      console.error('获取学生失败:', error);
      return;
    }

    if (studentsData) {
      const { data: allClasses } = await backendClient.from('classes').select('id, name');
      const classMap: Record<string, string> = {};
      allClasses?.forEach((c) => {
        classMap[c.id] = c.name;
      });

      const studentsWithStats = await Promise.all(
        (studentsData as StudentWithStats[]).map(async (student) => {
          const [{ data: answers }, { data: wrongs }, { data: pet }, { data: sessions }] = await Promise.all([
            backendClient.from('student_answers').select('is_correct').eq('student_id', student.id),
            backendClient.from('wrong_questions').select('*').eq('student_id', student.id).eq('is_resolved', false),
            backendClient.from('student_pets').select('*').eq('student_id', student.id).maybeSingle(),
            backendClient.from('login_sessions').select('is_active, last_active_at, expires_at').eq('user_id', student.id).eq('is_active', true),
          ]);

          const total = answers?.length || 0;
          const correct = answers?.filter((a) => a.is_correct).length || 0;
          
          // 检查学生是否在线（有活跃且最近5分钟内活跃的session）
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          const isOnline = sessions && sessions.some((session: any) => {
            const expiresAt = new Date(session.expires_at);
            const lastActiveAt = new Date(session.last_active_at);
            return expiresAt > new Date() && lastActiveAt > fiveMinutesAgo;
          });

          return {
            ...student,
            class: student.class_id ? { id: student.class_id, name: classMap[student.class_id] || '未知班级' } : undefined,
            total_answers: total,
            correct_answers: correct,
            wrong_count: wrongs?.length || 0,
            has_pet: !!pet,
            pet_level: pet?.growth_level || 0,
            accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
            can_exchange_internet_code: student.can_exchange_internet_code ?? true,
            hidden_features: student.hidden_features ? (typeof student.hidden_features === 'string' ? JSON.parse(student.hidden_features) : student.hidden_features) : ['paint_board', 'roll_call'],
            is_online: !!isOnline,
          };
        })
      );

      setStudents(studentsWithStats);
      setSelectedStudents(new Set());
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedStudents = [...students].sort((a, b) => {
    let aVal: any = a[sortField];
    let bVal: any = b[sortField];
    
    if (sortField === 'accuracy') {
      aVal = a.accuracy || 0;
      bVal = b.accuracy || 0;
    }
    
    if (sortField === 'is_online') {
      aVal = a.is_online ? 1 : 0;
      bVal = b.is_online ? 1 : 0;
    }
    
    if (aVal === null || aVal === undefined) aVal = '';
    if (bVal === null || bVal === undefined) bVal = '';
    
    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = (bVal as string).toLowerCase();
    }
    
    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const handleAddStudent = async () => {
    if (!selectedClass || !newStudent.username || !newStudent.password) {
      alert('请填写完整信息');
      return;
    }

    const email = `${newStudent.username}@meoo.local`;

    try {
      const { data: existingProfile } = await backendClient
        .from('profiles')
        .select('id')
        .eq('username', newStudent.username)
        .maybeSingle();

      if (existingProfile) {
        await backendClient
          .from('profiles')
          .update({ class_id: selectedClass })
          .eq('id', existingProfile.id);

        setNewStudent({ username: '', real_name: '', password: '' });
        setShowAddModal(false);
        fetchStudents();
        return;
      }

      const passwordHash = await calculateSHA256(newStudent.password || '123456');
      const newUserId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const { error: profileError } = await backendClient.from('profiles').insert({
        id: newUserId,
        username: newStudent.username,
        password_hash: passwordHash,
        real_name: newStudent.real_name || newStudent.username,
        role: 'student',
        class_id: selectedClass,
      });

      if (profileError) {
        alert('创建学生失败: ' + profileError.message);
        return;
      }

      setNewStudent({ username: '', real_name: '', password: '' });
      setShowAddModal(false);
      await fetchStudents();
      alert('学生添加成功');
    } catch (err) {
      alert('添加学生异常: ' + (err as Error).message);
    }
  };

  const handleBatchImport = async () => {
    if (!selectedClass || !batchText.trim()) {
      alert('请输入学生信息');
      return;
    }

    const lines = batchText.trim().split('\n').filter(line => line.trim());
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const line of lines) {
      const parts = line.split(/[,\s]+/).filter(p => p.trim());
      if (parts.length < 2) {
        failed++;
        errors.push(`格式错误: ${line}`);
        continue;
      }

      const username = parts[0].trim();
      const realName = parts[1].trim();
      const password = parts[2]?.trim() || '123456';
      const email = `${username}@meoo.local`;

      try {
        const { data: existingProfile } = await backendClient
          .from('profiles')
          .select('id')
          .eq('username', username)
          .maybeSingle();

        if (existingProfile) {
          await backendClient
            .from('profiles')
            .update({ class_id: selectedClass, real_name: realName })
            .eq('id', existingProfile.id);
          success++;
          continue;
        }

        const passwordHash = await calculateSHA256(password);
        const newUserId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const { error: profileError } = await backendClient.from('profiles').insert({
          id: newUserId,
          username,
          password_hash: passwordHash,
          real_name: realName,
          role: 'student',
          class_id: selectedClass,
        });

        if (profileError) {
          failed++;
          errors.push(`${username}: ${profileError.message}`);
          continue;
        }

        success++;
      } catch (err) {
        failed++;
        errors.push(`${username}: ${(err as Error).message}`);
      }
    }

    setBatchResults({ success, failed, errors });
    fetchStudents();

    if (failed === 0) {
      alert(`批量导入完成: ${success} 个学生添加成功`);
      setBatchText('');
      setShowBatchModal(false);
    }
  };

  const handleEditStudent = (student: StudentWithStats) => {
    setEditingStudent(student);
    setEditForm({
      real_name: student.real_name || '',
      username: student.username || '',
      current_points: student.current_points || 0,
      max_points: student.max_points || 0,
      class_id: student.class_id || '',
    });
    setPasswordForm({ newPassword: '', confirmPassword: '' });
    setShowEditModal(true);
  };

  // 计算 SHA256 哈希（兼容所有浏览器）
  const calculateSHA256 = async (str: string): Promise<string> => {
    // 方法1：尝试使用 Web Crypto API
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    // 方法2：使用内置的 SHA256 实现
    const sha256 = (text: string): string => {
      const rotateRight = (n: number, s: number) => (n >>> s) | (n << (32 - s));
      const ch = (x: number, y: number, z: number) => ((x & y) ^ (~x & z));
      const maj = (x: number, y: number, z: number) => ((x & y) ^ (x & z) ^ (y & z));
      const sigma0 = (x: number) => rotateRight(x, 2) ^ rotateRight(x, 13) ^ rotateRight(x, 22);
      const sigma1 = (x: number) => rotateRight(x, 6) ^ rotateRight(x, 11) ^ rotateRight(x, 25);
      const gamma0 = (x: number) => rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const gamma1 = (x: number) => rotateRight(x, 17) ^ rotateRight(x, 19) ^ (x >>> 10);
      
      const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
      ];
      
      let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
      let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
      
      const bytes: number[] = [];
      for (let i = 0; i < text.length; i++) {
        bytes.push(text.charCodeAt(i));
      }
      bytes.push(0x80);
      while (bytes.length % 64 !== 56) bytes.push(0);
      const bitLen = text.length * 8;
      for (let i = 7; i >= 0; i--) {
        bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
      }
      
      for (let i = 0; i < bytes.length / 64; i++) {
        const w = new Array(64).fill(0);
        for (let j = 0; j < 16; j++) {
          w[j] = (bytes[i * 64 + j * 4] << 24) | (bytes[i * 64 + j * 4 + 1] << 16) | (bytes[i * 64 + j * 4 + 2] << 8) | bytes[i * 64 + j * 4 + 3];
        }
        for (let j = 16; j < 64; j++) {
          w[j] = (gamma1(w[j - 2]) + w[j - 7] + gamma0(w[j - 15]) + w[j - 16]) >>> 0;
        }
        
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        
        for (let j = 0; j < 64; j++) {
          const t1 = (h + sigma1(e) + ch(e, f, g) + K[j] + w[j]) >>> 0;
          const t2 = (sigma0(a) + maj(a, b, c)) >>> 0;
          h = g; g = f; f = e; e = (d + t1) >>> 0;
          d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
      }
      
      const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
      return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
    };
    
    return sha256(str);
  };

  const handleSaveEdit = async () => {
    if (!editingStudent) return;

    if (passwordForm.newPassword) {
      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        alert('两次输入的密码不一致');
        return;
      }

      // 计算 SHA256 哈希
      const passwordHash = await calculateSHA256(passwordForm.newPassword);

      const { error: passwordError } = await backendClient
        .from('profiles')
        .update({ password_hash: passwordHash })
        .eq('id', editingStudent.id);

      if (passwordError) {
        alert('密码修改失败: ' + passwordError.message);
        return;
      }
    }

    const { data, error } = await backendClient
      .from('profiles')
      .update({
        real_name: editForm.real_name,
        username: editForm.username,
        current_points: editForm.current_points,
        max_points: editForm.max_points,
        class_id: editForm.class_id || null,
      })
      .eq('id', editingStudent.id)
      .select();

    if (error) {
      alert('更新失败: ' + error.message);
      return;
    }

    setStudents(prev => prev.map(s =>
      s.id === editingStudent.id
        ? { ...s, ...editForm }
        : s
    ));

    setShowEditModal(false);
    setEditingStudent(null);
    setPasswordForm({ newPassword: '', confirmPassword: '' });
    alert('学生信息更新成功');
  };

  const handleBatchResetPassword = async () => {
    if (selectedStudents.size === 0) {
      alert('请先选择学生');
      return;
    }
    if (!batchResetPassword) {
      alert('请输入新密码');
      return;
    }

    let success = 0;
    let failed = 0;

    // 计算 SHA256 哈希
    const passwordHash = await calculateSHA256(batchResetPassword);

    for (const studentId of selectedStudents) {
      const { error } = await backendClient
        .from('profiles')
        .update({ password_hash: passwordHash })
        .eq('id', studentId);

      if (error) {
        failed++;
      } else {
        success++;
      }
    }

    setShowBatchResetPasswordModal(false);
    setBatchResetPassword('');
    setSelectedStudents(new Set());

    if (failed > 0) {
      alert(`批量重置完成: ${success} 个成功, ${failed} 个失败`);
    } else {
      alert(`已成功重置 ${success} 个学生的密码`);
    }
  };

  const handleBatchDelete = () => {
    if (selectedStudents.size === 0) {
      alert('请先选择学生');
      return;
    }
    setShowBatchDeleteConfirm(true);
  };

  const confirmBatchDelete = async () => {
    let success = 0;
    for (const studentId of selectedStudents) {
      // 先删除关联数据（添加错误处理，防止某个表不存在导致删除失败）
      const tablesToDelete = [
        'app_reviews',
        'app_usage_logs',
        'code_snippets',
        'exam_records',
        'exchange_records',
        'notes',
        'notification_recipients',
        'notifications',
        'point_transactions',
        'student_answers',
        'student_app_usage',
        'student_pets',
        'student_word_progress',
        'test_records',
        'wrong_questions'
      ];

      for (const table of tablesToDelete) {
        try {
          await backendClient.from(table).delete().eq('student_id', studentId);
        } catch (e) {
          console.warn(`删除表 ${table} 失败或表不存在:`, e);
        }
      }

      const { error } = await backendClient.from('profiles').delete().eq('id', studentId);
      if (!error) success++;
    }

    setShowBatchDeleteConfirm(false);
    setSelectedStudents(new Set());
    await fetchStudents();
    alert(`已删除 ${success} 个学生`);
  };

  const handleBatchEdit = async () => {
    if (selectedStudents.size === 0) {
      alert('请先选择学生');
      return;
    }
    setShowBatchEditModal(true);
  };

  const handleToggleExchange = async (studentId: string, canExchange: boolean) => {
    await backendClient
      .from('profiles')
      .update({ can_exchange_internet_code: canExchange })
      .eq('id', studentId);
    fetchStudents();
  };

  const handleBatchToggleExchange = async (canExchange: boolean) => {
    if (selectedStudents.size === 0) {
      alert('请先选择学生');
      return;
    }
    for (const studentId of selectedStudents) {
      await backendClient
        .from('profiles')
        .update({ can_exchange_internet_code: canExchange })
        .eq('id', studentId);
    }
    setSelectedStudents(new Set());
    fetchStudents();
    alert(`已批量设置 ${selectedStudents.size} 个学生的兑换权限`);
  };

  const handleToggleHiddenFeature = async (studentId: string, feature: string, hidden: boolean) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return;
    const current = student.hidden_features || ['paint_board', 'roll_call'];
    let next: string[];
    if (hidden) {
      next = current.includes(feature) ? current : [...current, feature];
    } else {
      next = current.filter((f) => f !== feature);
    }
    await backendClient
      .from('profiles')
      .update({ hidden_features: JSON.stringify(next) })
      .eq('id', studentId);
    fetchStudents();
  };

  const handleBatchToggleHiddenFeature = async (feature: string, hidden: boolean) => {
    if (selectedStudents.size === 0) {
      alert('请先选择学生');
      return;
    }
    for (const studentId of selectedStudents) {
      const student = students.find((s) => s.id === studentId);
      const current = student?.hidden_features || ['paint_board', 'roll_call'];
      let next: string[];
      if (hidden) {
        next = current.includes(feature) ? current : [...current, feature];
      } else {
        next = current.filter((f) => f !== feature);
      }
      await backendClient
        .from('profiles')
        .update({ hidden_features: JSON.stringify(next) })
        .eq('id', studentId);
    }
    setSelectedStudents(new Set());
    fetchStudents();
    alert(`已批量设置 ${selectedStudents.size} 个学生的隐藏功能`);
  };

  const handleSaveBatchEdit = async () => {
    const updates: any = {};
    if (batchEditField === 'current_points') {
      updates.current_points = batchEditValue;
    } else {
      updates.max_points = batchEditValue;
    }

    const count = selectedStudents.size;
    for (const studentId of selectedStudents) {
      await backendClient
        .from('profiles')
        .update(updates)
        .eq('id', studentId);
    }

    setShowBatchEditModal(false);
    setSelectedStudents(new Set());
    await fetchStudents();
    alert(`已批量更新 ${count} 个学生`);
  };

  const toggleSelectAll = () => {
    if (selectedStudents.size === students.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(students.map(s => s.id)));
    }
  };

  const toggleSelectStudent = (id: string) => {
    const newSet = new Set(selectedStudents);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedStudents(newSet);
  };

  const handleDeleteStudent = (id: string) => {
    setDeleteTargetId(id);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteStudent = async () => {
    if (!deleteTargetId) return;

    // 先删除关联数据（添加错误处理，防止某个表不存在导致删除失败）
    const tablesToDelete = [
      'app_reviews',
      'app_usage_logs',
      'code_snippets',
      'exam_records',
      'exchange_records',
      'notes',
      'notification_recipients',
      'notifications',
      'point_transactions',
      'student_answers',
      'student_app_usage',
      'student_pets',
      'student_word_progress',
      'test_records',
      'wrong_questions'
    ];

    for (const table of tablesToDelete) {
      try {
        await backendClient.from(table).delete().eq('student_id', deleteTargetId);
      } catch (e) {
        console.warn(`删除表 ${table} 失败或表不存在:`, e);
      }
    }

    // 再删除学生资料
    const { error } = await backendClient.from('profiles').delete().eq('id', deleteTargetId);

    if (error) {
      alert('删除失败: ' + error.message);
      return;
    }

    setShowDeleteConfirm(false);
    setDeleteTargetId(null);
    // 更新本地状态
    setStudents(prev => prev.filter(s => s.id !== deleteTargetId));
    alert('学生删除成功');
  };

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      onClick={() => handleSort(field)}
      className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
    >
      <span className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} text-blue-500`}></i>
        )}
      </span>
    </th>
  );

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
        <h2 className="text-2xl font-bold text-gray-800">学生管理</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setShowNoClassStudents(!showNoClassStudents);
              setSelectedClass('');
            }}
            className={`px-4 py-2 rounded-lg transition-colors ${
              showNoClassStudents
                ? 'bg-orange-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <i className="fa-solid fa-user-slash mr-2"></i>
            无班级学生
          </button>
          <select
            value={selectedClass}
            onChange={(e) => {
              setSelectedClass(e.target.value);
              setShowNoClassStudents(false);
            }}
            disabled={showNoClassStudents}
            className="p-2 border border-gray-300 rounded-lg disabled:opacity-50"
          >
            <option value="">选择班级</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
          {selectedStudents.size > 0 && (
            <>
              <button
                onClick={handleBatchEdit}
                className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                <i className="fa-solid fa-edit mr-2"></i>
                批量设置 ({selectedStudents.size})
              </button>
              <button
                onClick={() => handleBatchToggleExchange(true)}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                <i className="fa-solid fa-check mr-2"></i>
                批量允许兑换 ({selectedStudents.size})
              </button>
              <button
                onClick={() => handleBatchToggleExchange(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                <i className="fa-solid fa-ban mr-2"></i>
                批量禁止兑换 ({selectedStudents.size})
              </button>
              <button
                onClick={() => handleBatchToggleHiddenFeature('paint_board', true)}
                className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
              >
                <i className="fa-solid fa-eye-slash mr-2"></i>
                批量隐藏画笔 ({selectedStudents.size})
              </button>
              <button
                onClick={() => handleBatchToggleHiddenFeature('paint_board', false)}
                className="px-4 py-2 bg-indigo-400 text-white rounded-lg hover:bg-indigo-500 transition-colors"
              >
                <i className="fa-solid fa-eye mr-2"></i>
                批量显示画笔 ({selectedStudents.size})
              </button>
              <button
                onClick={() => handleBatchToggleHiddenFeature('roll_call', true)}
                className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                <i className="fa-solid fa-eye-slash mr-2"></i>
                批量隐藏点名 ({selectedStudents.size})
              </button>
              <button
                onClick={() => handleBatchToggleHiddenFeature('roll_call', false)}
                className="px-4 py-2 bg-purple-400 text-white rounded-lg hover:bg-purple-500 transition-colors"
              >
                <i className="fa-solid fa-eye mr-2"></i>
                批量显示点名 ({selectedStudents.size})
              </button>
              <button
                onClick={() => setShowBatchResetPasswordModal(true)}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
              >
                <i className="fa-solid fa-key mr-2"></i>
                批量重置密码 ({selectedStudents.size})
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                <i className="fa-solid fa-trash mr-2"></i>
                批量删除 ({selectedStudents.size})
              </button>
            </>
          )}
          <button
            onClick={() => setShowBatchModal(true)}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            <i className="fa-solid fa-file-import mr-2"></i>
            批量导入
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <i className="fa-solid fa-plus mr-2"></i>
            添加学生
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={selectedStudents.size === students.length && students.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <SortHeader field="real_name">姓名</SortHeader>
              <SortHeader field="username">账号</SortHeader>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">班级</th>
              <SortHeader field="current_points">当前积分</SortHeader>
              <SortHeader field="total_answers">做题量</SortHeader>
              <SortHeader field="accuracy">正确率</SortHeader>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">萌宠</th>
              <SortHeader field="is_online">在线</SortHeader>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">兑换</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                <span
                  className="relative cursor-help group"
                  title="是否隐藏学生桌面上某些功能"
                >
                  隐藏功能
                </span>
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedStudents.map((student) => (
              <tr key={student.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={selectedStudents.has(student.id)}
                    onChange={() => toggleSelectStudent(student.id)}
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-3 font-medium text-gray-800">{student.real_name}</td>
                <td className="px-4 py-3 text-gray-600">{student.username}</td>
                <td className="px-4 py-3 text-gray-600">
                  {student.class ? (
                    <span className="px-2 py-1 bg-blue-100 text-blue-600 rounded-full text-xs">
                      {student.class.name}
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-orange-100 text-orange-600 rounded-full text-xs">
                      无班级
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-yellow-600 font-medium">{student.current_points || 0}</td>
                <td className="px-4 py-3 text-center text-gray-600">{student.total_answers || 0}</td>
                <td className="px-4 py-3 text-center text-gray-600">{student.accuracy || 0}%</td>
                <td className="px-4 py-3 text-center">
                  {student.has_pet ? (
                    <span className="px-2 py-1 bg-pink-100 text-pink-600 rounded-full text-xs">
                      Lv.{student.pet_level}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {student.is_online ? (
                    <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-600 rounded-full text-xs">
                      <span className="w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>
                      在线
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-400 rounded-full text-xs">
                      <span className="w-2 h-2 bg-gray-400 rounded-full mr-1"></span>
                      离线
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => handleToggleExchange(student.id, !student.can_exchange_internet_code)}
                    className={`px-2 py-1 rounded-full text-xs transition-colors ${
                      student.can_exchange_internet_code
                        ? 'bg-green-100 text-green-600 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                    }`}
                  >
                    <i className={`fa-solid ${student.can_exchange_internet_code ? 'fa-check' : 'fa-ban'} mr-1`}></i>
                    {student.can_exchange_internet_code ? '允许' : '禁止'}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => handleToggleHiddenFeature(student.id, 'paint_board', !(student.hidden_features || ['paint_board', 'roll_call']).includes('paint_board'))}
                      className={`px-2 py-1 rounded-full text-xs transition-colors ${
                        (student.hidden_features || ['paint_board', 'roll_call']).includes('paint_board')
                          ? 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                      }`}
                      title="画笔功能"
                    >
                      <i className="fa-solid fa-pen-to-square mr-1"></i>
                      画笔
                    </button>
                    <button
                      onClick={() => handleToggleHiddenFeature(student.id, 'roll_call', !(student.hidden_features || ['paint_board', 'roll_call']).includes('roll_call'))}
                      className={`px-2 py-1 rounded-full text-xs transition-colors ${
                        (student.hidden_features || ['paint_board', 'roll_call']).includes('roll_call')
                          ? 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          : 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                      }`}
                      title="点名功能"
                    >
                      <i className="fa-solid fa-hand-pointer mr-1"></i>
                      点名
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleEditStudent(student)}
                    className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors mr-2"
                  >
                    <i className="fa-solid fa-edit"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteStudent(student.id);
                    }}
                    className="text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                    type="button"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {students.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <i className="fa-solid fa-user-graduate text-4xl mb-4"></i>
            <p>暂无学生</p>
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">添加学生</h3>
            <div className="space-y-4">
              <input
                type="text"
                value={newStudent.username}
                onChange={(e) => setNewStudent({ ...newStudent, username: e.target.value })}
                placeholder="用户名"
                className="w-full p-3 border border-gray-300 rounded-lg"
              />
              <input
                type="text"
                value={newStudent.real_name}
                onChange={(e) => setNewStudent({ ...newStudent, real_name: e.target.value })}
                placeholder="姓名"
                className="w-full p-3 border border-gray-300 rounded-lg"
              />
              <input
                type="password"
                value={newStudent.password}
                onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })}
                placeholder="密码"
                className="w-full p-3 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleAddStudent}
                className="flex-1 py-2 bg-blue-500 text-white rounded-lg"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">批量导入学生</h3>
            <p className="text-sm text-gray-500 mb-2">格式：用户名 姓名 密码（每行一个，密码可选，默认123456）</p>
            <textarea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder="zhangsan 张三 123456&#10;lisi 李四&#10;wangwu 王五 654321"
              className="w-full h-40 p-3 border border-gray-300 rounded-lg resize-none"
            />
            {batchResults.failed > 0 && (
              <div className="mt-4 p-3 bg-red-50 rounded-lg">
                <p className="text-red-600 font-medium">导入结果：成功 {batchResults.success} 个，失败 {batchResults.failed} 个</p>
                <div className="mt-2 max-h-32 overflow-y-auto text-sm text-red-500">
                  {batchResults.errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowBatchModal(false);
                  setBatchText('');
                  setBatchResults({ success: 0, failed: 0, errors: [] });
                }}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleBatchImport}
                className="flex-1 py-2 bg-green-500 text-white rounded-lg"
              >
                导入
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && editingStudent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">编辑学生</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名</label>
                <input
                  type="text"
                  value={editForm.real_name}
                  onChange={(e) => setEditForm({ ...editForm, real_name: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                <input
                  type="text"
                  value={editForm.username}
                  onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">当前积分</label>
                <input
                  type="number"
                  value={editForm.current_points}
                  onChange={(e) => setEditForm({ ...editForm, current_points: parseInt(e.target.value) || 0 })}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">最高积分</label>
                <input
                  type="number"
                  value={editForm.max_points}
                  onChange={(e) => setEditForm({ ...editForm, max_points: parseInt(e.target.value) || 0 })}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">所属班级</label>
                <select
                  value={editForm.class_id}
                  onChange={(e) => setEditForm({ ...editForm, class_id: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                >
                  <option value="">无班级</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </div>
              <div className="border-t border-gray-200 pt-4 mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">新密码（留空则不修改）</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  placeholder="输入新密码"
                  className="w-full p-3 border border-gray-300 rounded-lg mb-2"
                />
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  placeholder="确认新密码"
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowEditModal(false)}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-2 bg-blue-500 text-white rounded-lg"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">批量设置 ({selectedStudents.size}人)</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">设置字段</label>
                <select
                  value={batchEditField}
                  onChange={(e) => setBatchEditField(e.target.value as 'current_points' | 'max_points')}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                >
                  <option value="current_points">当前积分</option>
                  <option value="max_points">最高积分</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">数值</label>
                <input
                  type="number"
                  value={batchEditValue}
                  onChange={(e) => setBatchEditValue(parseInt(e.target.value) || 0)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowBatchEditModal(false)}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleSaveBatchEdit}
                className="flex-1 py-2 bg-purple-500 text-white rounded-lg"
              >
                确认设置
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchResetPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              <i className="fa-solid fa-key text-orange-500 mr-2"></i>
              批量重置密码 ({selectedStudents.size}人)
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                <input
                  type="password"
                  value={batchResetPassword}
                  onChange={(e) => setBatchResetPassword(e.target.value)}
                  placeholder="请输入新密码"
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="bg-yellow-50 p-3 rounded-lg text-sm text-yellow-700">
                <i className="fa-solid fa-exclamation-triangle mr-1"></i>
                将为选中的 {selectedStudents.size} 个学生统一重置为此密码
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowBatchResetPasswordModal(false);
                  setBatchResetPassword('');
                }}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleBatchResetPassword}
                disabled={!batchResetPassword}
                className="flex-1 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              <i className="fa-solid fa-exclamation-triangle text-red-500 mr-2"></i>
              确认删除
            </h3>
            <p className="text-gray-600 mb-6">
              确定要删除这个学生吗？此操作不可恢复！
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
                onClick={confirmDeleteStudent}
                className="flex-1 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              <i className="fa-solid fa-exclamation-triangle text-red-500 mr-2"></i>
              确认批量删除
            </h3>
            <p className="text-gray-600 mb-6">
              确定要删除选中的 {selectedStudents.size} 个学生吗？此操作不可恢复！
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmBatchDelete}
                className="flex-1 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
