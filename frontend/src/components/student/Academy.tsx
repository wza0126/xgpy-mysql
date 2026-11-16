import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { sanitizeHtml } from '../../utils/htmlUtils';
import { BuildingScene, BuildingData } from './academy/BuildingScene';

/**
 * 星卡学院（原 Python魔法学院重构）2026-11-16
 *
 * 玩法：70 个知识点 = 70 张星卡（每张三阶），16 章 = 16 座建筑。35 节课走完一轮。
 * ⛔ 三条设计红线（改之前先读）：
 *   1. 不显示倒计时、不给失败 —— 这就是它和生存游戏的区别，别再加压力。
 *   2. 一题一卡，答对就升一阶；错不扣任何东西，只提示再想。
 *   3. 同一张卡一天只升一阶（后端限制），前端要说清楚「明天再来」，否则学生以为坏了。
 */

interface CardInfo {
  cluster_id: string;
  chapter_code: string;
  chapter_name: string;
  section: string;
  part: string;
  stage: number;
  correct_cnt: number;
  wrong_cnt: number;
}

interface AcademyState {
  enabled: boolean;
  profile: {
    level: number; stars: number; star_max: number; mana: number; stardust: number;
    streak_days: number; total_answered: number; total_correct: number; diamond_balance: number;
  };
  lesson: { idx: number; total: number; cards: CardInfo[]; done: boolean };
  buildings: BuildingData[];
  card_total: number;
  lit_count: number;
  config: { diamond_per_lesson: number };
}

interface QuestionData {
  kind: 'question' | 'concept';
  id?: string;
  content?: string;
  options?: string[];
  cluster_id: string;
  title?: string;
  points?: string[];
}

interface AnswerResult {
  correct: boolean;
  right: string;
  explanation?: string;
  stage: number;
  stage_up: boolean;
  stars: number;
  level: number;
  mana: number;
  lesson_done: boolean;
  diamond_earned: number;
  diamond_blocked?: string;
  counted_today?: boolean;
  already_counted?: boolean;
}

type Tab = 'academy' | 'dex' | 'rank';

const LETTERS = 'ABCDEF';

const stageLabel = (s: number) => (s >= 3 ? '精通' : s === 2 ? '熟练' : s === 1 ? '见习' : '未点亮');

const StageDots: React.FC<{ stage: number; color?: string }> = ({ stage, color = '#4A90D9' }) => (
  <span style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle' }}>
    {[1, 2, 3].map((i) => (
      <span
        key={i}
        style={{
          width: 6, height: 6, borderRadius: '50%',
          background: stage >= i ? color : '#DCDAD2',
          display: 'inline-block',
        }}
      />
    ))}
  </span>
);

/** 题库选项自带 "A. xxx" 前缀，左边已单独显示字母，渲染时要去掉以免出现两个 A */
const stripLetterPrefix = (opt: string): string =>
  String(opt || '').replace(/^\s*[A-F]\s*[.、．)]\s*/i, '');

const getOptions = (options: any): string[] => {
  if (Array.isArray(options)) return options;
  try {
    const p = typeof options === 'string' ? JSON.parse(options) : options;
    if (Array.isArray(p?.options)) return p.options;
    if (Array.isArray(p)) return p;
  } catch { /* ignore */ }
  return [];
};

export const Academy: React.FC<{ onClose?: () => void }> = () => {
  const [state, setState] = useState<AcademyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('academy');
  const [err, setErr] = useState('');

  // 答题模态
  const [active, setActive] = useState<{ card: CardInfo; q: QuestionData | null; loading: boolean } | null>(null);
  const [picked, setPicked] = useState('');
  const [eliminated, setEliminated] = useState<string[]>([]);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  // 图鉴
  const [dex, setDex] = useState<{ items: CardInfo[] } | null>(null);
  /** 从学院全景点建筑进来时只显示该章，null = 全部 */
  const [focusChapter, setFocusChapter] = useState<string | null>(null);
  // 排行
  const [rank, setRank] = useState<{ items: any[]; me: any } | null>(null);

  const load = useCallback(async () => {
    try {
      setErr('');
      const r: any = await backendClient.get('/api/student/academy/state');
      const d = r?.data;
      if (!d) throw new Error('学院数据为空');
      setState(d);
      if (!d.enabled) setErr('老师暂时关闭了学院，等开通后再来');
    } catch (e: any) {
      setErr(e?.message || '学院加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCard = async (card: CardInfo) => {
    setActive({ card, q: null, loading: true });
    setPicked('');
    setEliminated([]);
    setResult(null);
    setNotice('');
    try {
      const r: any = await backendClient.get(
        `/api/student/academy/question?cluster_id=${encodeURIComponent(card.cluster_id)}`
      );
      setActive({ card, q: r?.data || null, loading: false });
    } catch (e: any) {
      setActive(null);
      setNotice(e?.message || '取题失败');
    }
  };

  const submit = async () => {
    if (!active?.card) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      const r: any = await backendClient.post('/api/student/academy/answer', {
        cluster_id: active.card.cluster_id,
        question_id: active.q?.kind === 'question' ? active.q.id : '',
        answer: picked,
      });
      const d: AnswerResult = r?.data;
      if (!d) throw new Error(r?.error || '提交失败');
      setResult(d);
      await load();
    } catch (e: any) {
      setNotice(e?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const buyHint = async () => {
    if (!active?.q?.id) return;
    try {
      const r: any = await backendClient.post('/api/student/academy/hint', { question_id: active.q.id });
      const d = r?.data;
      if (d?.eliminate) {
        setEliminated(d.eliminate.map((x: string) => String(x).toUpperCase()));
        setState((prev) => (prev ? { ...prev, profile: { ...prev.profile, mana: d.mana } } : prev));
      }
    } catch (e: any) {
      setNotice(e?.message || '买提示失败');
    }
  };

  const openDex = async () => {
    setTab('dex');
    if (dex) return;
    try {
      const r: any = await backendClient.get('/api/student/academy/dex');
      setDex(r?.data || { items: [] });
    } catch { setDex({ items: [] }); }
  };

  const openRank = async () => {
    setTab('rank');
    try {
      const r: any = await backendClient.get('/api/student/academy/rank');
      setRank(r?.data || { items: [], me: null });
    } catch { setRank({ items: [], me: null }); }
  };

  const dexByChapter = useMemo(() => {
    const map = new Map<string, CardInfo[]>();
    (dex?.items || []).forEach((c) => {
      if (!map.has(c.chapter_name)) map.set(c.chapter_name, []);
      map.get(c.chapter_name)!.push(c);
    });
    return map;
  }, [dex]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <i className="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-400"></i>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <i className="fa-solid fa-triangle-exclamation text-2xl text-amber-500"></i>
        <p>{err || '学院暂时打不开'}</p>
        <button onClick={load} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-white">重试</button>
      </div>
    );
  }

  const p = state.profile;
  const starPct = Math.min(100, Math.round((p.stars / Math.max(1, p.star_max)) * 100));

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: '#FBFAF7' }}>
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center gap-4 border-b border-gray-200 bg-white px-5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">🪄</span>
          <span className="text-sm font-semibold text-gray-800">星卡学院</span>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
            Lv.{p.level}
          </span>
        </div>

        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${starPct}%` }} />
          </div>
          <span className="whitespace-nowrap text-xs text-gray-500">{p.stars}/{p.star_max} 星</span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-amber-700" title="魔力：答对产出，可用来买提示">魔力 {p.mana}</span>
          <span className="text-sky-700" title="钻石：本课首通发放，计入每日上限">💎 {p.diamond_balance}</span>
          <span className="text-gray-500" title="连续登录天数">连续 {p.streak_days} 天</span>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {tab === 'academy' && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    第 {state.lesson.idx} / {state.lesson.total} 课
                    {state.lesson.done && <span className="ml-2 text-xs font-normal text-emerald-600">本课已完成</span>}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    每课 2 个知识点 · 答对 1 次点亮 · 一天一张卡最多升一阶
                  </p>
                </div>
                <p className="text-xs text-gray-400">
                  已点亮 {state.lit_count}/{state.card_total} 张 · 建筑随章节进度长大
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <BuildingScene
                  buildings={state.buildings}
                  onSelect={(b) => {
                    setFocusChapter(b.chapter_name);
                    openDex();
                  }}
                />
              </div>
            </>
          )}

          {tab === 'dex' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">
                  星卡图鉴 · 已点亮 {state.lit_count}/{state.card_total}
                  {focusChapter && <span className="ml-2 text-xs font-normal text-indigo-600">只看「{focusChapter}」</span>}
                </h3>
                {focusChapter && (
                  <button
                    onClick={() => setFocusChapter(null)}
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    看全部章节
                  </button>
                )}
              </div>
              <div className="space-y-4">
                {[...dexByChapter.entries()]
                  .filter(([chapter]) => !focusChapter || chapter === focusChapter)
                  .map(([chapter, cards]) => (
                  <div key={chapter}>
                    <p className="mb-1.5 text-xs font-medium text-gray-500">
                      {chapter}（{cards.filter((c) => c.stage > 0).length}/{cards.length}）
                    </p>
                    <div className="grid grid-cols-3 gap-2 lg:grid-cols-4">
                      {cards.map((c) => (
                        <button
                          key={c.cluster_id}
                          onClick={() => openCard(c)}
                          className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                            c.stage > 0
                              ? 'border-indigo-200 bg-white hover:border-indigo-400'
                              : 'border-dashed border-gray-200 bg-gray-50 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-400">{c.chapter_code}</span>
                            <StageDots stage={c.stage} />
                          </div>
                          <p className={`mt-1 line-clamp-2 text-xs ${c.stage > 0 ? 'text-gray-800' : 'text-gray-400'}`}>
                            {c.section}
                          </p>
                          <p className="mt-0.5 text-[10px] text-gray-400">
                            {stageLabel(c.stage)} {c.stage > 0 && `· 对${c.correct_cnt}`}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {!dex && <p className="text-xs text-gray-400">加载中…</p>}
              </div>
            </div>
          )}

          {tab === 'rank' && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-800">班内星卡榜 · 按星数排</h3>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                {(rank?.items || []).map((r) => (
                  <div
                    key={r.student_id}
                    className={`flex items-center gap-3 border-b border-gray-100 px-4 py-2 text-sm last:border-0 ${
                      r.is_me ? 'bg-indigo-50/60' : ''
                    }`}
                  >
                    <span className={`w-6 text-center font-mono ${r.rank <= 3 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {r.rank}
                    </span>
                    <span className="flex-1 truncate text-gray-800">
                      {r.name}
                      {r.is_me && <span className="ml-1 text-[10px] text-indigo-600">我</span>}
                    </span>
                    <span className="text-xs text-gray-500">Lv.{r.level}</span>
                    <span className="w-16 text-right font-medium text-indigo-700">{r.stars} 星</span>
                  </div>
                ))}
                {!rank?.items?.length && <p className="px-4 py-6 text-center text-xs text-gray-400">还没有人开始</p>}
              </div>
            </div>
          )}
        </div>

        {/* 右侧：本课两张卡 */}
        <div className="w-[300px] flex-shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4">
          <p className="mb-1 text-sm font-semibold text-gray-800">本课委托</p>
          <p className="mb-3 text-[11px] text-gray-500">
            {state.config.diamond_per_lesson > 0
              ? `两张卡都点亮，本课首通 +${state.config.diamond_per_lesson} 钻石（计入每日上限）`
              : '两张卡都点亮，本课即完成'}
          </p>
          <div className="space-y-2">
            {state.lesson.cards.map((c) => (
              <button
                key={c.cluster_id}
                onClick={() => openCard(c)}
                className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-indigo-400"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">{c.chapter_code} · {c.chapter_name}</span>
                  <StageDots stage={c.stage} />
                </div>
                <p className="mt-1 text-sm font-medium leading-snug text-gray-800">{c.section}</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  {c.stage >= 3 ? '已精通' : `${stageLabel(c.stage)} ${c.stage}/3 · 再答对 ${3 - c.stage} 次精通`}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => { setTab('academy'); }}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs ${tab === 'academy' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              学院
            </button>
            <button
              onClick={openDex}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs ${tab === 'dex' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              图鉴
            </button>
            <button
              onClick={openRank}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs ${tab === 'rank' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              排行
            </button>
          </div>
        </div>
      </div>

      {/* 答题模态 */}
      <AnimatePresence>
        {active && (
          <motion.div
            className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/55 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5"
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] text-gray-400">{active.card.chapter_code} · {active.card.chapter_name}</p>
                  <h3 className="text-base font-semibold text-gray-900">{active.card.section}</h3>
                </div>
                <button
                  onClick={() => setActive(null)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              {active.loading && <p className="py-8 text-center text-sm text-gray-400">取题中…</p>}

              {!active.loading && active.q?.kind === 'concept' && (
                <div className="space-y-2">
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    这一节暂时没有配套练习题，读一遍要点就算点亮。
                  </p>
                  {(active.q.points || []).map((t, i) => (
                    <p key={i} className="text-sm leading-relaxed text-gray-700">· {t}</p>
                  ))}
                  {!result && (
                    <button
                      onClick={submit}
                      disabled={submitting}
                      className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {submitting ? '提交中…' : '我读完了，点亮它'}
                    </button>
                  )}
                </div>
              )}

              {!active.loading && active.q?.kind === 'question' && (
                <div>
                  <div
                    className="question-rich-content mb-4 text-[15px] leading-relaxed text-gray-800"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(active.q.content || '') }}
                  />

                  <div className="space-y-2">
                    {getOptions(active.q.options).map((opt, i) => {
                      const letter = LETTERS[i];
                      const gone = eliminated.includes(letter);
                      const selected = picked === letter;
                      const isRight = result && result.right === letter;
                      const isWrong = result && selected && !result.correct;
                      return (
                        <button
                          key={i}
                          disabled={!!result || gone}
                          onClick={() => setPicked(letter)}
                          className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            isRight
                              ? 'border-emerald-400 bg-emerald-50'
                              : isWrong
                                ? 'border-red-300 bg-red-50'
                                : selected
                                  ? 'border-indigo-400 bg-indigo-50'
                                  : gone
                                    ? 'border-gray-100 bg-gray-50 opacity-40 line-through'
                                    : 'border-gray-200 bg-white hover:border-indigo-300'
                          }`}
                        >
                          <span className="mt-0.5 w-4 flex-shrink-0 font-mono text-xs text-gray-500">{letter}</span>
                          <span
                            className="question-rich-content flex-1"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(stripLetterPrefix(opt)) }}
                          />
                        </button>
                      );
                    })}
                  </div>

                  {!result && (
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        onClick={buyHint}
                        disabled={p.mana < 10 || eliminated.length > 0}
                        title={eliminated.length ? '本题已用过提示' : '花 10 点魔力排除两个错误选项'}
                        className="rounded-lg border border-amber-300 px-3 py-2 text-xs text-amber-700 disabled:opacity-40"
                      >
                        提示（10 魔力）
                      </button>
                      <button
                        onClick={submit}
                        disabled={!picked || submitting}
                        className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {submitting ? '提交中…' : '提交'}
                      </button>
                    </div>
                  )}

                  {result && (
                    <div className="mt-4">
                      <div
                        className={`rounded-lg px-3 py-2 text-sm ${
                          result.correct ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {result.correct ? (
                          <>
                            答对了 · 这张卡现在是「{stageLabel(result.stage)}」
                            {result.already_counted && (
                              <span className="ml-1 text-xs text-emerald-700">
                                （今天这张卡已经升过阶，明天再来可以继续升）
                              </span>
                            )}
                          </>
                        ) : (
                          <>答错了 · 正确答案是 {result.right}，这张卡还是「{stageLabel(result.stage)}」</>
                        )}
                        {result.diamond_earned > 0 && (
                          <span className="ml-1 text-xs text-amber-700">本课首通 +{result.diamond_earned} 钻石</span>
                        )}
                        {result.diamond_blocked === 'daily_cap' && (
                          <span className="ml-1 text-xs text-gray-500">（今天的钻石产出已达上限）</span>
                        )}
                      </div>

                      {result.explanation && (
                        <div
                          className="question-rich-content mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.explanation) }}
                        />
                      )}

                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => setActive(null)}
                          className="flex-1 rounded-lg bg-gray-100 py-2 text-sm text-gray-700 hover:bg-gray-200"
                        >
                          关闭
                        </button>
                        <button
                          onClick={() => {
                            const next = state.lesson.cards.find(
                              (c) => c.cluster_id !== active.card.cluster_id && c.stage < 3
                            );
                            if (next) openCard(next);
                            else setActive(null);
                          }}
                          className="flex-[2] rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                        >
                          继续下一张
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {notice && <p className="mt-3 text-xs text-amber-600">{notice}</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
