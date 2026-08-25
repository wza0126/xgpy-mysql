import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { backendClient } from '../../../api/backendClient';
import { Keyboard3D } from './Keyboard3D';
import { GALAXY_WORDS, seededRandom, fingerOfChar, Finger } from './KeyboardData';

interface SubLesson {
  id: number;
  title: string;
  icon: string;
  desc: string;
  chars: string;   // 本小节涉及的键（由指法映射推导）
}

interface Lesson {
  id: number;
  title: string;
  icon: string;
  desc: string;
  chars: string;   // 本章涉及的键
  wordMode?: boolean;
  subLessons?: SubLesson[]; // 第 2 章的小节（手指专项）
}

// ==================== 第 2 章手指小节生成 ====================
// 由 KeyboardData 的指法映射自动推导，保证与键位图高亮一致
const ALL_ALPHA = 'abcdefghijklmnopqrstuvwxyz';
// 加入小节训练的符号键：, 归右手中指、. 归右手无名指、; / 归右手小指
const SUB_SYMBOLS = ',.;/';

function charsForFingers(fingers: Finger[]): string {
  return (ALL_ALPHA + SUB_SYMBOLS).split('').filter(ch => fingers.includes(fingerOfChar(ch))).join('');
}

const SUB_LESSON_DEFS: { id: number; title: string; icon: string; desc: string; fingers: Finger[] }[] = [
  {
    id: 1, title: '食指', icon: '👆',
    desc: '左右手食指分管：左手食指负责 r t f g v b，右手食指负责 y u h j n m。摸到 f、j 凸点后斜向上伸，是盲打最常用的一对手指。',
    fingers: ['li', 'ri'],
  },
  {
    id: 2, title: '中指', icon: '✌️',
    desc: '左右手中指分管：左手中指负责 e d c，右手中指负责 i k，以及右下方的逗号 ,。从中指基准键 d、k 出发，向上伸一格敲 e、i，向下伸一格敲 c、逗号。',
    fingers: ['lm', 'rm'],
  },
  {
    id: 3, title: '无名指', icon: '💍',
    desc: '左右手无名指分管：左手无名指负责 w s x，右手无名指负责 o l，以及右下方的句号 .。无名指力量较弱，练习时注意放松，用指尖轻敲，不要抬腕。',
    fingers: ['lr', 'rr'],
  },
  {
    id: 4, title: '小手指', icon: '🤙',
    desc: '左右手小指分管：左手小指负责 q a z，右手小指负责 p，以及右上方的分号 ; 和右下方的斜杠 /。小指最短、最容易够不着，练习时手掌稍向两侧移动借力。',
    fingers: ['lp', 'rp'],
  },
  {
    id: 5, title: '所有手指', icon: '🖐️',
    desc: '把第 2 章全部 26 个字母与常用符号 , . ; / 连起来练，各手指灵活切换、打完回到基准键位，为进入第 3 章做好准备！',
    fingers: ['lp', 'lr', 'lm', 'li', 'ri', 'rm', 'rr', 'rp'],
  },
];

const LESSONS: Lesson[] = [
  { id: 1, title: '基准键位', icon: '🏠', desc: '双手食指摸到 f、j 键上的凸点定位，其余手指自然落在 a s d f 与 j k l ; 上。这是盲打的原点，任何按键后手指都要回到这里。', chars: 'asdfjkl;' },
  {
    id: 2, title: '字母行扩展', icon: '🚀',
    desc: '从基准键出发，按手指分 5 小节逐个攻克：食指 → 中指 → 无名指 → 小手指 → 所有手指。每节达标才能解锁下一节，全达标后解锁下一章。',
    chars: ALL_ALPHA,
    subLessons: SUB_LESSON_DEFS.map(def => ({
      id: def.id,
      title: def.title,
      icon: def.icon,
      desc: def.desc,
      chars: charsForFingers(def.fingers),
    })),
  },
  { id: 3, title: '完整指法分区', icon: '🎯', desc: '上方数字行与常用符号同样按手指分区：左手 12345，右手 67890。符号键 - = [ ] ; \' , . / 归各自手指，打完后回到基准键位。', chars: '1234567890-=[];\',./' },
  { id: 4, title: 'Python 词练习', icon: '🐍', desc: '把学测 36 个 Python 关键字/内置函数连打熟练，边打边记中文释义，为单人游戏冲刺做准备！', chars: '', wordMode: true },
];

// ==================== 进度存储（单 key 对象结构） ====================
// key: keyboard_galaxy_lesson_<uid>
// 值: { ch: number[], sub: Record<number, number[]> }
//   ch  = 已达标完成的章节 id（第 2 章 5 小节全达标后才加入）
//   sub = 各章已达标小节 id 列表（目前仅第 2 章）
interface LessonProgress {
  ch: number[];
  sub: Record<number, number[]>;
}

const LESSON_SAVE_KEY = 'keyboard_galaxy_lesson';

function loadProgress(userId: string | undefined): LessonProgress {
  try {
    const raw = localStorage.getItem(`${LESSON_SAVE_KEY}_${userId || 'guest'}`);
    if (!raw) return { ch: [], sub: {} };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // 旧格式 number[]（已完成章节列表）→ 迁移：已通过第 2 章的视为 5 小节全完成
      const ch = parsed;
      const sub: Record<number, number[]> = {};
      if (ch.includes(2)) sub[2] = [1, 2, 3, 4, 5];
      return { ch, sub };
    }
    if (parsed && Array.isArray(parsed.ch)) {
      return { ch: parsed.ch, sub: parsed.sub || {} };
    }
  } catch { /* ignore */ }
  return { ch: [], sub: {} };
}

function writeLocalProgress(userId: string | undefined, prog: LessonProgress) {
  try {
    localStorage.setItem(`${LESSON_SAVE_KEY}_${userId || 'guest'}`, JSON.stringify(prog));
  } catch { /* ignore */ }
}

// 合并两份进度（取并集）：用户在多个浏览器分别完成不同章节时，合并后保留全部进度
function mergeProgress(a: LessonProgress, b: LessonProgress): LessonProgress {
  const ch = Array.from(new Set([...(a.ch || []), ...(b.ch || [])]));
  const sub: Record<number, number[]> = {};
  const keys = new Set<number>([...Object.keys(a.sub || {}).map(Number), ...Object.keys(b.sub || {}).map(Number)]);
  for (const k of keys) {
    sub[k] = Array.from(new Set([...(a.sub?.[k] || []), ...(b.sub?.[k] || [])]));
  }
  return { ch, sub };
}

// 上报进度到后端（账号级同步，跨浏览器共享）
function syncProgressRemote(userId: string | undefined, prog: LessonProgress) {
  if (!userId) return;
  backendClient.put('/api/keyboard-galaxy/lesson/progress', { progress: prog })
    .catch(() => { /* 静默失败，本地仍有数据 */ });
}

function saveProgress(userId: string | undefined, prog: LessonProgress) {
  writeLocalProgress(userId, prog);
  syncProgressRemote(userId, prog);
}

export const LessonView: React.FC = () => {
  const { user } = useAuth();
  const [lessonIdx, setLessonIdx] = useState(0);
  const [subIdx, setSubIdx] = useState(0); // 第 2 章内的小节索引
  const [prog, setProg] = useState<LessonProgress>(() => loadProgress(user?.id));
  // 练习状态
  const [practice, setPractice] = useState('');
  const [typed, setTyped] = useState('');
  const [wrong, setWrong] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [blocked, setBlocked] = useState(false); // 达标判定未通过（未解锁下一节/章）
  const [minWpm, setMinWpm] = useState(0); // 入座门槛 WPM（章节解锁速度要求）
  const activeKeyRef = useRef<string | null>(null);
  const startAtRef = useRef<number | null>(null);

  const lesson = LESSONS[lessonIdx];
  const subLesson = lesson.subLessons ? lesson.subLessons[subIdx] : null;
  const subCompleted = lesson.subLessons ? (prog.sub[lesson.id] || []) : [];

  // 读取入座门槛参数（指法学堂解锁速度要求）
  useEffect(() => {
    backendClient.get('/api/typing/config')
      .then(res => {
        const d = res?.data;
        if (d) setMinWpm(parseInt(d.duel_min_wpm) || 0);
      })
      .catch(() => {});
  }, []);

  // 启动时：先用本地缓存快速渲染，再从后端拉取云端进度合并（跨浏览器同步）
  useEffect(() => {
    if (!user?.id) {
      setProg(loadProgress(user?.id));
      return;
    }
    const local = loadProgress(user.id);
    setProg(local);
    let cancelled = false;
    backendClient.get('/api/keyboard-galaxy/lesson/progress')
      .then(res => {
        if (cancelled) return;
        const remote = res?.data?.progress;
        if (!remote || !Array.isArray(remote.ch)) return;
        // 取并集：用户在多个浏览器分别完成不同章节时，合并保留全部进度
        const merged = mergeProgress(local, remote);
        writeLocalProgress(user.id, merged);
        setProg(merged);
      })
      .catch(() => { /* 网络失败时本地缓存仍可用 */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  // 生成练习串
  const newPractice = (): string => {
    if (subLesson) {
      const rand = seededRandom(String(Date.now()));
      let s = '';
      while (s.length < 40) s += subLesson.chars[Math.floor(rand() * subLesson.chars.length)];
      return s;
    }
    if (lesson.wordMode) {
      const words = GALAXY_WORDS.map(w => w.text);
      const rand = seededRandom(String(Date.now()));
      const picked: string[] = [];
      while (picked.join(' ').length < 40) {
        picked.push(words[Math.floor(rand() * words.length)]);
      }
      return picked.join(' ');
    }
    const rand = seededRandom(String(Date.now()));
    let s = '';
    while (s.length < 40) s += lesson.chars[Math.floor(rand() * lesson.chars.length)];
    return s;
  };

  const startLesson = () => {
    setPractice(newPractice());
    setTyped('');
    setWrong(0);
    setStartAt(null);
    setDone(false);
    setBlocked(false);
    startAtRef.current = null;
  };

  // 切换章节/小节时重置练习状态
  const selectLesson = (i: number) => {
    setLessonIdx(i);
    setSubIdx(0);
    setPractice('');
    setDone(false);
    setTyped('');
    setBlocked(false);
    startAtRef.current = null;
  };

  const selectSubLesson = (i: number) => {
    setSubIdx(i);
    setPractice('');
    setDone(false);
    setTyped('');
    setBlocked(false);
    startAtRef.current = null;
  };

  useEffect(() => {
    if (!practice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const ch = e.key;
      if (!/^[a-zA-Z0-9;',.\/\[\]=\- ]$/.test(ch)) return;
      e.preventDefault();
      if (done) return;
      if (!startAtRef.current) { startAtRef.current = Date.now(); setStartAt(Date.now()); }
      const target = practice[typed.length];
      if (ch === target) {
        const nextTyped = typed + ch;
        setTyped(nextTyped);
        activeKeyRef.current = practice[nextTyped.length] || null;
        if (nextTyped.length >= practice.length) {
          // 完成判定：速度需达到入座门槛 WPM，才算达标并解锁下一节/章
          const sec = Math.max((Date.now() - startAtRef.current) / 1000, 1);
          const w = Math.round(practice.length / 5 / (sec / 60));
          setDone(true);
          if (minWpm > 0 && w < minWpm) {
            setBlocked(true); // 未达标，不计入完成
          } else {
            setBlocked(false);
            if (subLesson) {
              // 小节达标：写入 sub；若本小节全达标则同时完成整章
              setProg(prev => {
                const doneList = Array.from(new Set([...(prev.sub[lesson.id] || []), subLesson.id]));
                const nextSub = { ...prev.sub, [lesson.id]: doneList };
                const allDone = doneList.length >= (lesson.subLessons?.length || 5);
                const ch = allDone
                  ? Array.from(new Set([...prev.ch, lesson.id]))
                  : prev.ch.includes(lesson.id) ? prev.ch.filter(id => id !== lesson.id) : prev.ch;
                const next: LessonProgress = { ch, sub: nextSub };
                saveProgress(user?.id, next);
                return next;
              });
            } else {
              setProg(prev => {
                const ch = Array.from(new Set([...prev.ch, lesson.id]));
                const next: LessonProgress = { ch, sub: prev.sub };
                saveProgress(user?.id, next);
                return next;
              });
            }
          }
        }
      } else {
        setWrong(w => w + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice, typed, done, startAt, lesson.id, subLesson, subIdx, minWpm, user?.id, prog.ch, prog.sub]);

  const stats = useMemo(() => {
    if (!startAt) return { wpm: 0, acc: 100 };
    const sec = Math.max((Date.now() - startAt) / 1000, 1);
    const chars = typed.length;
    const wpm = Math.round(chars / 5 / (sec / 60));
    const acc = Math.round((chars / (chars + wrong)) * 100);
    return { wpm, acc };
  }, [typed, wrong, startAt]);

  const activeKey = !done ? (practice[typed.length] || null) : null;
  // 已完成的最高章节号 → 最多可解锁到其下一章
  const maxUnlocked = Math.max(0, ...prog.ch);

  // 小节解锁：第 1 节恒可练；第 N 节需 N-1 达标
  const subLocked = (i: number) => i > 0 && !subCompleted.includes(i);

  return (
    <div className="h-full flex flex-col px-5 py-4">
      <div className="shrink-0 flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-amber-300"><i className="fa-solid fa-graduation-cap mr-2"></i>指法学堂</h2>
        <span className="text-xs text-indigo-300">完成 {prog.ch.length}/4 章</span>
      </div>

      {/* 章节选择 */}
      <div className="shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {LESSONS.map((l, i) => {
          const done = prog.ch.includes(l.id);
          const active = i === lessonIdx;
          const locked = i > maxUnlocked; // 上一章未达标完成时锁定
          const subCnt = l.subLessons ? (prog.sub[l.id]?.length || 0) : 0;
          return (
            <button
              key={l.id}
              disabled={locked}
              onClick={() => selectLesson(i)}
              className={`text-left rounded-xl border px-3 py-2.5 transition-all ${
                active ? 'border-violet-400 bg-indigo-900/40' : done ? 'border-emerald-500/40 bg-emerald-900/20' : locked ? 'border-gray-800/50 bg-black/30 opacity-40 cursor-not-allowed' : 'border-gray-700/50 bg-black/20'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{locked ? '🔒' : l.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{l.title}</div>
                  <div className="text-[10px] text-indigo-300">
                    {l.subLessons ? (
                      locked ? (minWpm > 0 ? `需达 ${minWpm} WPM 解锁` : '未解锁') : done ? '✅ 已完成' : `小节 ${subCnt}/${l.subLessons.length}`
                    ) : (
                      done ? '✅ 已完成' : locked ? (minWpm > 0 ? `需达 ${minWpm} WPM 解锁` : '未完成') : '未完成'
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 小节切换条（仅第 2 章等含小节的章节） */}
      {lesson.subLessons && (
        <div className="shrink-0 flex flex-wrap gap-1.5 mb-3">
          {lesson.subLessons.map((s, i) => {
            const sDone = subCompleted.includes(s.id);
            const sActive = i === subIdx;
            const locked = subLocked(i);
            return (
              <button
                key={s.id}
                disabled={locked}
                onClick={() => selectSubLesson(i)}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-all ${
                  sActive ? 'border-violet-400 bg-indigo-900/60 text-white font-bold'
                  : sDone ? 'border-emerald-500/40 bg-emerald-900/20 text-emerald-200'
                  : locked ? 'border-gray-800/50 bg-black/30 opacity-40 cursor-not-allowed text-gray-500'
                  : 'border-gray-700/50 bg-black/20 text-indigo-200'
                }`}
              >
                <span>{locked ? '🔒' : s.icon}</span>
                <span>{s.title}</span>
                {sDone && <i className="fa-solid fa-check text-emerald-400 text-[10px]"></i>}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
        {/* 教学说明 */}
        <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/50 px-4 py-3 text-sm leading-relaxed text-gray-100">
          <b className="text-amber-300">
            {subLesson ? `第 ${lessonIdx + 1} 章 · ${lesson.title} · 小节 ${subLesson.id}/5 ${subLesson.title}` : `第 ${lessonIdx + 1} 章 · ${lesson.title}`}：
          </b>
          {subLesson ? subLesson.desc : lesson.desc}
          {subLesson && subIdx < lesson.subLessons!.length - 1 && (
            <span className="ml-1 text-[11px] text-violet-300">达标（{minWpm > 0 ? `≥ ${minWpm} WPM` : '符合要求'}）后解锁下一节。</span>
          )}
        </div>

        {/* 练习区 */}
        {practice ? (
          <div className="rounded-xl border border-violet-400/40 bg-black/30 px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-amber-300 font-bold"><i className="fa-solid fa-keyboard mr-1"></i>跟打练习</span>
              <div className="flex gap-3 text-xs text-indigo-200">
                <span>速度 <b className="text-emerald-300">{stats.wpm} WPM</b></span>
                <span>正确率 <b className="text-emerald-300">{stats.acc}%</b></span>
              </div>
            </div>
            <div className="font-mono text-lg leading-relaxed tracking-wide break-all mb-3">
              <span className="text-gray-500">{typed}</span>
              {!done && practice[typed.length] && (
                <span className="text-white bg-indigo-500/40 rounded px-0.5 animate-pulse">{practice[typed.length]}</span>
              )}
              {!done && <span className="text-gray-600">{practice.slice(typed.length + 1)}</span>}
              {done && <span className="text-emerald-300"> ✨</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={startLesson} className="px-3 py-1.5 rounded-lg text-xs bg-violet-600 hover:bg-violet-500 text-white font-bold transition-colors">
                <i className="fa-solid fa-rotate-right mr-1"></i>{done ? '再来一遍' : '重新开始'}
              </button>
              {done && blocked ? (
                <span className="text-xs text-amber-300 self-center font-bold">
                  ⚠️ 本节速度未达到 {minWpm} WPM，暂不计入完成，再练一次达标即可解锁！
                </span>
              ) : done ? (
                <span className="text-xs text-emerald-300 self-center">
                  {subLesson ? (
                    subIdx < lesson.subLessons!.length - 1
                      ? '已解锁下一小节，点上方小节继续！'
                      : '🎉 本节全部小节完成，已解锁下一章！'
                  ) : lessonIdx < LESSONS.length - 1 ? '已解锁下一章，点上方章节进入！' : '🎉 全部章节完成，去单人游戏实战吧！'}
                </span>
              ) : null}
            </div>
            {!done && <p className="mt-2 text-[10px] text-indigo-400">直接打字即可，错误会闪烁计数（不计入正确率）</p>}
          </div>
        ) : (
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/40 px-4 py-6 text-center">
            <p className="text-sm text-indigo-200 mb-3">先看键位图熟悉本节指法，然后开始练习</p>
            <button onClick={startLesson} className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold transition-all">
              <i className="fa-solid fa-bolt mr-1"></i>开始练习
            </button>
          </div>
        )}

        {/* 3D 键位图 */}
        <div className="rounded-xl border border-indigo-400/30 bg-black/20 px-3 py-3">
          <Keyboard3D activeKey={activeKey} collapsible showHint />
        </div>
      </div>
    </div>
  );
};
