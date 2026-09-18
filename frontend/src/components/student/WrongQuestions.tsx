import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Question, WrongQuestion } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { usePoints } from '../../hooks/usePoints';
import { toDatabaseDateTime } from '../../utils/dateUtils';
import { useGameSystem, BuffInfo, SubmitResult, HonorEvent } from '../../hooks/useGameSystem';
import { HonorBadge } from './game/HonorBadge';
import { CritEffect } from './game/CritEffect';
import { sanitizeHtml, htmlToPlainText } from '../../utils/htmlUtils';
import { HonorToast } from './game/HonorToast';
import { EquipmentDropEffect } from './game/EquipmentDropEffect';
import { PetCompanion } from './game/PetCompanion';
import { useGameEventStore } from '../../store/gameEventStore';

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

const getAnswers = (answers: any): string[] => {
  const parsed = parseJsonField(answers);
  return parsed?.answers || parsed || [];
};

const getOptions = (options: any): string[] => {
  const parsed = parseJsonField(options);
  return parsed?.options || parsed || [];
};

const getCompositeSubQuestions = (answers: any): any[] => {
  const parsed = parseJsonField(answers);
  return Array.isArray(parsed) ? parsed : [];
};

const normalizeBlankAnswers = (answers: any): string[][] => {
  if (!Array.isArray(answers)) return [[]];
  if (answers.length === 0) return [[]];
  if (answers.some(item => Array.isArray(item))) {
    return answers.map(item => Array.isArray(item) ? item : item ? [item] : []);
  }
  return answers.map(item => item ? [item] : []);
};

const normalizeAnswer = (ans: string): string => {
  return ans.toLowerCase().trim();
};

const checkFillBlankAnswer = (userAnswers: string[], correctAnswers: any): boolean => {
  const normalized = normalizeBlankAnswers(correctAnswers);
  if (userAnswers.length !== normalized.length) return false;
  return userAnswers.every((userAns, idx) => {
    const correctList = normalized[idx] || [];
    return correctList.some(ca => normalizeAnswer(ca) === normalizeAnswer(userAns));
  });
};

const checkChoiceAnswer = (userAnswer: string, correctAnswers: string[], multiple: boolean): boolean => {
  if (multiple) {
    const userList = userAnswer.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).sort();
    const correctList = correctAnswers.map(s => s.trim().toUpperCase()).filter(Boolean).sort();
    return userList.length === correctList.length && userList.every((v, i) => v === correctList[i]);
  }
  return correctAnswers.some(ca => normalizeAnswer(ca) === normalizeAnswer(userAnswer));
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

interface WrongQuestionWithDetails extends WrongQuestion {
  question: Question;
}

export const WrongQuestions: React.FC = () => {
  const [wrongQuestions, setWrongQuestions] = useState<WrongQuestionWithDetails[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<WrongQuestionWithDetails | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [compositeAnswers, setCompositeAnswers] = useState<Record<number, string>>({});
  const [compositeBlankAnswers, setCompositeBlankAnswers] = useState<Record<number, string[]>>({});
  const [subQuestionResults, setSubQuestionResults] = useState<{ index: number; isCorrect: boolean; score: number }[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 同步提交锁：不依赖 React 重渲染。用 state 做锁时，页面一旦卡顿/掉帧导致不再重渲染，
  // 按钮闭包里的 isSubmitting 始终是 false，就会出现"界面卡住还能一直点提交"（同题被连点数百次）。
  const submittingRef = useRef(false);
  // 当前这一屏错题是否已提交：未切题前只允许提交一次
  const answeredQuestionIdRef = useRef<string | null>(null);
  // 连点冷却兜底（毫秒）
  const lastSubmitAtRef = useRef(0);
  const SUBMIT_COOLDOWN_MS = 1500;
  const [submitNotice, setSubmitNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unresolved'>('unresolved');
  const [pointsConfig, setPointsConfig] = useState({ correct: 10, wrong: -5 });
  const { profile, refreshProfile } = useAuth();
  const { updatePoints, getPointsConfig } = usePoints();
  const [gameResult, setGameResult] = useState<SubmitResult | null>(null);
  const [showCritEffect, setShowCritEffect] = useState(false);
  const [currentHonor, setCurrentHonor] = useState<HonorEvent | null>(null);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [currentCritStreak, setCurrentCritStreak] = useState(0);
  const [currentWrong, setCurrentWrong] = useState(0);
  const [buffs, setBuffs] = useState<BuffInfo[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const nextQuestionRef = useRef<WrongQuestionWithDetails | null>(null);
  const gameSystem = useGameSystem();

  // 同步 gameSystem.buffs 到本地状态
  useEffect(() => {
    setBuffs(gameSystem.buffs);
  }, [gameSystem.buffs]);

  useEffect(() => {
    if (profile) {
      fetchWrongQuestions();
      fetchPointsConfig();
    }
  }, [filter, profile, selectedTags]);

  const fetchPointsConfig = async () => {
    const config = await getPointsConfig();
    setPointsConfig(config);
  };

  const fetchWrongQuestions = async () => {
    if (!profile) return;
    setLoading(true);

    let query = backendClient
      .from('wrong_questions')
      .select('*')
      .eq('student_id', profile.id);

    if (filter === 'unresolved') {
      query = query.eq('is_resolved', false);
    }

    const { data: wrongData, error: wrongError } = await query.order('last_wrong_at', { ascending: false });

    if (wrongError) {
      console.error('获取错题失败:', wrongError);
      setLoading(false);
      return;
    }

    if (wrongData && wrongData.length > 0) {
      // 获取所有相关题目详情
      const questionIds = wrongData.map(wq => wq.question_id).filter(Boolean);
      const { data: questionsData } = await backendClient
        .from('questions')
        .select('*')
        .in('id', questionIds);

      const questionMap = new Map(questionsData?.map(q => [q.id, q]) || []);

      // 找出已删除题目的错题记录ID，自动标记为已解决
      const deletedWrongIds = wrongData
        .filter(wq => !questionMap.has(wq.question_id))
        .map(wq => wq.id);
      
      if (deletedWrongIds.length > 0) {
        await backendClient
          .from('wrong_questions')
          .update({ is_resolved: true })
          .in('id', deletedWrongIds);
      }

      // 过滤掉已删除的题目，只保留存在的题目
      let wrongWithDetails = wrongData
        .filter(wq => questionMap.has(wq.question_id))
        .map(wq => ({
          ...wq,
          question: questionMap.get(wq.question_id) as Question,
        })) as WrongQuestionWithDetails[];

      // 收集所有标签
      const tagsSet = new Set<string>();
      wrongWithDetails.forEach(wq => {
        const tags = parseTags(wq.question.tags);
        tags.forEach(tag => tagsSet.add(tag));
      });
      setAllTags(Array.from(tagsSet).sort());

      // 根据标签筛选
      if (selectedTags.length > 0) {
        wrongWithDetails = wrongWithDetails.filter(wq => {
          const tags = parseTags(wq.question.tags);
          return selectedTags.some(tag => tags.includes(tag));
        });
      }

      setWrongQuestions(wrongWithDetails);
    } else {
      setWrongQuestions([]);
      setAllTags([]);
    }
    setLoading(false);
  };

  const handlePractice = (wq: WrongQuestionWithDetails) => {
    const index = wrongQuestions.findIndex(item => item.id === wq.id);
    setCurrentQuestionIndex(index);
    setSelectedQuestion(wq);
    setSelectedAnswer('');
    setCompositeAnswers({});
    setCompositeBlankAnswers({});
    setSubQuestionResults([]);
    setShowResult(false);
    setSubmitNotice('');
    answeredQuestionIdRef.current = null;
  };

  const handleSubmit = async () => {
    if (!selectedQuestion || !profile) return;

    // 同步拦截（不依赖 state 是否已刷新）
    if (submittingRef.current) return;
    if (answeredQuestionIdRef.current === selectedQuestion.question_id) {
      setSubmitNotice('本题已提交，请点击「下一题」继续。同一道题重复提交不再计分。');
      return;
    }
    if (Date.now() - lastSubmitAtRef.current < SUBMIT_COOLDOWN_MS) return;

    submittingRef.current = true;
    lastSubmitAtRef.current = Date.now();
    setIsSubmitting(true);
    setSubmitNotice('');

    let correct = false;
    let answerText = '';
    let pointsChange = 0;
    let subResults: { index: number; isCorrect: boolean; score: number }[] = [];

    if (selectedQuestion.question.type === 'composite') {
      const subQs = getCompositeSubQuestions(selectedQuestion.question.answers);
      subResults = subQs.map((sq: any, idx: number) => {
        let sqCorrect = false;
        if (sq.type === 'choice') {
          const userAns = compositeAnswers[idx] || '';
          sqCorrect = checkChoiceAnswer(userAns, sq.answers || [], sq.multiple || false);
        } else if (sq.type === 'fill_blank') {
          const userAns = compositeBlankAnswers[idx] || [];
          sqCorrect = checkFillBlankAnswer(userAns, sq.answers || []);
        }
        return {
          index: idx,
          isCorrect: sqCorrect,
          score: sqCorrect ? (sq.score || 0) : 0
        };
      });
      
      correct = subResults.every(r => r.isCorrect);
      answerText = JSON.stringify({
        choice_answers: compositeAnswers,
        blank_answers: compositeBlankAnswers,
        sub_results: subResults
      });
      pointsChange = correct ? pointsConfig.correct : pointsConfig.wrong;
    } else {
      if (!selectedAnswer) {
        setIsSubmitting(false);
        return;
      }
      const answerTrimmed = selectedAnswer.trim();
      if (!answerTrimmed) {
        alert('请输入答案');
        setIsSubmitting(false);
        return;
      }

      const correctAnswers = getAnswers(selectedQuestion.question.answers);
      correct = correctAnswers.some(
        (ans: string) => normalizeAnswer(ans) === normalizeAnswer(answerTrimmed)
      );
      answerText = answerTrimmed;
      pointsChange = correct ? pointsConfig.correct : pointsConfig.wrong;
    }

    // 预计算下一题（同步，不依赖异步 state）
    if (correct) {
      const newList = wrongQuestions.filter(wq => wq.id !== selectedQuestion.id);
      nextQuestionRef.current = currentQuestionIndex < newList.length ? newList[currentQuestionIndex] : null;
    } else {
      nextQuestionRef.current = currentQuestionIndex + 1 < wrongQuestions.length
        ? wrongQuestions[currentQuestionIndex + 1]
        : null;
    }

    try {
      // 先调用 API，成功后再显示结果（参考练习模块模式）
      const result = await backendClient.businessSubmitAnswer({
        student_id: profile.id,
        question_id: selectedQuestion.question_id,
        answer: answerText,
        is_correct: correct,
        points_change: pointsChange,
        source: 'practice',
      });

      if (result.error) {
        throw new Error(result.error);
      }

      // API成功后才显示结果，避免等待API时的卡顿
      setIsCorrect(correct);
      setShowResult(true);
      // 锁定本题，未切题前不再允许提交
      answeredQuestionIdRef.current = selectedQuestion.question_id;
      // 掌握门禁回执：已达掌握阈值 → 不再计分
      const gateData = result.data as any;
      if (gateData?.rewarded === false) {
        setSubmitNotice(
          gateData.reward_blocked_reason === 'wrong_limit'
            ? '本题错误次数较多，本次不再扣分'
            : '本题已掌握，本次不再计分、不掉装备'
        );
      }
      if (subResults.length > 0) {
        setSubQuestionResults(subResults);
      }

      // 更新本地用户信息
      if (result.data?.student) {
        refreshProfile();
      }

      // 提取游戏系统数据
      if (result.data) {
        const gameData = result.data as any;
        setGameResult(gameData as unknown as SubmitResult);
        if (gameData.is_crit) {
          setShowCritEffect(true);
        }
        if (gameData.new_honor) {
          setCurrentHonor(gameData.new_honor);
        }
        setCurrentStreak(gameData.current_streak || 0);
        setCurrentCritStreak(gameData.current_crit_streak || 0);
        setCurrentWrong(gameData.current_wrong || 0);
        gameSystem.fetchBuffs().then(data => { if (data) setBuffs(data); });

        const emitEvent = useGameEventStore.getState().emitEvent;
        if (correct) {
          if (gameData.is_crit) {
            emitEvent('crit');
          } else if (gameData.new_honor?.type === 'perfect_10') {
            emitEvent('perfect_10');
          } else {
            emitEvent('correct');
          }
        } else {
          emitEvent('wrong');
        }

        // 检查装备掉落
        const droppedEquipments = result.data?.dropped_equipments || [];
        if (droppedEquipments.length > 0) {
          emitEvent('equipment_drop', { equipments: droppedEquipments });
        }
      }

      // API成功后再更新错题列表（此时动画已经开始，不会被中断）
      if (correct) {
        const newList = wrongQuestions.filter(wq => wq.id !== selectedQuestion.id);
        setWrongQuestions(newList);
        try {
          await backendClient
            .from('wrong_questions')
            .update({ is_resolved: true })
            .eq('id', selectedQuestion.id);
        } catch (err) {
          console.error('更新错题状态失败:', err);
          setWrongQuestions(wrongQuestions);
        }
      } else {
        const newWrongCount = (selectedQuestion.wrong_count || 0) + 1;
        setWrongQuestions(prev => prev.map(wq =>
          wq.id === selectedQuestion.id
            ? { ...wq, wrong_count: newWrongCount, last_wrong_at: toDatabaseDateTime(new Date()) }
            : wq
        ));
        try {
          await backendClient
            .from('wrong_questions')
            .update({
              wrong_count: newWrongCount,
              last_wrong_at: toDatabaseDateTime(new Date()),
            })
            .eq('id', selectedQuestion.id);
        } catch (err) {
          console.error('更新错题次数失败:', err);
        }
      }
    } catch (apiError: any) {
      console.warn('业务API调用失败，降级使用原始方法:', apiError);
      
      // 降级时也先显示结果
      setIsCorrect(correct);
      setShowResult(true);
      // 降级路径同样锁定本题，避免接口超时/静默失败被连点重复计分
      answeredQuestionIdRef.current = selectedQuestion.question_id;
      if (subResults.length > 0) {
        setSubQuestionResults(subResults);
      }

      if (correct) {
        await updatePoints(profile.id, pointsChange);
        await backendClient.from('student_answers').insert({
          student_id: profile.id,
          question_id: selectedQuestion.question_id,
          answer: answerText,
          is_correct: true,
          points_change: pointsChange,
          source: 'practice',
        });
      } else {
        await updatePoints(profile.id, pointsChange);
        await backendClient.from('student_answers').insert({
          student_id: profile.id,
          question_id: selectedQuestion.question_id,
          answer: answerText,
          is_correct: false,
          points_change: pointsChange,
          source: 'practice',
        });
      }
      refreshProfile();
      const statsData = await gameSystem.fetchGameStats();
      if (statsData) {
        setGameResult({
          power_multiplier: statsData.power_multiplier || 1,
          crit_rate: statsData.crit_rate || 0,
          is_crit: false,
          final_score: pointsChange,
          current_streak: 0,
          current_crit_streak: 0,
          current_wrong: 0,
          new_honor: null,
        } as SubmitResult);
      }

      const emitEvent = useGameEventStore.getState().emitEvent;
      emitEvent(correct ? 'correct' : 'wrong');

      // 降级时也更新错题列表
      if (correct) {
        const newList = wrongQuestions.filter(wq => wq.id !== selectedQuestion.id);
        setWrongQuestions(newList);
        backendClient
          .from('wrong_questions')
          .update({ is_resolved: true })
          .eq('id', selectedQuestion.id);
      } else {
        const newWrongCount = (selectedQuestion.wrong_count || 0) + 1;
        setWrongQuestions(prev => prev.map(wq =>
          wq.id === selectedQuestion.id
            ? { ...wq, wrong_count: newWrongCount, last_wrong_at: toDatabaseDateTime(new Date()) }
            : wq
        ));
        backendClient
          .from('wrong_questions')
          .update({
            wrong_count: newWrongCount,
            last_wrong_at: toDatabaseDateTime(new Date()),
          })
          .eq('id', selectedQuestion.id);
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    setSelectedQuestion(null);
    setSelectedAnswer('');
    setCompositeAnswers({});
    setCompositeBlankAnswers({});
    setSubQuestionResults([]);
    setShowResult(false);
    setSubmitNotice('');
    answeredQuestionIdRef.current = null;
  };

  const handleNextQuestion = () => {
    const nextQ = nextQuestionRef.current;
    nextQuestionRef.current = null;

    if (nextQ) {
      const nextIndex = wrongQuestions.findIndex(wq => wq.id === nextQ.id);
      setCurrentQuestionIndex(nextIndex >= 0 ? nextIndex : 0);
      setSelectedQuestion(nextQ);
      setSelectedAnswer('');
      setCompositeAnswers({});
      setCompositeBlankAnswers({});
      setSubQuestionResults([]);
      setShowResult(false);
      setSubmitNotice('');
      answeredQuestionIdRef.current = null;
    } else if (wrongQuestions.length > 0) {
      let nextIndex = isCorrect ? currentQuestionIndex : currentQuestionIndex + 1;
      if (nextIndex < wrongQuestions.length) {
        setCurrentQuestionIndex(nextIndex);
        setSelectedQuestion(wrongQuestions[nextIndex]);
        setSelectedAnswer('');
        setCompositeAnswers({});
        setCompositeBlankAnswers({});
        setSubQuestionResults([]);
        setShowResult(false);
        setSubmitNotice('');
        answeredQuestionIdRef.current = null;
      } else {
        handleBack();
      }
    } else {
      handleBack();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <>
      {/* 全局特效组件（放在最外层，不受容器限制） */}
      <HonorBadge currentStreak={currentStreak} currentCritStreak={currentCritStreak} currentWrong={currentWrong} buffs={buffs} />
      <CritEffect isCrit={showCritEffect} onComplete={() => setShowCritEffect(false)} />
      <HonorToast honor={currentHonor} onDismiss={() => setCurrentHonor(null)} />
      <EquipmentDropEffect />

      {selectedQuestion ? (
        <div className="p-6 max-w-4xl mx-auto">
          <button
            onClick={handleBack}
            className="mb-4 flex items-center gap-2 text-gray-600 hover:text-gray-800"
          >
            <i className="fa-solid fa-arrow-left"></i>
            返回错题列表
          </button>

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="text-lg font-medium text-gray-800 mb-6 leading-relaxed question-rich-content">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedQuestion.question.content) }} />
              </div>

              {selectedQuestion.question.type === 'choice' && selectedQuestion.question.options && (
                <div className="space-y-3">
                  {getOptions(selectedQuestion.question.options).map((option: string, index: number) => {
                    const optionLetter = String.fromCharCode(65 + index);
                    return (
                      <button
                        key={index}
                        onClick={() => !showResult && setSelectedAnswer(optionLetter)}
                        disabled={showResult}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                          selectedAnswer === optionLetter
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300'
                        } ${showResult ? 'cursor-not-allowed' : ''}`}
                      >
                        <span className="font-medium mr-2 align-top">{optionLetter}.</span>
                        <span className="inline-block question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(option) }} />
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedQuestion.question.type === 'fill_blank' && (
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

              {selectedQuestion.question.type === 'composite' && (
                <div className="mt-4 space-y-4">
                  {getCompositeSubQuestions(selectedQuestion.question.answers).map((sq: any, sqIdx: number) => {
                    const sqResult = subQuestionResults.find(r => r.index === sqIdx);
                    const resultBg = showResult
                      ? (sqResult?.isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200')
                      : 'bg-gray-50 border-gray-200';
                    
                    return (
                      <div key={sqIdx} className={`p-4 rounded-lg border-2 ${resultBg} transition-colors`}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-sm font-medium">
                            第{sqIdx + 1}小题
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            sq.type === 'choice' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                          }`}>
                            {sq.type === 'choice' ? (sq.multiple ? '多选题' : '单选题') : '填空题'}
                          </span>
                          <span className="text-xs text-gray-500">{sq.score}分</span>
                          {showResult && (
                            <span className={`text-sm font-medium ${sqResult?.isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                              {sqResult?.isCorrect ? `✓ 正确 +${sqResult.score}分` : '✗ 错误'}
                            </span>
                          )}
                        </div>
                        
                        <div className="text-base text-gray-800 mb-3 leading-relaxed question-rich-content">
                          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(sq.content) }} />
                        </div>

                        {sq.type === 'choice' && Array.isArray(sq.options) && (
                          <div className="space-y-2">
                            {sq.options.map((option: string, oIdx: number) => {
                              const optionLetter = String.fromCharCode(65 + oIdx);
                              const userAnswer = compositeAnswers[sqIdx] || '';
                              const isSelected = sq.multiple
                                ? userAnswer.split(',').map(s => s.trim().toUpperCase()).includes(optionLetter)
                                : userAnswer === optionLetter;
                              const correctAnswers = Array.isArray(sq.answers) ? sq.answers : [];
                              const isCorrectOption = correctAnswers.some((a: string) => 
                                a.toUpperCase().trim() === optionLetter
                              );
                              
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
                                  key={oIdx}
                                  onClick={() => {
                                    if (showResult) return;
                                    if (sq.multiple) {
                                      const current = (compositeAnswers[sqIdx] || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                                      const idx = current.indexOf(optionLetter);
                                      let newList: string[];
                                      if (idx >= 0) {
                                        newList = current.filter((_, i) => i !== idx);
                                      } else {
                                        newList = [...current, optionLetter];
                                      }
                                      setCompositeAnswers({ ...compositeAnswers, [sqIdx]: newList.join(',') });
                                    } else {
                                      setCompositeAnswers({ ...compositeAnswers, [sqIdx]: optionLetter });
                                    }
                                  }}
                                  disabled={showResult}
                                  className={`w-full p-3 rounded-lg border-2 text-left transition-all ${borderClass} ${bgClass} ${showResult ? 'cursor-not-allowed' : ''}`}
                                >
                                  <span className="font-medium mr-2 align-top">{optionLetter}.</span>
                                  <span className="inline-block question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(option) }} />
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {sq.type === 'fill_blank' && (
                          <div className="space-y-2">
                            {(() => {
                              const blankCount = normalizeBlankAnswers(sq.answers).length;
                              const currentBlankAnswers = compositeBlankAnswers[sqIdx] || Array(blankCount).fill('');
                              return Array.from({ length: blankCount }).map((_, bIdx) => (
                                <div key={bIdx} className="flex items-center gap-2">
                                  <span className="text-sm text-gray-600 w-16 flex-shrink-0">第{bIdx + 1}空：</span>
                                  <input
                                    type="text"
                                    value={currentBlankAnswers[bIdx] || ''}
                                    onChange={(e) => {
                                      if (showResult) return;
                                      const newAnswers = [...currentBlankAnswers];
                                      newAnswers[bIdx] = e.target.value;
                                      setCompositeBlankAnswers({ ...compositeBlankAnswers, [sqIdx]: newAnswers });
                                    }}
                                    disabled={showResult}
                                    placeholder="请输入答案"
                                    className="flex-1 p-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                                  />
                                  {showResult && (
                                    <span className={`text-sm ${
                                      sqResult?.isCorrect ? 'text-green-600' : 'text-red-600'
                                    }`}>
                                      {(() => {
                                        const correctList = normalizeBlankAnswers(sq.answers)[bIdx] || [];
                                        return '参考答案: ' + correctList.join(' / ');
                                      })()}
                                    </span>
                                  )}
                                </div>
                              ));
                            })()}
                          </div>
                        )}

                        {showResult && sq.explanation && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <p className="text-sm font-medium text-gray-700 mb-1">小题解析：</p>
                            <div className="text-sm text-gray-600 leading-relaxed question-rich-content">
                              <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(sq.explanation) }} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {showResult && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mt-6 p-4 rounded-lg ${isCorrect ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <i className={`fa-solid ${isCorrect ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500'} text-xl`}></i>
                    <span className={`font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                      {selectedQuestion.question.type === 'composite' ? (
                        isCorrect ? (
                          gameResult?.is_crit ? (
                            <>全部正确! <span className="text-yellow-500">⚡暴击！+{gameResult.crit_final_score}积分</span></>
                          ) : (
                            <>全部正确! +{gameResult?.final_score || pointsConfig.correct}积分</>
                          )
                        ) : (() => {
                          const correctCount = subQuestionResults.filter(r => r.isCorrect).length;
                          const totalCount = subQuestionResults.length;
                          const earnedScore = subQuestionResults.filter(r => r.isCorrect).reduce((sum, r) => sum + r.score, 0);
                          const totalScore = subQuestionResults.reduce((sum, r) => sum + r.score, 0);
                          return `回答错误! 正确${correctCount}/${totalCount}小题，得分${earnedScore}/${totalScore}分 ${pointsConfig.wrong}积分`;
                        })()
                      ) : (
                        isCorrect ? (
                          gameResult?.is_crit ? (
                            <>回答正确! <span className="text-yellow-500">⚡暴击！+{gameResult.crit_final_score}积分</span></>
                          ) : (
                            <>回答正确! +{gameResult?.final_score || pointsConfig.correct}积分</>
                          )
                        ) : `回答错误! ${pointsConfig.wrong}积分`
                      )}
                    </span>
                    {isCorrect && gameResult?.power_multiplier && (
                      <span className="text-sm text-green-600">
                        (战力x{gameResult.power_multiplier})
                      </span>
                    )}
                  </div>
                  <div className="text-gray-700">
                    {selectedQuestion.question.type === 'composite' && subQuestionResults.length > 0 && (
                      <div className="mb-3">
                        <p className="font-medium mb-2">小题得分：</p>
                        <div className="flex flex-wrap gap-2">
                          {subQuestionResults.map((r, i) => (
                            <span
                              key={i}
                              className={`px-2 py-1 rounded text-xs ${r.isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                            >
                              第{r.index}题: {r.isCorrect ? `+${r.score}分` : '0分'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="font-medium mb-1">答案解析:</p>
                    <div className="question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedQuestion.question.explanation || '') }} />
                    {isCorrect && gameResult && (
                      <div className="text-xs text-gray-500 mt-1">
                        战力倍率: x{gameResult.power_multiplier || 1} | 暴击率: {gameResult.crit_rate || 0}%
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {submitNotice && (
                <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 flex items-start gap-2">
                  <i className="fa-solid fa-circle-info mt-0.5"></i>
                  <span>{submitNotice}</span>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                {/* AI答疑按钮 */}
                {selectedQuestion && (
                  <button
                    onClick={() => {
                      let questionText = htmlToPlainText(selectedQuestion.question.content || '');
                      if (selectedQuestion.question.type === 'choice' && selectedQuestion.question.options) {
                        questionText += '\n' + getOptions(selectedQuestion.question.options).map((o: string, i: number) => `${String.fromCharCode(65 + i)}. ${htmlToPlainText(o)}`).join('\n');
                      }
                      if (selectedQuestion.question.type === 'composite') {
                        const subQs = getCompositeSubQuestions(selectedQuestion.question.answers);
                        subQs.forEach((sq: any, idx: number) => {
                          questionText += `\n\n(${idx + 1}) ${htmlToPlainText(sq.content || '')}`;
                          if (sq.type === 'choice' && Array.isArray(sq.options)) {
                            sq.options.forEach((o: string, i: number) => {
                              questionText += `\n${String.fromCharCode(65 + i)}. ${htmlToPlainText(o)}`;
                            });
                          }
                        });
                      }
                      (window as any).openAiQaWindow?.({ question: questionText });
                    }}
                    className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-2"
                  >
                    <i className="fa-solid fa-robot"></i>
                    AI答疑
                  </button>
                )}
                {/* 练习同类题按钮 - 仅在提交答案后显示 */}
                {showResult && selectedQuestion && (
                  <button
                    onClick={() => {
                      (window as any).openSimilarPracticeWindow?.({ questionId: selectedQuestion.question.id });
                    }}
                    className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors flex items-center gap-2"
                    title="基于AI聚类推荐同知识点的题目进行强化练习"
                  >
                    <i className="fa-solid fa-layer-group"></i>
                    练习同类题
                  </button>
                )}
                {!showResult ? (
                  <button
                    onClick={handleSubmit}
                    disabled={
                      isSubmitting ||
                      !selectedQuestion ||
                      (selectedQuestion.question.type !== 'composite' && !selectedAnswer) ||
                      (selectedQuestion.question.type === 'composite' && (() => {
                        const subQs = getCompositeSubQuestions(selectedQuestion.question.answers);
                        return subQs.length === 0 || subQs.some((sq: any, sqIdx: number) => {
                          if (sq.type === 'choice') {
                            return !compositeAnswers[sqIdx];
                          } else {
                            const blanks = compositeBlankAnswers[sqIdx];
                            return !blanks || blanks.some(b => !b.trim());
                          }
                        });
                      })())
                    }
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <i className="fa-solid fa-circle-notch fa-spin"></i>
                        提交中...
                      </>
                    ) : (
                      '提交答案'
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleBack}
                      className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      返回列表
                    </button>
                    <button
                      onClick={handleNextQuestion}
                      className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      下一题
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="w-28 flex-shrink-0">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sticky top-4">
              <PetCompanion
                isCorrect={showResult ? isCorrect : null}
                isCrit={gameResult?.is_crit || false}
                newHonor={currentHonor}
                currentStreak={currentStreak}
                currentCritStreak={currentCritStreak}
                currentWrong={currentWrong}
                buffs={buffs}
                showResult={showResult}
              />
            </div>
          </div>
        </div>
      </div>
      ) : (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">错题集</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('unresolved')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === 'unresolved' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            未掌握
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            全部
          </button>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-gray-700">标签筛选:</span>
            {selectedTags.length > 0 && (
              <button
                onClick={() => setSelectedTags([])}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                清除筛选
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedTags(selectedTags.filter(t => t !== tag));
                    } else {
                      setSelectedTags([...selectedTags, tag]);
                    }
                  }}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    isSelected
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {wrongQuestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <i className="fa-solid fa-check-circle text-4xl mb-4 text-green-500"></i>
          <p>暂无错题，继续保持!</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {wrongQuestions.map((wq) => (
            <motion.div
              key={wq.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-gray-800 font-medium mb-2 line-clamp-2">{htmlToPlainText(wq.question.content)}</p>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mb-2">
                    <span className="flex items-center gap-1">
                      <i className="fa-solid fa-times-circle text-red-500"></i>
                      错 {wq.wrong_count} 次
                    </span>
                    <span className="flex items-center gap-1">
                      <i className="fa-solid fa-clock"></i>
                      {new Date(wq.last_wrong_at || '').toLocaleDateString()}
                    </span>
                    {wq.is_resolved && (
                      <span className="flex items-center gap-1 text-green-600">
                        <i className="fa-solid fa-check"></i>
                        已掌握
                      </span>
                    )}
                  </div>
                  {parseTags(wq.question.tags).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {parseTags(wq.question.tags).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {!wq.is_resolved && (
                  <button
                    onClick={() => handlePractice(wq)}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    重练
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
      )}
    </>
  );
};
