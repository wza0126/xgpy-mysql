// PK 对战答题页：倒计时 + 实时比分 + 题号导航 + 答题区
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTime, getRankInfo, renderStars } from './utils/pkHelpers';
import { sanitizeHtml } from '../../../utils/htmlUtils';

interface Question {
  id: string;
  question_text: string;
  question_type: string;
  answers: any;
  difficulty?: number;
}

interface LeaderEntry {
  userId: string;
  score: number;
  correct: number;
  wrong: number;
}

interface BattlePlayer {
  user_id: string;
  username: string;
  real_name: string;
  tier: number;
  stars: number;
  score?: number;
  correct?: number;
  wrong?: number;
}

interface ToastMsg {
  text: string;
  type: 'success' | 'error';
}

export const PKBattleArena: React.FC<{
  questions: Question[];
  duration: number;
  endsAt: string;
  leaderboard: LeaderEntry[];
  remaining: number;
  myUserId: string;
  players?: BattlePlayer[];
  answerFeedback?: { qid: string; correct: boolean } | null;
  answeredIds?: string[];
  onSubmitAnswer: (qid: string, answer: string, costMs: number) => void;
  onSurrender: () => void;
}> = ({
  questions,
  duration,
  endsAt,
  leaderboard,
  remaining,
  myUserId,
  players = [],
  answerFeedback,
  answeredIds,
  onSubmitAnswer,
  onSurrender,
}) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [showSurrenderConfirm, setShowSurrenderConfirm] = useState(false);
  const questionStartRef = useRef<number>(Date.now());
  const lastSubmitRef = useRef<number>(0);

  // 当前题目
  const currentQ = questions[currentIdx];
  const me = players.find((p) => p.user_id === myUserId);
  const opp = players.find((p) => p.user_id !== myUserId);
  const meRank = me ? getRankInfo(me.tier, me.stars) : null;
  const oppRank = opp ? getRankInfo(opp.tier, opp.stars) : null;

  // 切换题目时重置计时
  useEffect(() => {
    questionStartRef.current = Date.now();
  }, [currentIdx]);

  // 从排行榜更新分数
  useEffect(() => {
    const me = leaderboard.find((e) => e.userId === myUserId);
    const opp = leaderboard.find((e) => e.userId !== myUserId);
    if (me) setMyScore(me.score);
    if (opp) setOppScore(opp.score);
  }, [leaderboard, myUserId]);

  // 断线重连恢复：无排行榜数据时从 players 初始化分数
  useEffect(() => {
    if (leaderboard.length === 0 && players.length > 0) {
      const meP = players.find((p) => p.user_id === myUserId);
      const oppP = players.find((p) => p.user_id !== myUserId);
      if (meP && typeof meP.score === 'number') setMyScore(meP.score);
      if (oppP && typeof oppP.score === 'number') setOppScore(oppP.score);
    }
  }, [players, leaderboard, myUserId]);

  // 断线重连恢复：标记断线前已提交的题目
  useEffect(() => {
    if (answeredIds && answeredIds.length > 0) {
      setSubmitted(new Set(answeredIds));
    }
  }, []);

  // toast 自动消失
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 1500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // 提交结果反馈
  useEffect(() => {
    if (answerFeedback) {
      setToast({
        text: answerFeedback.correct ? '✓ 回答正确' : '✗ 回答错误',
        type: answerFeedback.correct ? 'success' : 'error',
      });
    }
  }, [answerFeedback]);

  const handleSubmit = () => {
    if (!currentQ || !answers[currentQ.id] || submitted.has(currentQ.id)) return;
    // 防连点 1.5 秒
    const now = Date.now();
    if (now - lastSubmitRef.current < 1500) return;
    lastSubmitRef.current = now;

    const costMs = Date.now() - questionStartRef.current;
    onSubmitAnswer(currentQ.id, answers[currentQ.id], costMs);
    setSubmitted((prev) => new Set(prev).add(currentQ.id));
  };

  // 题号状态
  const getQStatus = (idx: number) => {
    if (submitted.has(questions[idx].id)) {
      // 通过排行榜判断对错
      // 简化：答对 score+1，答错 score-1
      return 'answered';
    }
    return 'unanswered';
  };

  return (
    <div
      className="flex flex-col h-full select-none"
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* 顶部固定栏 */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200">
        <div className={`text-2xl font-bold ${remaining < 60 ? 'text-red-500 animate-pulse' : 'text-gray-800'}`}>
          ⏱ {formatTime(remaining)}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end">
              <span className="text-sm font-semibold text-gray-700">
                {me?.real_name || me?.username || '我'}
                <span className="text-xs text-gray-400 ml-1">(我)</span>
              </span>
              {me && meRank && (
                <span className="text-xs text-purple-500">
                  {meRank.icon} {meRank.name} {renderStars(me.tier, me.stars)}
                </span>
              )}
            </div>
            <span className="text-xl font-bold text-purple-600">{myScore}</span>
          </div>
          <div className="text-gray-300">━━━</div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-pink-600">{oppScore}</span>
            <div className="flex flex-col items-start">
              <span className="text-sm font-semibold text-gray-700">
                {opp?.real_name || opp?.username || '对手'}
              </span>
              {opp && oppRank && (
                <span className="text-xs text-pink-500">
                  {oppRank.icon} {oppRank.name} {renderStars(opp.tier, opp.stars)}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowSurrenderConfirm(true)}
          className="px-3 py-1 bg-red-100 text-red-600 rounded-lg text-sm hover:bg-red-200"
        >
          🏳️ 投降
        </button>
      </div>

      {/* 题号导航 */}
      <div className="px-6 py-2 bg-gray-50 border-b border-gray-200 overflow-x-auto">
        <div className="flex gap-1">
          {questions.map((q, i) => {
            const status = getQStatus(i);
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIdx(i)}
                className={`w-8 h-8 rounded text-xs font-bold flex items-center justify-center ${
                  i === currentIdx
                    ? 'bg-purple-500 text-white'
                    : status === 'answered'
                    ? 'bg-gray-300 text-gray-600'
                    : 'bg-white border border-gray-300 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* 答题区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {currentQ ? (
          <div className="max-w-2xl mx-auto">
            <p className="text-sm text-gray-500 mb-4">
              第 {currentIdx + 1} 题 / 共 {questions.length} 题
            </p>
            <div className="bg-white rounded-xl shadow border border-gray-200 p-6 mb-4">
              <div
                className="text-lg font-medium text-gray-800 question-rich-content"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQ.question_text) }}
              />
            </div>

            {/* 选项区 */}
            <div className="space-y-2">
              {renderOptions(currentQ, answers, setAnswers, submitted.has(currentQ.id))}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setCurrentIdx((i) => Math.min(i + 1, questions.length - 1))}
                disabled={currentIdx >= questions.length - 1}
                className="px-6 py-3 bg-white border-2 border-purple-300 text-purple-600 rounded-xl font-bold hover:bg-purple-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                下一题 →
              </button>
              <button
                onClick={handleSubmit}
                disabled={!answers[currentQ.id] || submitted.has(currentQ.id)}
                className="px-8 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-bold disabled:bg-gray-300"
              >
                {submitted.has(currentQ.id) ? '已提交' : '提交答案'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-400">无题目</div>
        )}
      </div>

      {/* toast 反馈 */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-8 py-4 rounded-xl text-2xl font-bold shadow-xl ${
              toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
            }`}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 投降确认 */}
      <AnimatePresence>
        {showSurrenderConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowSurrenderConfirm(false)}
          >
            <div
              className="bg-white rounded-xl p-6 max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-lg font-bold mb-4">确定投降？</p>
              <p className="text-sm text-gray-500 mb-6">投降将判为负</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSurrenderConfirm(false)}
                  className="flex-1 py-2 bg-gray-200 rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setShowSurrenderConfirm(false);
                    onSurrender();
                  }}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg"
                >
                  确定投降
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// 渲染选项
function renderOptions(
  q: Question,
  answers: Record<string, string>,
  setAnswers: (fn: (prev: Record<string, string>) => Record<string, string>) => void,
  disabled: boolean
) {
  // answers 字段对应数据库 options 列，格式可能为 {options:[...]} 对象或纯数组
  let options: string[] = [];
  const toOptStr = (o: any): string =>
    typeof o === 'object' && o !== null ? (o.text ?? o.label ?? o.content ?? String(o)) : String(o);
  try {
    let raw: any = q.answers;
    if (typeof raw === 'string') raw = JSON.parse(raw);
    // 兼容 {options: [...]} / {answers: [...]} 对象格式
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      raw = raw.options ?? raw.answers ?? Object.values(raw);
    }
    if (Array.isArray(raw)) {
      options = raw.map(toOptStr);
    } else if (raw != null && raw !== '') {
      options = [String(raw)];
    }
  } catch {
    const s = String(q.answers || '');
    options = s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  }

  if (q.question_type === 'choice') {
    return options.map((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      const isSelected = (answers[q.id] || '').includes(letter);
      return (
        <button
          key={i}
          onClick={() => {
            if (disabled) return;
            // 统一 toggle 交互：单选选一个字母提交，多选可叠加；后端判分兼容逗号分隔
            const cur = (answers[q.id] || '').split(',').filter(Boolean);
            const newCur = isSelected
              ? cur.filter((c) => c !== letter)
              : [...cur, letter];
            setAnswers((prev) => ({ ...prev, [q.id]: newCur.sort().join(',') }));
          }}
          disabled={disabled}
          className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
            isSelected
              ? 'border-purple-400 bg-purple-50'
              : 'border-gray-200 bg-white hover:bg-gray-50'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <span className="font-bold mr-2">{letter}.</span>
          <span
            className="inline-block question-rich-content"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(opt) }}
          />
        </button>
      );
    });
  }

  // 填空题
  return (
    <input
      type="text"
      value={answers[q.id] || ''}
      onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
      disabled={disabled}
      placeholder="请输入答案"
      className="w-full p-3 border-2 border-gray-200 rounded-lg focus:border-purple-400"
    />
  );
}
