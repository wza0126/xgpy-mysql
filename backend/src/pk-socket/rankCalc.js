// PK 对战段位与积分计算
// 规则文档：docs/superpowers/specs/2026-08-26-pk-battle-design.md 第 6 节

/**
 * 段位层级常量
 */
const RANK_TIERS = [
  { tier: 0, name: '小学生', icon: '🎒', color: 'blue' },
  { tier: 1, name: '初中生', icon: '📚', color: 'cyan' },
  { tier: 2, name: '高中生', icon: '🏫', color: 'green' },
  { tier: 3, name: '本科生', icon: '🎓', color: 'purple' },
  { tier: 4, name: '研究生', icon: '🔬', color: 'gold' },
];

/**
 * 获取段位展示信息
 */
function getRankInfo(tier, stars) {
  const info = RANK_TIERS[tier] || RANK_TIERS[0];
  return { ...info, stars };
}

/**
 * 应用星数变化（含升降级 + 0保底）
 * @param {number} tier  当前段位层级 0-4
 * @param {number} stars 当前星数
 * @param {number} delta 变化量（正加负减）
 * @returns {{tier: number, stars: number}}
 */
function applyStars(tier, stars, delta) {
  let newStars = stars + delta;
  let newTier = tier;

  if (newStars > 5 && tier < 4) {
    // 满5星赢 → 升级（研究生除外）
    newTier = tier + 1;
    newStars = 1;
  } else if (newStars < 0) {
    if (tier === 0) {
      // 小学生0星保底
      newStars = 0;
    } else {
      // 其他段位0星输 → 降一级到5星
      newTier = tier - 1;
      newStars = 5;
    }
  }
  // 研究生(tier=4)星数无上限，保持累加
  return { tier: newTier, stars: newStars };
}

/**
 * 计算对战双方段位与积分变化
 * @param {number} winnerTier
 * @param {number} winnerStars
 * @param {number} loserTier
 * @param {number} loserStars
 * @returns {{winner: {tier,stars}, loser: {tier,stars}, winnerPkDelta, loserPkDelta}}
 */
function calcRankChange(winnerTier, winnerStars, loserTier, loserStars) {
  const diff = Math.abs(winnerTier - loserTier);
  const winnerIsLower = winnerTier < loserTier;

  let winnerStarDelta, loserStarDelta, winnerPkDelta, loserPkDelta;

  if (diff === 0) {
    // 同级对战
    winnerStarDelta = +1;
    loserStarDelta = -1;
    winnerPkDelta = +1;
    loserPkDelta = -1;
  } else if (diff === 1) {
    // 差1级：低段赢 +1/-1；高段赢 +0/-0
    if (winnerIsLower) {
      winnerStarDelta = +1;
      loserStarDelta = -1;
      winnerPkDelta = +1;
      loserPkDelta = -1;
    } else {
      // 高段位赢：高+0 低-0
      winnerStarDelta = +0;
      loserStarDelta = -0;
      winnerPkDelta = +0;
      loserPkDelta = -0;
    }
  } else {
    // 差2级及以上：低段赢 +2/-1；高段赢 +0/-0
    if (winnerIsLower) {
      winnerStarDelta = +2;
      loserStarDelta = -1;
      winnerPkDelta = +2;
      loserPkDelta = -1;
    } else {
      // 高段位赢：高+0 低-0
      winnerStarDelta = +0;
      loserStarDelta = -0;
      winnerPkDelta = +0;
      loserPkDelta = -0;
    }
  }

  const winnerResult = applyStars(winnerTier, winnerStars, winnerStarDelta);
  const loserResult = applyStars(loserTier, loserStars, loserStarDelta);

  return {
    winner: winnerResult,
    loser: loserResult,
    winnerPkDelta,
    loserPkDelta,
  };
}

/**
 * 判定胜负（不含投降/断线，仅按得分）
 * @param {object} a  { score, durationMs }
 * @param {object} b  { score, durationMs }
 * @returns {'a_win'|'b_win'|'draw'}
 */
function judgeByScore(a, b) {
  if (a.score > b.score) return 'a_win';
  if (b.score > a.score) return 'b_win';
  // 同分看耗时（少者胜）
  if (a.durationMs < b.durationMs) return 'a_win';
  if (b.durationMs < a.durationMs) return 'b_win';
  return 'draw';
}

/**
 * 计算系统通用积分发放
 * @param {number} correct       做对题数
 * @param {boolean} isWinner     是否赢方
 * @param {number} basePoints    每题基础分（system_config.points_correct_answer，默认10）
 * @returns {number}
 */
function calcSystemPoints(correct, isWinner, basePoints = 10) {
  const base = correct * basePoints;
  if (isWinner) {
    return Math.floor(base * 1.5); // 赢方 +50%
  }
  return base;
}

module.exports = {
  RANK_TIERS,
  getRankInfo,
  applyStars,
  calcRankChange,
  judgeByScore,
  calcSystemPoints,
};
