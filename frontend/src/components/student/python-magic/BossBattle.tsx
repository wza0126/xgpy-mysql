import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BossBattle as BossBattleType } from '../../../types/python-magic';
import { backendClient } from '../../../api/backendClient';

interface BossBattleProps {
  boss: BossBattleType;
  onComplete: (bossId: string) => void;
}

export function BossBattle({ boss, onComplete }: BossBattleProps) {
  const [code, setCode] = useState(boss.template);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bossHp, setBossHp] = useState(100);
  const [defeated, setDefeated] = useState(false);
  const [showVictory, setShowVictory] = useState(false);
  const [timeLeft, setTimeLeft] = useState(boss.timeLimit ?? 0);
  const [showHint, setShowHint] = useState(false);
  const [combo, setCombo] = useState(0);
  const [userInput, setUserInput] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasTimer = (boss.timeLimit ?? 0) > 0;

  useEffect(() => {
    if (hasTimer && !defeated) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasTimer, defeated]);

  const handleRun = useCallback(async () => {
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
          setCombo(0);
        } else {
          const passed = checkPass(data.output);
          console.log('[BossBattle] checkPass:', { passed, output: data.output, expected: boss.expectedOutput });
          if (passed) {
            const newHp = Math.max(0, bossHp - 25);
            setBossHp(newHp);
            setCombo((prev: number) => prev + 1);
            if (newHp <= 0) {
              setDefeated(true);
              setTimeout(() => setShowVictory(true), 600);
            }
          }
        }
      }
    } catch (err: any) {
      setError(err?.message || '运行代码时出错，请稍后重试');
      setCombo(0);
    } finally {
      setLoading(false);
    }
  }, [code, bossHp, userInput]);

  const checkPass = (out: string): boolean => {
    if (boss.expectedOutput) {
      const normalizedOutput = out.trim().replace(/\r\n/g, '\n');
      const normalizedExpected = boss.expectedOutput.trim().replace(/\r\n/g, '\n');
      return normalizedOutput.includes(normalizedExpected);
    }
    return true;
  };

  const handleComplete = () => {
    onComplete(boss.id);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const hpBarColor = bossHp > 50 ? 'bg-red-500' : bossHp > 25 ? 'bg-orange-500' : 'bg-yellow-500';

  return (
    <div className="relative overflow-hidden rounded-xl border-2 border-red-800/60 bg-gray-950 shadow-2xl">
      {/* 火焰装饰背景 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-orange-900/20 to-transparent" />
        <div className="absolute left-4 top-0 h-full w-1 bg-gradient-to-b from-red-500/0 via-red-500/20 to-red-500/0" />
        <div className="absolute right-4 top-0 h-full w-1 bg-gradient-to-b from-red-500/0 via-red-500/20 to-red-500/0" />
        {/* 火焰粒子 */}
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute h-2 w-2 animate-ping rounded-full opacity-30"
            style={{
              backgroundColor: ['#ef4444', '#f97316', '#eab308'][i % 3],
              left: `${15 + i * 14}%`,
              bottom: `${10 + Math.random() * 20}%`,
              animationDelay: `${i * 0.4}s`,
              animationDuration: `${1.5 + Math.random()}s`,
            }}
          />
        ))}
      </div>

      {/* 头部 - Boss 信息 */}
      <div className="relative border-b-2 border-red-800/60 bg-gradient-to-r from-red-950 via-red-900/80 to-red-950 px-6 py-4">
        <div className="flex items-center gap-4">
          {/* Boss 头像 */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-yellow-500/60 bg-gradient-to-br from-red-700 to-orange-800 text-3xl shadow-lg shadow-red-900/50">
            🐉
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-wide text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.3)]">
              {boss.title}
            </h2>
            <p className="mt-1 text-sm text-red-300/80">{boss.description}</p>
          </div>
          {/* 倒计时 */}
          {hasTimer && (
            <div className="flex shrink-0 flex-col items-center">
              <span className="text-xs text-red-400/70 uppercase tracking-wider">时间</span>
              <span
                className={`font-mono text-2xl font-bold tabular-nums ${
                  timeLeft <= 10 ? 'text-red-400 animate-pulse' : 'text-yellow-400'
                }`}
              >
                {formatTime(timeLeft)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 血条区域 */}
      <div className="relative border-b border-red-900/40 bg-gradient-to-r from-red-950/50 to-orange-950/50 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-sm font-bold text-red-400">HP</span>
          <div className="relative h-5 flex-1 overflow-hidden rounded-full border border-red-700/60 bg-gray-900">
            <div
              className={`h-full transition-all duration-700 ease-out ${hpBarColor}`}
              style={{ width: `${bossHp}%` }}
            >
              <div className="h-full w-full bg-gradient-to-r from-white/10 to-transparent" />
            </div>
            {/* 血条光泽 */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent" />
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              {bossHp} / 100
            </span>
          </div>
          <span className="text-xs text-yellow-500/80">
            {combo > 0 && `连击 x${combo}`}
          </span>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="relative grid gap-6 p-6 md:grid-cols-2">
        {/* 左侧：代码编辑器 */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-yellow-400/90">⚔ 释放你的代码</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="min-h-[240px] w-full resize-none rounded-lg border border-red-800/40 bg-gray-900 p-4 font-mono text-sm leading-relaxed text-green-300 placeholder-gray-600 caret-yellow-400 focus:border-yellow-600/60 focus:outline-none focus:ring-1 focus:ring-yellow-600/30"
            placeholder="在此输入 Python 代码..."
            spellCheck={false}
          />

          {/* 输入数据 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-yellow-400/70">
              输入数据
              <span className="ml-1 text-gray-500">（运行 input() 时使用的数据，每行一个值）</span>
            </label>
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              className="min-h-[60px] w-full resize-none rounded-lg border border-red-800/40 bg-gray-900/80 p-3 font-mono text-sm leading-relaxed text-green-300 placeholder-gray-600 caret-yellow-400 focus:border-yellow-600/60 focus:outline-none focus:ring-1 focus:ring-yellow-600/30"
              placeholder="例如：&#10;10&#10;5&#10;+"
              spellCheck={false}
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRun}
              disabled={loading || !code.trim() || defeated}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-600 to-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-900/40 transition-all hover:from-red-500 hover:to-orange-500 hover:shadow-red-800/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  施法中...
                </>
              ) : (
                <>
                  <span>⚡</span>
                  释放法术
                </>
              )}
            </button>

            <button
              onClick={() => setShowHint((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-700/50 bg-yellow-900/20 px-4 py-2.5 text-sm font-medium text-yellow-400 transition-all hover:bg-yellow-900/40"
            >
              {showHint ? '🙈 隐藏线索' : '📜 查看线索'}
            </button>
          </div>

          {/* 提示 */}
          {showHint && (
            <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/20 p-3 text-sm text-yellow-300/90">
              <span className="font-bold text-yellow-400">💡 线索：</span>
              {boss.hint}
            </div>
          )}

          {/* XP 奖励 */}
          <div className="rounded-lg border border-purple-800/40 bg-purple-900/20 px-3 py-2 text-sm text-purple-300">
            💎 击败 Boss 可获得 <span className="font-bold text-purple-200">{boss.xpReward} XP</span>
          </div>
        </div>

        {/* 右侧：输出结果 */}
        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-yellow-400/90">📟 战斗日志</span>
          <div className="flex-1 rounded-lg border border-red-800/40 bg-gray-900 p-4 font-mono text-sm leading-relaxed">
            {output || error ? (
              <div className="space-y-1">
                {output && (
                  <div className="text-green-300/90 whitespace-pre-wrap">{output}</div>
                )}
                {error && (
                  <div className="text-red-400">{error}</div>
                )}
              </div>
            ) : (
              <span className="text-gray-600">等待你的法术...</span>
            )}
            {/* 空状态占位 */}
            {!output && !error && (
              <div className="mt-8 flex flex-col items-center gap-2 text-gray-700">
                <span className="text-2xl">⚔️</span>
                <span className="text-sm">编写代码，释放法术攻击 Boss</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 击败 Boss 胜利弹窗 */}
      {showVictory && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80 backdrop-blur-sm">
          <div className="animate-bounce-in mx-4 flex max-w-md flex-col items-center gap-4 rounded-2xl border-2 border-yellow-500/60 bg-gradient-to-b from-yellow-900/90 to-orange-900/90 p-8 text-center shadow-2xl shadow-yellow-900/50">
            {/* 火焰光环 */}
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/30" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 to-orange-600 text-4xl shadow-lg">
                👑
              </div>
            </div>
            <h3 className="text-3xl font-black text-yellow-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.5)]">
              击败 Boss！
            </h3>
            <p className="text-sm text-yellow-200/80">
              你成功击败了 <span className="font-bold text-yellow-300">{boss.title}</span>，获得了丰厚的奖励！
            </p>
            <div className="flex items-center gap-2 rounded-full border border-yellow-600/40 bg-yellow-800/30 px-5 py-2 text-yellow-300">
              <span>💎</span>
              <span className="font-bold">+{boss.xpReward} XP</span>
            </div>
            <button
              onClick={handleComplete}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-yellow-500 to-orange-500 px-8 py-3 text-lg font-bold text-white shadow-lg transition-all hover:from-yellow-400 hover:to-orange-400"
            >
              领取奖励
              <span>→</span>
            </button>
          </div>
        </div>
      )}

      {/* 倒计时结束 */}
      {hasTimer && timeLeft === 0 && !defeated && !showVictory && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80 backdrop-blur-sm">
          <div className="mx-4 flex max-w-sm flex-col items-center gap-4 rounded-2xl border-2 border-red-700/60 bg-gradient-to-b from-red-900/90 to-gray-900/90 p-8 text-center shadow-2xl shadow-red-900/50">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-gray-800 text-4xl">
              💀
            </div>
            <h3 className="text-3xl font-black text-red-400">时间耗尽！</h3>
            <p className="text-sm text-red-300/70">Boss 太强大了，你需要更快地释放法术...</p>
            <button
              onClick={() => {
                setTimeLeft(boss.timeLimit ?? 0);
                setBossHp(100);
                setDefeated(false);
                setOutput('');
                setError('');
                setCombo(0);
                setShowVictory(false);
              }}
              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-red-600/60 bg-red-900/40 px-6 py-2.5 text-sm font-bold text-red-300 transition-all hover:bg-red-800/50"
            >
              重新挑战
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
