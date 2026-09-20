import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Question, PracticeStats } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { usePoints } from '../../hooks/usePoints';
import { toDatabaseDateTime } from '../../utils/dateUtils';
import { useGameSystem, BuffInfo, SubmitResult, HonorEvent } from '../../hooks/useGameSystem';
import { HonorBadge } from './game/HonorBadge';
import { CritEffect } from './game/CritEffect';
import { HonorToast } from './game/HonorToast';
import { EquipmentDropEffect } from './game/EquipmentDropEffect';
import { PetCompanion } from './game/PetCompanion';
import { useGameEventStore } from '../../store/gameEventStore';
import { sanitizeHtml, htmlToPlainText } from '../../utils/htmlUtils';

type QuestionOrder = 'random' | 'sequential';

interface PracticeConfig {
  order: QuestionOrder;
  selectedTags: string[];
  selectedClusterPrimary: string[];   // 选中的 AI 聚类一级类目
  selectedClusterSecondary: string[]; // 选中的 AI 聚类二级类目（full key：一级/二级）
}

// 聚类树：一级类目 → 二级类目集合
type ClusterTree = Record<string, Set<string>>;

// 把 cluster_id 拆成 [一级, 二级]；无斜杠时二级为空串
const splitCluster = (clusterId: string | null | undefined): [string, string] | null => {
  if (!clusterId || typeof clusterId !== 'string') return null;
  const trimmed = clusterId.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf('/');
  if (idx < 0) return [trimmed, ''];
  const primary = trimmed.slice(0, idx).trim();
  const secondary = trimmed.slice(idx + 1).trim();
  return primary ? [primary, secondary] : null;
};

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
  return parsed?.options || parsed;
};

const getAnswers = (answers: any): string[] => {
  const parsed = parseJsonField(answers);
  return parsed?.answers || parsed;
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

export const PracticeModule: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [filteredQuestions, setFilteredQuestions] = useState<Question[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [clusterTree, setClusterTree] = useState<ClusterTree>({}); // AI 聚类一级→二级集合
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [compositeAnswers, setCompositeAnswers] = useState<Record<number, string>>({});
  const [compositeBlankAnswers, setCompositeBlankAnswers] = useState<Record<number, string[]>>({});
  const [subQuestionResults, setSubQuestionResults] = useState<{ index: number; isCorrect: boolean; score: number }[]>([]);
  // 题目数据已对学生脱敏（不含 answers / explanation），答案与解析在「提交之后」
  // 由服务端回执带回，按题目 id 暂存，本题渲染时合并回去。
  const [revealedQuestions, setRevealedQuestions] = useState<Record<string, { answers: any; explanation?: string | null }>>({});
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [stats, setStats] = useState<PracticeStats>({ total: 0, correct: 0, wrong: 0, accuracy: 0, mastered: 0 });
  const [sessionStats, setSessionStats] = useState({ correct: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(true);
  const [config, setConfig] = useState<PracticeConfig>({
    order: 'random',
    selectedTags: [],
    selectedClusterPrimary: [],
    selectedClusterSecondary: [],
  });
  const [masteredQuestionIds, setMasteredQuestionIds] = useState<Set<string>>(new Set());
  const [masterThreshold, setMasterThreshold] = useState(3);
  const [pointsConfig, setPointsConfig] = useState({ correct: 10, wrong: -5 });
  const [isSubmitting, setIsSubmitting] = useState(false); // 防重复提交标志（仅用于按钮文案/禁用，不做真正的拦截）
  // 同步提交锁：不依赖 React 重渲染。此前用 state 做锁，一旦页面卡顿/掉帧导致 React 不再重渲染，
  // 按钮闭包里的 isSubmitting 永远是 false，"卡住了还能一直点提交"——单题被连点提交 317 次就是这么来的。
  const submittingRef = useRef(false);
  // 当前这一屏题目是否已经提交过：同一道题在未切题前只允许提交一次，切题时清空
  const answeredQuestionIdRef = useRef<string | null>(null);
  // 同题连点冷却兜底（毫秒）
  const lastSubmitAtRef = useRef(0);
  const SUBMIT_COOLDOWN_MS = 1500;
  // 提交反馈提示（已掌握/重复提交等）
  const [submitNotice, setSubmitNotice] = useState('');
  const { profile, refreshProfile } = useAuth();
  const { updatePoints, getPointsConfig } = usePoints();
  const [gameResult, setGameResult] = useState<SubmitResult | null>(null);
  const [showCritEffect, setShowCritEffect] = useState(false);
  const [currentHonor, setCurrentHonor] = useState<HonorEvent | null>(null);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [currentCritStreak, setCurrentCritStreak] = useState(0);
  const [currentWrong, setCurrentWrong] = useState(0);
  const [buffs, setBuffs] = useState<BuffInfo[]>([]);
  const gameSystem = useGameSystem();

  // 同步 gameSystem.buffs 到本地状态
  useEffect(() => {
    setBuffs(gameSystem.buffs);
  }, [gameSystem.buffs]);

  useEffect(() => {
    fetchInitialData();
    fetchMasterThreshold();
    fetchPointsConfig();
  }, []);

  // 学习模块「去练习这一章」：接收章节点选事件，自动套用 cluster 筛选并进入练习
  // detail.cluster_id 可以是「章名」（整章）或「章名/小节名」（单小节）
  useEffect(() => {
    const handler = (e: Event) => {
      const cid = (e as CustomEvent).detail?.cluster_id;
      if (!cid || typeof cid !== 'string') return;
      const parts = cid.split('/');
      if (parts.length === 1) {
        // 整章：只选一级
        setConfig(prev => ({ ...prev, selectedClusterPrimary: [parts[0]], selectedClusterSecondary: [] }));
      } else {
        // 小节：一级 + 二级同时选
        setConfig(prev => ({ ...prev, selectedClusterPrimary: [parts[0]], selectedClusterSecondary: [cid] }));
      }
      setShowConfig(true);
      setFilterFromLearn(true);
    };
    window.addEventListener('openPracticeWithCluster', handler);
    return () => window.removeEventListener('openPracticeWithCluster', handler);
  }, []);

  // 从学习模块带筛选跳转而来的提示（关掉设置面板后清除）
  const [filterFromLearn, setFilterFromLearn] = useState(false);

  // 在显示设置界面时重新获取配置
  useEffect(() => {
    if (showConfig) {
      fetchMasterThreshold();
      fetchPointsConfig();
    }
  }, [showConfig]);

  const fetchPointsConfig = async () => {
    const config = await getPointsConfig();
    console.log('获取积分配置:', config);
    setPointsConfig(config);
  };

  useEffect(() => {
    if (profile) {
      fetchStats();
    }
  }, [profile]);

  const fetchMasterThreshold = async () => {
    const { data } = await backendClient.from('system_config').select('*');
    if (data) {
      const config = data.find((item: any) => (item.key || item.config_key) === 'master_question_threshold');
      if (config) {
        let value = config.value;
        if (typeof config.value === 'string') {
          try {
            value = JSON.parse(config.value);
          } catch {}
        }
        const finalValue = typeof value === 'object' && value !== null ? value.value : value;
        setMasterThreshold(finalValue || 3);
        // 阈值加载完成后，计算已掌握题目数
        if (profile) {
          fetchMasteredQuestions();
        }
      }
    }
  };

  const getQuestionCorrectCount = async (questionId: string): Promise<number> => {
    if (!profile) return 0;
    const { data } = await backendClient
      .from('student_answers')
      .select('id')
      .eq('student_id', profile.id)
      .eq('question_id', questionId)
      .eq('is_correct', true)
      .eq('source', 'practice');
    return data?.length || 0;
  };

  const fetchMasteredQuestions = async (): Promise<Set<string>> => {
    const mastered = new Set<string>();
    if (!profile) return mastered;

    const { data } = await backendClient
      .from('student_answers')
      .select('question_id, is_correct')
      .eq('student_id', profile.id)
      .eq('source', 'practice');

    if (data) {
      const correctCounts: Record<string, number> = {};
      data.forEach((record) => {
        if (record.is_correct) {
          correctCounts[record.question_id] = (correctCounts[record.question_id] || 0) + 1;
        }
      });
      Object.entries(correctCounts).forEach(([questionId, count]) => {
        if (count >= masterThreshold) {
          mastered.add(questionId);
        }
      });
      setMasteredQuestionIds(mastered);
      setStats((prev) => ({ ...prev, mastered: mastered.size }));
    }
    return mastered;
  };

  const fetchInitialData = async () => {
    const { data: questionsData } = await backendClient.from('questions').select('*').eq('practice_enabled', true);

    if (questionsData) {
      setQuestions(questionsData as Question[]);
      const tagsSet = new Set<string>();
      const tree: ClusterTree = {};
      questionsData.forEach((q: Question) => {
        const tags = parseTags(q.tags);
        tags.forEach((tag) => tagsSet.add(tag));
        // 聚合 AI 聚类：cluster_id 形如 "信息系统/分类与类型"
        const parts = splitCluster((q as any).cluster_id);
        if (parts) {
          const [primary, secondary] = parts;
          if (!tree[primary]) tree[primary] = new Set();
          if (secondary) tree[primary].add(secondary);
        }
      });
      setAllTags(Array.from(tagsSet).sort());
      // 转成普通对象数组，便于渲染与排序
      const sortedTree: ClusterTree = {};
      Object.keys(tree).sort().forEach((p) => {
        sortedTree[p] = new Set(Array.from(tree[p]).sort());
      });
      setClusterTree(sortedTree);
    }
    setLoading(false);
  };

  const fetchStats = async () => {
    if (!profile) return;
    const { data } = await backendClient
      .from('student_answers')
      .select('is_correct')
      .eq('student_id', profile.id);
    if (data) {
      const total = data.length;
      const correct = data.filter((a) => a.is_correct).length;
      setStats((prev) => ({
        total,
        correct,
        wrong: total - correct,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
        mastered: prev.mastered,
      }));
    }
  };

  // 应用当前筛选条件（标签 + AI 聚类一级/二级）到题目列表
  const applyFiltersToList = (list: Question[]): Question[] => {
    let filtered = [...list];
    if (config.selectedTags.length > 0) {
      filtered = filtered.filter((q) => {
        const tags = parseTags(q.tags);
        return config.selectedTags.some((tag) => tags.includes(tag));
      });
    }
    if (config.selectedClusterPrimary.length > 0 || config.selectedClusterSecondary.length > 0) {
      filtered = filtered.filter((q) => {
        const parts = splitCluster((q as any).cluster_id);
        if (!parts) return false;
        const [primary, secondary] = parts;
        // 一级类目匹配（若选了一级则必须命中）
        const primaryHit = config.selectedClusterPrimary.length === 0 || config.selectedClusterPrimary.includes(primary);
        if (!primaryHit) return false;
        // 二级类目匹配：未选二级时不限（命中一级即可）；选了二级则二级必须命中且非空
        if (config.selectedClusterSecondary.length > 0) {
          if (!secondary) return false;
          const fullKey = `${primary}/${secondary}`;
          if (!config.selectedClusterSecondary.includes(fullKey)) return false;
        }
        return true;
      });
    }
    return filtered;
  };

  const applyFiltersAndStart = async () => {
    const mastered = await fetchMasteredQuestions();
    let filtered = [...questions];

    filtered = filtered.filter((q) => !mastered.has(q.id));
    filtered = applyFiltersToList(filtered);

    if (config.order === 'random') {
      filtered = shuffleArray(filtered);
    } else {
      filtered.sort((a, b) => new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime());
    }

    setFilteredQuestions(filtered);
    setCurrentIndex(0);
    setSessionStats({ correct: 0, total: 0 });
    setSelectedAnswer('');
    setShowResult(false);
    setShowConfig(false);
    setSubmitNotice('');
    answeredQuestionIdRef.current = null;
  };

  const shuffleArray = <T,>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  };

  const baseQuestion = filteredQuestions[currentIndex];
  const revealed = baseQuestion ? revealedQuestions[baseQuestion.id] : undefined;
  // 答过之后把回执里的答案/解析合并进题目对象，原有渲染逻辑（正确答案高亮、解析、填空参考答案）无需改动
  const currentQuestion = baseQuestion && revealed ? { ...baseQuestion, ...revealed } : baseQuestion;

  const handleSubmit = async () => {
    if (!currentQuestion || !profile) return;

    // 同步拦截（不依赖 state 是否已刷新）：
    // 1) 已有提交在途 → 直接忽略
    if (submittingRef.current) return;
    // 2) 本题已经提交过、且还没有切到下一题 → 忽略并提示（防止"看起来没反应"而反复点）
    if (answeredQuestionIdRef.current === currentQuestion.id) {
      setSubmitNotice('本题已提交，请点击「下一题」继续。同一道题重复提交不再计分。');
      return;
    }
    // 3) 极短时间内的连点（含鼠标连击/按键卡键）→ 忽略
    if (Date.now() - lastSubmitAtRef.current < SUBMIT_COOLDOWN_MS) return;

    submittingRef.current = true;
    lastSubmitAtRef.current = Date.now();
    setIsSubmitting(true);
    setSubmitNotice('');
    
    try {
      let correct = false;
      let answerText = '';
      // points_change 只是历史字段，服务端已不采信（分值由系统配置决定），这里恒传 0
      const pointsChange = 0;

      if (currentQuestion.type === 'composite') {
        // 题目已对学生脱敏、不含答案：对错与逐小题结果全部等提交后由服务端回执给出
        answerText = JSON.stringify({
          choice_answers: compositeAnswers,
          blank_answers: compositeBlankAnswers
        });
      } else {
        if (!selectedAnswer) {
          setIsSubmitting(false);
          return;
        }
        const answerTrimmed = selectedAnswer.trim();
        if (!answerTrimmed) {
          alert('请输入答案');
          return;
        }
        answerText = answerTrimmed;
      }

      console.log('[GAME FRONTEND] submitting:', { student_id: profile.id, is_correct: correct, points_change: pointsChange });
      
      // 使用新的业务API提交答案（包含事务处理和游戏逻辑）
      try {
        const result = await backendClient.businessSubmitAnswer({
          student_id: profile.id,
          question_id: currentQuestion.id,
          answer: answerText,
          is_correct: correct,
          points_change: pointsChange,
          source: 'practice'
        });
        
        if (result.error) {
          alert(result.error || '提交失败，请重试');
          return;
        }

        // 判分以服务端为准：服务端拿题库里的正确答案判定
        const serverVerdict = (result.data as any)?.is_correct;
        if (typeof serverVerdict === 'boolean') correct = serverVerdict;

        // 答案与解析随回执下发（题目本身已脱敏），按题暂存后合并回题目对象
        const revealData = result.data as any;
        if (revealData) {
          setRevealedQuestions((prev) => ({
            ...prev,
            [currentQuestion.id]: {
              answers: revealData.correct_answers ?? null,
              explanation: revealData.question_explanation ?? null,
            },
          }));
          if (Array.isArray(revealData.sub_correct)) {
            // 复合题逐小题对错同样以服务端为准
            const subQs = getCompositeSubQuestions(revealData.correct_answers) as any[];
            setSubQuestionResults(
              revealData.sub_correct.map((ok: boolean, idx: number) => ({
                index: idx,
                isCorrect: !!ok,
                score: ok ? (subQs[idx]?.score || 0) : 0,
              }))
            );
          } else {
            setSubQuestionResults([]);
          }
        }

        // API成功后再显示结果
        setIsCorrect(correct);
        setShowResult(true);
        // 标记"当前这一屏题已提交"，未切题前不再允许提交
        answeredQuestionIdRef.current = currentQuestion.id;

        // 掌握门禁回执：该题答对次数已达阈值 → 立即移出练习队列并提示
        const gateData = result.data as any;
        if (gateData?.mastered) {
          setMasteredQuestionIds((prev) => {
            if (prev.has(currentQuestion.id)) return prev;
            const next = new Set(prev);
            next.add(currentQuestion.id);
            return next;
          });
          setSubmitNotice(
            `本题已答对 ${gateData.question_correct_count ?? ''} 次，达到掌握标准（${gateData.master_threshold} 次），已移出练习队列`
          );
        } else if (gateData?.rewarded === false) {
          setSubmitNotice(
            gateData.reward_blocked_reason === 'wrong_limit'
              ? '本题错误次数较多，本次不再扣分'
              : '本题已掌握，本次不再计分、不掉装备'
          );
        }
        
        // 更新本地用户信息
        if (result.data?.student) {
          refreshProfile();
        }

        // 提取游戏系统数据
        if (result.data) {
          const gameData = result.data as any;
          console.log('[GAME] API response:', { final_score: gameData.final_score, power_multiplier: gameData.power_multiplier, is_crit: gameData.is_crit, crit_rate: gameData.crit_rate, curr_streak: gameData.current_streak });
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
          const buffsData = await gameSystem.fetchBuffs();
          if (buffsData) setBuffs(buffsData);

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
      } catch (apiError: any) {
        // 判分与答案都在服务端，接口失败时不能再用本地判分兜底：题目已不含答案，
        // 本地判分只会写出一条「前端说对、服务端不知情」的脏记录。明确提示重试，
        // finally 会解锁本题，学生直接再点提交即可。
        console.error('提交答案接口调用失败:', apiError);
        alert('提交失败，请检查网络后重试');
        return;
      }

      if (correct) {
        const newMastered = new Set(masteredQuestionIds);
        const currentCorrectCount = await getQuestionCorrectCount(currentQuestion.id);
        if (currentCorrectCount >= masterThreshold) {
          newMastered.add(currentQuestion.id);
          setMasteredQuestionIds(newMastered);
        }
      }

      if (!correct) {
        const { data: existing } = await backendClient
          .from('wrong_questions')
          .select('*')
          .eq('student_id', profile.id)
          .eq('question_id', currentQuestion.id)
          .maybeSingle();

        if (existing) {
          await backendClient
            .from('wrong_questions')
            .eq('id', existing.id)
            .update({
              wrong_count: (existing.wrong_count || 0) + 1,
              last_wrong_at: toDatabaseDateTime(new Date()),
            });
        } else {
          await backendClient.from('wrong_questions').insert({
            student_id: profile.id,
            question_id: currentQuestion.id,
          });
        }
      }

      setSessionStats((prev) => ({
        correct: prev.correct + (correct ? 1 : 0),
        total: prev.total + 1,
      }));

      refreshProfile();
      fetchStats();
      fetchMasteredQuestions();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleNext = () => {
    setSelectedAnswer('');
    setCompositeAnswers({});
    setCompositeBlankAnswers({});
    setSubQuestionResults([]);
    setShowResult(false);
    setSubmitNotice('');
    // 切题后解锁：新的一屏题目允许提交一次
    answeredQuestionIdRef.current = null;

    const remainingQuestions = filteredQuestions.filter((q) => !masteredQuestionIds.has(q.id));
    if (remainingQuestions.length === 0) {
      setShowConfig(true);
      return;
    }

    const nextIndex = (currentIndex + 1) % filteredQuestions.length;
    let attempts = 0;
    let newIndex = nextIndex;
    while (masteredQuestionIds.has(filteredQuestions[newIndex]?.id) && attempts < filteredQuestions.length) {
      newIndex = (newIndex + 1) % filteredQuestions.length;
      attempts++;
    }

    if (attempts >= filteredQuestions.length) {
      setShowConfig(true);
    } else {
      setCurrentIndex(newIndex);
    }
  };

  const toggleTag = (tag: string) => {
    setConfig((prev) => ({
      ...prev,
      selectedTags: prev.selectedTags.includes(tag)
        ? prev.selectedTags.filter((t) => t !== tag)
        : [...prev.selectedTags, tag],
    }));
  };

  // 切换一级类目：取消选中时同步移除其下属的所有已选二级
  const toggleClusterPrimary = (primary: string) => {
    setConfig((prev) => {
      if (prev.selectedClusterPrimary.includes(primary)) {
        const prefix = `${primary}/`;
        return {
          ...prev,
          selectedClusterPrimary: prev.selectedClusterPrimary.filter((p) => p !== primary),
          selectedClusterSecondary: prev.selectedClusterSecondary.filter((s) => !s.startsWith(prefix)),
        };
      }
      return { ...prev, selectedClusterPrimary: [...prev.selectedClusterPrimary, primary] };
    });
  };

  // 切换二级类目（full key 形如 "一级/二级"）
  const toggleClusterSecondary = (fullKey: string) => {
    setConfig((prev) => ({
      ...prev,
      selectedClusterSecondary: prev.selectedClusterSecondary.includes(fullKey)
        ? prev.selectedClusterSecondary.filter((s) => s !== fullKey)
        : [...prev.selectedClusterSecondary, fullKey],
    }));
  };

  const resetConfig = () => {
    setConfig({
      order: 'random',
      selectedTags: [],
      selectedClusterPrimary: [],
      selectedClusterSecondary: [],
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  if (showConfig) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="grid grid-cols-5 gap-4 mb-6">
          <div className="bg-blue-50 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-600">总做题数</p>
            <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-600">已掌握</p>
            <p className="text-2xl font-bold text-amber-600">{stats.mastered}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-600">做对</p>
            <p className="text-2xl font-bold text-green-600">{stats.correct}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-600">做错</p>
            <p className="text-2xl font-bold text-red-600">{stats.wrong}</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-600">正确率</p>
            <p className="text-2xl font-bold text-purple-600">{stats.accuracy}%</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-6">练习设置</h2>

          <div className="space-y-6">
            {allTags.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  标签筛选（可选）
                  {config.selectedTags.length > 0 && (
                    <span className="ml-2 text-blue-600">已选 {config.selectedTags.length} 个</span>
                  )}
                </label>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                        config.selectedTags.includes(tag)
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                {config.selectedTags.length > 0 && (
                  <button
                    onClick={() => setConfig({ ...config, selectedTags: [] })}
                    className="mt-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    清除标签筛选
                  </button>
                )}
              </div>
            )}

            {Object.keys(clusterTree).length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  AI 聚类筛选（可选）
                  {(config.selectedClusterPrimary.length > 0 || config.selectedClusterSecondary.length > 0) && (
                    <span className="ml-2 text-violet-600">
                      已选 一级 {config.selectedClusterPrimary.length} / 二级 {config.selectedClusterSecondary.length}
                    </span>
                  )}
                </label>

                <div className="grid grid-cols-2 gap-3">
                  {/* 一级类目 */}
                  <div className="border border-gray-200 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-2 font-semibold">一级类目</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(clusterTree).map((primary) => {
                        const active = config.selectedClusterPrimary.includes(primary);
                        // 当前一级下未被一级筛选排除的二级列表（用于联动展示）
                        const secondaryList = Array.from(clusterTree[primary] || []);
                        const selectableSecondary = secondaryList.length;
                        return (
                          <button
                            key={primary}
                            onClick={() => toggleClusterPrimary(primary)}
                            className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                              active
                                ? 'bg-violet-500 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                            title={selectableSecondary > 0 ? `${selectableSecondary} 个二级类目` : '仅一级'}
                          >
                            {primary}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 二级类目：仅当选中一级类目时才显示对应二级，避免列表过长 */}
                  <div className="border border-gray-200 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-2 font-semibold">
                      二级类目
                      <span className="ml-1 text-gray-400">
                        {config.selectedClusterPrimary.length === 0
                          ? '（请先选择一级类目）'
                          : '（仅显示已选一级下的二级）'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 min-h-[40px] max-h-[160px] overflow-y-auto pr-1">
                      {config.selectedClusterPrimary.length === 0 ? (
                        <span className="text-xs text-gray-400 self-center">未选一级类目</span>
                      ) : (() => {
                        // 二级按钮：只显示已选一级下的二级（不再回退到全部一级）
                        const primaries = config.selectedClusterPrimary;
                        const list: { fullKey: string; label: string }[] = [];
                        primaries.forEach((p) => {
                          Array.from(clusterTree[p] || []).forEach((s) => {
                            list.push({ fullKey: `${p}/${s}`, label: s });
                          });
                        });
                        if (list.length === 0) {
                          return <span className="text-xs text-gray-400 self-center">所选一级下无二级类目</span>;
                        }
                        // 去重（按 fullKey）
                        const seen = new Set<string>();
                        return list.filter((item) => {
                          if (seen.has(item.fullKey)) return false;
                          seen.add(item.fullKey);
                          return true;
                        }).map((item) => {
                          const active = config.selectedClusterSecondary.includes(item.fullKey);
                          return (
                            <button
                              key={item.fullKey}
                              onClick={() => toggleClusterSecondary(item.fullKey)}
                              className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                                active
                                  ? 'bg-indigo-500 text-white'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              {item.label}
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>

                {(config.selectedClusterPrimary.length > 0 || config.selectedClusterSecondary.length > 0) && (
                  <button
                    onClick={() => setConfig({ ...config, selectedClusterPrimary: [], selectedClusterSecondary: [] })}
                    className="mt-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    清除聚类筛选
                  </button>
                )}
              </div>
            )}

            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">
                <i className="fa-solid fa-info-circle mr-1"></i>
                当前符合条件的题目：
                <span className="font-bold text-blue-600">
                  {applyFiltersToList(questions).length}
                </span>
                道
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetConfig}
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                重置
              </button>
              <button
                onClick={applyFiltersAndStart}
                disabled={applyFiltersToList(questions).length === 0}
                className="flex-1 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                开始练习
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (filteredQuestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <i className="fa-solid fa-inbox text-4xl mb-4"></i>
        <p>暂无符合条件的练习题目</p>
        <button
          onClick={() => setShowConfig(true)}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          返回设置
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-600">总做题数</p>
          <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-600">已掌握</p>
          <p className="text-2xl font-bold text-amber-600">{stats.mastered}</p>
        </div>
        <div className="bg-green-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-600">做对</p>
          <p className="text-2xl font-bold text-green-600">{stats.correct}</p>
        </div>
        <div className="bg-red-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-600">做错</p>
          <p className="text-2xl font-bold text-red-600">{stats.wrong}</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-600">正确率</p>
          <p className="text-2xl font-bold text-purple-600">{stats.accuracy}%</p>
        </div>
      </div>

      <HonorBadge currentStreak={currentStreak} currentCritStreak={currentCritStreak} currentWrong={currentWrong} buffs={buffs} />
      <CritEffect isCrit={showCritEffect} onComplete={() => setShowCritEffect(false)} />
      <HonorToast honor={currentHonor} onDismiss={() => setCurrentHonor(null)} />
      <EquipmentDropEffect />

      <div className="flex gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">
                  题目 {currentIndex + 1} / {filteredQuestions.length}
                </span>
                <span className="px-2 py-1 bg-blue-100 text-blue-600 text-xs rounded-full">
                  随机模式
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">
                  本次练习: {sessionStats.correct}/{sessionStats.total}
                </span>
                <button
                  onClick={() => setShowConfig(true)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  重新设置
                </button>
              </div>
            </div>

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
                  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.content) }} />
                </div>

                {currentQuestion.type === 'choice' && currentQuestion.options && (
                  <div className="space-y-3">
                    {getOptions(currentQuestion.options).map((option: string, index: number) => (
                      <button
                        key={index}
                        onClick={() => !showResult && setSelectedAnswer(String.fromCharCode(65 + index))}
                        disabled={showResult}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                          selectedAnswer === String.fromCharCode(65 + index)
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300'
                        } ${showResult ? 'cursor-not-allowed' : ''}`}
                      >
                        <span className="font-medium mr-2 align-top">{String.fromCharCode(65 + index)}.</span>
                        <span className="inline-block question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(option) }} />
                      </button>
                    ))}
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

                {currentQuestion.type === 'composite' && (
                  <div className="mt-4 space-y-4">
                    {getCompositeSubQuestions(currentQuestion.answers).map((sq: any, sqIdx: number) => {
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
                    {currentQuestion.type === 'composite' ? (
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
                  {currentQuestion.type === 'composite' && subQuestionResults.length > 0 && (
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
                  <div className="leading-relaxed bg-gray-50 p-3 rounded-lg question-rich-content">
                    <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.explanation || '') }} />
                  </div>
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
              {currentQuestion && (
                <button
                  onClick={() => {
                    let questionText = htmlToPlainText(currentQuestion.content || '');
                    if (currentQuestion.type === 'choice' && currentQuestion.options) {
                      const options = getOptions(currentQuestion.options);
                      questionText += '\n' + options.map((o: string, i: number) => `${String.fromCharCode(65 + i)}. ${htmlToPlainText(o)}`).join('\n');
                    }
                    if (currentQuestion.type === 'composite') {
                      const subQs = getCompositeSubQuestions(currentQuestion.answers);
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
              {/* 练习同类题按钮 - 仅在提交答案后显示，做错做对都显示 */}
              {showResult && currentQuestion && (
                <button
                  onClick={() => {
                    (window as any).openSimilarPracticeWindow?.({ questionId: currentQuestion.id });
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
                    (currentQuestion.type !== 'composite' && !selectedAnswer) ||
                      (currentQuestion.type === 'composite' && (() => {
                        const subQs = getCompositeSubQuestions(currentQuestion.answers);
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
                <button
                  onClick={handleNext}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  下一题
                </button>
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
  );
};
