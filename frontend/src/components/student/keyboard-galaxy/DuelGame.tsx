import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backendClient } from '../../../api/backendClient';
import { Keyboard3D } from './Keyboard3D';
import { GALAXY_WORDS, seededShuffle, GalaxyWord } from './KeyboardData';

const FIELD_H = 280;
const MAX_HP = 3;
const STEP_SECONDS = 30; // 每 30 秒速度/密度提升一档

interface RewardRule {
  score: number;
  points: number;
  equipment_id: string;
  equipment_name: string;
  equipment_icon: string;
}

interface DuelConfig {
  duel_seconds: number;
  duel_speed: number;
  duel_spawn_ms: number;
  duel_step_pct: number;
  rewards: RewardRule[];
}

const DEFAULT_CFG: DuelConfig = {
  duel_seconds: 180,
  duel_speed: 85,
  duel_spawn_ms: 1800,
  duel_step_pct: 20,
  rewards: [],
};

interface DuelGameProps {
  roomId: string;
  seed: string;
  side: 'L' | 'R';
  opponentName: string;
  onExit: () => void;
}

interface FallingWord {
  id: number;
  word: GalaxyWord;
  x: number;
  y: number;
  speed: number;
  typedLen: number;
}

interface FX {
  id: number;
  kind: 'bullet' | 'boom';
  x: number;
  y: number;
  targetY?: number; // bullet 命中点（单词位置）
}

interface DuelResult {
  winner: string;
  p1_score: number;
  p2_score: number;
}

export const DuelGame: React.FC<DuelGameProps> = ({ roomId, seed, side, opponentName, onExit }) => {
  const seq = useMemo(() => seededShuffle(GALAXY_WORDS, seed), [seed]);

  const [phase, setPhase] = useState<'countdown' | 'playing' | 'finished'>('countdown');
  const [countdown, setCountdown] = useState(3);
  const [words, setWords] = useState<FallingWord[]>([]);
  const [fx, setFx] = useState<FX[]>([]);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [hp, setHp] = useState(MAX_HP);
  const [correctKeys, setCorrectKeys] = useState(0);
  const [wrongKeys, setWrongKeys] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [oppHp, setOppHp] = useState(MAX_HP);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<DuelResult | null>(null);
  const [myWin, setMyWin] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<DuelConfig>(DEFAULT_CFG);

  const idRef = useRef(1);
  const seqIdxRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef<FallingWord | null>(null);
  const startAtRef = useRef(0);
  const finishedRef = useRef(false);
  const hpRef = useRef(MAX_HP);
  const scoreRef = useRef(0);
  const elapsedRef = useRef(0);
  const wpmRef = useRef(0);
  const cfgRef = useRef<DuelConfig>(DEFAULT_CFG);
  const fieldRef = useRef<HTMLDivElement>(null);
  const fieldHRef = useRef(FIELD_H);
  // 物理计算用的镜像 ref：避免在 setState updater 里做副作用（StrictMode 下会被双调用）
  const wordsRef = useRef<FallingWord[]>([]);

  // 监听游戏区实际高度：窗口自由缩放时，漏底判定/子弹发射都基于真实高度
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const update = () => { fieldHRef.current = Math.max(el.clientHeight, 120); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  // 加载对局配置（时长/速度密度基准/奖励）
  useEffect(() => {
    backendClient.get('/api/typing/config')
      .then(res => {
        const d = res?.data;
        if (!d) return;
        const c: DuelConfig = {
          duel_seconds: parseInt(d.duel_seconds) || 180,
          duel_speed: parseInt(d.duel_speed) || 85,
          duel_spawn_ms: parseInt(d.duel_spawn_ms) || 1800,
          duel_step_pct: parseInt(d.duel_step_pct) || 20,
          rewards: Array.isArray(d.rewards) ? d.rewards : [],
        };
        setCfg(c);
        cfgRef.current = c;
      })
      .catch(() => {});
  }, []);

  // ==================== 倒计时 ====================
  useEffect(() => {
    if (phase !== 'countdown') return;
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(t);
          startAtRef.current = Date.now();
          setPhase('playing');
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  // 生成新词（速度由主循环按加速档计算后传入）
  const spawnWord = useCallback((spd: number) => {
    const w = seq[seqIdxRef.current % seq.length];
    seqIdxRef.current += 1;
    const fw: FallingWord = { id: idRef.current++, word: w, x: 8 + Math.random() * 72, y: -40, speed: spd, typedLen: 0 };
    wordsRef.current = [...wordsRef.current, fw];
    setWords(wordsRef.current);
  }, [seq]);

  // 目标词：直接计算并更新 ref / state（不依赖 words 的 effect 链，避免每帧触发 setState 造成更新风暴）
  const updateTarget = useCallback((list: FallingWord[]) => {
    if (list.length === 0) {
      targetRef.current = null;
      setTargetId(null); // 同值时 React 会 bailout，不会产生额外渲染
      return;
    }
    const t = list.reduce((a, b) => (a.y > b.y ? a : b));
    targetRef.current = t;
    setTargetId(t.id); // 同值时 React 会 bailout
  }, []);

  // ==================== 主循环 ====================
  useEffect(() => {
    if (phase !== 'playing') return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      // 每 30 秒一档：速度 ×(1+pct)，生成间隔 ÷(1+pct)（密度增加）
      const level = Math.floor(elapsedRef.current / STEP_SECONDS);
      const factor = Math.pow(1 + cfgRef.current.duel_step_pct / 100, level);
      const spd = Math.round(cfgRef.current.duel_speed * factor);
      const iv = Math.round(cfgRef.current.duel_spawn_ms / factor);
      if (now - lastSpawnRef.current >= iv) {
        lastSpawnRef.current = now;
        spawnWord(spd);
      }
      // 纯计算：下落 + 漏底判定（词块底部越过底部横线才算漏，基于真实游戏区高度）
      const fieldH = Math.max(fieldHRef.current, 120);
      let lost = false;
      const next: FallingWord[] = [];
      for (const w of wordsRef.current) {
        const nw = { ...w, y: w.y + w.speed * dt };
        if (nw.y > fieldH - 8) { lost = true; continue; }
        next.push(nw);
      }
      const prevLen = wordsRef.current.length;
      wordsRef.current = next;
      // 空场时跳过无意义的 setState（避免每帧用新空数组引用触发渲染）
      if (next.length > 0 || prevLen > 0) {
        setWords(next);
      }
      updateTarget(next);

      if (lost) {
        const nh = Math.max(hpRef.current - 1, 0);
        hpRef.current = nh;
        setHp(nh);
        setCombo(0);
        if (nh <= 0) endDuel();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, spawnWord, updateTarget]);

  // ==================== 计时 ====================
  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(() => {
      const el = Math.floor((Date.now() - startAtRef.current) / 1000);
      elapsedRef.current = el;
      setElapsed(el);
      if (el >= cfgRef.current.duel_seconds) endDuel();
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ==================== 输入 ====================
  useEffect(() => {
    if (phase !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      if (!/^[a-zA-Z0-9;',.\/\[\]=\-]$/.test(e.key)) return;
      const t = targetRef.current;
      if (!t) return;
      if (e.key === t.word.text[t.typedLen]) {
        const nt = t.typedLen + 1;
        wordsRef.current = wordsRef.current.map(w => (w.id === t.id ? { ...w, typedLen: nt } : w));
        if (nt >= t.word.text.length) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const killWord = (fw: FallingWord) => {
    // 子弹从游戏区底部发射，向上飞向单词，命中后爆炸
    const bottomY = Math.max(fieldHRef.current - 10, 0);
    setFx(prev => [
      ...prev,
      { id: Date.now(), kind: 'bullet', x: fw.x, y: bottomY, targetY: fw.y },
      { id: Date.now() + 1, kind: 'boom', x: fw.x, y: fw.y },
    ]);
    wordsRef.current = wordsRef.current.filter(w => w.id !== fw.id);
    setWords(wordsRef.current);
    updateTarget(wordsRef.current);
    scoreRef.current += 10;
    setScore(scoreRef.current);
    setCombo(c => c + 1);
    setCorrectKeys(c => c + fw.word.text.length);
  };

  // 特效清理（fx 为空时不再触发，避免 setFx([]) 反复生成新引用造成无限循环）
  useEffect(() => {
    if (fx.length === 0) return;
    const t = setTimeout(() => setFx([]), 1200);
    return () => clearTimeout(t);
  }, [fx]);

  // ==================== 同步 / 心跳 ====================
  const sync = useCallback(async () => {
    try {
      const res = await backendClient.post(`/api/typing/rooms/${roomId}/sync`, {
        score: scoreRef.current, hp: hpRef.current,
        chapter: Math.floor(elapsedRef.current / STEP_SECONDS) + 1,
        wpm: wpmRef.current,
      });
      const d = res?.data;
      if (!d) return;
      if (d.status === 'finished') {
        if (!finishedRef.current) {
          finishedRef.current = true;
          setResult(d.result);
          setMyWin(calcWin(d.result, side));
          setPhase('finished');
        }
        return;
      }
      setOppScore(d.opponent ?? 0);
      setOppHp(d.opponent_hp ?? MAX_HP);
    } catch { /* ignore */ }
  }, [roomId, side]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(sync, 800);
    return () => clearInterval(t);
  }, [phase, sync]);

  // 心跳
  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(() => {
      backendClient.post(`/api/typing/rooms/${roomId}/heartbeat`, {}).catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, [phase, roomId]);

  const calcWin = (r: DuelResult, s: 'L' | 'R'): boolean | null => {
    if (r.winner === 'draw') return null;
    return (r.winner === 'p1') === (s === 'L');
  };

  // ==================== 结束 ====================
  const endDuel = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    try {
      const res = await backendClient.post(`/api/typing/rooms/${roomId}/finish`, {
        score: scoreRef.current, hp: hpRef.current,
        chapter: Math.floor(elapsedRef.current / STEP_SECONDS) + 1,
        wpm: wpmRef.current,
      });
      const d = res?.data;
      if (d?.result) {
        setResult(d.result);
        setMyWin(calcWin(d.result, side));
      } else {
        setMyWin(false);
      }
    } catch {
      setMyWin(false);
    }
    setPhase('finished');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, side]);

  const wpm = Math.round(correctKeys / 5 / Math.max(elapsedRef.current / 60, 0.05));
  wpmRef.current = wpm;
  const acc = correctKeys + wrongKeys > 0 ? Math.round((correctKeys / (correctKeys + wrongKeys)) * 100) : 100;
  const totalSeconds = cfg.duel_seconds || 180;
  const level = Math.floor(elapsed / STEP_SECONDS);
  const curSpeed = Math.round((cfg.duel_speed || 85) * Math.pow(1 + (cfg.duel_step_pct || 20) / 100, level));

  // ==================== 渲染 ====================
  if (phase === 'countdown') {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 py-10">
        <div className="text-2xl font-black text-amber-300 mb-4">
          对战 <b className="text-pink-300">{opponentName}</b>
        </div>
        <div className="text-7xl font-black text-violet-300 animate-pulse">{countdown || '开始！'}</div>
        <p className="mt-6 text-xs text-indigo-400">限时 {Math.round(totalSeconds / 60)} 分钟 · 先失 3 血判负 · 时间到比积分，平分比手速</p>
      </div>
    );
  }

  if (phase === 'finished') {
    const myScore = side === 'L' ? (result?.p1_score ?? score) : (result?.p2_score ?? score);
    const oppFinalScore = side === 'L' ? (result?.p2_score ?? oppScore) : (result?.p1_score ?? oppScore);
    const rewards = cfg.rewards || [];
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 py-8 text-center overflow-y-auto">
        <div className="text-6xl mb-4">{myWin === null ? '🤝' : myWin ? '🏆' : '💫'}</div>
        <h2 className="text-2xl font-black text-amber-300 mb-2">
          {myWin === null ? '平局！' : myWin ? '你赢了！' : '你输了'}
        </h2>
        <p className="text-sm text-indigo-200 mb-5">对手：{opponentName}</p>
        <div className="flex gap-4 mb-6">
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/50 px-6 py-4">
            <div className="text-[10px] text-indigo-300">我</div>
            <div className="text-2xl font-black text-emerald-300">{myScore}</div>
          </div>
          <div className="self-center text-indigo-400 text-lg">VS</div>
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/50 px-6 py-4">
            <div className="text-[10px] text-indigo-300">{opponentName}</div>
            <div className="text-2xl font-black text-pink-300">{oppFinalScore}</div>
          </div>
        </div>

        {/* 奖励面板：达成显示已获得，未达成显示条件 */}
        {rewards.length > 0 && (
          <div className="w-full max-w-md mb-6">
            <div className="text-xs text-indigo-300 mb-2 font-bold flex items-center gap-1">
              <i className="fa-solid fa-gift text-amber-300"></i>本局奖励
            </div>
            <div className="space-y-2">
              {rewards.map((rw, i) => {
                const achieved = myScore >= rw.score;
                const missing = Math.max(rw.score - myScore, 0);
                return (
                  <div key={i} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${achieved ? 'border-emerald-400/50 bg-emerald-900/20' : 'border-white/10 bg-white/5'}`}>
                    <span className={achieved ? 'text-emerald-300' : 'text-indigo-300'}>
                      得分 ≥ {rw.score}
                      {rw.points > 0 && <span className="ml-1">· +{rw.points} 积分</span>}
                      {rw.equipment_id && rw.equipment_name && (
                        <span className="ml-1">· {rw.equipment_icon} {rw.equipment_name}</span>
                      )}
                    </span>
                    <span className={`font-bold ${achieved ? 'text-emerald-300' : 'text-gray-400'}`}>
                      {achieved ? '✔ 已获得' : `还差 ${missing} 分`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button onClick={onExit} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-bold transition-all">
          <i className="fa-solid fa-arrow-left mr-1"></i>返回大厅
        </button>
      </div>
    );
  }

  const target = targetRef.current;
  const timeLeft = totalSeconds - elapsed;

  return (
    <div className="h-full flex flex-col px-5 py-4">
      <style>{`
        @keyframes galaxyFallShoot { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; } }
        @keyframes galaxyBoom { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes galaxyPart { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--px), var(--py)) scale(.2); opacity: 0; } }
        @keyframes galaxyLaser { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }
        .galaxy-laser { position: absolute; top: 0; left: 50%; width: 3px; transform: translateX(-50%); background: linear-gradient(180deg, rgba(126,240,255,.9), rgba(126,240,255,0)); animation: galaxyLaser .4s ease-out forwards; }
      `}</style>
      {/* 双栏比分 */}
      <div className="shrink-0 grid grid-cols-2 gap-3 mb-3">
        <div className={`rounded-xl border px-3 py-2 ${side === 'L' ? 'border-blue-400/50 bg-blue-900/20' : 'border-indigo-400/25 bg-indigo-950/30'}`}>
          <div className="flex items-center justify-between text-xs text-indigo-300">
            <span className="font-bold text-white">{side === 'L' ? '我' : opponentName}</span>
            <span>{'❤'.repeat(Math.max(hp, 0)) + '🖤'.repeat(Math.max(MAX_HP - Math.max(hp, 0), 0))}</span>
          </div>
          <div className="text-2xl font-black text-amber-300">{score}</div>
        </div>
        <div className={`rounded-xl border px-3 py-2 ${side === 'R' ? 'border-blue-400/50 bg-blue-900/20' : 'border-indigo-400/25 bg-indigo-950/30'}`}>
          <div className="flex items-center justify-between text-xs text-indigo-300">
            <span className="font-bold text-white">{side === 'R' ? '我' : opponentName}</span>
            <span>{'❤'.repeat(Math.max(oppHp, 0)) + '🖤'.repeat(Math.max(MAX_HP - Math.max(oppHp, 0), 0))}</span>
          </div>
          <div className="text-2xl font-black text-pink-300">{oppScore}</div>
        </div>
      </div>

      {/* 加速档/时间/速度 */}
      <div className="shrink-0 mb-2 flex items-center justify-center gap-4 text-xs text-indigo-300">
        <span>加速档 <b className="text-violet-300">{level + 1}</b></span>
        <span>速度 <b className="text-sky-300">{curSpeed}px/s</b></span>
        <span>总剩余 <b className="text-red-300">{Math.max(timeLeft, 0)}s</b></span>
        <span>{wpm} WPM · {acc}%</span>
        {combo > 1 && <span className="text-pink-300">连击 ×{combo}</span>}
      </div>

      {/* 游戏区 */}
      <div ref={fieldRef} className="flex-1 min-h-0 relative rounded-xl border border-indigo-400/20 overflow-hidden" style={{ background: 'linear-gradient(180deg, rgba(20,28,70,.5), rgba(10,14,36,.8))' }}>
        {words.map(w => {
          const isTarget = w.id === targetId;
          return (
            <div key={w.id} className="absolute" style={{ left: `${w.x}%`, top: w.y, transform: 'translateX(-50%)' }}>
              <div className="rounded-lg border px-3 py-2 text-center"
                style={{
                  background: isTarget ? 'linear-gradient(180deg, rgba(207,72,72,.95), rgba(150,40,50,.95))' : 'linear-gradient(180deg, rgba(56,89,199,.85), rgba(37,58,140,.9))',
                  borderColor: isTarget ? '#ff8a8a' : '#6d86ff',
                  boxShadow: isTarget ? '0 0 18px rgba(255,100,100,.7)' : '0 0 12px rgba(109,134,255,.5)',
                }}
              >
                <div className="font-mono font-bold text-xl text-white tracking-wide">
                  {w.word.text.slice(0, w.typedLen)}<span className="text-white/70">{w.word.text.slice(w.typedLen)}</span>
                </div>
                <div className="text-xs text-indigo-200 truncate max-w-[160px]">{w.word.zh}</div>
              </div>
            </div>
          );
        })}
        {fx.map(f => (
          <div key={f.id} className="absolute pointer-events-none" style={{ left: `${f.x}%`, top: f.y }}>
            {f.kind === 'bullet' && (
              <div style={{ position: 'relative' }}>
                {/* 弹道光柱：从发射点延伸到命中点 */}
                <div className="galaxy-laser" style={{ height: Math.max((f.y - (f.targetY ?? f.y)), 0) }} />
                {/* 子弹头：向上飞向单词 */}
                <div style={{
                  position: 'absolute', left: 0, top: 0,
                  width: 7, height: 7, borderRadius: '50%', background: '#aef4ff',
                  boxShadow: '0 0 12px 4px rgba(126,240,255,.95), 0 0 26px 10px rgba(126,240,255,.45)',
                  animation: 'galaxyFallShoot .45s ease-out forwards',
                  ['--dx' as any]: '0px',
                  ['--dy' as any]: `${((f.targetY ?? f.y) - f.y) * 0.9}px`,
                }} />
              </div>
            )}
            {f.kind === 'boom' && (
              <div style={{ position: 'relative', animation: 'galaxyBoom .7s ease-out forwards' }}>
                {[[-24, -22], [24, -22], [-30, 2], [30, 2], [-14, -34], [14, -34]].map(([px, py], i) => (
                  <span key={i} style={{ position: 'absolute', width: 5, height: 5, borderRadius: '50%', background: '#ffe08a', boxShadow: '0 0 8px 2px rgba(255,224,138,.9)', animation: `galaxyPart .7s ease-out ${i * 0.02}s forwards`, ['--px' as any]: `${px}px`, ['--py' as any]: `${py}px` }} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: 'linear-gradient(90deg,#ff5f5f,#ffb75f)' }}></div>
      </div>

      {/* 操作栏 + 键位图 */}
      <div className="shrink-0 mt-2 flex items-center gap-2">
        <button onClick={endDuel} className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-gray-300 transition-colors">
          <i className="fa-solid fa-flag mr-1"></i>终止（按当前分判定）
        </button>
      </div>
      <div className="shrink-0 mt-2 rounded-xl border border-indigo-400/30 bg-black/20 px-3 py-3">
        <Keyboard3D activeKey={target ? target.word.text[target.typedLen] : null} collapsible showHint />
      </div>
    </div>
  );
};
