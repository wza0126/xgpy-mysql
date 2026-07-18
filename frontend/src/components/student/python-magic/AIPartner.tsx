import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../../../types/python-magic';
import { backendClient } from '../../../api/backendClient';

interface AIPartnerProps {
  chapterId: number;
  context?: string;
}

export function AIPartner({ chapterId, context }: AIPartnerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '你好呀！我是小智，你的AI魔法伙伴！有什么Python学习上的问题都可以问我哦～ 🧙‍♂️' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const res = await backendClient.post('/api/python-magic/chat', {
        message: trimmed,
        chapter_id: chapterId,
        ...(context ? { context } : {})
      });
      const reply = res?.data?.reply;
      if (reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      } else {
        setError('小智暂时没有回应，请稍后再试');
      }
    } catch (err: any) {
      setError(err.message || '请求失败，请检查网络连接');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900/95 backdrop-blur-sm rounded-2xl border border-gray-700/50 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-700/50 bg-gray-800/60">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-lg font-bold text-white shadow-lg shadow-cyan-500/20">
          智
        </div>
        <div>
          <h3 className="text-white font-semibold text-sm">小智 AI 魔法伙伴</h3>
          <p className="text-gray-400 text-xs">随时为你解答Python问题</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mr-2 mt-1 shadow-md shadow-cyan-500/20">
                智
              </div>
            )}
            <div
              className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-tr-sm'
                  : 'bg-gray-800 text-gray-200 rounded-tl-sm border border-gray-700/50'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ml-2 mt-1 shadow-md shadow-purple-500/20">
                我
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mr-2 mt-1 shadow-md shadow-cyan-500/20">
              智
            </div>
            <div className="bg-gray-800 text-gray-300 px-4 py-3 rounded-2xl rounded-tl-sm border border-gray-700/50">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-sm text-gray-400">小智正在思考...</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 px-4 py-2 bg-red-900/50 border border-red-700/50 rounded-lg text-red-300 text-sm">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-700/50 bg-gray-800/60">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你想问的问题..."
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-gray-700/50 border border-gray-600/50 rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white disabled:opacity-40 hover:from-cyan-400 hover:to-blue-400 transition-all shadow-lg shadow-cyan-500/20"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
