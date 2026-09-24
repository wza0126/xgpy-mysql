// PK 专属荣誉判定（纯函数，无 DB 依赖）
//
// 设计要点：
// 1. **判定全部为纯函数**，便于冒烟脚本直接交叉验证，不用真跑一局对战。
// 2. **幂等靠「状态跃迁」而非计数**：连胜类荣誉用 floor(new/N) > floor(old/N)，
//    与练习侧 perfect_10 的判定范式一致（见 index.js 的 newStreak>=10 那段）。
//    这样同一段连胜不会因为每局结算都被重复发放。
// 3. 荣誉只做「计数 + 展示」，不附带 buff —— PK 的荣誉是成就型，
//    与练习侧（带暴击 buff/debuff）定位不同，避免 PK 变成刷 buff 的通道。

/** PK 专属荣誉定义（唯一来源：前端图鉴、后端 API、toast 都从这里对齐口径） */
const PK_HONORS = [
  {
    type: 'pk_streak_3',
    name: '连胜达人',
    icon: '🔥',
    description: 'PK 对战累计达成 3 连胜（每满 3 场计一次）',
    column: 'pk_streak_3_times',
  },
  {
    type: 'pk_flawless',
    name: '零失误',
    icon: '💎',
    description: 'PK 单局全部答对且至少作答 1 题',
    column: 'pk_flawless_times',
  },
  {
    type: 'pk_comeback',
    name: '愈战愈勇',
    icon: '🚀',
    description: 'PK 对战中场落后，最终反超获胜',
    column: 'pk_comeback_times',
  },
];

/** 连胜达人所需连胜场次 */
const STREAK_THRESHOLD = 3;

/**
 * 计算本局结算后的连胜场次
 * @param {number} oldStreak 结算前的连胜场次
 * @param {'win'|'lose'|'draw'} result 本局结果
 * @returns {number} 新的连胜场次（输或平即清零）
 */
function calcNewWinStreak(oldStreak, result) {
  const prev = Math.max(0, Math.floor(Number(oldStreak) || 0));
  return result === 'win' ? prev + 1 : 0;
}

/**
 * 判定本局结算触发了哪些 PK 荣誉
 *
 * @param {object} p
 * @param {'win'|'lose'|'draw'} p.result     本局结果
 * @param {number} p.oldWinStreak            结算前的连胜场次
 * @param {number} p.newWinStreak            结算后的连胜场次
 * @param {number} p.correct                 本局做对题数
 * @param {number} p.wrong                   本局做错题数
 * @param {boolean} p.behindAtHalf           本局过半时是否落后
 * @returns {Array<{type:string,name:string,icon:string,description:string}>}
 */
function judgePkHonors(p) {
  const honors = [];
  const {
    result, oldWinStreak = 0, newWinStreak = 0,
    correct = 0, wrong = 0, behindAtHalf = false,
  } = p || {};

  // ① 连胜达人：每跨过一个 3 的倍数发一次（状态跃迁，幂等）
  const oldMilestone = Math.floor(Math.max(0, oldWinStreak) / STREAK_THRESHOLD);
  const newMilestone = Math.floor(Math.max(0, newWinStreak) / STREAK_THRESHOLD);
  if (newMilestone > oldMilestone) {
    honors.push(PK_HONORS.find((h) => h.type === 'pk_streak_3'));
  }

  // ② 零失误：全对且至少作答 1 题（要求作答数 > 0，避免「一题没答」也算零失误）
  if (correct > 0 && wrong === 0) {
    honors.push(PK_HONORS.find((h) => h.type === 'pk_flawless'));
  }

  // ③ 愈战愈勇：过半时落后 + 最终获胜
  if (behindAtHalf && result === 'win') {
    honors.push(PK_HONORS.find((h) => h.type === 'pk_comeback'));
  }

  return honors.filter(Boolean);
}

/**
 * 掷骰判定 PK 装备掉落
 *
 * 与练习侧口径一致：每件装备独立掷骰，判据 Math.random()*100 < 实际掉率。
 * 实际掉率 = 装备基础 drop_rate × 活动系数。
 *
 * @param {Array<{id,name,icon,drop_rate,crit_bonus}>} equipments 可掉落装备
 * @param {number} multiplier 掉率系数（1.0 = 与练习一致）
 * @param {() => number} [rand] 随机源，便于测试注入
 * @returns {Array<{id,name,icon,crit_bonus}>} 本次掉落的装备
 */
function rollEquipmentDrops(equipments, multiplier, rand = Math.random) {
  const list = Array.isArray(equipments) ? equipments : [];
  const k = Number.isFinite(Number(multiplier)) ? Math.max(0, Number(multiplier)) : 1;
  const dropped = [];
  for (const eq of list) {
    const base = parseFloat(eq.drop_rate);
    if (!Number.isFinite(base) || base <= 0) continue;
    const effective = base * k;
    if (rand() * 100 < effective) {
      dropped.push({
        id: eq.id,
        name: eq.name,
        icon: eq.icon,
        crit_bonus: parseFloat(eq.crit_bonus) || 0,
      });
    }
  }
  return dropped;
}

module.exports = {
  PK_HONORS,
  STREAK_THRESHOLD,
  calcNewWinStreak,
  judgePkHonors,
  rollEquipmentDrops,
};
