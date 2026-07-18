import React, { useState, useEffect } from 'react';
import { backendClient } from '../../api/backendClient';
import { useAuth } from '../../hooks/useAuth';
import { LatexRenderer } from '../common/LatexRenderer';

interface PythonTask {
  id: string;
  title: string;
  description?: string;
  task_type: string;
  class_ids?: string[];
  total_score: number;
  deadline?: string;
  allow_late_submission: boolean;
  allow_run_code: boolean;
  reference_code?: string;
  expected_output?: string;
  hint?: string;
  required_keywords?: string[];
  blank_template?: string;
  blank_answers?: string[][];
  blank_weights?: number[];
  is_active: boolean;
  created_at: string;
}

interface Submission {
  id: string;
  student_id: string;
  username?: string;
  real_name?: string;
  student_class_id?: string;
  code: string;
  submitted_at: string;
  status: string;
  grading?: Grading;
}

interface Grading {
  id: string;
  total_score: number;
  syntax_score: number;
  output_score: number;
  logic_score: number;
  comment?: string;
  is_ai_graded?: boolean;
  manually_adjusted: boolean;
}

export const PythonManager: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'tasks' | 'create'>('tasks');
  const [taskFilter, setTaskFilter] = useState<'all' | 'code' | 'fill_blank'>('all');
  const [tasks, setTasks] = useState<PythonTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<PythonTask | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<Partial<PythonTask>>({
    title: '',
    description: '',
    task_type: 'code',
    class_ids: [] as string[],
    total_score: 100,
    is_active: true,
    allow_late_submission: false,
    allow_run_code: true,
    hint: '',
    reference_code: '',
    expected_output: '',
    required_keywords: [],
    blank_template: '',
    blank_answers: [] as string[][],
    blank_weights: [] as number[]
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classFilter, setClassFilter] = useState<string>('');
  const [submissionsPage, setSubmissionsPage] = useState(1);
  const SUBMISSIONS_PER_PAGE = 100;
  const [sortBy, setSortBy] = useState<'username' | 'score'>('username');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedSubmissions, setSelectedSubmissions] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState<string>('');
  const [showUnsubmitted, setShowUnsubmitted] = useState(false);
  const [unsubmittedStudents, setUnsubmittedStudents] = useState<{ id: string; username: string; real_name?: string }[]>([]);
  const [exportClassId, setExportClassId] = useState<string>('');

  useEffect(() => {
    loadData();
    loadClasses();
  }, []);

  const loadData = async () => {
    try {
      const res = await backendClient.get('/api/python/teacher/tasks');
      const tasks = res.data || [];
      setTasks(tasks);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClasses = async () => {
    try {
      const res = await backendClient.get('/api/classes');
      const classList = res.data || [];
      setClasses(classList);
    } catch (error) {
      console.error('Failed to load classes:', error);
    }
  };

  const normalizeSubmission = (sub: any): Submission => {
    if (!sub.id || sub.id === 'null') {
      sub = { ...sub, id: sub.student_id || `fallback_${Date.now()}` };
    }
    // 如果已有嵌套 grading，直接返回
    if (sub.grading) return sub;
    // 如果有扁平 grading 字段，转换为嵌套格式
    if (sub.grading_id != null) {
      const grading: Grading = {
        id: sub.grading_id,
        total_score: sub.grade_score ?? sub.total_score ?? 0,
        syntax_score: sub.syntax_score ?? 0,
        output_score: sub.output_score ?? 0,
        logic_score: sub.logic_score ?? 0,
        comment: sub.comment || '',
        is_ai_graded: sub.is_ai_graded,
        manually_adjusted: sub.manually_adjusted || false,
      };
      delete sub.grading_id;
      delete sub.grade_score;
      delete sub.syntax_score;
      delete sub.output_score;
      delete sub.logic_score;
      delete sub.comment;
      delete sub.is_ai_graded;
      delete sub.manually_adjusted;
      delete sub.show_reference_code;
      delete sub.syntax_errors;
      delete sub.output_diff;
      delete sub.missing_keywords;
      delete sub.graded_at;
      return { ...sub, grading };
    }
    return sub;
  };

  const viewTask = async (task: PythonTask) => {
    setSelectedTask(task);
    setActiveTab('tasks');
    setLoading(true);
    try {
      const baseUrl = classFilter
        ? `/api/python/teacher/submissions/${task.id}?class_id=${classFilter}`
        : `/api/python/teacher/submissions/${task.id}`;
      const separator = baseUrl.includes('?') ? '&' : '?';
      const url = `${baseUrl}${separator}_t=${Date.now()}`;
      const res = await backendClient.get(url);
      const data = (res.data || []).map(normalizeSubmission);
      setSubmissions(data);
      setSubmissionsPage(1);
    } catch (error) {
      console.error('Failed to load submissions:', error);
      alert('加载提交记录失败，请刷新页面重试');
    } finally {
      setLoading(false);
    }
  };

  const parseJsonField = (val: any): any[] => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string' && val) {
      try { return JSON.parse(val); } catch { return []; }
    }
    return [];
  };

  const editTask = (task: PythonTask) => {
    const blankAnswers = parseJsonField(task.blank_answers);
    const blankWeights = parseJsonField(task.blank_weights);
    const requiredKeywords = parseJsonField(task.required_keywords);
    setFormData({ ...task, blank_answers: blankAnswers, blank_weights: blankWeights, required_keywords: requiredKeywords });
    setKeywordInput(requiredKeywords.join(', '));
    setEditingId(task.id);
    setActiveTab('create');
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm('确定要删除这个任务吗？\n关联的所有作业提交和批改记录也将被删除。')) return;
    try {
      await backendClient.delete(`/api/python/teacher/tasks/${taskId}`);
      await loadData();
    } catch (error: any) {
      alert(`删除失败: ${error.message}`);
    }
  };

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTasks(prev => 
      prev.includes(taskId) 
        ? prev.filter(id => id !== taskId)
        : [...prev, taskId]
    );
  };

  const selectAllTasks = () => {
    if (selectedTasks.length === tasks.length) {
      setSelectedTasks([]);
    } else {
      setSelectedTasks(tasks.map(t => t.id));
    }
  };

  const deleteSelectedTasks = async () => {
    if (!confirm(`确定要删除选中的 ${selectedTasks.length} 个任务吗？\n关联的所有作业提交和批改记录也将被删除。`)) return;
    try {
      for (const taskId of selectedTasks) {
        await backendClient.delete(`/api/python/teacher/tasks/${taskId}`);
      }
      setSelectedTasks([]);
      await loadData();
      setSelectedTask(null);
    } catch (error: any) {
      alert(`删除失败: ${error.message}`);
    }
  };

  const toggleActive = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      await backendClient.put(`/api/python/teacher/tasks/${taskId}`, { is_active: !task.is_active });
      await loadData();
    } catch (error: any) {
      alert(`操作失败: ${error.message}`);
    }
  };

  const saveTask = async () => {
    if (!formData.title) {
      alert('请输入任务标题');
      return;
    }

    try {
      const dataToSave = {
        ...formData,
        required_keywords: keywordInput.split(',').map(k => k.trim()).filter(Boolean)
      };
      console.log('Saving task with data:', dataToSave);
      if (editingId) {
        const res = await backendClient.put(`/api/python/teacher/tasks/${editingId}`, dataToSave);
        console.log('Update response:', res);
        alert('任务修改成功！');
      } else {
        const res = await backendClient.post('/api/python/teacher/tasks', dataToSave);
        console.log('Create response:', res);
        alert('任务创建成功！');
      }
      setFormData({
        title: '',
        description: '',
        task_type: 'code',
        class_ids: [],
        total_score: 100,
        is_active: true,
        allow_late_submission: false,
        allow_run_code: true,
        hint: '',
        reference_code: '',
        expected_output: '',
        required_keywords: [],
        blank_template: '',
        blank_answers: [],
        blank_weights: []
      });
      setKeywordInput('');
      setEditingId(null);
      setActiveTab('tasks');
      await loadData();
    } catch (error: any) {
      alert(`保存失败: ${error.message}`);
    }
  };

  const gradeSubmission = async (submissionId: string) => {
    if (!submissionId || submissionId === 'null' || submissionId === 'undefined') {
      alert('提交记录ID无效，请刷新页面后重试');
      return;
    }
    if (!confirm('确定要AI批改这个作业吗？')) return;
    try {
      await backendClient.post(`/api/python/teacher/grade/${submissionId}`);
      if (selectedTask) {
        await viewTask(selectedTask);
      }
    } catch (error: any) {
      alert(`批改失败: ${error.message}`);
    }
  };

  const gradeAllSubmissions = async () => {
    if (!selectedTask) return;
    if (!confirm('确定要批量AI批改所有作业吗？')) return;
    try {
      await backendClient.post(`/api/python/teacher/grade-task/${selectedTask.id}`);
      await viewTask(selectedTask);
      alert('批量批改完成！');
    } catch (error: any) {
      alert(`批改失败: ${error.message}`);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const toggleSort = (field: 'username' | 'score') => {
    if (sortBy === field) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const sortedSubmissions = [...submissions].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'username') {
      cmp = (a.username || '').localeCompare(b.username || '');
    } else {
      const scoreA = a.grading?.total_score ?? -1;
      const scoreB = b.grading?.total_score ?? -1;
      cmp = scoreA - scoreB;
    }
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sortedSubmissions.length / SUBMISSIONS_PER_PAGE));
  const paginatedSubmissions = sortedSubmissions.slice(
    (submissionsPage - 1) * SUBMISSIONS_PER_PAGE,
    submissionsPage * SUBMISSIONS_PER_PAGE
  );

  const toggleSubmissionSelection = (id: string) => {
    setSelectedSubmissions(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const toggleSelectAllSubmissions = () => {
    if (selectedSubmissions.length === sortedSubmissions.length) {
      setSelectedSubmissions([]);
    } else {
      setSelectedSubmissions(sortedSubmissions.map(s => s.id));
    }
  };

  const deleteSelectedSubmissions = async () => {
    if (selectedSubmissions.length === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedSubmissions.length} 个提交吗？\n删除后学生可以重新提交作业。`)) return;
    try {
      await backendClient.post('/api/python/teacher/delete-submissions', {
        submission_ids: selectedSubmissions
      });
      setSelectedSubmissions([]);
      if (selectedTask) await viewTask(selectedTask);
    } catch (error: any) {
      alert(`删除失败: ${error.message}`);
    }
  };

  const exportHomework = async () => {
    try {
      const token = localStorage.getItem('xgpy_token');
      let url = '/api/python/teacher/export';
      if (exportClassId) {
        url += `?class_id=${exportClassId}`;
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('导出失败');
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'python_homework_export.csv';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename=(.+)/);
        if (match) {
          filename = match[1].replace(/["']/g, '');
        }
      }
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error: any) {
      alert(`导出失败: ${error.message}`);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-800">
            <i className="fa fa-code text-purple-600 mr-2"></i>
            Python编程管理
          </h1>
          <div className="flex gap-2">
            <button
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'tasks' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => {
                setActiveTab('tasks');
              }}
            >
              <i className="fa fa-list mr-1"></i>任务列表
            </button>
            <button
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'create' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => {
                setActiveTab('create');
                setFormData({
                  title: '',
                  description: '',
                  task_type: 'code',
                  class_ids: [],
                  total_score: 100,
                  is_active: true,
                  allow_late_submission: false,
                  allow_run_code: true,
                  hint: '',
                  reference_code: '',
                  expected_output: '',
                  required_keywords: [],
                  blank_template: '',
                  blank_answers: [],
                  blank_weights: []
                });
                setKeywordInput('');
                setEditingId(null);
              }}
            >
              <i className="fa fa-plus mr-1"></i>
              {editingId ? '编辑任务' : '创建任务'}
            </button>
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
              <select
                value={exportClassId}
                onChange={(e) => setExportClassId(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
              >
                <option value="">全部班级</option>
                {classes.map(cls => (
                  <option key={cls.id} value={cls.id}>{cls.name}</option>
                ))}
              </select>
              <button
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                onClick={exportHomework}
              >
                <i className="fa fa-download mr-1"></i>导出作业情况
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 bg-white border-r overflow-y-auto p-4 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-gray-700">作业任务</h3>
                {tasks.length > 0 && (
                  <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedTasks.length === tasks.length}
                      onChange={selectAllTasks}
                      className="rounded"
                    />
                    <span>全选</span>
                  </label>
                )}
              </div>
              <div className="flex gap-1 mb-3 bg-gray-100 p-1 rounded-lg">
                <button
                  className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition ${
                    taskFilter === 'all' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setTaskFilter('all')}
                >
                  全部
                </button>
                <button
                  className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition ${
                    taskFilter === 'code' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setTaskFilter('code')}
                >
                  编程作业
                </button>
                <button
                  className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition ${
                    taskFilter === 'fill_blank' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setTaskFilter('fill_blank')}
                >
                  编程填空
                </button>
              </div>
              {selectedTasks.length > 0 && (
                <div className="mb-3 p-2 bg-red-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-red-600">已选择 {selectedTasks.length} 个任务</span>
                    <button
                      className="px-2 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      onClick={deleteSelectedTasks}
                    >
                      <i className="fa fa-trash mr-1"></i>批量删除
                    </button>
                  </div>
                </div>
              )}
              {loading ? (
                <div className="text-center text-gray-400 py-4">加载中...</div>
              ) : tasks.filter(t => taskFilter === 'all' ? true : t.task_type === taskFilter).length === 0 ? (
                <div className="text-center text-gray-400 py-4">
                  {taskFilter === 'fill_blank' ? '暂无填空题' : taskFilter === 'code' ? '暂无编程作业' : '暂无任务'}
                </div>
              ) : (
                <div className="space-y-2">
                  {tasks.filter(t => taskFilter === 'all' ? true : t.task_type === taskFilter).map(task => (
                    <div
                      key={task.id}
                      className={`p-3 rounded-lg cursor-pointer transition ${
                        selectedTask?.id === task.id ? 'bg-purple-100 border-purple-300' : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                      onClick={() => viewTask(task)}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selectedTasks.includes(task.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleTaskSelection(task.id);
                          }}
                          className="rounded mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                              task.is_active ? 'bg-green-500' : 'bg-gray-300'
                            }`}></span>
                            <span className="font-medium text-gray-800 text-sm truncate">{task.title}</span>
                            {task.task_type === 'fill_blank' && (
                              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs flex-shrink-0">
                                填空
                              </span>
                            )}
                            <button
                              onClick={(e) => toggleActive(task.id, e)}
                              className={`ml-auto text-xs px-2 py-0.5 rounded transition-colors flex-shrink-0 ${
                                task.is_active
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                              }`}
                              title={task.is_active ? '点击禁用' : '点击启用'}
                            >
                              {task.is_active ? '启用' : '禁用'}
                            </button>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            创建时间: {formatDate(task.created_at)}
                          </div>
                          <div className="text-xs text-purple-600 mt-1">
                            <i className="fa fa-star mr-1"></i>{task.total_score} 分
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              {activeTab === 'tasks' && (selectedTask ? (
                <div className="flex-1 flex flex-col">
                  <div className="bg-white border-b p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h2 className="font-bold text-lg text-gray-800">{selectedTask.title}</h2>
                        {selectedTask.description && (
                          <LatexRenderer content={selectedTask.description} className="text-gray-600 text-sm mt-1" />
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                          onClick={() => editTask(selectedTask)}
                        >
                          <i className="fa fa-edit mr-1"></i>编辑
                        </button>
                        <button
                          className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                          onClick={gradeAllSubmissions}
                        >
                          <i className="fa fa-check-circle mr-1"></i>批量批改
                        </button>
                        <button
                          className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                          onClick={() => deleteTask(selectedTask.id)}
                        >
                          <i className="fa fa-trash mr-1"></i>删除
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <h3 className="font-medium text-gray-700">
                        {showUnsubmitted ? '未提交学生' : `作业提交情况 (${sortedSubmissions.length})`}
                      </h3>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-gray-500">排序：</span>
                          <button
                            onClick={() => toggleSort('username')}
                            className={`px-2 py-1 rounded transition-colors ${
                              sortBy === 'username' ? 'bg-purple-100 text-purple-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            用户名 {sortBy === 'username' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </button>
                          <button
                            onClick={() => toggleSort('score')}
                            className={`px-2 py-1 rounded transition-colors ${
                              sortBy === 'score' ? 'bg-purple-100 text-purple-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            评分 {sortBy === 'score' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </button>
                        </div>
                        {classFilter && (
                          <button
                            onClick={async () => {
                              if (!selectedTask || !classFilter) return;
                              setShowUnsubmitted(!showUnsubmitted);
                              if (!showUnsubmitted) {
                                try {
                                  const res = await backendClient.get(
                                    `/api/python/teacher/unsubmitted/${selectedTask.id}?class_id=${classFilter}`
                                  );
                                  setUnsubmittedStudents(res.data || []);
                                } catch (e) {
                                  console.error(e);
                                }
                              }
                            }}
                            className={`px-2 py-1.5 rounded text-xs transition-colors ${
                              showUnsubmitted
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                            }`}
                          >
                            <i className="fa fa-user-times mr-1"></i>未提交
                          </button>
                        )}
                        <label className="text-sm text-gray-600">班级：</label>
                        <select
                          value={classFilter}
                          onChange={(e) => {
                            setClassFilter(e.target.value);
                            setShowUnsubmitted(false);
                            setSelectedSubmissions([]);
                            if (selectedTask) {
                              const url = e.target.value
                                ? `/api/python/teacher/submissions/${selectedTask.id}?class_id=${e.target.value}`
                                : `/api/python/teacher/submissions/${selectedTask.id}`;
                              backendClient.get(url).then((res) => {
                                const data = (res.data || []).map(normalizeSubmission);
                                setSubmissions(data);
                              }).catch(console.error);
                            }
                          }}
                          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="">全部班级</option>
                          {classes.map(cls => (
                            <option key={cls.id} value={cls.id}>{cls.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {selectedSubmissions.length > 0 && (
                      <div className="mb-3 p-2 bg-red-50 rounded-lg flex items-center justify-between">
                        <span className="text-sm text-red-600">已选择 {selectedSubmissions.length} 个提交</span>
                        <button
                          className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                          onClick={deleteSelectedSubmissions}
                        >
                          <i className="fa fa-trash mr-1"></i>批量删除
                        </button>
                      </div>
                    )}

                    {showUnsubmitted ? (
                      unsubmittedStudents.length === 0 ? (
                        <div className="text-center text-gray-400 py-8">全班都已提交</div>
                      ) : (
                        <div className="space-y-2">
                          {unsubmittedStudents.map(student => (
                            <div key={student.id} className="bg-white rounded-lg border p-3">
                              <div className="text-sm">
                                <span className="font-medium text-gray-700">{student.username}</span>
                                {student.real_name ? <span className="text-gray-400"> ({student.real_name})</span> : ''}
                                <span className="ml-3 px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">未提交</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    ) : submissions.length === 0 ? (
                      <div className="text-center text-gray-400 py-8">暂无学生提交</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
                          <label className="flex items-center gap-1 cursor-pointer hover:text-gray-700">
                            <input
                              type="checkbox"
                              checked={selectedSubmissions.length === sortedSubmissions.length && sortedSubmissions.length > 0}
                              onChange={toggleSelectAllSubmissions}
                              className="rounded"
                            />
                            <span>全选</span>
                          </label>
                        </div>
                        {paginatedSubmissions.map(sub => (
                          <div key={sub.id} className="bg-white rounded-lg border p-4">
                              <div className="flex justify-between items-start">
                                <div className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={selectedSubmissions.includes(sub.id)}
                                    onChange={() => toggleSubmissionSelection(sub.id)}
                                    className="rounded mt-1"
                                  />
                                  <div>
                                    <div className="text-xs text-gray-500">
                                      <span className="font-medium text-gray-700">{sub.username}</span>
                                      {sub.real_name ? <span className="text-gray-400"> ({sub.real_name})</span> : ''}
                                      <span className="mx-2">|</span>
                                      提交时间: {formatDate(sub.submitted_at)}
                                    </div>
                                  </div>
                                </div>
                              <div className="flex items-center gap-2">
                                {sub.grading ? (
                                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                                    sub.grading.total_score >= selectedTask.total_score * 0.6 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                                  }`}>
                                    {sub.grading.total_score} / {selectedTask.total_score}
                                  </span>
                                ) : (
                                  <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm">
                                    {sub.status === 'submitted' ? '待批改' : sub.status}
                                  </span>
                                )}
                                {sub.status === 'submitted' && (
                                  <button
                                    className="px-2 py-1 bg-green-600 text-white rounded text-xs"
                                    onClick={() => gradeSubmission(sub.id)}
                                  >
                                    <i className="fa fa-magic mr-1"></i>AI批改
                                  </button>
                                )}
                              </div>
                            </div>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-sm text-purple-600 hover:text-purple-800">
                                查看代码
                              </summary>
                              <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded text-xs font-mono overflow-x-auto">
                                {sub.code}
                              </pre>
                              {sub.grading?.comment && (
                                <div className="mt-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                                  <div className="flex items-center gap-2 mb-2">
                                    <i className="fa fa-magic text-blue-600"></i>
                                    <span className="font-semibold text-blue-800">AI智能评语</span>
                                    {sub.grading.is_ai_graded && (
                                      <span className="px-2 py-0.5 bg-blue-200 text-blue-800 rounded text-xs">
                                        智能批改
                                      </span>
                                    )}
                                    {sub.grading.manually_adjusted && (
                                      <span className="px-2 py-0.5 bg-orange-200 text-orange-800 rounded text-xs">
                                        已手动调整
                                      </span>
                                    )}
                                  </div>
                                  
                                  <div className="grid grid-cols-4 gap-2 mb-3">
                                    <div className="text-center p-2 bg-white rounded">
                                      <div className="text-xs text-gray-500">语法</div>
                                      <div className="font-bold text-blue-600">{sub.grading.syntax_score}分</div>
                                    </div>
                                    <div className="text-center p-2 bg-white rounded">
                                      <div className="text-xs text-gray-500">输出</div>
                                      <div className="font-bold text-green-600">{sub.grading.output_score}分</div>
                                    </div>
                                    <div className="text-center p-2 bg-white rounded">
                                      <div className="text-xs text-gray-500">逻辑</div>
                                      <div className="font-bold text-purple-600">{sub.grading.logic_score}分</div>
                                    </div>
                                    <div className="text-center p-2 bg-blue-100 rounded">
                                      <div className="text-xs text-blue-700">总分</div>
                                      <div className="font-bold text-blue-800">{sub.grading.total_score}分</div>
                                    </div>
                                  </div>
                                  
                                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                                    {sub.grading.comment}
                                  </div>
                                </div>
                              )}
                            </details>
                          </div>
                        ))}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-2 pt-2">
                            <button
                              onClick={() => setSubmissionsPage(p => Math.max(1, p - 1))}
                              disabled={submissionsPage === 1}
                              className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                              <i className="fa fa-chevron-left"></i>
                            </button>
                            <span className="px-3 py-1 text-sm text-gray-600">
                              第 {submissionsPage} / {totalPages} 页 (共 {sortedSubmissions.length} 条)
                            </span>
                            <button
                              onClick={() => setSubmissionsPage(p => Math.min(totalPages, p + 1))}
                              disabled={submissionsPage === totalPages}
                              className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                              <i className="fa fa-chevron-right"></i>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <i className="fa fa-code text-4xl mb-4"></i>
                    <p>请在左侧选择一个任务查看详情</p>
                  </div>
                </div>
              ))}

              {activeTab === 'create' && (
                <div className="flex-1 flex flex-col p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-6">
                {editingId ? '编辑任务' : '创建新任务'}
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">任务标题 *</label>
                  <input
                    type="text"
                    value={formData.title || ''}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                    placeholder="请输入任务标题"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">任务描述</label>
                  <textarea
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 h-24"
                    placeholder="请详细描述编程任务要求..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">题型</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="task_type"
                        value="code"
                        checked={formData.task_type === 'code'}
                        onChange={(e) => setFormData({ ...formData, task_type: e.target.value })}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">完整编程</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="task_type"
                        value="fill_blank"
                        checked={formData.task_type === 'fill_blank'}
                        onChange={(e) => setFormData({ ...formData, task_type: e.target.value })}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">填空题</span>
                    </label>
                  </div>
                </div>

                {formData.task_type === 'fill_blank' && (
                  <div className="bg-purple-50 rounded-lg p-4 space-y-4 border border-purple-200">
                    <h3 className="font-semibold text-purple-800 text-sm">
                      <i className="fa fa-puzzle-piece mr-1"></i>填空题配置
                    </h3>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        填空模板代码
                        <span className="text-gray-400 font-normal ml-1">（用①②③等标记空白处）</span>
                      </label>
                      <textarea
                        value={formData.blank_template || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormData({ ...formData, blank_template: val });
                          const placeholders = val.match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g) || [];
                          const uniquePh = [...new Set(placeholders)];
                          const newAnswers = uniquePh.map((_, i) => {
                            const existing = formData.blank_answers?.[i];
                            return existing || [''];
                          });
                          const newWeights = uniquePh.map((_, i) => {
                            const existing = formData.blank_weights?.[i];
                            return existing != null ? existing : Math.round(100 / uniquePh.length);
                          });
                          setFormData({
                            ...formData,
                            blank_template: val,
                            blank_answers: newAnswers,
                            blank_weights: newWeights,
                          });
                        }}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 h-40 font-mono text-sm"
                        placeholder="例如：&#10;def gcd(m, n):&#10;    if m % n == 0:&#10;        return ①&#10;    else:&#10;        return gcd(n, m % n)"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        提示：在代码中用 ①②③④... 标记需要学生填写的空白处，系统会自动识别并生成答案输入框
                      </p>
                    </div>

                    {formData.blank_answers && formData.blank_answers.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          各空标准答案与分值
                        </label>
                        <div className="space-y-2">
                          {formData.blank_answers.map((answers: string[], idx: number) => (
                            <div key={idx} className="bg-white rounded-lg p-3 border border-purple-100">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-purple-700">
                                  第 {idx + 1} 空（{['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'][idx]}）
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500">分值:</span>
                                  <input
                                    type="number"
                                    value={formData.blank_weights?.[idx] ?? 0}
                                    onChange={(e) => {
                                      const newWeights = [...(formData.blank_weights || [])];
                                      newWeights[idx] = parseInt(e.target.value) || 0;
                                      setFormData({ ...formData, blank_weights: newWeights });
                                    }}
                                    className="w-16 px-2 py-1 border rounded text-sm"
                                    min="0"
                                  />
                                </div>
                              </div>
                              <div className="space-y-1">
                                {answers.map((ans: string, ansIdx: number) => (
                                  <div key={ansIdx} className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400 w-16">答案 {ansIdx + 1}:</span>
                                    <input
                                      type="text"
                                      value={ans}
                                      onChange={(e) => {
                                        const newAnswers = formData.blank_answers?.map((a: string[], i: number) =>
                                          i === idx ? a.map((v, j) => j === ansIdx ? e.target.value : v) : a
                                        ) || [];
                                        setFormData({ ...formData, blank_answers: newAnswers });
                                      }}
                                      className="flex-1 px-2 py-1 border rounded text-sm font-mono"
                                      placeholder="输入正确答案"
                                    />
                                    {answers.length > 1 && (
                                      <button
                                        onClick={() => {
                                          const newAnswers = formData.blank_answers?.map((a: string[], i: number) =>
                                            i === idx ? a.filter((_, j) => j !== ansIdx) : a
                                          ) || [];
                                          setFormData({ ...formData, blank_answers: newAnswers });
                                        }}
                                        className="text-red-500 hover:text-red-700 text-sm"
                                        title="删除该答案"
                                      >
                                        <i className="fa fa-times"></i>
                                      </button>
                                    )}
                                  </div>
                                ))}
                                <button
                                  onClick={() => {
                                    const newAnswers = formData.blank_answers?.map((a: string[], i: number) =>
                                      i === idx ? [...a, ''] : a
                                    ) || [];
                                    setFormData({ ...formData, blank_answers: newAnswers });
                                  }}
                                  className="text-xs text-purple-600 hover:text-purple-800 mt-1"
                                >
                                  <i className="fa fa-plus mr-1"></i>添加一个可接受答案
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          每个空可以设置多个正确答案，精确匹配（首尾空格会被忽略）
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">选择班级</label>
                  <div className="flex flex-wrap gap-2">
                    {classes.map(cls => (
                      <label
                        key={cls.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition ${
                          (formData.class_ids || []).includes(cls.id)
                            ? 'bg-purple-100 border-purple-500 text-purple-700'
                            : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={(formData.class_ids || []).includes(cls.id)}
                          onChange={(e) => {
                            const currentClasses = formData.class_ids || [];
                            if (e.target.checked) {
                              setFormData({ ...formData, class_ids: [...currentClasses, cls.id] });
                            } else {
                              setFormData({ ...formData, class_ids: currentClasses.filter(id => id !== cls.id) });
                            }
                          }}
                          className="rounded"
                        />
                        <span className="text-sm">{cls.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    不选择班级则任务对所有学生可见
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">总分</label>
                    <input
                      type="number"
                      value={formData.total_score || 100}
                      onChange={(e) => setFormData({ ...formData, total_score: parseInt(e.target.value) || 100 })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">截止时间</label>
                    <input
                      type="datetime-local"
                      value={formData.deadline ? formData.deadline.slice(0, 16) : ''}
                      onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.is_active !== false}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">启用（学生可见）</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.allow_late_submission || false}
                      onChange={(e) => setFormData({ ...formData, allow_late_submission: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">允许补交</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.allow_run_code !== false}
                      onChange={(e) => setFormData({ ...formData, allow_run_code: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">允许运行代码</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">提示信息</label>
                  <textarea
                    value={formData.hint || ''}
                    onChange={(e) => setFormData({ ...formData, hint: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 h-20"
                    placeholder="给学生一些解题提示（可选）"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    要求使用的关键字
                    <span className="text-gray-400 font-normal ml-1">（可选，用逗号分隔）</span>
                  </label>
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                    placeholder="例如: for, range, print"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    AI批改时会检查学生代码是否使用了这些关键字
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">参考答案代码</label>
                  <textarea
                    value={formData.reference_code || ''}
                    onChange={(e) => setFormData({ ...formData, reference_code: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 h-32 font-mono text-sm"
                    placeholder="参考代码用于AI批改时比对输出..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">预期输出</label>
                  <textarea
                    value={formData.expected_output || ''}
                    onChange={(e) => setFormData({ ...formData, expected_output: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 h-24 font-mono text-sm"
                    placeholder="程序运行后的预期输出..."
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  onClick={saveTask}
                >
                  <i className="fa fa-save mr-1"></i>
                  {editingId ? '保存修改' : '创建任务'}
                </button>
                <button
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  onClick={() => {
                    setActiveTab('tasks');
                    setEditingId(null);
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
  );
};
