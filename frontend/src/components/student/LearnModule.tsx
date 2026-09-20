/**
 * 学习模块（v2.5.0 换骨架）
 *
 * 改造前：硬编码「Python百问 / IT百问」，自造「第一层…第十四层」语言，与题库聚类、
 *         考点精讲三套分类割裂，学生学完一章找不到对应练习。
 * 改造后：目录、讲义、题量、练习入口全部由 chapter-taxonomy 的 16 章词表统一驱动：
 *   - 左侧：4 大部分 / 16 章目录（可展开小节，显示各小节题量）
 *   - 右侧：该章讲义正文（来自 /api/student/learn-chapter/:id，样式作用域 .xs-lecture）
 *           + 「去练习这一章」（带 cluster 筛选跳到练习模块）
 *           + 「章末自测」（原问答内容，按章归组，点击打开 AI 答疑）
 *
 * 注意：原「看满 10 题触发勤学好问 Buff」已废弃，Buff 现由「当天 AI 答疑成功 ≥10 次」触发，
 *       本组件不再承担任何打卡职责；learn-visited 仅用于记录「已看」进度。
 */
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { getSelfTest } from '../../data/learnSelfTest';
import { useDesktopStore } from '../../store/desktopStore';
import { PracticeModule } from './PracticeModule';

interface ChapterSection {
  name: string;
  path: string;
  question_count: number;
}

interface ChapterItem {
  index: number;
  cluster_id: string;
  code: string;
  cn: string;
  badge: string;
  part: string;
  part_index: number;
  has_lecture: boolean;
  sections: ChapterSection[];
  chapter_only_count: number;
  question_count: number;
  visited_count: number;
}

const PART_COLORS: Record<number, { grad: string; accent: string; border: string }> = {
  1: { grad: 'from-blue-500 to-cyan-500', accent: 'text-blue-600', border: 'border-blue-300' },
  2: { grad: 'from-orange-500 to-amber-500', accent: 'text-orange-600', border: 'border-orange-300' },
  3: { grad: 'from-teal-500 to-emerald-500', accent: 'text-teal-600', border: 'border-teal-300' },
  4: { grad: 'from-purple-500 to-fuchsia-500', accent: 'text-purple-600', border: 'border-purple-300' },
};

export const LearnModule: React.FC = () => {
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [chapterDetail, setChapterDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showSelfTest, setShowSelfTest] = useState(false);
  const [visitedQuestions, setVisitedQuestions] = useState<Set<string>>(new Set());
  const [cssInjected, setCssInjected] = useState(false);

  // 加载讲义样式（一次性）
  useEffect(() => {
    if (cssInjected || document.getElementById('xs-lecture-css')) { setCssInjected(true); return; }
    backendClient.get('/api/student/learn-lecture.css', {}, { responseType: 'text' })
      .then((css: any) => {
        const text = typeof css === 'string' ? css : (css?.data ?? '');
        if (!text) return;
        const style = document.createElement('style');
        style.id = 'xs-lecture-css';
        style.textContent = String(text);
        document.head.appendChild(style);
        setCssInjected(true);
      })
      .catch((e) => console.error('加载讲义样式失败:', e));
  }, [cssInjected]);

  // 加载章节目录
  useEffect(() => {
    (async () => {
      try {
        const res = await backendClient.get('/api/student/learn-chapters');
        const list: ChapterItem[] = res.data?.chapters || [];
        setChapters(list);
        if (list.length && !selectedChapter) setSelectedChapter(list[0].cluster_id);
      } catch (e) {
        console.error('加载学习章节目录失败:', e);
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  // 加载已看记录
  useEffect(() => {
    (async () => {
      try {
        const res = await backendClient.get('/api/student/learn-visited');
        if (res.data) setVisitedQuestions(new Set(res.data));
      } catch (e) {
        console.error('加载学习已看记录失败:', e);
      }
    })();
  }, []);

  // 加载选中章节讲义
  useEffect(() => {
    if (!selectedChapter) return;
    let cancelled = false;
    (async () => {
      setLoadingDetail(true);
      setShowSelfTest(false);
      try {
        const res = await backendClient.get(`/api/student/learn-chapter/${encodeURIComponent(selectedChapter)}`);
        if (!cancelled) setChapterDetail(res.data);
      } catch (e) {
        console.error('加载章节讲义失败:', e);
        if (!cancelled) setChapterDetail(null);
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedChapter]);

  const current = useMemo(
    () => chapters.find(c => c.cluster_id === selectedChapter) || null,
    [chapters, selectedChapter]
  );

  const selfTest = useMemo(
    () => (selectedChapter ? getSelfTest(selectedChapter) : []),
    [selectedChapter]
  );

  const colors = PART_COLORS[current?.part_index || 1] || PART_COLORS[1];

  const totalQuestions = chapters.reduce((s, c) => s + c.question_count, 0);
  const totalVisited = chapters.reduce((s, c) => s + c.visited_count, 0);

  /** 跳练习模块并带上章节筛选 */
  const goPractice = (clusterId?: string) => {
    const cid = clusterId || selectedChapter;
    if (!cid) return;
    // 打开练习窗口，并通过 initialCluster 让组件首屏就套用章节筛选。
    // 同时派发事件，兼容「练习窗口已经开着」的情况（组件已挂载，直接响应事件）。
    // 【必须传 component】WindowFrame 渲染的是 window.component，
    // 漏传会导致练习窗口整片空白（历史 bug）。
    useDesktopStore.getState().openWindow({
      id: 'practice',
      title: '练习',
      icon: 'fa-pen-to-square',
      color: 'bg-green-500',
      component: <PracticeModule initialCluster={cid} />,
    } as any);
    window.dispatchEvent(new CustomEvent('openPracticeWithCluster', { detail: { cluster_id: cid } }));
  };

  /** 标记已看（仅进度用，不再触发 buff） */
  const markVisited = (key: string, text: string) => {
    setVisitedQuestions(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      backendClient.post('/api/student/learn-visited', { question_key: key, question_text: text })
        .catch(e => console.error('保存学习已看记录失败:', e));
      return next;
    });
  };

  const handleQuestionClick = (question: string, globalIndex: number) => {
    markVisited(`${selectedChapter}::selftest::${globalIndex}`, question);
    (window as any).openAiQaWindow?.({ question });
  };

  const toggleChapter = (cid: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  };

  // 按大部分分组
  const grouped = useMemo(() => {
    const map = new Map<number, ChapterItem[]>();
    chapters.forEach(c => {
      const k = c.part_index || 1;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [chapters]);

  return (
    <div className="flex h-full bg-gray-50">
      {/* 左侧目录 */}
      <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
        <div className="sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
          <div className="p-3 bg-gradient-to-r from-indigo-500 to-blue-600 text-white">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
                <i className="fas fa-book-open text-lg"></i>
              </div>
              <div className="flex-1">
                <h2 className="font-bold leading-tight">考点精讲</h2>
                <div className="text-xs text-white/80">
                  已看 <span className="font-bold">{totalVisited}</span>/{totalQuestions} 题
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-2">
          {loadingList ? (
            <div className="p-6 text-center text-gray-400 text-sm">
              <i className="fas fa-spinner fa-spin mr-2"></i>加载中…
            </div>
          ) : (
            grouped.map(([partIdx, list]) => (
              <div key={partIdx} className="mb-2">
                <div className="px-3 py-1.5 text-xs font-bold text-gray-400 tracking-wider">
                  {list[0]?.part || `第 ${partIdx} 部分`}
                </div>
                <div className="space-y-0.5">
                  {list.map((ch) => {
                    const active = ch.cluster_id === selectedChapter;
                    const isOpen = expanded.has(ch.cluster_id);
                    const c = PART_COLORS[ch.part_index] || PART_COLORS[1];
                    return (
                      <div key={ch.cluster_id}>
                        <button
                          onClick={() => { setSelectedChapter(ch.cluster_id); }}
                          className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center gap-2 ${
                            active ? `bg-gradient-to-r ${c.grad} text-white shadow` : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <span className={`text-[11px] font-mono w-8 flex-shrink-0 ${active ? 'text-white/80' : 'text-gray-400'}`}>
                            {ch.code}
                          </span>
                          <span className={`flex-1 text-sm leading-snug ${active ? 'text-white font-medium' : 'text-gray-800'}`}>
                            {ch.cluster_id}
                          </span>
                          <span className={`text-[11px] flex-shrink-0 rounded-full px-1.5 ${
                            active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {ch.question_count}
                          </span>
                          {ch.sections.length > 0 && (
                            <span
                              onClick={(e) => { e.stopPropagation(); toggleChapter(ch.cluster_id); }}
                              className={`w-5 h-5 flex items-center justify-center rounded flex-shrink-0 ${
                                active ? 'hover:bg-white/20' : 'hover:bg-gray-200'
                              }`}
                            >
                              <i className={`fas fa-chevron-${isOpen ? 'down' : 'right'} text-[10px]`}></i>
                            </span>
                          )}
                        </button>
                        {isOpen && ch.sections.length > 0 && (
                          <div className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l border-gray-200 pl-2">
                            {ch.sections.map((sec) => (
                              <button
                                key={sec.path}
                                onClick={() => { setSelectedChapter(ch.cluster_id); setTimeout(() => { document.getElementById(`sec-${encodeURIComponent(sec.path)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120); }}
                                className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100 flex items-center gap-2"
                              >
                                <span className="flex-1 leading-snug">{sec.name}</span>
                                <span className={`text-[10px] ${sec.question_count > 0 ? 'text-gray-400' : 'text-gray-300'}`}>
                                  {sec.question_count}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧正文 */}
      <div className="flex-1 overflow-y-auto">
        {loadingDetail ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <i className="fas fa-spinner fa-spin mr-2 text-2xl"></i> 加载讲义中…
          </div>
        ) : !current ? (
          <div className="flex items-center justify-center h-full text-gray-400">请选择左侧章节</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedChapter}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="p-6 max-w-4xl mx-auto"
            >
              {/* 章标题 */}
              <div className={`mb-5 p-5 rounded-2xl bg-gradient-to-r ${colors.grad} text-white shadow-lg`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-mono bg-white/20 px-2 py-0.5 rounded">{current.code}</span>
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded">{current.part}</span>
                  {current.badge && <span className="text-xs bg-white/15 px-2 py-0.5 rounded">{current.badge}</span>}
                </div>
                <h1 className="text-2xl font-bold">
                  {current.cn ? `${current.cn}、` : ''}{current.cluster_id}
                </h1>
                <p className="text-sm text-white/85 mt-1">
                  本章共 {current.question_count} 道练习题
                  {current.chapter_only_count > 0 && `（含章级综合题 ${current.chapter_only_count} 道）`}
                </p>
              </div>

              {/* 操作按钮 */}
              <div className="flex flex-wrap gap-2 mb-5">
                <button
                  onClick={() => goPractice(current.cluster_id)}
                  disabled={current.question_count === 0}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-sm ${
                    current.question_count === 0
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : `bg-gradient-to-r ${colors.grad} text-white hover:shadow-md hover:-translate-y-0.5`
                  }`}
                >
                  <i className="fas fa-pen-to-square"></i>
                  去练习这一章（{current.question_count} 题）
                </button>
                <button
                  onClick={() => setShowSelfTest(v => !v)}
                  disabled={selfTest.length === 0}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all border-2 ${
                    selfTest.length === 0
                      ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                      : showSelfTest
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'
                  }`}
                >
                  <i className="fas fa-circle-question"></i>
                  章末自测（{selfTest.length} 问）
                </button>
                {current.sections.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap ml-auto">
                    {current.sections.filter(s => s.question_count > 0).slice(0, 4).map(s => (
                      <button
                        key={s.path}
                        onClick={() => goPractice(s.path)}
                        className="px-2.5 py-1.5 rounded-lg text-xs bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                        title={`去练习：${s.name}`}
                      >
                        {s.name} <span className="text-gray-400">{s.question_count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 章末自测面板 */}
              {showSelfTest && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mb-5 overflow-hidden"
                >
                  <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3 text-indigo-800 font-bold text-sm">
                      <i className="fas fa-lightbulb"></i>
                      章末自测 · 想一想这些知识点你都会了吗？（点击打开 AI 答疑）
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {selfTest.map((q, i) => {
                        const key = `${selectedChapter}::selftest::${i}`;
                        const done = visitedQuestions.has(key);
                        return (
                          <div
                            key={i}
                            onClick={() => handleQuestionClick(q.question, i)}
                            className={`group p-3 rounded-xl cursor-pointer transition-all text-sm flex items-start gap-3 border ${
                              done ? 'bg-green-50 border-green-200' : 'bg-white border-indigo-100 hover:border-indigo-300 hover:shadow-sm'
                            }`}
                          >
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                              done ? 'bg-green-100 text-green-600' : 'bg-indigo-100 text-indigo-600'
                            }`}>
                              {done ? <i className="fas fa-check"></i> : i + 1}
                            </span>
                            <span className={`flex-1 leading-relaxed ${done ? 'text-green-800' : 'text-gray-700'}`}>
                              {q.question}
                            </span>
                            <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity">
                              <i className="fas fa-robot mr-1"></i>答疑
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* 讲义正文 */}
              {chapterDetail?.html ? (
                <div
                  className={`bg-white rounded-2xl border ${colors.border} shadow-sm p-1`}
                  dangerouslySetInnerHTML={{ __html: chapterDetail.html }}
                />
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">
                  <i className="fas fa-file-lines text-3xl mb-3"></i>
                  <p>本章暂无讲义内容</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default LearnModule;
