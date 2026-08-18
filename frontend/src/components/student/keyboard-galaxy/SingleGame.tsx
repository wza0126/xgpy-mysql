import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { backendClient } from '../../../api/backendClient';
import { Keyboard3D } from './Keyboard3D';
import { GALAXY_WORDS, GalaxyWord } from './KeyboardData';

// ==================== 特效与样式 ====================
const FX_STYLES = `
@keyframes galaxyFallShoot {
  0% { transform: translate(0,0) scale(1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
}
@keyframes galaxyBoom {
  0% { opacity: 0; }
  15% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes galaxyPart {
  0% { transform: translate(0,0) scale(1); opacity: 1; }
  100% { transform: translate(var(--px), var(--py)) scale(.2); opacity: 0; }
}
@keyframes galaxyTargetPulse {
  0%,100% { transform: scale(1); box-shadow: 0 0 14px rgba(255,100,100,.55); }
  50% { transform: scale(1.05); box-shadow: 0 0 22px rgba(255,120,120,.9); }
}
@keyframes galaxyLaser {
  0% { opacity: 0; }
  15% { opacity: 1; }
  100% { opacity: 0; }
}
.galaxy-laser {
  position: absolute; top: 0; left: 50%; width: 3px; transform: translateX(-50%);
  background: linear-gradient(180deg, rgba(126,240,255,.9), rgba(126,240,255,0));
  animation: galaxyLaser .4s ease-out forwards;
}
`;

interface FallingWord {
  id: number;
  word: GalaxyWord;
  x: number;        // 0-100 (%)
  y: number;        // px（相对游戏区顶部）
  speed: number;    // px/s
  typedLen: number; // 已输入长度
}

interface FX {
  id: number;
  kind: 'bullet' | 'boom';
  x: number;
  y: number;
  targetY?: number; // bullet 命中点（单词位置）
}

type Difficulty = 'easy' | 'standard' | 'extreme';

const DIFF_SETTINGS: Record<Difficulty, { speed: number; interval: number; label: string }> = {
  easy: { speed: 55, interval: 2300, label: '轻松' },
  standard: { speed: 85, interval: 1800, label: '标准' },
  extreme: { speed: 115, interval: 1400, label: '极限' },
};

const WORDS_PER_CHAPTER = 15;
const MAX_HP = 3;
const FIELD_H_FALLBACK = 400; // 尚未测量出真实高度时的兜底值
const WORD_H = 46;            // 词块近似高度（主行+中文行+内边距），用于完整可见/漏底判定
const SPAWN_Y = -80;          // 生成位置：完全在视口上方，给词块更多下落时间
const LESSON_SAVE_KEY = 'keyboard_galaxy_lesson'; // 与指法学堂共用章节完成记录

let wordSeq: GalaxyWord[] = [];

export const SingleGame: React.FC = () => {
  const { user } = useAuth();
  const [screen, setScreen] = useState<'menu' | 'playing' | 'over'>('menu');
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [lessonsDone, setLessonsDone] = useState(false);
  const [minWpm, setMinWpm] = useState(0);
  const [singleRewardWpm, setSingleRewardWpm] = useState(0); // 单人达标速度（WPM）
  const [rewardMsg, setRewardMsg] = useState<string | null>(null);
  const [reported, setReported] = useState(false); // 本局成绩是否已上报（防重复发放奖励）
  const reportedRef = useRef(false); // 同步防重锁：双击同一帧内也只会上报一次
  const [words, setWords] = useState<FallingWord[]>([]);
  const [fx, setFx] = useState<FX[]>([]);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [hp, setHp] = useState(MAX_HP);
  const [chapter, setChapter] = useState(1);
  const [killedInChapter, setKilledInChapter] = useState(0);
  const [correctKeys, setCorrectKeys] = useState(0);
  const [wrongKeys, setWrongKeys] = useState(0);
  const [startAt, setStartAt] = useState<number>(0);

  const idRef = useRef(1);
  const fxIdRef = useRef(1);
  const fieldRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<FallingWord | null>(null);
  const seqIdxRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // 物理计算用的镜像 ref：避免在 setState updater 里做副作用（StrictMode 下会被双调用）
  const wordsRef = useRef<FallingWord[]>([]);
  const hpRef = useRef(MAX_HP);
  const fieldHRef = useRef(FIELD_H_FALLBACK);

  // 指法学堂 4 章全部完成才解锁单人游戏
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${LESSON_SAVE_KEY}_${user?.id || 'guest'}`);
      const done: number[] = raw ? JSON.parse(raw) : [];
      setLessonsDone(Array.isArray(done) && done.length >= 4 && [1, 2, 3, 4].every(id => done.includes(id)));
    } catch {
      setLessonsDone(false);
    }
    backendClient.get('/api/typing/config')
      .then(res => {
        const d = res?.data;
        if (d) {
          setMinWpm(parseInt(d.duel_min_wpm) || 0);
          setSingleRewardWpm(parseInt(d.single_reward?.wpm) || 0);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  const startGame = (d: Difficulty) => {
    setDifficulty(d);
    wordSeq = [...GALAXY_WORDS];
    // 洗牌
    for (let i = wordSeq.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wordSeq[i], wordSeq[j]] = [wordSeq[j], wordSeq[i]];
    }
    seqIdxRef.current = 0;
    idRef.current = 1;
    fxIdRef.current = 1;
    lastSpawnRef.current = 0;
    wordsRef.current = [];
    hpRef.current = MAX_HP;
    setWords([]);
    setFx([]);
    setTargetId(null);
    targetRef.current = null;
    setScore(0);
    setCombo(0);
    setHp(MAX_HP);
    setChapter(1);
    setKilledInChapter(0);
    setCorrectKeys(0);
    setWrongKeys(0);
    setStartAt(Date.now());
    reportedRef.current = false; // 新一局可重新上报
    setReported(false);
    setRewardMsg(null);
    setScreen('playing');
  };

  const currentSpeed = () => {
    const base = DIFF_SETTINGS[difficulty].speed;
    return Math.round(base * (1 + 0.25 * (chapter - 1)));
  };
  const currentInterval = () => {
    const base = DIFF_SETTINGS[difficulty].interval;
    return Math.round(base * (1 - 0.1 * (chapter - 1)));
  };

  // 监听游戏区实际高度（窗口可自由缩放，下落/漏底判定都基于真实高度）
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const update = () => { fieldHRef.current = el.clientHeight; };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // 主循环：纯计算 + 一次 setWords，副作用直接放在 tick 回调里
  useEffect(() => {
    if (screen !== 'playing') return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const fieldH = Math.max(fieldHRef.current, 120);

      // 生成新词
      if (now - lastSpawnRef.current >= currentInterval()) {
        lastSpawnRef.current = now;
        const w = wordSeq[seqIdxRef.current % wordSeq.length];
        seqIdxRef.current += 1;
        wordsRef.current = [
          ...wordsRef.current,
          { id: idRef.current++, word: w, x: 8 + Math.random() * 72, y: SPAWN_Y, speed: currentSpeed(), typedLen: 0 },
        ];
      }

      // 下落 & 漏底判定（词块底部越过底线才算漏掉）
      let lost = false;
      const next: FallingWord[] = [];
      for (const w of wordsRef.current) {
        const nw = { ...w, y: w.y + w.speed * dt };
        if (nw.y >= fieldH - WORD_H) { lost = true; continue; }
        next.push(nw);
      }
      wordsRef.current = next;
      setWords(next);

      if (lost) {
        setCombo(0);
        const nh = hpRef.current - 1;
        hpRef.current = nh > 0 ? nh : 0;
        setHp(hpRef.current);
        if (nh <= 0) setScreen('over');
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, chapter, difficulty]);

  // 目标词 = 已完整进入视口（y >= 0，不会出现半个词块变红的情况）且最接近底部的词
  useEffect(() => {
    const visible = words.filter(w => w.y >= 0);
    if (visible.length === 0) { setTargetId(null); targetRef.current = null; return; }
    const target = visible.reduce((a, b) => (a.y > b.y ? a : b));
    setTargetId(target.id);
    targetRef.current = target;
  }, [words]);

  // 击落
  const killWord = useCallback((fw: FallingWord) => {
    wordsRef.current = wordsRef.current.filter(w => w.id !== fw.id);
    setWords(wordsRef.current);
    // 子弹从游戏区底部发射，向上飞向单词，命中后爆炸
    const bottomY = Math.max((fieldHRef.current || FIELD_H_FALLBACK) - 10, 0);
    setFx(prev => [
      ...prev,
      { id: fxIdRef.current++, kind: 'bullet', x: fw.x, y: bottomY, targetY: fw.y },
      { id: fxIdRef.current++, kind: 'boom', x: fw.x, y: fw.y },
    ]);
    setScore(s => s + 10);
    setCombo(c => c + 1);
    setCorrectKeys(c => c + fw.word.text.length);
    const kc = killedInChapter + 1;
    setKilledInChapter(kc);
    if (kc >= WORDS_PER_CHAPTER) {
      if (chapter >= 5) {
        setScreen('over');
      } else {
        setChapter(ch => ch + 1);
        setKilledInChapter(0);
      }
    }
  }, [killedInChapter, chapter]);

  // 输入监听
  useEffect(() => {
    if (screen !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      if (!/^[a-zA-Z0-9;',.\/\[\]=\-]$/.test(e.key)) return;
      const t = targetRef.current;
      if (!t) return;
      const ch = e.key;
      const target = t.word.text[t.typedLen];
      if (ch === target) {
        const nt = t.typedLen + 1;
        wordsRef.current = wordsRef.current.map(w => (w.id === t.id ? { ...w, typedLen: nt } : w));
        if (nt >= t.word.text.length) {
          // 完整打出 → 击落
          killWord({ ...t, typedLen: nt });
        } else {
          setWords(wordsRef.current);
        }
      } else {
        setWrongKeys(w => w + 1);
        setCombo(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, killWord]);

  // 特效清理（fx 为空时不再触发，避免 setFx([]) 反复生成新引用造成无限循环）
  useEffect(() => {
    if (fx.length === 0) return;
    const t = setTimeout(() => setFx([]), 1200);
    return () => clearTimeout(t);
  }, [fx]);

  const stats = useMemo(() => {
    const sec = Math.max((Date.now() - startAt) / 1000, 1);
    const wpm = Math.round(correctKeys / 5 / (sec / 60));
    const acc = correctKeys + wrongKeys > 0 ? Math.round((correctKeys / (correctKeys + wrongKeys)) * 100) : 100;
    return { wpm, acc };
  }, [correctKeys, wrongKeys, startAt]);

  const reportScore = async () => {
    if (reportedRef.current) return; // 同步防重：避免双击/连点导致达标奖励重复发放
    reportedRef.current = true;
    setReported(true);
    try {
      const res = await backendClient.post('/api/typing/scores', {
        score, wpm: stats.wpm, accuracy: stats.acc, words: Math.round(score / 10), chapter,
      });
      const rw = res?.data?.reward;
      if (rw && rw.points > 0) {
        setRewardMsg(`🎉 达标奖励：+${rw.points} 积分，获得「运指如飞」荣誉与暴击 Buff！`);
      } else {
        setRewardMsg(`✅ 成绩已上榜（速度 ${stats.wpm} WPM）`);
      }
    } catch { /* ignore */ }
  };

  // ==================== 渲染 ====================
  if (!lessonsDone) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 py-10 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-black text-amber-300 mb-2">单人游戏未解锁</h2>
        <p className="max-w-md text-sm text-indigo-200 leading-relaxed mb-6">
          请先前往「指法学堂」完成全部 4 章练习{minWpm > 0 ? `（每章速度需达到 ${minWpm} WPM 才算完成）` : ''}，全部完成后即可解锁单人游戏！
        </p>
        <div className="text-xs text-indigo-400">完成 4 章后刷新本页即可开始</div>
      </div>
    );
  }

  if (screen === 'menu') {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 py-10">
        <div className="text-6xl mb-5 animate-pulse">🚀</div>
        <h2 className="text-2xl font-black text-amber-300 mb-2">星际打字员</h2>
        <p className="max-w-md text-center text-sm text-indigo-200 leading-relaxed mb-6">
          36 个 Python 考点单词从天而降，打出完整单词发射子弹击落它！5 关难度逐级提升，击落 +10 分，漏底 -1❤，3 滴血用完即止。
        </p>
        <div className="flex gap-3 mb-6">
          {(Object.keys(DIFF_SETTINGS) as Difficulty[]).map(d => (
            <button
              key={d}
              onClick={() => startGame(d)}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
                d === 'easy' ? 'bg-emerald-600 hover:bg-emerald-500'
                : d === 'standard' ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500'
                : 'bg-red-600 hover:bg-red-500'
              } text-white shadow-lg`}
            >
              {DIFF_SETTINGS[d].label}
            </button>
          ))}
        </div>
        {singleRewardWpm > 0 && <p className="text-xs text-indigo-400">打字速度达到 {singleRewardWpm} WPM 奖励积分和荣誉</p>}
      </div>
    );
  }

  if (screen === 'over') {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 py-10 text-center">
        <div className="text-5xl mb-4">{hp > 0 ? '🏆' : '💫'}</div>
        <h2 className="text-2xl font-black text-amber-300 mb-1">{hp > 0 ? '通关星域！' : '挑战结束'}</h2>
        <div className="grid grid-cols-4 gap-3 my-6">
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/50 px-4 py-3">
            <div className="text-[10px] text-indigo-300">得分</div>
            <div className="text-xl font-black text-amber-300">{score}</div>
          </div>
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/50 px-4 py-3">
            <div className="text-[10px] text-indigo-300">速度</div>
            <div className="text-xl font-black text-emerald-300">{stats.wpm} WPM</div>
          </div>
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/50 px-4 py-3">
            <div className="text-[10px] text-indigo-300">正确率</div>
            <div className="text-xl font-black text-emerald-300">{stats.acc}%</div>
          </div>
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/50 px-4 py-3">
            <div className="text-[10px] text-indigo-300">达成关</div>
            <div className="text-xl font-black text-sky-300">{Math.min(chapter, 5)}</div>
          </div>
        </div>
        {user && (
          <button
            onClick={reportScore}
            disabled={reported}
            className={`mb-3 px-5 py-2.5 rounded-xl text-white text-sm font-bold transition-all ${
              reported
                ? 'bg-white/10 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400'
            }`}
          >
            <i className="fa-solid fa-trophy mr-1"></i>{reported ? '已上报成绩' : '上报成绩'}
          </button>
        )}
        {rewardMsg && <p className="mb-3 text-sm text-emerald-300 font-bold">{rewardMsg}</p>}
        <div className="flex gap-3">
          <button onClick={() => startGame(difficulty)} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-bold transition-all">
            <i className="fa-solid fa-rotate-right mr-1"></i>再来一局
          </button>
          <button onClick={() => setScreen('menu')} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-100 text-sm font-bold transition-all">
            返回选择
          </button>
        </div>
      </div>
    );
  }

  const target = targetRef.current;

  return (
    <div className="h-full flex flex-col px-5 py-4">
      <style>{FX_STYLES}</style>
      {/* HUD */}
      <div className="shrink-0 grid grid-cols-6 gap-2 mb-3">
        {[
          { k: '打字速度', v: `${stats.wpm} WPM`, c: 'text-amber-300' },
          { k: '正确率', v: `${stats.acc}%`, c: 'text-emerald-300' },
          { k: '得分', v: String(score), c: 'text-sky-300' },
          { k: '连击', v: combo > 1 ? `×${combo} 🔥` : '-', c: 'text-pink-300' },
          { k: '生命', v: '❤'.repeat(Math.max(hp, 0)) + '🖤'.repeat(Math.max(MAX_HP - Math.max(hp, 0), 0)), c: 'text-red-300' },
          { k: '关卡', v: `${chapter}/5`, c: 'text-violet-300' },
        ].map(s => (
          <div key={s.k} className="rounded-lg border border-indigo-400/25 bg-indigo-950/50 px-2 py-1.5 text-center">
            <div className="text-[9px] text-indigo-300">{s.k}</div>
            <div className={`text-sm font-black ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* 游戏区 */}
      <div className="shrink-0 mb-2 text-center text-xs text-indigo-300">
        {killedInChapter}/{WORDS_PER_CHAPTER} 词 · 本关速度 {currentSpeed()}px/s · 单词完整出现后变红，完整打出即击落
      </div>
      <div
        ref={fieldRef}
        className="flex-1 min-h-0 relative rounded-xl border border-indigo-400/20 overflow-hidden"
        style={{ background: 'linear-gradient(180deg, rgba(20,28,70,.5), rgba(10,14,36,.8))' }}
      >
        {/* 词块 */}
        {words.map(w => {
          const isTarget = w.id === targetId;
          return (
            <div
              key={w.id}
              className="absolute"
              style={{ left: `${w.x}%`, top: w.y, transform: 'translateX(-50%)' }}
            >
              <div
                className={`rounded-lg border px-3 py-2 text-center ${isTarget ? 'galaxy-target' : ''}`}
                style={{
                  background: isTarget
                    ? 'linear-gradient(180deg, rgba(207,72,72,.95), rgba(150,40,50,.95))'
                    : 'linear-gradient(180deg, rgba(56,89,199,.85), rgba(37,58,140,.9))',
                  borderColor: isTarget ? '#ff8a8a' : '#6d86ff',
                  boxShadow: isTarget ? '0 0 18px rgba(255,100,100,.7)' : '0 0 12px rgba(109,134,255,.5)',
                }}
              >
                <div className="font-mono font-bold text-xl text-white tracking-wide">
                  {w.word.text.slice(0, w.typedLen)}
                  <span className="text-white/70">{w.word.text.slice(w.typedLen)}</span>
                </div>
                <div className="text-xs text-indigo-200 truncate max-w-[160px]">{w.word.zh}</div>
              </div>
            </div>
          );
        })}

        {/* 特效 */}
        {fx.map(f => (
          <div key={f.id} className="absolute pointer-events-none" style={{ left: `${f.x}%`, top: f.y }}>
            {f.kind === 'bullet' && (
              <div style={{ position: 'relative' }}>
                {/* 弹道光柱：从发射点延伸到命中点 */}
                <div className="galaxy-laser" style={{ height: Math.max((f.y - (f.targetY ?? f.y)), 0) }} />
                {/* 子弹头：向上飞向单词 */}
                <div
                  style={{
                    position: 'absolute', left: 0, top: 0,
                    width: 7, height: 7, borderRadius: '50%', background: '#aef4ff',
                    boxShadow: '0 0 12px 4px rgba(126,240,255,.95), 0 0 26px 10px rgba(126,240,255,.45)',
                    animation: 'galaxyFallShoot .45s ease-out forwards',
                    ['--dx' as any]: '0px',
                    ['--dy' as any]: `${((f.targetY ?? f.y) - f.y) * 0.9}px`,
                  }}
                />
              </div>
            )}
            {f.kind === 'boom' && (
              <div style={{ position: 'relative', animation: 'galaxyBoom .7s ease-out forwards' }}>
                {[[-24, -22], [24, -22], [-30, 2], [30, 2], [-14, -34], [14, -34]].map(([px, py], i) => (
                  <span
                    key={i}
                    style={{
                      position: 'absolute', width: 5, height: 5, borderRadius: '50%', background: '#ffe08a',
                      boxShadow: '0 0 8px 2px rgba(255,224,138,.9)',
                      animation: 'galaxyPart .7s ease-out forwards',
                      ['--px' as any]: `${px}px`, ['--py' as any]: `${py}px`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* 底部警戒线 */}
        <div className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: 'linear-gradient(90deg,#ff5f5f,#ffb75f)', boxShadow: '0 0 12px rgba(255,120,90,.8)' }}></div>
      </div>

      {/* 键位图 */}
      <div className="shrink-0 mt-3 rounded-xl border border-indigo-400/30 bg-black/20 px-3 py-3">
        <Keyboard3D activeKey={target ? target.word.text[target.typedLen] : null} collapsible showHint />
      </div>
    </div>
  );
};
