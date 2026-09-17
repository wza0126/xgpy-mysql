import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_CONFIG } from '../../api/config';
import { sanitizeHtml } from '../../utils/htmlUtils';
import { useDesktopStore } from '../../store/desktopStore';
import { useAuth } from '../../hooks/useAuth';

// ============ 类型定义 ============

type ResourceType = 'pdf' | 'ppt' | 'word' | 'excel' | 'image' | 'video' | 'python' | 'zip' | 'html' | 'link' | 'access' | 'file';
type QuestionType = 'choice' | 'fill_blank' | 'multiple_choice';
type AccessType = 'public' | 'password';

interface TaskListItem {
  id: string;
  title: string;
  class_id: string;
  learning_objectives: string;
  deadline: string;
  start_time: string;
  status: number; // 0=未开始 1=进行中 2=已完成
  teacher_name: string;
  study_status?: string;
  study_total_score?: number;
  is_pinned?: number; // 1=置顶，置顶任务显示在列表最上方
}

interface Resource {
  id: string;
  type: ResourceType;
  title: string;
  file_path?: string;
  file_url?: string;
  url?: string;
  content?: string;
  html_content?: string;
  original_filename?: string;
}

interface Question {
  id: string;
  type: QuestionType;
  content: string;
  options?: string[] | string;
  answers?: string[] | string;
  score: number;
  explanation?: string;
  multiple?: boolean;
}

interface StudyLog {
  video_progress?: number | string;
  resources_viewed?: string[] | string;
  watch_duration?: number | string;
  status?: number;
  total_score?: number;
  answers?: any;
}

interface TaskDetail {
  id: string;
  title: string;
  learning_objectives: string;
  deadline: string;
  force_video_watch: boolean;
  min_study_duration?: number;
  access_type: AccessType;
  access_key?: string;
  /** 完成后是否允许查看解析与正确答案：0 隐藏 / 1 显示（默认显示） */
  show_answer?: number | boolean | null;
  resources: Resource[];
  questions: Question[];
  study_log: StudyLog;
}

interface SubmitResult {
  total_score: number;
  answers: { question_id: string; is_correct: boolean }[];
  /** 合格分数线（0 表示未设置合格奖励） */
  passing_score?: number;
  /** 本次是否达到合格分数线 */
  passed?: boolean;
  /** 任务设置的合格奖励积分 */
  reward_points?: number;
  /** 本次实际发放到账的积分（0 表示未发放或已发放过） */
  awarded_points?: number;
  /** 之前已领取过该任务的合格奖励 */
  already_rewarded?: boolean;
}

// ============ 工具函数 ============

const formatDuration = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return '0秒';
  if (seconds < 60) return `${seconds}秒`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}分${secs > 0 ? secs + '秒' : ''}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}小时${remMins > 0 ? remMins + '分' : ''}`;
};

// ============ API 辅助函数 ============

const getHeaders = (): HeadersInit => {
  const token = localStorage.getItem('xgpy_token');
  return {
    'Authorization': 'Bearer ' + (token || ''),
    'Content-Type': 'application/json',
  };
};

const apiGet = async <T,>(endpoint: string): Promise<{ data: T | null; error: string | null }> => {
  try {
    const response = await fetch(`${API_CONFIG.apiUrl}${endpoint}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: '网络请求失败' }));
      return { data: null, error: err.error || '请求失败' };
    }
    const result = await response.json();
    return { data: result.data as T, error: result.error || null };
  } catch (e: any) {
    return { data: null, error: e.message || '网络异常' };
  }
};

const apiPost = async <T,>(endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> => {
  try {
    const response = await fetch(`${API_CONFIG.apiUrl}${endpoint}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: '网络请求失败' }));
      return { data: null, error: err.error || '请求失败' };
    }
    const result = await response.json();
    return { data: result.data as T, error: result.error || null };
  } catch (e: any) {
    return { data: null, error: e.message || '网络异常' };
  }
};

// ============ 工具函数 ============

const parseJsonField = (field: any): any => {
  if (typeof field === 'string') {
    try {
      return JSON.parse(field);
    } catch {
      return field;
    }
  }
  return field;
};

const getOptions = (options: any): string[] => {
  const parsed = parseJsonField(options);
  if (Array.isArray(parsed)) return parsed;
  if (parsed?.options && Array.isArray(parsed.options)) return parsed.options;
  return [];
};

const getAnswers = (answers: any): string[] => {
  const parsed = parseJsonField(answers);
  let result = parsed?.answers || parsed;
  if (!Array.isArray(result)) {
    if (typeof result === 'string') return [result];
    return [];
  }
  return result.map((ans: any) => (ans?.toString() || ''));
};

// 计算任务显示状态（结合 status 和 deadline）
type DisplayStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';

const computeDisplayStatus = (task: TaskListItem): DisplayStatus => {
  if (task.status === 2) return 'completed';
  const now = Date.now();
  const deadline = new Date(task.deadline).getTime();
  if (deadline < now && task.status !== 2) return 'overdue';
  if (task.status === 1) return 'in_progress';
  return 'not_started';
};

const formatDateTime = (dt: string): string => {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return dt;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const truncate = (text: string, max: number): string => {
  if (!text) return '';
  // 去除 HTML 标签后截断
  const tmp = document.createElement('div');
  tmp.innerHTML = text;
  const plain = tmp.textContent || tmp.innerText || '';
  return plain.length > max ? plain.slice(0, max) + '...' : plain;
};

// ============ 状态徽章组件 ============

const StatusBadge: React.FC<{ status: DisplayStatus }> = ({ status }) => {
  const config: Record<DisplayStatus, { label: string; color: string; dot: string; icon: string }> = {
    not_started: { label: '未开始', color: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', icon: 'fa-circle' },
    in_progress: { label: '进行中', color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', icon: 'fa-spinner' },
    completed: { label: '已完成', color: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500', icon: 'fa-check-circle' },
    overdue: { label: '已逾期', color: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', icon: 'fa-clock' },
  };
  const c = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${c.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`}></span>
      {c.label}
    </span>
  );
};

// ============ 加载占位组件 ============

const LoadingView: React.FC<{ text?: string }> = ({ text = '加载中...' }) => (
  <div className="flex flex-col items-center justify-center h-full py-20">
    <i className="fa-solid fa-circle-notch fa-spin text-4xl text-indigo-500 mb-3"></i>
    <p className="text-gray-500 text-sm">{text}</p>
  </div>
);

const ErrorView: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex flex-col items-center justify-center h-full py-20">
    <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-3">
      <i className="fa-solid fa-triangle-exclamation text-3xl text-red-400"></i>
    </div>
    <p className="text-gray-600 mb-4">{message}</p>
    {onRetry && (
      <button onClick={onRetry} className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors text-sm">
        <i className="fa-solid fa-rotate-right mr-1"></i>重试
      </button>
    )}
  </div>
);

// ============ 任务列表视图 ============

interface TaskListViewProps {
  tasks: TaskListItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectTask: (taskId: string) => void;
}

const TaskListView: React.FC<TaskListViewProps> = ({ tasks, loading, error, onRetry, onSelectTask }) => {
  // 置顶任务优先，其余按时间倒序
  const sorted = [...tasks].sort((a, b) => {
    const pa = a.is_pinned ? 1 : 0;
    const pb = b.is_pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ta = new Date(a.start_time || a.deadline).getTime();
    const tb = new Date(b.start_time || b.deadline).getTime();
    return tb - ta;
  });

  if (loading) return <LoadingView text="正在加载课堂任务..." />;
  if (error) return <ErrorView message={error} onRetry={onRetry} />;

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* 页面标题 */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-11 h-11 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-200">
            <i className="fa-solid fa-clipboard-list text-white text-xl"></i>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">课堂任务</h1>
            <p className="text-sm text-gray-500">完成老师布置的学习任务与随堂练习</p>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-gray-50 flex items-center justify-center mb-4">
            <i className="fa-solid fa-inbox text-3xl text-gray-300"></i>
          </div>
          <p className="text-gray-500">暂无课堂任务</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {sorted.map((task, idx) => {
            const displayStatus = computeDisplayStatus(task);
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04, duration: 0.25 }}
              >
                <div
                  onClick={() => onSelectTask(task.id)}
                  className={`group bg-white rounded-2xl border p-5 cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-indigo-50 ${
                    task.is_pinned ? 'border-amber-200 ring-1 ring-amber-100 hover:border-amber-300' : 'border-gray-100 hover:border-indigo-200'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* 左侧图标 */}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                      displayStatus === 'completed'
                        ? 'bg-green-50 text-green-500'
                        : displayStatus === 'overdue'
                        ? 'bg-red-50 text-red-400'
                        : 'bg-indigo-50 text-indigo-500 group-hover:bg-indigo-100'
                    }`}>
                      <i className={`fa-solid ${displayStatus === 'completed' ? 'fa-check' : 'fa-book-open-reader'} text-lg`}></i>
                    </div>

                    {/* 中间内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {!!Number(task.is_pinned) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200">
                            <i className="fa-solid fa-thumbtack"></i>置顶
                          </span>
                        )}
                        <h3 className="text-base font-semibold text-gray-800 group-hover:text-indigo-600 transition-colors truncate">
                          {task.title}
                        </h3>
                        <StatusBadge status={displayStatus} />
                      </div>

                      {task.learning_objectives && (
                        <p className="text-sm text-gray-500 mb-2 line-clamp-2">
                          {truncate(task.learning_objectives, 80)}
                        </p>
                      )}

                      <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <i className="fa-solid fa-chalkboard-user"></i>
                          {task.teacher_name || '未知教师'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <i className="fa-solid fa-calendar-day"></i>
                          截止 {formatDateTime(task.deadline)}
                        </span>
                        {task.study_total_score !== undefined && task.study_total_score !== null && (
                          <span className="inline-flex items-center gap-1 text-amber-500">
                            <i className="fa-solid fa-star"></i>
                            得分 {task.study_total_score}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 右侧箭头 */}
                    <div className="flex items-center self-center text-gray-300 group-hover:text-indigo-400 transition-colors">
                      <i className="fa-solid fa-chevron-right"></i>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============ 资源查看器 ============

interface ResourceViewerProps {
  resource: Resource;
  videoProgress: number; // 0-100
  onVideoProgress: (current: number, duration: number) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  videoDuration: number;
  onVideoLoadedMetadata?: () => void;
}

const ResourceViewer: React.FC<ResourceViewerProps> = ({ resource, videoProgress, onVideoProgress, videoRef, videoDuration, onVideoLoadedMetadata }) => {
  const [pythonContent, setPythonContent] = useState<string>('');
  const [pythonLoading, setPythonLoading] = useState<boolean>(false);
  const [pythonError, setPythonError] = useState<string>('');

  const buildFileUrl = (path?: string): string => {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    // 标准化路径：反斜杠转正斜杠，确保以 /uploads/ 开头
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith('/uploads/') && !normalized.startsWith('uploads/')) {
      // 尝试提取 /uploads/ 部分
      const idx = normalized.indexOf('/uploads/');
      if (idx >= 0) normalized = normalized.substring(idx);
      else normalized = '/uploads/' + normalized.replace(/^\/+/, '');
    }
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    return `${API_CONFIG.apiUrl}${normalized}`;
  };

  // Python 代码行号渲染
  const renderPythonCode = (code: string) => {
    const lines = code.split('\n');
    return (
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-800 border-b border-gray-700">
          <span className="w-3 h-3 rounded-full bg-red-400"></span>
          <span className="w-3 h-3 rounded-full bg-amber-400"></span>
          <span className="w-3 h-3 rounded-full bg-green-400"></span>
          <span className="ml-2 text-xs text-gray-400 font-mono">python</span>
        </div>
        <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
          <code className="font-mono text-gray-100">
            {lines.map((line, i) => (
              <div key={i} className="flex">
                <span className="inline-block w-10 text-right pr-4 text-gray-500 select-none">{i + 1}</span>
                <span className="flex-1 whitespace-pre">{line || ' '}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    );
  };

  // 加载 Python 文件内容
  useEffect(() => {
    if (resource.type !== 'python') return;
    // 如果已有 content/html_content，直接使用
    if (resource.content || resource.html_content) {
      setPythonContent(resource.content || resource.html_content || '');
      return;
    }
    // 从文件路径加载
    const fileUrl = buildFileUrl(resource.file_url || resource.file_path);
    if (!fileUrl) {
      setPythonError('文件路径为空');
      return;
    }
    setPythonLoading(true);
    setPythonError('');
    fetch(fileUrl)
      .then(res => {
        if (!res.ok) throw new Error('加载失败: ' + res.status);
        return res.text();
      })
      .then(text => {
        setPythonContent(text);
        setPythonLoading(false);
      })
      .catch(err => {
        setPythonError(err.message || '加载失败');
        setPythonLoading(false);
      });
  }, [resource.id, resource.type, resource.content, resource.html_content, resource.file_url, resource.file_path]);

  const filePath = buildFileUrl(resource.file_url || resource.file_path);

  switch (resource.type) {
    case 'pdf':
      return (
        <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
          <iframe
            src={filePath}
            title={resource.title}
            className="w-full"
            style={{ height: 'calc(100vh - 200px)', minHeight: '600px' }}
          />
        </div>
      );

    case 'video':
      return (
        <div className="bg-black rounded-xl overflow-hidden">
          <video
            ref={videoRef}
            src={filePath}
            controls
            className="w-full"
            style={{ maxHeight: '70vh' }}
            onLoadedMetadata={onVideoLoadedMetadata}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              onVideoProgress(v.currentTime, v.duration);
            }}
          />
          {videoProgress > 0 && (
            <div className="px-4 py-2 bg-gray-900 text-xs text-gray-300 flex items-center gap-2">
              <i className="fa-solid fa-bookmark text-indigo-400"></i>
              上次观看进度：{videoProgress.toFixed(0)}%
              {videoDuration > 0 && (
                <span className="text-gray-500">
                  （{Math.floor(videoDuration / 60)}:{String(Math.floor(videoDuration % 60)).padStart(2, '0')} 处）
                </span>
              )}
            </div>
          )}
        </div>
      );

    case 'link':
      const linkUrl = resource.file_url || resource.url || filePath;
      return (
        <div className="bg-white rounded-xl overflow-hidden border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <i className="fa-solid fa-link text-indigo-500"></i>
              <span className="truncate max-w-md">{linkUrl}</span>
            </div>
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors text-xs font-medium"
            >
              <i className="fa-solid fa-up-right-from-square"></i>
              新窗口打开
            </a>
          </div>
          <iframe
            src={linkUrl}
            title={resource.title}
            className="w-full"
            style={{ height: '70vh', minHeight: '500px' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      );

    case 'image':
      return (
        <div className="bg-gray-50 rounded-xl overflow-hidden flex items-center justify-center p-4">
          <img src={filePath} alt={resource.title} className="max-w-full max-h-[70vh] rounded-lg" />
        </div>
      );

    case 'html':
      return (
        <div className="bg-white rounded-xl overflow-hidden border border-gray-200">
          <iframe
            srcDoc={resource.content || resource.html_content || ''}
            title={resource.title}
            sandbox="allow-scripts allow-same-origin allow-forms"
            className="w-full"
            style={{ height: '70vh', minHeight: '500px' }}
          />
        </div>
      );

    case 'python':
      if (pythonLoading) {
        return (
          <div className="bg-gray-50 rounded-xl p-10 text-center border border-gray-200">
            <i className="fa-solid fa-spinner fa-spin text-3xl text-gray-400 mb-3"></i>
            <p className="text-gray-500">正在加载 Python 文件...</p>
          </div>
        );
      }
      if (pythonError) {
        return (
          <div className="bg-red-50 rounded-xl p-10 text-center border border-red-200">
            <i className="fa-solid fa-triangle-exclamation text-3xl text-red-400 mb-3"></i>
            <p className="text-red-600 font-medium mb-1">加载失败</p>
            <p className="text-sm text-red-500 mb-4">{pythonError}</p>
            {filePath && (
              <a
                href={filePath}
                download
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm"
              >
                <i className="fa-solid fa-download"></i>下载查看
              </a>
            )}
          </div>
        );
      }
      return renderPythonCode(pythonContent);

    case 'ppt':
      return (
        <div className="bg-amber-50 rounded-xl p-10 text-center border border-amber-200">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <i className="fa-solid fa-file-powerpoint text-3xl text-amber-500"></i>
          </div>
          <p className="text-gray-700 font-medium mb-1">{resource.title}</p>
          <p className="text-sm text-gray-500 mb-4">PPT 文件请下载后查看</p>
          {filePath && (
            <a
              href={filePath}
              download
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm"
            >
              <i className="fa-solid fa-download"></i>下载查看
            </a>
          )}
        </div>
      );

    case 'word':
      return (
        <div className="bg-blue-50 rounded-xl p-10 text-center border border-blue-200">
          <div className="w-16 h-16 mx-auto rounded-full bg-blue-100 flex items-center justify-center mb-4">
            <i className="fa-solid fa-file-word text-3xl text-blue-500"></i>
          </div>
          <p className="text-gray-700 font-medium mb-1">{resource.title}</p>
          <p className="text-sm text-gray-500 mb-4">Word 文件请下载后查看</p>
          {filePath && (
            <a
              href={filePath}
              download
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
            >
              <i className="fa-solid fa-download"></i>下载查看
            </a>
          )}
        </div>
      );

    case 'zip':
      return (
        <div className="bg-purple-50 rounded-xl p-10 text-center border border-purple-200">
          <div className="w-16 h-16 mx-auto rounded-full bg-purple-100 flex items-center justify-center mb-4">
            <i className="fa-solid fa-file-zipper text-3xl text-purple-500"></i>
          </div>
          <p className="text-gray-700 font-medium mb-1">{resource.title}</p>
          <p className="text-sm text-gray-500 mb-4">压缩包文件</p>
          {filePath && (
            <a
              href={filePath}
              download
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm"
            >
              <i className="fa-solid fa-download"></i>下载
            </a>
          )}
        </div>
      );

    default:
      return (
        <div className="bg-gray-50 rounded-xl p-10 text-center border border-gray-200">
          <i className="fa-solid fa-file text-4xl text-gray-400 mb-3"></i>
          <p className="text-gray-500">不支持预览此资源类型</p>
          {filePath && (
            <a href={filePath} download className="mt-3 inline-block text-indigo-500 hover:underline text-sm">
              点击下载
            </a>
          )}
        </div>
      );
  }
};

// ============ 题目区域 ============

interface QuestionSectionProps {
  questions: Question[];
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, answer: string) => void;
  submitted: boolean;
  submitResult: SubmitResult | null;
  locked: boolean;
  onSubmit: () => void;
  submitting: boolean;
  /** 是否允许展示解析与正确答案（由任务设置 show_answer 控制） */
  showAnswer?: boolean;
}

const QuestionSection: React.FC<QuestionSectionProps> = ({
  questions,
  answers,
  onAnswerChange,
  submitted,
  submitResult,
  locked,
  onSubmit,
  submitting,
  showAnswer = true,
}) => {
  const getQuestionResult = (qid: string) => submitResult?.answers.find((a) => a.question_id === qid);

  const toggleMultiple = (qid: string, option: string, multiple: boolean) => {
    if (submitted) return;
    const current = answers[qid] || '';
    if (multiple) {
      const list = current.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const idx = list.indexOf(option);
      const newList = idx >= 0 ? list.filter((_, i) => i !== idx) : [...list, option];
      onAnswerChange(qid, newList.join(','));
    } else {
      onAnswerChange(qid, option);
    }
  };

  const allAnswered = questions.length > 0 && questions.every((q) => {
    const a = answers[q.id];
    return a && a.trim().length > 0;
  });

  return (
    <div className="relative">
      {/* 锁定遮罩 */}
      {locked && !submitted && (
        <div className="absolute inset-0 z-10 bg-gray-50/80 backdrop-blur-sm rounded-2xl flex items-center justify-center">
          <div className="text-center p-8 bg-white rounded-2xl shadow-lg border border-gray-100 max-w-sm">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-50 flex items-center justify-center mb-4">
              <i className="fa-solid fa-lock text-3xl text-amber-500"></i>
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">习题尚未开放</h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              请先观看视频资源至 <span className="font-semibold text-amber-600">90%</span> 以上，即可解锁随堂练习。
            </p>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {questions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            <i className="fa-solid fa-circle-question text-3xl text-gray-300 mb-2"></i>
            <p>本任务暂无随堂练习</p>
          </div>
        ) : (
          questions.map((q, idx) => {
            const options = getOptions(q.options);
            const userAnswer = answers[q.id] || '';
            const result = submitted ? getQuestionResult(q.id) : null;
            const correctAnswers = getAnswers(q.answers);
            const isMultiple = q.type === 'multiple_choice' || q.multiple === true;

            return (
              <div key={q.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                {/* 题头 */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-semibold">
                    {idx + 1}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    q.type === 'fill_blank' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {q.type === 'fill_blank' ? '填空题' : isMultiple ? '多选题' : '单选题'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-600 font-medium">
                    {q.score} 分
                  </span>
                  {submitted && result && (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      result.is_correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      <i className={`fa-solid ${result.is_correct ? 'fa-check' : 'fa-xmark'} mr-1`}></i>
                      {result.is_correct ? '正确' : '错误'}
                    </span>
                  )}
                </div>

                {/* 题干 */}
                <div className="text-gray-800 leading-relaxed mb-4 question-rich-content">
                  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.content) }} />
                </div>

                {/* 选项 */}
                {q.type !== 'fill_blank' && options.length > 0 && (
                  <div className="space-y-2.5">
                    {options.map((opt, oIdx) => {
                      const letter = String.fromCharCode(65 + oIdx);
                      const isSelected = isMultiple
                        ? userAnswer.split(',').map((s) => s.trim().toUpperCase()).includes(letter)
                        : userAnswer === letter;
                      const isCorrect = correctAnswers.some((a) => a.trim().toUpperCase() === letter);

                      let cls = 'border-gray-200 hover:border-indigo-300 bg-white';
                      if (submitted) {
                        if (showAnswer && isCorrect) cls = 'border-green-500 bg-green-50';
                        else if (showAnswer && isSelected && !isCorrect) cls = 'border-red-500 bg-red-50';
                        else if (isSelected) cls = 'border-indigo-500 bg-indigo-50';
                        else cls = 'border-gray-200 bg-white';
                      } else if (isSelected) {
                        cls = 'border-indigo-500 bg-indigo-50';
                      }

                      return (
                        <button
                          key={oIdx}
                          type="button"
                          disabled={submitted}
                          onClick={() => toggleMultiple(q.id, letter, isMultiple)}
                          className={`w-full p-3.5 rounded-xl border-2 text-left transition-all flex items-start gap-3 ${cls} ${submitted ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                            isSelected ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'
                          } ${submitted && showAnswer && isCorrect ? 'bg-green-500 text-white' : ''} ${submitted && showAnswer && isSelected && !isCorrect ? 'bg-red-500 text-white' : ''}`}>
                            {letter}
                          </span>
                          <span className="flex-1 text-sm text-gray-700 question-rich-content">
                            <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(opt) }} />
                          </span>
                          {submitted && showAnswer && isCorrect && (
                            <i className="fa-solid fa-check text-green-500 flex-shrink-0"></i>
                          )}
                          {submitted && showAnswer && isSelected && !isCorrect && (
                            <i className="fa-solid fa-xmark text-red-500 flex-shrink-0"></i>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 填空输入 */}
                {q.type === 'fill_blank' && (
                  <input
                    type="text"
                    value={userAnswer}
                    disabled={submitted}
                    onChange={(e) => onAnswerChange(q.id, e.target.value)}
                    placeholder="请输入答案"
                    className={`w-full px-4 py-3 border-2 rounded-xl text-sm focus:outline-none transition-colors ${
                      submitted
                        ? result?.is_correct
                          ? 'border-green-300 bg-green-50 text-gray-700'
                          : 'border-red-300 bg-red-50 text-gray-700'
                        : 'border-gray-200 focus:border-indigo-500'
                    }`}
                  />
                )}

                {/* 解析 */}
                {submitted && showAnswer && q.explanation && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2 mb-2">
                      <i className="fa-solid fa-lightbulb text-amber-400 text-sm"></i>
                      <span className="text-xs font-semibold text-gray-600">答案解析</span>
                    </div>
                    <div className="text-sm text-gray-600 leading-relaxed bg-amber-50/50 p-3 rounded-lg question-rich-content">
                      <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.explanation) }} />
                    </div>
                    {submitted && showAnswer && !result?.is_correct && correctAnswers.length > 0 && q.type !== 'fill_blank' && (
                      <div className="mt-2 text-xs text-green-600">
                        <i className="fa-solid fa-circle-check mr-1"></i>
                        正确答案：{correctAnswers.join(' / ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* 提交按钮 */}
        {!locked && questions.length > 0 && (
          <div className="sticky bottom-4 z-5">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-lg p-4 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                {submitted ? (
                  <span className="flex items-center gap-2">
                    <i className="fa-solid fa-flag-checkered text-green-500"></i>
                    已提交，得分：<span className="text-lg font-bold text-indigo-600">{submitResult?.total_score || 0}</span> 分
                  </span>
                ) : (
                  <span>
                    已答 <span className="font-semibold text-indigo-600">{Object.keys(answers).filter((k) => answers[k]?.trim()).length}</span> / {questions.length} 题
                  </span>
                )}
              </div>
              {!submitted ? (
                <button
                  onClick={onSubmit}
                  disabled={!allAnswered || submitting}
                  className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 text-sm"
                >
                  {submitting ? (
                    <>
                      <i className="fa-solid fa-circle-notch fa-spin"></i>提交中...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-paper-plane"></i>提交答案
                    </>
                  )}
                </button>
              ) : (
                <span className="px-4 py-2 bg-green-50 text-green-600 rounded-xl text-sm font-medium flex items-center gap-2">
                  <i className="fa-solid fa-check-circle"></i>已完成
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============ 任务详情视图 ============

interface TaskDetailViewProps {
  taskId: string;
  onBack: () => void;
}

const TaskDetailView: React.FC<TaskDetailViewProps> = ({ taskId, onBack }) => {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeResourceIdx, setActiveResourceIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0); // 百分比 0-100
  const [videoDuration, setVideoDuration] = useState(0);
  const [resourcesViewed, setResourcesViewed] = useState<string[]>([]);
  const [watchDuration, setWatchDuration] = useState(0);
  const [needPassword, setNeedPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  // 用于合格奖励到账后刷新顶栏积分显示
  const { refreshProfile } = useAuth();

  const isWindowMinimized = useDesktopStore(
    (state) => state.windows.find((w) => w.id === 'taskCenter')?.isMinimized ?? false
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 保证「练习开始」整场只上报一次
  const practiceReportedRef = useRef(false);
  const hasVideo = detail?.resources?.some((r) => r.type === 'video' || r.type === 'link') ?? false;
  const totalResources = detail?.resources?.length ?? 0;
  const viewedCount = resourcesViewed.length;
  // 只有一个资源时，学生没有可切换的对象（切换才触发"已查看"标记），
  // 因此只要资源已被加载展示，就直接视为已查看，避免永远无法开始练习。
  const singleResourceAutoViewed = totalResources === 1;
  const allResourcesViewed = totalResources > 0 && (viewedCount >= totalResources || singleResourceAutoViewed);
  const videoWatchedEnough = videoProgress >= 90;
  const minStudyDurationSec = (detail?.min_study_duration || 0) * 60;
  const studyDurationEnough = minStudyDurationSec <= 0 || watchDuration >= minStudyDurationSec;
  const hasMinStudyDuration = minStudyDurationSec > 0;

  // 计算习题是否锁定
  const calcQuestionLocked = (): boolean => {
    if (!detail || submitted) return false;
    let locked = false;
    let reason = '';
    // 强制视频观看
    if (detail.force_video_watch && hasVideo && !videoWatchedEnough) {
      locked = true;
    }
    // 最小学习时长 + 所有资源都查看
    if (hasMinStudyDuration) {
      if (!allResourcesViewed || !studyDurationEnough) {
        locked = true;
      }
    }
    return locked;
  };
  const questionLocked = calcQuestionLocked();

  // 加载任务详情
  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await apiGet<TaskDetail>(`/api/student/tasks/${taskId}`);
    if (error) {
      setError(error);
      setLoading(false);
      return;
    }
    if (data) {
      // 后端返回 { task, resources, questions, study_log }，需展平 task 字段
      const raw = data as any;
      const taskData = raw.task || raw;
      const flatDetail: TaskDetail = {
        ...taskData,
        resources: raw.resources || [],
        questions: raw.questions || [],
        study_log: raw.study_log || null,
      } as TaskDetail;
      // 密码访问校验
      if (flatDetail.access_type === 'password' && flatDetail.access_key) {
        setNeedPassword(true);
      }
      setDetail(flatDetail);
      // 恢复视频进度
      if (flatDetail.study_log?.video_progress) {
        const vp = flatDetail.study_log.video_progress;
        setVideoProgress(typeof vp === 'number' ? vp : (typeof vp === 'string' ? parseFloat(vp) : 0));
      }
      if (flatDetail.study_log?.resources_viewed) {
        const rv = flatDetail.study_log.resources_viewed;
        try {
          const parsed = typeof rv === 'string' ? JSON.parse(rv) : rv;
          setResourcesViewed(Array.isArray(parsed) ? parsed : []);
        } catch {
          setResourcesViewed([]);
        }
      }
      if (flatDetail.study_log?.watch_duration) {
        setWatchDuration(Number(flatDetail.study_log.watch_duration) || 0);
      }
      // 恢复已提交状态
      if (flatDetail.study_log?.status === 2) {
        setSubmitted(true);
        setSubmitResult({
          total_score: flatDetail.study_log.total_score || 0,
          answers: [],
        });
        // 恢复答案
        if (flatDetail.study_log.answers) {
          try {
            const savedAnswers = typeof flatDetail.study_log.answers === 'string'
              ? JSON.parse(flatDetail.study_log.answers)
              : flatDetail.study_log.answers;
            const restored: Record<string, string> = {};
            if (Array.isArray(savedAnswers)) {
              savedAnswers.forEach((a: any) => {
                if (a.question_id && a.answer) restored[a.question_id] = a.answer;
              });
            }
            setAnswers(restored);
          } catch {}
        }
      }
      // 默认选中第一个资源
      if (flatDetail.resources && flatDetail.resources.length > 0) {
        setActiveResourceIdx(0);
      }
    }
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // 切换任务时重置「练习开始」上报标记
  useEffect(() => {
    practiceReportedRef.current = false;
  }, [taskId]);

  // 只有一个资源时自动标记为已查看（无需切换资源即可标记），并上报一次
  useEffect(() => {
    if (!detail) return;
    if (totalResources !== 1) return;
    const rid = detail.resources[0]?.id;
    if (rid) markResourceViewed(String(rid));
  }, [detail, totalResources]);

  // 学习进度自动上报（每 5 秒）
  // 说明：原来只在有视频时上报，导致"纯图文资源"任务的已查看/学习时长无法保存，
  // 现改为只要任务存在可学习内容就上报。
  useEffect(() => {
    if (!detail || (totalResources === 0 && !hasVideo)) return;
    progressTimerRef.current = setInterval(async () => {
      if (videoProgress > 0 || resourcesViewed.length > 0 || watchDuration > 0) {
        await apiPost(`/api/student/tasks/${taskId}/progress`, {
          video_progress: videoProgress,
          resources_viewed: resourcesViewed,
          watch_duration: watchDuration,
        });
      }
    }, 5000);
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [detail, hasVideo, totalResources, videoProgress, resourcesViewed, watchDuration, taskId]);

  // 观看时长累计（页面隐藏或窗口最小化时暂停）
  useEffect(() => {
    if (!detail) return;

    const startTimer = () => {
      if (watchTimerRef.current) clearInterval(watchTimerRef.current);
      watchTimerRef.current = setInterval(() => {
        setWatchDuration((prev) => prev + 1);
      }, 1000);
    };

    const stopTimer = () => {
      if (watchTimerRef.current) {
        clearInterval(watchTimerRef.current);
        watchTimerRef.current = null;
      }
    };

    const shouldRun = !document.hidden && !isWindowMinimized;
    if (shouldRun) {
      startTimer();
    } else {
      stopTimer();
    }

    const handleVisibilityChange = () => {
      if (document.hidden || isWindowMinimized) {
        stopTimer();
      } else {
        startTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopTimer();
    };
  }, [detail, isWindowMinimized]);

  // 视频加载后跳转到上次位置
  const handleVideoLoadedMetadata = () => {
    if (videoRef.current && videoProgress > 0 && videoProgress < 100) {
      const duration = videoRef.current.duration;
      if (duration && !isNaN(duration)) {
        videoRef.current.currentTime = (videoProgress / 100) * duration;
        setVideoDuration(duration);
      }
    }
  };

  // 视频时间更新
  const handleVideoTimeUpdate = (current: number, duration: number) => {
    if (duration && !isNaN(duration) && duration > 0) {
      setVideoDuration(duration);
      const pct = Math.min(100, (current / duration) * 100);
      // 只增不减
      setVideoProgress((prev) => (pct > prev ? pct : prev));
    }
  };

  // 标记资源已查看
  const markResourceViewed = (rid: string) => {
    setResourcesViewed((prev) => (prev.includes(rid) ? prev : [...prev, rid]));
  };

  // 切换资源
  const switchResource = (idx: number) => {
    setActiveResourceIdx(idx);
    const r = detail?.resources[idx];
    if (r) markResourceViewed(r.id);
  };

  // 提交答案
  const handleSubmit = async () => {
    if (!detail || submitting) return;
    setSubmitting(true);
    const answerList = Object.entries(answers).map(([question_id, answer]) => ({ question_id, answer }));
    const { data, error } = await apiPost<SubmitResult>(`/api/student/tasks/${taskId}/submit`, { answers: answerList });
    setSubmitting(false);
    if (error) {
      alert(error);
      return;
    }
    if (data) {
      setSubmitResult(data);
      setSubmitted(true);
      // 合格奖励到账后刷新个人信息（顶栏积分显示同步）
      if (data.awarded_points && data.awarded_points > 0) {
        try {
          await refreshProfile();
        } catch {}
      }
      // 提交完成后保存最终进度
      await apiPost(`/api/student/tasks/${taskId}/progress`, {
        video_progress: videoProgress,
        resources_viewed: resourcesViewed,
        watch_duration: watchDuration,
      });
    }
  };

  // 学生首次作答随堂练习时上报一次「练习开始」，
  // 教师端「学生数据 → 学生列表」据此把状态判定为「练习中」。
  // 只在整场第一次真正填写答案时触发（清空答案不算），后续不再重复上报。
  const handleAnswerChange = (qid: string, ans: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: ans }));
    if (practiceReportedRef.current) return;
    if (!(ans || '').trim()) return;
    practiceReportedRef.current = true;
    apiPost(`/api/student/tasks/${taskId}/progress`, { practice_started: true });
  };

  // 密码校验
  const handlePasswordSubmit = () => {
    if (detail?.access_key && passwordInput.trim() === detail.access_key) {
      setNeedPassword(false);
      setPasswordError('');
    } else {
      setPasswordError('访问密码错误');
    }
  };

  if (loading) return <LoadingView text="正在加载任务详情..." />;
  if (error) return <ErrorView message={error} onRetry={loadDetail} />;
  if (!detail) return <ErrorView message="任务不存在" onRetry={onBack} />;

  // 密码访问界面
  if (needPassword) {
    return (
      <div className="max-w-md mx-auto p-6 mt-10">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <i className="fa-solid fa-key text-3xl text-indigo-500"></i>
          </div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">需要访问密码</h2>
          <p className="text-sm text-gray-500 mb-4">该任务需要密码才能查看，请输入老师提供的密码</p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
            placeholder="请输入访问密码"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none text-center"
            autoFocus
          />
          {passwordError && <p className="text-sm text-red-500 mt-2">{passwordError}</p>}
          <div className="flex gap-3 mt-4">
            <button onClick={onBack} className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors text-sm">
              返回
            </button>
            <button onClick={handlePasswordSubmit} className="flex-1 px-4 py-2.5 bg-indigo-500 text-white rounded-xl hover:bg-indigo-600 transition-colors text-sm">
              确认
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentResource = detail.resources[activeResourceIdx];

  return (
    <div className="w-full mx-auto p-6 pb-32">
      {/* A. 顶部区域 */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 transition-colors mb-4"
        >
          <i className="fa-solid fa-arrow-left"></i>
          返回任务列表
        </button>

        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-100">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <i className="fa-solid fa-book-open text-xl"></i>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold mb-2 break-words">{detail.title}</h1>
              <div className="flex items-center gap-4 text-sm text-white/80 flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <i className="fa-solid fa-calendar-day"></i>
                  截止 {formatDateTime(detail.deadline)}
                </span>
                {detail.force_video_watch && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                    <i className="fa-solid fa-video"></i>
                    强制观看
                  </span>
                )}
                {hasMinStudyDuration && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                    <i className="fa-solid fa-clock"></i>
                    限时学习 {detail.min_study_duration}分钟
                  </span>
                )}
                {hasMinStudyDuration && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                    <i className="fa-solid fa-stopwatch"></i>
                    已学习 {formatDuration(watchDuration)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {detail.learning_objectives && (
            <div className="mt-4 pt-4 border-t border-white/20">
              <div className="flex items-center gap-2 mb-2">
                <i className="fa-solid fa-bullseye text-white/80 text-sm"></i>
                <span className="text-sm font-medium text-white/90">学习目标</span>
              </div>
              <div className="text-sm text-white/90 leading-relaxed question-rich-content">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(detail.learning_objectives) }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* B. 资源浏览区 */}
      {detail.resources.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-500 flex items-center justify-center">
              <i className="fa-solid fa-folder-open text-sm"></i>
            </div>
            <h2 className="text-base font-semibold text-gray-800">学习资源</h2>
            <span className="text-sm text-gray-400">{detail.resources.length} 个资源</span>
          </div>

          {/* 资源切换标签 */}
          {detail.resources.length > 1 && (
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {detail.resources.map((r, idx) => {
                const viewed = resourcesViewed.includes(r.id);
                const iconMap: Record<ResourceType, string> = {
                  pdf: 'fa-file-pdf', ppt: 'fa-file-powerpoint', word: 'fa-file-word',
                  image: 'fa-image', video: 'fa-video', python: 'fa-code',
                  zip: 'fa-file-zipper', html: 'fa-file-code', link: 'fa-link',
                };
                return (
                  <button
                    key={r.id}
                    onClick={() => switchResource(idx)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-all border ${
                      activeResourceIdx === idx
                        ? 'bg-indigo-500 text-white border-indigo-500 shadow-md shadow-indigo-100'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    <i className={`fa-solid ${iconMap[r.type] || 'fa-file'}`}></i>
                    {r.title}
                    {viewed && (
                      <i className={`fa-solid fa-check-circle text-xs ${activeResourceIdx === idx ? 'text-white/80' : 'text-green-400'}`}></i>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* 当前资源内容 */}
          {currentResource && (
            <ResourceViewer
              resource={currentResource}
              videoProgress={videoProgress}
              videoDuration={videoDuration}
              onVideoProgress={handleVideoTimeUpdate}
              videoRef={videoRef}
              onVideoLoadedMetadata={handleVideoLoadedMetadata}
            />
          )}
        </div>
      )}

      {/* C. 随堂练习区 */}
      <div>
        {/* 解锁条件提示 */}
        {(detail.force_video_watch || hasMinStudyDuration) && (
          <div className={`mb-4 p-4 rounded-xl transition-colors ${
            questionLocked ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-green-50 text-green-700 border border-green-200'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <i className={`fa-solid ${questionLocked ? 'fa-circle-info' : 'fa-circle-check'} text-lg`}></i>
              <span className="font-semibold text-sm">
                {questionLocked ? '完成以下条件即可解锁随堂练习' : '所有条件已达成，习题已解锁'}
              </span>
            </div>
            <div className="space-y-3">
              {detail.force_video_watch && hasVideo && (
                <div className="flex items-center gap-3">
                  <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border-2 ${videoWatchedEnough ? 'bg-green-500 border-green-500 text-white' : 'border-amber-400 text-amber-400'}`}>
                    {videoWatchedEnough ? <i className="fa-solid fa-check text-xs"></i> : '1'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>视频观看进度（需达到 90%）</span>
                      <span className="font-bold">{videoProgress.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-white/80 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${videoWatchedEnough ? 'bg-green-500' : 'bg-amber-400'}`}
                        style={{ width: `${Math.min(100, videoProgress)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
              {hasMinStudyDuration && (
                <div className="flex items-center gap-3">
                  <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border-2 ${studyDurationEnough ? 'bg-green-500 border-green-500 text-white' : 'border-amber-400 text-amber-400'}`}>
                    {studyDurationEnough ? <i className="fa-solid fa-check text-xs"></i> : (detail.force_video_watch && hasVideo ? '2' : '1')}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>学习时长（需达到 {detail.min_study_duration} 分钟）</span>
                      <span className="font-bold">
                        {formatDuration(watchDuration)} / {detail.min_study_duration}分钟
                      </span>
                    </div>
                    <div className="h-2 bg-white/80 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${studyDurationEnough ? 'bg-green-500' : 'bg-amber-400'}`}
                        style={{ width: `${Math.min(100, (watchDuration / minStudyDurationSec) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
              {hasMinStudyDuration && totalResources > 0 && (
                <div className="flex items-center gap-3">
                  <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border-2 ${allResourcesViewed ? 'bg-green-500 border-green-500 text-white' : 'border-amber-400 text-amber-400'}`}>
                    {allResourcesViewed ? <i className="fa-solid fa-check text-xs"></i> : (detail.force_video_watch && hasVideo ? '3' : '2')}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs">
                      <span>查看所有学习资源</span>
                      <span className="font-bold">{viewedCount} / {totalResources} 个</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs mt-3 opacity-75">
              <i className="fa-solid fa-lightbulb mr-1"></i>
              切换页面或最小化窗口时，学习计时会自动暂停。关闭窗口或刷新页面会重置学习进度。
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-500 flex items-center justify-center">
            <i className="fa-solid fa-pen-to-square text-sm"></i>
          </div>
          <h2 className="text-base font-semibold text-gray-800">随堂练习</h2>
          <span className="text-sm text-gray-400">
            {detail.questions.length} 题 · 共 {detail.questions.reduce((s, q) => s + (q.score || 0), 0)} 分
          </span>
        </div>

        <QuestionSection
          questions={detail.questions}
          answers={answers}
          onAnswerChange={handleAnswerChange}
          submitted={submitted}
          submitResult={submitResult}
          locked={questionLocked}
          onSubmit={handleSubmit}
          submitting={submitting}
          showAnswer={detail.show_answer === undefined || detail.show_answer === null ? true : Number(detail.show_answer) !== 0}
        />
      </div>

      {/* D. 底部完成状态 */}
      {submitted && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-6 text-center"
        >
          <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-3">
            <i className="fa-solid fa-trophy text-3xl text-green-500"></i>
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-1">任务已完成</h3>
          <p className="text-sm text-gray-600">
            本次得分：<span className="text-xl font-bold text-green-600">{submitResult?.total_score || 0}</span> 分
          </p>
          {/* 合格奖励反馈 */}
          {submitResult && (submitResult.awarded_points ?? 0) > 0 && (
            <div className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-amber-100 border border-amber-300 rounded-xl text-amber-700 text-sm font-medium">
              <i className="fa-solid fa-gift"></i>
              恭喜达标，获得 {submitResult.awarded_points} 积分奖励！
            </div>
          )}
          {submitResult && (submitResult.awarded_points ?? 0) === 0 && submitResult.passed === true && submitResult.already_rewarded && (
            <p className="mt-3 text-xs text-gray-500">
              <i className="fa-solid fa-circle-info mr-1"></i>
              合格奖励已领取过，本次不再重复发放积分
            </p>
          )}
          {submitResult && (submitResult.passed === false) && (submitResult.passing_score ?? 0) > 0 && (submitResult.reward_points ?? 0) > 0 && (
            <p className="mt-3 text-xs text-amber-600">
              <i className="fa-solid fa-circle-exclamation mr-1"></i>
              未达到 {submitResult.passing_score} 分合格线，未获得 {submitResult.reward_points} 积分奖励
            </p>
          )}
          <button
            onClick={onBack}
            className="mt-4 px-6 py-2.5 bg-white text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm border border-gray-200"
          >
            返回任务列表
          </button>
        </motion.div>
      )}

    </div>
  );
};

// ============ 防切屏提醒组件 ============

const LeaveWarningModal: React.FC<{ visible: boolean; leaveCount: number; onClose: () => void }> = ({ visible, leaveCount, onClose }) => (
  <AnimatePresence>
    {visible && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center"
        >
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 flex items-center justify-center mb-4">
            <i className="fa-solid fa-triangle-exclamation text-3xl text-red-500"></i>
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">请勿离开课堂任务页面</h3>
          <p className="text-sm text-gray-500 mb-2">离开页面可能会影响你的学习记录</p>
          {leaveCount > 0 && (
            <p className="text-xs text-red-500 mb-4">已离开次数：{leaveCount}</p>
          )}
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-indigo-500 text-white rounded-xl hover:bg-indigo-600 transition-colors text-sm font-medium"
          >
            我知道了，返回继续学习
          </button>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

// ============ 主组件 ============

export const TaskCenter: React.FC = () => {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [showLeaveWarning, setShowLeaveWarning] = useState(false);
  const [leaveCount, setLeaveCount] = useState(0);

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await apiGet<TaskListItem[]>('/api/student/tasks');
    if (error) {
      setError(error);
    } else if (data) {
      setTasks(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // 防切屏监听（仅在详情页生效）
  useEffect(() => {
    if (view !== 'detail') return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setLeaveCount((prev) => prev + 1);
        setShowLeaveWarning(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [view]);

  // 进入任务详情
  const handleSelectTask = (taskId: string) => {
    setCurrentTaskId(taskId);
    setView('detail');
    setLeaveCount(0);
  };

  // 返回列表
  const handleBack = () => {
    setView('list');
    setCurrentTaskId(null);
    setShowLeaveWarning(false);
    // 刷新列表（更新状态）
    loadTasks();
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <AnimatePresence mode="wait">
        {view === 'list' ? (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <TaskListView
              tasks={tasks}
              loading={loading}
              error={error}
              onRetry={loadTasks}
              onSelectTask={handleSelectTask}
            />
          </motion.div>
        ) : (
          <motion.div
            key="detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {currentTaskId && (
              <TaskDetailView
                taskId={currentTaskId}
                onBack={handleBack}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <LeaveWarningModal
        visible={showLeaveWarning}
        leaveCount={leaveCount}
        onClose={() => setShowLeaveWarning(false)}
      />
    </div>
  );
};

export default TaskCenter;
