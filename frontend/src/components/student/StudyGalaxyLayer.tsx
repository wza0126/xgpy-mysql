import React, { useMemo } from 'react';

// ===== 桌面「学习星域」图层 =====
// 铺在壁纸之上、桌面图标之下（z-[5]），pointer-events-none —— 纯展示，不抢任何点击。
// 数据来自 /api/student/study-galaxy（后端已做班级开关 + 30s 缓存）。
//
// 【视觉口径】档位（累计作答次数）决定星域的「规模与光效」，知识点掌握决定「哪些星座亮着」。
//   两件事解耦：练得多 = 天更亮；学得扎实 = 星更多点亮。所以可能「星海档但只亮 6 个星座」，
//   这是正确的 —— 不能用练习量假装掌握度。
//
// ⛔ 性能铁律（与暴击卡顿同源）：
//   - 光晕一律用 radialGradient 填充，**不用 feGaussianBlur**（全屏大面积滤镜必掉帧）；
//   - 动画只动 opacity / 小元素的 translate，整屏层不缩放、不加 will-change: transform；
//   - 被动画的节点数按档位封顶（第 5 档约 90 个，且全是 1~3px 的小点）；
//   - 低配机（逻辑核心 ≤ 4）自动降为「轻模式」，动画节点再减半。
//   - 尊重 prefers-reduced-motion：开启后全部动画自动关闭（CSS 层兜底）。

export interface GalaxySection {
  name: string;
  /** 小节编号（1.1.1）：来自 chapter-taxonomy.js 的书写顺序，老后端可能没有 */
  code?: string;
  questions: number;
  mastered_questions: number;
  touched: boolean;
  lit: boolean;
}

export interface GalaxyChapter {
  name: string;
  code: string;
  part: string;
  questions: number;
  mastered_questions: number;
  points: number;
  points_lit: number;
  lit: boolean;
  sections: GalaxySection[];
}

export interface GalaxyNext {
  chapter: string;
  /** 章编号（1.1），老后端可能没有 */
  chapter_code?: string;
  section: string;
  /** 小节编号（1.1.1），老后端可能没有 */
  section_code?: string;
  remain: number;
  total: number;
  mastered: number;
}

export interface GalaxyData {
  enabled: boolean;
  reason?: string;
  tier: number;
  tier_name: string;
  /** 1 = 低动效模式（老师在星域配置里开的），前端把持续动画全关，只留静态星空 */
  low_motion?: number;
  tiers: number[];
  tier_names: string[];
  total_answer: number;
  today_answer: number;
  daily_goal: number;
  // streak_days 已下线（卡片第 3 格改成「今日掌握题数」），后端不再下发，
  // 相应那次 DISTINCT 日期查询也一起去掉了 —— 别再把它加回来。
  master_threshold?: number;
  summary: {
    chapters_lit: number;
    chapters_total: number;
    points_mastered: number;
    points_total: number;
    /** 累计掌握题目数 / 题库总数；老后端可能没有，做兜底 */
    questions_mastered?: number;
    questions_total?: number;
    /** 今日新掌握题数（今天首次跨过掌握线），卡片第 3 格用它 */
    today_mastered?: number;
  };
  next: GalaxyNext | null;
  chapters: GalaxyChapter[];
}

/** 16 个星座锚点（1440×900 设计坐标，4×4）——全部落在 x≥440，天然避开左上图标区（x<380） */
const ANCHORS: [number, number][] = [
  [440, 130], [620, 130], [800, 130], [970, 130],
  [440, 270], [620, 270], [800, 270], [970, 270],
  [440, 410], [620, 410], [800, 410], [970, 410],
  [440, 512], [620, 512], [800, 512], [970, 512],
];

/** 长章名在星座下方显示时的短名（完整名仍在 title 与地图里） */
const SHORT_NAME: Record<string, string> = {
  信息技术发展及其影响: '信息技术发展',
  信息社会伦理道德与法律法规: '信息伦理与法规',
  信息系统的支撑技术: '系统支撑技术',
  信息系统的设计与开发: '系统设计与开发',
  程序设计语言的基本知识: '程序设计语言',
  信息社会及其特征: '信息社会特征',
  算法的程序实现: '算法的实现',
};

/** 五档视觉参数：档位越高，星越多、天体越多、颜色越饱和 */
const VISUAL = [
  { stars: 30, band: 0, nebula: 0, planets: 0, meteors: 0, aurora: 0, glow: 0, star: '#6b7f9e', op: 0.5 },
  { stars: 52, band: 1, nebula: 0, planets: 0, meteors: 0, aurora: 0, glow: 0, star: '#8fa8d4', op: 0.68 },
  { stars: 80, band: 1, nebula: 1, planets: 1, meteors: 0, aurora: 0, glow: 1, star: '#cfe0f7', op: 0.86 },
  { stars: 122, band: 2, nebula: 2, planets: 3, meteors: 2, aurora: 0, glow: 1, star: '#e8f1ff', op: 0.94 },
  { stars: 180, band: 2, nebula: 3, planets: 4, meteors: 4, aurora: 1, glow: 2, star: '#ffffff', op: 1 },
];

/** 动效强度：档位越高，动的元素越多、节奏越快。低档也保留少量闪烁，避免「死屏」 */
// ⛔ 2026-10-24 大幅收缩：SVG 内部元素的 CSS 动画无法交给合成器独立成层，
//    每个动效都会让整块 1600×900 重新光栅化。第 5 档原来有 130+ 个动效元素，
//    实测学生桌面单标签吃掉 16%+ CPU（a 账号累计 1070 次练习正好踩在第 5 档）。
//    这里把「会动的」压到约 1/3：星空密度不变（静态星点全保留），只是闪烁的少了。
//    需要彻底静态时用「低动效模式」开关（study_galaxy_config.low_motion）。
const MOTION = [
  { sparkle: 5, meteor: 0, aurora: 0, beat: 0, trace: 0, baseEvery: 0 },
  { sparkle: 7, meteor: 0, aurora: 0, beat: 0, trace: 1, baseEvery: 22 },
  { sparkle: 9, meteor: 1, aurora: 0, beat: 0, trace: 1, baseEvery: 20 },
  { sparkle: 11, meteor: 2, aurora: 0, beat: 1, trace: 1, baseEvery: 26 },
  { sparkle: 13, meteor: 3, aurora: 1, beat: 1, trace: 1, baseEvery: 24 },
];

const STATE_COLOR = {
  lit: { dot: '#8AF0D0', line: '#5DCAA5', text: '#dbeafe', ring: true },
  touched: { dot: '#93C5FD', line: '#60A5FA', text: '#94a3b8', ring: false },
  none: { dot: '#3b5375', line: '#2b3f5c', text: '#5b6b85', ring: false },
};

/** 固定种子的伪随机：同档位每次渲染星位一致，避免每 10 秒轮询时满天乱跳 */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** 低配机自动降级（教室老机房常见 4 核及以下） */
const LOW_END =
  typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency <= 4
    : false;

interface Props {
  data: GalaxyData;
  /** 专注模式：只留星点与一条今日进度线，关掉一切动画 */
  simple?: boolean;
  /**
   * 点击底部知识点地图里的某一章 → 打开/切换学习模块到该章（clusterId = 章名）；
   * 传 section 时（今日卡「下一个目标」）再滚到该小节。
   */
  onOpenChapter?: (clusterId: string, section?: string) => void;
}

const StudyGalaxyLayerInner: React.FC<Props> = ({ data, simple, onOpenChapter }) => {
  const idx = Math.min(4, Math.max(0, (data.tier || 1) - 1));
  const visual = VISUAL[idx];
  const motion = MOTION[idx];
  // 专注模式 / 低配机 → 动效大幅收缩（但不至于完全没有生气）
  const anim = !simple;
  const scale = LOW_END ? 0.5 : 1;
  const sparkleCount = anim ? Math.max(4, Math.round(motion.sparkle * scale)) : 0;
  const meteorCount = anim ? Math.round(motion.meteor * scale) : 0;
  const baseEvery = anim && !LOW_END ? motion.baseEvery : 0;

  // 背景星：按档位生成一次
  const bgStars = useMemo(() => {
    const r = rng(97 + data.tier * 31);
    const out: { x: number; y: number; r: number; o: number }[] = [];
    for (let i = 0; i < visual.stars; i++) {
      const x = 4 + r() * 1432;
      const y = 4 + r() * 892;
      // 图标避让区（x<380 且 y<650）压暗，保证图标与名字可读
      const avoid = x < 380 && y < 650;
      out.push({
        x,
        y,
        r: 0.5 + r() * 1.25,
        o: (0.22 + r() * 0.6) * (avoid ? 0.28 : 1),
      });
    }
    return out;
  }, [data.tier, visual.stars]);

  // 「会闪的星」：单独一批，比背景星更亮更大，带光晕
  const sparkStars = useMemo(() => {
    const r = rng(5211 + data.tier * 17);
    const out: { x: number; y: number; r: number; halo: boolean; cls: number; dur: number; delay: number }[] = [];
    let guard = 0;
    while (out.length < motion.sparkle && guard++ < 5000) {
      const x = 20 + r() * 1400;
      const y = 18 + r() * 858;
      if (x < 380 && y < 650) continue; // 图标区不放闪烁，避免干扰图标文字
      out.push({
        x,
        y,
        r: 1.1 + r() * 1.7,
        halo: r() > 0.45,
        cls: out.length % 3,
        dur: 2.6 + r() * 3.4,
        delay: r() * 5,
      });
    }
    return out;
  }, [data.tier, motion.sparkle]);

  // 星座几何：每个小节点一颗星，绕锚点均匀分布
  const constellations = useMemo(() => {
    const r = rng(3641);
    return data.chapters.slice(0, 16).map((ch, i) => {
      const [ax, ay] = ANCHORS[i] || [0, 0];
      const n = Math.max(ch.points, 1);
      const rad = 24 + Math.min(26, ch.points * 2.4);
      const pts = ch.sections.map((_, k) => {
        const ang = (k * 2 * Math.PI) / n - Math.PI / 2 + (r() - 0.5) * 0.2;
        const rr = rad * (0.78 + (k % 2) * 0.34);
        return [ax + Math.cos(ang) * rr, ay + Math.sin(ang) * rr] as [number, number];
      });
      const state = ch.lit ? 'lit' : ch.points_lit > 0 || ch.sections.some((s) => s.touched) ? 'touched' : 'none';
      return { ch, ax, ay, pts, state: state as keyof typeof STATE_COLOR, rad };
    });
  }, [data.chapters]);

  const planetPos: [number, number][] = [
    [1206, 690], [470, 760], [1080, 780], [352, 300],
  ];
  const meteorPos: [number, number, number, number][] = [
    [1120, 180, 1200, 232], [520, 700, 588, 740], [900, 90, 962, 128], [700, 790, 762, 828],
  ];

  const todayPct = Math.min(100, Math.round((data.today_answer / Math.max(1, data.daily_goal)) * 100));

  const keyframes = `
@keyframes sg-tw1 { 0%,100% { opacity: .12 } 50% { opacity: 1 } }
@keyframes sg-tw2 { 0%,100% { opacity: .32 } 50% { opacity: .95 } }
@keyframes sg-tw3 { 0%,100% { opacity: .72 } 50% { opacity: .14 } }
@keyframes sg-breathe { 0%,100% { opacity: .58 } 50% { opacity: 1 } }
@keyframes sg-halo { 0%,100% { opacity: .34 } 50% { opacity: .9 } }
@keyframes sg-aurora { 0%,100% { opacity: .24 } 50% { opacity: .6 } }
@keyframes sg-meteor {
  0%   { opacity: 0; transform: translate(0px, 0px) }
  3%   { opacity: 1 }
  12%  { opacity: .85 }
  26%  { opacity: 0; transform: translate(150px, 92px) }
  100% { opacity: 0; transform: translate(150px, 92px) }
}
@keyframes sg-trace { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -1013 } }
@media (prefers-reduced-motion: reduce) { [data-study-galaxy] * { animation: none !important } }
`;

  const animCount =
    sparkleCount * 2 + Math.ceil(visual.stars / Math.max(1, baseEvery || 9999)) + meteorCount +
    visual.planets + (anim ? 6 : 0);

  return (
    <div
      className="absolute inset-0 z-[5] pointer-events-none overflow-hidden"
      data-study-galaxy={data.tier}
      data-study-galaxy-tier={data.tier_name}
      data-study-galaxy-anim={simple ? 0 : animCount}
      data-study-galaxy-lowend={LOW_END ? 1 : 0}
      aria-hidden="true"
    >
      {anim && <style>{keyframes}</style>}

      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block' }}
      >
        <defs>
          <radialGradient id="sg-dot">
            <stop offset="0%" stopColor={visual.star} stopOpacity="0.85" />
            <stop offset="100%" stopColor={visual.star} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sg-neb">
            <stop offset="0%" stopColor="#4a7ab5" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#4a7ab5" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sg-band" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1b3a5c" stopOpacity="0" />
            <stop offset="45%" stopColor="#4a7ab5" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#2a2350" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sg-aurora" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#5DCAA5" stopOpacity="0" />
            <stop offset="32%" stopColor="#5DCAA5" stopOpacity="0.32" />
            <stop offset="70%" stopColor="#A78BFA" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#F472B6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sg-trail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#cfe4ff" stopOpacity="0" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* 银河带（档 2 起出现，档 4 起双层）；高档位缓慢呼吸 */}
        {visual.band > 0 && (
          <ellipse cx="720" cy="520" rx="660" ry="86" fill="url(#sg-band)"
            transform="rotate(-15 720 520)" opacity="0.7"
            style={
              anim && motion.beat
                ? { animation: 'sg-breathe 19s ease-in-out 0s infinite' }
                : { opacity: visual.band === 1 ? 0.7 : 1 }
            } />
        )}
        {visual.band > 1 && (
          <ellipse cx="700" cy="495" rx="560" ry="42" fill="url(#sg-band)"
            transform="rotate(-15 700 495)"
            style={anim && motion.beat ? { animation: 'sg-breathe 15s ease-in-out 2.5s infinite' } : { opacity: 0.9 }} />
        )}

        {/* 星云团 */}
        {Array.from({ length: visual.nebula }).map((_, i) => (
          <ellipse key={`nb${i}`} cx={620 + i * 190} cy={190 + i * 165}
            rx={150 + i * 20} ry={110 + i * 16} fill="url(#sg-neb)"
            style={
              anim
                ? { animation: `sg-breathe ${13 + i * 3}s ease-in-out ${i * 1.7}s infinite` }
                : { opacity: 0.85 }
            } />
        ))}

        {/* 极光（仅星海档）：两条飘带各自呼吸，制造「流动」感 */}
        {visual.aurora > 0 && (
          <>
            <path d="M380,120 Q720,-10 1400,90" stroke="url(#sg-aurora)" strokeWidth="52" fill="none"
              style={anim ? { animation: 'sg-aurora 13s ease-in-out 0s infinite' } : { opacity: 0.42 }} />
            <path d="M420,152 Q760,34 1400,128" stroke="url(#sg-aurora)" strokeWidth="20" fill="none"
              style={anim ? { animation: 'sg-aurora 9s ease-in-out 3.2s infinite' } : { opacity: 0.3 }} />
          </>
        )}

        {/* 背景星：每 N 颗挑一颗做 opacity 呼吸（CSS 动画走合成器，比 SMIL 轻） */}
        {bgStars.map((s, i) => {
          const twinkle = baseEvery > 0 && i % baseEvery === 0;
          return (
            <circle
              key={`s${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill={visual.star}
              opacity={s.o}
              style={
                twinkle
                  ? { animation: `sg-tw${(i % 3) + 1} ${3 + (i % 4)}s ease-in-out ${((i % 7) * 0.45).toFixed(2)}s infinite` }
                  : undefined
              }
            />
          );
        })}

        {/* 会闪的亮星：光晕 + 星核同步呼吸，这是「看起来是活的」主力 */}
        {sparkStars.slice(0, anim ? sparkleCount : 0).map((s, i) => {
          const cls = `sg-tw${s.cls + 1}`;
          return (
            <g key={`sp${i}`}>
              {s.halo && (
                <circle cx={s.x} cy={s.y} r={s.r * 4.2} fill="url(#sg-dot)"
                  style={{ animation: `sg-halo ${s.dur}s ease-in-out ${s.delay.toFixed(2)}s infinite` }} />
              )}
              <circle cx={s.x} cy={s.y} r={s.r} fill="#ffffff"
                style={{ animation: `${cls} ${s.dur}s ease-in-out ${s.delay.toFixed(2)}s infinite` }} />
            </g>
          );
        })}

        {/* 星座：线 + 星点 + 章名。已点亮的星座沿线有一条「流光」跑圈 */}
        {constellations.map(({ ch, ax, ay, pts, state, rad }, ci) => {
          const c = STATE_COLOR[state];
          if (!ch.points) return null;
          const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
          // 流光同时最多 8 条：亮着的全给，进行中的隔一个给一个，控制每帧重绘面积
          const traced =
            anim && motion.trace &&
            (state === 'lit' || (state === 'touched' && ci % 2 === 0));
          return (
            <g key={ch.name}>
              {c.ring && (
                <circle cx={ax} cy={ay} r={rad + 16} fill="none" stroke="#5DCAA5" strokeWidth="0.9"
                  style={anim ? { animation: 'sg-breathe 6.5s ease-in-out infinite' } : { opacity: 0.2 }} />
              )}
              <polyline points={line} fill="none" stroke={c.line}
                strokeWidth={state === 'none' ? 0.6 : 0.95}
                strokeDasharray={state === 'touched' ? '3 4' : undefined}
                opacity={state === 'lit' ? 0.55 : state === 'touched' ? 0.28 : 0.2}
                strokeLinejoin="round" />
              {/* 流光：短亮段沿星座轨迹跑，视觉上「这条星座是活的」 */}
              {traced && (
                <polyline points={line} fill="none" stroke={state === 'lit' ? '#B8FFE9' : '#BFDBFE'}
                  strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray="14 999"
                  style={{ animation: `sg-trace ${state === 'lit' ? 4.6 : 6.4}s linear infinite`, opacity: 0.85 }} />
              )}
              {pts.map((p, k) => (
                <g key={k}>
                  {visual.glow >= 1 && state !== 'none' && (
                    <circle cx={p[0]} cy={p[1]} r={visual.glow === 2 ? 4 : 3} fill="url(#sg-dot)" />
                  )}
                  <circle cx={p[0]} cy={p[1]}
                    r={ch.sections[k]?.lit ? 2.6 : 1.9}
                    fill={ch.sections[k]?.lit ? c.dot : c.dot}
                    style={
                      anim && ch.sections[k]?.lit
                        ? { animation: `sg-tw2 ${3.6 + (k % 3)}s ease-in-out ${(k % 5) * 0.4}s infinite` }
                        : { opacity: ch.sections[k]?.lit ? 0.95 : ch.sections[k]?.touched ? 0.7 : 0.34 }
                    } />
                </g>
              ))}
              <text x={ax} y={ay + rad + 26} textAnchor="middle" fill={c.text}
                fontSize="13" opacity={state === 'none' ? 0.62 : 1}>
                {ch.code && (
                  <tspan fontSize="11.5" opacity="0.85" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {ch.code}{' '}
                  </tspan>
                )}
                <tspan>{SHORT_NAME[ch.name] || ch.name}</tspan>
              </text>
              {ch.lit && (
                <text x={ax} y={ay + rad + 42} textAnchor="middle" fill="#5DCAA5" fontSize="11" opacity="0.85">
                  已点亮
                </text>
              )}
            </g>
          );
        })}

        {/* 行星（操作题累计分）：光晕 + 光环都在呼吸 */}
        {Array.from({ length: visual.planets }).map((_, i) => {
          const [x, y] = planetPos[i] || [0, 0];
          const r = 11 - i * 1.2;
          return (
            <g key={`p${i}`}>
              <circle cx={x} cy={y} r={r * 2.6} fill="url(#sg-dot)"
                style={anim && motion.beat ? { animation: `sg-halo ${7 + i}s ease-in-out ${i * 0.9}s infinite` } : { opacity: 0.35 }} />
              <circle cx={x} cy={y} r={r} fill="#EFB55C" opacity="0.92" />
              <ellipse cx={x} cy={y} rx={r * 1.9} ry={r * 0.42} fill="none" stroke="#EFB55C"
                strokeWidth="0.9" transform={`rotate(-18 ${x} ${y})`}
                style={anim && motion.beat ? { animation: `sg-tw2 ${6 + i * 1.3}s ease-in-out ${i * 0.6}s infinite` } : { opacity: 0.55 }} />
            </g>
          );
        })}

        {/* 流星（连续练习天数）：沿固定方向划过，每颗有独立周期与延迟，看起来是「随机偶发」 */}
        {Array.from({ length: meteorCount }).map((_, i) => {
          const [x1, y1, x2, y2] = meteorPos[i % meteorPos.length] || [0, 0, 0, 0];
          const period = 7.5 + i * 1.9;
          const delay = i * 2.6;
          const style = { animation: `sg-meteor ${period}s linear ${delay}s infinite` };
          return (
            <g key={`m${i}`} style={style}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#sg-trail)" strokeWidth="1.4"
                strokeLinecap="round" style={{ opacity: 0.85 }} />
              <circle cx={x2} cy={y2} r="1.8" fill="#ffffff" style={{ opacity: 0.95 }} />
            </g>
          );
        })}
      </svg>

      {/* ===== 右侧：今日进度 + 下一个目标 ===== */}
      <div className="absolute top-[14%] right-[2%] w-[300px] max-w-[26vw] rounded-2xl border border-slate-400/25 bg-slate-900/85 p-4">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-400/20">
          <div className="relative h-[62px] w-[62px] shrink-0">
            <svg viewBox="0 0 62 62" className="h-full w-full -rotate-90">
              <circle cx="31" cy="31" r="25" fill="none" stroke="#233252" strokeWidth="6" />
              <circle cx="31" cy="31" r="25" fill="none" stroke="#5DCAA5" strokeWidth="6"
                strokeLinecap="round" strokeDasharray={157.1}
                strokeDashoffset={157.1 * (1 - todayPct / 100)}
                style={anim ? { transition: 'stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)' } : undefined} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-100">
              {data.today_answer}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-medium text-slate-100">
              今日 {data.today_answer} / {data.daily_goal} 题
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {data.today_answer >= data.daily_goal
                ? '今日目标已达成'
                : `再练 ${data.daily_goal - data.today_answer} 题达成`}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-start justify-between gap-1">
          <div className="min-w-0">
            <div className="text-xl font-medium leading-none text-emerald-300">
              {data.summary.chapters_lit}
              <span className="text-[11px] text-slate-400">/{data.summary.chapters_total}</span>
            </div>
            <div className="mt-1 text-xs text-slate-400">已点亮星座</div>
          </div>
          <div className="min-w-0">
            <div className="text-xl font-medium leading-none text-sky-300">
              {data.summary.points_mastered}
              <span className="text-[11px] text-slate-400">/{data.summary.points_total}</span>
            </div>
            <div className="mt-1 text-xs text-slate-400">已掌握知识点</div>
          </div>
          {/* 这里原本是「连续练习 N 天」：一周只有两节课，连续天数天然难看，改成「今天掌握的题数」 */}
          <div className="min-w-0" title="今天首次达到掌握（同一道题累计答对 ≥ 掌握阈值）的题数">
            <div className="text-xl font-medium leading-none text-amber-300">
              {data.summary.today_mastered ?? 0}
              <span className="text-[11px] text-slate-400">题</span>
            </div>
            <div className="mt-1 text-xs text-slate-400">今日掌握</div>
          </div>
        </div>

        {data.next && (() => {
          const next = data.next!;
          const clickable = !!onOpenChapter;
          const go = () => onOpenChapter?.(next.chapter, next.section);
          return (
            <div
              data-next-target={clickable ? 1 : 0}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? go : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        go();
                      }
                    }
                  : undefined
              }
              title={
                clickable
                  ? `去学习「${next.chapter_code ? next.chapter_code + ' ' : ''}${next.chapter} · ${next.section_code ? next.section_code + ' ' : ''}${next.section}」（还差 ${next.remain} 题达到掌握）`
                  : `「${next.chapter_code ? next.chapter_code + ' ' : ''}${next.chapter} · ${next.section_code ? next.section_code + ' ' : ''}${next.section}」还差 ${next.remain} 题达到掌握`
              }
              className={`mt-3 rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-3 py-2.5 ${
                clickable
                  ? 'pointer-events-auto cursor-pointer transition-colors hover:border-emerald-300/80 hover:bg-emerald-400/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-300'
                  : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] tracking-wide text-emerald-300">下一个目标</div>
                  <div className="mt-1 text-sm leading-snug text-slate-100">
                    {next.section_code && (
                      <span className="mr-1.5 text-[11px] tabular-nums text-slate-400">{next.section_code}</span>
                    )}
                    {next.section}
                    <span className="ml-1.5 text-xs text-slate-400">还差 {next.remain} 题</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    来自「{next.chapter_code ? `${next.chapter_code} ` : ''}
                    {SHORT_NAME[next.chapter] || next.chapter}」
                  </div>
                </div>
                {clickable && (
                  <span className="shrink-0 self-center whitespace-nowrap text-[11px] text-emerald-200/90">
                    去学习 →
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        <div className="mt-2.5 text-[11px] text-slate-500">
          累计作答 {data.total_answer} 次 · {data.tier_name}档
          {LOW_END ? ' · 轻模式' : ''}
        </div>
      </div>

      {/* ===== 底部：16 章知识点地图 ===== */}
      {!simple && (
        <div className="absolute bottom-[6%] left-[26.4%] w-[700px] max-w-[52vw] rounded-xl border border-slate-400/20 bg-slate-900/65 px-3 py-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[13px] text-slate-400">
              知识点地图 · {data.summary.chapters_total} 章 {data.summary.points_total} 个小节
            </span>
            <span className="text-[11px] text-slate-500">
              <span className="text-emerald-300">青</span>=已点亮
              <span className="mx-1 text-sky-300">蓝</span>=进行中
              <span className="mx-1 text-slate-500">灰</span>=未开始
              {onOpenChapter && <span className="ml-2 text-slate-400">· 点一章去学</span>}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {data.chapters.map((ch) => {
              const pct = ch.points ? Math.round((ch.points_lit / ch.points) * 100) : 0;
              const tone = ch.lit
                ? { name: 'text-slate-100', num: 'text-emerald-300', bar: 'bg-emerald-300', track: 'bg-emerald-900/60' }
                : ch.points_lit > 0 || ch.sections.some((s) => s.touched)
                ? { name: 'text-slate-300', num: 'text-sky-300', bar: 'bg-sky-300', track: 'bg-sky-950' }
                : { name: 'text-slate-500', num: 'text-slate-500', bar: 'bg-slate-500', track: 'bg-slate-800' };
              const clickable = !!onOpenChapter && ch.points > 0;
              return (
                <div
                  key={ch.name}
                  data-chapter={ch.name}
                  data-chapter-clickable={clickable ? 1 : 0}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onOpenChapter!(ch.name) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onOpenChapter!(ch.name);
                          }
                        }
                      : undefined
                  }
                  className={`rounded-md border border-slate-400/15 bg-slate-900/70 px-1.5 py-0.5 ${
                    clickable
                      ? 'pointer-events-auto cursor-pointer transition-colors hover:border-sky-300/70 hover:bg-slate-800/95 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-300'
                      : ''
                  }`}
                  title={
                    clickable
                      ? `${ch.code ? `${ch.code} ` : ''}${ch.name}：已点亮 ${ch.points_lit}/${ch.points} 个小节，掌握 ${ch.mastered_questions}/${ch.questions} 题 · 点击去学习`
                      : `${ch.code ? `${ch.code} ` : ''}${ch.name}：已点亮 ${ch.points_lit}/${ch.points} 个小节，掌握 ${ch.mastered_questions}/${ch.questions} 题`
                  }
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="flex min-w-0 items-baseline gap-1">
                      {/* 章节编号（1.1 / 2.1 …）：来自 chapter-taxonomy.js 的 code，老后端缺字段时自动省略 */}
                      {ch.code && (
                        <span className={`shrink-0 text-[10px] tabular-nums opacity-75 ${tone.num}`}>{ch.code}</span>
                      )}
                      <span className={`truncate text-[11px] ${tone.name}`}>{SHORT_NAME[ch.name] || ch.name}</span>
                    </span>
                    <span className={`shrink-0 text-[11px] ${tone.num}`}>{ch.points_lit}/{ch.points}</span>
                  </div>
                  <div className={`mt-0.5 h-1 overflow-hidden rounded ${tone.track}`}>
                    <div className={`h-full rounded ${tone.bar}`} style={{ width: `${pct}%`, opacity: ch.lit ? 0.95 : 0.8 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const StudyGalaxyLayer = React.memo(StudyGalaxyLayerInner);
export default StudyGalaxyLayer;
