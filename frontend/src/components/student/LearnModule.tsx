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
import { peekPendingLearnChapter, clearPendingLearnChapter, onOpenLearnChapter } from '../../utils/learnNav';

interface ChapterSection {
  name: string;
  path: string;
  /** 小节编号（1.1.1，来自后端 chapter-taxonomy 的书写顺序；老后端可能没有） */
  code?: string;
  /** 讲义正文里该小节标题的 DOM id（后端注入；讲义无对应标题时为空串） */
  anchor?: string;
  question_count: number;
  /** 该小节已掌握题数（口径：练习来源答对次数 >= 掌握阈值） */
  mastered_count?: number;
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
  /** 已掌握题数（口径与练习模块一致：练习来源答对次数 >= 掌握阈值） */
  mastered_count: number;
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
  // 外部要求定位的章 / 小节（惰性读一次：窗口是「先派事件再开」的时序时，只能在挂载时拿到）
  // ⚠️ 必须放在 expanded / activeSectionPath 之前：它们的初始值要用到它（外部跳进来时章要展开、小节要高亮）
  const [pendingTarget] = useState<{ cluster_id: string; section?: string } | null>(() => peekPendingLearnChapter());
  const pendingChapter = pendingTarget?.cluster_id ?? null;

  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [chapterDetail, setChapterDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // 外部跳进来时（星域「下一个目标」/ 知识点地图）默认展开目标章，学生一眼看到该章的小节
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    pendingTarget ? new Set([pendingTarget.cluster_id]) : new Set<string>()
  );
  const [showSelfTest, setShowSelfTest] = useState(false);
  // 二级目录（知识点）当前选中项：只做高亮，用于点完知道「我刚看的是哪个知识点」
  const [activeSectionPath, setActiveSectionPath] = useState<string | null>(() =>
    pendingTarget?.section ? `${pendingTarget.cluster_id}/${pendingTarget.section}` : null
  );
  const [visitedQuestions, setVisitedQuestions] = useState<Set<string>>(new Set());
  const [cssInjected, setCssInjected] = useState(false);
  // 右下角「回到顶部」悬浮按钮：讲义很长时免去手动滚回顶部
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [showBackTop, setShowBackTop] = useState(false);
  // 讲义正文容器：用于往小节标题里注入「去练习」按钮
  const lectureRef = React.useRef<HTMLDivElement | null>(null);
  // 左侧目录滚动容器：从外部（星域知识点地图）跳进来时把目标章滚到可视区
  const sidebarRef = React.useRef<HTMLDivElement | null>(null);
  // 待滚到的小节：{ 章, 小节名 }。等该章讲义渲染完成后由下面的 effect 消费，随后置空（只生效一次）
  const [pendingSectionTarget, setPendingSectionTarget] = useState<{ chapter: string; section: string } | null>(
    pendingTarget && pendingTarget.section
      ? { chapter: pendingTarget.cluster_id, section: pendingTarget.section }
      : null
  );

  // 监听右侧正文容器的滚动位置，超过阈值才显示按钮
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowBackTop(el.scrollTop > 240);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [selectedChapter, loadingDetail]);

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /**
   * 滚动右侧正文到某个小节锚点。
   *
   * 为什么不用 `el.scrollIntoView()`：学习模块是**桌面窗口内的应用**，
   * scrollIntoView 会连带滚动外层窗口容器与页面，把窗口顶跑偏。
   * 这里手动算相对偏移，只滚右侧这个 overflow-y-auto 容器，行为可控。
   *
   * @param anchor 后端下发的小节锚点 id；空串表示该小节讲义里没有对应标题
   */
  const scrollToAnchor = (anchor?: string | null) => {
    const scroller = scrollRef.current;
    if (!scroller || !anchor) return false;
    const target = document.getElementById(anchor);
    if (!target) return false;
    const offset = target.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
      + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, offset - 12), behavior: 'smooth' });
    return true;
  };

  // 加载讲义样式（一次性）
  useEffect(() => {
    if (!document.getElementById('xs-lp-css')) {
      // 【学练结合】讲义小节标题右侧的「去练习」胶囊样式。
      // 讲义正文里插的是裸 DOM（不走 React），类名也不在 Tailwind 扫描范围内，
      // 所以必须在这里以普通 CSS 注入。
      const style = document.createElement('style');
      style.id = 'xs-lp-css';
      style.textContent = `
.xs-lecture .lp-inline-practice {
  display: inline-flex;
  align-items: center;
  margin-left: 10px;
  padding: 1px 8px;
  border: 1px solid #c7d2fe;
  border-radius: 999px;
  background: #eef2ff;
  color: #4f46e5;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
  vertical-align: middle;
  cursor: pointer;
  opacity: .5;
  transition: opacity .15s, background-color .15s, color .15s, border-color .15s;
}
.xs-lecture h4:hover > .lp-inline-practice,
.xs-lecture h5:hover > .lp-inline-practice,
.xs-lecture h6:hover > .lp-inline-practice,
.xs-lecture .lp-inline-practice:hover,
.xs-lecture .lp-inline-practice:focus-visible { opacity: 1; }
.xs-lecture .lp-inline-practice:hover { background: #4f46e5; border-color: #4f46e5; color: #fff; }
.xs-lecture .xs-anchor { display: block; height: 0; overflow: hidden; }
`;
      document.head.appendChild(style);
    }
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
        // 默认选中：已有选择 > 外部指定的章 > 第一章
        setSelectedChapter((prev) => {
          if (prev && list.some((c) => c.cluster_id === prev)) return prev;
          if (pendingChapter && list.some((c) => c.cluster_id === pendingChapter)) return pendingChapter;
          return list[0]?.cluster_id ?? null;
        });
      } catch (e) {
        console.error('加载学习章节目录失败:', e);
      } finally {
        setLoadingList(false);
      }
    })();
  }, [pendingChapter]);

  // 窗口已经开着时被要求切章（星域知识点地图 / 今日卡「下一个目标」在桌面再点一次）
  useEffect(() => {
    return onOpenLearnChapter((cid, section) => {
      setSelectedChapter(cid);
      setShowSelfTest(false);
      setActiveSectionPath(null);
      // 顺手展开该章小节，便于继续点到具体知识点
      setExpanded((prev) => (prev.has(cid) ? prev : new Set(prev).add(cid)));
      // 带小节时记下来，等这一章的讲义渲染完成后滚过去
      setPendingSectionTarget(section ? { chapter: cid, section } : null);
    });
  }, []);

  // 切章后把左侧目录里的目标章滚进可视区（不用 scrollIntoView：会连带滚外层窗口）
  useEffect(() => {
    if (!selectedChapter) return;
    const box = sidebarRef.current;
    if (!box) return;
    const el = box.querySelector(`[data-learn-chapter="${CSS.escape(selectedChapter)}"]`) as HTMLElement | null;
    if (!el) return;
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const top = box.scrollTop + delta - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [selectedChapter, chapters.length]);

  // 待定位目标已取进 state，这里才清掉 pending（避免下次从图标打开还跳回旧章）
  useEffect(() => {
    clearPendingLearnChapter();
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

  /** 本章自测已看数（供按钮显示进度，与顶部进度条同源） */
  const selfTestDoneInChapter = useMemo(
    () => (selectedChapter
      ? selfTest.reduce((n, _, i) => n + (visitedQuestions.has(`${selectedChapter}::selftest::${i}`) ? 1 : 0), 0)
      : 0),
    [selectedChapter, selfTest, visitedQuestions]
  );

  const colors = PART_COLORS[current?.part_index || 1] || PART_COLORS[1];

  /**
   * 外部带小节跳转（今日卡「下一个目标」）：等该章讲义渲染出锚点后滚过去。
   *
   * 讲义渲染是异步的（换章要重新拉 html），元素出现时间不确定，所以失败就短间隔重试几次；
   * 不论成功与否最后都清空目标，避免这个 effect 反复触发。
   */
  useEffect(() => {
    const t = pendingSectionTarget;
    if (!t) return;
    // 章还没切过去 / 这一章的讲义还在加载 → 等下一轮
    if (selectedChapter !== t.chapter || loadingDetail) return;
    const norm = (s: string) => String(s || '').replace(/\s+/g, '');
    const secs = current?.sections || [];
    const hit =
      secs.find((s) => s.name === t.section) ||
      secs.find((s) => norm(s.name) === norm(t.section)) ||
      secs.find((s) => norm(s.name).includes(norm(t.section)) || norm(t.section).includes(norm(s.name)));
    let left = 20;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      /**
       * ⚠️ 必须先确认容器已经有真实尺寸再滚。
       * 窗口**最小化**时内容仍是挂载状态但高度为 0，此时算出来的 offset 是 0，
       * 滚动会「成功」但实际没动（学生在最小化窗口上点「下一个目标」就是这么失效的）。
       * 所以这里等容器高度恢复（点击会同时把窗口还原）后再滚，最多等 3 秒。
       */
      const scroller = scrollRef.current;
      const anchorEl = hit?.anchor ? document.getElementById(hit.anchor) : null;
      if (scroller && scroller.clientHeight > 40 && anchorEl) {
        scrollToAnchor(hit!.anchor);
        setActiveSectionPath(hit!.path);
        setPendingSectionTarget(null);
        return;
      }
      if (left-- > 0) {
        timer = setTimeout(attempt, 150);
        return;
      }
      setPendingSectionTarget(null);
    };
    attempt();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pendingSectionTarget, selectedChapter, loadingDetail, chapterDetail?.html, current]);

  /**
   * 进度口径（v2.5.2 修正）：
   * 进度分子的唯一来源是「章末自测」点击记录（learn-visited，key 形如 `章名::selftest::序号`），
   * 所以**分母也必须是章末自测的总问数**，否则口径不对齐 —— 旧版用题库总数 1107 当分母，
   * 而自测只有 350 问、且两者根本不是同一个集合，导致学生永远看不到「已看满」，
   * 进度条实质失效（真实 bug：用户做了题进度不动）。
   */
  const selfTestTotal = useMemo(
    () => chapters.reduce((s, c) => s + getSelfTest(c.cluster_id).length, 0),
    [chapters]
  );
  // 只统计真正落在「章末自测」键空间内的记录，避免把历史脏数据算进来
  const selfTestVisited = useMemo(
    () => Array.from(visitedQuestions).filter(k => k.includes('::selftest::')).length,
    [visitedQuestions]
  );
  const progressPercent = selfTestTotal > 0
    ? Math.min(100, Math.round((selfTestVisited / selfTestTotal) * 100))
    : 0;

  /**
   * 跳练习模块并带上章节筛选。
   *
   * 【学练结合】传 sec 时（从右侧小节的「去练习」按钮进来），会**先把学习页正文
   * 滚到该小节**，再打开练习窗口：学生点完按钮，左边讲义同步定位到考点，
   * 练习窗口盖在上面，看讲义 / 做题来回切不用再手工找位置。
   *
   * @param clusterId 筛选用的 cluster_id（「章名」= 整章，「章名/小节名」= 单小节）
   * @param sec       可选，被点击的小节（用于页面内滚动定位）
   */
  const goPractice = (clusterId?: string, sec?: ChapterSection) => {
    const cid = clusterId || selectedChapter;
    if (!cid) return;
    // 先滚动学习页（讲义已经渲染好了，字体变化不影响定位；若还没渲染则等一帧再试）
    if (sec?.anchor) {
      if (!scrollToAnchor(sec.anchor)) {
        setTimeout(() => scrollToAnchor(sec.anchor), 120);
      }
    }
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

  /**
   * 【学练结合】讲义渲染后，给每小节标题右侧挂一个「去练习 N」小胶囊。
   *
   * 为什么用 DOM 注入而不是改讲义 HTML：
   *   - 讲义是教师维护的考点精讲手册，不该混入业务按钮；
   *   - 按钮要显示实时题量、要绑 React 的跳转逻辑，只有在前端拿得到。
   *
   * 【坑】讲义外层是 <AnimatePresence mode="wait">，换章时旧节点先播退出动画、
   * 新节点才挂载 —— effect 首次执行时 lectureRef.current 还指着旧节点或为 null。
   * 所以这里不能"跑一次就完"，必须轮询重试（最多 INJECT_RETRY 次）直到：
   *   a) ref 指向的本章讲义容器已就绪（内部含本章的锚点），且 b) 胶囊已插入。
   * 靠 data-lp-key 标记保证幂等，重试不会重复插入。
   */
  useEffect(() => {
    if (!chapterDetail?.html || !current) return;
    const wantChapter = current.cluster_id;
    const secs = current.sections.filter((s) => s.anchor && s.question_count > 0);
    if (!secs.length) return;

    const INJECT_RETRY = 24;      // 24 × 150ms ≈ 3.6s，足够覆盖换章动画 + 接口往返
    let tries = 0;
    let timer: number | null = null;
    let disposed = false;

    const run = () => {
      if (disposed) return;
      const host = lectureRef.current;
      // 讲义容器还没挂上（或还是旧章的）→ 稍后重试
      if (!host) { retry(); return; }
      // 用本章第一个锚点判断"这一章的讲义确实已经渲染出来了"
      if (!host.querySelector(`#${CSS.escape(secs[0].anchor!)}`)) { retry(); return; }

      secs.forEach((sec) => {
        const marker = `lecturePracticeBtn_${sec.path}`;
        if (host.querySelector(`[data-lp-key="${marker}"]`)) return; // 已注入，幂等
        const head = host.querySelector(`#${CSS.escape(sec.anchor!)}`);
        // 锚点可能挂在标题上，也可能是标题前插入的空 span → 统一找到它所在/后随的标题
        const heading = (head?.tagName && /^H[1-6]$/.test(head.tagName)
          ? head
          : head?.nextElementSibling) as HTMLElement | null;
        if (!heading) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.lpKey = marker;
        // 与目录/胶囊同一口径：已掌握/总题数
        const secM = Number(sec.mastered_count) || 0;
        btn.textContent = `去练习 ${secM}/${sec.question_count}`;
        // title 保持「去练习：<小节名>」纯格式：回归脚本按它比对小节名，加后缀会破坏解析
        btn.title = `去练习：${sec.name}`;
        btn.className = 'lp-inline-practice';
        // 用 dataset 传参，避免闭包持有旧 sec 对象
        btn.dataset.lpPath = sec.path;
        btn.dataset.lpName = sec.name;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const p = btn.dataset.lpPath || '';
          const n = btn.dataset.lpName || '';
          const live = current.sections.find((x) => x.path === p) || sec;
          console.log(`[learn] 讲义内「去练习」点击：${n} (${p}) anchor=${live.anchor}`);
          goPractice(p, live);
        });
        heading.appendChild(btn);
      });
    };

    const retry = () => {
      if (disposed || tries >= INJECT_RETRY) return;
      tries++;
      timer = window.setTimeout(run, 150);
    };

    run();

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterDetail?.html, current?.cluster_id, loadingDetail]);

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
      <div ref={sidebarRef} className="w-80 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
        <div className="sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
          <div className="p-3 bg-gradient-to-r from-indigo-500 to-blue-600 text-white">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
                <i className="fas fa-book-open text-lg"></i>
              </div>
              <div className="flex-1">
                <h2 className="font-bold leading-tight">考点精讲</h2>
                {/* 进度 = 章末自测已看/总问数（与分子的记录来源同一口径） */}
                <div className="text-xs text-white/80 flex items-center gap-2">
                  <span>
                    自测已看 <span className="font-bold">{selfTestVisited}</span>/{selfTestTotal}
                  </span>
                  <span className="flex-1 h-1 rounded-full bg-white/25 overflow-hidden min-w-[40px]">
                    <span
                      className="block h-full rounded-full bg-white/80 transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </span>
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
                          data-learn-chapter={ch.cluster_id}
                          onClick={() => { setSelectedChapter(ch.cluster_id); setActiveSectionPath(null); }}
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
                          <span className={`text-[11px] flex-shrink-0 rounded-full px-1.5 tabular-nums ${
                            active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {ch.mastered_count ?? 0}/{ch.question_count}
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
                          <div className="ml-5 mt-1 mb-1 space-y-0.5 border-l border-gray-300 pl-2">
                            {ch.sections.map((sec) => {
                              const sActive = activeSectionPath === sec.path;
                              const noQ = sec.question_count === 0;
                              // 该知识点已全部掌握 → 胶囊转绿，一眼能看出还差哪块
                              const secDone = !noQ && (sec.mastered_count ?? 0) >= sec.question_count;
                              return (
                                <button
                                  key={sec.path}
                                  data-learn-section={sec.path}
                                  onClick={() => {
                                    setActiveSectionPath(sec.path);
                                    setSelectedChapter(ch.cluster_id);
                                    // 讲义渲染是异步的（换章要重新拉 html），所以延迟到 DOM 就绪后再滚动
                                    setTimeout(() => scrollToAnchor(sec.anchor), 160);
                                  }}
                                  title={
                                    noQ
                                      ? `${sec.code ? sec.code + ' ' : ''}${sec.name}（暂无配套练习）`
                                      : `${sec.code ? sec.code + ' ' : ''}${sec.name}（已掌握 ${sec.mastered_count ?? 0}/${sec.question_count} 题）`
                                  }
                                  className={`group w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
                                    sActive
                                      ? 'bg-indigo-50 text-indigo-700'
                                      : noQ
                                      ? 'text-gray-500 hover:bg-gray-100'
                                      : 'text-gray-700 hover:bg-gray-100 hover:text-indigo-700'
                                  }`}
                                >
                                  <i
                                    className={`fas fa-angle-right text-[10px] flex-shrink-0 ${
                                      sActive ? 'text-indigo-500' : 'text-gray-400 group-hover:text-indigo-500'
                                    }`}
                                  ></i>
                                  <span className={`flex-1 text-[13px] leading-snug ${sActive ? 'font-medium' : ''}`}>
                                    {sec.code && (
                                      <span className="mr-1 text-[11px] tabular-nums text-gray-400">{sec.code}</span>
                                    )}
                                    {sec.name}
                                  </span>
                                  <span
                                    className={`text-[10px] flex-shrink-0 rounded-full px-1.5 py-px tabular-nums ${
                                      sActive
                                        ? 'bg-indigo-100 text-indigo-600'
                                        : noQ
                                        ? 'bg-gray-100 text-gray-400'
                                        : secDone
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-gray-100 text-gray-600'
                                    }`}
                                  >
                                    {sec.mastered_count ?? 0}/{sec.question_count}
                                  </span>
                                </button>
                              );
                            })}
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
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
                  <span className="ml-2 inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-xs font-medium">
                    <i className="fas fa-circle-check text-[11px]"></i>
                    已掌握 {current.mastered_count ?? 0} 题
                  </span>
                </p>
              </div>

              {/* 本章知识点（讲义小节导航）
                  ⚠️ 放在「去练习这一章」**之前**、并单独成块放大：
                  以前它挂在那个实心渐变大按钮右侧、12px 浅灰字，学生视线全被按钮吸走，
                  逐个知识点学的入口几乎没人点（用户 2026-10-18 反馈）。 */}
              {current.sections.filter((s) => s.question_count > 0).length > 0 && (
                <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5">
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold text-indigo-800">
                      <i className="fas fa-list-ul mr-1 text-[11px]"></i>
                      本章知识点
                    </span>
                    <span className="text-[11px] text-indigo-500">
                      共 {current.sections.filter((s) => s.question_count > 0).length} 个 · 点一个跳到该小节，并练这一块的题
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {current.sections.filter((s) => s.question_count > 0).map((s, i) => (
                      <button
                        key={s.path}
                        data-section-link={s.path}
                        onClick={() => goPractice(s.path, s)}
                        title={`跳到讲义「${s.code ? s.code + ' ' : ''}${s.name}」小节，并打开该小节的练习（已掌握 ${s.mastered_count ?? 0}/${s.question_count} 题）`}
                        className="group flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-gray-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 hover:shadow"
                      >
                        <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold tabular-nums text-white group-hover:bg-indigo-600">
                          {s.code || i + 1}
                        </span>
                        <span className="leading-none">{s.name}</span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums group-hover:bg-white ${
                            s.question_count > 0 && (s.mastered_count ?? 0) >= s.question_count
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-indigo-50 text-indigo-600'
                          }`}
                        >
                          {s.mastered_count ?? 0}/{s.question_count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                  {selfTest.length > 0
                    ? `章末自测（${selfTestDoneInChapter}/${selfTest.length} 问）`
                    : '章末自测（本章暂未配备）'}
                </button>
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
                  ref={lectureRef}
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

        {/* 回到顶部（悬浮在正文右下角，随滚动出现/隐藏）
            用 sticky 而非 fixed：学习模块是桌面窗口内的应用，fixed 会相对视口定位而跑出窗口。
            sticky + bottom 的容器高度为 0，所以不会占位、也不会把内容顶开。 */}
        <div className="sticky bottom-0 h-0 pointer-events-none">
          <AnimatePresence>
            {showBackTop && (
              <motion.button
                key="back-top"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                onClick={scrollToTop}
                title="回到顶部"
                aria-label="回到顶部"
                className="pointer-events-auto absolute right-6 -top-16 w-11 h-11 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 active:scale-95 flex items-center justify-center transition-colors"
              >
                <i className="fas fa-arrow-up"></i>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default LearnModule;
