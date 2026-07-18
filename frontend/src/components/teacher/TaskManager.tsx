import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_CONFIG } from '../../api/config';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../utils/dateUtils';

// ============ 类型定义 ============
type TaskStatus = 'draft' | 'published' | 'archived';
type ResourceType = 'file' | 'link' | 'html';

interface Task {
  id: string;
  class_id: string;
  class_ids?: string[] | string;
  title: string;
  learning_objectives?: string;
  start_time?: string;
  deadline?: string;
  force_video_watch: boolean;
  access_type: 'private' | 'public';
  status: TaskStatus;
  is_pinned?: number | boolean;
  created_at?: string;
  updated_at?: string;
  class_name?: string;
  class_names?: string[];
  resource_count?: number;
  question_count?: number;
  completion_rate?: number;
  total_students?: number;
  completed_students?: number;
}

interface Resource {
  id: string;
  task_id: string;
  type: ResourceType;
  url?: string;
  title?: string;
  file_name?: string;
  file_type?: string;
  html_content?: string;
  sort_order: number;
  created_at?: string;
}

interface TaskQuestion {
  id: string;
  task_id: string;
  question_id?: string;
  temp_content?: string;
  temp_type?: string;
  temp_options?: string[] | string;
  temp_answer?: string[] | string;
  score: number;
  created_at?: string;
  content?: string;
  type?: string;
  options?: string[] | string;
  answers?: string[] | string;
  explanation?: string;
}

interface ClassInfo {
  id: string;
  name: string;
}

interface BankQuestion {
  id: string;
  content: string;
  type: string;
  options?: string[] | string;
  answers?: string[] | string;
  tags?: string[];
  explanation?: string;
}

interface StudentProgress {
  student_id: string;
  username: string;
  real_name?: string;
  status: 'not_started' | 'in_progress' | 'completed';
  score?: number;
  submitted_at?: string;
  watch_duration?: number;
}

interface AnalysisQuestion {
  tq_id: string;
  question_id: string | null;
  index: number;
  content: string;
  type: string;
  options: string[] | null;
  correct_answers: string[];
  score: number;
  explanation: string | null;
}

interface AnalysisStudent {
  student_id: string;
  real_name: string;
  username: string;
  status: string;
  score: number;
  submitted_at: string | null;
  question_results: {
    tq_id: string;
    question_id: string | null;
    student_answer: string | null;
    is_correct: boolean;
    answered: boolean;
  }[];
}

interface QuestionStat {
  tq_id: string;
  question_id: string | null;
  index: number;
  content: string;
  type: string;
  score: number;
  correct_count: number;
  answered_count: number;
  total_students: number;
  correct_rate: number;
}

// ============ 辅助函数 ============
const getToken = (): string | null => localStorage.getItem('xgpy_token');

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<{ data: T | null; error: string | null }> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  const userHeaders = options.headers as Record<string, string> | undefined;
  const finalHeaders = userHeaders ? { ...headers, ...userHeaders } : headers;

  try {
    const response = await fetch(`${API_CONFIG.apiUrl}${path}`, {
      ...options,
      headers: finalHeaders,
    });
    const result = await response.json();
    return { data: (result?.data ?? null) as T | null, error: (result?.error ?? null) as string | null };
  } catch (err) {
    return { data: null, error: (err as Error).message || '网络请求失败' };
  }
}

// datetime-local 格式转换 (YYYY-MM-DDTHH:mm)
const toDateTimeLocal = (dateStr?: string): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromDateTimeLocal = (val: string): string => {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
};

const getStatusLabel = (status: TaskStatus): string => {
  const map: Record<TaskStatus, string> = { draft: '草稿', published: '已发布', archived: '已归档' };
  return map[status] || status;
};

const getStatusStyle = (status: TaskStatus): string => {
  const map: Record<TaskStatus, string> = {
    draft: 'bg-gray-100 text-gray-600',
    published: 'bg-green-100 text-green-700',
    archived: 'bg-yellow-100 text-yellow-700',
  };
  return map[status] || 'bg-gray-100 text-gray-600';
};

const getResourceIcon = (type: ResourceType, fileName?: string): string => {
  if (type === 'link') return 'fa-link';
  if (type === 'html') return 'fa-code';
  const ext = (fileName || '').split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'fa-file-pdf';
    case 'ppt':
    case 'pptx': return 'fa-file-powerpoint';
    case 'doc':
    case 'docx': return 'fa-file-word';
    case 'xls':
    case 'xlsx': return 'fa-file-excel';
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'wmv': return 'fa-file-video';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'bmp': return 'fa-file-image';
    case 'py': return 'fa-file-code';
    case 'zip':
    case 'rar':
    case '7z': return 'fa-file-zipper';
    case 'html':
    case 'htm': return 'fa-file-code';
    default: return 'fa-file';
  }
};

const getResourceTypeLabel = (type: ResourceType, fileName?: string): string => {
  if (type === 'link') return '外链';
  if (type === 'html') return 'HTML';
  const ext = (fileName || '').split('.').pop()?.toUpperCase();
  return ext || '文件';
};

const formatDuration = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return '-';
  if (seconds < 60) return `${seconds}秒`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}分钟`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}小时${remMins > 0 ? remMins + '分' : ''}`;
};

const stripHtml = (html: string): string => {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
};

// ============ 主组件 ============
export const TaskManager: React.FC = () => {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [studentTaskId, setStudentTaskId] = useState<string | null>(null);
  const [studentTaskTitle, setStudentTaskTitle] = useState('');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await apiRequest<Task[]>(`/api/teacher/tasks?status=${statusFilter === 'all' ? '' : statusFilter}`);
    if (error) {
      console.error('获取任务列表失败:', error);
    }
    const list = data || [];
    const statusNumToStr: Record<number, TaskStatus> = { 0: 'draft', 1: 'published', 2: 'archived' };
    const enriched = list.map((t) => {
      let classIds: string[] = [];
      if (t.class_ids && Array.isArray(t.class_ids)) {
        classIds = t.class_ids;
      } else if (t.class_ids && typeof t.class_ids === 'string') {
        try { classIds = JSON.parse(t.class_ids); } catch {}
      } else if (t.class_id) {
        classIds = [String(t.class_id)];
      }
      const classNames = classIds
        .map((id) => classes.find((c) => c.id === id)?.name)
        .filter(Boolean) as string[];
      return {
        ...t,
        status: typeof t.status === 'number' ? (statusNumToStr[t.status] || 'draft') : (t.status as TaskStatus),
        access_type: t.access_type === 1 ? 'public' : 'private',
        class_name: classNames.length > 0 ? classNames.join('、') : '未分配',
        class_names: classNames,
      };
    });
    setTasks(enriched);
    setLoading(false);
  }, [statusFilter, classes]);

  const fetchClasses = async () => {
    const { data, error } = await apiRequest<ClassInfo[]>(`/api/classes?teacher_id=${profile?.id || ''}`);
    if (error) {
      console.error('获取班级列表失败:', error);
    }
    setClasses(data || []);
  };

  useEffect(() => {
    if (profile?.id) {
      fetchClasses();
    }
  }, [profile?.id]);

  useEffect(() => {
    if (classes.length >= 0) {
      fetchTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, classes.length]);

  const handleCreate = () => {
    setEditingTaskId(null);
    setShowEditPanel(true);
  };

  const handleEdit = (task: Task) => {
    setEditingTaskId(task.id);
    setShowEditPanel(true);
  };

  const handleDelete = async (taskId: string) => {
    if (!window.confirm('确定要删除这个任务吗？删除后无法恢复。')) return;
    const { error } = await apiRequest(`/api/teacher/tasks/${taskId}`, { method: 'DELETE' });
    if (error) {
      alert('删除失败: ' + error);
      return;
    }
    fetchTasks();
  };

  const handlePublish = async (taskId: string) => {
    if (!window.confirm('确定要发布此任务吗？发布后学生将可以看到。')) return;
    const { error } = await apiRequest(`/api/teacher/tasks/${taskId}/publish`, { method: 'POST' });
    if (error) {
      alert('发布失败: ' + error);
      return;
    }
    fetchTasks();
  };

  const handleDuplicate = async (taskId: string) => {
    const { data, error } = await apiRequest<Task>(`/api/teacher/tasks/${taskId}/duplicate`, { method: 'POST' });
    if (error) {
      alert('复制失败: ' + error);
      return;
    }
    if (data) {
      alert('复制成功！新任务已创建为草稿。');
    }
    fetchTasks();
  };

  const handleTogglePin = async (task: Task) => {
    const next = task.is_pinned ? 0 : 1;
    const { error } = await apiRequest(`/api/teacher/tasks/${task.id}/pin`, {
      method: 'PUT',
      body: JSON.stringify({ is_pinned: next }),
    });
    if (error) {
      alert((next ? '置顶失败: ' : '取消置顶失败: ') + error);
      return;
    }
    fetchTasks();
  };

  const handleViewStudents = (task: Task) => {
    setStudentTaskId(task.id);
    setStudentTaskTitle(task.title);
    setShowStudentModal(true);
  };

  const handlePanelClose = () => {
    setShowEditPanel(false);
    setEditingTaskId(null);
    fetchTasks();
  };

  const filteredTasks = tasks.filter((t) => {
    const matchesSearch = !searchText || t.title.toLowerCase().includes(searchText.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部标题与新建按钮 */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-gray-800">
          <i className="fa-solid fa-chalkboard-user mr-2 text-blue-500"></i>备课工作台
        </h3>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
        >
          <i className="fa-solid fa-plus mr-2"></i>新建任务
        </button>
      </div>

      {/* 工具栏：搜索 + 状态筛选 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <i className="fa-solid fa-search text-gray-400"></i>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索任务名称..."
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {(['all', 'draft', 'published', 'archived'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                statusFilter === s ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {s === 'all' ? '全部' : getStatusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {/* 任务卡片列表 */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <i className="fa-solid fa-folder-open text-6xl mb-4"></i>
          <p className="text-gray-500">{searchText || statusFilter !== 'all' ? '没有符合条件的任务' : '暂无任务'}</p>
          <p className="text-sm mt-2">点击右上角「新建任务」开始备课</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={handleEdit}
              onPublish={handlePublish}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onViewStudents={handleViewStudents}
              onTogglePin={handleTogglePin}
            />
          ))}
        </div>
      )}

      {/* 任务编辑面板 */}
      <AnimatePresence>
        {showEditPanel && (
          <TaskEditPanel
            taskId={editingTaskId}
            classes={classes}
            onClose={handlePanelClose}
          />
        )}
      </AnimatePresence>

      {/* 学生数据面板 */}
      <AnimatePresence>
        {showStudentModal && studentTaskId && (
          <StudentDataModal
            taskId={studentTaskId}
            taskTitle={studentTaskTitle}
            onClose={() => {
              setShowStudentModal(false);
              setStudentTaskId(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ============ 任务卡片子组件 ============
const TaskCard: React.FC<{
  task: Task;
  onEdit: (task: Task) => void;
  onPublish: (taskId: string) => void;
  onDuplicate: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onViewStudents: (task: Task) => void;
  onTogglePin: (task: Task) => void;
}> = ({ task, onEdit, onPublish, onDuplicate, onDelete, onViewStudents, onTogglePin }) => {
  const completionRate = task.completion_rate ?? 0;
  const totalStudents = task.total_students ?? 0;
  const completedStudents = task.completed_students ?? 0;
  const isPinned = !!Number(task.is_pinned);

  return (
    <div className={`bg-white rounded-xl shadow-sm border p-5 hover:shadow-md transition-shadow flex flex-col ${isPinned ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-200'}`}>
      {/* 卡片头部 */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-gray-800 truncate" title={task.title}>
            {isPinned && <i className="fa-solid fa-thumbtack text-amber-500 mr-1.5" title="已置顶"></i>}
            {task.title}
          </h4>
          <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
            <i className="fa-solid fa-users"></i>
            <span>{task.class_name}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isPinned && (
            <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-600">置顶</span>
          )}
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusStyle(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
        </div>
      </div>

      {/* 学习目标摘要 */}
      {task.learning_objectives && (
        <p className="text-sm text-gray-500 line-clamp-2 mb-3">{stripHtml(task.learning_objectives)}</p>
      )}

      {/* 时间信息 */}
      <div className="space-y-1 text-xs text-gray-500 mb-3">
        {task.start_time && (
          <div className="flex items-center gap-1.5">
            <i className="fa-solid fa-play w-3"></i>
            <span>开课: {formatDateTime(task.start_time)}</span>
          </div>
        )}
        {task.deadline && (
          <div className="flex items-center gap-1.5">
            <i className="fa-solid fa-flag-checkered w-3"></i>
            <span>截止: {formatDateTime(task.deadline)}</span>
          </div>
        )}
      </div>

      {/* 资源与题目数 */}
      <div className="flex gap-4 text-sm text-gray-600 mb-3">
        <span className="flex items-center gap-1">
          <i className="fa-solid fa-paperclip text-blue-400"></i>
          {task.resource_count ?? 0} 资源
        </span>
        <span className="flex items-center gap-1">
          <i className="fa-solid fa-circle-question text-purple-400"></i>
          {task.question_count ?? 0} 题目
        </span>
        {task.force_video_watch && (
          <span className="flex items-center gap-1 text-orange-500">
            <i className="fa-solid fa-eye"></i>强制观看
          </span>
        )}
        {task.access_type === 'public' && (
          <span className="flex items-center gap-1 text-green-500">
            <i className="fa-solid fa-globe"></i>公开
          </span>
        )}
      </div>

      {/* 完成率进度条 */}
      {task.status === 'published' && totalStudents > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>学生完成率</span>
            <span>{completedStudents}/{totalStudents} ({completionRate}%)</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-400 to-green-400 h-full rounded-full transition-all"
              style={{ width: `${completionRate}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-auto pt-3 border-t border-gray-100 flex-wrap">
        <button
          onClick={() => onEdit(task)}
          className="flex-1 px-2 py-1.5 text-sm text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          title="编辑"
        >
          <i className="fa-solid fa-edit mr-1"></i>编辑
        </button>
        {task.status === 'draft' && (
          <button
            onClick={() => onPublish(task.id)}
            className="flex-1 px-2 py-1.5 text-sm text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
            title="发布"
          >
            <i className="fa-solid fa-paper-plane mr-1"></i>发布
          </button>
        )}
        <button
          onClick={() => onTogglePin(task)}
          className={`px-2 py-1.5 text-sm rounded-lg transition-colors ${
            isPinned
              ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
              : 'text-gray-600 bg-gray-50 hover:bg-gray-100'
          }`}
          title={isPinned ? '取消置顶' : '置顶（学生端优先显示）'}
        >
          <i className="fa-solid fa-thumbtack"></i>
        </button>
        <button
          onClick={() => onDuplicate(task.id)}
          className="px-2 py-1.5 text-sm text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          title="复制"
        >
          <i className="fa-solid fa-copy"></i>
        </button>
        {task.status === 'published' && (
          <button
            onClick={() => onViewStudents(task)}
            className="px-2 py-1.5 text-sm text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
            title="学生数据"
          >
            <i className="fa-solid fa-chart-bar"></i>
          </button>
        )}
        <button
          onClick={() => onDelete(task.id)}
          className="px-2 py-1.5 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
          title="删除"
        >
          <i className="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  );
};

// ============ 任务编辑面板 ============
const TaskEditPanel: React.FC<{
  taskId: string | null;
  classes: ClassInfo[];
  onClose: () => void;
}> = ({ taskId, classes, onClose }) => {
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(taskId);
  const [isNew, setIsNew] = useState(taskId === null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'resources' | 'questions'>('basic');

  // 基础信息表单
  const [formData, setFormData] = useState({
    title: '',
    class_ids: [] as string[],
    start_time: '',
    deadline: '',
    learning_objectives: '',
    force_video_watch: false,
    min_study_duration: 0,
    passing_score: 0,
    pass_reward_points: 0,
    access_type: 'private' as 'private' | 'public',
  });
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('draft');
  const [publicLink, setPublicLink] = useState('');

  // 资源相关
  const [resources, setResources] = useState<Resource[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [linkInput, setLinkInput] = useState({ url: '', title: '' });
  const [htmlInput, setHtmlInput] = useState({ title: '', html_content: '' });
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [showAddHtml, setShowAddHtml] = useState(false);
  const dragItemIndex = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 习题相关
  const [questions, setQuestions] = useState<TaskQuestion[]>([]);
  const [questionTab, setQuestionTab] = useState<'bank' | 'quick' | 'list'>('list');
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [bankFilterType, setBankFilterType] = useState('');
  const [bankFilterTag, setBankFilterTag] = useState('');
  const [bankAllTags, setBankAllTags] = useState<string[]>([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankPage, setBankPage] = useState(1);
  const [bankHasSearched, setBankHasSearched] = useState(false);
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>([]);
  const [bankScore, setBankScore] = useState(5);
  const [quickForm, setQuickForm] = useState({
    temp_content: '',
    temp_type: 'choice' as 'choice' | 'fill_blank',
    temp_options: ['', '', '', ''],
    temp_answer: '',
    score: 5,
  });

  const loadTaskDetail = useCallback(async (id: string) => {
    setLoading(true);
    const { data, error } = await apiRequest<Task & { resources?: Resource[]; questions?: TaskQuestion[] }>(`/api/teacher/tasks/${id}`);
    if (error) {
      alert('加载任务详情失败: ' + error);
      setLoading(false);
      return;
    }
    if (data) {
      const task = (data as any).task || data;
      let classIds: string[] = [];
      if (task.class_ids && Array.isArray(task.class_ids)) {
        classIds = task.class_ids;
      } else if (task.class_ids && typeof task.class_ids === 'string') {
        try { classIds = JSON.parse(task.class_ids); } catch {}
      } else if (task.class_id) {
        classIds = [String(task.class_id)];
      }
      const statusMap: Record<number, TaskStatus> = { 0: 'draft', 1: 'published', 2: 'archived' };
      const taskStatusStr = typeof task.status === 'number' ? (statusMap[task.status] || 'draft') : (task.status || 'draft');
      const accessTypeStr = task.access_type === 1 || task.access_type === 'public' ? 'public' : 'private';
      setFormData({
        title: task.title || '',
        class_ids: classIds,
        start_time: toDateTimeLocal(task.start_time),
        deadline: toDateTimeLocal(task.deadline),
        learning_objectives: task.learning_objectives || '',
        force_video_watch: !!task.force_video_watch,
        min_study_duration: task.min_study_duration ? Number(task.min_study_duration) : 0,
        passing_score: task.passing_score ? Number(task.passing_score) : 0,
        pass_reward_points: task.pass_reward_points ? Number(task.pass_reward_points) : 0,
        access_type: accessTypeStr as 'private' | 'public',
      });
      setTaskStatus(taskStatusStr);
      setResources((data.resources || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
      setQuestions(data.questions || []);
      if (accessTypeStr === 'public' && taskStatusStr === 'published') {
        setPublicLink(`${window.location.origin}/#/public/task/${task.id}`);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (taskId) {
      loadTaskDetail(taskId);
    }
  }, [taskId, loadTaskDetail]);

  // 保存（创建或更新基础信息）
  const handleSaveBasic = async (): Promise<string | null> => {
    if (!formData.title.trim()) {
      alert('请输入任务名称');
      return null;
    }
    if (formData.class_ids.length === 0) {
      alert('请至少选择一个班级');
      return null;
    }
    setSaving(true);
    const payload = {
      class_ids: formData.class_ids,
      title: formData.title.trim(),
      learning_objectives: formData.learning_objectives,
      start_time: fromDateTimeLocal(formData.start_time) || null,
      deadline: fromDateTimeLocal(formData.deadline) || null,
      force_video_watch: formData.force_video_watch,
      min_study_duration: formData.min_study_duration,
      passing_score: formData.passing_score,
      pass_reward_points: formData.pass_reward_points,
      access_type: formData.access_type,
    };

    if (currentTaskId) {
      const { error } = await apiRequest(`/api/teacher/tasks/${currentTaskId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setSaving(false);
      if (error) {
        alert('保存失败: ' + error);
        return null;
      }
      return currentTaskId;
    } else {
      const { data, error } = await apiRequest<Task>('/api/teacher/tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSaving(false);
      if (error || !data) {
        alert('创建失败: ' + (error || '未知错误'));
        return null;
      }
      setCurrentTaskId(data.id);
      setIsNew(false);
      setTaskStatus(data.status || 'draft');
      return data.id;
    }
  };

  const handleSaveDraft = async () => {
    await handleSaveBasic();
  };

  const handlePublish = async () => {
    const id = await handleSaveBasic();
    if (!id) return;
    if (!window.confirm('确定要发布此任务吗？发布后学生将可以看到。')) return;
    const { error } = await apiRequest(`/api/teacher/tasks/${id}/publish`, { method: 'POST' });
    if (error) {
      alert('发布失败: ' + error);
      return;
    }
    setTaskStatus('published');
    if (formData.access_type === 'public') {
      setPublicLink(`${window.location.origin}/public/task/${id}`);
    }
    alert('任务已发布！');
  };

  const handleCopyLink = () => {
    if (!publicLink) return;
    navigator.clipboard.writeText(publicLink).then(() => {
      alert('链接已复制到剪贴板');
    }).catch(() => {
      window.prompt('请手动复制链接:', publicLink);
    });
  };

  // ============ 资源操作 ============
  const handleFileUpload = async (files: FileList | File[]) => {
    let targetId = currentTaskId;
    if (!targetId) {
      targetId = await handleSaveBasic();
      if (!targetId) return;
    }

    setUploading(true);
    const fd = new FormData();
    const fileArr = Array.from(files);
    fileArr.forEach((f) => fd.append('files', f));

    const { data, error } = await apiRequest<Resource | Resource[]>(`/api/teacher/tasks/${targetId}/resources`, {
      method: 'POST',
      body: fd,
    });
    setUploading(false);
    if (error) {
      alert('上传失败: ' + error);
      return;
    }
    if (data) {
      const newRes = Array.isArray(data) ? data : [data];
      setResources((prev) => [...prev, ...newRes]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddLink = async () => {
    let targetId = currentTaskId;
    if (!targetId) {
      targetId = await handleSaveBasic();
      if (!targetId) return;
    }
    if (!linkInput.url.trim() || !linkInput.title.trim()) {
      alert('请填写链接URL和标题');
      return;
    }
    setSaving(true);
    const { data, error } = await apiRequest<Resource>(`/api/teacher/tasks/${targetId}/resources`, {
      method: 'POST',
      body: JSON.stringify({ type: 'link', url: linkInput.url.trim(), title: linkInput.title.trim() }),
    });
    setSaving(false);
    if (error) {
      alert('添加链接失败: ' + error);
      return;
    }
    if (data) {
      setResources((prev) => [...prev, data]);
    }
    setLinkInput({ url: '', title: '' });
    setShowAddLink(false);
  };

  const handleAddHtml = async () => {
    let targetId = currentTaskId;
    if (!targetId) {
      targetId = await handleSaveBasic();
      if (!targetId) return;
    }
    if (!htmlInput.title.trim() || !htmlInput.html_content.trim()) {
      alert('请填写标题和HTML内容');
      return;
    }
    setSaving(true);
    const { data, error } = await apiRequest<Resource>(`/api/teacher/tasks/${targetId}/resources`, {
      method: 'POST',
      body: JSON.stringify({ type: 'html', html_content: htmlInput.html_content, title: htmlInput.title.trim() }),
    });
    setSaving(false);
    if (error) {
      alert('添加HTML失败: ' + error);
      return;
    }
    if (data) {
      setResources((prev) => [...prev, data]);
    }
    setHtmlInput({ title: '', html_content: '' });
    setShowHtmlPreview(false);
    setShowAddHtml(false);
  };

  const handleDeleteResource = async (resourceId: string) => {
    if (!currentTaskId) return;
    if (!window.confirm('确定要删除此资源吗？')) return;
    const { error } = await apiRequest(`/api/teacher/tasks/${currentTaskId}/resources/${resourceId}`, { method: 'DELETE' });
    if (error) {
      alert('删除失败: ' + error);
      return;
    }
    setResources((prev) => prev.filter((r) => r.id !== resourceId));
  };

  // 资源拖拽排序
  const handleDragStart = (index: number) => {
    dragItemIndex.current = index;
  };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };
  const handleDrop = async (index: number) => {
    const from = dragItemIndex.current;
    if (from === null || from === index || !currentTaskId) {
      dragItemIndex.current = null;
      return;
    }
    const updated = [...resources];
    const [moved] = updated.splice(from, 1);
    updated.splice(index, 0, moved);
    const reordered = updated.map((r, i) => ({ ...r, sort_order: i }));
    setResources(reordered);
    dragItemIndex.current = null;

    const { error } = await apiRequest(`/api/teacher/tasks/${currentTaskId}/resources/sort`, {
      method: 'PUT',
      body: JSON.stringify({ resources: reordered.map((r) => ({ id: r.id, sort_order: r.sort_order })) }),
    });
    if (error) {
      alert('排序保存失败: ' + error);
    }
  };

  // ============ 习题操作 ============
  const loadBankQuestions = async (searchParams?: { keyword?: string; type?: string; tag?: string; page?: number }) => {
    setBankLoading(true);
    const params = new URLSearchParams();
    const keyword = searchParams?.keyword ?? bankSearch;
    const type = searchParams?.type ?? bankFilterType;
    const tag = searchParams?.tag ?? bankFilterTag;
    const page = searchParams?.page ?? 1;
    if (keyword) params.set('keyword', keyword);
    if (type) params.set('type', type);
    if (tag) params.set('tag', tag);
    params.set('page', String(page));
    params.set('pageSize', '20');
    try {
      const token = getToken();
      const response = await fetch(`${API_CONFIG.apiUrl}/api/teacher/questions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      setBankLoading(false);
      if (result.error) {
        console.error('加载题库失败:', result.error);
        return;
      }
      setBankQuestions(result.data || []);
      if (result.tags) setBankAllTags(result.tags);
      if (result.total !== undefined) setBankTotal(result.total);
      setBankHasSearched(true);
    } catch (err) {
      setBankLoading(false);
      console.error('加载题库失败:', err);
    }
  };

  const handleImportBankQuestions = async () => {
    let targetId = currentTaskId;
    if (!targetId) {
      targetId = await handleSaveBasic();
      if (!targetId) return;
    }
    if (selectedBankIds.length === 0) {
      alert('请先勾选要导入的题目');
      return;
    }
    setSaving(true);
    let successCount = 0;
    for (const qId of selectedBankIds) {
      const { error } = await apiRequest(`/api/teacher/tasks/${targetId}/questions`, {
        method: 'POST',
        body: JSON.stringify({ question_id: qId, score: bankScore }),
      });
      if (!error) successCount++;
    }
    setSaving(false);
    alert(`成功导入 ${successCount} 道题目`);
    setSelectedBankIds([]);
    // 刷新题目列表
    const { data: detail } = await apiRequest<Task & { questions?: TaskQuestion[] }>(`/api/teacher/tasks/${targetId}`);
    if (detail?.questions) setQuestions(detail.questions);
    setQuestionTab('list');
  };

  const handleAddQuickQuestion = async () => {
    let targetId = currentTaskId;
    if (!targetId) {
      targetId = await handleSaveBasic();
      if (!targetId) return;
    }
    if (!quickForm.temp_content.trim()) {
      alert('请输入题目内容');
      return;
    }
    setSaving(true);
    const payload: any = {
      temp_content: quickForm.temp_content,
      temp_type: quickForm.temp_type,
      temp_options: quickForm.temp_type === 'choice' ? quickForm.temp_options.filter((o) => o.trim()) : [],
      temp_answer: quickForm.temp_answer.split(',').map((s) => s.trim()).filter(Boolean),
      score: quickForm.score,
    };
    const { data, error } = await apiRequest<TaskQuestion>(`/api/teacher/tasks/${targetId}/questions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (error) {
      alert('添加题目失败: ' + error);
      return;
    }
    if (data) {
      setQuestions((prev) => [...prev, data]);
    }
    setQuickForm({
      temp_content: '',
      temp_type: 'choice',
      temp_options: ['', '', '', ''],
      temp_answer: '',
      score: 5,
    });
    setQuestionTab('list');
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!currentTaskId) return;
    if (!window.confirm('确定要删除此题目吗？')) return;
    const { error } = await apiRequest(`/api/teacher/tasks/${currentTaskId}/questions/${questionId}`, { method: 'DELETE' });
    if (error) {
      alert('删除失败: ' + error);
      return;
    }
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
  };

  const filteredBankQuestions = bankQuestions;

  const totalScore = questions.reduce((sum, q) => sum + (q.score || 0), 0);

  return (
    <>
      {/* 遮罩 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black bg-opacity-40 z-50"
        onClick={onClose}
      />
      {/* 抽屉面板 */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.3 }}
        className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-gray-50 z-50 shadow-2xl flex flex-col"
      >
        {/* 面板头部 */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-800">
              {isNew ? '新建任务' : '编辑任务'}
              {!isNew && taskStatus && (
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusStyle(taskStatus)}`}>
                  {getStatusLabel(taskStatus)}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {currentTaskId ? `任务ID: ${currentTaskId}` : '填写基础信息后保存即可创建'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        {/* Tab 导航 */}
        <div className="bg-white border-b border-gray-200 px-6 flex gap-1 flex-shrink-0">
          {([
            { key: 'basic', label: '基础信息', icon: 'fa-info-circle' },
            { key: 'resources', label: `教学资源 (${resources.length})`, icon: 'fa-paperclip' },
            { key: 'questions', label: `随堂习题 (${questions.length})`, icon: 'fa-circle-question' },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <i className={`fa-solid ${tab.icon} mr-1.5`}></i>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 面板内容 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <i className="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
            </div>
          ) : (
            <>
              {/* ===== A. 基础信息 ===== */}
              {activeTab === 'basic' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      任务名称 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="例如：Python循环结构入门"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      所属班级 <span className="text-red-500">*</span>
                    </label>
                    <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto bg-white">
                      {classes.length === 0 ? (
                        <p className="text-gray-400 text-sm text-center py-2">暂无班级</p>
                      ) : (
                        <div className="space-y-2">
                          {classes.map((c) => (
                            <label key={c.id} className="flex items-center gap-2 cursor-pointer hover:bg-blue-50 p-1.5 rounded -m-1.5">
                              <input
                                type="checkbox"
                                checked={formData.class_ids.includes(c.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFormData({ ...formData, class_ids: [...formData.class_ids, c.id] });
                                  } else {
                                    setFormData({ ...formData, class_ids: formData.class_ids.filter((id) => id !== c.id) });
                                  }
                                }}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                              />
                              <span className="text-sm text-gray-700">{c.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">已选择 {formData.class_ids.length} 个班级</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">上课时间</label>
                      <input
                        type="datetime-local"
                        value={formData.start_time}
                        onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">截止时间</label>
                      <input
                        type="datetime-local"
                        value={formData.deadline}
                        onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">学习目标</label>
                    <textarea
                      value={formData.learning_objectives}
                      onChange={(e) => setFormData({ ...formData, learning_objectives: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-y"
                      placeholder="描述本任务的学习目标，例如：掌握for循环和while循环的基本用法..."
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <i className="fa-solid fa-eye text-orange-400"></i>
                        <div>
                          <span className="text-sm font-medium text-gray-700">强制看完视频才能答题</span>
                          <p className="text-xs text-gray-400">学生必须观看完所有视频资源后才可答题</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.force_video_watch}
                        onChange={(e) => setFormData({ ...formData, force_video_watch: e.target.checked })}
                        className="w-5 h-5 rounded"
                      />
                    </label>

                    <div className="p-3 bg-white border border-gray-200 rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <i className="fa-solid fa-clock text-blue-400"></i>
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-700">最小学习时长</span>
                          <p className="text-xs text-gray-400">学习时长达标且所有资源都查看后才能答题</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="999"
                          value={formData.min_study_duration}
                          onChange={(e) => setFormData({ ...formData, min_study_duration: Math.max(0, parseInt(e.target.value) || 0) })}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          placeholder="0"
                        />
                        <span className="text-sm text-gray-500">分钟</span>
                      </div>
                      {formData.min_study_duration > 0 && (
                        <p className="text-xs text-blue-500 mt-2">
                          <i className="fa-solid fa-circle-info mr-1"></i>
                          学生需学习至少 {formData.min_study_duration} 分钟并查看所有资源才能开始练习
                        </p>
                      )}
                    </div>

                    <div className="p-3 bg-white border border-gray-200 rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <i className="fa-solid fa-medal text-amber-500"></i>
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-700">随堂习题合格奖励</span>
                          <p className="text-xs text-gray-400">设置合格分数线与奖励积分，达到分数线即可获得积分</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">合格分数线</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              max="999"
                              value={formData.passing_score}
                              onChange={(e) => setFormData({ ...formData, passing_score: Math.max(0, parseInt(e.target.value) || 0) })}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                              placeholder="0"
                            />
                            <span className="text-xs text-gray-500">分</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">合格奖励积分</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              max="9999"
                              value={formData.pass_reward_points}
                              onChange={(e) => setFormData({ ...formData, pass_reward_points: Math.max(0, parseInt(e.target.value) || 0) })}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                              placeholder="0"
                            />
                            <span className="text-xs text-gray-500">积分</span>
                          </div>
                        </div>
                      </div>
                      {formData.passing_score > 0 && formData.pass_reward_points > 0 && (
                        <p className="text-xs text-amber-600 mt-2">
                          <i className="fa-solid fa-gift mr-1"></i>
                          学生随堂习题得分达到 {formData.passing_score} 分即可获得 {formData.pass_reward_points} 积分奖励
                        </p>
                      )}
                      {formData.passing_score > 0 && formData.pass_reward_points === 0 && (
                        <p className="text-xs text-gray-500 mt-2">
                          <i className="fa-solid fa-circle-info mr-1"></i>
                          仅设置分数线，未设置奖励积分（学生不会获得积分奖励）
                        </p>
                      )}
                      {formData.passing_score === 0 && formData.pass_reward_points > 0 && (
                        <p className="text-xs text-amber-600 mt-2">
                          <i className="fa-solid fa-circle-exclamation mr-1"></i>
                          奖励积分已设置但分数线为 0，学生将无法获得奖励
                        </p>
                      )}
                    </div>

                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <i className="fa-solid fa-globe text-green-400"></i>
                        <div>
                          <span className="text-sm font-medium text-gray-700">公开访问</span>
                          <p className="text-xs text-gray-400">允许非本班学生通过链接访问</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.access_type === 'public'}
                        onChange={(e) => setFormData({ ...formData, access_type: e.target.checked ? 'public' : 'private' })}
                        className="w-5 h-5 rounded"
                      />
                    </label>
                  </div>

                  {/* 公开链接 */}
                  {taskStatus === 'published' && formData.access_type === 'public' && publicLink && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <label className="block text-sm font-medium text-green-700 mb-2">
                        <i className="fa-solid fa-link mr-1"></i>公开访问链接
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={publicLink}
                          readOnly
                          className="flex-1 px-3 py-2 bg-white border border-green-300 rounded-lg text-sm text-gray-600"
                        />
                        <button
                          onClick={handleCopyLink}
                          className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm"
                        >
                          <i className="fa-solid fa-copy mr-1"></i>复制
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ===== B. 教学资源区 ===== */}
              {activeTab === 'resources' && (
                <div className="space-y-4">
                  {!currentTaskId && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      <i className="fa-solid fa-info-circle mr-1"></i>
                      请先在「基础信息」中填写并保存任务，然后即可上传资源。
                    </div>
                  )}

                  {/* 上传区域 */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      if (e.dataTransfer.files.length > 0) {
                        handleFileUpload(e.dataTransfer.files);
                      }
                    }}
                    className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                      dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-400'
                    }`}
                  >
                    <i className="fa-solid fa-cloud-arrow-up text-4xl text-gray-400 mb-2"></i>
                    <p className="text-sm text-gray-600 font-medium">拖拽文件到此处上传</p>
                    <p className="text-xs text-gray-400 mt-1">支持 PDF / PPT / Word / Excel / 图片 / 视频 / Python / Zip / HTML / Access</p>
                    <p className="text-xs text-amber-500 mt-1">提示：PPT、Word 文档建议另存为 PDF 后上传，可在浏览器直接打开</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!currentTaskId || uploading}
                      className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <i className="fa-solid fa-folder-open mr-1"></i>
                      {uploading ? '上传中...' : '选择文件'}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.bmp,.mp4,.avi,.mov,.wmv,.py,.zip,.rar,.7z,.html,.htm,.mdb,.accdb"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleFileUpload(e.target.files);
                        }
                      }}
                    />
                  </div>

                  {/* 添加链接 / HTML 按钮 */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowAddLink(!showAddLink); setShowAddHtml(false); }}
                      className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <i className="fa-solid fa-link mr-1 text-blue-500"></i>
                      添加外链
                    </button>
                    <button
                      onClick={() => { setShowAddHtml(!showAddHtml); setShowAddLink(false); }}
                      className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <i className="fa-solid fa-code mr-1 text-purple-500"></i>
                      编写HTML
                    </button>
                  </div>

                  {/* 添加外链表单 */}
                  <AnimatePresence>
                    {showAddLink && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">链接标题</label>
                            <input
                              type="text"
                              value={linkInput.title}
                              onChange={(e) => setLinkInput({ ...linkInput, title: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              placeholder="例如：B站教学视频"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">链接URL</label>
                            <input
                              type="text"
                              value={linkInput.url}
                              onChange={(e) => setLinkInput({ ...linkInput, url: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              placeholder="https://..."
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setShowAddLink(false)}
                              className="flex-1 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition-colors"
                            >
                              取消
                            </button>
                            <button
                              onClick={handleAddLink}
                              disabled={saving}
                              className="flex-1 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors disabled:opacity-50"
                            >
                              {saving ? '添加中...' : '添加'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 添加HTML表单 */}
                  <AnimatePresence>
                    {showAddHtml && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">页面标题</label>
                            <input
                              type="text"
                              value={htmlInput.title}
                              onChange={(e) => setHtmlInput({ ...htmlInput, title: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              placeholder="例如：Python基础知识点"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-xs font-medium text-gray-600">HTML代码</label>
                              <button
                                onClick={() => setShowHtmlPreview(!showHtmlPreview)}
                                className="text-xs text-blue-500 hover:text-blue-700"
                              >
                                <i className="fa-solid fa-eye mr-1"></i>
                                {showHtmlPreview ? '编辑' : '预览'}
                              </button>
                            </div>
                            {showHtmlPreview ? (
                              <div
                                className="w-full min-h-[120px] px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm overflow-auto"
                                dangerouslySetInnerHTML={{ __html: htmlInput.html_content || '<p style="color:#999">无内容</p>' }}
                              />
                            ) : (
                              <textarea
                                value={htmlInput.html_content}
                                onChange={(e) => setHtmlInput({ ...htmlInput, html_content: e.target.value })}
                                rows={6}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                                placeholder={'可以在豆包等AI上生成教学网页代码，复制粘贴到这里\n例如：\n<h1>标题</h1>\n<p>内容...</p>'}
                              />
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setShowAddHtml(false); setShowHtmlPreview(false); }}
                              className="flex-1 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition-colors"
                            >
                              取消
                            </button>
                            <button
                              onClick={handleAddHtml}
                              disabled={saving}
                              className="flex-1 px-3 py-1.5 bg-purple-500 text-white rounded-lg text-sm hover:bg-purple-600 transition-colors disabled:opacity-50"
                            >
                              {saving ? '添加中...' : '添加'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 资源列表 */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      已添加资源 ({resources.length}) <span className="text-xs text-gray-400 font-normal">— 可拖拽排序</span>
                    </p>
                    {resources.length === 0 ? (
                      <div className="text-center py-8 text-gray-400 border border-dashed border-gray-200 rounded-lg">
                        <i className="fa-solid fa-inbox text-3xl mb-2"></i>
                        <p className="text-sm">暂无资源，请上传文件或添加链接</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {resources.map((res, index) => (
                          <div
                            key={res.id}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={() => handleDrop(index)}
                            className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-shadow cursor-move group"
                          >
                            <i className="fa-solid fa-grip-vertical text-gray-300"></i>
                            <i className={`fa-solid ${getResourceIcon(res.type, res.file_name)} text-lg text-blue-500 w-5 text-center`}></i>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-700 truncate">
                                {res.title || res.file_name || res.url || '未命名资源'}
                              </p>
                              <span className="text-xs text-gray-400">{getResourceTypeLabel(res.type, res.file_name)}</span>
                            </div>
                            <button
                              onClick={() => handleDeleteResource(res.id)}
                              className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                              title="删除"
                            >
                              <i className="fa-solid fa-trash"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ===== C. 随堂习题区 ===== */}
              {activeTab === 'questions' && (
                <div className="space-y-4">
                  {!currentTaskId && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      <i className="fa-solid fa-info-circle mr-1"></i>
                      请先在「基础信息」中填写并保存任务，然后即可添加题目。
                    </div>
                  )}

                  {/* 模式切换 Tab */}
                  <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                    {([
                      { key: 'list', label: '已添加', icon: 'fa-list' },
                      { key: 'bank', label: '从题库选题', icon: 'fa-book-bookmark' },
                      { key: 'quick', label: '快速出题', icon: 'fa-bolt' },
                    ] as const).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => {
                          setQuestionTab(tab.key);
                          if (tab.key === 'bank' && !bankHasSearched) {
                            // 加载标签列表但不加载题目
                            loadBankQuestions({ page: 1 });
                          }
                        }}
                        className={`flex-1 px-3 py-2 text-sm rounded-md transition-colors ${
                          questionTab === tab.key ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'
                        }`}
                      >
                        <i className={`fa-solid ${tab.icon} mr-1`}></i>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* 已添加题目列表 */}
                  {questionTab === 'list' && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm text-gray-600">共 {questions.length} 题，总分 {totalScore} 分</p>
                      </div>
                      {questions.length === 0 ? (
                        <div className="text-center py-8 text-gray-400 border border-dashed border-gray-200 rounded-lg">
                          <i className="fa-solid fa-circle-question text-3xl mb-2"></i>
                          <p className="text-sm">暂无题目，请从题库选题或快速出题</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {questions.map((q, idx) => (
                            <div key={q.id} className="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg group">
                              <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-medium">
                                {idx + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-700 line-clamp-2">
                                  {q.content ? stripHtml(q.content) : (q.temp_content ? stripHtml(q.temp_content) : (q.question_id ? `题库题目 #${q.question_id.slice(0, 8)}` : '题目'))}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-gray-400">
                                    [{(q.type || q.temp_type) === 'fill_blank' ? '填空题' : (q.type || q.temp_type) === 'code' ? '编程题' : '选择题'}]
                                  </span>
                                  <span className="text-xs font-medium text-purple-600">{q.score}分</span>
                                </div>
                              </div>
                              <button
                                onClick={() => handleDeleteQuestion(q.id)}
                                className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                title="删除"
                              >
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 从题库选题 */}
                  {questionTab === 'bank' && (
                    <div className="space-y-3">
                      {/* 筛选区 */}
                      <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={bankSearch}
                            onChange={(e) => setBankSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { setBankPage(1); loadBankQuestions({ keyword: bankSearch, page: 1 }); } }}
                            placeholder="输入关键词搜索题目..."
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          />
                          <button
                            onClick={() => { setBankPage(1); loadBankQuestions({ keyword: bankSearch, page: 1 }); }}
                            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors whitespace-nowrap"
                          >
                            <i className="fa-solid fa-search mr-1"></i>搜索
                          </button>
                        </div>
                        <div className="flex gap-2 items-center flex-wrap">
                          <select
                            value={bankFilterType}
                            onChange={(e) => { setBankFilterType(e.target.value); setBankPage(1); loadBankQuestions({ type: e.target.value, page: 1 }); }}
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                          >
                            <option value="">全部类型</option>
                            <option value="choice">选择题</option>
                            <option value="fill_blank">填空题</option>
                            <option value="code">编程题</option>
                          </select>
                          {bankAllTags.length > 0 && (
                            <select
                              value={bankFilterTag}
                              onChange={(e) => { setBankFilterTag(e.target.value); setBankPage(1); loadBankQuestions({ tag: e.target.value, page: 1 }); }}
                              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                            >
                              <option value="">全部标签</option>
                              {bankAllTags.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          )}
                          {(bankSearch || bankFilterType || bankFilterTag) && (
                            <button
                              onClick={() => { setBankSearch(''); setBankFilterType(''); setBankFilterTag(''); setBankPage(1); loadBankQuestions({ keyword: '', type: '', tag: '', page: 1 }); }}
                              className="px-2 py-1.5 text-gray-500 text-sm hover:text-gray-700"
                            >
                              <i className="fa-solid fa-xmark mr-1"></i>清除筛选
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                        <span className="text-sm text-blue-700">每题分值：</span>
                        <input
                          type="number"
                          value={bankScore}
                          onChange={(e) => setBankScore(parseInt(e.target.value) || 5)}
                          min={1}
                          className="w-20 px-2 py-1 border border-blue-300 rounded text-sm"
                        />
                        <span className="text-sm text-blue-600 ml-auto">已选 {selectedBankIds.length} 题{bankTotal > 0 ? ` · 共 ${bankTotal} 题` : ''}</span>
                      </div>

                      {bankLoading ? (
                        <div className="flex items-center justify-center h-32">
                          <i className="fa-solid fa-circle-notch fa-spin text-blue-500"></i>
                        </div>
                      ) : filteredBankQuestions.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                          <i className="fa-solid fa-book text-3xl mb-2"></i>
                          <p className="text-sm">{bankHasSearched ? '未找到匹配题目' : '请输入关键词或选择筛选条件后搜索'}</p>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2 max-h-96 overflow-y-auto">
                            {filteredBankQuestions.map((q) => {
                              const isSelected = selectedBankIds.includes(q.id);
                              return (
                                <div
                                  key={q.id}
                                  onClick={() => {
                                    setSelectedBankIds((prev) =>
                                      prev.includes(q.id) ? prev.filter((id) => id !== q.id) : [...prev, q.id]
                                    );
                                  }}
                                  className={`p-3 rounded-lg cursor-pointer border-2 transition-colors ${
                                    isSelected ? 'bg-blue-50 border-blue-500' : 'bg-white border-transparent hover:border-gray-300'
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                      isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                                    }`}>
                                      {isSelected && <i className="fa-solid fa-check text-white text-xs"></i>}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm text-gray-700 line-clamp-2">{stripHtml(q.content || '')}</p>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs text-gray-400">[{q.type === 'fill_blank' ? '填空题' : q.type === 'code' ? '编程题' : '选择题'}]</span>
                                        {q.tags && Array.isArray(q.tags) && q.tags.length > 0 && (
                                          q.tags.map((t, i) => (
                                            <span key={i} className="text-xs px-1.5 py-0.5 bg-green-50 text-green-600 rounded">{t}</span>
                                          ))
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* 分页 */}
                          {bankTotal > 20 && (
                            <div className="flex items-center justify-center gap-2 pt-2">
                              <button
                                onClick={() => { const p = Math.max(1, bankPage - 1); setBankPage(p); loadBankQuestions({ page: p }); }}
                                disabled={bankPage <= 1}
                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                              >
                                <i className="fa-solid fa-chevron-left"></i>
                              </button>
                              <span className="text-sm text-gray-600">{bankPage} / {Math.ceil(bankTotal / 20)}</span>
                              <button
                                onClick={() => { const p = bankPage + 1; setBankPage(p); loadBankQuestions({ page: p }); }}
                                disabled={bankPage >= Math.ceil(bankTotal / 20)}
                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                              >
                                <i className="fa-solid fa-chevron-right"></i>
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {selectedBankIds.length > 0 && (
                        <button
                          onClick={handleImportBankQuestions}
                          disabled={saving}
                          className="w-full py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                        >
                          {saving ? '导入中...' : `导入 ${selectedBankIds.length} 道题目`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* 快速出题 */}
                  {questionTab === 'quick' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">题目类型</label>
                        <select
                          value={quickForm.temp_type}
                          onChange={(e) => setQuickForm({ ...quickForm, temp_type: e.target.value as 'choice' | 'fill_blank' })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          <option value="choice">选择题</option>
                          <option value="fill_blank">填空题</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">题目内容</label>
                        <textarea
                          value={quickForm.temp_content}
                          onChange={(e) => setQuickForm({ ...quickForm, temp_content: e.target.value })}
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
                          placeholder="输入题目内容..."
                        />
                      </div>

                      {quickForm.temp_type === 'choice' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">选项</label>
                          <div className="space-y-2">
                            {quickForm.temp_options.map((opt, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="w-6 text-sm font-medium text-gray-500">{String.fromCharCode(65 + i)}.</span>
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => {
                                    const newOpts = [...quickForm.temp_options];
                                    newOpts[i] = e.target.value;
                                    setQuickForm({ ...quickForm, temp_options: newOpts });
                                  }}
                                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                                  placeholder={`选项 ${String.fromCharCode(65 + i)}`}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            正确答案 {quickForm.temp_type === 'choice' ? '(多个用逗号分隔)' : '(多个空用逗号分隔)'}
                          </label>
                          <input
                            type="text"
                            value={quickForm.temp_answer}
                            onChange={(e) => setQuickForm({ ...quickForm, temp_answer: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            placeholder={quickForm.temp_type === 'choice' ? '如: A 或 A,C' : '如: print,for'}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">分值</label>
                          <input
                            type="number"
                            value={quickForm.score}
                            onChange={(e) => setQuickForm({ ...quickForm, score: parseInt(e.target.value) || 5 })}
                            min={1}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          />
                        </div>
                      </div>

                      <button
                        onClick={handleAddQuickQuestion}
                        disabled={saving}
                        className="w-full py-2.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
                      >
                        {saving ? '添加中...' : '添加题目'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 面板底部操作按钮 */}
        <div className="bg-white border-t border-gray-200 px-6 py-4 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            关闭
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
          >
            <i className="fa-solid fa-floppy-disk mr-1"></i>
            {saving ? '保存中...' : '保存草稿'}
          </button>
          <button
            onClick={handlePublish}
            disabled={saving}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm disabled:opacity-50"
          >
            <i className="fa-solid fa-paper-plane mr-1"></i>
            {saving ? '处理中...' : '发布任务'}
          </button>
        </div>
      </motion.div>
    </>
  );
};

// ============ 学生数据面板 ============
const StudentDataModal: React.FC<{
  taskId: string;
  taskTitle: string;
  onClose: () => void;
}> = ({ taskId, taskTitle, onClose }) => {
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'students' | 'analysis'>('students');
  const [sortField, setSortField] = useState<'name' | 'score' | 'status'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedStudent, setSelectedStudent] = useState<AnalysisStudent | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<AnalysisQuestion | null>(null);
  const [analysisData, setAnalysisData] = useState<{ questions: AnalysisQuestion[]; students: AnalysisStudent[]; question_stats: QuestionStat[] } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await apiRequest<StudentProgress[]>(`/api/teacher/tasks/${taskId}/students`);
    if (error) {
      console.error('获取学生数据失败:', error);
    }
    setStudents(data || []);
    setLoading(false);
  }, [taskId]);

  const loadAnalysis = useCallback(async () => {
    setAnalysisLoading(true);
    const { data, error } = await apiRequest<{ questions: AnalysisQuestion[]; students: AnalysisStudent[]; question_stats: QuestionStat[] }>(`/api/teacher/tasks/${taskId}/analysis`);
    if (error) {
      console.error('获取分析数据失败:', error);
    }
    setAnalysisData(data || null);
    setAnalysisLoading(false);
  }, [taskId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (activeTab === 'analysis' && !analysisData && !analysisLoading) {
      loadAnalysis();
    }
  }, [activeTab, analysisData, analysisLoading, loadAnalysis]);

  const handleExportCSV = async () => {
    const response = await fetch(`${API_CONFIG.apiUrl}/api/teacher/tasks/${taskId}/export`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('xgpy_token')}` },
    });
    if (!response.ok) {
      alert('导出失败');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `任务成绩_${taskTitle}_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const completed = students.filter((s) => s.status === 'completed');
  const inProgress = students.filter((s) => s.status === 'in_progress');
  const notStarted = students.filter((s) => s.status === 'not_started');
  const avgScore = completed.length > 0
    ? Math.round(completed.reduce((sum, s) => sum + (s.score || 0), 0) / completed.length)
    : 0;

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = { completed: '已完成', in_progress: '进行中', not_started: '未开始' };
    return map[status] || status;
  };
  const getStatusStyle = (status: string) => {
    const map: Record<string, string> = {
      completed: 'bg-green-100 text-green-700',
      in_progress: 'bg-blue-100 text-blue-700',
      not_started: 'bg-gray-100 text-gray-500',
    };
    return map[status] || 'bg-gray-100 text-gray-500';
  };

  // 排序逻辑
  const handleSort = (field: 'name' | 'score' | 'status') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedStudents = [...students].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'name') {
      cmp = (a.real_name || a.username).localeCompare(b.real_name || b.username, 'zh-CN');
    } else if (sortField === 'score') {
      cmp = (a.score || 0) - (b.score || 0);
    } else if (sortField === 'status') {
      const orderMap = { not_started: 0, in_progress: 1, completed: 2 };
      cmp = (orderMap[a.status as keyof typeof orderMap] ?? 0) - (orderMap[b.status as keyof typeof orderMap] ?? 0);
    }
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  const getSortIcon = (field: 'name' | 'score' | 'status') => {
    if (sortField !== field) return <i className="fa-solid fa-sort text-gray-300 ml-1 text-xs"></i>;
    return <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'up' : 'down'} text-indigo-500 ml-1 text-xs`}></i>;
  };

  // 点击学生姓名查看详情
  const handleStudentClick = async (studentId: string) => {
    if (!analysisData) {
      await loadAnalysis();
    }
    const dataToUse = analysisData || (await new Promise<{ questions: AnalysisQuestion[]; students: AnalysisStudent[]; question_stats: QuestionStat[] } | null>((resolve) => {
      apiRequest<{ questions: AnalysisQuestion[]; students: AnalysisStudent[]; question_stats: QuestionStat[] }>(`/api/teacher/tasks/${taskId}/analysis`).then(({ data }) => resolve(data));
    }));
    if (dataToUse) {
      const student = dataToUse.students.find(s => s.student_id === studentId);
      if (student) setSelectedStudent(student);
    }
  };

  const getQuestionTypeLabel = (type: string) => {
    const map: Record<string, string> = { choice: '单选题', multiple_choice: '多选题', fill_blank: '填空题' };
    return map[type] || type;
  };

  const getCorrectRateColor = (rate: number) => {
    if (rate >= 80) return 'text-green-600';
    if (rate >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const getCorrectRateBg = (rate: number) => {
    if (rate >= 80) return 'bg-green-500';
    if (rate >= 50) return 'bg-amber-500';
    return 'bg-red-500';
  };

  // 清除HTML标签
  const stripHtml = (html: string) => {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, '').trim();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800">
              <i className="fa-solid fa-chart-bar mr-2 text-purple-500"></i>
              {taskTitle} - 学生数据
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">共 {students.length} 名学生</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm"
            >
              <i className="fa-solid fa-file-csv mr-1"></i>导出CSV
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="px-6 pt-3 flex gap-1 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('students')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'students' ? 'text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50/50' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fa-solid fa-users mr-1.5"></i>学生列表
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'analysis' ? 'text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50/50' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fa-solid fa-chart-pie mr-1.5"></i>题目正确率
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="px-6 py-4 grid grid-cols-4 gap-3 border-b border-gray-100">
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{completed.length}</div>
            <div className="text-xs text-gray-500 mt-1">已完成</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{inProgress.length}</div>
            <div className="text-xs text-gray-500 mt-1">进行中</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-500">{notStarted.length}</div>
            <div className="text-xs text-gray-500 mt-1">未开始</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-600">{avgScore}</div>
            <div className="text-xs text-gray-500 mt-1">平均分</div>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'students' && (
            <>
              {loading ? (
                <div className="flex items-center justify-center h-40">
                  <i className="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
                </div>
              ) : students.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <i className="fa-solid fa-users text-4xl mb-3"></i>
                  <p>暂无学生数据</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleSort('name')}>
                          学生姓名{getSortIcon('name')}
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">用户名</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleSort('status')}>
                          状态{getSortIcon('status')}
                        </th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleSort('score')}>
                          得分{getSortIcon('score')}
                        </th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">提交时间</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">观看时长</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {sortedStudents.map((s) => (
                        <tr key={s.student_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm">
                            <button
                              onClick={() => handleStudentClick(s.student_id)}
                              className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                            >
                              {s.real_name || s.username}
                              <i className="fa-solid fa-eye ml-1.5 text-xs text-gray-400"></i>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{s.username}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-1 rounded-full text-xs ${getStatusStyle(s.status)}`}>
                              {getStatusLabel(s.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-bold text-purple-600">{s.score ?? '-'}</td>
                          <td className="px-4 py-3 text-center text-sm text-gray-500">
                            {s.submitted_at ? formatDateTime(s.submitted_at) : '-'}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-500">{formatDuration(s.watch_duration)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === 'analysis' && (
            <>
              {analysisLoading ? (
                <div className="flex items-center justify-center h-40">
                  <i className="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
                </div>
              ) : !analysisData || analysisData.question_stats.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <i className="fa-solid fa-chart-pie text-4xl mb-3"></i>
                  <p>暂无题目数据</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 总体统计 */}
                  <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                    <div className="flex items-center gap-2 mb-3">
                      <i className="fa-solid fa-chart-line text-indigo-500"></i>
                      <span className="text-sm font-semibold text-gray-700">总体正确率</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-xl font-bold text-indigo-600">
                          {analysisData.question_stats.length > 0
                            ? Math.round(analysisData.question_stats.reduce((s, q) => s + q.correct_rate, 0) / analysisData.question_stats.length)
                            : 0}%
                        </div>
                        <div className="text-xs text-gray-500 mt-1">平均正确率</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xl font-bold text-green-600">
                          {analysisData.question_stats.filter(q => q.correct_rate >= 80).length}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">掌握良好(≥80%)</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xl font-bold text-red-600">
                          {analysisData.question_stats.filter(q => q.correct_rate < 50).length}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">需重点关注(&lt;50%)</div>
                      </div>
                    </div>
                  </div>

                  {/* 每题正确率列表 */}
                  <div className="space-y-3">
                    {analysisData.question_stats.map((q) => {
                      const fullQuestion = analysisData.questions.find(fq => fq.tq_id === q.tq_id);
                      return (
                        <div
                          key={q.tq_id}
                          onClick={() => fullQuestion && setSelectedQuestion(fullQuestion)}
                          className={`bg-white rounded-xl border border-gray-200 p-4 transition-all ${fullQuestion ? 'cursor-pointer hover:shadow-md hover:border-indigo-200' : ''}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-semibold">
                              {q.index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  q.type === 'fill_blank' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {getQuestionTypeLabel(q.type)}
                                </span>
                                <span className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-600 font-medium">
                                  {q.score} 分
                                </span>
                                <span className="text-xs text-gray-400">
                                  {q.correct_count}/{q.answered_count} 人答对
                                </span>
                                {fullQuestion && (
                                  <span className="text-xs text-indigo-500 ml-auto">
                                    <i className="fa-solid fa-eye mr-1"></i>查看详情
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-600 mb-3 line-clamp-2 leading-relaxed">
                                {stripHtml(q.content) || '（无内容）'}
                              </p>
                              {/* 正确率进度条 */}
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden relative">
                                  <div
                                    className={`h-full ${getCorrectRateBg(q.correct_rate)} transition-all duration-500 flex items-center justify-end pr-2`}
                                    style={{ width: `${Math.max(q.correct_rate, 8)}%` }}
                                  >
                                    {q.correct_rate >= 15 && (
                                      <span className="text-xs text-white font-bold">{q.correct_rate}%</span>
                                    )}
                                  </div>
                                  {q.correct_rate < 15 && (
                                    <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold ${getCorrectRateColor(q.correct_rate)}`}>
                                      {q.correct_rate}%
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-400 whitespace-nowrap">
                                  {q.answered_count}/{q.total_students} 已作答
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部 */}
        <div className="px-6 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            关闭
          </button>
        </div>
      </motion.div>

      {/* 学生答题详情弹窗 */}
      {selectedStudent && analysisData && (
        <StudentDetailModal
          student={selectedStudent}
          questions={analysisData.questions}
          taskTitle={taskTitle}
          onClose={() => setSelectedStudent(null)}
        />
      )}

      {/* 题目详情弹窗 */}
      {selectedQuestion && (
        <QuestionDetailModal
          question={selectedQuestion}
          onClose={() => setSelectedQuestion(null)}
        />
      )}
    </motion.div>
  );
};

// ============ 学生答题详情弹窗 ============
const StudentDetailModal: React.FC<{
  student: AnalysisStudent;
  questions: AnalysisQuestion[];
  taskTitle: string;
  onClose: () => void;
}> = ({ student, questions, taskTitle, onClose }) => {
  const getQuestionTypeLabel = (type: string) => {
    const map: Record<string, string> = { choice: '单选题', multiple_choice: '多选题', fill_blank: '填空题' };
    return map[type] || type;
  };

  const stripHtml = (html: string) => {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, '').trim();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-800">
              <i className="fa-solid fa-user-graduate mr-2 text-indigo-500"></i>
              {student.real_name || student.username} 的答题详情
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {taskTitle} · 得分 <span className="font-bold text-purple-600">{student.score}</span> 分
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* 题目列表 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {questions.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <i className="fa-solid fa-clipboard-question text-3xl mb-2"></i>
              <p>本任务暂无题目</p>
            </div>
          ) : (
            questions.map((q, idx) => {
              const result = student.question_results.find(r => r.tq_id === q.tq_id);
              const isCorrect = result?.is_correct;
              const isAnswered = result?.answered;
              const studentAnswer = result?.student_answer;
              const correctAnswers = q.correct_answers || [];

              return (
                <div key={q.tq_id} className={`rounded-xl border p-4 ${isCorrect ? 'border-green-200 bg-green-50/30' : isAnswered ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-gray-50/30'}`}>
                  {/* 题头 */}
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-semibold">
                      {idx + 1}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      q.type === 'fill_blank' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {getQuestionTypeLabel(q.type)}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-600 font-medium">
                      {q.score} 分
                    </span>
                    {isAnswered && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        <i className={`fa-solid ${isCorrect ? 'fa-check' : 'fa-xmark'} mr-1`}></i>
                        {isCorrect ? '正确' : '错误'}
                      </span>
                    )}
                    {!isAnswered && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                        未作答
                      </span>
                    )}
                  </div>

                  {/* 题干 */}
                  <div className="text-sm text-gray-700 leading-relaxed mb-3 question-rich-content">
                    <div dangerouslySetInnerHTML={{ __html: q.content || '' }} />
                  </div>

                  {/* 选项（非填空题） */}
                  {q.type !== 'fill_blank' && q.options && q.options.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {q.options.map((opt, oIdx) => {
                        const letter = String.fromCharCode(65 + oIdx);
                        const optText = stripHtml(opt);
                        const isCorrectOpt = correctAnswers.some(a => {
                          const aNorm = a.trim().toUpperCase();
                          return aNorm === letter || aNorm === optText.trim().toUpperCase() || a.trim() === opt.trim();
                        });
                        const isStudentChoice = studentAnswer && (
                          studentAnswer.toUpperCase().split(',').map(s => s.trim()).includes(letter) ||
                          studentAnswer.trim() === optText.trim()
                        );
                        return (
                          <div key={oIdx} className={`text-sm px-3 py-1.5 rounded-lg flex items-center gap-2 ${
                            isCorrectOpt ? 'bg-green-50 text-green-700' : isStudentChoice ? 'bg-red-50 text-red-700' : 'text-gray-600'
                          }`}>
                            <span className="font-medium">{letter}.</span>
                            <span>{optText}</span>
                            {isCorrectOpt && <i className="fa-solid fa-check text-green-500 ml-auto"></i>}
                            {isStudentChoice && !isCorrectOpt && <i className="fa-solid fa-xmark text-red-500 ml-auto"></i>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 学生答案 vs 正确答案 */}
                  <div className="space-y-2 mt-3 pt-3 border-t border-gray-100">
                    <div className="flex items-start gap-2 text-sm">
                      <span className="text-gray-500 font-medium whitespace-nowrap">学生答案：</span>
                      <span className={`flex-1 ${isCorrect ? 'text-green-600' : isAnswered ? 'text-red-600' : 'text-gray-400'}`}>
                        {isAnswered ? (studentAnswer || '(空)') : '未作答'}
                      </span>
                    </div>
                    {!isCorrect && (
                      <div className="flex items-start gap-2 text-sm">
                        <span className="text-gray-500 font-medium whitespace-nowrap">正确答案：</span>
                        <span className="flex-1 text-green-600">
                          {correctAnswers.join(' / ')}
                        </span>
                      </div>
                    )}
                    {q.explanation && (
                      <div className="flex items-start gap-2 text-sm">
                        <span className="text-gray-500 font-medium whitespace-nowrap">解析：</span>
                        <span className="flex-1 text-gray-500" dangerouslySetInnerHTML={{ __html: q.explanation }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部 */}
        <div className="px-5 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            关闭
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ============ 题目详情弹窗 ============
const QuestionDetailModal: React.FC<{
  question: AnalysisQuestion;
  onClose: () => void;
}> = ({ question, onClose }) => {
  const getQuestionTypeLabel = (type: string) => {
    const map: Record<string, string> = { choice: '单选题', multiple_choice: '多选题', fill_blank: '填空题' };
    return map[type] || type;
  };

  const stripHtml = (html: string) => {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, '').trim();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-semibold">
              {question.index + 1}
            </span>
            <div>
              <h3 className="text-base font-bold text-gray-800">题目详情</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {getQuestionTypeLabel(question.type)} · {question.score} 分
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 题干 */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-2 font-medium">题目内容</div>
            <div className="text-sm text-gray-700 leading-relaxed question-rich-content">
              <div dangerouslySetInnerHTML={{ __html: question.content || '' }} />
            </div>
          </div>

          {/* 选项 */}
          {question.type !== 'fill_blank' && question.options && question.options.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-3 font-medium">选项</div>
              <div className="space-y-2">
                {question.options.map((opt, oIdx) => {
                  const letter = String.fromCharCode(65 + oIdx);
                  const optText = stripHtml(opt);
                  const isCorrectOpt = question.correct_answers.some(a => {
                    const aNorm = a.trim().toUpperCase();
                    return aNorm === letter || aNorm === optText.trim().toUpperCase() || a.trim() === opt.trim();
                  });
                  return (
                    <div key={oIdx} className={`text-sm px-3 py-2 rounded-lg flex items-center gap-2 ${
                      isCorrectOpt ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-white text-gray-600 border border-gray-200'
                    }`}>
                      <span className="font-medium w-6">{letter}.</span>
                      <span className="flex-1">{optText}</span>
                      {isCorrectOpt && <i className="fa-solid fa-check-circle text-green-500"></i>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 正确答案 */}
          <div className="bg-green-50 rounded-xl p-4 border border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-check-circle text-green-500"></i>
              <span className="text-xs font-medium text-green-700">正确答案</span>
            </div>
            <div className="text-sm text-green-700 font-medium">
              {question.correct_answers && question.correct_answers.length > 0
                ? question.correct_answers.join(' / ')
                : '（无）'}
            </div>
          </div>

          {/* 解析 */}
          {question.explanation && (
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <i className="fa-solid fa-lightbulb text-blue-500"></i>
                <span className="text-xs font-medium text-blue-700">解析</span>
              </div>
              <div className="text-sm text-blue-700 question-rich-content">
                <div dangerouslySetInnerHTML={{ __html: question.explanation }} />
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="px-5 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            关闭
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TaskManager;
