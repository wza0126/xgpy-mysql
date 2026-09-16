import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';
import { useDesktopStore } from '../../store/desktopStore';

/** 测试 / 课堂任务窗口打开期间的答疑拦截提示语 */
export const EXAM_QA_BLOCKED_MESSAGE = '测试期间禁止答疑';

/** 会触发「禁止答疑」的模块窗口 id：测试、课堂任务 */
const EXAM_BLOCKING_WINDOW_IDS = ['test', 'taskCenter'];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface ChatHistoryItem {
  id: string;
  question: string;
  answer: string;
  created_at: string;
}

interface AiQaConfig {
  pointsPerQuestion: number;
  subjectScope: string;
  difficulty: string;
  codeCheckEnabled: boolean;
  codeRunEnabled: boolean;
  suggestedQuestions: string[];
}

interface AiQaAppProps {
  onClose: () => void;
  initialData?: { question?: string };
}

export function AiQaApp({ onClose, initialData }: AiQaAppProps) {
  const { user, profile, refreshProfile } = useAuth();
  // 订阅桌面窗口状态：只要「测试」或「课堂任务」窗口处于打开状态（含最小化），即禁止答疑
  const isExamWindowOpen = useDesktopStore((state) =>
    state.windows.some(
      (w) => EXAM_BLOCKING_WINDOW_IDS.includes(w.id) && w.isOpen
    )
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialData?.question || '');
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<AiQaConfig | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayedQuestions, setDisplayedQuestions] = useState<string[]>([]);
  const hasAutoSent = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const { data } = await backendClient.get('/api/ai-qa/config');
      if (data) {
        setConfig(data);
        const questions = data.suggestedQuestions || [];
        const shuffled = [...questions].sort(() => Math.random() - 0.5);
        setDisplayedQuestions(shuffled.slice(0, 4));
      }
    } catch (err) {
      console.error('获取配置失败:', err);
    }
  };

  // 监听外部传入的问题事件（窗口已打开时也能接收新问题并自动发送）
  useEffect(() => {
    const handleSetQuestion = (e: any) => {
      if (e.detail?.question) {
        // 设置输入框内容
        setInput(e.detail.question);
        // 如果有autoSend标志，等待输入框更新后自动发送
        if (e.detail.autoSend) {
          setTimeout(() => {
            // 直接调用表单提交
            const form = document.querySelector('.aiqa-form') as HTMLFormElement;
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          }, 200);
        }
      }
    };
    window.addEventListener('aiqa:set-question', handleSetQuestion);
    return () => window.removeEventListener('aiqa:set-question', handleSetQuestion);
  }, []);

  // 如果有初始问题，在配置获取后自动发送
  useEffect(() => {
    if (config && initialData?.question && !hasAutoSent.current) {
      hasAutoSent.current = true;
      setTimeout(() => {
        setInput(initialData.question!);
        setTimeout(() => {
          const form = document.querySelector('.aiqa-form') as HTMLFormElement;
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }, 100);
      }, 100);
    }
  }, [config]);

  const fetchHistory = async () => {
    try {
      const { data } = await backendClient.get('/api/ai-qa/history', { limit: 20 });
      if (data) {
        setChatHistory(data);
      }
    } catch (err) {
      console.error('获取历史记录失败:', err);
    }
  };

  const handleHistoryToggle = () => {
    setShowHistory(!showHistory);
    if (!showHistory) {
      fetchHistory();
    }
  };

  const handleHistoryItemClick = (item: ChatHistoryItem) => {
    setMessages([
      { role: 'user', content: item.question },
      { role: 'assistant', content: item.answer }
    ]);
    setShowHistory(false);
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!input.trim() || isLoading) return;

    const question = input.trim();

    // 「测试」/「课堂任务」窗口打开期间禁止答疑：
    // 本地直接回复拦截提示，不请求接口、不消耗积分、不写入历史记录
    if (isExamWindowOpen) {
      setMessages([
        ...messages,
        { role: 'user', content: question },
        { role: 'assistant', content: EXAM_QA_BLOCKED_MESSAGE }
      ]);
      setInput('');
      setError(null);
      return;
    }

    const userMessage: Message = { role: 'user', content: question };
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);
    setInput('');
    setError(null);
    setIsLoading(true);

    try {
      const response = await backendClient.post('/api/ai-qa/ask', {
        question,
        history: messages.slice(-10)
      });

      if (response.data) {
        const assistantMessage: Message = { 
          role: 'assistant', 
          content: response.data.answer,
          timestamp: new Date().toISOString()
        };
        setMessages([...currentMessages, assistantMessage]);
        
        if (response.data.profile) {
          await refreshProfile();
        }
      } else {
        setError(response.error || '获取回答失败');
      }
    } catch (err: any) {
      console.error('提问失败:', err);
      setError(err.message || '网络错误，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-xl">
            🤖
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">AI答疑</h2>
            {config && (
              <p className="text-sm text-gray-500">
                每次提问消耗 {config.pointsPerQuestion} 积分
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleHistoryToggle}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <i className="fa-solid fa-clock-rotate-left mr-1"></i>
            历史
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <i className="fa-solid fa-trash mr-1"></i>
            清空
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <i className="fa-solid fa-times mr-1"></i>
            关闭
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">历史记录</h3>
          {chatHistory.length === 0 ? (
            <div className="text-center text-gray-500 py-10">
              <i className="fa-solid fa-inbox text-4xl mb-3"></i>
              <p>暂无历史记录</p>
            </div>
          ) : (
            <div className="space-y-3">
              {chatHistory.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleHistoryItemClick(item)}
                  className="p-4 border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-medium text-gray-800">
                      {item.question.length > 50 ? item.question.slice(0, 50) + '...' : item.question}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(item.created_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-16">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-3xl">
                  🤖
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">欢迎使用AI答疑</h3>
                <p className="text-gray-500 max-w-md mx-auto">
                  我是江苏省高中信息技术专属答疑老师，请提出你的问题，我会为你解答！
                </p>
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                  {displayedQuestions.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => setInput(q)}
                      className="p-3 bg-gray-50 hover:bg-gray-100 rounded-xl text-left transition-colors"
                    >
                      <i className="fa-solid fa-question-circle text-blue-500 mr-2"></i>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-4 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-blue-500 text-white rounded-tr-sm'
                      : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-800 p-4 rounded-2xl rounded-tl-sm">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div className="text-center py-4">
                <div className="inline-block px-4 py-2 bg-red-100 text-red-700 rounded-lg">
                  <i className="fa-solid fa-triangle-exclamation mr-2"></i>
                  {error}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 border-t border-gray-200">
            <form onSubmit={handleSubmit} className="aiqa-form max-w-4xl mx-auto">
              <div className="flex items-end gap-3">
                <div className="flex-1 bg-gray-100 rounded-xl border border-gray-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="请输入你的问题... (Shift+Enter换行)"
                    className="aiqa-input w-full p-4 bg-transparent resize-none focus:outline-none rounded-xl"
                    rows={1}
                    disabled={isLoading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !input.trim() || !!(config && profile && profile.current_points < config.pointsPerQuestion)}
                  className="px-6 py-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                >
                  {isLoading ? (
                    <i className="fa-solid fa-spinner fa-spin"></i>
                  ) : (
                    <i className="fa-solid fa-paper-plane"></i>
                  )}
                </button>
              </div>
              {config && profile && (
                <div className="mt-2 text-sm text-gray-500 flex justify-between items-center">
                  <span>
                    当前积分: <span className="font-bold text-blue-600">{profile.current_points}</span>
                  </span>
                  {profile.current_points < config.pointsPerQuestion && (
                    <span className="text-red-500">
                      积分不足！需要 {config.pointsPerQuestion} 积分
                    </span>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
