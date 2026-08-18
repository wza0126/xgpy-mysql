import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';
import { CHAPTERS, KEYWORDS, RealmChapter, RealmQuestion } from './code-realm/CodeRealmData';

type View = 'intro' | 'map' | 'chapter' | 'boss' | 'book' | 'ending' | 'studio';

interface RealmProgress {
  current_chapter: number;
  current_step: string;
  completed_keywords: string[];
  completed_chapters: number[];
  badges: string[];
  total_xp: number;
  reward_claimed: boolean;
}

interface RewardResult {
  granted: boolean;
  points?: number;
  equipment?: { id: string; name: string; icon: string; crit_bonus: number };
}

const SAVE_KEY = 'code_realm_progress';

const defaultProgress = (): RealmProgress => ({
  current_chapter: 0,
  current_step: 'intro',
  completed_keywords: [],
  completed_chapters: [],
  badges: [],
  total_xp: 0,
  reward_claimed: false,
});

// 彩蛋：示例代码
const STUDIO_EXAMPLES: { title: string; desc: string; code: string }[] = [
  {
    title: '对话魔法',
    desc: 'input 接收输入，print 输出问候',
    code: `name = input("你叫什么名字？")\nprint(f"欢迎你，{name}，代码灵师！")`,
  },
  {
    title: '选择之路',
    desc: 'if / elif / else 与 in 判断',
    code: `if "勇敢" in name:\n    print("你有一颗勇敢的心。")\nelse:\n    print("人人都有成为英雄的潜力。")`,
  },
  {
    title: '循环之舞',
    desc: 'for + range 画金字塔',
    code: `for i in range(5):\n    print("*" * (i + 1))`,
  },
  {
    title: '创造咒语',
    desc: 'def 定义 + return 返回',
    code: `def 祝福(名字):\n    return f"愿{名字}的代码永不报错！"\nprint(祝福(name))`,
  },
];

export const CodeRealm: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const { user } = useAuth();
  const [view, setView] = useState<View>('intro');
  const [progress, setProgress] = useState<RealmProgress>(defaultProgress);
  const [loaded, setLoaded] = useState(false);
  // 场景内状态
  const [chapterIndex, setChapterIndex] = useState(0);      // 0-6
  const [sceneIndex, setSceneIndex] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null); // 选择的选项
  const [feedback, setFeedback] = useState<{ good: boolean; text: string } | null>(null);
  const [gained, setGained] = useState<string[]>([]);        // 本场景新收集
  // Boss 状态
  const [bossQIndex, setBossQIndex] = useState(0);
  const [bossDone, setBossDone] = useState(false);
  // 通用
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reward, setReward] = useState<RewardResult | null>(null);
  const [studioTab, setStudioTab] = useState(0);

  const userId = user?.id || '';

  // ==================== 存档 ====================
  const persistLocal = useCallback((p: RealmProgress) => {
    try {
      localStorage.setItem(`${SAVE_KEY}_${userId}`, JSON.stringify(p));
    } catch { /* ignore */ }
  }, [userId]);

  // 上报后端（scene 完成 / 章节完成 / Boss 完成 / 通关）
  const pushServer = useCallback(async (p: RealmProgress, isCompleted = false) => {
    try {
      await backendClient.post('/api/code-realm/progress', {
        current_chapter: p.current_chapter,
        current_step: isCompleted ? 'completed' : p.current_step,
        completed_keywords: p.completed_keywords,
        completed_chapters: p.completed_chapters,
        badges: p.badges,
        total_xp: p.total_xp,
      });
    } catch { /* 离线可继续，下次再同步 */ }
  }, []);

  const updateProgress = useCallback((patch: Partial<RealmProgress>, opts?: { isCompleted?: boolean }) => {
    setProgress(prev => {
      const next = { ...prev, ...patch };
      persistLocal(next);
      pushServer(next, opts?.isCompleted);
      return next;
    });
  }, [persistLocal, pushServer]);

  // 加载存档
  useEffect(() => {
    if (!userId) { setLoaded(true); return; }
    let local: RealmProgress | null = null;
    try {
      const raw = localStorage.getItem(`${SAVE_KEY}_${userId}`);
      if (raw) local = { ...defaultProgress(), ...JSON.parse(raw) };
    } catch { /* ignore */ }
    if (local) {
      setProgress(local);
      restoreView(local);
      setLoaded(true);
      return;
    }
    backendClient.get('/api/code-realm/progress')
      .then((res: any) => {
        const d = res?.data;
        if (d && d.completed_keywords) {
          const p = { ...defaultProgress(), ...d };
          persistLocal(p);
          setProgress(p);
          restoreView(p);
        }
      })
      .catch(() => { /* 后端不可用时用默认 */ })
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function restoreView(p: RealmProgress) {
    if (p.current_step === 'completed') { setView('ending'); return; }
    if (p.current_step === 'map' || p.current_chapter > 0) {
      setChapterIndex(Math.min(Math.max((p.current_chapter || 1) - 1, 0), CHAPTERS.length - 1));
      setView('map');
    }
  }

  // ==================== 场景推进 ====================
  const chapter: RealmChapter = CHAPTERS[chapterIndex];
  const scene = chapter.scenes[sceneIndex];
  const isBossScene = sceneIndex >= chapter.scenes.length;

  const collectKeywords = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    updateProgress({
      completed_keywords: Array.from(new Set([...progress.completed_keywords, ...ids])),
      total_xp: progress.total_xp + scene.xp,
    });
    setGained(ids);
  };

  const goNextScene = () => {
    setPicked(null);
    setFeedback(null);
    setGained([]);
    setLineIndex(0);
    if (sceneIndex + 1 < chapter.scenes.length) {
      setSceneIndex(sceneIndex + 1);
    } else {
      setView('boss');
      setBossQIndex(0);
      setBossDone(false);
    }
  };

  const handleNextLine = () => {
    if (lineIndex + 1 < scene.lines.length) {
      setLineIndex(lineIndex + 1);
      return;
    }
    if (scene.q) {
      // 进入答题状态：由选项按钮处理
      return;
    }
    // 纯对话场景：收集并前进
    if (scene.keywords && scene.keywords.length > 0) {
      collectKeywords(scene.keywords);
      return;
    }
    goNextScene();
  };

  const handlePick = (idx: number) => {
    if (!scene.q || picked !== null) return;
    const q: RealmQuestion = scene.q;
    if (idx === q.answer) {
      setPicked(idx);
      setFeedback({ good: true, text: q.good });
      collectKeywords(scene.keywords || []);
    } else {
      setPicked(idx);
      setFeedback({ good: false, text: q.bad });
    }
  };

  const retryPick = () => {
    setPicked(null);
    setFeedback(null);
  };

  const confirmScene = () => {
    if (feedback?.good) {
      goNextScene();
    } else {
      retryPick();
    }
  };

  // ==================== Boss 战 ====================
  const bossQ = chapter.boss.questions[bossQIndex];

  const handleBossPick = (idx: number) => {
    if (!bossQ || picked !== null) return;
    if (idx === bossQ.answer) {
      setPicked(idx);
      setFeedback({ good: true, text: bossQ.good });
    } else {
      setPicked(idx);
      setFeedback({ good: false, text: bossQ.bad });
    }
  };

  const confirmBoss = () => {
    if (!feedback) return;
    if (!feedback.good) { setPicked(null); setFeedback(null); return; }
    if (bossQIndex + 1 < chapter.boss.questions.length) {
      setBossQIndex(bossQIndex + 1);
      setPicked(null);
      setFeedback(null);
    } else {
      // Boss 击败
      setBossDone(true);
      const newKeywords = Array.from(new Set([...progress.completed_keywords, ...chapter.boss.keywords]));
      const newChapters = Array.from(new Set([...progress.completed_chapters, chapter.id]));
      const newBadges = Array.from(new Set([...progress.badges, chapter.badge.id]));
      const newXp = progress.total_xp + chapter.boss.xp;
      const isLast = chapter.id === CHAPTERS.length;
      const patch: Partial<RealmProgress> = {
        completed_keywords: newKeywords,
        completed_chapters: newChapters,
        badges: newBadges,
        total_xp: newXp,
        current_chapter: chapter.id,
        current_step: isLast ? 'completed' : 'map',
      };
      updateProgress(patch, { isCompleted: isLast });
      setGained(chapter.boss.keywords);
    }
  };

  const goNextChapter = () => {
    setGained([]);
    setBossDone(false);
    if (chapterIndex + 1 < CHAPTERS.length) {
      const next = chapterIndex + 1;
      setChapterIndex(next);
      setSceneIndex(0);
      setLineIndex(0);
      setPicked(null);
      setFeedback(null);
      updateProgress({ current_chapter: CHAPTERS[next].id, current_step: 'map' });
      setView('map');
    } else {
      setView('ending');
    }
  };

  const startChapter = (idx: number) => {
    if (idx > 0 && !progress.completed_chapters.includes(CHAPTERS[idx - 1].id)) return;
    setChapterIndex(idx);
    setSceneIndex(0);
    setLineIndex(0);
    setPicked(null);
    setFeedback(null);
    setGained([]);
    setView('chapter');
  };

  const startGame = () => {
    if (progress.completed_chapters.length > 0) {
      setView('map');
    } else {
      setChapterIndex(0);
      setSceneIndex(0);
      setLineIndex(0);
      setView('chapter');
    }
  };

  const handleEndingReward = () => {
    // 通关奖励由后端 POST 时自动发放（reward_claimed 防重复），这里读取返回值
    // 直接再查一次进度，拿到 reward 信息
    backendClient.get('/api/code-realm/progress')
      .then((res: any) => {
        const d = res?.data;
        if (d && d.reward_claimed && !progress.reward_claimed) {
          setProgress(prev => ({ ...prev, reward_claimed: true }));
          setReward({ granted: true, points: undefined });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (view === 'ending') handleEndingReward();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0B1026] text-indigo-200">
        <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>正在唤醒真理之书...
      </div>
    );
  }

  const collectedCount = progress.completed_keywords.length;
  const allBadges = progress.badges;

  // ==================== 渲染 ====================
  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-[#0B1026] via-[#141B3D] to-[#1A1035] text-gray-100 overflow-hidden relative">
      {/* 星空装饰 */}
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,.7) 0, transparent 100%), radial-gradient(1px 1px at 70% 15%, rgba(255,255,255,.6) 0, transparent 100%), radial-gradient(1.5px 1.5px at 45% 65%, rgba(232,199,102,.7) 0, transparent 100%), radial-gradient(1px 1px at 85% 50%, rgba(255,255,255,.5) 0, transparent 100%)' }}></div>

      {/* 顶栏 */}
      <div className="shrink-0 px-4 py-2 flex items-center gap-3 border-b border-indigo-500/20 bg-black/20 backdrop-blur relative z-10">
        <span className="text-xl">📜</span>
        <span className="font-bold text-amber-300 tracking-widest">代码秘境</span>
        <div className="ml-2 text-xs text-indigo-300">
          图鉴 <b className="text-amber-300">{collectedCount}/36</b>
        </div>
        <div className="text-xs text-indigo-300">
          经验 <b className="text-emerald-300">{progress.total_xp}</b>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setView('book')}
            className="px-2.5 py-1 rounded-lg text-xs bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 transition-colors"
          >
            <i className="fa-solid fa-book-open mr-1"></i>图鉴
          </button>
          {view !== 'map' && view !== 'intro' && (
            <button
              onClick={() => setView('map')}
              className="px-2.5 py-1 rounded-lg text-xs bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 transition-colors"
            >
              <i className="fa-solid fa-map mr-1"></i>秘境地图
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-gray-300 transition-colors"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto relative z-10">
        {view === 'intro' && (
          <div className="h-full flex flex-col items-center justify-center px-6 py-10">
            <div className="text-6xl mb-6 animate-pulse">🔮</div>
            <h1 className="text-3xl font-black text-amber-300 mb-4 tracking-wider text-center">代码秘境</h1>
            <div className="max-w-xl text-center space-y-3 text-indigo-200 leading-relaxed">
              <p>在代码大陆的黄金时代，35 个 Python 关键字如同星辰般守护着世界的平衡。</p>
              <p>但「Bug 魔王」从深渊中觉醒，将关键字封印成碎片，散落在大陆七大秘境中。程序崩溃，逻辑混乱。</p>
              <p>你，一位年轻的代码学徒，将踏上征途——找回所有关键字，重写「真理之书」，拯救这个世界。</p>
            </div>
            <button
              onClick={startGame}
              className="mt-8 px-8 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold shadow-lg shadow-violet-900/50 transition-all"
            >
              <i className="fa-solid fa-wand-magic-sparkles mr-2"></i>
              {progress.completed_chapters.length > 0 ? '继续征途' : '开始冒险'}
            </button>
            {progress.completed_chapters.length > 0 && (
              <p className="mt-3 text-xs text-indigo-400">进度已自动保存，可随时退出继续</p>
            )}
          </div>
        )}

        {view === 'map' && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-amber-300"><i className="fa-solid fa-map mr-2"></i>秘境地图</h2>
              <div className="text-xs text-indigo-300">
                已通关 <b className="text-emerald-300">{progress.completed_chapters.length}/7</b>
                {' '}· 称号 <b className="text-amber-300">{allBadges.length}/7</b>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {CHAPTERS.map((ch, idx) => {
                const done = progress.completed_chapters.includes(ch.id);
                const unlocked = idx === 0 || progress.completed_chapters.includes(CHAPTERS[idx - 1].id);
                const chapterKws = KEYWORDS.filter(k => k.chapter === ch.id);
                const collected = chapterKws.filter(k => progress.completed_keywords.includes(k.id)).length;
                return (
                  <button
                    key={ch.id}
                    disabled={!unlocked}
                    onClick={() => startChapter(idx)}
                    className={`text-left rounded-xl p-4 border transition-all ${done ? 'border-emerald-500/50 bg-emerald-900/20' : unlocked ? 'border-violet-500/40 bg-indigo-900/30 hover:border-violet-400 hover:bg-indigo-800/40' : 'border-gray-700/50 bg-black/20 opacity-50 cursor-not-allowed'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{ch.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-100 truncate">{ch.title}</div>
                        <div className="text-xs text-indigo-300">{ch.subtitle}</div>
                      </div>
                      {done && <span className="text-emerald-400 text-lg"><i className="fa-solid fa-circle-check"></i></span>}
                      {!done && unlocked && <span className="text-amber-400"><i className="fa-solid fa-lock-open"></i></span>}
                      {!unlocked && <span className="text-gray-500"><i className="fa-solid fa-lock"></i></span>}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-amber-400" style={{ width: `${chapterKws.length ? (collected / chapterKws.length) * 100 : 0}%` }}></div>
                      </div>
                      <span className="text-xs text-indigo-300">{collected}/{chapterKws.length}</span>
                    </div>
                    <div className="mt-1 text-xs text-indigo-400">
                      Boss：{ch.boss.icon} {ch.boss.name}
                      {allBadges.includes(ch.badge.id) && <span className="ml-2 text-amber-300">🏅 {ch.badge.name}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {view === 'chapter' && (
          <div className="h-full flex flex-col px-5 py-4">
            <div className="shrink-0 flex items-center justify-between mb-3">
              <span className="text-xs text-indigo-300">{chapter.title} · 场景 {sceneIndex + 1}/{chapter.scenes.length}</span>
              <div className="flex-1 mx-3 h-1 rounded-full bg-white/10 max-w-xs">
                <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-amber-400" style={{ width: `${((sceneIndex + (scene.q && picked !== null ? 0.5 : 0)) / chapter.scenes.length) * 100}%` }}></div>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
              <div className="w-full max-w-2xl">
                {/* NPC 对话 */}
                <div className="flex gap-3 items-start">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600/60 to-indigo-700/60 flex items-center justify-center text-2xl shrink-0 border border-violet-400/40 shadow-lg shadow-violet-900/40">
                    {scene.npcIcon}
                  </div>
                  <div className="flex-1 rounded-xl border border-indigo-400/30 bg-indigo-950/60 backdrop-blur px-4 py-3 shadow-lg">
                    <div className="text-xs text-amber-300 font-bold mb-1">{scene.npcName}</div>
                    <div className="text-sm leading-relaxed text-gray-100 whitespace-pre-line">{scene.lines[lineIndex]}</div>
                    {(lineIndex + 1 < scene.lines.length || !scene.q) && (
                      <button onClick={handleNextLine} className="mt-3 text-xs text-indigo-300 hover:text-amber-300 transition-colors">
                        {lineIndex + 1 < scene.lines.length ? '继续' : '下一步'} <i className="fa-solid fa-chevron-right ml-1"></i>
                      </button>
                    )}
                  </div>
                </div>

                {/* 进入答题 */}
                {scene.q && lineIndex + 1 >= scene.lines.length && picked === null && (
                  <div className="mt-4 rounded-xl border border-amber-400/40 bg-black/30 px-4 py-3">
                    <div className="text-xs text-amber-300 font-bold mb-2"><i className="fa-solid fa-bolt mr-1"></i>咒语试炼</div>
                    <div className="text-sm text-gray-100 whitespace-pre-line mb-3">{scene.q.prompt}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {scene.q.options.map((opt, i) => (
                        <button
                          key={i}
                          onClick={() => handlePick(i)}
                          className={`px-3 py-2.5 rounded-lg text-sm text-left border transition-all ${picked === i ? (feedback?.good ? 'border-emerald-400 bg-emerald-900/40 text-emerald-100' : 'border-red-400 bg-red-900/30 text-red-100') : 'border-indigo-400/30 bg-indigo-900/40 hover:border-amber-400/60'}`}
                        >
                          <span className="text-amber-300 font-mono mr-2">{String.fromCharCode(65 + i)}.</span>
                          <span className="font-mono">{opt}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 反馈 */}
                {feedback && (
                  <div className={`mt-4 rounded-xl border px-4 py-3 ${feedback.good ? 'border-emerald-400/50 bg-emerald-900/30' : 'border-red-400/50 bg-red-900/30'}`}>
                    <div className="text-sm text-gray-100 leading-relaxed">{feedback.text}</div>
                    {gained.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {gained.map(g => (
                          <span key={g} className="px-2 py-0.5 rounded-full text-xs bg-amber-400/20 text-amber-300 border border-amber-400/40">
                            ✨ 获得 {KEYWORDS.find(k => k.id === g)?.name || g}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={confirmScene}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${feedback.good ? 'bg-emerald-500 hover:bg-emerald-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}
                      >
                        {feedback.good ? '继续前进' : '再试一次'}
                      </button>
                      {feedback.good && <span className="text-xs text-emerald-300">+{scene.xp} 经验</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {view === 'boss' && (
          <div className="h-full flex flex-col px-5 py-4">
            {!bossDone ? (
              <>
                <div className="shrink-0 text-center mb-3">
                  <span className="text-xs text-red-300"><i className="fa-solid fa-skull mr-1"></i>{chapter.title} · Boss 战</span>
                  <div className="flex items-center justify-center gap-2 mt-1">
                    {chapter.boss.questions.map((_, i) => (
                      <span key={i} className={`w-2.5 h-2.5 rounded-full ${i < bossQIndex ? 'bg-emerald-400' : i === bossQIndex ? 'bg-red-400 animate-pulse' : 'bg-white/20'}`}></span>
                    ))}
                  </div>
                </div>
                <div className="flex-1 min-h-0 flex items-center justify-center">
                  <div className="w-full max-w-2xl">
                    <div className="text-center mb-4">
                      <div className="text-6xl mb-2 drop-shadow-[0_0_18px_rgba(239,68,68,.6)]">{chapter.boss.icon}</div>
                      <div className="text-xl font-black text-red-300">{chapter.boss.name}</div>
                    </div>
                    {bossQIndex === 0 && picked === null && (
                      <div className="text-center text-sm text-red-200/80 mb-3 italic px-6">{chapter.boss.intro}</div>
                    )}
                    {bossQ && (
                      <div className="rounded-xl border border-red-400/40 bg-black/40 px-4 py-4">
                        <div className="text-xs text-red-300 font-bold mb-2"><i className="fa-solid fa-bolt mr-1"></i>第 {bossQIndex + 1} 问 · 答对才能削弱魔王</div>
                        <div className="text-sm text-gray-100 whitespace-pre-line mb-3">{bossQ.prompt}</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {bossQ.options.map((opt, i) => (
                            <button
                              key={i}
                              onClick={() => handleBossPick(i)}
                              disabled={picked !== null}
                              className={`px-3 py-2.5 rounded-lg text-sm text-left border transition-all ${picked === i ? (feedback?.good ? 'border-emerald-400 bg-emerald-900/40' : 'border-red-400 bg-red-900/40') : 'border-red-400/30 bg-red-950/40 hover:border-red-300/60'}`}
                            >
                              <span className="text-red-300 font-mono mr-2">{String.fromCharCode(65 + i)}.</span>
                              <span className="font-mono">{opt}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {feedback && (
                      <div className={`mt-3 rounded-xl border px-4 py-3 ${feedback.good ? 'border-emerald-400/50 bg-emerald-900/30' : 'border-red-400/50 bg-red-900/30'}`}>
                        <div className="text-sm text-gray-100">{feedback.text}</div>
                        <button onClick={confirmBoss} className="mt-2 px-4 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-gray-100 transition-colors">
                          {feedback.good ? '继续攻击' : '重新念咒'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="text-6xl mb-3">🏆</div>
                <h2 className="text-2xl font-black text-amber-300 mb-2">击败 {chapter.boss.name}！</h2>
                <p className="text-sm text-indigo-200 mb-4">「{chapter.title}」已通关，获得称号 🏅 {chapter.badge.name}</p>
                <div className="flex flex-wrap gap-1.5 justify-center mb-5 max-w-md">
                  {gained.map(g => (
                    <span key={g} className="px-2 py-0.5 rounded-full text-xs bg-amber-400/20 text-amber-300 border border-amber-400/40">
                      ✨ 获得 {KEYWORDS.find(k => k.id === g)?.name || g}
                    </span>
                  ))}
                </div>
                <button
                  onClick={goNextChapter}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold shadow-lg shadow-amber-900/40 transition-all"
                >
                  {chapterIndex + 1 < CHAPTERS.length ? '前往下一秘境' : '翻开真理之书'}
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'book' && (
          <div className="p-5">
            <h2 className="text-xl font-bold text-amber-300 mb-1"><i className="fa-solid fa-book-open mr-2"></i>真理之书 · 图鉴</h2>
            <p className="text-xs text-indigo-400 mb-4">收集 {collectedCount}/36 项学测考点</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {KEYWORDS.map(k => {
                const have = progress.completed_keywords.includes(k.id);
                return (
                  <div key={k.id} className={`rounded-xl border p-3.5 transition-all ${have ? 'border-amber-400/40 bg-indigo-900/30' : 'border-gray-700/50 bg-black/20 opacity-60'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-bold text-sm ${have ? 'text-amber-300' : 'text-gray-500'}`}>{k.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${k.type === 'keyword' ? 'bg-violet-500/30 text-violet-200' : 'bg-sky-500/30 text-sky-200'}`}>
                        {k.type === 'keyword' ? '关键字' : '内置'}
                      </span>
                      {have && <span className="ml-auto text-emerald-400"><i className="fa-solid fa-circle-check"></i></span>}
                      {!have && <span className="ml-auto text-gray-600"><i className="fa-solid fa-circle-question"></i></span>}
                    </div>
                    {have && (
                      <>
                        <p className="text-xs text-indigo-200 mt-2 leading-relaxed">{k.desc}</p>
                        <pre className="mt-2 rounded-lg bg-black/40 px-3 py-2 text-[11px] text-emerald-300 font-mono overflow-x-auto">{k.example}</pre>
                      </>
                    )}
                    {!have && <p className="text-xs text-gray-600 mt-2">第 {k.chapter} 章 · 尚未寻获</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === 'ending' && (
          <div className="h-full flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="text-6xl mb-4 animate-pulse">📖</div>
            <h1 className="text-3xl font-black text-amber-300 mb-3">真理之书已重写</h1>
            <p className="max-w-lg text-sm text-indigo-200 leading-relaxed mb-2">
              36 个关键字如同星辰归位，代码大陆恢复了平衡。你已从一个学徒，成长为真正的代码灵师。
            </p>
            <p className="text-xs text-indigo-400 mb-5">全部 {progress.completed_keywords.length}/36 项图鉴 · {allBadges.length} 枚称号 · 总经验 {progress.total_xp}</p>
            {(progress.reward_claimed || reward?.granted) && (
              <div className="mb-5 rounded-xl border border-amber-400/50 bg-amber-900/20 px-5 py-3 text-sm text-amber-200">
                <i className="fa-solid fa-gift mr-2"></i>通关奖励已发放至你的账户！
              </div>
            )}
            <div className="flex gap-3 flex-wrap justify-center">
              <button onClick={() => setView('studio')} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-bold transition-all">
                <i className="fa-solid fa-wand-magic-sparkles mr-1"></i>创作工坊
              </button>
              <button onClick={() => setView('book')} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-100 text-sm font-bold transition-all">
                <i className="fa-solid fa-book-open mr-1"></i>翻阅图鉴
              </button>
              {onClose && (
                <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-100 text-sm font-bold transition-all">
                  返回桌面
                </button>
              )}
            </div>
          </div>
        )}

        {view === 'studio' && (
          <div className="p-5">
            <h2 className="text-xl font-bold text-amber-300 mb-1"><i className="fa-solid fa-wand-magic-sparkles mr-2"></i>创作工坊</h2>
            <p className="text-xs text-indigo-400 mb-4">你已掌握全部关键字。看看这些咒语如何组合，用它们书写你自己的故事。</p>
            <div className="flex gap-2 mb-4 flex-wrap">
              {STUDIO_EXAMPLES.map((e, i) => (
                <button
                  key={i}
                  onClick={() => setStudioTab(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${studioTab === i ? 'bg-amber-500 text-white' : 'bg-indigo-900/50 text-indigo-200 hover:bg-indigo-800/60'}`}
                >
                  {e.title}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-indigo-400/30 bg-black/40 overflow-hidden max-w-2xl">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-indigo-400/20 bg-indigo-950/60">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80"></span>
                <span className="ml-2 text-xs text-indigo-300 font-mono">咒语簿 · {STUDIO_EXAMPLES[studioTab].title}</span>
              </div>
              <div className="px-4 py-3 text-xs text-indigo-200">{STUDIO_EXAMPLES[studioTab].desc}</div>
              <pre className="px-4 py-4 text-[13px] leading-relaxed text-emerald-300 font-mono overflow-x-auto whitespace-pre">{STUDIO_EXAMPLES[studioTab].code}</pre>
            </div>
          </div>
        )}
      </div>

      {/* 提示/错误 */}
      {(notice || error) && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg text-xs shadow-xl">
          {notice && <div className="bg-emerald-900/90 text-emerald-100 border border-emerald-500/50 px-3 py-1.5 rounded-lg">{notice}</div>}
          {error && <div className="bg-red-900/90 text-red-100 border border-red-500/50 px-3 py-1.5 rounded-lg">{error}</div>}
        </div>
      )}
    </div>
  );
};
