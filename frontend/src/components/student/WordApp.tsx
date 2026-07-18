import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';
import { toDatabaseDateTime } from '../../utils/dateUtils';

interface Word {
  id: string;
  word: string;
  phonetic: string;
  meaning: string;
  example: string;
  level: 'easy' | 'medium' | 'hard';
}

interface WordProgress {
  word_id: string;
  status: 'new' | 'learning' | 'review' | 'mastered';
  correct_count: number;
  wrong_count: number;
}

type PracticeMode = 'learn' | 'review' | 'test';

export function WordApp({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [wordProgress, setWordProgress] = useState<Map<string, WordProgress>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('learn');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [sessionStats, setSessionStats] = useState({ correct: 0, wrong: 0 });
  const [config, setConfig] = useState({ dailyGoal: 20, showExample: true });

  const fetchWords = useCallback(async () => {
    try {
      let query = backendClient.from('word_list').select('*').order('order_index', { ascending: true });
      if (selectedLevel !== 'all') {
        query = query.eq('level', selectedLevel);
      }
      const { data } = await query;
      setWords(data as Word[]);
    } catch (error) {
      console.error('Failed to fetch words:', error);
    }
  }, [selectedLevel]);

  const fetchProgress = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await backendClient.from('student_word_progress').select('*').eq('student_id', user.id);
      const progressMap = new Map();
      if (data) {
        data.forEach((item: any) => {
          progressMap.set(item.word_id, item);
        });
      }
      setWordProgress(progressMap);
    } catch (error) {
      console.error('Failed to fetch progress:', error);
    }
  }, [user]);

  const fetchAppConfig = useCallback(async () => {
    try {
      const { data } = await backendClient.from('apps').select('*').eq('id', 'app_word').single();
      if (data && data.config) {
        try {
          const parsed = JSON.parse(data.config);
          setConfig({
            dailyGoal: parsed.dailyGoal || 20,
            showExample: parsed.showExample !== false
          });
        } catch {
          setConfig({ dailyGoal: 20, showExample: true });
        }
      }
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  }, []);

  useEffect(() => {
    fetchWords();
    fetchProgress();
    fetchAppConfig();
  }, [fetchWords, fetchProgress, fetchAppConfig]);

  const updateProgress = async (wordId: string, isCorrect: boolean) => {
    if (!user) return;
    const existing = wordProgress.get(wordId);
    
    let newStatus = existing?.status || 'new';
    let newCorrect = (existing?.correct_count || 0) + (isCorrect ? 1 : 0);
    let newWrong = (existing?.wrong_count || 0) + (!isCorrect ? 1 : 0);
    
    if (isCorrect) {
      if (newStatus === 'new') newStatus = 'learning';
      else if (newStatus === 'learning') newStatus = 'review';
      else if (newStatus === 'review') newStatus = 'mastered';
    } else {
      if (newStatus === 'mastered') newStatus = 'review';
      else if (newStatus === 'review') newStatus = 'learning';
    }

    const progressData = {
      student_id: user.id,
      word_id: wordId,
      status: newStatus,
      correct_count: newCorrect,
      wrong_count: newWrong,
      last_practiced_at: toDatabaseDateTime(new Date())
    };

    try {
      if (existing) {
        await backendClient.from('student_word_progress').update(progressData).eq('word_id', wordId).eq('student_id', user.id);
      } else {
        await backendClient.from('student_word_progress').insert({ ...progressData, id: `wp_${Date.now().toString(36)}` });
      }
      
      setWordProgress(prev => {
        const next = new Map(prev);
        next.set(wordId, { ...progressData } as WordProgress);
        return next;
      });
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  };

  const handleAnswer = (isCorrect: boolean) => {
    const currentWord = words[currentIndex];
    if (!currentWord) return;

    updateProgress(currentWord.id, isCorrect);
    setSessionStats(prev => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      wrong: prev.wrong + (isCorrect ? 0 : 1)
    }));

    setTimeout(() => {
      if (currentIndex < words.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setShowAnswer(false);
      }
    }, 500);
  };

  const currentWord = words[currentIndex];

  const getStatusBadge = (wordId: string) => {
    const progress = wordProgress.get(wordId);
    if (!progress) return null;
    
    const badges = {
      new: { text: '新词', color: 'bg-gray-100 text-gray-600' },
      learning: { text: '学习中', color: 'bg-yellow-100 text-yellow-700' },
      review: { text: '复习', color: 'bg-blue-100 text-blue-700' },
      mastered: { text: '已掌握', color: 'bg-green-100 text-green-700' }
    };
    const badge = badges[progress.status];
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge?.color}`}>
        {badge?.text}
      </span>
    );
  };

  const getLevelBadge = (level: string) => {
    const badges = {
      easy: { text: '简单', color: 'bg-green-200 text-green-800' },
      medium: { text: '中等', color: 'bg-yellow-200 text-yellow-800' },
      hard: { text: '困难', color: 'bg-red-200 text-red-800' }
    };
    const badge = badges[level as keyof typeof badges];
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge?.color || 'bg-gray-200'}`}>
        {badge?.text || level}
      </span>
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-4 border-b border-gray-200 p-4">
        <div className="flex gap-2">
          {(['learn', 'review', 'test'] as PracticeMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setPracticeMode(mode)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                practiceMode === mode
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {mode === 'learn' ? '学习' : mode === 'review' ? '复习' : '测试'}
            </button>
          ))}
        </div>
        
        <select
          value={selectedLevel}
          onChange={(e) => setSelectedLevel(e.target.value)}
          className="px-3 py-1 rounded-lg text-sm border border-gray-300 bg-white"
        >
          <option value="all">全部难度</option>
          <option value="easy">简单</option>
          <option value="medium">中等</option>
          <option value="hard">困难</option>
        </select>
      </div>

      <div className="flex-1 flex flex-col p-6">
        <div className="mb-4 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            进度: {currentIndex + 1} / {words.length}
          </div>
          <div className="flex gap-4 text-sm">
            <span className="text-green-600">✓ 正确: {sessionStats.correct}</span>
            <span className="text-red-600">✗ 错误: {sessionStats.wrong}</span>
          </div>
        </div>

        {currentWord ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="mb-4 flex gap-2">
              {getStatusBadge(currentWord.id)}
              {getLevelBadge(currentWord.level)}
            </div>

            <div className="text-5xl font-bold text-gray-800 mb-4">
              {currentWord.word}
            </div>
            
            {currentWord.phonetic && (
              <div className="text-lg text-gray-500 mb-6">
                {currentWord.phonetic}
              </div>
            )}

            <button
              onClick={() => setShowAnswer(true)}
              disabled={showAnswer}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-6"
            >
              显示答案
            </button>

            {showAnswer && (
              <div className="w-full max-w-lg">
                <div className="bg-gray-50 rounded-xl p-6 mb-4">
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">释义</h3>
                  <p className="text-gray-800">{currentWord.meaning}</p>
                </div>

                {config.showExample && currentWord.example && (
                  <div className="bg-blue-50 rounded-xl p-6 mb-6">
                    <h3 className="text-lg font-semibold text-blue-700 mb-2">例句</h3>
                    <p className="text-blue-800">{currentWord.example}</p>
                  </div>
                )}

                <div className="flex gap-4">
                  <button
                    onClick={() => handleAnswer(false)}
                    className="flex-1 py-3 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors"
                  >
                    ✗ 记不住
                  </button>
                  <button
                    onClick={() => handleAnswer(true)}
                    className="flex-1 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors"
                  >
                    ✓ 记住了
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">完成练习！</h2>
            <p className="text-gray-600">
              本次练习：正确 {sessionStats.correct} 题，错误 {sessionStats.wrong} 题
            </p>
            <button
              onClick={() => {
                setCurrentIndex(0);
                setSessionStats({ correct: 0, wrong: 0 });
                setShowAnswer(false);
              }}
              className="mt-6 px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              重新开始
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
