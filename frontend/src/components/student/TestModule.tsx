import React, { useState, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Test, Question, TestRecord } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { usePoints } from '../../hooks/usePoints';
import { toDatabaseDateTime } from '../../utils/dateUtils';
import { sanitizeHtml, htmlToPlainText } from '../../utils/htmlUtils';
import { EquipmentDropEffect } from './game/EquipmentDropEffect';
import { useGameEventStore } from '../../store/gameEventStore';

// PK 对战组件懒加载（避免影响主模块首屏）
const PKBattle = lazy(() => import('./pk-battle/PKBattle').then(m => ({ default: m.PKBattle })));

interface ExamRecord {
  id: string;
  test_id: string;
  student_id: string;
  selected_question_ids: string[];
  score: number;
  correct_count: number;
  total_count: number;
  points_earned: number;
  internet_codes_earned: number;
  is_passed: boolean;
  started_at: string;
  completed_at: string;
}

interface ExamSession {
  test: Test;
  questions: Question[];
  answers: Record<string, string>;
  currentIndex: number;
  timeRemaining: number;
  startedAt: Date;
}

type TestSession = ExamSession;

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

const getOptions = (options: any) => {
  const parsed = parseJsonField(options);
  return parsed?.options || parsed;
};

const getAnswers = (answers: any) => {
  const parsed = parseJsonField(answers);
  let result = parsed?.answers || parsed;
  if (!Array.isArray(result)) {
    if (typeof result === 'string') {
      return [result];
    }
    return [];
  }
  return result.map(ans => ans?.toString() || '');
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

const checkFillBlankAnswer = (userAnswers: string[], correctAnswers: any): boolean => {
  const normalized = normalizeBlankAnswers(correctAnswers);
  if (userAnswers.length !== normalized.length) return false;
  return userAnswers.every((userAns, idx) => {
    const correctList = normalized[idx] || [];
    return correctList.some(ca => ca.toLowerCase().trim() === userAns.toLowerCase().trim());
  });
};

const checkChoiceAnswer = (userAnswer: string, correctAnswers: string[], multiple: boolean): boolean => {
  if (multiple) {
    const userList = userAnswer.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).sort();
    const correctList = correctAnswers.map(s => s.trim().toUpperCase()).filter(Boolean).sort();
    return userList.length === correctList.length && userList.every((v, i) => v === correctList[i]);
  }
  return correctAnswers.some(ca => ca.toLowerCase().trim() === userAnswer.toLowerCase().trim());
};

export const TestModule: React.FC = () => {
  const [tests, setTests] = useState<Test[]>([]);
  const [exams, setExams] = useState<Test[]>([]);
  const [examRecords, setExamRecords] = useState<ExamRecord[]>([]);
  const [myExamRecords, setMyExamRecords] = useState<ExamRecord[]>([]);
  const [testHistory, setTestHistory] = useState<TestRecord[]>([]);
  const [activeTest, setActiveTest] = useState<TestSession | null>(null);
  const [activeExam, setActiveExam] = useState<ExamSession | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [examResult, setExamResult] = useState<{ score: number; correct: number; points: number; internetCodes: number; codes: string[]; questions: Question[]; answers: Record<string, string>; isPassed: boolean } | null>(null);
  const [testResult, setTestResult] = useState<{ score: number; correct: number; points: number; internetCode?: string; questions: Question[]; answers: Record<string, string>; droppedEquipments?: any[] } | null>(null);
  const [showTestDetail, setShowTestDetail] = useState(false);
  const [selectedTestRecord, setSelectedTestRecord] = useState<TestRecord | null>(null);
  const [testDetailData, setTestDetailData] = useState<{ questions: Question[]; answers: Record<string, string> } | null>(null);
  const [showExamDetail, setShowExamDetail] = useState(false);
  const [selectedExamRecord, setSelectedExamRecord] = useState<ExamRecord | null>(null);
  const [examDetailData, setExamDetailData] = useState<{ questions: Question[]; answers: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExamList, setShowExamList] = useState(false);
  const [showPKBattle, setShowPKBattle] = useState(false);
  const [currentExamTest, setCurrentExamTest] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { profile, refreshProfile } = useAuth();
  const { updatePoints } = usePoints();
  const [studentCorrectCount, setStudentCorrectCount] = useState(0);
  const { emitEvent } = useGameEventStore();
  
  // 考试相关状态（需要在 useEffect 之前定义）
  const [currentExamRecordId, setCurrentExamRecordId] = useState<string | null>(null);
  const [showExamNavigator, setShowExamNavigator] = useState(false);

  // 综合题答案状态
  const [testCompositeChoiceAnswers, setTestCompositeChoiceAnswers] = useState<Record<string, Record<number, string>>>({});
  const [testCompositeBlankAnswers, setTestCompositeBlankAnswers] = useState<Record<string, Record<number, string[]>>>({});
  const [examCompositeChoiceAnswers, setExamCompositeChoiceAnswers] = useState<Record<string, Record<number, string>>>({});
  const [examCompositeBlankAnswers, setExamCompositeBlankAnswers] = useState<Record<string, Record<number, string[]>>>({});

  useEffect(() => {
    if (profile) {
      fetchTests();
      fetchTestHistory();
      fetchExams();
      fetchStudentCorrectCount();
    }
  }, [profile]);

  useEffect(() => {
    if (activeTest && activeTest.timeRemaining > 0) {
      const timer = setInterval(() => {
        setActiveTest((prev) => {
          if (!prev) return null;
          const newTime = prev.timeRemaining - 1;
          if (newTime <= 0) {
            handleSubmitTest();
            return null;
          }
          return { ...prev, timeRemaining: newTime };
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [activeTest]);

  useEffect(() => {
    if (activeExam && activeExam.timeRemaining > 0) {
      const timer = setInterval(() => {
        setActiveExam((prev) => {
          if (!prev) return null;
          const newTime = prev.timeRemaining - 1;
          if (newTime <= 0) {
            handleSubmitExam();
            return null;
          }
          return { ...prev, timeRemaining: newTime };
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [activeExam]);

  // 自动保存考试进度（每10秒）
  useEffect(() => {
    if (!activeExam || !profile || !currentExamRecordId) {
      console.log('自动保存跳过: activeExam=', !!activeExam, 'profile=', !!profile, 'currentExamRecordId=', currentExamRecordId);
      return;
    }
    
    const saveInterval = setInterval(async () => {
      try {
        console.log('保存考试进度, examRecordId:', currentExamRecordId, 'answers:', activeExam.answers);
        await backendClient.saveExamProgress({
          exam_record_id: currentExamRecordId,
          student_id: profile.id,
          test_id: activeExam.test.id,
          answers: activeExam.answers,
          current_index: activeExam.currentIndex,
          time_remaining: activeExam.timeRemaining
        });
        console.log('考试进度已保存');
      } catch (e) {
        console.warn('保存考试进度失败:', e);
      }
    }, 10000); // 每10秒保存一次
    
    return () => clearInterval(saveInterval);
  }, [activeExam, profile, currentExamRecordId]);

  const fetchTests = async () => {
    if (!profile) return;

    const { data: testsData } = await backendClient
      .from('tests')
      .select('*')
      .eq('is_active', true)
      .eq('type', 'test')
      .order('created_at', { ascending: false });
    
    if (testsData) {
      let filteredTests = testsData as Test[];
      if (profile.class_id) {
        filteredTests = filteredTests.filter((test: any) => {
          if (!test.class_ids && !test.class_id) {
            return true;
          }
          if (test.class_ids) {
            let classIds = [] as string[];
            if (Array.isArray(test.class_ids)) {
              classIds = test.class_ids;
            } else if (typeof test.class_ids === 'string') {
              try {
                classIds = JSON.parse(test.class_ids);
              } catch {
                classIds = [];
              }
            }
            if (classIds.length === 0 || classIds.includes(profile.class_id)) {
              return true;
            }
          }
          if (test.class_id === profile.class_id) {
            return true;
          }
          return false;
        });
      }
      setTests(filteredTests);
    }
    setLoading(false);
  };

  const fetchStudentCorrectCount = async () => {
    if (!profile) return;
    const { data } = await backendClient
      .from('student_answers')
      .select('is_correct')
      .eq('student_id', profile.id);
    if (data) {
      const correct = data.filter((a: any) => a.is_correct).length;
      setStudentCorrectCount(correct);
    }
  };

  const fetchExams = async () => {
    if (!profile) return;

    // 先查询考试记录（用于排序和状态显示）
    const { data: recordsData } = await backendClient
      .from('exam_records')
      .select('*')
      .eq('student_id', profile.id)
      .order('completed_at', { ascending: false });
    
    if (recordsData) {
      setMyExamRecords(recordsData as ExamRecord[]);
    }

    const { data: examsData } = await backendClient
      .from('tests')
      .select('*')
      .eq('is_active', true)
      .eq('type', 'exam')
      .order('created_at', { ascending: false });
    
    if (examsData) {
      let filteredExams = examsData as Test[];
      if (profile.class_id) {
        filteredExams = filteredExams.filter((exam: any) => {
          if (!exam.class_ids && !exam.class_id) {
            return true;
          }
          if (exam.class_ids) {
            let classIds = [] as string[];
            if (Array.isArray(exam.class_ids)) {
              classIds = exam.class_ids;
            } else if (typeof exam.class_ids === 'string') {
              try {
                classIds = JSON.parse(exam.class_ids);
              } catch {
                classIds = [];
              }
            }
            if (classIds.length === 0 || classIds.includes(profile.class_id)) {
              return true;
            }
          }
          if (exam.class_id === profile.class_id) {
            return true;
          }
          return false;
        });
      }
      const examRecordsList = recordsData as ExamRecord[] || [];
      filteredExams.sort((a, b) => {
        const recordA = examRecordsList.find(r => r.test_id === a.id);
        const recordB = examRecordsList.find(r => r.test_id === b.id);
        const statusA = recordA ? (recordA.completed_at ? 2 : 1) : 0;
        const statusB = recordB ? (recordB.completed_at ? 2 : 1) : 0;
        return statusA - statusB;
      });
      setExams(filteredExams);
    }
  };

  const fetchTestHistory = async () => {
    if (!profile) return;
    const { data: records } = await backendClient
      .from('test_records')
      .select('*')
      .eq('student_id', profile.id)
      .order('completed_at', { ascending: false });
    
    if (records && records.length > 0) {
      const testIds = records.map((r: any) => r.test_id).filter(Boolean);
      const { data: tests } = await backendClient
        .from('tests')
        .select('*')
        .in('id', testIds);
      
      const testMap = new Map(tests?.map((t: any) => [t.id, t]) || []);
      
      const recordsWithTest = records.map((r: any) => ({
        ...r,
        test: testMap.get(r.test_id) || null,
      }));
      
      setTestHistory(recordsWithTest as TestRecord[]);
    } else {
      setTestHistory([]);
    }
  };

  const startExam = async (exam: Test) => {
    if (!profile) return;

    // 检查考试是否已结束
    try {
      const isClosedResult = await backendClient.isExamClosed(exam.id);
      if (isClosedResult?.data?.isClosed) {
        alert('考试已结束，无法参加');
        fetchExams();
        return;
      }
    } catch (e) {
      console.warn('检查考试状态失败:', e);
    }

    let questionIds: string[] = [];
    if (exam.question_ids) {
      questionIds = parseJsonField(exam.question_ids) || [];
    }

    if (questionIds.length === 0) {
      alert('该考试暂无题目');
      return;
    }

    const shuffledIds = questionIds.sort(() => Math.random() - 0.5);
    const selectedCount = Math.min(shuffledIds.length, (exam as any).question_count || shuffledIds.length);
    const selectedIds = shuffledIds.slice(0, selectedCount);

    const { data: questionsData } = await backendClient
      .from('questions')
      .select('*')
      .in('id', selectedIds);

    if (questionsData && questionsData.length > 0) {
      const shuffledQuestions = (questionsData as Question[]).sort(() => Math.random() - 0.5);
      
      // 直接从后端查询该学生是否有此考试的未完成记录
      const { data: existingRecords } = await backendClient
        .from('exam_records')
        .select('*')
        .eq('test_id', exam.id)
        .eq('student_id', profile.id)
        .is('completed_at', null);
      
      const existingRecord = existingRecords && existingRecords.length > 0 ? existingRecords[0] : null;
      let examRecordId = existingRecord?.id;
      let savedProgress = null;
      
      // 如果有未完成的考试记录，尝试获取保存的进度
      if (examRecordId) {
        try {
          console.log('找到未完成考试记录, examRecordId:', examRecordId);
          const progressResult = await backendClient.getExamProgress(examRecordId);
          console.log('获取进度结果:', progressResult);
          if (progressResult?.data) {
            savedProgress = progressResult.data;
            console.log('已恢复进度, answers:', savedProgress.answers);
          } else {
            console.log('没有找到保存的进度');
          }
        } catch (e) {
          console.warn('获取考试进度失败:', e);
        }
      } else {
        console.log('没有找到未完成的考试记录');
      }
      
      // 如果没有未完成的记录，创建新的
      if (!examRecordId) {
        const now = new Date();
        const { data: newRecord } = await backendClient
          .from('exam_records')
          .insert({
            test_id: exam.id,
            student_id: profile.id,
            selected_question_ids: selectedIds,
            started_at: toDatabaseDateTime(now),
            completed_at: null,  // 显式设置为null，避免默认值
            score: null,
            is_passed: false,
          });
        if (newRecord && newRecord[0]) {
          examRecordId = newRecord[0].id;
        }
      }

      if (!examRecordId) {
        alert('创建考试记录失败，请重试');
        return;
      }

      const examWithExtra = exam as any;
      setCurrentExamTest(examWithExtra);

      // 解析保存进度中的综合题答案
      const savedAnswers = savedProgress?.answers || {};
      const examChoices: Record<string, Record<number, string>> = {};
      const examBlanks: Record<string, Record<number, string[]>> = {};
      for (const [qId, ans] of Object.entries(savedAnswers)) {
        if (typeof ans === 'string' && ans.startsWith('{')) {
          try {
            const parsed = JSON.parse(ans);
            if (parsed.choice_answers) examChoices[qId] = parsed.choice_answers;
            if (parsed.blank_answers) examBlanks[qId] = parsed.blank_answers;
          } catch {}
        }
      }
      setExamCompositeChoiceAnswers(examChoices);
      setExamCompositeBlankAnswers(examBlanks);

      // 设置考试状态，如果有保存的进度则恢复
      setActiveExam({
        test: exam,
        questions: shuffledQuestions,
        answers: savedAnswers,
        currentIndex: savedProgress?.current_index || 0,
        timeRemaining: savedProgress?.time_remaining || (exam.time_limit || 60) * 60,
        startedAt: new Date(),
      });

      // 保存 examRecordId 到 state 以便后续使用
      setCurrentExamRecordId(examRecordId);
      
      // 更新本地 examRecords 列表
      fetchExams();
    }
  };

  const handleAnswerExam = (answer: string) => {
    if (!activeExam) return;
    
    const newAnswers = { ...activeExam.answers, [activeExam.questions[activeExam.currentIndex].id]: answer };
    
    setActiveExam({
      ...activeExam,
      answers: newAnswers,
    });
    
    // 立即保存答题进度
    if (profile && currentExamRecordId) {
      backendClient.saveExamProgress({
        exam_record_id: currentExamRecordId,
        student_id: profile.id,
        test_id: activeExam.test.id,
        answers: newAnswers,
        current_index: activeExam.currentIndex,
        time_remaining: activeExam.timeRemaining
      }).catch(e => console.warn('保存答题进度失败:', e));
    }
  };

  // 测试综合题答案更新
  const handleTestCompositeChoice = (questionId: string, subIndex: number, optionLetter: string, multiple: boolean) => {
    if (!activeTest) return;
    const current = testCompositeChoiceAnswers[questionId] || {};
    let newAnswer = optionLetter;
    if (multiple) {
      const selected = (current[subIndex] || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const idx = selected.indexOf(optionLetter);
      if (idx >= 0) {
        newAnswer = selected.filter((_, i) => i !== idx).join(',');
      } else {
        newAnswer = [...selected, optionLetter].join(',');
      }
    }
    const newChoices = { ...current, [subIndex]: newAnswer };
    setTestCompositeChoiceAnswers({ ...testCompositeChoiceAnswers, [questionId]: newChoices });
    const blanks = testCompositeBlankAnswers[questionId] || {};
    setActiveTest({
      ...activeTest,
      answers: {
        ...activeTest.answers,
        [questionId]: JSON.stringify({ choice_answers: newChoices, blank_answers: blanks })
      }
    });
  };

  const handleTestCompositeBlank = (questionId: string, subIndex: number, blankIndex: number, value: string) => {
    if (!activeTest) return;
    const current = testCompositeBlankAnswers[questionId] || {};
    const currentBlanks = current[subIndex] || [];
    const newBlanksForSub = [...currentBlanks];
    newBlanksForSub[blankIndex] = value;
    const newBlanks = { ...current, [subIndex]: newBlanksForSub };
    setTestCompositeBlankAnswers({ ...testCompositeBlankAnswers, [questionId]: newBlanks });
    const choices = testCompositeChoiceAnswers[questionId] || {};
    setActiveTest({
      ...activeTest,
      answers: {
        ...activeTest.answers,
        [questionId]: JSON.stringify({ choice_answers: choices, blank_answers: newBlanks })
      }
    });
  };

  // 考试综合题答案更新
  const handleExamCompositeChoice = (questionId: string, subIndex: number, optionLetter: string, multiple: boolean) => {
    if (!activeExam) return;
    const current = examCompositeChoiceAnswers[questionId] || {};
    let newAnswer = optionLetter;
    if (multiple) {
      const selected = (current[subIndex] || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const idx = selected.indexOf(optionLetter);
      if (idx >= 0) {
        newAnswer = selected.filter((_, i) => i !== idx).join(',');
      } else {
        newAnswer = [...selected, optionLetter].join(',');
      }
    }
    const newChoices = { ...current, [subIndex]: newAnswer };
    setExamCompositeChoiceAnswers({ ...examCompositeChoiceAnswers, [questionId]: newChoices });
    const blanks = examCompositeBlankAnswers[questionId] || {};
    const newAnswers = {
      ...activeExam.answers,
      [questionId]: JSON.stringify({ choice_answers: newChoices, blank_answers: blanks })
    };
    setActiveExam({ ...activeExam, answers: newAnswers });
    if (profile && currentExamRecordId) {
      backendClient.saveExamProgress({
        exam_record_id: currentExamRecordId,
        student_id: profile.id,
        test_id: activeExam.test.id,
        answers: newAnswers,
        current_index: activeExam.currentIndex,
        time_remaining: activeExam.timeRemaining
      }).catch(e => console.warn('保存答题进度失败:', e));
    }
  };

  const handleExamCompositeBlank = (questionId: string, subIndex: number, blankIndex: number, value: string) => {
    if (!activeExam) return;
    const current = examCompositeBlankAnswers[questionId] || {};
    const currentBlanks = current[subIndex] || [];
    const newBlanksForSub = [...currentBlanks];
    newBlanksForSub[blankIndex] = value;
    const newBlanks = { ...current, [subIndex]: newBlanksForSub };
    setExamCompositeBlankAnswers({ ...examCompositeBlankAnswers, [questionId]: newBlanks });
    const choices = examCompositeChoiceAnswers[questionId] || {};
    const newAnswers = {
      ...activeExam.answers,
      [questionId]: JSON.stringify({ choice_answers: choices, blank_answers: newBlanks })
    };
    setActiveExam({ ...activeExam, answers: newAnswers });
    if (profile && currentExamRecordId) {
      backendClient.saveExamProgress({
        exam_record_id: currentExamRecordId,
        student_id: profile.id,
        test_id: activeExam.test.id,
        answers: newAnswers,
        current_index: activeExam.currentIndex,
        time_remaining: activeExam.timeRemaining
      }).catch(e => console.warn('保存答题进度失败:', e));
    }
  };

  const handleNextExam = () => {
    if (!activeExam) return;
    if (activeExam.currentIndex < activeExam.questions.length - 1) {
      const newIndex = activeExam.currentIndex + 1;
      setActiveExam({ ...activeExam, currentIndex: newIndex });
      
      // 立即保存当前索引
      if (profile && currentExamRecordId) {
        backendClient.saveExamProgress({
          exam_record_id: currentExamRecordId,
          student_id: profile.id,
          test_id: activeExam.test.id,
          answers: activeExam.answers,
          current_index: newIndex,
          time_remaining: activeExam.timeRemaining
        }).catch(e => console.warn('保存答题进度失败:', e));
      }
    }
  };

  const handlePrevExam = () => {
    if (!activeExam) return;
    if (activeExam.currentIndex > 0) {
      const newIndex = activeExam.currentIndex - 1;
      setActiveExam({ ...activeExam, currentIndex: newIndex });
      
      // 立即保存当前索引
      if (profile && currentExamRecordId) {
        backendClient.saveExamProgress({
          exam_record_id: currentExamRecordId,
          student_id: profile.id,
          test_id: activeExam.test.id,
          answers: activeExam.answers,
          current_index: newIndex,
          time_remaining: activeExam.timeRemaining
        }).catch(e => console.warn('保存答题进度失败:', e));
      }
    }
  };

  const handleSubmitExam = async () => {
    if (!activeExam || !profile || isSubmitting) return;

    // 检查考试是否已结束
    try {
      const isClosedResult = await backendClient.isExamClosed(activeExam.test.id);
      if (isClosedResult?.data?.isClosed) {
        alert('考试已结束，无法提交');
        setActiveExam(null);
        setShowExamList(false);
        fetchExams();
        setIsSubmitting(false);
        return;
      }
    } catch (e) {
      console.warn('检查考试状态失败:', e);
    }

    setIsSubmitting(true);
    
    try {
      const result = await backendClient.businessSubmitExam({
        student_id: profile.id,
        test_id: activeExam.test.id,
        answers: activeExam.answers,
        questions: activeExam.questions
      });

      if (result.error) {
        alert(result.error || '提交失败，请重试');
        setIsSubmitting(false);
        return;
      }

      const { score, correct, total, is_passed, points_earned, internet_codes, dropped_equipments } = result.data;

      const droppedEquipments = dropped_equipments || [];
      
      if (droppedEquipments.length > 0) {
        emitEvent('equipment_drop', { equipments: droppedEquipments });
      }

      // 提交成功后删除考试进度记录
      if (currentExamRecordId) {
        try {
          await backendClient.deleteExamProgress(currentExamRecordId);
        } catch (e) {
          console.warn('删除考试进度失败:', e);
        }
      }

      setExamResult({ 
        score, 
        correct, 
        points: points_earned, 
        internetCodes: internet_codes.length,
        codes: internet_codes,
        questions: activeExam.questions, 
        answers: activeExam.answers,
        isPassed: is_passed
      });
      setShowResult(true);
      setActiveExam(null);
      refreshProfile();
      fetchExams();
    } catch (error) {
      console.error('考试提交失败:', error);
      alert('提交失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [examInternetCodes, setExamInternetCodes] = useState<string[]>([]);

  const fetchExamDetail = async (record: ExamRecord) => {
    console.log('fetchExamDetail 开始...');
    console.log('record:', record);
    
    // 查询上网码
    let codes: string[] = [];
    try {
      if (record.internet_codes_earned > 0) {
        const { data: codesData } = await backendClient
          .from('internet_codes')
          .select('code')
          .eq('used_by', profile?.id)
          .eq('is_used', true)
          .order('used_at', { ascending: false })
          .limit(record.internet_codes_earned);
        
        if (codesData && codesData.length > 0) {
          codes = codesData.map((c: any) => c.code);
        }
      }
    } catch (e) {
      console.error('查询上网码失败:', e);
    }
    
    setExamInternetCodes(codes);
    
    // 先获取所有需要的 question_ids
    let questionIds: string[] = [];
    
    // 优先从 selected_question_ids 获取
    if (record.selected_question_ids) {
      if (typeof record.selected_question_ids === 'string') {
        try {
          questionIds = JSON.parse(record.selected_question_ids);
        } catch {
          questionIds = [];
        }
      } else if (Array.isArray(record.selected_question_ids)) {
        questionIds = record.selected_question_ids;
      }
    }
    
    // 如果没有，再从 student_answers 表获取
    if (!questionIds || questionIds.length === 0) {
      try {
        console.log('从 student_answers 表获取 question_ids');
        // 先尝试带 source 条件查询
        let saData;
        try {
          const result = await backendClient
            .from('student_answers')
            .select('question_id, answer')
            .eq('student_id', profile?.id)
            .eq('test_id', record.test_id)
            .eq('source', 'exam');
          saData = result.data;
        } catch (e) {
          console.warn('带 source 查询失败，尝试无 source 查询:', e);
          // 如果失败，尝试不限制 source
          const result = await backendClient
            .from('student_answers')
            .select('question_id, answer')
            .eq('student_id', profile?.id)
            .eq('test_id', record.test_id);
          saData = result.data;
        }
        
        if (saData && saData.length > 0) {
          questionIds = saData.map((item: any) => item.question_id);
        }
      } catch (e) {
        console.error('获取 student_answers 失败:', e);
      }
    }
    
    console.log('questionIds:', questionIds);
    
    // 如果有 question_ids，直接查询 questions 表
    if (questionIds && questionIds.length > 0) {
      const { data: questionsData } = await backendClient
        .from('questions')
        .select('*')
        .in('id', questionIds);
      
      console.log('questionsData:', questionsData);
      
      if (questionsData && questionsData.length > 0) {
        // 同时获取答案数据
        const answers: Record<string, string> = {};
        try {
          let answerRecords;
          try {
            const result = await backendClient
              .from('student_answers')
              .select('question_id, answer')
              .eq('student_id', profile?.id)
              .eq('test_id', record.test_id)
              .eq('source', 'exam');
            answerRecords = result.data;
          } catch (e) {
            console.warn('带 source 查询答案失败，尝试无 source 查询:', e);
            // 如果失败，尝试不限制 source
            const result = await backendClient
              .from('student_answers')
              .select('question_id, answer')
              .eq('student_id', profile?.id)
              .eq('test_id', record.test_id);
            answerRecords = result.data;
          }
          
          if (answerRecords && answerRecords.length > 0) {
            answerRecords.forEach((item: any) => {
              answers[item.question_id] = item.answer || '';
            });
          }
        } catch (e) {
          console.error('获取答案记录失败:', e);
        }
        
        // 构建最终数据
        const questions: Question[] = [];
        questionsData.forEach(q => {
          questions.push(q as Question);
          if (!answers[q.id]) {
            answers[q.id] = '';
          }
        });
        
        console.log('最终 questions:', questions);
        console.log('最终 answers:', answers);
        
        setExamDetailData({ questions, answers });
        setSelectedExamRecord(record);
        setShowExamDetail(true);
        return;
      }
    }
    
    alert('暂无试卷详情');
  };

  const getExamStatus = (exam: Test): { status: string; color: string; record?: ExamRecord } => {
    const record = myExamRecords.find(r => r.test_id === exam.id);
    if (record) {
      // 检查考试是否已完成（有 completed_at 字段）
      if (!record.completed_at) {
        return { 
          status: '进行中', 
          color: 'text-blue-600',
          record 
        };
      }
      return { 
        status: record.is_passed ? '已通过' : '未通过', 
        color: record.is_passed ? 'text-green-600' : 'text-red-600',
        record 
      };
    }
    return { status: '未参加', color: 'text-gray-500' };
  };

  const canViewExamPaper = (exam: Test | undefined | null | any): boolean => {
    if (!exam) return false;
    const value = exam.allow_view_paper;
    console.log('canViewExamPaper 检查:', { examTitle: (exam as any).title || exam.name, allow_view_paper: value, type: typeof value });
    // 允许 true、"true"、1、"1" 等值
    const result = value === true || value === 'true' || value === 1 || value === '1';
    console.log('canViewExamPaper 结果:', result);
    return result;
  };

  const getExamQuestionIds = (exam: Test): string[] => {
    if (!exam.question_ids) return [];
    const ids = parseJsonField(exam.question_ids);
    return Array.isArray(ids) ? ids : [];
  };

  // ===== 每日测试次数限制辅助 =====
  // 统计口径与服务端一致：test_records 中该生当天对该测试的提交条数
  const isSameLocalDay = (ts: any): boolean => {
    if (!ts) return false;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  };

  const getTodayAttempts = (testId: string): number => {
    return testHistory.filter((r: any) => r.test_id === testId && isSameLocalDay(r.completed_at)).length;
  };

  const getDailyLimit = (test: any): number => parseInt(test?.daily_test_limit, 10) || 0;

  const startTest = async (test: Test) => {
    // 每日测试次数限制（教师端可设置，0 = 不限制）
    const limit = getDailyLimit(test);
    if (limit > 0) {
      const used = getTodayAttempts(test.id);
      if (used >= limit) {
        alert(`今日该测试次数已用完（每天最多 ${limit} 次），请明天再来`);
        fetchTestHistory();
        return;
      }
    }

    const { data: freshTestData } = await backendClient.from('tests').select('*').eq('id', test.id).maybeSingle();
    const testData = (freshTestData || test) as any;

    console.log('startTest - testData:', testData);
    console.log('startTest - tag_filters:', testData.tag_filters, typeof testData.tag_filters);

    const { data: allQuestions } = await backendClient
      .from('questions')
      .select('*')
      .eq('exam_enabled', true);

    console.log('startTest - allQuestions count:', allQuestions?.length);

    if (allQuestions && allQuestions.length > 0) {
      let filtered = allQuestions as Question[];

      if (testData.tag_filters) {
        let tagFilters: string[] = [];
        if (Array.isArray(testData.tag_filters)) {
          tagFilters = testData.tag_filters;
        } else if (typeof testData.tag_filters === 'string') {
          try {
            tagFilters = JSON.parse(testData.tag_filters);
          } catch {}
        }
        console.log('startTest - tagFilters after parse:', tagFilters);

        if (tagFilters.length > 0) {
          filtered = filtered.filter((q) => {
            const tags = parseTags(q.tags);
            return tagFilters.some((tag) => tags.includes(tag));
          });
          console.log('startTest - after tag filter count:', filtered.length);
        }
      }

      if (filtered.length === 0) {
        alert(`当前标签范围内没有可用题目（共${allQuestions.length}道，标签筛选后0道），请联系老师调整测试设置`);
        return;
      }

      const shuffled = filtered.sort(() => Math.random() - 0.5);
      const selectedQuestions = shuffled.slice(0, test.question_count || 20);
      setActiveTest({
        test,
        questions: selectedQuestions as Question[],
        answers: {},
        currentIndex: 0,
        timeRemaining: (test.time_limit || 30) * 60,
        startedAt: new Date(),
      });
      setTestCompositeChoiceAnswers({});
      setTestCompositeBlankAnswers({});
    }
  };

  const handleAnswer = (answer: string) => {
    if (!activeTest) return;
    setActiveTest({
      ...activeTest,
      answers: { ...activeTest.answers, [activeTest.questions[activeTest.currentIndex].id]: answer },
    });
  };

  const handleNext = () => {
    if (!activeTest) return;
    if (activeTest.currentIndex < activeTest.questions.length - 1) {
      setActiveTest({ ...activeTest, currentIndex: activeTest.currentIndex + 1 });
    }
  };

  const handlePrev = () => {
    if (!activeTest) return;
    if (activeTest.currentIndex > 0) {
      setActiveTest({ ...activeTest, currentIndex: activeTest.currentIndex - 1 });
    }
  };

  const handleSubmitTest = async () => {
    if (!activeTest || !profile || isSubmitting) return;

    setIsSubmitting(true);
    
    try {
      // 使用新的业务API
      console.log('[handleSubmitTest] 开始调用 businessSubmitTest API');
      const result = await backendClient.businessSubmitTest({
        student_id: profile.id,
        test_id: activeTest.test.id,
        answers: activeTest.answers,
        questions: activeTest.questions
      });

      console.log('[handleSubmitTest] API返回结果:', result);
      
      if (result.error) {
        alert(result.error || '提交失败，请重试');
        setIsSubmitting(false);
        return;
      }

      const { score, correct, total, is_passed, points_earned, internet_code, dropped_equipments } = result.data;

      const droppedEquipments = dropped_equipments || [];
      console.log('[handleSubmitTest] 掉落装备:', droppedEquipments, '数量:', droppedEquipments.length);
      
      setTestResult({ score, correct, points: points_earned, internetCode: internet_code, questions: activeTest.questions, answers: activeTest.answers, droppedEquipments });
      setShowResult(true);
      setActiveTest(null);
      
      if (droppedEquipments.length > 0) {
        console.log('[handleSubmitTest] 触发 equipment_drop 事件');
        emitEvent('equipment_drop', { equipments: droppedEquipments });
      }
      
      // 更新本地用户信息
      if (result.data?.student) {
        refreshProfile();
      }
      
      fetchTestHistory();
    } catch (apiError: any) {
      // 服务端业务规则拒绝（HTTP 4xx，如「今日测试次数已用完」「测试不存在」「考试已结束」）
      // 必须直接提示并结束，绝不能走下面的前端降级逻辑 ——
      // 否则前端会自己判分、自己发积分、自己插入测试记录，把服务端的次数限制整条绕过。
      if (apiError?.status && apiError.status >= 400 && apiError.status < 500) {
        console.warn('[handleSubmitTest] 服务端拒绝提交:', apiError.message);
        alert(apiError.message || '提交失败，请稍后重试');
        fetchTestHistory();
        return;
      }

      // 仅网络异常/服务端 5xx 才降级使用原方法
      console.error('[handleSubmitTest] 业务API调用失败，降级使用原始方法:', apiError);
      
      let correct = 0;
      const answers = activeTest.answers;

      const normalizeAnswer = (ans: string) => {
        return ans.toLowerCase().trim();
      };

      activeTest.questions.forEach((q) => {
        const userAnswer = answers[q.id];
        if (!userAnswer) return;
        if (q.type === 'composite') {
          try {
            const parsed = JSON.parse(userAnswer);
            const subQs = getCompositeSubQuestions(q.answers);
            const allCorrect = subQs.every((sq: any, idx: number) => {
              if (sq.type === 'choice') {
                const ans = parsed.choice_answers?.[idx] || '';
                return checkChoiceAnswer(ans, sq.answers || [], sq.multiple || false);
              } else if (sq.type === 'fill_blank') {
                const ans = parsed.blank_answers?.[idx] || [];
                return checkFillBlankAnswer(ans, sq.answers || []);
              }
              return false;
            });
            if (allCorrect) correct++;
          } catch {
            // 解析失败不计分
          }
        } else {
          const correctAnswers = getAnswers(q.answers);
          if (correctAnswers.some((ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer))) {
            correct++;
          }
        }
      });

      const total = activeTest.questions.length;
      const score = Math.round((correct / total) * 100);
      const passingScore = (activeTest.test as any).passing_score || 60;
      const isPassed = score >= passingScore;
      const pointsEarned = isPassed ? Math.round((score / 100) * (activeTest.test.points_reward || 50)) : 0;

      // 先插入 test_record 并获取生成的 id
      const { data: testRecordData } = await backendClient.from('test_records').insert({
        test_id: activeTest.test.id,
        student_id: profile.id,
        score,
        correct_count: correct,
        total_count: total,
        points_earned: pointsEarned,
      });

      let fallbackInternetCode = '';
      if (isPassed) {
        const testData = activeTest.test as any;
        if (testData.allow_internet_code && testData.internet_code_reward > 0) {
          const { data: allRecords } = await backendClient
            .from('test_records')
            .select('internet_code, completed_at')
            .eq('student_id', profile.id);
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
          const alreadyGotCodeToday = allRecords && allRecords.some((r: any) => {
            if (!r.internet_code) return false;
            const d = new Date(r.completed_at);
            const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            return dStr === todayStr;
          });
          if (!alreadyGotCodeToday) {
            const { data: availableCodes } = await backendClient
              .from('internet_codes')
              .select('code')
              .eq('is_used', false)
              .limit(1);
            if (availableCodes && availableCodes.length > 0) {
              fallbackInternetCode = availableCodes[0].code;
              await backendClient
                .from('internet_codes')
                .update({ is_used: true, used_by: profile.id, used_by_username: profile.username || '', used_at: new Date().toISOString(), source: 'test', source_id: activeTest.test.id })
                .eq('code', fallbackInternetCode);
            }
          }
        }
        await updatePoints(profile.id, pointsEarned);
      }

      if (testRecordData && testRecordData[0] && fallbackInternetCode) {
        await backendClient.from('test_records').update({ internet_code: fallbackInternetCode }).eq('id', testRecordData[0].id);
      }

      for (const q of activeTest.questions) {
        const userAnswer = (answers[q.id] || '').trim();
        const normalizeAns = (ans: any) => (ans?.toString() || '').toLowerCase().trim();
        let isCorrect = false;
        if (q.type === 'composite') {
          try {
            const parsed = JSON.parse(userAnswer);
            const subQs = getCompositeSubQuestions(q.answers);
            isCorrect = subQs.every((sq: any, idx: number) => {
              if (sq.type === 'choice') {
                const ans = parsed.choice_answers?.[idx] || '';
                return checkChoiceAnswer(ans, sq.answers || [], sq.multiple || false);
              } else if (sq.type === 'fill_blank') {
                const ans = parsed.blank_answers?.[idx] || [];
                return checkFillBlankAnswer(ans, sq.answers || []);
              }
              return false;
            });
          } catch {
            isCorrect = false;
          }
        } else {
          isCorrect = getAnswers(q.answers).some(
            (ans) => normalizeAns(ans) === normalizeAns(userAnswer)
          );
        }

        if (userAnswer) {
          await backendClient.from('student_answers').insert({
            student_id: profile.id,
            question_id: q.id,
            answer: userAnswer,
            is_correct: isCorrect,
            points_change: 0,
            source: 'test',
            test_id: activeTest.test.id,
            test_record_id: testRecordData?.[0]?.id,
          });
        }

        if (!isCorrect) {
          const { data: existing } = await backendClient
            .from('wrong_questions')
            .select('*')
            .eq('student_id', profile.id)
            .eq('question_id', q.id)
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
              question_id: q.id,
            });
          }
        }
      }

      setTestResult({ score, correct, points: pointsEarned, internetCode: fallbackInternetCode, questions: activeTest.questions, answers: activeTest.answers });
      setShowResult(true);
      setActiveTest(null);
      
      // 降级路径也尝试通过后端API触发装备掉落
      // 注意：服务端会校验这条 test_record 是否真实存在且及格，并对同一条记录只发放一次掉落，
      //       因此这里必须带上 test_record_id。
      if (isPassed && testRecordData?.[0]?.id) {
        try {
          console.log('[handleSubmitTest] 降级路径：调用装备掉落API');
          const dropResult = await backendClient.post('/api/business/test-equipment-drop', {
            student_id: profile.id,
            test_id: activeTest.test.id,
            test_record_id: testRecordData[0].id
          });
          console.log('[handleSubmitTest] 降级路径：掉落结果:', dropResult);
          if (dropResult?.data?.dropped_equipments?.length > 0) {
            console.log('[handleSubmitTest] 降级路径：触发装备掉落特效');
            emitEvent('equipment_drop', { equipments: dropResult.data.dropped_equipments });
          }
        } catch (e) {
          console.warn('装备掉落API调用失败:', e);
        }
      }
      
      refreshProfile();
      fetchTestHistory();
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchTestDetail = async (record: TestRecord) => {
    // 先尝试通过 test_record_id 查找
    let query = backendClient
      .from('student_answers')
      .select('*, question:questions(*)')
      .eq('student_id', profile?.id)
      .eq('source', 'test');

    if ((record as any).id) {
      query = query.eq('test_record_id', (record as any).id);
    } else {
      query = query.eq('test_id', record.test_id);
    }

    const { data: answersData } = await query.order('created_at', { ascending: true });

    if (answersData && answersData.length > 0) {
      const questions: Question[] = [];
      const answers: Record<string, string> = {};
      answersData.forEach((item: any) => {
        if (item.question) {
          questions.push(item.question);
          answers[item.question.id] = item.answer || '';
        }
      });
      setTestDetailData({ questions, answers });
      setSelectedTestRecord(record);
      setShowTestDetail(true);
    } else {
      // 如果没有找到答案，显示提示
      alert('暂无详细答题记录');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  if (showResult && examResult) {
    const examTest = currentExamTest;
    console.log('=== 考试结果页面调试 ===');
    console.log('currentExamTest:', currentExamTest);
    console.log('examTest?.allow_view_paper:', examTest?.allow_view_paper);
    console.log('canViewExamPaper(examTest):', canViewExamPaper(examTest));
    
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-xl shadow-lg border border-gray-200 p-8"
        >
          <div className="text-center mb-8">
            <div className={`w-24 h-24 rounded-full mx-auto mb-6 flex items-center justify-center ${
              examResult.isPassed ? 'bg-gradient-to-br from-green-400 to-green-600' : 'bg-gradient-to-br from-red-400 to-red-600'
            }`}>
              <i className={`fa-solid ${examResult.isPassed ? 'fa-trophy' : 'fa-times-circle'} text-white text-4xl`}></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {examResult.isPassed ? '恭喜通过考试！' : '考试未通过'}
            </h2>
            <div className="grid grid-cols-3 gap-4 my-6 max-w-lg mx-auto">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-gray-600">得分</p>
                <p className="text-3xl font-bold text-blue-600">{examResult.score}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-sm text-gray-600">正确</p>
                <p className="text-3xl font-bold text-green-600">{examResult.correct}/{examResult.questions.length}</p>
              </div>
              {examResult.isPassed ? (
                <>
                  <div className="bg-yellow-50 rounded-lg p-4">
                    <p className="text-sm text-gray-600">获得积分</p>
                    <p className="text-3xl font-bold text-yellow-600">+{examResult.points}</p>
                  </div>
                  {examResult.internetCodes > 0 && examResult.codes.length > 0 ? (
                    <div className="col-span-3 bg-purple-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600 mb-3">获得上网码</p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        {examResult.codes.map((code, index) => (
                          <div key={index} className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm">
                            <span className="font-mono font-bold text-purple-600">{code}</span>
                            <button
                              onClick={() => {
                                // 兼容的复制方法
                                const copyToClipboard = (text: string) => {
                                  // 首先尝试现代方法
                                  if (navigator.clipboard && window.isSecureContext) {
                                    return navigator.clipboard.writeText(text).then(() => {
                                      alert('复制成功！');
                                    }).catch((err) => {
                                      console.error('Clipboard API failed:', err);
                                      fallbackCopy(text);
                                    });
                                  } else {
                                    // 降级到传统方法
                                    fallbackCopy(text);
                                  }
                                };
                                
                                const fallbackCopy = (text: string) => {
                                  const textArea = document.createElement('textarea');
                                  textArea.value = text;
                                  textArea.style.position = 'fixed';
                                  textArea.style.left = '-9999px';
                                  document.body.appendChild(textArea);
                                  textArea.focus();
                                  textArea.select();
                                  try {
                                    const successful = document.execCommand('copy');
                                    if (successful) {
                                      alert('复制成功！');
                                    } else {
                                      alert('复制失败，请手动复制');
                                    }
                                  } catch (err) {
                                    console.error('Fallback copy failed:', err);
                                    alert('复制失败，请手动复制');
                                  }
                                  document.body.removeChild(textArea);
                                };
                                
                                copyToClipboard(code);
                              }}
                              className="text-gray-400 hover:text-purple-600 transition-colors"
                              title="复制上网码"
                            >
                              <i className="fa-solid fa-copy"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : examResult.internetCodes > 0 && examResult.codes.length === 0 ? (
                    <div className="col-span-3 bg-red-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600">上网码</p>
                      <p className="text-red-600">暂无可用上网码，请联系老师</p>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">及格分数</p>
                  <p className="text-3xl font-bold text-gray-600">{exams.find(() => true)?.passing_score || 60}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 mt-6">
            {examTest && canViewExamPaper(examTest) && (
              <button
                onClick={() => {
                  setShowResult(false);
                  setExamResult(null);
                  const record = myExamRecords.find(r => r.test_id === examTest.id);
                  if (record) {
                    fetchExamDetail(record);
                  }
                }}
                className="px-8 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                <i className="fa-solid fa-eye mr-2"></i>查看试卷
              </button>
            )}
            <button
              onClick={() => {
                setShowResult(false);
                setExamResult(null);
                fetchExams();
              }}
              className="px-8 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              返回考试列表
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (showResult && testResult) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-xl shadow-lg border border-gray-200 p-8"
        >
          <div className="text-center mb-8">
            <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-600 rounded-full mx-auto mb-6 flex items-center justify-center">
              <i className="fa-solid fa-trophy text-white text-4xl"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">测试完成!</h2>
            <div className="grid grid-cols-3 gap-4 my-6 max-w-lg mx-auto">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-gray-600">得分</p>
                <p className="text-3xl font-bold text-blue-600">{testResult.score}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-sm text-gray-600">正确</p>
                <p className="text-3xl font-bold text-green-600">{testResult.correct}</p>
              </div>
              <div className="bg-yellow-50 rounded-lg p-4">
                <p className="text-sm text-gray-600">获得积分</p>
                <p className="text-3xl font-bold text-yellow-600">+{testResult.points}</p>
              </div>
            </div>
            {testResult.internetCode && (
              <div className="bg-purple-50 rounded-lg p-4 max-w-lg mx-auto">
                <p className="text-sm text-gray-600 mb-1">获得上网认证码</p>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono font-bold text-lg text-purple-600">{testResult.internetCode}</span>
                  <button
                    onClick={() => {
                      const code = testResult.internetCode as string;
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(code).then(() => alert('复制成功！')).catch(() => {
                          const ta = document.createElement('textarea');
                          ta.value = code;
                          ta.style.position = 'fixed';
                          ta.style.left = '-9999px';
                          document.body.appendChild(ta);
                          ta.focus();
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                          alert('复制成功！');
                        });
                      } else {
                        const ta = document.createElement('textarea');
                        ta.value = code;
                        ta.style.position = 'fixed';
                        ta.style.left = '-9999px';
                        document.body.appendChild(ta);
                        ta.focus();
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        alert('复制成功！');
                      }
                    }}
                    className="text-gray-400 hover:text-purple-600 transition-colors"
                    title="复制认证码"
                  >
                    <i className="fa-solid fa-copy"></i>
                  </button>
                </div>
              </div>
            )}
            {testResult.droppedEquipments && testResult.droppedEquipments.length > 0 && (
              <div className="bg-amber-50 rounded-lg p-4 max-w-lg mx-auto mt-4">
                <p className="text-sm text-gray-600 mb-3">🎉 获得装备掉落</p>
                <div className="flex flex-wrap gap-3 justify-center">
                  {testResult.droppedEquipments.map((eq: any, index: number) => (
                    <div key={index} className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm">
                      <span className="text-2xl">{eq.icon}</span>
                      <div className="text-left">
                        <p className="font-bold text-amber-700">{eq.name}</p>
                        <p className="text-xs text-amber-500">+{eq.crit_bonus}% 暴击</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">答题详情</h3>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {testResult.questions.map((q, index) => {
                const userAnswer = testResult.answers[q.id] || '';
                const correctAnswers = getAnswers(q.answers);
                const normalizeAnswer = (ans: any) => {
                  return (ans?.toString() || '').toLowerCase().trim();
                };
                const isAnswered = userAnswer && userAnswer.trim() !== '';
                const isCorrect = isAnswered && correctAnswers.some((ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer));
                return (
                  <div key={q.id} className={`p-4 rounded-lg border ${isAnswered ? (isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200') : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-lg ${isAnswered ? (isCorrect ? 'bg-green-500 text-white' : 'bg-red-500 text-white') : 'bg-gray-400 text-white'}`}>
                        {isAnswered ? (isCorrect ? <i className="fa-solid fa-check"></i> : <i className="fa-solid fa-xmark"></i>) : <i className="fa-solid fa-minus"></i>}
                      </span>
                      <div className="flex-1">
                        <div className="font-medium text-gray-800 mb-2 question-rich-content">
                          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.content) }} />
                        </div>
                        {q.type === 'choice' && q.options && (
                          <div className="text-sm space-y-1 mb-3">
                            {getOptions(q.options).map((opt: string, idx: number) => (
                              <div key={idx} className="flex items-start gap-2">
                                <span className="font-medium text-gray-600 flex-shrink-0">{String.fromCharCode(65 + idx)}.</span>
                                <span className="question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(opt) }} />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="text-sm space-y-1">
                          <p className={isAnswered ? (isCorrect ? 'text-green-700' : 'text-red-700') : 'text-gray-500'}>
                            <span className="font-medium">你的答案:</span> {userAnswer || '未作答'}
                          </p>
                          {!isCorrect && (
                            <p className="text-green-700">
                              <span className="font-medium">正确答案:</span> {correctAnswers.join(' / ')}
                            </p>
                          )}
                          {q.explanation && (
                            <div className="text-gray-600 mt-2 pt-2 border-t border-gray-200 question-rich-content">
                              <span className="font-medium">解析:</span>
                              <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.explanation) }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-center mt-6">
            <button
              onClick={() => setShowResult(false)}
              className="px-8 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              返回测试列表
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (activeTest) {
    const currentQuestion = activeTest.questions[activeTest.currentIndex];
    const progress = ((activeTest.currentIndex + 1) / activeTest.questions.length) * 100;

    return (
      <div className="p-6 max-w-4xl mx-auto select-none" style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800">{(activeTest.test as any).title || activeTest.test.name}</h2>
          <div className={`text-lg font-mono ${activeTest.timeRemaining < 60 ? 'text-red-500' : 'text-gray-600'}`}>
            <i className="fa-solid fa-clock mr-2"></i>
            {formatTime(activeTest.timeRemaining)}
          </div>
        </div>

        <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          ></div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-500">
              题目 {activeTest.currentIndex + 1} / {activeTest.questions.length}
            </span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentQuestion.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="text-lg font-medium text-gray-800 mb-6 leading-relaxed question-rich-content">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.content) }} />
              </div>

              {currentQuestion.type === 'choice' && currentQuestion.options && (
                <div className="space-y-3">
                  {getOptions(currentQuestion.options).map((option: string, index: number) => {
                    const optionLetter = String.fromCharCode(65 + index);
                    return (
                      <button
                        key={index}
                        onClick={() => handleAnswer(optionLetter)}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                          activeTest.answers[currentQuestion.id] === optionLetter
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300'
                        }`}
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
                    value={activeTest.answers[currentQuestion.id] || ''}
                    onChange={(e) => handleAnswer(e.target.value)}
                    placeholder="请输入答案"
                    className="w-full p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              {currentQuestion.type === 'composite' && (
                <div className="mt-4 space-y-4">
                  {getCompositeSubQuestions(currentQuestion.answers).map((sq: any, sqIdx: number) => (
                    <div key={sqIdx} className="p-4 rounded-lg border-2 bg-gray-50 border-gray-200">
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
                      </div>
                      <div className="text-base text-gray-800 mb-3 leading-relaxed question-rich-content">
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(sq.content) }} />
                      </div>
                      {sq.type === 'choice' && Array.isArray(sq.options) && (
                        <div className="space-y-2">
                          {sq.options.map((option: string, oIdx: number) => {
                            const optionLetter = String.fromCharCode(65 + oIdx);
                            const userAnswer = (testCompositeChoiceAnswers[currentQuestion.id] || {})[sqIdx] || '';
                            const isSelected = sq.multiple
                              ? userAnswer.split(',').map((s: string) => s.trim().toUpperCase()).includes(optionLetter)
                              : userAnswer === optionLetter;
                            return (
                              <button
                                key={oIdx}
                                onClick={() => handleTestCompositeChoice(currentQuestion.id, sqIdx, optionLetter, sq.multiple)}
                                className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                                  isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                                }`}
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
                            const currentBlankAnswers = (testCompositeBlankAnswers[currentQuestion.id] || {})[sqIdx] || Array(blankCount).fill('');
                            return Array.from({ length: blankCount }).map((_, bIdx) => (
                              <div key={bIdx} className="flex items-center gap-2">
                                <span className="text-sm text-gray-600 w-16 flex-shrink-0">第{bIdx + 1}空：</span>
                                <input
                                  type="text"
                                  value={currentBlankAnswers[bIdx] || ''}
                                  onChange={(e) => handleTestCompositeBlank(currentQuestion.id, sqIdx, bIdx, e.target.value)}
                                  placeholder="请输入答案"
                                  className="flex-1 p-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                                />
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex justify-between">
          <button
            onClick={handlePrev}
            disabled={activeTest.currentIndex === 0}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            上一题
          </button>
          {activeTest.currentIndex < activeTest.questions.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={isSubmitting}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              下一题
            </button>
          ) : (
            <button
              onClick={handleSubmitTest}
              disabled={isSubmitting}
              className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? <i className="fa-solid fa-spinner fa-spin mr-2"></i> : null}
              {isSubmitting ? '提交中...' : '提交测试'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (activeExam) {
    const currentQuestion = activeExam.questions[activeExam.currentIndex];
    const progress = ((activeExam.currentIndex + 1) / activeExam.questions.length) * 100;

    // 计算已答题目数量
    const answeredCount = Object.keys(activeExam.answers).filter(qId => {
      const answer = activeExam.answers[qId];
      return answer !== undefined && answer !== null && answer.toString().trim() !== '';
    }).length;

    return (
      <div className="p-6 select-none flex gap-4" style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
        {/* 左侧：考试内容区 */}
        <div className={`flex-1 ${showExamNavigator ? 'max-w-3xl' : 'max-w-4xl'} mx-auto`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-800">{(activeExam.test as any).title || activeExam.test.name}</h2>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">已答: {answeredCount}/{activeExam.questions.length}</span>
              <div className={`text-lg font-mono ${activeExam.timeRemaining < 60 ? 'text-red-500' : 'text-gray-600'}`}>
                <i className="fa-solid fa-clock mr-2"></i>
                {formatTime(activeExam.timeRemaining)}
              </div>
              {/* 导航面板切换按钮 */}
              <button
                onClick={() => setShowExamNavigator(!showExamNavigator)}
                className={`p-2 rounded-lg transition-colors ${showExamNavigator ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                title={showExamNavigator ? '隐藏题目导航' : '显示题目导航'}
              >
                <i className={`fa-solid fa-list-ul`}></i>
              </button>
            </div>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
            <div
              className="bg-purple-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            ></div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-500">
                题目 {activeExam.currentIndex + 1} / {activeExam.questions.length}
              </span>
              <span className="px-3 py-1 bg-purple-100 text-purple-600 rounded-full text-sm">
                考试模式
              </span>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={currentQuestion.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="text-lg font-medium text-gray-800 mb-6 leading-relaxed question-rich-content">
                  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.content) }} />
                </div>

                {currentQuestion.type === 'choice' && currentQuestion.options && (
                  <div className="space-y-3">
                    {getOptions(currentQuestion.options).map((option: string, index: number) => {
                      const optionLetter = String.fromCharCode(65 + index);
                      return (
                        <button
                          key={index}
                          onClick={() => handleAnswerExam(optionLetter)}
                          className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                            activeExam.answers[currentQuestion.id] === optionLetter
                              ? 'border-purple-500 bg-purple-50'
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
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
                      value={activeExam.answers[currentQuestion.id] || ''}
                      onChange={(e) => handleAnswerExam(e.target.value)}
                      placeholder="请输入答案"
                      className="w-full p-4 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                )}

                {currentQuestion.type === 'composite' && (
                  <div className="mt-4 space-y-4">
                    {getCompositeSubQuestions(currentQuestion.answers).map((sq: any, sqIdx: number) => (
                      <div key={sqIdx} className="p-4 rounded-lg border-2 bg-gray-50 border-gray-200">
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
                        </div>
                        <div className="text-base text-gray-800 mb-3 leading-relaxed question-rich-content">
                          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(sq.content) }} />
                        </div>
                        {sq.type === 'choice' && Array.isArray(sq.options) && (
                          <div className="space-y-2">
                            {sq.options.map((option: string, oIdx: number) => {
                              const optionLetter = String.fromCharCode(65 + oIdx);
                              const userAnswer = (examCompositeChoiceAnswers[currentQuestion.id] || {})[sqIdx] || '';
                              const isSelected = sq.multiple
                                ? userAnswer.split(',').map((s: string) => s.trim().toUpperCase()).includes(optionLetter)
                                : userAnswer === optionLetter;
                              return (
                                <button
                                  key={oIdx}
                                  onClick={() => handleExamCompositeChoice(currentQuestion.id, sqIdx, optionLetter, sq.multiple)}
                                  className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                                    isSelected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'
                                  }`}
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
                              const currentBlankAnswers = (examCompositeBlankAnswers[currentQuestion.id] || {})[sqIdx] || Array(blankCount).fill('');
                              return Array.from({ length: blankCount }).map((_, bIdx) => (
                                <div key={bIdx} className="flex items-center gap-2">
                                  <span className="text-sm text-gray-600 w-16 flex-shrink-0">第{bIdx + 1}空：</span>
                                  <input
                                    type="text"
                                    value={currentBlankAnswers[bIdx] || ''}
                                    onChange={(e) => handleExamCompositeBlank(currentQuestion.id, sqIdx, bIdx, e.target.value)}
                                    placeholder="请输入答案"
                                    className="flex-1 p-2 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                                  />
                                </div>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex justify-between">
            <button
              onClick={handlePrevExam}
              disabled={activeExam.currentIndex === 0}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              上一题
            </button>
            {activeExam.currentIndex < activeExam.questions.length - 1 ? (
              <button
                onClick={handleNextExam}
                disabled={isSubmitting}
                className="px-6 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                下一题
              </button>
            ) : (
              <button
                onClick={handleSubmitExam}
                disabled={isSubmitting}
                className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? <i className="fa-solid fa-spinner fa-spin mr-2"></i> : null}
                {isSubmitting ? '提交中...' : '提交考试'}
              </button>
            )}
          </div>
        </div>

        {/* 右侧：题目导航面板 */}
        {showExamNavigator && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-64 bg-white rounded-xl shadow-sm border border-gray-200 p-4 h-fit sticky top-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">题目导航</h3>
              <button
                onClick={() => setShowExamNavigator(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            
            <div className="text-sm text-gray-500 mb-4">
              <span className="text-green-600 font-medium">{answeredCount}</span> / {activeExam.questions.length} 已答
            </div>
            
            <div className="grid grid-cols-5 gap-2">
              {activeExam.questions.map((q, index) => {
                const isAnswered = activeExam.answers[q.id] !== undefined && 
                                   activeExam.answers[q.id] !== null && 
                                   activeExam.answers[q.id].toString().trim() !== '';
                const isCurrent = index === activeExam.currentIndex;
                return (
                  <button
                    key={q.id}
                    onClick={() => {
                      setActiveExam({ ...activeExam, currentIndex: index });
                    }}
                    className={`w-10 h-10 rounded-lg text-sm font-medium transition-all ${
                      isCurrent 
                        ? 'ring-2 ring-purple-500 ring-offset-2' 
                        : ''
                    } ${
                      isAnswered 
                        ? 'bg-green-500 text-white hover:bg-green-600' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                    }`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
            
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-green-500"></span>
                  <span>已答</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-gray-100 border border-gray-300"></span>
                  <span>未答</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => { setShowExamList(false); setShowPKBattle(false); }}
          className={`px-4 py-2 rounded-lg transition-colors ${!showExamList && !showPKBattle ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        >
          <i className="fa-solid fa-clipboard-list mr-2"></i>测试列表
        </button>
        <button
          onClick={() => { setShowExamList(true); setShowPKBattle(false); }}
          className={`px-4 py-2 rounded-lg transition-colors ${showExamList ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        >
          <i className="fa-solid fa-file-alt mr-2"></i>考试列表
        </button>
        <button
          onClick={() => { setShowExamList(false); setShowPKBattle(true); }}
          className={`px-4 py-2 rounded-lg transition-colors ${showPKBattle ? 'bg-pink-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        >
          <i className="fa-solid fa-bolt mr-2"></i>对战 PK
        </button>
      </div>

      {showPKBattle ? (
        <Suspense fallback={<div className="flex items-center justify-center h-full"><i className="fa-solid fa-circle-notch fa-spin text-3xl text-purple-500"></i></div>}>
          <PKBattle />
        </Suspense>
      ) : !showExamList ? (
        <>
      <h2 className="text-xl font-bold text-gray-800 mb-6">测试列表</h2>

      {tests.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          <i className="fa-solid fa-clipboard text-4xl mb-4"></i>
          <p>暂无可用测试</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-8">
          {tests.map((test) => {
            const dailyLimit = getDailyLimit(test);
            const todayUsed = getTodayAttempts(test.id);
            const dailyExhausted = dailyLimit > 0 && todayUsed >= dailyLimit;
            const qualificationLack = (test as any).qualification_correct_count > 0
              && studentCorrectCount < (test as any).qualification_correct_count;
            const blocked = dailyExhausted || qualificationLack;
            return (
            <motion.div
              key={test.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800">{(test as any).title || test.name}</h3>
                <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-sm">
                  {test.question_count}题
                </span>
              </div>
              <div className="space-y-2 text-sm text-gray-600 mb-4">
                <p><i className="fa-solid fa-clock mr-2"></i>限时 {test.time_limit} 分钟</p>
                <p><i className="fa-solid fa-gift mr-2"></i>奖励 {test.points_reward} 积分</p>
                {dailyLimit > 0 && (
                  <p className={dailyExhausted ? 'text-red-600' : 'text-gray-600'}>
                    <i className={`fa-solid fa-calendar-day mr-2 ${dailyExhausted ? 'text-red-500' : ''}`}></i>
                    今日剩余 {Math.max(0, dailyLimit - todayUsed)} 次（每天最多 {dailyLimit} 次）
                  </p>
                )}
              </div>
              {(test as any).qualification_correct_count > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1 text-sm">
                    <i className={`fa-solid fa-lock ${studentCorrectCount >= (test as any).qualification_correct_count ? 'text-green-500' : 'text-amber-500'}`}></i>
                    <span className={studentCorrectCount >= (test as any).qualification_correct_count ? 'text-green-600' : 'text-amber-600'}>
                      需要做对 {(test as any).qualification_correct_count} 道题
                      {studentCorrectCount >= (test as any).qualification_correct_count
                        ? ' ✓ 已达标'
                        : `（当前 ${studentCorrectCount} 道）`}
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={() => startTest(test)}
                disabled={blocked}
                className={`w-full py-2 rounded-lg transition-colors ${
                  blocked
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {qualificationLack
                  ? '资格不足'
                  : dailyExhausted
                    ? '今日次数已用完'
                    : '开始测试'}
              </button>
            </motion.div>
            );
          })}
        </div>
      )}

      {testHistory.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-gray-800 mb-4">测试记录</h3>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">测试名称</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">得分</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">正确率</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">获得积分</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">完成时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {testHistory.map((record) => (
                  <tr
                    key={record.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onDoubleClick={() => fetchTestDetail(record)}
                    title="双击查看详情"
                  >
                    <td className="px-4 py-3 text-sm text-gray-800">{(record as any).test?.title || (record as any).test?.name}</td>
                    <td className="px-4 py-3 text-center text-sm font-bold text-blue-600">{record.score}</td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">
                      {record.total_count ? Math.round((record.correct_count || 0) / record.total_count * 100) : 0}%
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-green-600">+{record.points_earned}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">
                      {new Date(record.completed_at || '').toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showTestDetail && selectedTestRecord && testDetailData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowTestDetail(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">{(selectedTestRecord as any).test?.title || (selectedTestRecord as any).test?.name}</h3>
                  <p className="text-sm text-gray-500">
                    得分: <span className="font-bold text-blue-600">{selectedTestRecord.score}</span> |
                    正确: <span className="font-bold text-green-600">{selectedTestRecord.correct_count}/{selectedTestRecord.total_count}</span>
                  </p>
                </div>
                <button
                  onClick={() => setShowTestDetail(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="fa-solid fa-times text-xl"></i>
                </button>
              </div>

              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
                {testDetailData.questions.map((q, index) => {
                  const userAnswer = testDetailData.answers[q.id] || '';
                  const correctAnswers = getAnswers(q.answers);
                  const normalizeAnswer = (ans: string) => {
                    return ans.toLowerCase().trim();
                  };
                  const isAnswered = userAnswer && userAnswer.trim() !== '';
                  const isCorrect = isAnswered && correctAnswers.some((ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer));
                  return (
                    <div key={q.id} className={`p-4 rounded-lg border ${isAnswered ? (isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200') : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex items-start gap-3">
                        <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-lg ${isAnswered ? (isCorrect ? 'bg-green-500 text-white' : 'bg-red-500 text-white') : 'bg-gray-400 text-white'}`}>
                          {isAnswered ? (isCorrect ? <i className="fa-solid fa-check"></i> : <i className="fa-solid fa-xmark"></i>) : <i className="fa-solid fa-minus"></i>}
                        </span>
                        <div className="flex-1">
                          <div className={`font-medium mb-2 question-rich-content ${isAnswered ? (isCorrect ? 'text-gray-800' : 'text-red-600') : 'text-gray-800'}`}>
                            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.content) }} />
                          </div>
                          {q.type === 'choice' && q.options && (
                            <div className="text-sm space-y-1 mb-3">
                              {getOptions(q.options).map((opt: string, idx: number) => (
                                <div key={idx} className="flex items-start gap-2">
                                  <span className="font-medium text-gray-600 flex-shrink-0">{String.fromCharCode(65 + idx)}.</span>
                                  <span className="question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(opt) }} />
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="text-sm space-y-1">
                            <p className={isAnswered ? (isCorrect ? 'text-green-700' : 'text-red-700') : 'text-gray-500'}>
                              <span className="font-medium">你的答案:</span> {userAnswer || '未作答'}
                            </p>
                            {!isCorrect && (
                              <p className="text-green-700">
                                <span className="font-medium">正确答案:</span> {correctAnswers.join(' / ')}
                              </p>
                            )}
                            {q.explanation && (
                              <div className="text-gray-600 mt-2 pt-2 border-t border-gray-200 question-rich-content">
                                <span className="font-medium">解析:</span>
                                <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.explanation) }} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowTestDetail(false)}
                  className="w-full py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
        </>
      ) : (
        <>
          <h2 className="text-xl font-bold text-gray-800 mb-6">考试列表</h2>
          
          {exams.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <i className="fa-solid fa-file-alt text-4xl mb-4"></i>
              <p>暂无可用考试</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 mb-8">
              {exams.map((exam) => {
                    const examStatus = getExamStatus(exam);
                    const questionIds = getExamQuestionIds(exam);
                    const examTest = exam as any;
                    return (
                  <motion.div
                    key={exam.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="text-lg font-bold text-gray-800">{examTest.title || exam.name}</h3>
                      <span className={`px-3 py-1 rounded-full text-sm ${examStatus.color.replace('text-', 'bg-').replace('-600', '-100')}`}>
                        {examStatus.status}
                      </span>
                    </div>
                    {examTest.description && (
                      <p className="text-sm text-gray-500 mb-4">{examTest.description}</p>
                    )}
                    <div className="space-y-2 text-sm text-gray-600 mb-4">
                      <p><i className="fa-solid fa-list mr-2"></i>题目数量: {questionIds.length} 道</p>
                      <p><i className="fa-solid fa-clock mr-2"></i>限时 {exam.time_limit} 分钟</p>
                      <p><i className="fa-solid fa-check-circle mr-2"></i>及格分数: {examTest.passing_score} 分</p>
                      {examTest.points_reward > 0 && (
                        <p><i className="fa-solid fa-gift mr-2"></i>及格奖励 {examTest.points_reward} 积分</p>
                      )}
                      {examTest.allow_internet_code && examTest.internet_code_reward > 0 && (
                        <div className="flex items-center flex-wrap gap-2">
                          <p className="flex items-center">
                            <i className="fa-solid fa-wifi mr-2"></i>及格奖励上网码 {examTest.internet_code_reward} 个
                          </p>
                          {examStatus.record && examStatus.record.is_passed && examStatus.record.internet_codes_earned > 0 && (
                            <button
                              onClick={async () => {
                                // 查询上网码
                                const { data: codesData } = await backendClient
                                  .from('internet_codes')
                                  .select('code')
                                  .eq('used_by', profile?.id)
                                  .eq('is_used', true)
                                  .order('used_at', { ascending: false })
                                  .limit(examStatus.record!.internet_codes_earned);
                                
                                if (codesData && codesData.length > 0) {
                                  const codes = codesData.map((c: any) => c.code).join(', ');
                                  const copyToClipboard = (text: string) => {
                                    if (navigator.clipboard && window.isSecureContext) {
                                      navigator.clipboard.writeText(text).then(() => {
                                        alert('上网码已复制到剪贴板！');
                                      }).catch(() => {
                                        fallbackCopy(text);
                                      });
                                    } else {
                                      fallbackCopy(text);
                                    }
                                  };
                                  
                                  const fallbackCopy = (text: string) => {
                                    const textArea = document.createElement('textarea');
                                    textArea.value = text;
                                    textArea.style.position = 'fixed';
                                    textArea.style.left = '-9999px';
                                    document.body.appendChild(textArea);
                                    textArea.focus();
                                    textArea.select();
                                    try {
                                      document.execCommand('copy') ? alert('上网码已复制到剪贴板！') : alert('复制失败');
                                    } catch (err) {
                                      alert('复制失败');
                                    }
                                    document.body.removeChild(textArea);
                                  };
                                  
                                  copyToClipboard(codes);
                                }
                              }}
                              className="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors text-xs flex items-center gap-1"
                            >
                              <i className="fa-solid fa-copy"></i>一键复制上网码
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      {examStatus.record ? (
                        <div className="space-y-2">
                          {/* 考试进行中状态 */}
                          {!examStatus.record.completed_at ? (
                            <button
                              onClick={() => startExam(exam)}
                              className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                            >
                              <i className="fa-solid fa-play mr-2"></i>继续考试
                            </button>
                          ) : (
                            <>
                              <div className="flex gap-2 items-center text-sm flex-wrap">
                                <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-lg">
                                  得分: {examStatus.record.score} 分
                                </span>
                                <span className={`px-3 py-1 rounded-lg ${examStatus.record.is_passed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                  {examStatus.record.is_passed ? '通过' : '未通过'}
                                </span>
                              </div>
                              {/* 查看试卷按钮 - 只在 allow_view_paper 为 true 时显示 */}
                              {canViewExamPaper(exam) && (
                                <button
                                  onClick={() => fetchExamDetail(examStatus.record!)}
                                  className="w-full py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
                                >
                                  <i className="fa-solid fa-eye mr-2"></i>查看试卷
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => startExam(exam)}
                          className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                        >
                          开始考试
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {myExamRecords.length > 0 && (
            <div>
              <h3 className="text-lg font-bold text-gray-800 mb-4">考试记录</h3>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">考试名称</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">得分</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">正确率</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">获得积分</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">上网码</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">状态</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">完成时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {myExamRecords.map((record) => {
                      const exam = exams.find(e => e.id === record.test_id);
                      const examTest = exam as any;
                      return (
                        <tr
                          key={record.id}
                          className={`hover:bg-gray-50 ${canViewExamPaper(exam) ? 'cursor-pointer' : ''}`}
                          onDoubleClick={() => canViewExamPaper(exam) && fetchExamDetail(record)}
                          title={canViewExamPaper(exam) ? "双击查看试卷" : ""}
                        >
                          <td className="px-4 py-3 text-sm text-gray-800">{examTest?.title || examTest?.name || '考试'}</td>
                          <td className="px-4 py-3 text-center text-sm font-bold text-purple-600">{record.score}</td>
                          <td className="px-4 py-3 text-center text-sm text-gray-600">
                            {record.total_count ? Math.round((record.correct_count || 0) / record.total_count * 100) : 0}%
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-green-600">+{record.points_earned}</td>
                          <td className="px-4 py-3 text-center text-sm text-purple-600">+{record.internet_codes_earned}</td>
                          <td className="px-4 py-3 text-center text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs ${record.is_passed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                              {record.is_passed ? '通过' : '未通过'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-500">
                            {new Date(record.completed_at || '').toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {showExamDetail && selectedExamRecord && examDetailData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowExamDetail(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-800">
                    {exams.find(e => e.id === selectedExamRecord.test_id)?.title || '考试'}
                  </h3>
                  <p className="text-sm text-gray-500 mb-2">
                    得分: <span className="font-bold text-purple-600">{selectedExamRecord.score}</span> |
                    正确: <span className="font-bold text-green-600">{selectedExamRecord.correct_count}/{selectedExamRecord.total_count}</span> |
                    获得积分: <span className="font-bold text-yellow-600">+{selectedExamRecord.points_earned}</span> |
                    {selectedExamRecord.is_passed ? (
                      <span className="text-green-600"> 通过</span>
                    ) : (
                      <span className="text-red-600"> 未通过</span>
                    )}
                  </p>
                  {/* 显示上网码 */}
                  {examInternetCodes.length > 0 && (
                    <div className="bg-purple-50 rounded-lg p-3">
                      <p className="text-sm font-medium text-purple-700 mb-2">
                        <i className="fa-solid fa-wifi mr-1"></i>获得上网码:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {examInternetCodes.map((code, idx) => (
                          <div key={idx} className="flex items-center gap-1 bg-white px-3 py-1 rounded shadow-sm border border-purple-200">
                            <span className="font-mono font-bold text-purple-600 text-sm">{code}</span>
                            <button
                              onClick={() => {
                                const copyToClipboard = (text: string) => {
                                  if (navigator.clipboard && window.isSecureContext) {
                                    navigator.clipboard.writeText(text).then(() => {
                                      alert('复制成功！');
                                    }).catch(() => {
                                      fallbackCopy(text);
                                    });
                                  } else {
                                    fallbackCopy(text);
                                  }
                                };
                                
                                const fallbackCopy = (text: string) => {
                                  const textArea = document.createElement('textarea');
                                  textArea.value = text;
                                  textArea.style.position = 'fixed';
                                  textArea.style.left = '-9999px';
                                  document.body.appendChild(textArea);
                                  textArea.focus();
                                  textArea.select();
                                  try {
                                    const successful = document.execCommand('copy');
                                    alert(successful ? '复制成功！' : '复制失败，请手动复制');
                                  } catch (err) {
                                    alert('复制失败，请手动复制');
                                  }
                                  document.body.removeChild(textArea);
                                };
                                
                                copyToClipboard(code);
                              }}
                              className="text-purple-400 hover:text-purple-600 transition-colors"
                              title="复制上网码"
                            >
                              <i className="fa-solid fa-copy text-xs"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowExamDetail(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="fa-solid fa-times text-xl"></i>
                </button>
              </div>

              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
                {examDetailData.questions.map((q, index) => {
                  const userAnswer = examDetailData.answers[q.id] || '';
                  const correctAnswers = getAnswers(q.answers);
                  const normalizeAnswer = (ans: string) => {
                    return ans.toLowerCase().trim();
                  };
                  const isAnswered = userAnswer && userAnswer.trim() !== '';
                  const isCorrect = isAnswered && correctAnswers.some((ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer));
                  return (
                    <div key={q.id} className={`p-4 rounded-lg border ${isAnswered ? (isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200') : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex items-start gap-3">
                        <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-lg ${isAnswered ? (isCorrect ? 'bg-green-500 text-white' : 'bg-red-500 text-white') : 'bg-gray-400 text-white'}`}>
                          {isAnswered ? (isCorrect ? <i className="fa-solid fa-check"></i> : <i className="fa-solid fa-xmark"></i>) : <i className="fa-solid fa-minus"></i>}
                        </span>
                        <div className="flex-1">
                          <div className={`font-medium mb-2 question-rich-content ${isAnswered ? (isCorrect ? 'text-gray-800' : 'text-red-600') : 'text-gray-800'}`}>
                            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.content) }} />
                          </div>
                          {q.type === 'choice' && q.options && (
                            <div className="text-sm space-y-1 mb-3">
                              {getOptions(q.options).map((opt: string, idx: number) => (
                                <div key={idx} className="flex items-start gap-2">
                                  <span className="font-medium text-gray-600 flex-shrink-0">{String.fromCharCode(65 + idx)}.</span>
                                  <span className="question-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(opt) }} />
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="text-sm space-y-1">
                            <p className={isAnswered ? (isCorrect ? 'text-green-700' : 'text-red-700') : 'text-gray-500'}>
                              <span className="font-medium">你的答案:</span> {userAnswer || '未作答'}
                            </p>
                            {!isCorrect && (
                              <p className="text-green-700">
                                <span className="font-medium">正确答案:</span> {correctAnswers.join(' / ')}
                              </p>
                            )}
                            {q.explanation && (
                              <div className="text-gray-600 mt-2 pt-2 border-t border-gray-200 question-rich-content">
                                <span className="font-medium">解析:</span>
                                <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.explanation) }} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowExamDetail(false)}
                  className="w-full py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <EquipmentDropEffect />
    </div>
  );
};
