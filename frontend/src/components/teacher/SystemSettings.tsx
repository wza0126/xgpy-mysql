import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';
import { useAuth } from '../../hooks/useAuth';
import { applySiteConfig, useSiteConfig } from '../../hooks/useSiteConfig';

const API_BASE = API_CONFIG.apiUrl;

type TeacherProfile = {
  id: string;
  username: string;
  real_name: string;
};

type PasswordForm = {
  current: string;
  new: string;
  confirm: string;
};

type NewTeacherForm = {
  username: string;
  password: string;
  confirmPassword: string;
  real_name: string;
};

type EditTeacherForm = {
  username: string;
  real_name: string;
};

type SecuritySettingsType = {
  max_concurrent_sessions_teacher: number;
  max_concurrent_sessions_student: number;
  session_timeout_hours: number;
  allow_multiple_devices_teacher: boolean;
  allow_multiple_devices_student: boolean;
  enable_ip_binding: boolean;
  require_password_change_days: number;
  enable_login_alert: boolean;
};

type UserSessionStats = {
  id: string;
  username: string;
  real_name: string;
  role: string;
  class_id: string | null;
  class_name: string | null;
  active_session_count: number;
  last_activity: string | null;
  ip_address: string | null;
};

type ClassInfo = {
  id: string;
  name: string;
};

export const SystemSettings: React.FC = () => {
  const siteConfig = useSiteConfig();
  const defaultConfigs: Record<string, any> = {
    points_correct_answer: 10,
    points_wrong_answer: -5,
    master_question_threshold: 3,
    pet_adoption_threshold: 100,
    pet_change_threshold: 100,
    ai_api_base_url: '',
    ai_api_key: '',
    ai_model: 'deepseek-v4-flash',
    ai_temperature: 0.7,
    ai_max_tokens: 2000,
    ai_qa_system_prompt: `你是江苏省高中信息技术、Python编程专属答疑老师。
1. 严格按照江苏高中信息技术教材、学业水平考试大纲回答问题。
2. 只讲解知识点、解题思路、代码原理，绝不直接提供作业/考试答案。
3. Python讲解使用高中教学标准语法，通俗易懂，分步骤说明。
4. 回答简洁、准确，不使用大学/专业术语。
5. 拒绝代写代码、拒绝作业代写、拒绝考试作弊相关请求。
6. 涉及学考内容，自动补充江苏高频考点和答题技巧。`,
    ai_qa_points_per_question: 5,
    crit_base_rate: 5,
    crit_max_rate: 30,
    honor_perfect_buff_crit: 5,
    honor_perfect_buff_minutes: 10,
    honor_critstreak_buff_crit: 10,
    honor_critstreak_buff_minutes: 10,
    honor_wrong_debuff_crit: 10,
    honor_wrong_debuff_minutes: 1,
    site_title: '西高中学习平台',
    site_subtitle: '江苏省高中信息技术',
  };

  const defaultSecuritySettings: SecuritySettingsType = {
    max_concurrent_sessions_teacher: 5,
    max_concurrent_sessions_student: 1,
    session_timeout_hours: 24,
    allow_multiple_devices_teacher: true,
    allow_multiple_devices_student: false,
    enable_ip_binding: false,
    require_password_change_days: 90,
    enable_login_alert: false,
  };

  const [configs, setConfigs] = useState<Record<string, any>>(defaultConfigs);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettingsType>(defaultSecuritySettings);
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [userSessions, setUserSessions] = useState<UserSessionStats[]>([]);
  const [editingTeacher, setEditingTeacher] = useState<string | null>(null);
  const [editingTeacherInfo, setEditingTeacherInfo] = useState<EditTeacherForm | null>(null);
  const [teacherPasswords, setTeacherPasswords] = useState<Record<string, PasswordForm>>({});
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [newTeacher, setNewTeacher] = useState<NewTeacherForm>({
    username: '',
    password: '',
    confirmPassword: '',
    real_name: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [activeTab, setActiveTab] = useState('ai');
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterClass, setFilterClass] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('last_activity');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [desktopBackground, setDesktopBackground] = useState<string>('');
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage] = useState<number>(100);
  const { profile, updatePassword } = useAuth();
  // 系统授权状态
  const [licenseMachineCode, setLicenseMachineCode] = useState<string>('');
  const [licenseCode, setLicenseCode] = useState<string>('');
  const [isActivated, setIsActivated] = useState(false);
  const [activatedAt, setActivatedAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isInTrial, setIsInTrial] = useState(false);
  const [isLicenseValid, setIsLicenseValid] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const [isExpiringSoon, setIsExpiringSoon] = useState(false);
  const [licenseInput, setLicenseInput] = useState<string>('');
  const [genMachineCode, setGenMachineCode] = useState<string>('');
  const [genLicenseCode, setGenLicenseCode] = useState<string>('');
  const [genMonths, setGenMonths] = useState(13);
  const [licenseLoading, setLicenseLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  // 学生自定义背景配置
  const [studentBgSettings, setStudentBgSettings] = useState<{
    enabled: boolean;
    classIds: string[];
    points: number;
    freePerDay: number;
  }>({
    enabled: false,
    classIds: [],
    points: 10,
    freePerDay: 1
  });
  const [savingStudentBgSettings, setSavingStudentBgSettings] = useState(false);
  // 背景库列表
  const [backgroundLibrary, setBackgroundLibrary] = useState<any[]>([]);
  const [loadingBackgroundLibrary, setLoadingBackgroundLibrary] = useState(false);

  useEffect(() => {
    fetchConfigs();
    fetchTeachers();
    fetchSecuritySettings();
    fetchUserSessions();
    fetchClasses();
    fetchDesktopBackground();
    fetchLicenseStatus();
    fetchStudentBgSettings();
    fetchBackgroundLibrary();
  }, []);

  const fetchDesktopBackground = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/desktop-background`);
      const result = await response.json();
      if (result.data && result.data.url) {
        setDesktopBackground(result.data.url);
      }
    } catch (error) {
      console.error('获取桌面背景失败:', error);
    }
  };

  const handleBackgroundUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('只允许上传 JPG、PNG、GIF、WEBP 格式的图片');
      return;
    }

    // 验证文件大小 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过 5MB');
      return;
    }

    setUploadingBackground(true);

    try {
      const formData = new FormData();
      formData.append('background', file);

      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await fetch(`${API_BASE}/api/desktop-background/upload`, {
        method: 'POST',
        headers,
        body: formData
      });

      const result = await response.json();

      if (result.data && result.data.success) {
        setDesktopBackground(result.data.url);
        alert('桌面背景上传成功！');
      } else {
        alert(result.error || '上传失败');
      }
    } catch (error) {
      console.error('上传桌面背景失败:', error);
      alert('上传失败，请稍后重试');
    } finally {
      setUploadingBackground(false);
    }
  };

  const fetchSecuritySettings = async () => {
    try {
      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/api/security-settings`, { headers });
      const result = await response.json();
      if (result.data) {
        setSecuritySettings({
          max_concurrent_sessions_teacher: result.data.max_concurrent_sessions_teacher ?? 5,
          max_concurrent_sessions_student: result.data.max_concurrent_sessions_student ?? 1,
          session_timeout_hours: result.data.session_timeout_hours ?? 24,
          allow_multiple_devices_teacher: result.data.allow_multiple_devices_teacher === 1 || result.data.allow_multiple_devices_teacher === true,
          allow_multiple_devices_student: result.data.allow_multiple_devices_student === 1 || result.data.allow_multiple_devices_student === true,
          enable_ip_binding: result.data.enable_ip_binding === 1 || result.data.enable_ip_binding === true,
          require_password_change_days: result.data.require_password_change_days ?? 90,
          enable_login_alert: result.data.enable_login_alert === 1 || result.data.enable_login_alert === true
        });
      } else {
        // 如果没有设置，使用默认值
        setSecuritySettings(defaultSecuritySettings);
      }
    } catch (error) {
      console.error('获取安全设置失败:', error);
      // 出错时使用默认值
      setSecuritySettings(defaultSecuritySettings);
    }
  };

  const fetchUserSessions = async () => {
    try {
      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/api/admin/sessions-stats`, { headers });
      const result = await response.json();
      if (result.data) {
        setUserSessions(result.data);
      }
    } catch (error) {
      console.error('获取用户会话失败:', error);
    }
  };

  const fetchClasses = async () => {
    try {
      console.log('正在获取班级列表...');
      const response = await fetch(`${API_BASE}/api/classes`);
      console.log('响应状态:', response.status);
      const result = await response.json();
      console.log('班级列表响应:', result);
      if (result.data) {
        setClasses(result.data);
        console.log('设置班级列表:', result.data);
      } else {
        console.log('没有 data 字段');
      }
    } catch (error) {
      console.error('获取班级列表失败:', error);
    }
  };

  // 获取学生自定义背景配置
  const fetchStudentBgSettings = async () => {
    try {
      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/api/config/student-bg-settings`, { headers });
      const result = await response.json();
      if (result.data) {
        setStudentBgSettings({
          enabled: result.data.enabled ?? false,
          classIds: result.data.classIds ?? [],
          points: result.data.points ?? 10,
          freePerDay: result.data.freePerDay ?? 1
        });
      }
    } catch (error) {
      console.error('获取学生背景配置失败:', error);
    }
  };

  // 获取背景库列表
  const fetchBackgroundLibrary = async () => {
    setLoadingBackgroundLibrary(true);
    try {
      const response = await fetch(`${API_BASE}/api/desktop-backgrounds/list`);
      const result = await response.json();
      if (result.data) {
        setBackgroundLibrary(result.data);
      }
    } catch (error) {
      console.error('获取背景库列表失败:', error);
    } finally {
      setLoadingBackgroundLibrary(false);
    }
  };

  // 保存学生背景配置
  const handleSaveStudentBgSettings = async () => {
    setSavingStudentBgSettings(true);
    try {
      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/api/config/student-bg-settings`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(studentBgSettings)
      });
      const result = await response.json();
      if (result.data && result.data.success) {
        alert('学生背景配置保存成功！');
      } else {
        alert(result.error || '保存失败');
      }
    } catch (error) {
      console.error('保存学生背景配置失败:', error);
      alert('保存失败，请稍后重试');
    } finally {
      setSavingStudentBgSettings(false);
    }
  };

  // 上传背景到背景库
  const handleUploadToLibrary = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('只允许上传 JPG、PNG、GIF、WEBP 格式的图片');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过 5MB');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('background', file);
      formData.append('name', file.name.split('.')[0]);

      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await fetch(`${API_BASE}/api/desktop-backgrounds`, {
        method: 'POST',
        headers,
        body: formData
      });

      const result = await response.json();
      if (result.data && result.data.success) {
        fetchBackgroundLibrary();
        alert('背景添加成功！');
      } else {
        alert(result.error || '添加失败');
      }
    } catch (error) {
      console.error('上传背景到库失败:', error);
      alert('上传失败，请稍后重试');
    }
  };

  // 删除背景库中的背景
  const handleDeleteBackgroundFromLibrary = async (id: string) => {
    if (!confirm('确定要删除这个背景吗？')) return;

    try {
      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await fetch(`${API_BASE}/api/desktop-backgrounds/${id}`, {
        method: 'DELETE',
        headers
      });

      const result = await response.json();
      if (result.data && result.data.success) {
        fetchBackgroundLibrary();
        alert('背景删除成功！');
      } else {
        alert(result.error || '删除失败');
      }
    } catch (error) {
      console.error('删除背景失败:', error);
      alert('删除失败，请稍后重试');
    }
  };

  // 启用/禁用背景
  const handleToggleBackgroundActive = async (id: string, isActive: boolean) => {
    try {
      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await fetch(`${API_BASE}/api/desktop-backgrounds/${id}`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_active: isActive ? 0 : 1 })
      });

      const result = await response.json();
      if (result.data && result.data.success) {
        fetchBackgroundLibrary();
      } else {
        alert(result.error || '操作失败');
      }
    } catch (error) {
      console.error('更新背景状态失败:', error);
      alert('操作失败，请稍后重试');
    }
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  const sortedAndFilteredSessions = () => {
    let filtered = userSessions.filter(u => {
      const roleMatch = filterRole === 'all' || u.role === filterRole;
      const classMatch = filterClass === 'all' || u.class_id === filterClass;
      return roleMatch && classMatch;
    });

    return filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortBy) {
        case 'real_name':
          aVal = a.username.toLowerCase();
          bVal = b.username.toLowerCase();
          break;
        case 'role':
          aVal = a.role;
          bVal = b.role;
          break;
        case 'class_name':
          aVal = a.class_name || '';
          bVal = b.class_name || '';
          break;
        case 'ip_address':
          aVal = a.ip_address || '';
          bVal = b.ip_address || '';
          break;
        case 'active_session_count':
          aVal = a.active_session_count;
          bVal = b.active_session_count;
          break;
        case 'last_activity':
          aVal = a.last_activity ? new Date(a.last_activity).getTime() : 0;
          bVal = b.last_activity ? new Date(b.last_activity).getTime() : 0;
          break;
        default:
          aVal = a.last_activity ? new Date(a.last_activity).getTime() : 0;
          bVal = b.last_activity ? new Date(b.last_activity).getTime() : 0;
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      }
      return aVal < bVal ? 1 : -1;
    });
  };

  const paginatedSessions = () => {
    const sorted = sortedAndFilteredSessions();
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return sorted.slice(startIndex, endIndex);
  };

  const totalPages = () => {
    return Math.ceil(sortedAndFilteredSessions().length / itemsPerPage);
  };

  const handleSaveSecuritySettings = async () => {
    setSavingSecurity(true);
    try {
      const response = await fetch(`${API_BASE}/api/security-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(securitySettings)
      });
      
      if (response.ok) {
        alert('安全设置保存成功');
      } else {
        alert('保存失败');
      }
    } catch (error) {
      console.error('保存安全设置失败:', error);
      alert('保存失败');
    }
    setSavingSecurity(false);
  };

  const handleForceLogout = async (userId: string, realName: string) => {
    if (!confirm(`确定要踢出 ${realName} 的所有设备吗？`)) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/admin/force-logout/${userId}`, {
        method: 'POST'
      });
      
      if (response.ok) {
        alert('踢出成功');
        fetchUserSessions();
      } else {
        alert('踢出失败');
      }
    } catch (error) {
      console.error('踢出用户失败:', error);
      alert('踢出失败');
    }
  };

  const fetchConfigs = async () => {
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
    setLoading(false);
  };

  const fetchTeachers = async () => {
    const { data } = await backendClient.from('profiles').select('*').eq('role', 'teacher');
    if (data) {
      setTeachers(data);
    }
  };

  const handleSaveConfigs = async () => {
    setSaving(true);
    
    try {
      // 先加载已有配置，防止空白值覆盖已有配置
      const { data: existingData } = await backendClient.from('system_config').select('*');
      const existingMap: Record<string, any> = {};
      if (existingData) {
        existingData.forEach((item: any) => {
          existingMap[item.key] = item.value;
        });
      }

      for (const [key, value] of Object.entries(configs)) {
        // 跳过关键字段的空值保存（防止覆盖已存在的敏感配置）
        const isSensitiveField = key === 'ai_api_key' || key === 'ai_api_base_url';
        const isEmpty = value === '' || value === null || value === undefined;
        
        if (isEmpty && isSensitiveField && existingMap[key] !== undefined) {
          console.log(`跳过保存空值到 ${key}，已有配置不受影响`);
          continue;
        }

        const id = `config_${key}`;
        // 清理输入值：去首尾空格，去除反引号等非法字符
        const cleanedValue = typeof value === 'string' 
          ? value.trim().replace(/[`'"\s]/g, '').replace(/\/+$/, '') 
          : value;
        const record = { id, key, value: { value: cleanedValue } };
        const { error } = await backendClient.from('system_config').insert(record);
        
        if (error) {
          console.error(`保存配置 ${key} 失败:`, error);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      await fetchConfigs();
      // 站点标题保存后立即生效（浏览器标签页 + 各页面缓存），无需刷新
      applySiteConfig({ site_title: configs.site_title, site_subtitle: configs.site_subtitle });
      alert('保存成功');
    } catch (error) {
      console.error('保存配置失败:', error);
      alert('保存失败: ' + (error as Error).message);
    }
    
    setSaving(false);
  };

  const handleTeacherPasswordChange = async (teacherId: string) => {
    const form = teacherPasswords[teacherId];
    if (!form || !form.new || !form.confirm) {
      alert('请填写所有字段');
      return;
    }
    if (form.new !== form.confirm) {
      alert('新密码和确认密码不一致');
      return;
    }
    if (form.new.length < 6) {
      alert('新密码长度不能少于6位');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/teachers/${teacherId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.new })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update password');
      }
      
      setTeacherPasswords(prev => ({
        ...prev,
        [teacherId]: { current: '', new: '', confirm: '' }
      }));
      setEditingTeacher(null);
      alert('密码修改成功');
    } catch (error) {
      console.error('修改密码失败:', error);
      alert('修改失败');
    }
  };

  const handleAddTeacher = async () => {
    if (!newTeacher.username || !newTeacher.password || !newTeacher.real_name) {
      alert('请填写所有字段');
      return;
    }
    if (newTeacher.password !== newTeacher.confirmPassword) {
      alert('密码和确认密码不一致');
      return;
    }
    if (newTeacher.password.length < 6) {
      alert('密码长度不能少于6位');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/teachers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newTeacher.username,
          password: newTeacher.password,
          real_name: newTeacher.real_name
        })
      });

      if (!response.ok) {
        throw new Error('Failed to add teacher');
      }

      setNewTeacher({ username: '', password: '', confirmPassword: '', real_name: '' });
      setShowAddTeacher(false);
      await fetchTeachers();
      alert('添加成功');
    } catch (error) {
      console.error('添加教师失败:', error);
      alert('添加失败');
    }
  };

  const handleUpdateTeacher = async (teacherId: string) => {
    if (!editingTeacherInfo) return;

    try {
      const response = await fetch(`${API_BASE}/api/teachers/${teacherId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: editingTeacherInfo.username,
          real_name: editingTeacherInfo.real_name
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update teacher');
      }

      setEditingTeacher(null);
      setEditingTeacherInfo(null);
      await fetchTeachers();
      alert('修改成功');
    } catch (error) {
      console.error('修改教师失败:', error);
      alert('修改失败');
    }
  };

  // ===== 系统授权函数 =====
  const copyToClipboard = (text: string, message: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          alert(message);
        }).catch(() => {
          fallbackCopy(text, message);
        });
      } else {
        fallbackCopy(text, message);
      }
    } catch {
      fallbackCopy(text, message);
    }
  };

  const fallbackCopy = (text: string, message: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert(message);
  };

  const fetchLicenseStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/license/status`);
      const result = await res.json();
      if (result.data) {
        setLicenseMachineCode(result.data.machineCode || '');
        setLicenseCode(result.data.licenseCode || '');
        setIsActivated(result.data.isActivated || false);
        setActivatedAt(result.data.activatedAt || null);
        setExpiresAt(result.data.expiresAt || null);
        setIsInTrial(result.data.isInTrial || false);
        setIsLicenseValid(result.data.isValid || false);
        setDaysRemaining(result.data.daysRemaining || 0);
        setIsExpiringSoon(result.data.isExpiringSoon || false);
      }
    } catch (error) {
      console.error('获取授权状态失败:', error);
    }
  };

  const fetchMachineCode = async () => {
    setLicenseLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/license/machine-code`);
      const result = await res.json();
      if (result.data) {
        setLicenseMachineCode(result.data.machineCode);
        alert('机器码获取成功');
      } else {
        alert('获取机器码失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('获取机器码失败:', error);
      alert('获取机器码失败: ' + (error as Error).message);
    }
    setLicenseLoading(false);
  };

  const handleActivate = async () => {
    if (!licenseInput.trim()) {
      alert('请输入授权码');
      return;
    }
    setLicenseLoading(true);
    try {
      const token = localStorage.getItem('xgpy_token');
      const res = await fetch(`${API_BASE}/api/license/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ licenseCode: licenseInput.trim() })
      });
      const result = await res.json();
      if (result.data?.success) {
        alert('🎉 系统授权成功！');
        setLicenseInput('');
        fetchLicenseStatus();
      } else {
        alert('授权失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('激活失败:', error);
      alert('激活失败: ' + (error as Error).message);
    }
    setLicenseLoading(false);
  };

  const handleGenerateLicense = async () => {
    if (!genMachineCode.trim()) {
      alert('请输入机器码');
      return;
    }
    setGenLoading(true);
    try {
      const token = localStorage.getItem('xgpy_token');
      const res = await fetch(`${API_BASE}/api/license/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ machineCode: genMachineCode.trim(), months: genMonths })
      });
      const result = await res.json();
      if (result.data?.licenseCode) {
        setGenLicenseCode(result.data.licenseCode);
      } else {
        alert('生成失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('生成授权码失败:', error);
      alert('生成失败: ' + (error as Error).message);
    }
    setGenLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  const tabs = [
    { id: 'site', label: '站点设置', icon: 'fa-earth-asia' },
    { id: 'ai', label: 'AI设置', icon: 'fa-robot' },
    { id: 'desktop', label: '桌面背景', icon: 'fa-image' },
    { id: 'security', label: '安全配置', icon: 'fa-shield-halved' },
    { id: 'teachers', label: '教师账号', icon: 'fa-users-gear' },
    { id: 'license', label: '系统授权', icon: 'fa-key' },
    { id: 'update', label: '系统升级', icon: 'fa-download' },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">系统设置</h2>

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
        {activeTab === 'site' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h3 className="text-lg font-bold text-gray-800 mb-6">站点设置</h3>

            <div className="space-y-4 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">站点标题</label>
                <input
                  type="text"
                  maxLength={100}
                  value={configs.site_title ?? ''}
                  onChange={(e) => setConfigs({ ...configs, site_title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="西高中学习平台"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">副标题</label>
                <input
                  type="text"
                  maxLength={100}
                  value={configs.site_subtitle ?? ''}
                  onChange={(e) => setConfigs({ ...configs, site_subtitle: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="江苏省高中信息技术"
                />
              </div>

              {/* 系统版本（只读，来自构建信息，随每次提交/打包自动更新） */}
              <div className="pt-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">系统版本</label>
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <i className="fa-solid fa-code-branch text-gray-400"></i>
                  <span className="font-mono text-sm text-gray-700">{siteConfig.system_version || '获取中...'}</span>
                  {siteConfig.system_build_time && (
                    <span className="text-xs text-gray-400">
                      构建于 {new Date(siteConfig.system_build_time).toLocaleString('zh-CN')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">版本号随系统更新自动变化，学校部署升级后可在此处核对是否为最新版本</p>
              </div>
            </div>

            <div className="flex gap-3 mt-8 pt-6 border-t border-gray-200">
              <button
                onClick={handleSaveConfigs}
                disabled={saving}
                className="flex-1 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {saving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </motion.div>
        )}

        {activeTab === 'ai' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h3 className="text-lg font-bold text-gray-800 mb-6">AI设置</h3>
            
            <div className="space-y-4 max-w-2xl">
              <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                  <i className="fa fa-info-circle"></i>
                  DeepSeek API 配置说明
                </h4>
                <div className="text-sm text-gray-700 space-y-2">
                  <p><strong>API基础URL：</strong><code className="bg-white px-2 py-0.5 rounded">https://api.deepseek.com</code></p>
                  <p><strong>API密钥：</strong>从 DeepSeek 开放平台获取的 API Key</p>
                  <p><strong>模型名称：</strong>推荐使用 <code className="bg-white px-2 py-0.5 rounded">deepseek-v4-flash</code>（标准版）或 <code className="bg-white px-2 py-0.5 rounded">deepseek-v4-pro</code>（增强版）</p>
                  <p><strong>注意：</strong>配置时不要带多余空格和标点符号；deepseek-chat / deepseek-reasoner 将于 2026/07/24 弃用</p>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">API基础URL</label>
                <input
                  type="text"
                  placeholder="https://api.deepseek.com"
                  value={configs.ai_api_base_url ?? ''}
                  onChange={(e) => setConfigs({ ...configs, ai_api_base_url: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">API密钥</label>
                <input
                  type="password"
                  placeholder="sk-xxx"
                  value={configs.ai_api_key ?? ''}
                  onChange={(e) => setConfigs({ ...configs, ai_api_key: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">模型名称</label>
                  <select
                    value={configs.ai_model || 'deepseek-v4-flash'}
                    onChange={(e) => setConfigs({ ...configs, ai_model: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="deepseek-v4-flash">deepseek-v4-flash（推荐）</option>
                    <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                    <option value="deepseek-chat">deepseek-chat（2026/07/24 弃用）</option>
                    <option value="deepseek-reasoner">deepseek-reasoner（2026/07/24 弃用）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">温度参数</label>
                  <input
                    type="number"
                    step="0.1"
                    value={configs.ai_temperature ?? ''}
                    onChange={(e) => setConfigs({ ...configs, ai_temperature: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">最大Token数</label>
                  <input
                    type="number"
                    value={configs.ai_max_tokens ?? ''}
                    onChange={(e) => setConfigs({ ...configs, ai_max_tokens: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">每次提问消耗积分</label>
                  <input
                    type="number"
                    min="1"
                    value={configs.ai_qa_points_per_question ?? ''}
                    onChange={(e) => setConfigs({ ...configs, ai_qa_points_per_question: parseInt(e.target.value) || 5 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              
              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">AI答疑系统提示词</label>
                <textarea
                  rows={8}
                  value={configs.ai_qa_system_prompt ?? ''}
                  onChange={(e) => setConfigs({ ...configs, ai_qa_system_prompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">此提示词定义了AI的身份、行为准则和回答风格，适用于AI答疑应用</p>
              </div>

              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                  <i className="fa fa-rocket"></i>
                  功能说明
                </h4>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• <strong>题库AI出题：</strong>在题库管理中，使用AI自动生成Python编程题目</li>
                  <li>• <strong>编程AI批改：</strong>在编程管理中，使用AI自动批改学生作业并生成详细评语</li>
                  <li>• AI批改包括：语法检查、输出比对、逻辑结构分析</li>
                  <li>• 支持详细的分数 breakdown（语法40%、输出40%、逻辑20%）</li>
                </ul>
              </div>
            </div>

            <div className="flex gap-3 mt-8 pt-6 border-t border-gray-200">
              <button
                onClick={async () => {
                  if (!configs.ai_api_base_url || !configs.ai_api_key) {
                    alert('请先配置API地址和密钥');
                    return;
                  }
                  
                  try {
                    const response = await fetch(`${configs.ai_api_base_url}/chat/completions`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${configs.ai_api_key}`,
                      },
                      body: JSON.stringify({
                        messages: [{ role: 'user', content: '你好，请回复"测试成功"' }],
                        model: configs.ai_model || 'deepseek-v4-flash',
                        max_tokens: 100,
                      }),
                    });
                    
                    if (response.ok) {
                      alert('✅ AI配置测试成功！');
                    } else {
                      const error = await response.text();
                      alert(`❌ AI配置测试失败: ${response.status} - ${error}`);
                    }
                  } catch (error) {
                    alert(`❌ AI配置测试失败: ${error.message}`);
                  }
                }}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                <i className="fa fa-check-circle mr-2"></i>
                测试连接
              </button>
              
              <button
                onClick={handleSaveConfigs}
                disabled={saving}
                className="flex-1 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {saving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </motion.div>
        )}

        {activeTab === 'desktop' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h3 className="text-lg font-bold text-gray-800 mb-6">学生桌面背景设置</h3>

            <div className="space-y-6">
              {/* 学生自定义背景配置 */}
              <div className="p-6 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg">
                <h4 className="font-semibold text-purple-800 mb-4 flex items-center gap-2">
                  <i className="fa fa-users-cog"></i>
                  学生自定义背景权限
                </h4>

                {/* 开关 */}
                <div className="mb-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={studentBgSettings.enabled}
                      onChange={(e) => setStudentBgSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                      className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="font-medium text-gray-700">允许学生设置桌面背景</span>
                    <span className="text-xs text-gray-500">(开启后，选中班级的学生可以自定义背景)</span>
                  </label>
                </div>

                {/* 参数设置 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">每次设置需要的积分</label>
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      value={studentBgSettings.points}
                      onChange={(e) => setStudentBgSettings(prev => ({ ...prev, points: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      placeholder="10"
                    />
                    <p className="text-xs text-gray-500 mt-1">学生使用积分换背景时扣除的积分数量</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">每日免费次数</label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={studentBgSettings.freePerDay}
                      onChange={(e) => setStudentBgSettings(prev => ({ ...prev, freePerDay: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      placeholder="1"
                    />
                    <p className="text-xs text-gray-500 mt-1">学生每天免费换背景的次数（超出后扣积分）</p>
                  </div>
                </div>

                {/* 班级选择 */}
                {studentBgSettings.enabled && (
                  <div className="mt-4 p-4 bg-white rounded-lg border border-purple-200">
                    <h5 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                      <i className="fa fa-school"></i>
                      选择允许自定义背景的班级
                    </h5>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {classes.map(cls => (
                        <label
                          key={cls.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                            studentBgSettings.classIds.includes(cls.id)
                              ? 'bg-purple-100 border-2 border-purple-400'
                              : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={studentBgSettings.classIds.includes(cls.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setStudentBgSettings(prev => ({
                                  ...prev,
                                  classIds: [...prev.classIds, cls.id]
                                }));
                              } else {
                                setStudentBgSettings(prev => ({
                                  ...prev,
                                  classIds: prev.classIds.filter(id => id !== cls.id)
                                }));
                              }
                            }}
                            className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                          />
                          <span className="text-sm font-medium text-gray-700">{cls.name}</span>
                        </label>
                      ))}
                    </div>
                    {classes.length === 0 && (
                      <p className="text-sm text-gray-500">暂无班级数据</p>
                    )}
                  </div>
                )}

                {/* 保存按钮 */}
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleSaveStudentBgSettings}
                    disabled={savingStudentBgSettings}
                    className="px-6 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    {savingStudentBgSettings ? (
                      <>
                        <i className="fa fa-circle-notch fa-spin"></i>
                        <span>保存中...</span>
                      </>
                    ) : (
                      <>
                        <i className="fa fa-save"></i>
                        <span>保存配置</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 背景库管理 */}
              <div className="p-6 bg-gradient-to-r from-green-50 to-teal-50 border border-green-200 rounded-lg">
                <h4 className="font-semibold text-green-800 mb-4 flex items-center gap-2">
                  <i className="fa fa-images"></i>
                  背景库管理
                </h4>
                <p className="text-sm text-gray-600 mb-4">
                  上传背景图片到背景库，学生将从这个库中随机抽取背景。至少需要上传一张背景才能让学生使用自定义功能。
                </p>

                {/* 上传到背景库 */}
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-green-300 rounded-lg cursor-pointer bg-white hover:bg-green-50 transition-colors mb-4">
                  <div className="flex flex-col items-center justify-center pt-3 pb-3">
                    <i className="fa fa-plus-circle text-2xl text-green-400 mb-1"></i>
                    <p className="text-sm text-green-600 font-medium">上传新背景到背景库</p>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                    onChange={handleUploadToLibrary}
                  />
                </label>

                {/* 背景列表 */}
                {loadingBackgroundLibrary ? (
                  <div className="flex items-center justify-center py-8">
                    <i className="fa fa-circle-notch fa-spin text-2xl text-green-500"></i>
                  </div>
                ) : backgroundLibrary.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {backgroundLibrary.map((bg: any) => (
                      <div
                        key={bg.id}
                        className={`relative rounded-lg overflow-hidden border-2 ${
                          bg.is_active === 1 ? 'border-green-400' : 'border-gray-300 opacity-60'
                        }`}
                      >
                        <img
                          src={bg.url}
                          alt={bg.name}
                          className="w-full h-24 object-cover"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                          <button
                            onClick={() => handleToggleBackgroundActive(bg.id, bg.is_active === 1)}
                            className={`px-2 py-1 rounded text-xs ${
                              bg.is_active === 1
                                ? 'bg-yellow-500 text-white'
                                : 'bg-green-500 text-white'
                            }`}
                          >
                            {bg.is_active === 1 ? '禁用' : '启用'}
                          </button>
                          <button
                            onClick={() => handleDeleteBackgroundFromLibrary(bg.id)}
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs"
                          >
                            删除
                          </button>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white px-2 py-1 text-xs truncate">
                          {bg.name}
                          {bg.is_active !== 1 && <span className="ml-2 text-yellow-300">(已禁用)</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <i className="fa fa-image text-4xl mb-2"></i>
                    <p>背景库中暂无背景，请上传背景图片</p>
                  </div>
                )}
              </div>

              {/* 默认背景设置 */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-3 flex items-center gap-2">
                  <i className="fa fa-info-circle"></i>
                  默认背景（未开启自定义权限的学生使用）
                </h4>
                <p className="text-sm text-gray-700 mb-3">
                  此背景将用于所有未开启自定义权限的学生桌面。支持 JPG、PNG、GIF、WEBP 格式，最大 5MB。
                </p>

                {/* 当前背景预览 */}
                {desktopBackground && (
                  <div>
                    <h4 className="font-medium text-gray-700 mb-3 flex items-center justify-between">
                      <span>当前背景</span>
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                        <i className="fa fa-check-circle mr-1"></i>使用中
                      </span>
                    </h4>
                    <div className="rounded-lg overflow-hidden border border-gray-300 relative">
                      <img
                        src={desktopBackground}
                        alt="当前桌面背景"
                        className="w-full h-48 object-cover"
                      />
                    </div>
                  </div>
                )}

                {/* 上传区域 */}
                <div>
                  <h4 className="font-medium text-gray-700 mb-3">上传新背景</h4>
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <i className="fa fa-cloud-upload-alt text-3xl text-gray-400 mb-2"></i>
                      <p className="mb-2 text-sm text-gray-500">
                        <span className="font-semibold">点击上传</span> 或拖放图片到这里
                      </p>
                      <p className="text-xs text-gray-500">支持 JPG、PNG、GIF、WEBP 格式 (最大 5MB)</p>
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                      onChange={handleBackgroundUpload}
                      disabled={uploadingBackground}
                    />
                  </label>
                  {uploadingBackground && (
                    <div className="mt-3 flex items-center gap-2 text-blue-600">
                      <i className="fa fa-circle-notch fa-spin"></i>
                      <span>正在上传...</span>
                    </div>
                  )}
                </div>

                {/* 已上传图片列表 */}
                <BackgroundGallery 
                  currentBackground={desktopBackground} 
                  onSelect={setDesktopBackground}
                />
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'security' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h3 className="text-lg font-bold text-gray-800 mb-6">安全配置</h3>
            
            <div className="space-y-6">
              <div className="p-6 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-lock"></i>会话管理设置
                </h4>
                
                {/* 教师设置 */}
                <div className="mb-6 p-4 bg-white rounded-lg border border-blue-200">
                  <h5 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <i className="fa-solid fa-chalkboard-teacher"></i>教师设置
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">最大并发会话数</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={securitySettings.max_concurrent_sessions_teacher}
                        onChange={(e) => setSecuritySettings({ ...securitySettings, max_concurrent_sessions_teacher: parseInt(e.target.value) || 5 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">教师账号最多可同时登录的设备数量</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={securitySettings.allow_multiple_devices_teacher}
                        onChange={(e) => setSecuritySettings({ ...securitySettings, allow_multiple_devices_teacher: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">允许多设备登录</span>
                    </label>
                  </div>
                </div>
                
                {/* 学生设置 */}
                <div className="mb-6 p-4 bg-white rounded-lg border border-green-200">
                  <h5 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <i className="fa-solid fa-user-graduate"></i>学生设置
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">最大并发会话数</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={securitySettings.max_concurrent_sessions_student}
                        onChange={(e) => setSecuritySettings({ ...securitySettings, max_concurrent_sessions_student: parseInt(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">学生账号最多可同时登录的设备数量</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={securitySettings.allow_multiple_devices_student}
                        onChange={(e) => setSecuritySettings({ ...securitySettings, allow_multiple_devices_student: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">允许多设备登录</span>
                    </label>
                  </div>
                </div>
                
                {/* 通用设置 */}
                <div className="p-4 bg-white rounded-lg border border-gray-200">
                  <h5 className="font-medium text-gray-700 mb-3">通用设置</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">会话超时时间（小时）</label>
                      <input
                        type="number"
                        min="1"
                        max="720"
                        value={securitySettings.session_timeout_hours}
                        onChange={(e) => setSecuritySettings({ ...securitySettings, session_timeout_hours: parseInt(e.target.value) || 24 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">无操作后会话自动失效的时间</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={securitySettings.enable_ip_binding}
                        onChange={(e) => setSecuritySettings({ ...securitySettings, enable_ip_binding: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">启用IP绑定</span>
                      <span className="text-xs text-gray-500">(限制同一IP登录)</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-green-50 rounded-lg">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-key"></i>密码策略
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">要求密码更改间隔（天）</label>
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={securitySettings.require_password_change_days}
                      onChange={(e) => setSecuritySettings({ ...securitySettings, require_password_change_days: parseInt(e.target.value) || 90 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">0表示不强制要求更改</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={securitySettings.enable_login_alert}
                      onChange={(e) => setSecuritySettings({ ...securitySettings, enable_login_alert: e.target.checked })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">启用登录提醒</span>
                  </label>
                </div>
              </div>

              <div className="p-6 bg-yellow-50 rounded-lg">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-users"></i>在线用户管理
                </h4>
                
                <div className="mb-4 flex items-center gap-4 flex-wrap">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">按角色筛选</label>
                    <select
                      value={filterRole}
                      onChange={(e) => {
                        setFilterRole(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">全部角色</option>
                      <option value="teacher">教师</option>
                      <option value="student">学生</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">按班级筛选</label>
                    <select
                      value={filterClass}
                      onChange={(e) => {
                        setFilterClass(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">全部班级</option>
                      {classes.map((cls) => (
                        <option key={cls.id} value={cls.id}>{cls.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="ml-auto text-sm text-gray-600">
                    共 {sortedAndFilteredSessions().length} 个用户在线
                  </div>
                </div>
                
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th 
                          onClick={() => handleSort('real_name')}
                          className="px-4 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                        >
                          用户
                          {sortBy === 'real_name' && (
                            <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-1`}></i>
                          )}
                        </th>
                        <th 
                          onClick={() => handleSort('role')}
                          className="px-4 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                        >
                          角色
                          {sortBy === 'role' && (
                            <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-1`}></i>
                          )}
                        </th>
                        <th 
                          onClick={() => handleSort('class_name')}
                          className="px-4 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                        >
                          班级
                          {sortBy === 'class_name' && (
                            <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-1`}></i>
                          )}
                        </th>
                        <th 
                          onClick={() => handleSort('ip_address')}
                          className="px-4 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                        >
                          IP地址
                          {sortBy === 'ip_address' && (
                            <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-1`}></i>
                          )}
                        </th>
                        <th 
                          onClick={() => handleSort('active_session_count')}
                          className="px-4 py-3 text-center text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                        >
                          在线设备
                          {sortBy === 'active_session_count' && (
                            <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-1`}></i>
                          )}
                        </th>
                        <th 
                          onClick={() => handleSort('last_activity')}
                          className="px-4 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                        >
                          最后活动
                          {sortBy === 'last_activity' && (
                            <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} ml-1`}></i>
                          )}
                        </th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {paginatedSessions().map((user) => (
                        <tr key={user.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div>{user.real_name}</div>
                            <div className="text-xs text-gray-500">{user.username}</div>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              user.role === 'teacher' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                            }`}>
                              {user.role === 'teacher' ? '教师' : '学生'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {user.class_name || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono text-xs">
                            {user.ip_address || '-'}
                          </td>
                          <td className="px-4 py-3 text-center text-sm">
                            <span className={`font-medium ${user.active_session_count > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                              {user.active_session_count}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {user.last_activity ? new Date(user.last_activity).toLocaleString('zh-CN') : '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {user.active_session_count > 0 && (
                              <button
                                onClick={() => handleForceLogout(user.id, user.real_name)}
                                className="text-red-600 hover:text-red-800 text-sm font-medium"
                              >
                                <i className="fa-solid fa-right-from-bracket mr-1"></i>踢出
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* 分页控件 */}
                {totalPages() > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      第 {currentPage} / {totalPages()} 页
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                      >
                        <i className="fa-solid fa-chevron-left mr-1"></i>上一页
                      </button>
                      <button
                        onClick={() => setCurrentPage(Math.min(totalPages(), currentPage + 1))}
                        disabled={currentPage === totalPages()}
                        className="px-3 py-1 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                      >
                        下一页<i className="fa-solid fa-chevron-right ml-1"></i>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end mt-8 pt-6 border-t border-gray-200 gap-3">
              <button
                onClick={() => {
                  fetchSecuritySettings();
                  fetchUserSessions();
                }}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                <i className="fa-solid fa-rotate mr-2"></i>刷新
              </button>
              <button
                onClick={handleSaveSecuritySettings}
                disabled={savingSecurity}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {savingSecurity ? '保存中...' : '保存设置'}
              </button>
            </div>
          </motion.div>
        )}

        {activeTab === 'teachers' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-gray-800">教师账号管理</h3>
              {!showAddTeacher && (
                <button
                  onClick={() => setShowAddTeacher(true)}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  <i className="fa-solid fa-plus mr-2"></i>添加教师
                </button>
              )}
            </div>

            {showAddTeacher && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="mb-6 p-6 bg-green-50 rounded-lg"
              >
                <h4 className="font-medium text-gray-800 mb-4">添加新教师</h4>
                <div className="grid grid-cols-2 gap-4 max-w-2xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
                    <input
                      type="text"
                      value={newTeacher.username}
                      onChange={(e) => setNewTeacher({ ...newTeacher, username: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="输入用户名"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">真实姓名</label>
                    <input
                      type="text"
                      value={newTeacher.real_name}
                      onChange={(e) => setNewTeacher({ ...newTeacher, real_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="输入真实姓名"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">密码</label>
                    <input
                      type="password"
                      value={newTeacher.password}
                      onChange={(e) => setNewTeacher({ ...newTeacher, password: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="输入密码（至少6位）"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">确认密码</label>
                    <input
                      type="password"
                      value={newTeacher.confirmPassword}
                      onChange={(e) => setNewTeacher({ ...newTeacher, confirmPassword: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="再次输入密码"
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleAddTeacher}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                  >
                    确认添加
                  </button>
                  <button
                    onClick={() => {
                      setShowAddTeacher(false);
                      setNewTeacher({ username: '', password: '', confirmPassword: '', real_name: '' });
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </motion.div>
            )}

            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">用户名</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">真实姓名</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {teachers.map((teacher) => (
                    <tr key={teacher.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">{teacher.username}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{teacher.real_name}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => {
                            setEditingTeacher(editingTeacher === teacher.id ? null : teacher.id);
                            setEditingTeacherInfo({ username: teacher.username, real_name: teacher.real_name });
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          <i className="fa-solid fa-edit mr-1"></i>编辑
                        </button>
                        <button
                          onClick={() => {
                            setEditingTeacher(teacher.id);
                            if (!teacherPasswords[teacher.id]) {
                              setTeacherPasswords(prev => ({
                                ...prev,
                                [teacher.id]: { current: '', new: '', confirm: '' }
                              }));
                            }
                          }}
                          className="text-purple-600 hover:text-purple-800 text-sm font-medium"
                        >
                          <i className="fa-solid fa-key mr-1"></i>改密
                        </button>
                      </td>
                    </tr>
                  ))}
                  {teachers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                        暂无教师账号
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {editingTeacher && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="mt-6 p-4 bg-purple-50 rounded-lg"
              >
                <h4 className="font-medium text-gray-800 mb-4">修改密码</h4>
                <div className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">新密码</label>
                    <input
                      type="password"
                      value={teacherPasswords[editingTeacher]?.new ?? ''}
                      onChange={(e) => setTeacherPasswords(prev => ({
                        ...prev,
                        [editingTeacher]: { ...prev[editingTeacher], new: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">确认新密码</label>
                    <input
                      type="password"
                      value={teacherPasswords[editingTeacher]?.confirm ?? ''}
                      onChange={(e) => setTeacherPasswords(prev => ({
                        ...prev,
                        [editingTeacher]: { ...prev[editingTeacher], confirm: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleTeacherPasswordChange(editingTeacher)}
                      className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
                    >
                      确认修改
                    </button>
                    <button
                      onClick={() => setEditingTeacher(null)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {editingTeacherInfo && editingTeacher && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="mt-6 p-4 bg-blue-50 rounded-lg"
              >
                <h4 className="font-medium text-gray-800 mb-4">编辑教师信息</h4>
                <div className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
                    <input
                      type="text"
                      value={editingTeacherInfo.username}
                      onChange={(e) => setEditingTeacherInfo({ ...editingTeacherInfo, username: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">真实姓名</label>
                    <input
                      type="text"
                      value={editingTeacherInfo.real_name}
                      onChange={(e) => setEditingTeacherInfo({ ...editingTeacherInfo, real_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleUpdateTeacher(editingTeacher)}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      确认修改
                    </button>
                    <button
                      onClick={() => {
                        setEditingTeacher(null);
                        setEditingTeacherInfo(null);
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {activeTab === 'license' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h3 className="text-lg font-bold text-gray-800 mb-6">系统授权 <span className="text-sm text-gray-500 font-normal">(未授权不影响练习等基础功能)</span></h3>

            <div className="space-y-6">
              {/* 当前授权状态 */}
              <div className={`p-6 rounded-xl shadow-sm border ${
                isLicenseValid 
                  ? isExpiringSoon 
                    ? 'bg-amber-50 border-amber-200' 
                    : 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-shield-halved"></i>授权状态
                </h4>
                
                {/* 状态大标题 */}
                <div className="mb-6 text-center">
                  <div className={`text-2xl font-bold mb-2 ${
                    isLicenseValid 
                      ? isExpiringSoon ? 'text-amber-600' : 'text-green-600'
                      : 'text-red-600'
                  }`}>
                    {isInTrial ? (
                      <><i className="fa-solid fa-hourglass-half mr-2"></i>试用中</>
                    ) : isActivated && isLicenseValid ? (
                      <><i className="fa-solid fa-check-circle mr-2"></i>已激活</>
                    ) : isActivated && !isLicenseValid ? (
                      <><i className="fa-solid fa-exclamation-circle mr-2"></i>已过期</>
                    ) : (
                      <><i className="fa-solid fa-times-circle mr-2"></i>未激活</>
                    )}
                  </div>
                  {expiresAt && (
                    <p className="text-sm text-gray-600">
                      {isInTrial ? '试用期至' : isLicenseValid ? '授权有效期至' : '已于'}
                      <span className="font-medium ml-1">
                        {new Date(expiresAt).toLocaleDateString('zh-CN')}
                      </span>
                      {!isLicenseValid && isActivated && ' 过期'}
                    </p>
                  )}
                </div>

                {/* 进度条 */}
                {expiresAt && (
                  <div className="mb-6">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>剩余时间</span>
                      <span>{daysRemaining} 天 / 365 天</span>
                    </div>
                    <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${
                          isLicenseValid
                            ? isExpiringSoon 
                              ? 'bg-gradient-to-r from-amber-400 to-amber-500' 
                              : 'bg-gradient-to-r from-green-400 to-green-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, (daysRemaining / 365) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-white/50 rounded-lg">
                    <p className="text-sm text-gray-500 mb-1">本机机器码</p>
                    <p className="font-mono text-sm break-all">
                      {licenseMachineCode || '请先获取机器码'}
                    </p>
                  </div>
                  {isActivated && activatedAt && (
                    <div className="p-4 bg-white/50 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">激活时间</p>
                      <p className="font-medium">{new Date(activatedAt).toLocaleString('zh-CN')}</p>
                    </div>
                  )}
                  {isActivated && licenseCode && (
                    <div className="p-4 bg-white/50 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">授权码</p>
                      <p className="font-mono text-sm">{licenseCode}</p>
                    </div>
                  )}
                  {isInTrial && (
                    <div className="p-4 bg-white/50 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">试用剩余</p>
                      <p className="font-medium text-amber-600">{daysRemaining} 天</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 获取机器码 */}
              <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-200">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-microchip"></i>一、获取本机机器码
                </h4>
                <p className="text-sm text-gray-600 mb-4">
                  点击下方按钮获取当前服务器的机器码，将此机器码提供给吴志安老师（QQ1026913）生成授权码。
                  生成的授权码内嵌有效期，过期后请重新申请。
                </p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={fetchMachineCode}
                    disabled={licenseLoading}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                  >
                    {licenseLoading ? (
                      <><i className="fa-solid fa-circle-notch fa-spin mr-1"></i>获取中...</>
                    ) : (
                      <><i className="fa-solid fa-qrcode mr-1"></i>获取机器码</>
                    )}
                  </button>
                  {licenseMachineCode && (
                    <button
                      onClick={() => {
                        copyToClipboard(licenseMachineCode, '机器码已复制到剪贴板');
                      }}
                      className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      <i className="fa-solid fa-copy mr-1"></i>复制机器码
                    </button>
                  )}
                </div>
                {licenseMachineCode && (
                  <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">机器码：</p>
                    <p className="font-mono text-lg font-bold text-gray-800 tracking-wider select-all">
                      {licenseMachineCode}
                    </p>
                  </div>
                )}
              </div>

              {/* 输入授权码激活 */}
              <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-200">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-key"></i>二、{isActivated ? '续期授权' : '输入授权码激活系统'}
                </h4>
                <p className="text-sm text-gray-600 mb-4">
                  {isActivated 
                    ? '输入新的授权码可延长授权有效期，每次续期延长一年。'
                    : '从吴志安老师那获取授权码后，在此输入并激活系统。'}
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={licenseInput}
                    onChange={(e) => setLicenseInput(e.target.value)}
                    placeholder="请输入授权码（例如：ABCD-1234-EFGH-5678）"
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  />
                  <button
                    onClick={handleActivate}
                    disabled={licenseLoading}
                    className="px-6 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium transition-colors"
                  >
                    {licenseLoading ? (
                      <><i className="fa-solid fa-circle-notch fa-spin mr-1"></i>激活中...</>
                    ) : isActivated ? (
                      <><i className="fa-solid fa-clock-rotate-left mr-1"></i>续期一年</>
                    ) : (
                      <><i className="fa-solid fa-check-circle mr-1"></i>激活系统</>
                    )}
                  </button>
                </div>
              </div>

              {/* 生成授权码（管理员功能）- 仅超级管理员可见 */}
              {profile?.role === 'super_admin' && (
              <div className="p-6 bg-white rounded-xl shadow-sm border border-amber-200">
                <div className="flex items-center gap-2 mb-3">
                  <i className="fa-solid fa-crown text-amber-500"></i>
                  <h4 className="font-medium text-gray-800">三、根据机器码生成授权码</h4>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">管理员专用</span>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  输入对方提供的机器码并设置授权时长，生成的授权码内嵌到期时间。授权码过期后系统将拒绝激活。
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">机器码</label>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={genMachineCode}
                        onChange={(e) => setGenMachineCode(e.target.value)}
                        placeholder="粘贴对方的机器码"
                        className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 font-mono text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">授权时长（月）</label>
                    <div className="flex gap-3">
                      <input
                        type="number"
                        value={genMonths}
                        onChange={(e) => setGenMonths(parseInt(e.target.value) || 13)}
                        min="1"
                        max="120"
                        className="w-32 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 text-sm"
                      />
                      <span className="self-center text-sm text-gray-500">
                        ≈ {(() => { const d = new Date(); d.setMonth(d.getMonth() + genMonths); return d.toLocaleDateString('zh-CN'); })()} 到期
                      </span>
                      <button
                        onClick={handleGenerateLicense}
                        disabled={genLoading}
                        className="px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium transition-colors"
                      >
                        {genLoading ? (
                          <><i className="fa-solid fa-circle-notch fa-spin mr-1"></i>生成中...</>
                        ) : (
                          <><i className="fa-solid fa-wand-magic-sparkles mr-1"></i>生成授权码</>
                        )}
                      </button>
                    </div>
                  </div>
                  {genLicenseCode && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-amber-800">生成的授权码：</p>
                        <button
                          onClick={() => {
                            copyToClipboard(genLicenseCode, '授权码已复制到剪贴板');
                          }}
                          className="text-sm text-amber-600 hover:text-amber-700"
                        >
                          <i className="fa-solid fa-copy mr-1"></i>复制
                        </button>
                      </div>
                      <p className="font-mono text-lg font-bold text-amber-900 tracking-wider select-all">
                        {genLicenseCode}
                      </p>
                      <p className="text-xs text-amber-600 mt-2">
                        ⚠️ 此授权码内嵌到期时间，过期后无法激活。请勿泄露。
                      </p>
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* 授权原理说明 */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-medium text-blue-800 mb-2 flex items-center gap-2">
                  <i className="fa-solid fa-info-circle"></i>授权机制说明
                </h4>
                <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                  <li>机器码基于服务器硬件信息通过 SHA256 算法生成，更换硬件后变化</li>
                  <li>授权码由 AES-256-CBC 加密生成，内嵌机器码和有效期时间戳</li>
                  <li>系统激活时解密验证机器码匹配且未过期，过期授权码无法使用</li>
                  <li>清空数据库后旧授权码仍因过期而无法使用，不存在利用历史授权码绕过</li>
                  <li>授权信息存储在数据库中，迁移服务器后需要重新授权</li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'update' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h3 className="text-lg font-bold text-gray-800 mb-6">系统升级</h3>
            <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center">
                  <i className="fa-solid fa-cloud-arrow-up text-white text-xl"></i>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-800 mb-2">检查系统更新</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    点击下方按钮访问系统发布页面，查看最新版本、升级说明和历史更新记录。
                  </p>
                  <a
                    href="https://xlay0ja2dhwv.meoo.run/#/software-release"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                  >
                    <i className="fa-solid fa-external-link-alt"></i>
                    前往系统升级页面
                    <i className="fa-solid fa-arrow-up-right-from-square text-xs opacity-75"></i>
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h4 className="font-medium text-yellow-800 mb-2 flex items-center gap-2">
                <i className="fa-solid fa-info-circle"></i>升级须知
              </h4>
              <ul className="text-sm text-yellow-700 space-y-1 list-disc list-inside">
                <li>升级前请务必备份数据库和重要数据</li>
                <li>建议在非教学高峰期进行升级操作</li>
                <li>升级完成后请重启服务并检查功能是否正常</li>
                <li>如遇问题，请联系吴志安老师（QQ1026913）</li>
              </ul>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

// 背景图片画廊组件
interface BackgroundGalleryProps {
  currentBackground: string;
  onSelect: (url: string) => void;
}

const BackgroundGallery: React.FC<BackgroundGalleryProps> = ({ currentBackground, onSelect }) => {
  const [backgrounds, setBackgrounds] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  const API_BASE = API_CONFIG.apiUrl;

  const fetchBackgrounds = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/uploads/backgrounds`);
      const result = await response.json();
      if (result.data) {
        setBackgrounds(result.data);
      }
    } catch (error) {
      console.error('获取背景列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchBackgrounds();
  }, []);

  const handleDelete = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('确定要删除这张背景图片吗？')) {
      return;
    }

    setDeleting(filename);
    try {
      const token = localStorage.getItem('xgpy_token');
      const response = await fetch(`${API_BASE}/api/uploads/backgrounds/${filename}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const result = await response.json();
      
      if (result.error) {
        alert(result.error);
      } else {
        setBackgrounds(backgrounds.filter(b => b.filename !== filename));
      }
    } catch (error) {
      console.error('删除背景失败:', error);
      alert('删除失败');
    } finally {
      setDeleting(null);
    }
  };

  const handleSelectDirect = async (bg: any) => {
    try {
      const fullUrl = bg.url.startsWith('http') ? bg.url : `${API_BASE}${bg.url}`;
      
      const id = 'config_desktop_background';
      const configKey = 'desktop_background';
      const token = localStorage.getItem('xgpy_token');
      const response = await fetch(`${API_BASE}/api/tables/system_config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ id, key: configKey, value: { value: fullUrl } })
      });

      const result = await response.json();
      
      if (result.error && !result.error.includes('Duplicate')) {
        console.error('更新配置失败:', result.error);
        alert('切换失败');
      } else {
        onSelect(fullUrl);
        fetchBackgrounds();
      }
    } catch (error) {
      console.error('切换背景失败:', error);
      alert('切换失败');
    }
  };

  if (loading) {
    return (
      <div className="text-center py-4 text-gray-500">
        <i className="fa fa-circle-notch fa-spin mr-2"></i>
        加载中...
      </div>
    );
  }

  if (backgrounds.length === 0) {
    return (
      <div>
        <h4 className="font-medium text-gray-700 mb-3">已上传的背景</h4>
        <div className="p-6 bg-gray-50 rounded-lg text-center text-gray-500 text-sm">
          还没有上传过背景图片
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="font-medium text-gray-700 mb-3">已上传的背景（点击选择）</h4>
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {backgrounds.map((bg) => {
          const fullUrl = bg.url.startsWith('http') ? bg.url : `${API_BASE}${bg.url}`;
          const isActive = currentBackground && (
            fullUrl === currentBackground || 
            currentBackground.includes(bg.filename)
          );
          
          return (
            <div
              key={bg.filename}
              className={`relative group rounded-lg overflow-hidden cursor-pointer transition-all ${
                isActive 
                  ? 'ring-2 ring-green-500 ring-offset-2' 
                  : 'hover:ring-2 hover:ring-blue-500 hover:ring-offset-1'
              }`}
              onClick={() => handleSelectDirect(bg)}
            >
              <img
                src={fullUrl}
                alt={bg.filename}
                className="w-full h-24 object-cover"
              />
              
              {isActive && (
                <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded flex items-center">
                  <i className="fa fa-check-circle mr-1"></i>
                  使用中
                </div>
              )}

              <button
                onClick={(e) => handleDelete(bg.filename, e)}
                disabled={deleting === bg.filename}
                className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                title="删除"
              >
                {deleting === bg.filename ? (
                  <i className="fa fa-spinner fa-spin text-xs"></i>
                ) : (
                  <i className="fa fa-trash text-xs"></i>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SystemSettings;
