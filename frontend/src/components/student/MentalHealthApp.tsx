import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';

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

export function MentalHealthApp({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userType, setUserType] = useState<'student' | 'parent' | 'teacher'>('student');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchHistory = async () => {
    try {
      const { data } = await backendClient.get('/api/mental-health/history', { limit: 20 });
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

    const userMessage: Message = { role: 'user', content: input.trim() };
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);
    setInput('');
    setError(null);
    setIsLoading(true);

    try {
      const response = await backendClient.post('/api/mental-health/chat', {
        message: input.trim(),
        userType: userType,
        history: messages.slice(-10)
      });

      if (response.data) {
        const assistantMessage: Message = { 
          role: 'assistant', 
          content: response.data.answer,
          timestamp: new Date().toISOString()
        };
        setMessages([...currentMessages, assistantMessage]);
        
        if (response.data.alertGenerated) {
          alert('您的对话已触发心理健康预警，学校心理老师将关注您的情况。');
        }
        
        if (response.data.profile) {
          await refreshProfile();
        }
      } else {
        setError(response.error || '获取回答失败');
      }
    } catch (err: any) {
      console.error('咨询失败:', err);
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

  const getWelcomeMessage = () => {
    switch (userType) {
      case 'student':
        return '你好！我是你的心理健康咨询师。我在这里倾听你的心声，帮你解答学业压力、人际关系、情绪调节等方面的问题。请放心，我们的对话是保密的。';
      case 'parent':
        return '您好！我是高中心理健康咨询师。我可以帮助您更好地理解青春期孩子的心理特点，提供亲子沟通的建议。';
      case 'teacher':
        return '您好！我是高中心理健康咨询师。我可以提供班级心理建设、学生心理问题识别与干预的建议。';
      default:
        return '你好！我是你的心理健康咨询师。';
    }
  };

  const getQuickQuestions = () => {
    switch (userType) {
      case 'student':
        return [
          '最近学习压力很大，有点焦虑怎么办？',
          '和同学闹矛盾了，心情很差',
          '总是失眠，上课没精神',
          '考试紧张，发挥失常怎么办？'
        ];
      case 'parent':
        return [
          '孩子最近沉迷手机怎么办？',
          '如何和青春期孩子有效沟通？',
          '孩子厌学怎么办？'
        ];
      case 'teacher':
        return [
          '如何发现学生的心理问题？',
          '班级心理建设活动建议',
          '如何处理学生冲突？'
        ];
      default:
        return [];
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-teal-600 rounded-lg flex items-center justify-center text-white text-xl">
            💚
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">润心伴学</h2>
            <p className="text-sm text-gray-500">高中心理健康咨询</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-2 mr-2">
            <span className="text-sm text-gray-600">我是:</span>
            <select
              value={userType}
              onChange={(e) => setUserType(e.target.value as any)}
              className="px-2 py-1 border border-gray-300 rounded-lg text-sm"
            >
              <option value="student">学生</option>
              <option value="parent">家长</option>
              <option value="teacher">老师</option>
            </select>
          </div>
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
              <div className="text-center py-12">
                <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-teal-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white text-4xl">
                  💚
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-3">欢迎使用润心伴学</h3>
                <p className="text-gray-500 max-w-lg mx-auto mb-8">
                  {getWelcomeMessage()}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                  {getQuickQuestions().map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => setInput(q)}
                      className="p-4 bg-green-50 hover:bg-green-100 rounded-xl text-left transition-colors border border-green-100"
                    >
                      <i className="fa-solid fa-comment-dots text-green-600 mr-2"></i>
                      <span className="text-gray-700">{q}</span>
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
                      : 'bg-green-50 text-gray-800 rounded-tl-sm border border-green-100'
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
                <div className="bg-green-50 text-gray-800 p-4 rounded-2xl rounded-tl-sm border border-green-100">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
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

          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
              <i className="fa-solid fa-shield-halved text-green-600"></i>
              <span>保密原则：您的对话内容受到保护，除非涉及自伤、伤人等危机情况</span>
            </div>
            <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
              <div className="flex items-end gap-3">
                <div className="flex-1 bg-white rounded-xl border border-gray-200 focus-within:border-green-500 focus-within:ring-1 focus-within:ring-green-500 transition-all">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="请告诉我你的感受... (Shift+Enter换行)"
                    className="w-full p-4 bg-transparent resize-none focus:outline-none rounded-xl"
                    rows={1}
                    disabled={isLoading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="px-6 py-4 bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl transition-all"
                >
                  {isLoading ? (
                    <i className="fa-solid fa-spinner fa-spin"></i>
                  ) : (
                    <i className="fa-solid fa-paper-plane"></i>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
