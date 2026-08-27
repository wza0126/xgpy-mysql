// PK 对战匹配队列（内存优先）
// 设计文档 5.1 匹配流程

/**
 * 匹配队列（内存）
 * 结构：{ userId, tier, stars, socketId, configId, joinedAt }
 */
const matchQueue = [];

/**
 * 最近匹配时间戳（防 60 秒内重复入队）
 * key: userId, value: timestamp(ms)
 */
const lastMatchAttempt = new Map();
const MATCH_COOLDOWN_MS = 60 * 1000;

/**
 * 校验是否可入队（60秒内未重复发起）
 */
function canEnterQueue(userId) {
  const last = lastMatchAttempt.get(userId);
  if (last && Date.now() - last < MATCH_COOLDOWN_MS) {
    return false;
  }
  return true;
}

/**
 * 加入匹配队列
 * @returns {boolean} 是否成功入队
 */
function enqueue(user) {
  if (!canEnterQueue(user.userId)) return false;
  // 移除该用户旧记录（防止重复）
  removeFromQueue(user.userId);
  matchQueue.push({ ...user, joinedAt: Date.now() });
  lastMatchAttempt.set(user.userId, Date.now());
  return true;
}

/**
 * 从队列移除
 */
function removeFromQueue(userId) {
  const idx = matchQueue.findIndex((u) => u.userId === userId);
  if (idx >= 0) matchQueue.splice(idx, 1);
}

/**
 * 尝试为指定用户找到匹配对手
 * 教学环境匹配池小，0 秒即可匹配任何人，优先段位差距最小的。
 * 段位差距 = tier 差 × 100 + stars 差；差距越小越优先。
 * 段位差>2 级时积分规则单独处理（赢了不得分/输了扣分），但不阻止匹配。
 * 注意：仅匹配同活动配置（configId 相同，含都为空）的对手，
 *       避免出现「选A活动的玩家匹配后却拿到B活动的题」的错配。
 * @param {object} user { userId, tier, stars, configId }
 * @returns {object|null} 匹配到的对手 or null
 */
function findOpponent(user) {
  const norm = (v) => v || null;
  const candidates = matchQueue.filter(
    (u) => u.userId !== user.userId && norm(u.configId) === norm(user.configId)
  );
  if (candidates.length === 0) return null;

  // 0 秒即可匹配，优先段位差距最小的
  candidates.sort((a, b) => {
    const da = Math.abs(a.tier - user.tier) * 100 + Math.abs(a.stars - user.stars);
    const db = Math.abs(b.tier - user.tier) * 100 + Math.abs(b.stars - user.stars);
    return da - db;
  });
  return candidates[0];
}

/**
 * 检查是否匹配超时（120秒）
 */
function isTimeout(user) {
  const entry = matchQueue.find((u) => u.userId === user.userId);
  if (!entry) return false;
  return Date.now() - entry.joinedAt >= 120000;
}

/**
 * 获取队列状态（调试用）
 */
function getQueueStatus() {
  return matchQueue.map((u) => ({
    userId: u.userId,
    tier: u.tier,
    stars: u.stars,
    waitedSec: Math.floor((Date.now() - u.joinedAt) / 1000),
  }));
}

/**
 * 清除用户的匹配冷却（匹配超时后允许立即换活动重试）
 */
function removeCooldown(userId) {
  lastMatchAttempt.delete(userId);
}

module.exports = {
  enqueue,
  removeFromQueue,
  findOpponent,
  isTimeout,
  canEnterQueue,
  removeCooldown,
  getQueueStatus,
};
