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

/** 存档记录（列表只需要摘要，正文按需拉） */
interface ReportRow {
  id: string;
  class_id: string;
  class_name: string | null;
  topic: string;
  question: string;
  model: string | null;
  created_at: string;
  answer_len: number;
}

interface ReportDetail extends ReportRow {
  answer: string;
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
  /** 历史存档（2026-10-26：分析结果刷新就丢，改成自动存档 + 可回看） */
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [viewing, setViewing] = useState<ReportDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

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

  const loadReports = useCallback(async () => {
    if (!classId) return;
    try {
      const rows = await apiGet<ReportRow[]>(`/api/teacher/ai-analysis/reports?class_id=${encodeURIComponent(classId)}&limit=50`);
      const list = Array.isArray(rows) ? rows : [];
      setReports(list);
      return list;
    } catch (e) {
      console.error('读取历史分析失败:', e);
      setReports([]);
      return [];
    }
  }, [classId]);

  const openReport = async (id: string) => {
    setViewLoading(true);
    try {
      const d = await apiGet<ReportDetail>(`/api/teacher/ai-analysis/reports/${id}`);
      setViewing(d);
    } catch (e) {
      setChatError((e as Error).message || '打开记录失败');
    } finally {
      setViewLoading(false);
    }
  };

  const removeReport = async (id: string) => {
    if (!window.confirm('删除这条分析记录？删除后无法恢复。')) return;
    try {
      const token = localStorage.getItem('xgpy_token');
      const res = await fetch(`${API}/api/teacher/ai-analysis/reports/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || '删除失败');
      if (viewing?.id === id) setViewing(null);
      await loadReports();
    } catch (e) {
      setChatError((e as Error).message || '删除失败');
    }
  };

  useEffect(() => {
    // 换班或换主题都要重置对话 —— 旧对话是针对另一个班/另一批数据的，留着会误导
    setTurns([]);
    setChatError('');
    setJustSaved(false);
    loadContext(activeTopic);
    loadReports();
  }, [classId, activeTopic, loadContext, loadReports]);

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
      const d = await apiPost<{ answer: string; context: AnalysisContext; used_today: number; daily_limit: number; report_id: string | null }>(
        '/api/teacher/ai-analysis/chat',
        { class_id: classId, topic: activeTopic, question: q, history }
      );
      setTurns((prev) => [...prev, { role: 'assistant', content: d.answer || '（AI 没有返回内容）', topic: activeTopic }]);
      // 服务端每轮都会重新取数，用最新的一份覆盖右侧表格
      if (d.context) setContext(d.context);
      setUsedToday(Number(d.used_today) || 0);
      setDailyLimit(Number(d.daily_limit) || dailyLimit);
      // 服务端已存档，这里把历史列表刷新一下并短暂提示「已保存」
      if (d.report_id) {
        setJustSaved(true);
        window.setTimeout(() => setJustSaved(false), 4000);
      }
      loadReports();
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
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          {justSaved && (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
              <i className="fa-solid fa-check mr-1"></i>已自动保存
            </span>
          )}
          <button
            onClick={() => {
              const next = !showHistory;
              setShowHistory(next);
              if (next) loadReports();
            }}
            className={`rounded-full px-3 py-1 transition-colors ${
              showHistory ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <i className="fa-solid fa-clock-rotate-left mr-1"></i>
            历史分析{reports.length ? ` (${reports.length})` : ''}
          </button>
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

      {/* 历史存档：每次分析服务端自动存一份，切班/刷新都不会丢 */}
      {showHistory && (
        <div className="border-b border-gray-200 bg-gray-50/70 p-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">
              历史分析
              <span className="ml-2 text-xs font-normal text-gray-500">
                共 {reports.length} 条（点一条查看原文）
              </span>
            </h4>
            <button onClick={() => setShowHistory(false)} className="text-xs text-gray-400 hover:text-gray-600">
              收起
            </button>
          </div>
          {reports.length === 0 ? (
            <p className="text-xs text-gray-400">这个班还没有保存过的分析，生成一次就会自动存下来。</p>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {reports.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-violet-300"
                >
                  <button onClick={() => openReport(r.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{topicLabel(r.topic)}</span>
                      <span>{formatTime(r.created_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-gray-700">{r.question}</p>
                  </button>
                  <button
                    onClick={() => removeReport(r.id)}
                    title="删除这条记录"
                    className="mt-1 text-xs text-gray-300 hover:text-red-500"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
          {viewLoading && <p className="mt-2 text-xs text-gray-400">正在打开…</p>}
        </div>
      )}

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

      {/* 历史记录只读预览 */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
              <div className="min-w-0">
                <h3 className="font-bold text-gray-800">
                  {topicLabel(viewing.topic)} · {formatTime(viewing.created_at)}
                </h3>
                <p className="mt-1 truncate text-xs text-gray-500">提问：{viewing.question}</p>
                <p className="mt-1 text-[11px] text-amber-700">
                  这份结论基于生成当时的统计数据，不是实时结果；要看最新情况请重新分析。
                </p>
              </div>
              <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-gray-600">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="markdown-content min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-gray-800">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{viewing.answer}</ReactMarkdown>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 p-3">
              <button
                onClick={() => removeReport(viewing.id)}
                className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600 hover:bg-red-100"
              >
                删除记录
              </button>
              <button
                onClick={() => setViewing(null)}
                className="rounded-lg bg-gray-100 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function topicLabel(key: string): string {
  const map: Record<string, string> = {
    overview: '总览',
    mastery: '掌握情况',
    wrong: '错题分析',
    students: '学生关注',
    exam: '考试分析',
  };
  return map[key] || key;
}

/** 存档时间：今天只显示时分，跨天带上日期，省得占地方 */
function formatTime(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, '0');
  return sameDay
    ? `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tablesHint(ctx: AnalysisContext | null): string {
  if (!ctx || !ctx.tables?.length) return '';
  return `（${ctx.tables.length} 张表，可核对）`;
}
