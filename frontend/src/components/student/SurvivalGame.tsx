import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { sanitizeHtml } from '../../utils/htmlUtils';
import { useAuth } from '../../hooks/useAuth';

/**
 * 生存游戏 · 信号深潜（学生端，2026-10-27 吴老定）
 *
 * 一关一题：答对 +10 信号并下一层，答错 -30 且必须订正才能继续；
 * HP 归零断线，回到第 1 关重来，但累计深度不清零。
 *
 * ⛔ HP / 关卡 / 待订正状态全部由服务端裁决，这里只负责显示与提交。
 * ⛔ 题干与选项都是富文本（选项里有图片），一律 sanitizeHtml + question-rich-content。
 */

const C = {
  bg: '#080D18',
  panel: '#0E1626',
  panel2: '#111C30',
  line: '#1E2A3F',
  line2: '#16233A',
  text: '#E6EDF7',
  dim: '#94A3B8',
  mute: '#5A6B85',
  cyan: '#22D3EE',
  green: '#34D399',
  red: '#EF4444',
  amber: '#FBBF24',
};

interface SLevel {
  seq: number;
  code: string;
  title: string;
  unit_name: string;
  chapter_name: string;
  question_count: number;
}

/** 重生点：血尽后回到这里，首次抵达会展示剧情 */
interface SCheckpoint {
  seq: number;
  code: string;
  title: string;
  story: string;
}

interface SQuestion {
  id: string;
  type: 'choice' | 'fill_blank';
  content: string;
  options: string[];
  /** 只有 /state 在「待订正」恢复时会下发，用于还原解析区 */
  explanation?: string;
  correct_answer?: string;
}

interface SState {
  hp: number;
  hp_init: number;
  seq: number;
  round_no: number;
  total_levels: number;
  round_levels: number;
  best_round_levels: number;
  total_correct: number;
  total_wrong: number;
  deaths: number;
  alive: boolean;
  pending_correction: boolean;
  /** 本关已结算、还没开下一关（答对后关掉页面的状态） */
  waiting_next?: boolean;
  level: SLevel | null;
  question: SQuestion | null;
  deadline: string | null;
  config: {
    hp_gain: number;
    hp_repeat_gain: number;
    hp_penalty: number;
    time_choice: number;
    time_blank: number;
    require_correction: number;
  };
}

interface RankRow {
  rank: number;
  /** 本轮内的关卡序号 1..70 */
  seq: number;
  /** 累计深度 = (轮次-1)*70 + seq，打穿一轮会继续往上加 */
  depth: number;
  round_no: number;
  code: string;
  title: string;
  username: string;
  real_name: string;
  class_name: string;
  total_levels: number;
  hp: number;
}

interface RankData {
  depth: RankRow[];
  hp: RankRow[];
  players: number;
  me: {
    username: string;
    hp: number;
    seq: number;
    depth: number;
    round_no: number;
    total_levels: number;
    alive: boolean;
    depth_rank: number | null;
    hp_rank: number | null;
  };
  refreshed_at: string;
  next_refresh_at: string;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
type Phase = 'loading' | 'intro' | 'playing' | 'cleared' | 'dead' | 'rank';

export const SurvivalGame: React.FC = () => {
  const { profile } = useAuth();
  const myUsername = String((profile as any)?.username || '');
  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<SState | null>(null);
  const [level, setLevel] = useState<SLevel | null>(null);
  const [question, setQuestion] = useState<SQuestion | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [hp, setHp] = useState(0);

  const [picked, setPicked] = useState('');
  const [fillValue, setFillValue] = useState('');
  const [busy, setBusy] = useState(false);

  /** 上一次作答的反馈（答错时用来展示解析与订正区） */
  const [feedback, setFeedback] = useState<null | {
    correct: boolean;
    hpDelta: number;
    repeat: boolean;
    timeout: boolean;
    explanation: string;
    correctAnswer: string;
    dead: boolean;
    /** 由 /state 恢复出来的待订正态（没有本次扣血信息） */
    restored?: boolean;
  }>(null);
  /** 订正结果提示（订正又答错） */
  const [correctHint, setCorrectHint] = useState('');
  /**
   * 服务端标记的「本题必须订正」。
   * ⛔ 刷新页面 / 从排行榜返回后 feedback 已经丢了，但服务端 pending_correction 还是 1，
   *    只靠 feedback 判断会出现「没有订正入口，点什么都报要先订正」的死局（2026-10-27）
   */
  const [needFix, setNeedFix] = useState(false);
  /** 页内提示（替代 alert：alert 在倒计时循环里会连环弹，关不掉） */
  const [notice, setNotice] = useState('');
  const [combo, setCombo] = useState(0);
  const [flash, setFlash] = useState<'good' | 'bad' | ''>('');
  const [hpFloat, setHpFloat] = useState<null | { text: string; good: boolean }>(null);

  const [rank, setRank] = useState<RankData | null>(null);
  const [rankTab, setRankTab] = useState<'depth' | 'hp'>('depth');
  const [remaining, setRemaining] = useState<number | null>(null);

  /** 本次断线的结算数据（服务端已经重置，所以要在死亡那一刻记下来） */
  const [deathInfo, setDeathInfo] = useState<null | {
    reached: number;
    /** 累计深度 (轮次-1)*70 + 关卡，死亡时那一刻的位置 */
    depth: number;
    best: number;
    total: number;
    correct: number;
    wrong: number;
    deaths: number;
    rebirth: SCheckpoint | null;
  }>(null);

  /** 本层通过的结算信息（答对后停在这里，等学生点「下一层」） */
  const [clearedInfo, setClearedInfo] = useState<null | {
    code: string;
    title: string;
    hpDelta: number;
    repeat: boolean;
    corrected: boolean;
  }>(null);
  /** 刚解锁的重生点剧情，展示一次可关闭 */
  const [checkpointStory, setCheckpointStory] = useState<SCheckpoint | null>(null);
  const [nextBusy, setNextBusy] = useState(false);
  /** 「下潜」过场：点进下一层时短暂盖住屏幕，0.55s 后自动消失 */
  const [diving, setDiving] = useState<null | { code: string; title: string }>(null);

  const advanceTimer = useRef<number | null>(null);
  /** 超时自动交只允许触发一次，否则倒计时归零后每 500ms 都会再交一次 */
  const timeoutFiredRef = useRef(false);

  const clearAdvance = () => {
    if (advanceTimer.current) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  };

  const applyQuestion = useCallback((lv: SLevel | null, q: SQuestion | null, dl: string | null) => {
    setLevel(lv);
    setQuestion(q);
    setDeadline(dl ? new Date(dl).getTime() : null);
    setPicked('');
    setFillValue('');
    setFeedback(null);
    setCorrectHint('');
    setNeedFix(false);
    setNotice('');
    timeoutFiredRef.current = false;
  }, []);

  const loadState = useCallback(async () => {
    try {
      const res: any = await backendClient.get('/api/student/survival/state');
      const d: SState = res?.data;
      if (!d) throw new Error('没有返回数据');
      setState(d);
      setHp(d.hp);
      if (d.alive && d.question && d.level) {
        // 待订正时服务端已清掉 deadline，这里再兜一层，避免进来就自动交
        applyQuestion(d.level, d.question, d.pending_correction ? null : d.deadline);
        if (d.pending_correction) {
          // 刷新/关掉页面再进来：把「待订正」和解析一起还原，否则没有任何操作入口
          setNeedFix(true);
          setFeedback({
            correct: false,
            hpDelta: 0,
            repeat: false,
            timeout: false,
            explanation: d.question.explanation || '',
            correctAnswer: d.question.correct_answer || '',
            dead: false,
            restored: true,
          });
        }
        setPhase('playing');
      } else if (d.alive && d.waiting_next) {
        // 上次答对后直接关页面：回到「本层已通过」的结算态，不会倒退回重生点
        setLevel(d.level);
        setClearedInfo({
          code: d.level?.code || '',
          title: d.level?.title || '',
          hpDelta: 0,
          repeat: false,
          corrected: false,
        });
        setPhase('cleared');
      } else {
        setPhase('intro');
      }
    } catch (e) {
      alert((e as Error).message || '加载失败');
      setPhase('intro');
    }
  }, [applyQuestion]);

  useEffect(() => {
    loadState();
    return () => clearAdvance();
  }, [loadState]);

  // 倒计时：按 deadline 算剩余秒数，到点自动交（服务端也会判超时，双保险）
  useEffect(() => {
    if (phase !== 'playing' || !deadline) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      // ⛔ 只交一次：归零后每 500ms 都调一次接口，待订正时全被后端 400 挡回来，
      //    旧实现每弹一个 alert 就卡死一次，学生看到的就是「弹窗关不掉」
      if (left <= 0 && !timeoutFiredRef.current) {
        timeoutFiredRef.current = true;
        submitRef.current?.('');
      }
    };
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [phase, deadline]);

  const submitRef = useRef<((answer: string) => void) | null>(null);

  const submit = useCallback(
    async (answer: string) => {
      if (!question || busy) return;
      // 已答错待订正：只能走 /correct。再调 /answer 会被后端 400 挡回来
      if (feedback || needFix) return;
      setBusy(true);
      setCorrectHint('');
      setNotice('');
      try {
        const res: any = await backendClient.post('/api/student/survival/answer', {
          question_id: question.id,
          answer,
        });
        const d = res?.data;
        if (!d) throw new Error('没有返回结果');

        setHp(d.hp_after);
        setHpFloat({ text: `${d.hp_delta > 0 ? '+' : ''}${d.hp_delta}`, good: d.hp_delta > 0 });
        window.setTimeout(() => setHpFloat(null), 1100);

        if (d.correct) {
          // 只结算，不跳题：停在结算页等学生点「下一层」，下一题的计时由 /next 才开始
          setDeadline(null);
          timeoutFiredRef.current = true;
          setCombo((n) => n + 1);
          setFlash('good');
          // 绿光走满 0.55s 再撤掉，太快会看不到
          window.setTimeout(() => setFlash(''), 650);
          setClearedInfo({
            code: level?.code || '',
            title: level?.title || '',
            hpDelta: d.hp_delta,
            repeat: !!d.repeat,
            corrected: false,
          });
          setState((prev) =>
            prev ? { ...prev, total_levels: d.total_levels, round_levels: d.round_levels, hp: d.hp_after } : prev
          );
          window.setTimeout(() => setPhase('cleared'), 520);
          return;
        }

        // 答错
        setCombo(0);
        setFlash('bad');
        window.setTimeout(() => setFlash(''), 420);
        // 答错后本关题目不变、后端也不推进：倒计时必须停，否则到点会自动交卷
        setDeadline(null);
        timeoutFiredRef.current = true;
        setFeedback({
          correct: false,
          hpDelta: d.hp_delta,
          repeat: false,
          timeout: !!d.timeout,
          explanation: d.explanation || '',
          correctAnswer: d.correct_answer || '',
          dead: !!d.dead,
        });
        setNeedFix(!!d.need_correction);
        if (d.dead) {
          // ⛔ 这里必须用服务端返回的统计：它已经把档案重置成「第 1 层、满血」了，
          //    若读本地 state 会显示「你在第 0 层断线」
          setDeathInfo({
            reached: Number(d.round_levels) || 0,
            depth: Number(d.depth) || 0,
            best: Number(d.best_round_levels) || 0,
            total: Number(d.total_levels) || 0,
            correct: Number(d.total_correct) || 0,
            wrong: Number(d.total_wrong) || 0,
            deaths: Number(d.deaths) || 0,
            rebirth: d.rebirth || null,
          });
          window.setTimeout(() => setPhase('dead'), 1500);
        }
      } catch (e) {
        // ⛔ 不用 alert：答题/超时提交都在这一条路径上，alert 会连环弹
        const msg = (e as Error).message || '提交失败';
        setNotice(msg);
        // 本地题目跟服务端对不上（例如此前从排行榜返回后点了旧题）：自动重新同步，别让学生卡死
        if (msg.includes('题目已过期') || msg.includes('要先订正')) {
          window.setTimeout(() => { void loadState(); }, 900);
        }
      } finally {
        setBusy(false);
      }
    },
    [question, busy, applyQuestion, state, feedback, needFix, loadState]
  );

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  const doCorrect = async () => {
    if (!question || busy) return;
    const answer = question.type === 'fill_blank' ? fillValue.trim() : picked;
    if (!answer) return;
    setBusy(true);
    setCorrectHint('');
    setNotice('');
    try {
      const res: any = await backendClient.post('/api/student/survival/correct', {
        question_id: question.id,
        answer,
      });
      const d = res?.data;
      if (!d) throw new Error('没有返回结果');
      if (!d.correct) {
        setCorrectHint(d.message || '还不对，再看看解析');
        setBusy(false);
        return;
      }
      setDeadline(null);
      timeoutFiredRef.current = true;
      setCombo((n) => n + 1);
      setFlash('good');
      window.setTimeout(() => setFlash(''), 650);
      setClearedInfo({
        code: level?.code || '',
        title: level?.title || '',
        hpDelta: 0,
        repeat: false,
        corrected: true,
      });
      setState((prev) =>
        prev ? { ...prev, total_levels: d.total_levels, round_levels: d.round_levels, pending_correction: false } : prev
      );
      window.setTimeout(() => setPhase('cleared'), 520);
    } catch (e) {
      setNotice((e as Error).message || '提交失败');
    } finally {
      setBusy(false);
    }
  };

  /** 选择题订正：点一个字母直接提交（订正不加血不扣血，答对才准继续） */
  const doCorrectChoice = async (letter: string) => {
    if (!question || busy) return;
    setBusy(true);
    setCorrectHint('');
    setNotice('');
    try {
      const res: any = await backendClient.post('/api/student/survival/correct', {
        question_id: question.id,
        answer: letter,
      });
      const d = res?.data;
      if (!d) throw new Error('没有返回结果');
      if (!d.correct) {
        setCorrectHint(d.message || '还不对，再看看解析');
        return;
      }
      setDeadline(null);
      timeoutFiredRef.current = true;
      setCombo((n) => n + 1);
      setFlash('good');
      window.setTimeout(() => setFlash(''), 650);
      setClearedInfo({
        code: level?.code || '',
        title: level?.title || '',
        hpDelta: 0,
        repeat: false,
        corrected: true,
      });
      setState((prev) =>
        prev ? { ...prev, total_levels: d.total_levels, round_levels: d.round_levels, pending_correction: false } : prev
      );
      window.setTimeout(() => setPhase('cleared'), 520);
    } catch (e) {
      setNotice((e as Error).message || '提交失败');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 进入下一层。
   * ⛔ 抽题与开始计时都在这一步（服务端 /next），所以结算页停多久都不会超时。
   */
  const goNext = async () => {
    if (nextBusy) return;
    setNextBusy(true);
    setNotice('');
    try {
      const res: any = await backendClient.post('/api/student/survival/next', {});
      const d = res?.data;
      if (!d) throw new Error('没有返回结果');
      setHp(Number(d.hp) || 0);
      applyQuestion(d.level, d.question, d.deadline);
      setCheckpointStory(d.checkpoint || null);
      setState((prev) =>
        prev
          ? {
              ...prev,
              level: d.level,
              question: d.question,
              round_levels: d.round_levels,
              waiting_next: false,
              pending_correction: false,
            }
          : prev
      );
      // 短暂过场：让「进入下一层」有个下落的感觉，而不是硬切屏
      setDiving({ code: d.level?.code || '', title: d.level?.title || '' });
      window.setTimeout(() => {
        setDiving(null);
        setPhase('playing');
      }, 560);
    } catch (e) {
      setNotice((e as Error).message || '进入下一层失败');
    } finally {
      setNextBusy(false);
    }
  };

  /**
   * 结算页快速模式：回车 / 空格直接进下一层。
   * 与学生端练习模块（PracticeModule / WrongQuestions）保持同一套手感。
   */
  const goNextRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    goNextRef.current = goNext;
  }, [goNext]);

  useEffect(() => {
    if (phase !== 'cleared' || nextBusy || diving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        goNextRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, nextBusy, diving]);

  const startGame = async () => {    setBusy(true);
    try {
      const res: any = await backendClient.post('/api/student/survival/start', {});
      const d = res?.data;
      if (!d) throw new Error('没有返回结果');
      setHp(d.hp);
      applyQuestion(d.level, d.question, d.pending_correction ? null : d.deadline);
      setNeedFix(!!d.pending_correction);
      if (d.checkpoint) setCheckpointStory(d.checkpoint);
      setState((prev) =>
        prev
          ? { ...prev, hp: d.hp, alive: true, pending_correction: !!d.pending_correction, round_no: d.round_no }
          : prev
      );
      setPhase('playing');
    } catch (e) {
      setNotice((e as Error).message || '开始失败');
    } finally {
      setBusy(false);
    }
  };

  const loadRank = async () => {
    try {
      const res: any = await backendClient.get('/api/student/survival/rank');
      setRank(res?.data || null);
    } catch (e) {
      console.error('排行加载失败', e);
    }
  };

  useEffect(() => {
    if (phase === 'rank') loadRank();
  }, [phase]);

  /**
   * 从哪个界面进的排行榜，返回时原路回去。
   * ⛔ 之前一律回 playing：在「本层已通过」页看榜再返回，就会看到上一题的题干，
   *    又没有「进入下一层」按钮，点选项还会被后端拒（题目已过期）。
   */
  const [rankFrom, setRankFrom] = useState<Phase>('intro');
  const openRank = () => {
    setRankFrom(phase === 'rank' ? 'intro' : phase);
    setPhase('rank');
  };

  const hpInit = state?.hp_init || 100;
  const ratio = Math.min(1, Math.max(0, hp / hpInit));
  const cells = Math.max(hp > 0 ? 1 : 0, Math.round(ratio * 10));
  const danger = hp > 0 && hp <= hpInit * 0.3;
  const barColor = danger ? C.red : C.cyan;

  const fmtLeft = useMemo(() => {
    if (remaining === null) return '';
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, [remaining]);

  const shell = (inner: React.ReactNode) => (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: C.bg, color: C.text }}>
      <style>{`
        @keyframes sv-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-7px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(3px)} }
        @keyframes sv-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes sv-rise { 0%{opacity:0; transform:translateY(6px)} 25%{opacity:1} 100%{opacity:0; transform:translateY(-16px)} }
        @keyframes sv-good { 0%{box-shadow:inset 0 0 0 0 rgba(52,211,153,0)} 28%{box-shadow:inset 0 0 70px 6px rgba(52,211,153,.26)} 100%{box-shadow:inset 0 0 0 0 rgba(52,211,153,0)} }
        @keyframes sv-fadein { from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:translateY(0)} }
        @keyframes sv-dive-code { 0%{opacity:0; transform:translateY(-14px)} 100%{opacity:1; transform:translateY(0)} }
        @keyframes sv-dive-bar { 0%{width:0; opacity:.25} 100%{width:9rem; opacity:1} }
        @keyframes sv-pop { 0%{transform:scale(.72); opacity:0} 60%{transform:scale(1.1)} 100%{transform:scale(1); opacity:1} }
        .sv-shake{animation:sv-shake .42s ease-in-out}
        .sv-pulse{animation:sv-pulse 1.1s ease-in-out infinite}
        .sv-rise{animation:sv-rise 1.1s ease-out forwards}
        .sv-good{animation:sv-good .55s ease-out}
        .sv-fadein{animation:sv-fadein .28s ease-out both}
        .sv-dive-code{animation:sv-dive-code .45s ease-out both}
        .sv-dive-bar{animation:sv-dive-bar .55s ease-out both}
        .sv-pop{animation:sv-pop .3s ease-out both}
        .sv-rte p{margin:.35em 0;line-height:1.7}
        .sv-rte p:first-child{margin-top:0}
        .sv-rte p:last-child{margin-bottom:0}
        .sv-rte img{max-width:100%;height:auto;border-radius:6px;display:block;margin:.4rem 0}
        .sv-rte ul,.sv-rte ol{padding-left:1.3em;margin:.35em 0}
      `}</style>
      <div
        className={`relative flex h-full flex-col overflow-hidden ${flash === 'bad' ? 'sv-shake' : ''} ${flash === 'good' ? 'sv-good' : ''}`}
      >
        {inner}
      </div>
    </div>
  );

  // ---------- 加载 ----------
  if (phase === 'loading') {
    return shell(
      <div className="flex flex-1 items-center justify-center" style={{ color: C.mute }}>
        <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>正在建立链路…
      </div>
    );
  }

  // ---------- 排行榜 ----------
  if (phase === 'rank') {
    const rows = rank ? (rankTab === 'depth' ? rank.depth : rank.hp) : [];
    return shell(
      <>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs tracking-widest" style={{ color: C.cyan }}>signal dive</span>
            <span className="text-xs" style={{ color: C.mute }}>全校排行</span>
          </div>
          <button onClick={() => setPhase(rankFrom)} className="text-xs px-3 py-1 rounded" style={{ border: `1px solid ${C.line}`, color: C.dim }}>
            返回
          </button>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {([['depth', '深度榜'], ['hp', '信号榜']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRankTab(k)}
              className="flex-1 rounded-md py-1.5 text-sm"
              style={{
                background: rankTab === k ? C.panel2 : 'transparent',
                color: rankTab === k ? C.text : C.mute,
                border: `1px solid ${rankTab === k ? C.line : 'transparent'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px]" style={{ color: C.mute }}>
            <span>全校 {rank?.players ?? 0} 人正在下潜 · 显示前 {rows.length} 名</span>
            <span className="font-mono">
              {rank ? `下次刷新 ${new Date(rank.next_refresh_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: C.mute }}>还没有人上榜，去做第一个</p>
          ) : (
            <div className="space-y-0.5">
              {rows.map((r, i) => {
                const isMe = !!myUsername && r.username === myUsername;
                return (
                  <div
                    key={`${r.username}-${i}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5"
                    style={{
                      background: isMe ? 'rgba(34,211,238,0.08)' : i < 3 ? 'rgba(251,191,36,0.06)' : 'transparent',
                      border: `1px solid ${isMe ? '#164E63' : 'transparent'}`,
                    }}
                  >
                    <span className="w-6 shrink-0 text-center font-mono text-xs" style={{ color: i === 0 ? C.amber : i < 3 ? C.dim : C.mute }}>
                      {r.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="truncate text-sm" style={{ color: C.text }}>
                        {r.username}
                        {r.real_name ? <span style={{ color: C.dim }}> · {r.real_name}</span> : null}
                      </span>
                      {r.class_name ? <span className="ml-2 text-[11px]" style={{ color: C.mute }}>{r.class_name}</span> : null}
                    </div>
                    <span
                      className="shrink-0 font-mono text-sm"
                      style={{ color: rankTab === 'depth' ? C.cyan : C.amber }}
                      title={
                        rankTab === 'depth'
                          ? `第 ${r.round_no} 轮 · 本轮第 ${r.seq} 层 · ${r.code} ${r.title}`.trim()
                          : ''
                      }
                    >
                      {rankTab === 'depth' ? `${r.depth} 层` : `${r.hp} 信号`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {rank?.me && (
          <div className="px-5 py-3" style={{ borderTop: `1px solid ${C.line}`, background: C.panel }}>
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: C.dim }}>
                我的位次 · 深度{' '}
                <span className="font-mono" style={{ color: C.cyan }}>
                  {rank.me.depth_rank ? `第 ${rank.me.depth_rank} 名` : (rank.me.alive ? '未上榜' : '已断线')}
                </span>
                <span className="mx-2" style={{ color: C.line }}>|</span>
                信号{' '}
                <span className="font-mono" style={{ color: C.amber }}>
                  {rank.me.hp_rank ? `第 ${rank.me.hp_rank} 名` : '已断线'}
                </span>
              </span>
              <span className="font-mono" style={{ color: C.mute }}>
                第 {rank.me.depth || 1} 层 · {rank.me.hp} 信号
              </span>
            </div>
          </div>
        )}
      </>
    );
  }

  // ---------- 本层通过（等学生点「下一层」） ----------
  if (phase === 'cleared') {
    const info = clearedInfo || { code: '', title: '', hpDelta: 0, repeat: false, corrected: false };
    return shell(
      <div className="relative flex flex-1 items-center justify-center px-6">
        <div className="sv-fadein w-full max-w-md">
          <div className="text-center">
            <div className="font-mono text-[11px] tracking-[0.18em]" style={{ color: C.green }}>layer stable</div>
            <div className="mt-2 flex items-baseline justify-center gap-2">
              <span className="font-mono text-3xl" style={{ color: C.text }}>{info.code}</span>
              <span className="text-sm" style={{ color: C.dim }}>{info.title}</span>
            </div>
            <div
              className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1"
              style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid #134E4A' }}
            >
              <span className="font-mono text-sm" style={{ color: C.green }}>
                {info.corrected ? '订正通过 · 信号未损' : `信号 ${info.hpDelta > 0 ? '+' : ''}${info.hpDelta}`}
              </span>
              {info.repeat && <span className="text-[11px]" style={{ color: C.mute }}>今天做过这题</span>}
            </div>
          </div>

          {notice && (
            <div
              className="mt-4 rounded-md px-3 py-1.5 text-[11px]"
              style={{ background: 'rgba(239,68,68,0.14)', border: '1px solid #5A2020', color: '#FCA5A5' }}
            >
              {notice}
            </div>
          )}

          <div className="mt-6 rounded-lg px-4 py-3" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
            <p className="text-[11px] leading-relaxed" style={{ color: C.dim }}>
              这一层已经稳住。可以歇一会儿，准备好了再下潜 ——
              下一层的计时从你点按钮那一刻才开始。
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={goNext}
              disabled={nextBusy}
              className="w-full rounded-lg py-3 text-sm font-medium disabled:opacity-50"
              style={{ background: C.cyan, color: '#062A33' }}
            >
              {nextBusy ? '正在下潜…' : '进入下一层 →'}
            </button>
            <p className="text-center text-[11px]" style={{ color: C.mute }}>
              按回车或空格也能继续
            </p>
            <div className="flex gap-2">
              <button
                onClick={openRank}
                className="flex-1 rounded-lg py-2 text-xs"
                style={{ border: `1px solid ${C.line}`, color: C.dim }}
              >
                看排行榜
              </button>
              <button
                onClick={() => setPhase('intro')}
                className="flex-1 rounded-lg py-2 text-xs"
                style={{ border: `1px solid ${C.line}`, color: C.dim }}
              >
                先退出
              </button>
            </div>
          </div>
        </div>

        {/* 下潜过场：只在点「进入下一层」后出现 0.55 秒 */}
        {diving && (
          <div
            className="absolute inset-0 z-40 flex flex-col items-center justify-center"
            style={{ background: 'rgba(8,13,24,0.94)' }}
          >
            <div className="font-mono text-[10px] tracking-[0.22em]" style={{ color: C.mute }}>descending</div>
            <div className="sv-dive-code mt-2 font-mono text-3xl" style={{ color: C.cyan }}>{diving.code}</div>
            <div className="mt-1 text-xs" style={{ color: C.dim }}>{diving.title}</div>
            <div className="sv-dive-bar mt-4 h-[2px] rounded" style={{ background: C.cyan }} />
            <div className="mt-2 text-[11px]" style={{ color: C.mute }}>下潜中…</div>
          </div>
        )}
      </div>
    );
  }

  // ---------- 死亡结算 ----------
  if (phase === 'dead') {
    const info = deathInfo || { reached: 0, depth: 0, best: 0, total: 0, correct: 0, wrong: 0, deaths: 0, rebirth: null };
    return shell(
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="text-center">
            <div className="font-mono text-[11px] tracking-[0.18em]" style={{ color: C.mute }}>transmission terminated</div>
            <div className="mt-2 text-2xl" style={{ color: C.text }}>连接中断</div>
            <div className="mt-2 text-sm" style={{ color: C.dim }}>
              你在第 <span className="font-mono" style={{ color: C.text }}>{info.depth || info.reached}</span> 层失去了信号
            </div>
            {info.rebirth && (
              <div
                className="mx-auto mt-3 inline-flex flex-wrap items-center justify-center gap-x-2 rounded-md px-3 py-2"
                style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid #78350F' }}
              >
                <span className="text-[11px]" style={{ color: C.amber }}>中继站已锚定</span>
                <span className="font-mono text-xs" style={{ color: '#FDE68A' }}>{info.rebirth.code}</span>
                <span className="text-[11px]" style={{ color: C.dim }}>{info.rebirth.title}</span>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-lg p-4" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
            <div className="mb-2 text-[11px] tracking-wider" style={{ color: C.mute }}>本次记录已封存</div>
            {[
              ['当前深度', `${info.depth || info.reached} 层`, C.cyan],
              ['历史最深', `${info.best} 层`, C.text],
              ['累计通关', `${info.total} 层`, C.text],
              ['累计答对', `${info.correct} 题`, C.text],
              ['断线次数', `${info.deaths} 次`, C.dim],
            ].map(([label, value, color], i) => (
              <div
                key={label as string}
                className="flex items-center justify-between py-1.5"
                style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.line2}` }}
              >
                <span className="text-xs" style={{ color: C.dim }}>{label}</span>
                <span className="font-mono text-sm" style={{ color: color as string }}>{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-md px-3 py-2" style={{ background: 'rgba(34,211,238,0.07)', border: '1px solid #164E63' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: '#67E8F9' }}>
              深度记录不会清零。重新接入后会回到最近的中继站，不用从头再走。
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={startGame}
              disabled={busy}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
              style={{ background: C.cyan, color: '#062A33' }}
            >
              {info.rebirth ? `从 ${info.rebirth.code} 重新接入` : '重新接入'}
            </button>
            <button
              onClick={openRank}
              className="flex-1 rounded-lg py-2.5 text-sm"
              style={{ border: `1px solid ${C.line}`, color: C.dim }}
            >
              看排行榜
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 未开始 ----------
  if (phase === 'intro') {
    return shell(
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="font-mono text-[11px] tracking-[0.18em]" style={{ color: C.cyan }}>signal dive</div>
          <h3 className="mt-2 text-xl" style={{ color: C.text }}>信号深潜</h3>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed" style={{ color: C.dim }}>
            一关一题。答对稳住信号并下潜一层，答错会让信号崩解。
            信号耗尽就断线，但会从最近的中继站重新接入 —— 走过的路不必再走。
          </p>

          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            {[
              ['初始信号', `${hpInit}`],
              ['答对', `+${state?.config?.hp_gain ?? 10}`],
              ['答错', `−${state?.config?.hp_penalty ?? 30}`],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg py-2" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                <div className="text-[11px]" style={{ color: C.mute }}>{k}</div>
                <div className="mt-0.5 font-mono text-sm" style={{ color: C.text }}>{v}</div>
              </div>
            ))}
          </div>

          {state && state.total_levels > 0 && (
            <p className="mt-4 text-xs" style={{ color: C.mute }}>
              历史最深 {Math.max(state.best_round_levels, state.round_levels)} 层 · 累计 {state.total_levels} 层 · 断线 {state.deaths} 次
            </p>
          )}

          <button
            onClick={startGame}
            disabled={busy}
            className="mt-6 w-full rounded-lg py-3 text-sm font-medium disabled:opacity-50"
            style={{ background: C.cyan, color: '#062A33' }}
          >
            {busy ? '正在接入…' : (state && state.total_levels > 0 ? '继续下潜' : '开始下潜')}
          </button>
          <button
            onClick={openRank}
            className="mt-2 w-full rounded-lg py-2 text-xs"
            style={{ color: C.dim }}
          >
            先看看排行榜
          </button>
        </div>
      </div>
    );
  }

  // ---------- 游戏中 ----------
  const isFill = question?.type === 'fill_blank';
  /** 累计深度：打穿一轮后 round_no+1、seq 归 1，光看 seq 会显得越打越浅 */
  const curSeq = level?.seq ?? state?.seq ?? 1;
  const curRound = state?.round_no ?? 1;
  const cumDepth = (curRound - 1) * 70 + curSeq;
  /**
   * 处于「必须订正」状态：刚答错时看本地反馈；刷新/返回后本地反馈已丢，
   * 就靠服务端的 pending_correction 恢复订正入口。
   */
  const fixing = needFix || (!!feedback && !feedback.dead);
  /** 答错后用来把正确选项标绿：只认单个字母（B 这种），富文本答案不动 */
  const correctLetter = (() => {
    if (isFill || !feedback?.correctAnswer) return '';
    const s = String(feedback.correctAnswer).trim().toUpperCase();
    return /^[A-F]$/.test(s) ? s : '';
  })();
  const timeDanger = remaining !== null && remaining <= 10;

  return shell(
    <>
      {/* 顶部状态 */}
      <div className="px-5 pt-4" style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 12 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] tracking-[0.16em]" style={{ color: danger ? C.red : C.cyan }}>signal dive</span>
            {combo >= 2 && (
              <span
                key={combo}
                className="sv-pop rounded px-1.5 py-0.5 font-mono text-[11px]"
                style={{ background: 'rgba(52,211,153,0.12)', color: C.green }}
              >
                × {combo} 连对
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px]" style={{ color: C.mute }}>
              第 {cumDepth} 层 · 第 {curRound} 轮
            </span>
            <button onClick={openRank} className="text-[11px] px-2 py-0.5 rounded" style={{ border: `1px solid ${C.line}`, color: C.dim }}>
              排行
            </button>
          </div>
        </div>

        {danger && (
          <div className="mt-2 rounded px-2 py-1 sv-pulse" style={{ background: 'rgba(239,68,68,0.14)' }}>
            <span className="text-[11px]" style={{ color: '#FCA5A5' }}>信号崩解临界 · 再错一次即断线</span>
          </div>
        )}

        {/* 刚解锁一个重生点：剧情只展示一次，学生可以关掉 */}
        {checkpointStory && (
          <div className="mt-2 rounded-md px-3 py-2" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid #78350F' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-[10px] tracking-widest" style={{ color: C.amber }}>
                  checkpoint anchored · {checkpointStory.code}
                </div>
                <div className="mt-1 text-xs leading-relaxed" style={{ color: '#FDE68A' }}>
                  {checkpointStory.story || '中继站已锚定，断线后会回到这里。'}
                </div>
              </div>
              <button
                onClick={() => setCheckpointStory(null)}
                className="shrink-0 text-sm leading-none"
                style={{ color: C.mute }}
                title="知道了"
              >
                ×
              </button>
            </div>
          </div>
        )}

        <div className="mt-2 flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl" style={{ color: C.text }}>{level?.code || ''}</span>
            <span className="text-xs" style={{ color: C.dim }}>{level?.title || ''}</span>
          </div>
          <div className="relative flex items-baseline gap-1">
            <span className="text-[11px]" style={{ color: danger ? '#FCA5A5' : C.mute }}>信号</span>
            <span className="font-mono text-lg" style={{ color: barColor }}>{Math.round(hp)}</span>
            {hpFloat && (
              <span
                className="sv-rise absolute -top-1 right-0 font-mono text-sm"
                style={{ color: hpFloat.good ? C.green : C.red }}
              >
                {hpFloat.text}
              </span>
            )}
          </div>
        </div>

        <div className="mt-1.5 flex gap-[3px]">
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className="h-[7px] flex-1 rounded-sm transition-colors duration-300"
              style={{ background: i < cells ? barColor : '#1B2536' }}
            />
          ))}
        </div>
      </div>

      {/* 题目 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {notice && (
          <div className="mb-2 rounded-md px-3 py-1.5 text-[11px]" style={{ background: 'rgba(239,68,68,0.14)', border: '1px solid #5A2020', color: '#FCA5A5' }}>
            {notice}
          </div>
        )}
        <div className="rounded-xl p-4" style={{ background: C.panel, border: `1px solid ${fixing ? '#5A2020' : C.line}` }}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px]" style={{ color: C.mute }}>
              question · {isFill ? '填空' : '选择'}
            </span>
            {remaining !== null && (
              <span className="font-mono text-xs" style={{ color: timeDanger ? C.red : C.dim }}>{fmtLeft}</span>
            )}
          </div>

          <div
            className="sv-rte mt-2 text-[15px] leading-relaxed"
            style={{ color: C.text }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(question?.content || '') }}
          />

          {isFill ? (
            <div className="mt-3">
              <input
                value={fillValue}
                onChange={(e) => setFillValue(e.target.value)}
                disabled={fixing || busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    if (fixing) doCorrect();
                    else submit(fillValue.trim());
                  }
                }}
                placeholder={fixing ? '订正：重新输入正确答案' : '输入答案后回车'}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }}
              />
            </div>
          ) : (
            <div className="mt-3 space-y-1.5">
              {(question?.options || []).map((opt, i) => {
                const letter = LETTERS[i];
                const on = picked === letter;
                const disabled = fixing || busy;
                const isRight = !!correctLetter && correctLetter === letter;
                const isWrong = fixing && !!correctLetter && picked === letter && !isRight;
                return (
                  <button
                    key={i}
                    disabled={disabled}
                    onClick={() => {
                      if (fixing) return;
                      setPicked(letter);
                      submit(letter);
                    }}
                    className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors"
                    style={{
                      border: `1px solid ${isRight ? C.green : isWrong ? C.red : on ? C.cyan : C.line}`,
                      background: isRight
                        ? 'rgba(52,211,153,0.10)'
                        : isWrong
                          ? 'rgba(239,68,68,0.10)'
                          : on
                            ? 'rgba(34,211,238,0.08)'
                            : 'transparent',
                      opacity: disabled && !on && !isRight && !isWrong ? 0.65 : 1,
                    }}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[11px]"
                      style={{
                        background: isRight ? C.green : isWrong ? C.red : on ? C.cyan : '#1B2536',
                        color: isRight || isWrong || on ? '#062A33' : C.dim,
                      }}
                    >
                      {letter}
                    </span>
                    <span
                      className="min-w-0 flex-1 text-sm sv-rte"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(String(opt)) }}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* 答错：解析 + 订正 */}
          {(feedback || fixing) && (
            <div className="mt-3 rounded-lg p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid #5A2020' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: '#FCA5A5' }}>
                  {feedback
                    ? (feedback.restored
                        ? '本题已答错 · 需订正后才能继续'
                        : (feedback.timeout ? '时间到 · 按答错处理' : `信号 ${feedback.hpDelta} · 链路受损`))
                    : '本题已答错 · 需订正后才能继续'}
                </span>
                {!!feedback?.correctAnswer && (
                  <span className="font-mono text-[11px]" style={{ color: C.dim }}>正确答案 {feedback.correctAnswer}</span>
                )}
              </div>
              {!!feedback?.explanation && (
                <div
                  className="sv-rte mt-2 text-xs leading-relaxed"
                  style={{ color: '#CBD5E1' }}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(feedback.explanation) }}
                />
              )}
              {fixing && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px]" style={{ color: C.amber }}>
                    订正正确才能继续（不扣血也不加血）
                  </p>
                  {isFill ? (
                    <div className="flex gap-2">
                      <input
                        value={fillValue}
                        onChange={(e) => setFillValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) doCorrect();
                        }}
                        placeholder="重新输入正确答案"
                        className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }}
                      />
                      <button
                        onClick={doCorrect}
                        disabled={busy || !fillValue.trim()}
                        className="rounded-lg px-4 text-xs disabled:opacity-40"
                        style={{ background: C.cyan, color: '#062A33' }}
                      >
                        订正
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(question?.options || []).map((_o, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setPicked(LETTERS[i]);
                            void doCorrectChoice(LETTERS[i]);
                          }}
                          disabled={busy}
                          className="h-8 w-8 rounded font-mono text-xs"
                          style={{ border: `1px solid ${C.line}`, color: C.text }}
                        >
                          {LETTERS[i]}
                        </button>
                      ))}
                    </div>
                  )}
                  {correctHint && (
                    <p className="mt-2 text-[11px]" style={{ color: '#FCA5A5' }}>{correctHint}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px]" style={{ color: C.mute }}>
          <span>本轮已过 {state?.round_levels ?? 0} 层 · 累计 {state?.total_levels ?? 0} 层</span>
          <span>{state?.config?.require_correction ? '答错须订正' : '答错可直接继续'}</span>
        </div>
      </div>
    </>
  );

};
