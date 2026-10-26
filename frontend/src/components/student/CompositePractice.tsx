import React, { useEffect, useMemo, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { useAuth } from '../../hooks/useAuth';

/**
 * 综合题练习（学生端，2026-10-26）
 *
 * 为什么单独一个模块：综合题是「一段材料 + 4~6 个小题」的大题，
 * 混在单选题流里（一次一屏一题）会打断节奏，按整题判对错也看不出学生到底会几个小题。
 * 所以练习池把它排除（后端 SQL_PRACTICE_SCOPE），这里单独练。
 *
 * 判分规则：**按小题结算** —— 答对几个小题就得几分，不再「全对才得分」。
 * 判分完全由服务端做（提交后回执里的 sub_correct），前端不猜答案。
 */

interface SubQuestion {
  index: number;
  type: string;
  content: string;
  options: string[];
  multiple: boolean;
  score: number;
  /** 填空小题的空数（服务端按 answers 分组数给出，不泄露答案） */
  blank_count?: number;
}

interface CompositeItem {
  id: string;
  content: string;
  cluster_id: string;
  sub_topic: string;
  subs_count: number;
  subs: SubQuestion[];
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** 题干里的字母选项前缀（A. / A、 / A．）去掉，避免和按钮上的字母重复 */
function stripOptionPrefix(text: string): string {
  return String(text || '').replace(/^\s*[A-Ha-h]\s*[.．、:：]\s*/, '');
}

export const CompositePracticeModule: React.FC = () => {
  const { profile } = useAuth();
  const [items, setItems] = useState<CompositeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState<string>('');

  /** 当前这道大题的作答：choice_answers[小题序号] = 'A' 或 'A,C'；blank_answers[小题序号] = string[] */
  const [choiceAnswers, setChoiceAnswers] = useState<Record<number, string>>({});
  const [blankAnswers, setBlankAnswers] = useState<Record<number, string[]>>({});

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<null | {
    subCorrect: boolean[];
    correctAnswers: any[];
    /** 按小题分值累加的得分 / 满分 */
    earned: number;
    full: number;
    credit: number;
    weight: number;
  }>(null);
  const [submitError, setSubmitError] = useState('');

  const active = useMemo(() => items.find((it) => it.id === activeId) || null, [items, activeId]);

  useEffect(() => {
    (async () => {
      try {
        const res: any = await backendClient.get('/api/student/composite/questions');
        const list: CompositeItem[] = (res && res.data) || [];
        setItems(list);
        if (list.length) setActiveId(list[0].id);
      } catch (e: any) {
        setError(e?.message || '加载综合题失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 换题就把作答与结果清空
  useEffect(() => {
    setChoiceAnswers({});
    setBlankAnswers({});
    setResult(null);
    setSubmitError('');
  }, [activeId]);

  const setChoice = (idx: number, letter: string, multiple: boolean) => {
    if (result) return; // 已提交只看结果
    setChoiceAnswers((prev) => {
      if (!multiple) return { ...prev, [idx]: letter };
      const cur = (prev[idx] || '').split(',').filter(Boolean);
      const next = cur.includes(letter) ? cur.filter((l) => l !== letter) : [...cur, letter];
      next.sort();
      return { ...prev, [idx]: next.join(',') };
    });
  };

  const setBlank = (idx: number, blankIdx: number, value: string) => {
    if (result) return;
    setBlankAnswers((prev) => {
      const cur = prev[idx] ? [...prev[idx]] : ['', '', '', ''];
      cur[blankIdx] = value;
      return { ...prev, [idx]: cur };
    });
  };

  const answeredCount = useMemo(() => {
    if (!active) return 0;
    return active.subs.filter((sq, i) => {
      if (sq.type === 'fill_blank') return (blankAnswers[i] || []).some((v) => String(v || '').trim());
      return !!choiceAnswers[i];
    }).length;
  }, [active, choiceAnswers, blankAnswers]);

  const submit = async () => {
    if (!active || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      // ⛔ 必须走 businessSubmitAnswer：练习作答的服务端判分入口是 /api/business/submit-answer，
      //    以前写成 /api/student/submit-answer（这个路径不存在），一提交就报 Network error。
      const result: any = await backendClient.businessSubmitAnswer({
        student_id: profile?.id,
        question_id: active.id,
        answer: JSON.stringify({ choice_answers: choiceAnswers, blank_answers: blankAnswers }),
        points_change: 0,
        source: 'practice',
      });
      if (result && result.error) throw new Error(result.error);
      const d = (result && result.data) || {};
      const subCorrect: boolean[] = Array.isArray(d.sub_correct) ? d.sub_correct : [];
      // 满分 = 各小题分值之和（小题没配分值按 1 分算）
      const full = active.subs.reduce((sum, sq) => sum + (sq.score || 1), 0);
      const correctAnswers = Array.isArray(d.correct_answers)
        ? d.correct_answers
        : (() => {
            try { return JSON.parse(d.correct_answers || '[]'); } catch { return []; }
          })();
      setResult({
        subCorrect,
        correctAnswers,
        // 得分按小题分值累加（小题没配分值就按 1 分一个算）
        earned: subCorrect.reduce((sum, ok, i) => sum + (ok ? (active.subs[i]?.score || 1) : 0), 0),
        full,
        credit: subCorrect.filter(Boolean).length,
        weight: subCorrect.length || active.subs.length,
      });
    } catch (e: any) {
      setSubmitError(e?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <i className="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-500"></i>
      </div>
    );
  }

  if (error) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  if (!items.length) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-gray-400">
        <i className="fa-solid fa-layer-group text-3xl"></i>
        <p className="text-sm">老师还没有开放综合题练习</p>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4">
      {/* 左：题目列表 */}
      <div className="w-64 flex-shrink-0 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3">
        <p className="mb-2 text-xs text-gray-500">共 {items.length} 道综合题</p>
        <div className="space-y-1.5">
          {items.map((it, i) => {
            const on = it.id === activeId;
            return (
              <button
                key={it.id}
                onClick={() => setActiveId(it.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  on ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <p className="truncate text-sm font-medium text-gray-800">
                  综合题 {i + 1} · {it.subs_count} 小题
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-400">
                  {(it.cluster_id || '').split('/').pop() || '未分类'}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右：作答区 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
        {active && (
          <>
            <div className="border-b border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  {(active.cluster_id || '').split('/').pop() || '未分类'}
                  {active.sub_topic ? ` · ${active.sub_topic}` : ''}
                </p>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                  共 {active.subs.length} 小题 · 满分{' '}
                  {active.subs.reduce((sum, sq) => sum + (sq.score || 1), 0)} 分
                </span>
              </div>
              <div
                className="markdown-content mt-3 text-sm leading-7 text-gray-800"
                dangerouslySetInnerHTML={{ __html: active.content }}
              />
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              {active.subs.map((sq, i) => {
                const ok = result ? result.subCorrect[i] : null;
                const right = result?.subCorrect?.[i] === false ? result.correctAnswers[i] : null;
                return (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 ${
                      ok === true
                        ? 'border-green-200 bg-green-50/50'
                        : ok === false
                        ? 'border-rose-200 bg-rose-50/50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="mb-2 flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-xs text-gray-600">
                        {i + 1}
                      </span>
                      <div
                        className="markdown-content min-w-0 text-sm text-gray-800"
                        dangerouslySetInnerHTML={{ __html: sq.content }}
                      />
                      {ok === true && <i className="fa-solid fa-check mt-1 text-green-600"></i>}
                      {ok === false && <i className="fa-solid fa-xmark mt-1 text-rose-600"></i>}
                    </div>

                    {sq.type === 'fill_blank' ? (
                      <div className="space-y-2 pl-7">
                        {Array.from({ length: Math.max(1, sq.blank_count || 1) }, (_, bi) => (
                          <input
                            key={bi}
                            value={(blankAnswers[i] || [])[bi] || ''}
                            disabled={!!result}
                            onChange={(e) => setBlank(i, bi, e.target.value)}
                            placeholder={(sq.blank_count || 1) > 1 ? `第 ${bi + 1} 空` : '在此填写答案'}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-1.5 pl-7">
                        {sq.options.map((opt, oi) => {
                          const letter = LETTERS[oi];
                          const picked = (choiceAnswers[i] || '').split(',').filter(Boolean).includes(letter);
                          return (
                            <button
                              key={oi}
                              onClick={() => setChoice(i, letter, sq.multiple)}
                              className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                                picked
                                  ? 'border-indigo-400 bg-indigo-50 text-indigo-900'
                                  : 'border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-xs ${picked ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                                {letter}
                              </span>
                              <span className="min-w-0">{stripOptionPrefix(String(opt))}</span>
                            </button>
                          );
                        })}
                        {sq.multiple && <p className="text-xs text-gray-400">多选题，可选多个</p>}
                      </div>
                    )}

                    {right && (
                      <p className="mt-2 pl-7 text-xs text-gray-600">
                        正确答案：
                        <span className="font-medium text-green-700">
                          {Array.isArray(right.answers) ? right.answers.join('、') : String(right.answers || '')}
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-gray-200 p-4">
              {result ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-gray-700">
                    得分 <span className="text-lg font-bold text-indigo-600">{result.earned}</span> / {result.full} 分
                    <span className="ml-2 text-xs text-gray-500">
                      （答对 {result.credit} / {result.weight} 小题）
                    </span>
                    {result.credit === result.weight && (
                      <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">全部正确</span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setChoiceAnswers({}); setBlankAnswers({}); setResult(null); }}
                      className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
                    >
                      再做一次
                    </button>
                    <button
                      onClick={() => {
                        const idx = items.findIndex((it) => it.id === activeId);
                        const next = items[idx + 1];
                        if (next) setActiveId(next.id);
                      }}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                    >
                      下一题 <i className="fa-solid fa-arrow-right ml-1"></i>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    已作答 {answeredCount} / {active.subs.length} 小题（可以只做会的，按小题给分）
                  </p>
                  <button
                    onClick={() => {
                      // 复用学生端现有的 AI 答疑浮窗：把材料 + 所有小题（含选项）拼成纯文本
                      const toText = (html: string) =>
                        String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
                      let text = toText(active.content);
                      active.subs.forEach((sq, i) => {
                        text += `\n\n(${i + 1}) ${toText(sq.content)}`;
                        if (sq.type !== 'fill_blank') {
                          sq.options.forEach((o, oi) => {
                            text += `\n${LETTERS[oi]}. ${toText(stripOptionPrefix(String(o)))}`;
                          });
                        }
                      });
                      (window as any).openAiQaWindow?.({ question: text });
                    }}
                    className="rounded-lg bg-purple-500 px-4 py-2 text-sm text-white hover:bg-purple-600"
                  >
                    <i className="fa-solid fa-robot mr-1"></i>AI答疑
                  </button>
                  <button
                    onClick={submit}
                    disabled={submitting || answeredCount === 0}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {submitting ? '判分中…' : '提交本题'}
                  </button>
                </div>
              )}
              {submitError && <p className="mt-2 text-xs text-rose-600">{submitError}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
