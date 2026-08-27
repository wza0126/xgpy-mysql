// PK 房间状态机 + 数据库持久化
// 设计文档 3.3 房间状态机 + 5.2 房间流程

const crypto = require('crypto');

/**
 * 内存中的房间状态缓存
 * key: roomId, value: { room, players: Map<userId, {socketId, ...}> }
 */
const roomsCache = new Map();

/**
 * 生成唯一 roomId
 */
function generateRoomId() {
  return 'pk_' + crypto.randomBytes(8).toString('hex');
}

/**
 * 生成 4 位房间码（查唯一）
 */
async function generateUniqueRoomCode(pool) {
  for (let i = 0; i < 10; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const [rows] = await pool.query(
      'SELECT id FROM pk_rooms WHERE room_code = ? AND status IN (?, ?)',
      [code, 'waiting', 'preparing']
    );
    if (rows.length === 0) return code;
  }
  throw new Error('生成房间码失败：10次尝试均冲突');
}

/**
 * 创建房间（写库 + 缓存）
 * @param {object} pool 数据库连接池
 * @param {object} params { hostUserId, configId, hasRoomCode }
 * @returns {object} { roomId, roomCode }
 */
async function createRoom(pool, { hostUserId, configId, hasRoomCode }) {
  const roomId = generateRoomId();
  let roomCode = null;
  if (hasRoomCode) {
    roomCode = await generateUniqueRoomCode(pool);
  }

  await pool.query(
    `INSERT INTO pk_rooms (id, config_id, room_code, host_user_id, status)
     VALUES (?, ?, ?, ?, 'waiting')`,
    [roomId, configId || null, roomCode, hostUserId]
  );

  await pool.query(
    `INSERT INTO pk_room_players (id, room_id, user_id, is_host, is_ready)
     VALUES (?, ?, ?, 1, 0)`,
    [crypto.randomBytes(8).toString('hex'), roomId, hostUserId]
  );

  // 缓存
  roomsCache.set(roomId, {
    room: { id: roomId, configId, roomCode, hostUserId, status: 'waiting' },
    players: new Map([[hostUserId, { isHost: true, isReady: false }]]),
  });

  return { roomId, roomCode };
}

/**
 * 加入房间
 * @returns {object} { success, error? }
 */
async function joinRoom(pool, { roomId, userId }) {
  // 检查房间状态
  const [rows] = await pool.query(
    `SELECT * FROM pk_rooms WHERE id = ? FOR UPDATE`,
    [roomId]
  );
  if (rows.length === 0) return { success: false, error: '房间不存在' };
  if (rows[0].status !== 'waiting') return { success: false, error: '房间已开始或已结束' };

  // 检查玩家数
  const [players] = await pool.query(
    'SELECT COUNT(*) as cnt FROM pk_room_players WHERE room_id = ?',
    [roomId]
  );
  if (players[0].cnt >= 2) return { success: false, error: '房间已满' };

  // 写库
  await pool.query(
    `INSERT INTO pk_room_players (id, room_id, user_id, is_host, is_ready)
     VALUES (?, ?, ?, 0, 0)`,
    [crypto.randomBytes(8).toString('hex'), roomId, userId]
  );

  // 更新缓存
  const cached = roomsCache.get(roomId);
  if (cached) {
    cached.players.set(userId, { isHost: false, isReady: false });
  }

  return { success: true };
}

/**
 * 通过房间码查房间
 */
async function findByCode(pool, roomCode) {
  const [rows] = await pool.query(
    `SELECT * FROM pk_rooms WHERE room_code = ? AND status IN (?, ?)`,
    [roomCode, 'waiting', 'preparing']
  );
  return rows[0] || null;
}

/**
 * 切换准备状态
 */
async function toggleReady(pool, { roomId, userId, ready }) {
  await pool.query(
    'UPDATE pk_room_players SET is_ready = ? WHERE room_id = ? AND user_id = ?',
    [ready ? 1 : 0, roomId, userId]
  );
  const cached = roomsCache.get(roomId);
  if (cached) {
    const p = cached.players.get(userId);
    if (p) p.isReady = ready;
  }
}

/**
 * 检查全员准备 + 玩家数=2
 */
async function canStartBattle(pool, roomId) {
  const [players] = await pool.query(
    'SELECT * FROM pk_room_players WHERE room_id = ?',
    [roomId]
  );
  if (players.length !== 2) return { canStart: false, reason: '需要2名玩家' };
  const allReady = players.every((p) => p.is_ready);
  if (!allReady) return { canStart: false, reason: '有玩家未准备' };
  return { canStart: true, players };
}

/**
 * 离开房间
 * 若是房主离开 → 房间解散；否则仅移除该玩家
 */
async function leaveRoom(pool, { roomId, userId }) {
  const [rows] = await pool.query('SELECT * FROM pk_rooms WHERE id = ?', [roomId]);
  if (rows.length === 0) return { dissolved: false };
  const room = rows[0];

  await pool.query('DELETE FROM pk_room_players WHERE room_id = ? AND user_id = ?', [
    roomId,
    userId,
  ]);

  const cached = roomsCache.get(roomId);
  if (cached) cached.players.delete(userId);

  if (room.host_user_id === userId) {
    // 房主离开 → 解散
    await pool.query(
      "UPDATE pk_rooms SET status = 'abandoned' WHERE id = ?",
      [roomId]
    );
    if (cached) {
      cached.room.status = 'abandoned';
      roomsCache.delete(roomId);
    }
    return { dissolved: true };
  }

  // 对手离开 → 房主继续等待
  return { dissolved: false };
}

/**
 * 获取房间状态（含玩家列表）
 * 用多查询避免 GROUP_CONCAT 拼 JSON 的兼容问题
 */
async function getRoomState(pool, roomId) {
  const [rows] = await pool.query(
    `SELECT r.*,
            c.name AS config_name,
            c.duration_seconds AS config_duration,
            c.question_count AS config_question_count,
            c.tag_filters AS config_tag_filters,
            c.cluster_filters AS config_cluster_filters,
            c.difficulty_min AS config_difficulty_min,
            c.difficulty_max AS config_difficulty_max
     FROM pk_rooms r
     LEFT JOIN pk_battle_configs c ON r.config_id = c.id
     WHERE r.id = ?`,
    [roomId]
  );
  if (rows.length === 0) return null;
  const room = rows[0];

  const [players] = await pool.query(
    `SELECT p.*, pr.username, pr.real_name, pr.pk_rank_tier, pr.pk_rank_stars
     FROM pk_room_players p
     JOIN profiles pr ON p.user_id = pr.id
     WHERE p.room_id = ?`,
    [roomId]
  );

  // 构造配置摘要（config_id 为 null 时用默认值，方便前端展示）
  const config = {
    name: room.config_name || '默认对战',
    duration_seconds: room.config_duration != null ? room.config_duration : 180,
    question_count: room.config_question_count != null ? room.config_question_count : 20,
    tag_filters: room.config_tag_filters,
    cluster_filters: room.config_cluster_filters,
    difficulty_min: room.config_difficulty_min,
    difficulty_max: room.config_difficulty_max,
  };

  return {
    id: room.id,
    room_code: room.room_code,
    status: room.status,
    host_user_id: room.host_user_id,
    config_id: room.config_id,
    config,
    players: players.map((p) => ({
      user_id: p.user_id,
      username: p.username,
      real_name: p.real_name,
      is_host: p.is_host,
      is_ready: p.is_ready,
      tier: p.pk_rank_tier,
      stars: p.pk_rank_stars,
    })),
  };
}

/**
 * 清理超时等待房间（5分钟无对手）
 */
async function cleanupStaleWaitingRooms(pool) {
  await pool.query(
    `UPDATE pk_rooms SET status = 'abandoned'
     WHERE status = 'waiting'
       AND created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`
  );
}

module.exports = {
  createRoom,
  joinRoom,
  findByCode,
  toggleReady,
  canStartBattle,
  leaveRoom,
  getRoomState,
  cleanupStaleWaitingRooms,
  roomsCache,
};
