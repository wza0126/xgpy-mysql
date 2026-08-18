import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Question } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { toDatabaseDateTime } from '../../utils/dateUtils';
import { sanitizeHtml, htmlToPlainText } from '../../utils/htmlUtils';

// 工具函数：与 PracticeModule 保持一致
const parseJsonField = (field: any) => {
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
  return parsed?.options || parsed || [];
};

const getAnswers = (answers: any): string[] => {
  const parsed = parseJsonField(answers);
  return parsed?.answers || parsed || [];
};

const parseTags = (tags: any): string[] => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
  }
  return [];
};

const normalizeAnswer = (ans: string): string => ans.toLowerCase().trim();

const checkChoiceAnswer = (userAnswer: string, correctAnswers: string[]): boolean => {
  return correctAnswers.some(ca => normalizeAnswer(ca) === normalizeAnswer(userAnswer));
};

interface SimilarPracticeWindowProps {
  initialData?: { questionId?: string };
  onClose?: () => void;
}

export const SimilarPracticeWindow: React.FC<SimilarPracticeWindowProps> = ({ initialData, onClose }) => {
  const { profile } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [originQuestion, setOriginQuestion] = useState<Question | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState<string>(''); // cluster / fallback / none
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [sessionStats, setSessionStats] = useState({ correct: 0, total: 0 });

  useEffect(() => {
    if (!initialData?.questionId) {
      setError('缺少题目ID');
      setLoading(false);
      return;
    }
    loadSimilarQuestions(initialData.questionId);
  }, [initialData?.questionId]);

  const loadSimilarQuestions = async (qid: string) => {
    setLoading(true);
    setError('');
    try {
      // 同时获取：原题信息（用于标题展示） + 同类题列表
      // 这里复用 from('questions') 拿原题
      const { data: originData } = await backendClient
        .from('questions')
        .select('*')
        .eq('id', qid)
        .maybeSingle();

      if (originData) {
        setOriginQuestion(originData as Question);
      }

      // 调用同类题接口
      const result = await backendClient.get(`/api/practice/similar/${encodeURIComponent(qid)}`, { limit: 5 });
      if (result.error) {
        throw new Error(result.error);
      }
      const data = result.data || {};
      const list: Question[] = data.questions || [];
      setQuestions(list);
      setSource(data.source || 'none');
      setClusterId(data.cluster_id || null);
      setCurrentIndex(0);
      setSelectedAnswer('');
      setShowResult(false);
      setIsCorrect(false);
      setSessionStats({ correct: 0, total: 0 });
      if (list.length === 0) {
        setError('暂无同类题，请教师在题库管理模块对题目进行AI聚类后重试');
      }
    } catch (e: any) {
      setError(e.message || '加载同类题失败');
    } finally {
      setLoading(false);
    }
  };

  const currentQuestion = questions[currentIndex];

  const handleSubmit = async () => {
    if (!currentQuestion || !profile) return;
    const correctAnswers = getAnswers(currentQuestion.answers);
    let correct = false;
    if (currentQuestion.type === 'choice') {
      correct = checkChoiceAnswer(selectedAnswer, correctAnswers);
    } else if (currentQuestion.type === 'fill_blank') {
      correct = correctAnswers.some(ca => normalizeAnswer(ca) === normalizeAnswer(selectedAnswer));
    }
    setIsCorrect(correct);
    setShowResult(true);
    setSessionStats(prev => ({
      correct: prev.correct + (correct ? 1 : 0),
      total: prev.total + 1,
    }));

    // 记录答题（不计入正式练习统计，仅作答错时入错题集）
    try {
      await backendClient.from('student_answers').insert({
        id: `ans_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        student_id: profile.id,
        question_id: currentQuestion.id,
        answer: selectedAnswer,
        is_correct: correct,
        source: 'similar_practice',
        created_at: toDatabaseDateTime(new Date()),
      });

      // 做错自动加入错题集（方便后续在错题集里继续强化）
      if (!correct) {
        const wrongId = `wq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        await backendClient.from('wrong_questions').insert({
          id: wrongId,
          student_id: profile.id,
          question_id: currentQuestion.id,
          wrong_answer: selectedAnswer,
          source: 'similar_practice',
          created_at: toDatabaseDateTime(new Date()),
          resolved: false,
        });
      }
    } catch (e) {
      // 记录失败不影响继续练习
      console.error('记录同类题答题失败', e);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer('');
      setShowResult(false);
      setIsCorrect(false);
    }
  };

  const handleAiQa = () => {
    if (!currentQuestion) return;
    let questionText = htmlToPlainText(currentQuestion.content || '');
    if (currentQuestion.type === 'choice' && currentQuestion.options) {
      const options = getOptions(currentQuestion.options);
      questionText += '\n' + options.map((o: string, i: number) => `${String.fromCharCode(65 + i)}. ${htmlToPlainText(o)}`).join('\n');
    }
    (window as any).openAiQaWindow?.({ question: questionText });
  };

  // 渲染状态
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-gray-500">
          <i className="fa-solid fa-circle-notch fa-spin"></i>
          正在加载同类题...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <i className="fa-solid fa-circle-exclamation text-4xl text-amber-400 mb-3"></i>
        <p className="text-gray-700 mb-4">{error}</p>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            关闭
          </button>
        )}
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-gray-700 mb-4">暂无同类题</p>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            关闭
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-y-auto">
      {/* 头部信息 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-2 py-1 bg-cyan-100 text-cyan-700 text-xs rounded-full flex items-center gap-1">
              <i className="fa-solid fa-layer-group"></i>
              同类题强化练习
            </span>
            <span className="text-sm text-gray-500">
              题目 {currentIndex + 1} / {questions.length}
            </span>
            <span className="text-sm text-gray-500">
              本次: {sessionStats.correct} / {sessionStats.total}
            </span>
            {clusterId && (
              <span className="text-xs text-gray-400" title="AI 聚类ID（内部用）">
                <i className="fa-solid fa-tag"></i> {clusterId}
              </span>
            )}
            {originQuestion && (
              <span className="text-xs text-gray-400">
                源自: {(originQuestion.content || '').replace(/<[^>]+>/g, '').slice(0, 30)}...
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 题目卡片 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQuestion.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <div className="flex items-start gap-2 mb-4">
              {parseTags(currentQuestion.tags).map((tag, idx) => (
                <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                  {tag}
                </span>
              ))}
            </div>

            <div className="text-lg font-medium text-gray-800 mb-6 leading-relaxed question-rich-content">
              <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.content || '') }} />
            </div>

            {currentQuestion.type === 'choice' && currentQuestion.options && (
              <div className="space-y-3">
                {getOptions(currentQuestion.options).map((option: string, index: number) => {
                  const optionLetter = String.fromCharCode(65 + index);
                  const isSelected = selectedAnswer === optionLetter;
                  const correctAnswers = getAnswers(currentQuestion.answers);
                  const isCorrectOption = correctAnswers.some((a: string) => a.toUpperCase().trim() === optionLetter);
                  let borderClass = 'border-gray-200 hover:border-blue-300';
                  let bgClass = '';
                  if (showResult) {
                    if (isCorrectOption) {
                      borderClass = 'border-green-500';
                      bgClass = 'bg-green-50';
                    } else if (isSelected && !isCorrectOption) {
                      borderClass = 'border-red-500';
                      bgClass = 'bg-red-50';
                    }
                  } else if (isSelected) {
                    borderClass = 'border-blue-500';
                    bgClass = 'bg-blue-50';
                  }
                  return (
                    <button
                      key={index}
                      onClick={() => !showResult && setSelectedAnswer(optionLetter)}
                      disabled={showResult}
                      className={`w-full p-4 rounded-lg border-2 text-left transition-all ${borderClass} ${bgClass} ${showResult ? 'cursor-not-allowed' : ''}`}
                    >
                      <span className="font-medium mr-2 align-top">{optionLetter}.</span>
                      <span className="inline-block question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(option) }} />
                    </button>
                  );
                })}
              </div>
            )}

            {currentQuestion.type === 'fill_blank' && (
              <div className="mt-4">
                <input
                  type="text"
                  value={selectedAnswer}
                  onChange={(e) => !showResult && setSelectedAnswer(e.target.value)}
                  disabled={showResult}
                  placeholder="请输入答案"
                  className="w-full p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {showResult && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-6 p-4 rounded-lg ${isCorrect ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <i className={`fa-solid ${isCorrect ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500'} text-xl`}></i>
              <span className={`font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                {isCorrect ? '回答正确!' : '回答错误!'}
              </span>
              {!isCorrect && (
                <span className="text-sm text-gray-600">
                  正确答案: {getAnswers(currentQuestion.answers).join(' / ')}
                </span>
              )}
            </div>
            {currentQuestion.explanation && (
              <div className="text-gray-700">
                <p className="font-medium mb-1">答案解析:</p>
                <div className="leading-relaxed bg-gray-50 p-3 rounded-lg question-rich-content">
                  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.explanation) }} />
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* 操作按钮 */}
        <div className="mt-6 flex justify-end gap-3">
          {currentQuestion && (
            <button
              onClick={handleAiQa}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-2"
            >
              <i className="fa-solid fa-robot"></i>
              AI答疑
            </button>
          )}
          {!showResult ? (
            <button
              onClick={handleSubmit}
              disabled={!selectedAnswer}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              提交答案
            </button>
          ) : currentIndex < questions.length - 1 ? (
            <button
              onClick={handleNext}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              下一题
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
            >
              完成练习
            </button>
          )}
        </div>
      </div>

      {/* 底部提示 */}
      <div className="mt-4 text-center text-xs text-gray-400">
        <i className="fa-solid fa-circle-info mr-1"></i>
        同类题强化练习不计入正式统计，做错的题会自动加入错题集
      </div>
    </div>
  );
};
