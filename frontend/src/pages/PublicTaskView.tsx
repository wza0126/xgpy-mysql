import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { API_CONFIG } from '../api/config';
import { sanitizeHtml } from '../utils/htmlUtils';

type ResourceType = 'pdf' | 'ppt' | 'word' | 'image' | 'video' | 'python' | 'zip' | 'html' | 'link';

interface Resource {
  id: string;
  type: ResourceType;
  title: string;
  file_path?: string;
  file_url?: string;
  content?: string;
  html_content?: string;
  original_filename?: string;
}

interface Question {
  id: string;
  content: string;
  type: string;
  options?: string[] | string;
  answers?: string[] | string;
  explanation?: string;
  score: number;
}

interface TaskData {
  task: { id: string; title: string; learning_objectives: string; deadline: string; force_video_watch: number };
  resources: Resource[];
  questions: Question[];
}

const parseJsonField = (field: any): any => {
  if (typeof field === 'string') {
    try { return JSON.parse(field); } catch { return field; }
  }
  return field;
};

const getOptions = (options: any): string[] => {
  const parsed = parseJsonField(options);
  if (Array.isArray(parsed)) return parsed;
  if (parsed?.options && Array.isArray(parsed.options)) return parsed.options;
  return [];
};

const PublicTaskView: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [taskData, setTaskData] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeResourceIdx, setActiveResourceIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [pythonContent, setPythonContent] = useState<string>('');
  const [pythonLoading, setPythonLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const loadTask = async () => {
      try {
        // 先尝试用accessKey访问，如果taskId就是accessKey
        const resp = await fetch(`${API_CONFIG.apiUrl}/api/task-public/${taskId}`);
        const result = await resp.json();
        if (result.error) {
          // 如果accessKey方式失败，尝试直接用taskId
          const resp2 = await fetch(`${API_CONFIG.apiUrl}/api/task-public/${taskId}`);
          const result2 = await resp2.json();
          if (result2.error) {
            setError(result2.error);
            setLoading(false);
            return;
          }
          setTaskData(result2.data);
        } else {
          setTaskData(result.data);
        }
        setLoading(false);
      } catch (err: any) {
        setError('加载任务失败: ' + err.message);
        setLoading(false);
      }
    };
    if (taskId) loadTask();
  }, [taskId]);

  // 加载Python文件内容
  useEffect(() => {
    if (!taskData) return;
    const res = taskData.resources[activeResourceIdx];
    if (res && res.type === 'python' && res.file_url) {
      setPythonLoading(true);
      setPythonContent('');
      const url = buildFileUrl(res.file_url);
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error('加载失败');
          return r.text();
        })
        .then((text) => setPythonContent(text))
        .catch(() => setPythonContent(''))
        .finally(() => setPythonLoading(false));
    } else {
      setPythonContent('');
    }
  }, [taskData, activeResourceIdx]);

  const buildFileUrl = (path?: string): string => {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith('/uploads/') && !normalized.startsWith('uploads/')) {
      const idx = normalized.indexOf('/uploads/');
      if (idx >= 0) normalized = normalized.substring(idx);
      else normalized = '/uploads/' + normalized.replace(/^\/+/, '');
    }
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    return `${API_CONFIG.apiUrl}${normalized}`;
  };

  const handleSubmit = async () => {
    if (!taskData || submitting) return;
    if (!studentName.trim()) {
      alert('请输入你的姓名');
      return;
    }
    setSubmitting(true);
    const answerList = Object.entries(answers).map(([question_id, answer]) => ({ question_id, answer }));
    try {
      const resp = await fetch(`${API_CONFIG.apiUrl}/api/task-public/${taskId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: `guest_${studentName}_${Date.now()}`, answers: answerList }),
      });
      const result = await resp.json();
      setSubmitting(false);
      if (result.error) {
        alert(result.error);
        return;
      }
      setSubmitResult(result.data);
      setSubmitted(true);
    } catch (err: any) {
      setSubmitting(false);
      alert('提交失败: ' + err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-4xl text-indigo-500 mb-4"></i>
          <p className="text-gray-600">加载任务中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md p-6">
          <i className="fa-solid fa-circle-exclamation text-5xl text-red-400 mb-4"></i>
          <p className="text-lg font-semibold text-gray-800 mb-2">无法访问任务</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!taskData) return null;
  const { task, resources, questions } = taskData;
  const currentResource = resources[activeResourceIdx];

  const allAnswered = questions.length > 0 && questions.every((q) => {
    const a = answers[q.id];
    return a && a.trim().length > 0;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto p-6 pb-32">
        {/* 顶部区域 */}
        <div className="mb-6">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-100">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <i className="fa-solid fa-book-open text-xl"></i>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold mb-2 break-words">{task.title}</h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                  <i className="fa-solid fa-globe"></i> 公开任务
                </span>
              </div>
            </div>
            {task.learning_objectives && (
              <div className="mt-4 pt-4 border-t border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <i className="fa-solid fa-bullseye text-white/80 text-sm"></i>
                  <span className="text-sm font-medium text-white/90">学习目标</span>
                </div>
                <div className="text-sm text-white/90 leading-relaxed question-rich-content">
                  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(task.learning_objectives) }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 资源浏览区 */}
        {resources.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-500 flex items-center justify-center">
                <i className="fa-solid fa-folder-open text-sm"></i>
              </div>
              <h2 className="text-base font-semibold text-gray-800">学习资源</h2>
              <span className="text-sm text-gray-400">{resources.length} 个资源</span>
            </div>
            {resources.length > 1 && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                {resources.map((r, idx) => (
                  <button
                    key={r.id}
                    onClick={() => setActiveResourceIdx(idx)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-all border ${
                      activeResourceIdx === idx
                        ? 'bg-indigo-500 text-white border-indigo-500 shadow-md shadow-indigo-100'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    <i className={`fa-solid ${
                      r.type === 'pdf' ? 'fa-file-pdf' :
                      r.type === 'video' ? 'fa-video' :
                      r.type === 'image' ? 'fa-image' :
                      r.type === 'html' ? 'fa-file-code' :
                      r.type === 'ppt' ? 'fa-file-powerpoint' :
                      r.type === 'word' ? 'fa-file-word' :
                      r.type === 'zip' ? 'fa-file-zipper' :
                      r.type === 'python' ? 'fa-code' :
                      r.type === 'link' ? 'fa-link' : 'fa-file'
                    }`}></i>
                    {r.title}
                  </button>
                ))}
              </div>
            )}
            {currentResource && (
              <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
                {currentResource.type === 'pdf' && (
                  <iframe src={buildFileUrl(currentResource.file_url || currentResource.file_path)} title={currentResource.title} className="w-full" style={{ height: '70vh', minHeight: '500px' }} />
                )}
                {currentResource.type === 'image' && (
                  <div className="flex items-center justify-center p-4">
                    <img src={buildFileUrl(currentResource.file_url || currentResource.file_path)} alt={currentResource.title} className="max-w-full max-h-[70vh] rounded-lg" />
                  </div>
                )}
                {currentResource.type === 'video' && (
                  <div className="bg-black rounded-xl overflow-hidden">
                    <video src={buildFileUrl(currentResource.file_url || currentResource.file_path)} controls className="w-full" style={{ maxHeight: '70vh' }} />
                  </div>
                )}
                {currentResource.type === 'link' && (
                  <iframe src={currentResource.file_url || currentResource.file_path} title={currentResource.title} className="w-full" style={{ height: '70vh', minHeight: '500px' }} />
                )}
                {currentResource.type === 'html' && (
                  <iframe srcDoc={currentResource.content || currentResource.html_content || ''} title={currentResource.title} sandbox="allow-scripts allow-same-origin allow-forms" className="w-full" style={{ height: '70vh', minHeight: '500px' }} />
                )}
                {currentResource.type === 'python' && (
                  <div className="bg-gray-900 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
                      <i className="fa-solid fa-code text-green-400"></i>
                      <span className="text-sm text-gray-300">{currentResource.original_filename || currentResource.title}</span>
                    </div>
                    {pythonLoading ? (
                      <div className="flex items-center justify-center p-8">
                        <i className="fa-solid fa-circle-notch fa-spin text-indigo-400 mr-2"></i>
                        <span className="text-gray-400 text-sm">加载中...</span>
                      </div>
                    ) : (
                      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
                        <code className="font-mono text-gray-100">{pythonContent || currentResource.content || currentResource.html_content || ''}</code>
                      </pre>
                    )}
                  </div>
                )}
                {['ppt', 'word', 'zip'].includes(currentResource.type) && (
                  <div className="p-10 text-center">
                    <i className={`fa-solid ${currentResource.type === 'ppt' ? 'fa-file-powerpoint text-amber-500' : currentResource.type === 'word' ? 'fa-file-word text-blue-500' : 'fa-file-zipper text-purple-500'} text-4xl mb-3`}></i>
                    <p className="text-gray-600 mb-3">{currentResource.title}</p>
                    <a href={buildFileUrl(currentResource.file_url || currentResource.file_path)} download className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm hover:bg-indigo-600">
                      <i className="fa-solid fa-download"></i>下载查看
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 随堂练习区 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-500 flex items-center justify-center">
              <i className="fa-solid fa-pen-to-square text-sm"></i>
            </div>
            <h2 className="text-base font-semibold text-gray-800">随堂练习</h2>
            <span className="text-sm text-gray-400">{questions.length} 题</span>
          </div>

          {!submitted && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="请输入你的姓名"
                className="w-full px-4 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {questions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
              <p>本任务暂无随堂练习</p>
            </div>
          ) : (
            <div className="space-y-5">
              {questions.map((q, idx) => {
                const options = getOptions(q.options);
                const userAnswer = answers[q.id] || '';
                const result = submitted ? submitResult?.answers?.find((a: any) => a.question_id === q.id) : null;
                const isMultiple = q.type === 'multiple_choice';
                const correctAnswers = (() => {
                  const parsed = parseJsonField(q.answers);
                  let r = parsed?.answers || parsed;
                  if (!Array.isArray(r)) { if (typeof r === 'string') return [r]; return []; }
                  return r.map((a: any) => a?.toString() || '');
                })();

                return (
                  <div key={q.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-semibold">{idx + 1}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${q.type === 'fill_blank' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {q.type === 'fill_blank' ? '填空题' : isMultiple ? '多选题' : '单选题'}
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-600 font-medium">{q.score} 分</span>
                      {submitted && result && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${result.is_correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          <i className={`fa-solid ${result.is_correct ? 'fa-check' : 'fa-xmark'} mr-1`}></i>
                          {result.is_correct ? '正确' : '错误'}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-800 leading-relaxed mb-4 question-rich-content">
                      <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.content) }} />
                    </div>
                    {q.type !== 'fill_blank' && options.length > 0 && (
                      <div className="space-y-2.5">
                        {options.map((opt, oIdx) => {
                          const letter = String.fromCharCode(65 + oIdx);
                          const isSelected = isMultiple
                            ? userAnswer.split(',').map((s) => s.trim().toUpperCase()).includes(letter)
                            : userAnswer === letter;
                          const isCorrect = correctAnswers.some((a: string) => a.trim().toUpperCase() === letter);
                          let cls = 'border-gray-200 hover:border-indigo-300 bg-white';
                          if (submitted) {
                            if (isCorrect) cls = 'border-green-500 bg-green-50';
                            else if (isSelected && !isCorrect) cls = 'border-red-500 bg-red-50';
                          } else if (isSelected) {
                            cls = 'border-indigo-500 bg-indigo-50';
                          }
                          return (
                            <button
                              key={oIdx}
                              type="button"
                              disabled={submitted}
                              onClick={() => {
                                if (submitted) return;
                                if (isMultiple) {
                                  const list = userAnswer.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
                                  const i = list.indexOf(letter);
                                  const newList = i >= 0 ? list.filter((_, x) => x !== i) : [...list, letter];
                                  setAnswers((prev) => ({ ...prev, [q.id]: newList.join(',') }));
                                } else {
                                  setAnswers((prev) => ({ ...prev, [q.id]: letter }));
                                }
                              }}
                              className={`w-full p-3.5 rounded-xl border-2 text-left transition-all flex items-start gap-3 ${cls} ${submitted ? 'cursor-default' : 'cursor-pointer'}`}
                            >
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                isSelected ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'
                              } ${submitted && isCorrect ? 'bg-green-500 text-white' : ''} ${submitted && isSelected && !isCorrect ? 'bg-red-500 text-white' : ''}`}>
                                {letter}
                              </span>
                              <span className="flex-1 text-sm text-gray-700 question-rich-content">
                                <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(opt) }} />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {q.type === 'fill_blank' && (
                      <input
                        type="text"
                        value={userAnswer}
                        disabled={submitted}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder="请输入答案"
                        className={`w-full px-4 py-3 border-2 rounded-xl text-sm focus:outline-none ${
                          submitted
                            ? result?.is_correct ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'
                            : 'border-gray-200 focus:border-indigo-500'
                        }`}
                      />
                    )}
                    {submitted && q.explanation && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="text-sm text-gray-600 bg-amber-50/50 p-3 rounded-lg question-rich-content">
                          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.explanation) }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!submitted && questions.length > 0 && (
                <button
                  onClick={handleSubmit}
                  disabled={!allAnswered || submitting || !studentName.trim()}
                  className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {submitting ? '提交中...' : '提交答案'}
                </button>
              )}
              {submitted && (
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-6 text-center">
                  <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-3">
                    <i className="fa-solid fa-trophy text-3xl text-green-500"></i>
                  </div>
                  <h3 className="text-lg font-bold text-gray-800 mb-1">提交完成</h3>
                  <p className="text-sm text-gray-600">
                    得分：<span className="text-xl font-bold text-green-600">{submitResult?.total_score || 0}</span> 分
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicTaskView;
