import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { backendClient } from '../../../api/backendClient';
import { Keyboard3D } from './Keyboard3D';
import { GALAXY_WORDS, seededRandom } from './KeyboardData';

interface Lesson {
  id: number;
  title: string;
  icon: string;
  desc: string;
  chars: string;   // 本章涉及的键
  wordMode?: boolean;
}

const LESSONS: Lesson[] = [
  { id: 1, title: '基准键位', icon: '🏠', desc: '双手食指摸到 f、j 键上的凸点定位，其余手指自然落在 a s d f 与 j k l ; 上。这是盲打的原点，任何按键后手指都要回到这里。', chars: 'asdfjkl;' },
  { id: 2, title: '字母行扩展', icon: '🚀', desc: '从基准键出发：左手小指负责 q/a/z，无名指 w/s/x，中指 e/d/c，食指 r/t/f/g/v/b；右手食指 y/u/h/j/n/m，中指 i/k，无名指 o/l，小指 p。', chars: 'qwertyuiopasdfghjklzxcvbnm' },
  { id: 3, title: '完整指法分区', icon: '🎯', desc: '上方数字行与常用符号同样按手指分区：左手 12345，右手 67890。符号键 - = [ ] ; \' , . / 归各自手指，打完后回到基准键位。', chars: '1234567890-=[];\',./' },
  { id: 4, title: 'Python 词练习', icon: '🐍', desc: '把学测 36 个 Python 关键字/内置函数连打熟练，边打边记中文释义，为单人游戏冲刺做准备！', chars: '', wordMode: true },
];

const LESSON_SAVE_KEY = 'keyboard_galaxy_lesson';

export const LessonView: React.FC = () => {
  const { user } = useAuth();
  const [lessonIdx, setLessonIdx] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  // 练习状态
  const [practice, setPractice] = useState('');
  const [typed, setTyped] = useState('');
  const [wrong, setWrong] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [blocked, setBlocked] = useState(false); // 达标判定未通过（未解锁下一章）
  const [minWpm, setMinWpm] = useState(0); // 入座门槛 WPM（章节解锁速度要求）
  const activeKeyRef = useRef<string | null>(null);
  const startAtRef = useRef<number | null>(null);

  const lesson = LESSONS[lessonIdx];

  // 读取入座门槛参数（指法学堂解锁速度要求）
  useEffect(() => {
    backendClient.get('/api/typing/config')
      .then(res => {
        const d = res?.data;
        if (d) setMinWpm(parseInt(d.duel_min_wpm) || 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${LESSON_SAVE_KEY}_${user?.id || 'guest'}`);
      if (raw) setCompleted(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [user?.id]);

  // 生成练习串
  const newPractice = (l: Lesson): string => {
    if (l.wordMode) {
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
    while (s.length < 40) s += l.chars[Math.floor(rand() * l.chars.length)];
    return s;
  };

  const startLesson = () => {
    setPractice(newPractice(lesson));
    setTyped('');
    setWrong(0);
    setStartAt(null);
    setDone(false);
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
          // 完成判定：本章速度需达到入座门槛 WPM，才算完成并解锁下一章
          const sec = Math.max((Date.now() - startAtRef.current) / 1000, 1);
          const w = Math.round(practice.length / 5 / (sec / 60));
          setDone(true);
          if (minWpm > 0 && w < minWpm) {
            setBlocked(true); // 未达标，不计入完成
          } else {
            setBlocked(false);
            setLessonIdx(i => {
              const newDone = [...completed, lesson.id];
              setCompleted(Array.from(new Set(newDone)));
              try {
                localStorage.setItem(`${LESSON_SAVE_KEY}_${user?.id || 'guest'}`, JSON.stringify(Array.from(new Set(newDone))));
              } catch { /* ignore */ }
              return i;
            });
          }
        }
      } else {
        setWrong(w => w + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice, typed, done, startAt, lesson.id, completed, user?.id, minWpm]);

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
  const maxUnlocked = Math.max(0, ...completed);

  return (
    <div className="h-full flex flex-col px-5 py-4">
      <div className="shrink-0 flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-amber-300"><i className="fa-solid fa-graduation-cap mr-2"></i>指法学堂</h2>
        <span className="text-xs text-indigo-300">完成 {completed.length}/4 章</span>
      </div>

      {/* 章节选择 */}
      <div className="shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {LESSONS.map((l, i) => {
          const done = completed.includes(l.id);
          const active = i === lessonIdx;
          const locked = i > maxUnlocked; // 上一章未达标完成时锁定
          return (
            <button
              key={l.id}
              disabled={locked}
              onClick={() => { setLessonIdx(i); setPractice(''); setDone(false); setTyped(''); setBlocked(false); }}
              className={`text-left rounded-xl border px-3 py-2.5 transition-all ${
                active ? 'border-violet-400 bg-indigo-900/40' : done ? 'border-emerald-500/40 bg-emerald-900/20' : locked ? 'border-gray-800/50 bg-black/30 opacity-40 cursor-not-allowed' : 'border-gray-700/50 bg-black/20'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{locked ? '🔒' : l.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{l.title}</div>
                  <div className="text-[10px] text-indigo-300">{done ? '✅ 已完成' : locked ? (minWpm > 0 ? `需达 ${minWpm} WPM 解锁` : '未完成') : '未完成'}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
        {/* 教学说明 */}
        <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/50 px-4 py-3 text-sm leading-relaxed text-gray-100">
          <b className="text-amber-300">第 {lessonIdx + 1} 章 · {lesson.title}：</b>{lesson.desc}
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
                  ⚠️ 本章速度未达到 {minWpm} WPM，暂不计入完成，再练一次达标即可解锁下一章！
                </span>
              ) : done ? (
                <span className="text-xs text-emerald-300 self-center">
                  {lessonIdx < LESSONS.length - 1 ? '已解锁下一章，点上方章节进入！' : '🎉 全部章节完成，去单人游戏实战吧！'}
                </span>
              ) : null}
            </div>
            {!done && <p className="mt-2 text-[10px] text-indigo-400">直接打字即可，错误会闪烁计数（不计入正确率）</p>}
          </div>
        ) : (
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/40 px-4 py-6 text-center">
            <p className="text-sm text-indigo-200 mb-3">先看键位图熟悉本章指法，然后开始练习</p>
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
