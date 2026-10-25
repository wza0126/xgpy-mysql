import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { API_CONFIG } from '../../api/config';

/**
 * AI 学情分析面板（学情分析第 5 个标签）
 *
 * 设计要点（2026-10-25 与吴老确认）：
 *   ① AI 不查数据库 —— 服务端跑固定 SQL 出指标包，AI 只负责把数字讲成人话。
 *      所以界面上**左边是 AI 的文字，右边是原始数据表**，老师随时能核对。
 *   ② 服务端每轮都重新取数，前端传的数字一律不被采信。
 *   ③ 选主题只拉数据（不自动调 AI），避免老师只是想看表格却白烧一次调用；
 *      点「开始分析」才真正调模型。
 *   ④ 学生姓名不脱敏，会随指标包发到 AI 服务商，界面顶部必须明确告知老师。
 */

interface Topic {
  key: string;
  label: string;
  icon: string;
  desc: string;
}

interface DataTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

interface AnalysisContext {
  topic: string;
  topic_label: string;
  class_id: string;
  class_name: string;
  student_count: number;
  generated_at: string;
  master_threshold: number;
  metrics: Record<string, unknown>;
  tables: DataTable[];
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** 该轮对应的主题，切换主题后旧对话用不到但仍保留展示 */
  topic?: string;
}

const API = API_CONFIG.apiUrl;

async function apiGet<T>(path: string): Promise<T> {
  const token = localStorage.getItem('xgpy_token');
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || '请求失败');
  return json.data as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = localStorage.getItem('xgpy_token');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || '请求失败');
  return json.data as T;
}

/** 每个主题的默认提问：点「开始分析」就按这个问，老师不用自己想问题 */
const DEFAULT_QUESTION: Record<string, string> = {
  overview: '请概括这个班最近的练习情况和掌握程度，指出最值得注意的地方。',
  mastery: '请找出这个班最薄弱的章节和知识点，说明薄弱到什么程度，并给出补强建议。',
  wrong: '这些高频错题反映了学生哪些知识漏洞？请按知识点归类说明，并指出该重点讲哪几道题。',
  students: '哪些学生需要重点关注？分别是什么原因？我应该优先找哪些人谈、谈什么？',
  exam: '请分析各场考试的成绩情况，指出趋势变化和最需要关注的学生群体。',
};

const STARTER_QUESTIONS = [
  '这个班现在最大的问题是什么？',
  '如果只有一节课的时间，我应该补什么？',
  '和上一次相比，有进步吗？',
];

export const AiAnalysisPanel: React.FC<{ classId: string }> = ({ classId }) => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [activeTopic, setActiveTopic] = useState<string>('overview');
  const [context, setContext] = useState<AnalysisContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [ctxError, setCtxError] = useState('');

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [chatError, setChatError] = useState('');
  const [input, setInput] = useState('');
  const [usedToday, setUsedToday] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(60);
  const [showTables, setShowTables] = useState(true);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const reqIdRef = useRef(0);

  // ---------- 主题列表 ----------
  useEffect(() => {
    apiGet<{ topics: Topic[]; daily_limit: number; used_today: number }>('/api/teacher/ai-analysis/topics')
      .then((d) => {
        setTopics(Array.isArray(d?.topics) ? d.topics : []);
        setDailyLimit(Number(d?.daily_limit) || 60);
        setUsedToday(Number(d?.used_today) || 0);
      })
      .catch((e) => {
        console.error('获取分析主题失败:', e);
        setTopics([]);
      });
  }, []);

  // ---------- 拉指标包（切班 / 切主题） ----------
  const loadContext = useCallback(
    async (topic: string) => {
      if (!classId) return;
      const myReq = ++reqIdRef.current;
      setLoadingCtx(true);
      setCtxError('');
      try {
        const d = await apiGet<AnalysisContext>(
          `/api/teacher/ai-analysis/context?class_id=${encodeURIComponent(classId)}&topic=${topic}`
        );
        if (myReq !== reqIdRef.current) return; // 已被更新的请求取代
        setContext(d);
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        setCtxError((e as Error).message || '加载数据失败');
        setContext(null);
      } finally {
        if (myReq === reqIdRef.current) setLoadingCtx(false);
      }
    },
    [classId]
  );

  useEffect(() => {
    // 换班或换主题都要重置对话 —— 旧对话是针对另一个班/另一批数据的，留着会误导
    setTurns([]);
    setChatError('');
    loadContext(activeTopic);
  }, [classId, activeTopic, loadContext]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, thinking]);

  // ---------- 提问 ----------
  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || thinking || !classId) return;
    setChatError('');

    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: 'user', content: q, topic: activeTopic }]);
    setInput('');
    setThinking(true);

    try {
      const d = await apiPost<{ answer: string; context: AnalysisContext; used_today: number; daily_limit: number }>(
        '/api/teacher/ai-analysis/chat',
        { class_id: classId, topic: activeTopic, question: q, history }
      );
      setTurns((prev) => [...prev, { role: 'assistant', content: d.answer || '（AI 没有返回内容）', topic: activeTopic }]);
      // 服务端每轮都会重新取数，用最新的一份覆盖右侧表格
      if (d.context) setContext(d.context);
      setUsedToday(Number(d.used_today) || 0);
      setDailyLimit(Number(d.daily_limit) || dailyLimit);
    } catch (e) {
      setChatError((e as Error).message || 'AI 分析失败');
      setTurns((prev) => prev.slice(0, -1)); // 把刚加的问题撤回，避免留下一条没有回答的记录
    } finally {
      setThinking(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送、Shift+Enter 换行；输入法合成态不拦（否则打拼音选词会误发）
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(input);
    }
  };

  const activeTopicMeta = topics.find((t) => t.key === activeTopic);
  const remaining = Math.max(0, dailyLimit - usedToday);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 p-5">
        <div>
          <h3 className="text-lg font-bold text-gray-800">
            <i className="fa-solid fa-wand-magic-sparkles mr-2 text-violet-500"></i>
            AI 学情分析
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            选一个分析主题，AI 会读这批统计数字并给出教学判断。所有数字来自数据库实际统计，右侧可核对原始数据。
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="rounded-full bg-gray-100 px-3 py-1">
            今日剩余 <span className="font-semibold text-gray-700">{remaining}</span>/{dailyLimit} 次
          </span>
        </div>
      </div>

      {/* 数据出校提示：一次性，说明清楚比藏着好 */}
      <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50/70 px-5 py-2.5 text-xs text-amber-800">
        <i className="fa-solid fa-circle-info mt-0.5"></i>
        <span>
          分析时会把<b>该班的统计数据（含学生姓名）</b>发送到 AI 服务商（系统配置里填写的那家）。
          如果学校有要求，请先在「系统配置 → AI设置」切换到合规的服务商。
        </span>
      </div>

      {/* 主题选择 */}
      <div className="border-b border-gray-200 p-5">
        <div className="flex flex-wrap gap-2">
          {topics.map((t) => {
            const on = activeTopic === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTopic(t.key)}
                title={t.desc}
                className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  on
                    ? 'border-violet-300 bg-violet-50 text-violet-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <i className={`fa-solid ${t.icon} text-xs`}></i>
                {t.label}
              </button>
            );
          })}
        </div>
        {activeTopicMeta && (
          <p className="mt-2 text-xs text-gray-500">
            <i className="fa-solid fa-circle-dot mr-1 text-[8px] text-violet-400"></i>
            {activeTopicMeta.desc}
          </p>
        )}
      </div>

      {/* 主体：左对话 右数据 */}
      <div className="flex flex-col lg:flex-row">
        {/* ---------- 左：对话 ---------- */}
        <div className="flex min-w-0 flex-1 flex-col border-b border-gray-200 lg:border-b-0 lg:border-r">
          <div className="max-h-[520px] min-h-[320px] space-y-4 overflow-y-auto p-5">
            {loadingCtx && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <i className="fa-solid fa-circle-notch fa-spin"></i>
                正在统计数据…
              </div>
            )}

            {ctxError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                加载数据失败：{ctxError}
              </div>
            )}

            {!loadingCtx && !ctxError && turns.length === 0 && (
              <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 p-5">
                <p className="text-sm text-gray-700">
                  数据已就绪{context ? `：${context.class_name}，${context.student_count} 名学生` : ''}。
                  点下面的按钮让 AI 开始分析，也可以直接问你想知道的事。
                </p>
                <button
                  onClick={() => ask(DEFAULT_QUESTION[activeTopic] || '请分析这批数据。')}
                  disabled={!context || thinking || remaining === 0}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  <i className="fa-solid fa-play text-xs"></i>
                  {remaining === 0 ? '今日次数已用完' : '开始分析'}
                </button>
                <div className="mt-4 flex flex-wrap gap-2">
                  {STARTER_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => ask(q)}
                      disabled={!context || thinking || remaining === 0}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 transition-colors hover:border-violet-300 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) =>
              t.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-violet-600 px-4 py-2.5 text-sm text-white">
                    {t.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                    <i className="fa-solid fa-wand-magic-sparkles text-xs"></i>
                  </div>
                  <div className="markdown-content min-w-0 max-w-[92%] rounded-2xl rounded-tl-sm bg-gray-50 px-4 py-3 text-sm text-gray-800">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.content}</ReactMarkdown>
                  </div>
                </div>
              )
            )}

            {thinking && (
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                  <i className="fa-solid fa-wand-magic-sparkles text-xs"></i>
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                  正在读数据…
                </div>
              </div>
            )}

            {chatError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {chatError}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* 输入框 */}
          <div className="border-t border-gray-200 p-4">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={500}
                placeholder={
                  remaining === 0
                    ? '今天的分析次数已用完，明天再来'
                    : '继续追问，例如「哪几个学生在 Python 循环这块最弱？」（Enter 发送，Shift+Enter 换行）'
                }
                disabled={remaining === 0}
                className="min-h-[52px] flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300 disabled:bg-gray-100"
              />
              <button
                onClick={() => ask(input)}
                disabled={!input.trim() || thinking || remaining === 0}
                className="flex h-[52px] items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <i className={`fa-solid ${thinking ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`}></i>
                发送
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">
              AI 给出的是数据解读与推测，不是诊断结论。涉及学生个人时请结合日常观察判断。
            </p>
          </div>
        </div>

        {/* ---------- 右：原始数据（可折叠） ---------- */}
        <div className="w-full shrink-0 lg:w-[430px]">
          <button
            onClick={() => setShowTables((v) => !v)}
            className="flex w-full items-center justify-between border-b border-gray-200 px-5 py-3 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <span>
              <i className="fa-solid fa-table-list mr-2 text-gray-400"></i>
              原始数据{tablesHint(context)}
            </span>
            <i className={`fa-solid fa-chevron-${showTables ? 'up' : 'down'} text-xs text-gray-400`}></i>
          </button>

          {showTables && (
            <div className="max-h-[520px] overflow-y-auto p-4">
              {loadingCtx && <div className="py-6 text-center text-sm text-gray-400">加载中…</div>}
              {!loadingCtx && context && context.tables.length === 0 && (
                <div className="py-6 text-center text-sm text-gray-400">
                  <i className="fa-solid fa-inbox mb-2 block text-2xl text-gray-300"></i>
                  这个主题暂时没有可核对的明细表
                </div>
              )}
              {!loadingCtx &&
                context?.tables.map((tb, idx) => (
                  <div key={idx} className="mb-5 last:mb-0">
                    <h4 className="mb-2 text-xs font-semibold text-gray-600">{tb.title}</h4>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50">
                            {tb.columns.map((c) => (
                              <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-gray-600">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {tb.rows.length === 0 ? (
                            <tr>
                              <td colSpan={tb.columns.length} className="px-2 py-3 text-center text-gray-400">
                                暂无数据
                              </td>
                            </tr>
                          ) : (
                            tb.rows.map((row, ri) => (
                              <tr key={ri} className="hover:bg-gray-50">
                                {row.map((cell, ci) => (
                                  <td
                                    key={ci}
                                    className={`px-2 py-1.5 ${
                                      ci === 0 ? 'whitespace-nowrap text-gray-700' : 'whitespace-nowrap text-gray-600'
                                    }`}
                                  >
                                    {String(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function tablesHint(ctx: AnalysisContext | null): string {
  if (!ctx || !ctx.tables?.length) return '';
  return `（${ctx.tables.length} 张表，可核对）`;
}
