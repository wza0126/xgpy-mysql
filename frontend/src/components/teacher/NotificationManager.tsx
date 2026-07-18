import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime, formatDate } from '../../utils/dateUtils';

interface Class {
  id: string;
  name: string;
  teacher_id: string;
}

interface Student {
  id: string;
  username: string;
  real_name: string;
  class_id: string;
}

interface Notification {
  id: number;
  title: string;
  content: string;
  notification_type: 'all' | 'class' | 'student';
  target_class_id: number | null;
  target_student_ids: number[] | null;
  has_point_reward: boolean;
  point_reward_amount: number;
  point_reward_reason: string;
  has_point_penalty: boolean;
  point_penalty_amount: number;
  point_penalty_reason: string;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  teacher_name?: string;
  class_name?: string;
  total_recipients?: number;
  read_count?: number;
}

interface NotificationRecipient {
  id: number;
  student_id: number;
  is_read: boolean;
  read_at: string | null;
  student_username: string;
  student_real_name: string;
  class_name: string;
}

const ITEMS_PER_PAGE = 20;

export const NotificationManager: React.FC = () => {
  const { profile } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showStatistics, setShowStatistics] = useState<number | null>(null);
  const [notificationStats, setNotificationStats] = useState<any>(null);
  
  // 新增：多选、分页状态
  const [selectedNotifications, setSelectedNotifications] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  
  // 表单状态
  const [formData, setFormData] = useState({
    title: '请注意',
    content: '现在开始，',
    notification_type: 'class' as 'class' | 'student',
    has_point_reward: false,
    point_reward_amount: 0,
    point_reward_reason: '',
    has_point_penalty: false,
    point_penalty_amount: 0,
    point_penalty_reason: '',
    has_buff: false,
    buff_modifier: 10,
    buff_duration: 10,
    can_open_exchange_module: false,
    enable_app_access: true,
    scheduled_at: '',
  });

  useEffect(() => {
    if (profile) {
      fetchData();
    }
  }, [profile]);

  // 计算分页数据
  const totalPages = Math.ceil(notifications.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedNotifications = notifications.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const allSelected = paginatedNotifications.length > 0 && 
    paginatedNotifications.every(n => selectedNotifications.includes(n.id));
  const someSelected = paginatedNotifications.some(n => selectedNotifications.includes(n.id));

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 获取班级列表
      if (profile) {
        console.log('Fetching classes for teacher:', profile.id);
        const { data, error } = await backendClient
          .from('classes')
          .select('*')
          .eq('teacher_id', profile.id)
          .order('created_at', { ascending: false });
        console.log('Classes data:', data, 'Error:', error);
        if (data) {
          setClasses(data as Class[]);
        }
      }
      
      // 获取通知列表
      await fetchNotifications();
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    if (!profile) return;
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/notifications/teacher/${profile.id}`);
      
      // 检查是否是HTML响应（404等错误）
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        console.error('Server returned HTML instead of JSON');
        return;
      }
      
      const data = await res.json();
      if (!data.error) {
        setNotifications(data.data);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const fetchClassStudents = async (classId: string) => {
    try {
      console.log('Fetching students for class:', classId);
      const { data, error } = await backendClient
        .from('profiles')
        .select('*')
        .eq('class_id', classId)
        .eq('role', 'student')
        .order('username', { ascending: true });
      console.log('Students data:', data, 'Error:', error);
      if (data) {
        setStudents(data as Student[]);
      }
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  };

  const handleNotificationTypeChange = (type: 'all' | 'class' | 'student') => {
    setFormData({ ...formData, notification_type: type });
    setSelectedClass(null);
    setSelectedStudents([]);
    setStudents([]);
  };

  const handleClassChange = (classId: string) => {
    if (classId && classId.trim() !== '') {
      setSelectedClass(classId);
      fetchClassStudents(classId);
    } else {
      setSelectedClass(null);
      setStudents([]);
      setSelectedStudents([]);
    }
  };

  const handleStudentToggle = (studentId: string) => {
    setSelectedStudents(prev => 
      prev.includes(studentId)
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  // 新增：学生全选/反选
  const handleSelectAllStudents = () => {
    if (selectedStudents.length === students.length) {
      setSelectedStudents([]);
    } else {
      setSelectedStudents(students.map(s => s.id));
    }
  };

  // 新增：通知选择
  const handleNotificationToggle = (notificationId: number) => {
    setSelectedNotifications(prev => 
      prev.includes(notificationId)
        ? prev.filter(id => id !== notificationId)
        : [...prev, notificationId]
    );
  };

  // 新增：当前页全选/反选
  const handleSelectAllNotifications = () => {
    if (allSelected) {
      setSelectedNotifications(prev => 
        prev.filter(id => !paginatedNotifications.some(n => n.id === id))
      );
    } else {
      const currentPageIds = paginatedNotifications.map(n => n.id);
      setSelectedNotifications(prev => [...new Set([...prev, ...currentPageIds])]);
    }
  };

  // 新增：批量删除
  const handleBatchDelete = async () => {
    if (selectedNotifications.length === 0) {
      alert('请先选择要删除的通知');
      return;
    }
    if (!confirm(`确定要删除选中的 ${selectedNotifications.length} 条通知吗？`)) return;
    
    try {
      let success = 0;
      for (const id of selectedNotifications) {
        const res = await fetch(`${API_CONFIG.apiUrl}/api/notifications/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: profile?.id }),
        });
        
        // 检查是否是HTML响应
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          console.error('Server returned HTML instead of JSON');
          continue;
        }
        
        const data = await res.json();
        if (!data.error) {
          success++;
        }
      }
      
      alert(`成功删除 ${success} 条通知`);
      setSelectedNotifications([]);
      fetchNotifications();
    } catch (error) {
      console.error('Error deleting notifications:', error);
      alert('删除失败');
    }
  };

  // 新增：清除选中
  const handleClearSelection = () => {
    setSelectedNotifications([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title || !formData.content) {
      alert('请填写标题和内容');
      return;
    }

    if (formData.notification_type === 'class' && !selectedClass) {
      alert('请选择班级');
      return;
    }

    if (formData.notification_type === 'student' && selectedStudents.length === 0) {
      alert('请选择学生');
      return;
    }

    if (formData.has_point_reward && formData.point_reward_amount <= 0) {
      alert('请设置积分奖励数量');
      return;
    }

    if (formData.has_point_penalty && formData.point_penalty_amount <= 0) {
      alert('请设置积分扣除数量');
      return;
    }

    try {
      const payload = {
        teacher_id: profile?.id,
        ...formData,
        target_class_id: formData.notification_type === 'class' ? selectedClass : null,
        target_student_ids: formData.notification_type === 'student' ? selectedStudents : [],
      };

      const res = await fetch(`${API_CONFIG.apiUrl}/api/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // 检查是否是HTML响应
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        alert('服务器错误，请稍后重试');
        return;
      }

      const data = await res.json();
      
      if (!data.error) {
        alert(formData.scheduled_at ? '定时通知已保存！' : '通知已发送！');
        setShowCreateModal(false);
        resetForm();
        fetchNotifications();
      } else {
        alert('发送失败：' + data.error);
      }
    } catch (error) {
      console.error('Error sending notification:', error);
      alert('发送失败，请重试');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '请注意',
      content: '现在开始，',
      notification_type: 'class',
      has_point_reward: false,
      point_reward_amount: 0,
      point_reward_reason: '',
      has_point_penalty: false,
      point_penalty_amount: 0,
      point_penalty_reason: '',
      has_buff: false,
      buff_modifier: 10,
      buff_duration: 10,
      can_open_exchange_module: false,
      enable_app_access: true,
      scheduled_at: '',
    });
    setSelectedClass(null);
    setSelectedStudents([]);
    setStudents([]);
  };

  const handleViewStatistics = async (notificationId: number) => {
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/notifications/${notificationId}/statistics?teacher_id=${profile?.id}`);
      
      // 检查是否是HTML响应（404等错误）
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        console.error('Server returned HTML instead of JSON');
        return;
      }
      
      const data = await res.json();
      if (!data.error) {
        setNotificationStats(data.data);
        setShowStatistics(notificationId);
      }
    } catch (error) {
      console.error('Error fetching statistics:', error);
    }
  };

  const handleDelete = async (notificationId: number) => {
    if (!confirm('确定要删除这个通知吗？')) return;
    
    try {
      const res = await fetch(`${API_CONFIG.apiUrl}/api/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: profile?.id }),
      });

      // 检查是否是HTML响应
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        alert('服务器错误，请稍后重试');
        return;
      }

      const data = await res.json();
      if (!data.error) {
        alert('删除成功');
        fetchNotifications();
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
      alert('删除失败');
    }
  };

  const getStatusBadge = (notification: Notification) => {
    if (notification.scheduled_at && !notification.published_at) {
      return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs">待发布</span>;
    }
    return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">已发布</span>;
  };

  const getTargetText = (notification: Notification) => {
    switch (notification.notification_type) {
      case 'all': return '全体学生';
      case 'class': {
        if (!notification.target_class_id) return '-';
        return `指定班级 - ${notification.class_name || notification.target_class_id}`;
      }
      case 'student': return notification.target_student_ids ? `${notification.target_student_ids.length}名学生` : '-';
      default: return '-';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <i className="fa-solid fa-spinner fa-spin text-4xl text-blue-500 mb-4"></i>
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">通知管理</h1>
          <p className="text-gray-500 mt-1">发送通知、管理积分奖励/扣除</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedNotifications.length > 0 && (
            <>
              <span className="text-gray-600">
                已选择 <span className="font-bold text-blue-600">{selectedNotifications.length}</span> 条通知
              </span>
              <button
                onClick={handleClearSelection}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <i className="fa-solid fa-times mr-1"></i>
                取消选择
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
              >
                <i className="fa-solid fa-trash mr-1"></i>
                批量删除
              </button>
            </>
          )}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 shadow-lg"
          >
            <i className="fa-solid fa-plus"></i>
            创建通知
          </motion.button>
        </div>
      </div>

      {/* 通知列表 */}
      <div className="space-y-4">
        {notifications.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-xl">
            <i className="fa-solid fa-bell text-4xl text-gray-300 mb-4"></i>
            <p className="text-gray-500">暂无通知</p>
          </div>
        ) : (
          <>
            {/* 全选复选框 */}
            <div className="flex items-center gap-3 mb-4 p-4 bg-gray-50 rounded-lg">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={input => {
                    if (input) input.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={handleSelectAllNotifications}
                  className="w-4 h-4 text-blue-500"
                />
                <span className="text-sm text-gray-700">全选当前页</span>
              </label>
            </div>
            
            {/* 通知列表 */}
            {paginatedNotifications.map((notification) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-white rounded-xl shadow-sm border transition-all ${
                  selectedNotifications.includes(notification.id) 
                    ? 'border-blue-300 bg-blue-50' 
                    : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className="flex items-start p-6">
                  <div className="flex items-center mr-4">
                    <input
                      type="checkbox"
                      checked={selectedNotifications.includes(notification.id)}
                      onChange={() => handleNotificationToggle(notification.id)}
                      className="w-4 h-4 text-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-800">{notification.title}</h3>
                      {getStatusBadge(notification)}
                    </div>
                    <p className="text-gray-600 mb-3 line-clamp-2">{notification.content}</p>
                    <div className="flex items-center gap-6 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <i className="fa-solid fa-bullseye"></i>
                        {getTargetText(notification)}
                      </span>
                      <span className="flex items-center gap-1">
                        <i className="fa-solid fa-clock"></i>
                        {formatDate(notification.created_at)}
                      </span>
                      {notification.total_recipients !== undefined && (
                        <span className="flex items-center gap-1">
                          <i className="fa-solid fa-users"></i>
                          {notification.total_recipients}人接收
                          {notification.read_count !== undefined && (
                            <span className="text-blue-600 ml-1">
                              ({notification.read_count}人已读)
                            </span>
                          )}
                        </span>
                      )}
                      {notification.has_point_reward && (
                        <span className="flex items-center gap-1 text-green-600">
                          <i className="fa-solid fa-gift"></i>
                          +{notification.point_reward_amount}分
                        </span>
                      )}
                      {notification.has_point_penalty && (
                        <span className="flex items-center gap-1 text-red-600">
                          <i className="fa-solid fa-minus-circle"></i>
                          -{notification.point_penalty_amount}分
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {notification.published_at && (
                      <button
                        onClick={() => handleViewStatistics(notification.id)}
                        className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <i className="fa-solid fa-chart-bar mr-1"></i>
                        统计
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(notification.id)}
                      className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <i className="fa-solid fa-trash mr-1"></i>
                      删除
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
            
            {/* 分页控件 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="fa-solid fa-chevron-left"></i>
                </button>
                <span className="px-4 py-2 text-gray-600">
                  第 {currentPage} / {totalPages} 页
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="fa-solid fa-chevron-right"></i>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 创建通知模态框 */}
      <AnimatePresence>
        {showCreateModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[9998]"
              onClick={() => setShowCreateModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-[9999] p-4"
            >
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-800">创建通知</h2>
                    <button
                      onClick={() => setShowCreateModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <i className="fa-solid fa-times text-xl"></i>
                    </button>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                  {/* 标题和内容 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">通知标题 *</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="输入通知标题"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">通知内容 *</label>
                    <textarea
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-32 resize-none"
                      placeholder="输入通知内容"
                    />
                  </div>

                  {/* 通知类型 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">发送对象</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="notification_type"
                          value="class"
                          checked={formData.notification_type === 'class'}
                          onChange={() => handleNotificationTypeChange('class')}
                          className="w-4 h-4 text-blue-500"
                        />
                        <span>指定班级</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="notification_type"
                          value="student"
                          checked={formData.notification_type === 'student'}
                          onChange={() => handleNotificationTypeChange('student')}
                          className="w-4 h-4 text-blue-500"
                        />
                        <span>指定学生</span>
                      </label>
                    </div>
                  </div>

                  {/* 班级选择 */}
                  {formData.notification_type === 'class' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">选择班级 *</label>
                      <select
                        value={selectedClass || ''}
                        onChange={(e) => handleClassChange(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">请选择班级</option>
                        {classes.map((cls) => (
                          <option key={cls.id} value={cls.id}>{cls.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 学生选择 */}
                  {formData.notification_type === 'student' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">选择班级</label>
                      <select
                        value={selectedClass || ''}
                        onChange={(e) => handleClassChange(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
                      >
                        <option value="">请选择班级</option>
                        {classes.map((cls) => (
                          <option key={cls.id} value={cls.id}>{cls.name}</option>
                        ))}
                      </select>

                      {selectedClass && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-gray-700">选择学生 *</label>
                            {students.length > 0 && (
                              <button
                                type="button"
                                onClick={handleSelectAllStudents}
                                className="text-sm text-blue-600 hover:text-blue-700"
                              >
                                {selectedStudents.length === students.length ? '取消全选' : '全选'}
                              </button>
                            )}
                          </div>
                          {students.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded-lg">
                              {students.map((student) => (
                                <label key={student.id} className="flex items-center gap-2 p-2 rounded hover:bg-white cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selectedStudents.includes(student.id)}
                                    onChange={() => handleStudentToggle(student.id)}
                                    className="w-4 h-4 text-blue-500"
                                  />
                                  <span>{student.real_name} ({student.username})</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-4 text-gray-500 bg-gray-50 rounded-lg">
                              <i className="fa-solid fa-info-circle mr-2"></i>
                              该班级暂无学生
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 积分奖励 */}
                  <div className="p-4 bg-green-50 rounded-xl">
                    <label className="flex items-center gap-2 cursor-pointer mb-4">
                      <input
                        type="checkbox"
                        checked={formData.has_point_reward}
                        onChange={(e) => setFormData({ ...formData, has_point_reward: e.target.checked })}
                        className="w-4 h-4 text-green-500"
                      />
                      <span className="font-medium text-green-700">添加积分奖励</span>
                    </label>

                    {formData.has_point_reward && (
                      <div className="space-y-4 pl-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">奖励积分数</label>
                          <input
                            type="number"
                            min="1"
                            value={formData.point_reward_amount}
                            onChange={(e) => setFormData({ ...formData, point_reward_amount: Number(e.target.value) })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            placeholder="输入奖励积分数"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">奖励原因</label>
                          <input
                            type="text"
                            value={formData.point_reward_reason}
                            onChange={(e) => setFormData({ ...formData, point_reward_reason: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            placeholder="输入奖励原因"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 积分扣除 */}
                  <div className="p-4 bg-red-50 rounded-xl">
                    <label className="flex items-center gap-2 cursor-pointer mb-4">
                      <input
                        type="checkbox"
                        checked={formData.has_point_penalty}
                        onChange={(e) => setFormData({ ...formData, has_point_penalty: e.target.checked })}
                        className="w-4 h-4 text-red-500"
                      />
                      <span className="font-medium text-red-700">添加积分扣除</span>
                    </label>

                    {formData.has_point_penalty && (
                      <div className="space-y-4 pl-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">扣除积分数</label>
                          <input
                            type="number"
                            min="1"
                            value={formData.point_penalty_amount}
                            onChange={(e) => setFormData({ ...formData, point_penalty_amount: Number(e.target.value) })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            placeholder="输入扣除积分数"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">扣除原因</label>
                          <input
                            type="text"
                            value={formData.point_penalty_reason}
                            onChange={(e) => setFormData({ ...formData, point_penalty_reason: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            placeholder="输入扣除原因"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 临时Buff */}
                  <div className="p-4 bg-yellow-50 rounded-xl">
                    <label className="flex items-center gap-2 cursor-pointer mb-4">
                      <input
                        type="checkbox"
                        checked={formData.has_buff}
                        onChange={(e) => setFormData({ ...formData, has_buff: e.target.checked })}
                        className="w-4 h-4 text-yellow-500"
                      />
                      <span className="font-medium text-yellow-700">
                        <i className="fa-solid fa-bolt mr-1"></i>
                        附带临时Buff
                      </span>
                    </label>

                    {formData.has_buff && (
                      <div className="space-y-4 pl-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            暴击率修正值(%)
                          </label>
                          <input
                            type="number"
                            min="-50"
                            max="50"
                            step="1"
                            value={formData.buff_modifier}
                            onChange={(e) => setFormData({ ...formData, buff_modifier: Number(e.target.value) })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                            placeholder="正数为加成,负数为削弱"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            例如: 15 表示暴击率+15%, -10 表示暴击率-10%
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            持续时间(分钟)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={formData.buff_duration}
                            onChange={(e) => setFormData({ ...formData, buff_duration: Number(e.target.value) })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 兑换模块权限控制 */}
                  <div className="p-4 bg-purple-50 rounded-xl">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.can_open_exchange_module}
                        onChange={(e) => setFormData({ ...formData, can_open_exchange_module: e.target.checked })}
                        className="w-4 h-4 text-purple-500"
                      />
                      <span className="font-medium text-purple-700">允许兑换上网码</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-2">关闭后，学生将无法打开积分兑换模块</p>
                  </div>

                  {/* 应用可见性控制 */}
                  <div className="p-4 bg-orange-50 rounded-xl">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.enable_app_access}
                        onChange={(e) => setFormData({ ...formData, enable_app_access: e.target.checked })}
                        className="w-4 h-4 text-orange-500"
                      />
                      <span className="font-medium text-orange-700">允许使用应用</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-2">关闭后，学生将无法访问学习应用功能</p>
                  </div>

                  {/* 定时发布 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">定时发布（可选）</label>
                    <input
                      type="datetime-local"
                      value={formData.scheduled_at}
                      onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">留空则立即发布</p>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      {formData.scheduled_at ? '保存定时通知' : '立即发送'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 统计详情模态框 */}
      <AnimatePresence>
        {showStatistics && notificationStats && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[9998]"
              onClick={() => setShowStatistics(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-[9999] p-4"
            >
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-800">通知阅读统计</h2>
                    <button
                      onClick={() => setShowStatistics(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <i className="fa-solid fa-times text-xl"></i>
                    </button>
                  </div>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="text-center p-4 bg-blue-50 rounded-xl">
                      <div className="text-3xl font-bold text-blue-600">{notificationStats.total_recipients}</div>
                      <div className="text-sm text-gray-600">总接收人数</div>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-xl">
                      <div className="text-3xl font-bold text-green-600">{notificationStats.read_count}</div>
                      <div className="text-sm text-gray-600">已读人数</div>
                    </div>
                    <div className="text-center p-4 bg-gray-50 rounded-xl">
                      <div className="text-3xl font-bold text-gray-600">{notificationStats.read_rate}%</div>
                      <div className="text-sm text-gray-600">阅读率</div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold text-gray-800 mb-4">学生阅读详情</h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {notificationStats.recipients.map((recipient: NotificationRecipient) => (
                        <div
                          key={recipient.id}
                          className="flex items-center justify-between p-3 rounded-lg border"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${recipient.is_read ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                            <div>
                              <div className="font-medium text-gray-800">
                                {recipient.student_real_name} ({recipient.student_username})
                              </div>
                              <div className="text-sm text-gray-500">{recipient.class_name}</div>
                            </div>
                          </div>
                          <div className="text-sm text-gray-500">
                            {recipient.is_read ? (
                              <span className="text-green-600">
                                已读 {recipient.read_at ? formatDate(recipient.read_at) : ''}
                              </span>
                            ) : (
                              <span className="text-gray-400">未读</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
