import React, { useState } from 'react';
import { Challenge } from '../../../types/python-magic';
import { backendClient } from '../../../api/backendClient';
import { useAuth } from '../../../hooks/useAuth';

interface CodeChallengeProps {
  challenge: Challenge;
  onComplete: (challengeId: string) => void;
}

export function CodeChallenge({ challenge, onComplete }: CodeChallengeProps) {
  const { user } = useAuth();
  const [code, setCode] = useState(challenge.template);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [error, setError] = useState('');
  const [userInput, setUserInput] = useState('');

  const handleRun = async () => {
    setLoading(true);
    setOutput('');
    setError('');

    try {
      const res = await backendClient.post('/api/python/run', { code, input: userInput });
      const data = res?.data;
      if (data) {
        setOutput(data.output || '');
        if (!data.success && data.error) {
          setError(data.error);
        }
      }
    } catch (err: any) {
      setError(err?.message || '运行代码时出错，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = () => {
    onComplete(challenge.id);
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      {/* 标题与描述 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{challenge.title}</h3>
        <p className="mt-1 text-sm text-gray-600">{challenge.description}</p>
      </div>

      {/* 代码编辑器 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">代码</label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="min-h-[200px] w-full rounded-md border border-gray-300 bg-gray-50 p-3 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="在此输入 Python 代码..."
          spellCheck={false}
        />
      </div>

      {/* 输入数据 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">
          输入数据
          <span className="ml-1 text-xs text-gray-400">（运行 input() 时使用的数据，每行一个值）</span>
        </label>
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          className="min-h-[60px] w-full rounded-md border border-gray-300 bg-white p-2 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="例如：&#10;张三&#10;18"
          spellCheck={false}
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleRun}
          disabled={loading || !code.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              运行中...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              运行代码
            </>
          )}
        </button>

        <button
          onClick={() => setShowHint((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {showHint ? '隐藏提示' : '查看提示'}
        </button>

        <div className="flex-1" />

        <button
          onClick={handleComplete}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          完成挑战
        </button>
      </div>

      {/* 提示信息 */}
      {showHint && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <span className="font-medium">提示：</span>
          {challenge.hint}
        </div>
      )}

      {/* 代码输出 */}
      {(output || error) && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">输出结果</span>
          <pre className="max-h-64 overflow-auto rounded-md border border-gray-300 bg-gray-950 p-3 font-mono text-sm text-green-400">
            {output || (error ? '' : '')}
            {error && (
              <span className="text-red-400">{error}</span>
            )}
          </pre>
        </div>
      )}

      {/* XP 奖励信息 */}
      <div className="rounded-md bg-purple-50 border border-purple-200 px-3 py-2 text-sm text-purple-700">
        完成此挑战可获得 <span className="font-semibold">{challenge.xpReward} XP</span>
        {user && `（当前用户：${user.email || user.id}）`}
      </div>
    </div>
  );
}
