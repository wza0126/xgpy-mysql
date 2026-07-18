import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';
import { LatexRenderer } from '../common/LatexRenderer';

interface PythonTask {
  id: string;
  title: string;
  description?: string;
  task_type: string;
  total_score: number;
  deadline?: string;
  reference_code?: string;
  expected_output?: string;
  hint?: string;
  required_keywords?: string[];
  blank_template?: string;
  blank_answers?: string[][];
  blank_weights?: number[];
}

interface PythonDraft {
  id: string;
  title: string;
  code?: string;
  task_id?: string;
}

interface PythonSubmission {
  id: string;
  code: string;
  status: string;
  total_score?: number;
  totalScore?: number;
  grading?: {
    id: string;
    total_score: number;
    syntax_score?: number;
    output_score?: number;
    logic_score?: number;
    comment?: string;
    is_ai_graded?: boolean;
  };
}

interface RunResult {
  success: boolean;
  output: string;
  error?: string;
}

export const PythonProgramming: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'tasks' | 'fill_blank' | 'drafts' | 'practice'>('tasks');
  const [tasks, setTasks] = useState<PythonTask[]>([]);
  const [drafts, setDrafts] = useState<PythonDraft[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, PythonSubmission>>({});
  const [selectedTask, setSelectedTask] = useState<PythonTask | null>(null);
  const [code, setCode] = useState<string>('print("Hello, World!")');
  const [inputData, setInputData] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submission, setSubmission] = useState<PythonSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [blankAnswers, setBlankAnswers] = useState<string[]>([]);
  const codeEditorRef = useRef<HTMLTextAreaElement>(null);

  // 扫描代码中的 input() 调用次数（忽略注释行）
  const inputCount = (() => {
    if (!code) return 0;
    const lines = code.split('\n');
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      const matches = trimmed.match(/\binput\s*\(/g);
      if (matches) count += matches.length;
    }
    return count;
  })();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [tasksRes, draftsRes] = await Promise.all([
        backendClient.get('/api/python/tasks'),
        backendClient.get('/api/python/drafts')
      ]);
      const taskData = tasksRes.data || [];
      const draftData = draftsRes.data || [];
      setTasks(taskData);
      setDrafts(draftData);
      
      // 加载每个任务的提交记录
      const submissionsMap: Record<string, any> = {};
      for (const task of taskData) {
        try {
          const res = await backendClient.get(`/api/python/submissions/${task.id}`);
          if (res.data) {
            let sub = res.data;
            // 如果返回扁平字段但无嵌套 grading，进行规范化
            if (!sub.grading && sub.grading_id != null) {
              sub = {
                ...sub,
                grading: {
                  id: sub.grading_id,
                  total_score: sub.grade_score ?? sub.total_score ?? 0,
                  syntax_score: sub.syntax_score ?? 0,
                  output_score: sub.output_score ?? 0,
                  logic_score: sub.logic_score ?? 0,
                  comment: sub.comment || '',
                  is_ai_graded: sub.is_ai_graded,
                  manually_adjusted: sub.manually_adjusted || false,
                }
              };
            }
            submissionsMap[task.id] = sub;
          }
        } catch (e) {
          // 没有提交记录，忽略
        }
      }
      setSubmissions(submissionsMap as any);
    } catch (error: any) {
      console.error('Failed to load data:', error.message || error);
    } finally {
      setLoading(false);
    }
  };

  const PLACEHOLDER_CHARS = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
  const placeholderRegex = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g;

  const getPlaceholderCount = (template: string): number => {
    const matches = template.match(placeholderRegex);
    return matches ? matches.length : 0;
  };

  const assembleCode = (template: string, answers: string[]): string => {
    let result = template;
    const matches = template.match(placeholderRegex) || [];
    matches.forEach((ph, idx) => {
      result = result.replace(ph, answers[idx] || '');
    });
    return result;
  };

  const extractAnswersFromCode = (code: string, template: string): string[] => {
    const placeholderRegex = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g;
    const templatePlaceholders: { index: number; char: string }[] = [];
    let match;
    while ((match = placeholderRegex.exec(template)) !== null) {
      templatePlaceholders.push({ index: match.index, char: match[0] });
    }
    if (templatePlaceholders.length === 0) return [];

    const answers: string[] = [];
    let codePos = 0;
    let templatePos = 0;

    for (let i = 0; i < templatePlaceholders.length; i++) {
      const phInfo = templatePlaceholders[i];
      const prefix = template.substring(templatePos, phInfo.index);

      let codeStart = codePos;
      if (prefix) {
        const foundIdx = code.indexOf(prefix, codePos);
        if (foundIdx === -1) {
          answers.push('');
          templatePos = phInfo.index + phInfo.char.length;
          continue;
        }
        codeStart = foundIdx + prefix.length;
        codePos = codeStart;
      }

      let suffix = '';
      if (i < templatePlaceholders.length - 1) {
        const nextPhInfo = templatePlaceholders[i + 1];
        suffix = template.substring(phInfo.index + phInfo.char.length, nextPhInfo.index);
      } else {
        suffix = template.substring(phInfo.index + phInfo.char.length);
      }

      let answerEnd = code.length;
      if (suffix) {
        const suffixPos = code.indexOf(suffix, codePos);
        if (suffixPos !== -1) {
          answerEnd = suffixPos;
        }
      }

      answers.push(code.substring(codeStart, answerEnd));
      codePos = answerEnd;
      templatePos = phInfo.index + phInfo.char.length;
    }

    return answers;
  };

  const selectTask = async (task: PythonTask) => {
    setSelectedTask(task);
    // 填空题保持在「编程填空」标签页，不跳转到「作业任务」
    if (task.task_type !== 'fill_blank') {
      setActiveTab('tasks');
    }
    
    const isFillBlank = task.task_type === 'fill_blank' && task.blank_template;
    
    if (isFillBlank) {
      const phCount = getPlaceholderCount(task.blank_template!);
      setBlankAnswers(new Array(phCount).fill(''));
    }
    
    // 检查是否有提交记录
    try {
      const res = await backendClient.get(`/api/python/submissions/${task.id}`);
      let submissionData = res.data;
      if (submissionData) {
        // 规范化 grading 字段
        if (!submissionData.grading && submissionData.grading_id != null) {
          submissionData = {
            ...submissionData,
            grading: {
              id: submissionData.grading_id,
              total_score: submissionData.grade_score ?? submissionData.total_score ?? 0,
              syntax_score: submissionData.syntax_score ?? 0,
              output_score: submissionData.output_score ?? 0,
              logic_score: submissionData.logic_score ?? 0,
              comment: submissionData.comment || '',
              is_ai_graded: submissionData.is_ai_graded,
              manually_adjusted: submissionData.manually_adjusted || false,
            }
          };
        }
        setCode(submissionData.code);
        
        if (isFillBlank) {
          const answers = extractAnswersFromCode(submissionData.code, task.blank_template!);
          setBlankAnswers(answers);
        }
        
        setSubmission(submissionData as any);
      } else {
        // 检查是否有相关草稿
        const taskDraft = drafts.find(d => d.task_id === task.id);
        if (taskDraft) {
          setCode(taskDraft.code || '');
          if (isFillBlank) {
            const answers = extractAnswersFromCode(taskDraft.code || '', task.blank_template!);
            setBlankAnswers(answers);
          }
        } else {
          if (isFillBlank) {
            const assembled = assembleCode(task.blank_template!, new Array(getPlaceholderCount(task.blank_template!)).fill(''));
            setCode(assembled);
          } else {
            setCode('# 在这里编写你的代码\nprint("开始编程吧！")');
          }
        }
        setSubmission(null);
      }
    } catch (error) {
      console.error('Failed to load submission:', error);
    }
  };

  const selectDraft = (draft: PythonDraft) => {
    setSelectedTask(null);
    setCode(draft.code || '');
    setActiveTab('drafts');
  };

  const updateBlankAnswer = (index: number, value: string) => {
    if (!selectedTask?.blank_template) return;
    const newAnswers = [...blankAnswers];
    newAnswers[index] = value;
    setBlankAnswers(newAnswers);
    const assembled = assembleCode(selectedTask.blank_template, newAnswers);
    setCode(assembled);
  };

  const renderFillBlankEditor = (template: string, answers: string[]) => {
    const lines = template.split('\n');
    let answerIdx = 0;
    const isSubmitted = submission?.status === 'submitted' || submission?.status === 'graded';

    return lines.map((line, lineIdx) => {
      const parts: React.ReactNode[] = [];
      let lastIdx = 0;
      const lineRegex = new RegExp(placeholderRegex.source, 'g');
      let match;
      while ((match = lineRegex.exec(line)) !== null) {
        if (match.index > lastIdx) {
          parts.push(<span key={`text-${lineIdx}-${lastIdx}`}>{line.substring(lastIdx, match.index)}</span>);
        }
        const currentIdx = answerIdx;
        parts.push(
          <input
            key={`input-${lineIdx}-${match.index}`}
            type="text"
            value={answers[currentIdx] || ''}
            onChange={(e) => updateBlankAnswer(currentIdx, e.target.value)}
            disabled={isSubmitted}
            className="inline-block mx-1 px-2 py-0.5 bg-yellow-900 text-yellow-100 border border-yellow-600 rounded font-mono text-sm min-w-16 text-center focus:outline-none focus:ring-1 focus:ring-yellow-400 disabled:opacity-70"
            style={{ width: Math.max(60, (answers[currentIdx]?.length || 4) * 10 + 16) }}
            spellCheck={false}
          />
        );
        answerIdx++;
        lastIdx = match.index + match[0].length;
      }
      if (lastIdx < line.length) {
        parts.push(<span key={`text-${lineIdx}-end`}>{line.substring(lastIdx)}</span>);
      }
      if (parts.length === 0) {
        parts.push(<span key={`empty-${lineIdx}`}>&nbsp;</span>);
      }
      return (
        <div key={lineIdx} className="whitespace-pre leading-6">
          {parts}
        </div>
      );
    });
  };

  const runCode = async () => {
    if (!code.trim()) {
      alert('请先编写一些代码');
      return;
    }

    setIsRunning(true);
    setOutput('正在执行代码...');
    try {
      const res = await backendClient.post('/api/python/run', {
        code,
        input: inputData
      });
      
      // 检查响应数据
      if (!res.data) {
        setOutput('运行失败: 未收到响应数据');
        return;
      }
      
      // 检查后端返回的错误
      if (res.data.error) {
        setOutput(`错误:\n${res.data.error}`);
        return;
      }
      
      const result: RunResult = res.data;
      
      // 检查结果是否存在
      if (!result) {
        setOutput('运行失败: 执行结果为空');
        return;
      }
      
      if (result.success) {
        setOutput(result.output || '代码执行成功，没有输出');
      } else {
        setOutput(`错误:\n${result.error || '未知错误'}`);
      }
    } catch (error: any) {
      setOutput(`运行失败: ${error.response?.data?.error || error.message || '网络错误'}`);
    } finally {
      setIsRunning(false);
    }
  };

  const saveDraft = async () => {
    try {
      const title = selectedTask ? selectedTask.title : prompt('请输入草稿标题:', '未命名草稿');
      if (!title) return;
      
      const res = await backendClient.post('/api/python/drafts', {
        title,
        code,
        task_id: selectedTask?.id
      });
      setDrafts([res.data, ...drafts]);
      alert('草稿已保存');
    } catch (error: any) {
      alert(`保存失败: ${error.response?.data?.error || error.message}`);
    }
  };

  const submitAssignment = async () => {
    if (!selectedTask) {
      alert('请先选择一个任务');
      return;
    }

    const defaultCode1 = '# 在这里编写你的代码\nprint("开始编程吧！")';
    const defaultCode2 = 'print("Hello, World!")';
    if (code.trim() === defaultCode1.trim() || code.trim() === defaultCode2.trim()) {
      alert('请先修改默认代码再提交作业');
      return;
    }

    if (!confirm('确定要提交作业吗？提交后将不能再修改。')) {
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await backendClient.post('/api/python/submit', {
        task_id: selectedTask.id,
        code
      });
      const msg = ['作业已提交！'];
      if (res.data?.point_reward && res.data.point_reward > 0) {
        msg.push(`\n🎉 恭喜！AI评分达到80分以上，系统奖励 ${res.data.point_reward} 积分！`);
      } else if (res.data?.point_reward && res.data.point_reward < 0) {
        msg.push(`\n😅 AI评分较低，系统扣除 50 积分，下次加油！`);
      }
      alert(msg.join(''));
      await loadData();
      await selectTask(selectedTask);
    } catch (error: any) {
      alert(`提交失败: ${error.response?.data?.error || error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteDraft = async (draftId: string) => {
    if (!confirm('确定要删除这个草稿吗？')) return;
    try {
      await backendClient.delete(`/api/python/drafts/${draftId}`);
      setDrafts(drafts.filter(d => d.id !== draftId));
    } catch (error: any) {
      alert(`删除失败: ${error.message}`);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="bg-white border-b p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-800">
            <i className="fa fa-code text-purple-600 mr-2"></i>
            Python编程学习
          </h1>
          <div className="flex gap-2">
            <button
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'tasks' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setActiveTab('tasks')}
            >
              <i className="fa fa-tasks mr-1"></i>作业任务
            </button>
            <button
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'fill_blank' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setActiveTab('fill_blank')}
            >
              <i className="fa fa-puzzle-piece mr-1"></i>编程填空
            </button>
            <button
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'drafts' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setActiveTab('drafts')}
            >
              <i className="fa fa-file-text mr-1"></i>草稿箱
            </button>
            <button
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'practice' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => {
                setActiveTab('practice');
                setSelectedTask(null);
                setCode('# 自由练习模式\nprint("Hello, World!")');
              }}
            >
              <i className="fa fa-play mr-1"></i>自由练习
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 bg-white border-r overflow-y-auto">
          {activeTab === 'tasks' && (
            <div className="p-4">
              <h3 className="font-medium text-gray-700 mb-3">作业任务</h3>
              {loading ? (
                <div className="text-center text-gray-400 py-4">加载中...</div>
              ) : tasks.filter(t => t.task_type !== 'fill_blank').length === 0 ? (
                <div className="text-center text-gray-400 py-4">暂无作业</div>
              ) : (
                <div className="space-y-2">
                  {tasks.filter(t => t.task_type !== 'fill_blank').map(task => {
                    const taskSubmission = submissions[task.id];
                    const actualScore = taskSubmission?.grading?.total_score ?? taskSubmission?.total_score ?? taskSubmission?.totalScore;
                    const isGraded = taskSubmission?.status === 'graded' && actualScore != null;
                    
                    return (
                      <div
                        key={task.id}
                        className={`p-3 rounded-lg cursor-pointer transition ${
                          selectedTask?.id === task.id ? 'bg-purple-100 border-purple-300' : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                        onClick={() => selectTask(task)}
                      >
                        <div className="font-medium text-gray-800 text-sm">{task.title}</div>
                        {task.deadline && (
                          <div className="text-xs text-gray-500 mt-1">
                            <i className="fa fa-clock-o mr-1"></i>截止: {formatDate(task.deadline)}
                          </div>
                        )}
                        {isGraded && (
                          <div className="text-xs text-yellow-600 mt-1">
                            <i className="fa fa-star mr-1"></i>{actualScore}/{task.total_score} 分
                          </div>
                        )}
                        {taskSubmission && !isGraded && (
                          <div className="text-xs text-blue-500 mt-1">
                            <i className="fa fa-clock-o mr-1"></i>待批改
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'fill_blank' && (
            <div className="p-4">
              <h3 className="font-medium text-gray-700 mb-3">编程填空</h3>
              {loading ? (
                <div className="text-center text-gray-400 py-4">加载中...</div>
              ) : tasks.filter(t => t.task_type === 'fill_blank').length === 0 ? (
                <div className="text-center text-gray-400 py-4">暂无填空题</div>
              ) : (
                <div className="space-y-2">
                  {tasks.filter(t => t.task_type === 'fill_blank').map(task => {
                    const taskSubmission = submissions[task.id];
                    const actualScore = taskSubmission?.grading?.total_score ?? taskSubmission?.total_score ?? taskSubmission?.totalScore;
                    const isGraded = taskSubmission?.status === 'graded' && actualScore != null;
                    
                    return (
                      <div
                        key={task.id}
                        className={`p-3 rounded-lg cursor-pointer transition ${
                          selectedTask?.id === task.id ? 'bg-purple-100 border-purple-300' : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                        onClick={() => selectTask(task)}
                      >
                        <div className="font-medium text-gray-800 text-sm">{task.title}</div>
                        {task.deadline && (
                          <div className="text-xs text-gray-500 mt-1">
                            <i className="fa fa-clock-o mr-1"></i>截止: {formatDate(task.deadline)}
                          </div>
                        )}
                        {isGraded && (
                          <div className="text-xs text-yellow-600 mt-1">
                            <i className="fa fa-star mr-1"></i>{actualScore}/{task.total_score} 分
                          </div>
                        )}
                        {taskSubmission && !isGraded && (
                          <div className="text-xs text-blue-500 mt-1">
                            <i className="fa fa-clock-o mr-1"></i>待批改
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'drafts' && (
            <div className="p-4">
              <h3 className="font-medium text-gray-700 mb-3">我的草稿</h3>
              {drafts.length === 0 ? (
                <div className="text-center text-gray-400 py-4">暂无草稿</div>
              ) : (
                <div className="space-y-2">
                  {drafts.map(draft => (
                    <div
                      key={draft.id}
                      className="p-3 rounded-lg bg-gray-50 hover:bg-gray-100 cursor-pointer group"
                    >
                      <div
                        className="font-medium text-gray-800 text-sm"
                        onClick={() => selectDraft(draft)}
                      >
                        {draft.title}
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-xs text-gray-400">
                          {draft.task_id && <span className="text-purple-500"><i className="fa fa-link mr-1"></i>关联任务</span>}
                        </span>
                        <button
                          className="text-xs text-red-500 opacity-0 group-hover:opacity-100 transition"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteDraft(draft.id);
                          }}
                        >
                          <i className="fa fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'practice' && (
            <div className="p-4">
              <h3 className="font-medium text-gray-700 mb-3">自由练习</h3>
              <div className="text-sm text-gray-500">
                <p className="mb-2">在这个模式下，你可以：</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>测试任意Python代码</li>
                  <li>保存草稿以便以后继续</li>
                  <li>没有时间限制</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col">
          {selectedTask && (
            <div className="bg-white border-b p-4">
              <h2 className="font-bold text-lg text-gray-800 mb-2">{selectedTask.title}</h2>
              {selectedTask.description && (
                <LatexRenderer content={selectedTask.description} className="text-gray-600 text-sm mb-2" />
              )}
              {selectedTask.hint && (
                <div className="bg-yellow-50 p-2 rounded text-yellow-700 text-sm">
                  <i className="fa fa-lightbulb-o mr-1"></i>提示: {selectedTask.hint}
                </div>
              )}
              {selectedTask.deadline && (
                <div className="text-sm text-gray-500 mt-2">
                  截止时间: {formatDate(selectedTask.deadline)}
                </div>
              )}
              {submission && (
                <div className="mt-2 p-3 bg-blue-50 rounded border border-blue-200">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-700 font-medium">
                      {submission.status === 'graded'
                        ? `已提交 | 分数: ${submission.grading?.total_score ?? submission.total_score ?? submission.totalScore ?? '?'}/${selectedTask.total_score}`
                        : '已提交 | 待批改'}
                    </span>
                  </div>
                  {submission.grading?.comment && (
                    <div className="mt-2 pt-2 border-t border-blue-200">
                      <div className="text-xs text-blue-600 font-medium mb-1">AI评语</div>
                      <div className="text-sm text-blue-800 whitespace-pre-wrap">{submission.grading.comment}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col">
              <div className="bg-gray-100 px-4 py-2 flex items-center justify-between border-b">
                <span className="font-medium text-gray-700">代码编辑器</span>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                    onClick={saveDraft}
                  >
                    <i className="fa fa-save mr-1"></i>保存草稿
                  </button>
                  <button
                    className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
                    onClick={runCode}
                    disabled={isRunning}
                  >
                    <i className="fa fa-play mr-1"></i>
                    {isRunning ? '运行中...' : '运行'}
                  </button>
                  {selectedTask?.task_type === 'fill_blank' && (
                    <button
                      className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm"
                      onClick={() => {
                        const task = selectedTask;
                        let questionText = '';
                        if (task.description) {
                          questionText += task.description + '\n\n';
                        }
                        if (task.blank_template) {
                          questionText += '题目代码模板：\n```python\n' + task.blank_template + '\n```';
                        }
                        (window as any).openAiQaWindow?.({ question: questionText });
                      }}
                    >
                      <i className="fa-solid fa-robot mr-1"></i>AI答疑
                    </button>
                  )}
                  {selectedTask && submission?.status !== 'submitted' && submission?.status !== 'graded' && (
                    <button
                      className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm disabled:opacity-50"
                      onClick={submitAssignment}
                      disabled={isSubmitting}
                    >
                      <i className="fa fa-paper-plane mr-1"></i>提交作业
                    </button>
                  )}
                </div>
              </div>
              {selectedTask?.task_type === 'fill_blank' && selectedTask.blank_template ? (
                <div className="flex-1 w-full p-4 font-mono text-sm bg-gray-900 text-gray-100 overflow-auto">
                  {renderFillBlankEditor(selectedTask.blank_template, blankAnswers)}
                </div>
              ) : (
                <textarea
                  ref={codeEditorRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onPaste={(e) => e.preventDefault()}
                  className="flex-1 w-full p-4 font-mono text-sm bg-gray-900 text-gray-100 resize-none"
                  spellCheck={false}
                  placeholder="在这里编写你的Python代码..."
                />
              )}
            </div>

            <div className="w-1/2 border-l flex flex-col bg-white">
              <div className="bg-gray-100 px-4 py-2 border-b">
                <span className="font-medium text-gray-700">输入 & 输出</span>
              </div>
              <div className="flex-1 flex flex-col">
                <div className="border-b">
                  <div className="px-4 py-1 text-xs text-gray-500 bg-gray-50 flex items-center justify-between">
                    <span>输入（可选）</span>
                    {inputCount > 0 && (
                      <span className="text-blue-600">
                        <i className="fa fa-info-circle mr-1"></i>本程序需要 {inputCount} 项输入，请逐行填写
                      </span>
                    )}
                  </div>
                  {inputCount > 0 && inputData.trim() && inputData.trim().split('\n').filter(l => l.trim()).length < inputCount && (
                    <div className="px-4 py-1 text-xs text-orange-600 bg-orange-50 border-b border-orange-100">
                      <i className="fa fa-exclamation-triangle mr-1"></i>
                      已填 {inputData.trim().split('\n').filter(l => l.trim()).length} 行，还需 {inputCount - inputData.trim().split('\n').filter(l => l.trim()).length} 行
                    </div>
                  )}
                  <textarea
                    value={inputData}
                    onChange={(e) => setInputData(e.target.value)}
                    className="w-full p-2 h-20 border-none resize-none text-sm font-mono"
                    placeholder={inputCount > 0 ? `本程序有 ${inputCount} 个 input()，请按顺序每行填写一个输入值` : '如果程序需要输入，请写在这里...'}
                  />
                </div>
                <div className="flex-1 flex flex-col">
                  <div className="px-4 py-1 text-xs text-gray-500 bg-gray-50">输出</div>
                  <pre className="flex-1 p-2 text-sm font-mono bg-gray-900 text-gray-100 overflow-auto">
                    {output || '点击"运行"按钮执行代码'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
