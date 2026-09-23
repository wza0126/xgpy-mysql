// PK 对战 socket.io 入口
// 设计文档 3.1 socket.io 集成 + 3.4 事件清单

const { Server } = require('socket.io');
const SecureAuth = require('../secure-auth');
const matcher = require('./matcher');
const roomManager = require('./roomManager');
const battleEngine = require('./battleEngine');

/**
 * 兼容解析 JSON 字段：mysql2 对 JSON 列默认返回已解析的对象/数组，
 * 直接 JSON.parse 会抛 SyntaxError；此处兼容 字符串/已解析对象/null。
 */
function parseJsonField(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length > 0 ? v : null;
  if (typeof v === 'object') return Object.keys(v).length > 0 ? v : null;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (parsed == null) return null;
      if (Array.isArray(parsed) && parsed.length === 0) return null;
      if (typeof parsed === 'object' && Object.keys(parsed).length === 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 读取「掌握题目阈值」（system_config.master_question_threshold，默认 3）。
 * 与练习门禁 / 学情分析 / index.js 的 getMasterThreshold 同源，不要另设阈值。
 */
async function getMasterThreshold(pool) {
  try {
    const [rows] = await pool.query(
      "SELECT value FROM system_config WHERE config_key = 'master_question_threshold' LIMIT 1"
    );
    if (!rows.length) return 3;
    let v = rows[0].value;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { /* 保持字符串 */ }
    }
    const parsed = parseInt(typeof v === 'object' && v !== null ? v.value : v, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
  } catch {
    return 3;
  }
}

/** 把 qualification_mastered_clusters 解析为字符串数组（兼容 mysql2 已解析的 JSON 与 TEXT） */
function parseMasteredClusters(raw) {
  if (raw == null) return [];
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (Array.isArray(v)) return v.map(n => String(n || '').trim()).filter(Boolean);
  return [];
}

/**
 * 统计指定一级类目范围（含全部小节）内的已掌握题数。
 * 口径与练习模块一致：source='practice' 且同一题答对次数 >= 掌握阈值。
 * @param {string[]} primaryNames 一级类目名；空数组 = 全部范围
 */
async function getMasteredCountInClusters(pool, userId, threshold, primaryNames) {
  const names = Array.isArray(primaryNames) ? primaryNames.filter(Boolean) : [];
  if (names.length === 0) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS n FROM (
         SELECT question_id FROM student_answers
         WHERE student_id = ? AND source = 'practice' AND is_correct = 1
         GROUP BY question_id
         HAVING COUNT(*) >= ?
       ) m`,
      [userId, threshold]
    );
    return Number(rows[0]?.n) || 0;
  }
  const [rows] = await pool.query(
    `SELECT q.cluster_id AS cid FROM (
       SELECT question_id FROM student_answers
       WHERE student_id = ? AND source = 'practice' AND is_correct = 1
       GROUP BY question_id
       HAVING COUNT(*) >= ?
     ) m
     JOIN questions q ON q.id = m.question_id
     WHERE q.cluster_id IS NOT NULL AND q.cluster_id <> ''`,
    [userId, threshold]
  );
  const wanted = new Set(names);
  let count = 0;
  for (const r of rows) {
    const cid = String(r.cid);
    const primary = cid.includes('/') ? cid.split('/')[0] : cid;
    if (wanted.has(primary)) count += 1;
  }
  return count;
}

/**
 * 资格验证：两项条件同时满足才能参加对战。
 *   1. 做对题数   —— 累计 is_correct=1 的作答条数 >= qualification_correct_count
 *   2. 已掌握题数 —— 指定一级类目范围内的已掌握题数 >= qualification_mastered_count
 * 任一阈值为 NULL / 0 即该条件不启用。
 * @param {object} pool 数据库连接池
 * @param {string} userId 学生ID
 * @param {object|null} config 对战配置（可为 null，视为不限制）
 * @returns {{ok: boolean, correct?: number, required?: number, mastered?: number, masteredRequired?: number}}
 */
async function checkQualification(pool, userId, config) {
  const required = config && config.qualification_correct_count
    ? Number(config.qualification_correct_count)
    : 0;
  const masteredRequired = config && config.qualification_mastered_count
    ? Number(config.qualification_mastered_count)
    : 0;
  if (required <= 0 && masteredRequired <= 0) return { ok: true };

  const [rows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM student_answers WHERE student_id = ? AND is_correct = 1',
    [userId]
  );
  const correct = rows[0].cnt || 0;

  let mastered = 0;
  if (masteredRequired > 0) {
    const threshold = await getMasterThreshold(pool);
    mastered = await getMasteredCountInClusters(
      pool, userId, threshold, parseMasteredClusters(config.qualification_mastered_clusters)
    );
  }

  const correctOk = required <= 0 || correct >= required;
  const masteredOk = masteredRequired <= 0 || mastered >= masteredRequired;
  if (correctOk && masteredOk) return { ok: true };

  // 回执带上两项的实际值，前端据此提示缺口
  const reason = !correctOk && !masteredOk ? 'both' : (!correctOk ? 'correct' : 'mastered');
  return {
    ok: false,
    reason,
    correct, required,
    mastered, masteredRequired,
  };
}

/**
 * 解析对战配置的资格要求（按 config_id 或默认激活配置）
 */
async function loadQualificationConfig(pool, configId) {
  const fields = 'qualification_correct_count, qualification_mastered_count, qualification_mastered_clusters';
  if (configId) {
    const [rows] = await pool.query(
      `SELECT ${fields} FROM pk_battle_configs WHERE id = ? AND is_active = 1`,
      [configId]
    );
    return rows[0] || null;
  }
  const [rows] = await pool.query(
    `SELECT ${fields} FROM pk_battle_configs WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

/**
 * 把 pk_battle_configs 行组装成 battleEngine 需要的 config 结构
 *
 * ⚠️ 必须整行透传奖励字段（points_multiplier / *_bonus_rate / consolation_* / first_battle_*），
 * 否则结算时 rewardCfg 全部落到默认值 —— 表现为「教师在界面上设了奖励但完全不生效」。
 * 同时负责 questionCount / tagFilters 等字段的命名转换与 JSON 解析。
 */
function buildBattleConfig(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    duration_seconds: row.duration_seconds,
    questionCount: row.question_count,
    question_count: row.question_count,
    tagFilters: parseJsonField(row.tag_filters),
    clusterFilters: parseJsonField(row.cluster_filters),
    difficultyMin: row.difficulty_min,
    difficultyMax: row.difficulty_max,
    // ===== 奖励配置 =====
    points_multiplier: row.points_multiplier,
    win_bonus_rate: row.win_bonus_rate,
    draw_bonus_rate: row.draw_bonus_rate,
    consolation_points: row.consolation_points,
    consolation_gap: row.consolation_gap,
    first_battle_points: row.first_battle_points,
    daily_battles_target: row.daily_battles_target,
    daily_battles_points: row.daily_battles_points,
  };
}

/**
 * 初始化 PK socket.io
 * @param {object} httpServer HTTP server 实例
 * @param {object} pool 数据库连接池
 */
function init(httpServer, pool) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    path: '/pk-socket/',
  });

  const secureAuth = new SecureAuth(pool);

  // 鉴权中间件
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      console.log('[PK] 鉴权尝试: token存在=', !!token, 'transport=', socket.handshake.query.transport);
      if (!token) {
        console.log('[PK] 鉴权失败: 未提供 token');
        return next(new Error('未提供 token'));
      }
      const validation = await secureAuth.validateToken(token);
      if (!validation.valid) {
        console.log('[PK] 鉴权失败: token无效 -', validation.error);
        return next(new Error('token 无效或已过期'));
      }
      socket.data.user = validation.session;
      console.log('[PK] 鉴权成功: user=', validation.session.username);
      next();
    } catch (err) {
      console.error('[PK] 鉴权异常:', err.message);
      next(new Error('鉴权失败'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    console.log(`[PK] ${user.username} 已连接 socket=${socket.id}`);

    // ========== 匹配相关 ==========
    socket.on('pk:match_quick', async (data = {}) => {
      try {
        const userId = user.userId;

        // 校验班级开关
        const [clsRows] = await pool.query(
          `SELECT c.pk_battle_enabled FROM profiles p
           LEFT JOIN classes c ON p.class_id = c.id WHERE p.id = ?`,
          [userId]
        );
        if (clsRows.length === 0 || !clsRows[0].pk_battle_enabled) {
          return socket.emit('pk:room_error', {
            code: 'class_disabled',
            message: '班级未开启 PK 对战，请联系教师',
          });
        }

        // 校验今日次数
        const [profileRows] = await pool.query(
          'SELECT pk_battles_today, pk_battles_date, pk_rank_tier, pk_rank_stars FROM profiles WHERE id = ?',
          [userId]
        );
        if (profileRows.length === 0) return;
        const profile = profileRows[0];

        // 重置今日计数：数据库日期统一转 YYYY-MM-DD 字符串（mysql2 可能返回 Date 对象）再与服务器本地日期比较
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const bd = profile.pk_battles_date;
        const dbDate = bd instanceof Date
          ? `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`
          : String(bd || '').slice(0, 10);
        let battlesToday = profile.pk_battles_today;
        if (dbDate !== today) {
          await pool.query(
            'UPDATE profiles SET pk_battles_today = 0, pk_battles_date = ? WHERE id = ?',
            [today, userId]
          );
          battlesToday = 0;
        }

        // 取 daily_limit
        const dailyLimit = data.config_id
          ? (await pool.query('SELECT daily_limit FROM pk_battle_configs WHERE id = ? AND is_active = 1', [data.config_id]))[0][0]?.daily_limit
          : null;
        const limit = dailyLimit || 20;

        if (battlesToday >= limit) {
          return socket.emit('pk:room_error', {
            code: 'limit_reached',
            message: `今日对战次数已用完（${battlesToday}/${limit}），明日再来`,
          });
        }

        // 清理残留的 waiting/preparing 房间；对战中才阻塞
        const [inRoom] = await pool.query(
          `SELECT p.room_id, r.status FROM pk_room_players p
           JOIN pk_rooms r ON p.room_id = r.id
           WHERE p.user_id = ? AND r.status IN ('waiting','preparing','battling')`,
          [userId]
        );
        if (inRoom.length > 0) {
          const { room_id, status } = inRoom[0];
          if (status === 'battling') {
            return socket.emit('pk:room_error', {
              code: 'already_in_room',
              message: '你正在对战中，请先完成或投降',
            });
          }
          // waiting/preparing：自动离开后继续匹配
          await roomManager.leaveRoom(pool, { roomId: room_id, userId });
        }

        // 资格验证：所选配置要求「做对题数」与「已掌握题数」同时达标才能参加
        const qualConfig = await loadQualificationConfig(pool, data.config_id);
        const qual = await checkQualification(pool, userId, qualConfig);
        if (!qual.ok) {
          const parts = [];
          if (qual.reason === 'correct' || qual.reason === 'both') {
            parts.push(`做对 ${qual.required} 道题（当前 ${qual.correct} 道）`);
          }
          if (qual.reason === 'mastered' || qual.reason === 'both') {
            parts.push(`掌握 ${qual.masteredRequired} 道题（当前 ${qual.mastered} 道）`);
          }
          return socket.emit('pk:room_error', {
            code: 'qualification',
            message: `需要先${parts.join('，且')}才能参加对战`,
          });
        }

        // 入队
        const ok = matcher.enqueue({
          userId,
          tier: profile.pk_rank_tier || 0,
          stars: profile.pk_rank_stars || 0,
          socketId: socket.id,
          configId: data.config_id,
        });
        if (!ok) {
          return socket.emit('pk:room_error', {
            code: 'cooldown',
            message: '60秒内不可重复发起匹配',
          });
        }

        // 尝试匹配（仅同活动配置）
        const opponent = matcher.findOpponent({
          userId,
          tier: profile.pk_rank_tier || 0,
          stars: profile.pk_rank_stars || 0,
          configId: data.config_id,
        });

        if (opponent) {
          const oppSocket = io.sockets.sockets.get(opponent.socketId);
          // 对手 socket 已断开（如 websocket 升级失败重连中）→ 移出队列并提示重试，避免崩溃
          if (!oppSocket) {
            matcher.removeFromQueue(userId);
            matcher.removeFromQueue(opponent.userId);
            return socket.emit('pk:room_error', {
              code: 'opponent_offline',
              message: '匹配到已离线的对手，请重试',
            });
          }

          // 匹配成功
          matcher.removeFromQueue(userId);
          matcher.removeFromQueue(opponent.userId);

          // 清除双方的匹配超时定时器（防止泄漏）
          if (socket.data.matchCheckTimer) {
            clearInterval(socket.data.matchCheckTimer);
            socket.data.matchCheckTimer = null;
          }
          if (oppSocket.data?.matchCheckTimer) {
            clearInterval(oppSocket.data.matchCheckTimer);
            oppSocket.data.matchCheckTimer = null;
          }

          // 取配置
          let config = null;
          const configId = data.config_id || opponent.configId;
          if (configId) {
            const [cfgRows] = await pool.query(
              'SELECT * FROM pk_battle_configs WHERE id = ? AND is_active = 1',
              [configId]
            );
            config = cfgRows[0];
          }
          // 全局默认
          if (!config) {
            const [activeCfgs] = await pool.query(
              'SELECT * FROM pk_battle_configs WHERE is_active = 1 LIMIT 1'
            );
            config = activeCfgs[0];
          }
          if (!config) {
            config = {
              id: null,
              duration_seconds: 180,
              question_count: 20,
              tag_filters: null,
              cluster_filters: null,
              difficulty_min: null,
              difficulty_max: null,
              // 与旧行为一致的奖励默认值（倍率1 / 赢方×1.5 / 无参与奖励）
              points_multiplier: 1,
              win_bonus_rate: 0.5,
              draw_bonus_rate: 0,
              consolation_points: 0,
              consolation_gap: 2,
              first_battle_points: 0,
              daily_battles_target: 0,
              daily_battles_points: 0,
            };
          }

          // 创建房间
          const { roomId } = await roomManager.createRoom(pool, {
            hostUserId: userId,
            configId: config.id,
            hasRoomCode: false,
          });

          // 加入对手
          await roomManager.joinRoom(pool, { roomId, userId: opponent.userId });

          // 标记双方 ready
          await pool.query(
            'UPDATE pk_room_players SET is_ready = 1 WHERE room_id = ?',
            [roomId]
          );

          // 对手 socket 加入房间
          if (oppSocket) {
            oppSocket.join(roomId);
          }
          socket.join(roomId);

          // 推送匹配成功
          io.to(roomId).emit('pk:match_found', {
            room_id: roomId,
            opponent: { user_id: opponent.userId, tier: opponent.tier, stars: opponent.stars },
          });

          // 开战
          await battleEngine.startBattle(io, pool, {
            roomId,
            config: buildBattleConfig(config),
            playerIds: [userId, opponent.userId],
          });
        } else {
          // 等待匹配
          socket.emit('pk:match_searching', { status: 'searching' });

          // 启动超时检查
          const checkTimeout = setInterval(async () => {
            if (matcher.isTimeout({ userId })) {
              clearInterval(checkTimeout);
              matcher.removeFromQueue(userId);
              // 清除冷却，允许立即更换活动重试
              matcher.removeCooldown(userId);
              socket.emit('pk:match_timeout', {
                message: '暂未匹配到同活动的对手，可更换活动后重试',
              });
            }
          }, 5000);
          socket.data.matchCheckTimer = checkTimeout;
        }
      } catch (err) {
        console.error('[PK] match_quick 错误:', err);
        socket.emit('pk:room_error', { code: 'server_error', message: '服务器错误' });
      }
    });

    socket.on('pk:match_cancel', () => {
      matcher.removeFromQueue(user.userId);
      if (socket.data.matchCheckTimer) {
        clearInterval(socket.data.matchCheckTimer);
      }
    });

    // ========== 房间相关 ==========
    socket.on('pk:room_create', async (data = {}) => {
      try {
        // 清理该用户残留的 waiting/preparing 房间（房主离开则解散，否则仅移除）
        const [oldRooms] = await pool.query(
          `SELECT p.room_id FROM pk_room_players p
           JOIN pk_rooms r ON p.room_id = r.id
           WHERE p.user_id = ? AND r.status IN ('waiting','preparing')`,
          [user.userId]
        );
        for (const row of oldRooms) {
          await roomManager.leaveRoom(pool, { roomId: row.room_id, userId: user.userId });
        }

        // 资格验证：所选配置要求做对指定题数才能参加
        const qualConfig = await loadQualificationConfig(pool, data.config_id);
        const qual = await checkQualification(pool, user.userId, qualConfig);
        if (!qual.ok) {
          return socket.emit('pk:room_error', {
            code: 'qualification',
            message: `需要先做对 ${qual.required} 道题才能参加对战（当前 ${qual.correct} 道）`,
          });
        }

        const { roomId, roomCode } = await roomManager.createRoom(pool, {
          hostUserId: user.userId,
          configId: data.config_id,
          hasRoomCode: true,
        });
        socket.join(roomId);
        socket.emit('pk:room_created', { room_id: roomId, room_code: roomCode });
        // 补发房间状态，让前端 PKRoom 能立即渲染（否则会一直转圈）
        const state = await roomManager.getRoomState(pool, roomId);
        socket.emit('pk:room_updated', { room_id: roomId, state });
      } catch (err) {
        console.error('[PK] room_create 错误:', err);
        socket.emit('pk:room_error', { code: 'create_failed', message: '创建房间失败' });
      }
    });

    socket.on('pk:room_join', async (data = {}) => {
      try {
        const room = await roomManager.findByCode(pool, data.room_code);
        if (!room) {
          return socket.emit('pk:room_error', { code: 'invalid_code', message: '房间码无效' });
        }
        // 资格验证：房间关联配置要求做对指定题数才能加入
        const qualConfig = await loadQualificationConfig(pool, room.config_id);
        const qual = await checkQualification(pool, user.userId, qualConfig);
        if (!qual.ok) {
          return socket.emit('pk:room_error', {
            code: 'qualification',
            message: `需要先做对 ${qual.required} 道题才能参加对战（当前 ${qual.correct} 道）`,
          });
        }
        const result = await roomManager.joinRoom(pool, {
          roomId: room.id,
          userId: user.userId,
        });
        if (!result.success) {
          return socket.emit('pk:room_error', { code: 'join_failed', message: result.error });
        }
        socket.join(room.id);
        // 给加入者推送切视图信号（否则前端停在 lobby，看不到房间）
        socket.emit('pk:room_joined', { room_id: room.id });
        // 推送房间更新给全员（含房主）
        const state = await roomManager.getRoomState(pool, room.id);
        io.to(room.id).emit('pk:room_updated', { room_id: room.id, state });
      } catch (err) {
        console.error('[PK] room_join 错误:', err);
        socket.emit('pk:room_error', { code: 'join_failed', message: '加入房间失败' });
      }
    });

    socket.on('pk:room_kick', async (data = {}) => {
      try {
        const targetUserId = data.user_id;
        if (!targetUserId) return;
        // 找到房主所在房间
        const [pRows] = await pool.query(
          'SELECT room_id FROM pk_room_players WHERE user_id = ? AND is_host = 1',
          [user.userId]
        );
        if (pRows.length === 0) {
          return socket.emit('pk:room_error', { code: 'not_host', message: '只有房主可以踢人' });
        }
        const roomId = pRows[0].room_id;
        // 校验目标在同一房间且非房主
        const [tRows] = await pool.query(
          'SELECT * FROM pk_room_players WHERE room_id = ? AND user_id = ? AND is_host = 0',
          [roomId, targetUserId]
        );
        if (tRows.length === 0) {
          return socket.emit('pk:room_error', { code: 'kick_failed', message: '目标不在本房间' });
        }
        // 移除目标玩家
        await roomManager.leaveRoom(pool, { roomId, userId: targetUserId });
        // 通知被踢者（仍 join 在房间频道，能收到）
        io.to(roomId).emit('pk:room_kicked', { room_id: roomId, user_id: targetUserId });
        // 推送房间更新给房主
        const state = await roomManager.getRoomState(pool, roomId);
        io.to(roomId).emit('pk:room_updated', { room_id: roomId, state });
      } catch (err) {
        console.error('[PK] room_kick 错误:', err);
        socket.emit('pk:room_error', { code: 'kick_failed', message: '踢出失败' });
      }
    });

    socket.on('pk:room_ready', async (data = {}) => {
      try {
        // 优先查 waiting 状态房间（避免残留 battling 房间干扰）
        let [pRows] = await pool.query(
          `SELECT p.room_id FROM pk_room_players p
           JOIN pk_rooms r ON p.room_id = r.id
           WHERE p.user_id = ? AND r.status = 'waiting'
           ORDER BY r.created_at DESC LIMIT 1`,
          [user.userId]
        );
        // waiting 找不到再查 preparing/battling
        if (pRows.length === 0) {
          [pRows] = await pool.query(
            `SELECT p.room_id FROM pk_room_players p
             JOIN pk_rooms r ON p.room_id = r.id
             WHERE p.user_id = ? AND r.status IN ('preparing','battling')
             ORDER BY r.created_at DESC LIMIT 1`,
            [user.userId]
          );
        }
        if (pRows.length === 0) {
          console.log('[PK] room_ready: 未找到活跃房间, user=', user.userId);
          return;
        }
        const roomId = pRows[0].room_id;
        console.log('[PK] room_ready: room=', roomId, 'ready=', data.ready, 'user=', user.userId);
        await roomManager.toggleReady(pool, {
          roomId,
          userId: user.userId,
          ready: data.ready,
        });
        const state = await roomManager.getRoomState(pool, roomId);
        io.to(roomId).emit('pk:room_updated', { room_id: roomId, state });
      } catch (err) {
        console.error('[PK] room_ready 错误:', err);
      }
    });

    socket.on('pk:room_start', async () => {
      try {
        const [pRows] = await pool.query(
          `SELECT p.room_id FROM pk_room_players p
           JOIN pk_rooms r ON p.room_id = r.id
           WHERE p.user_id = ? AND r.status IN ('waiting','preparing','battling')
           ORDER BY r.created_at DESC LIMIT 1`,
          [user.userId]
        );
        if (pRows.length === 0) return;
        const roomId = pRows[0].room_id;

        // 校验房主
        const [roomRows] = await pool.query('SELECT * FROM pk_rooms WHERE id = ?', [roomId]);
        if (roomRows[0].host_user_id !== user.userId) {
          return socket.emit('pk:room_error', { code: 'not_host', message: '只有房主可以开始' });
        }

        const canStart = await roomManager.canStartBattle(pool, roomId);
        if (!canStart.canStart) {
          return socket.emit('pk:room_error', { code: 'not_ready', message: canStart.reason });
        }

        // 取配置
        const configId = roomRows[0].config_id;
        let config = null;
        if (configId) {
          const [cfgRows] = await pool.query('SELECT * FROM pk_battle_configs WHERE id = ?', [configId]);
          config = cfgRows[0];
        }
        if (!config) {
          config = {
            id: null,
            duration_seconds: 180,
            question_count: 20,
            tag_filters: null,
            cluster_filters: null,
            difficulty_min: null,
            difficulty_max: null,
            // 与旧行为一致的奖励默认值（倍率1 / 赢方×1.5 / 无参与奖励）
            points_multiplier: 1,
            win_bonus_rate: 0.5,
            draw_bonus_rate: 0,
            consolation_points: 0,
            consolation_gap: 2,
            first_battle_points: 0,
            daily_battles_target: 0,
            daily_battles_points: 0,
          };
        }

        await battleEngine.startBattle(io, pool, {
          roomId,
          config: buildBattleConfig(config),
          playerIds: canStart.players.map((p) => p.user_id),
        });
      } catch (err) {
        console.error('[PK] room_start 错误:', err);
        socket.emit('pk:room_error', {
          code: 'start_failed',
          message: '开始对战失败: ' + (err.message || String(err)),
        });
      }
    });

    socket.on('pk:room_leave', async () => {
      try {
        const [pRows] = await pool.query(
          `SELECT p.room_id FROM pk_room_players p
           JOIN pk_rooms r ON p.room_id = r.id
           WHERE p.user_id = ? AND r.status IN ('waiting','preparing','battling')
           ORDER BY r.created_at DESC LIMIT 1`,
          [user.userId]
        );
        if (pRows.length === 0) return;
        const roomId = pRows[0].room_id;
        await roomManager.leaveRoom(pool, { roomId, userId: user.userId });
        socket.leave(roomId);
        const state = await roomManager.getRoomState(pool, roomId);
        if (state) {
          io.to(roomId).emit('pk:room_updated', { room_id: roomId, state });
        }
      } catch (err) {
        console.error('[PK] room_leave 错误:', err);
      }
    });

    // ========== 答题相关 ==========
    socket.on('pk:answer_submit', async (data = {}) => {
      try {
        const [pRows] = await pool.query(
          `SELECT p.room_id FROM pk_room_players p
           JOIN pk_rooms r ON p.room_id = r.id
           WHERE p.user_id = ? AND r.status IN ('waiting','preparing','battling')
           ORDER BY r.created_at DESC LIMIT 1`,
          [user.userId]
        );
        if (pRows.length === 0) return;
        const roomId = pRows[0].room_id;
        await battleEngine.submitAnswer(io, pool, {
          roomId,
          userId: user.userId,
          questionId: data.question_id,
          answer: data.answer,
          costMs: data.cost_ms || 0,
        });
      } catch (err) {
        console.error('[PK] answer_submit 错误:', err);
      }
    });

    socket.on('pk:surrender', async () => {
      try {
        const [pRows] = await pool.query(
          `SELECT p.room_id FROM pk_room_players p
           JOIN pk_rooms r ON p.room_id = r.id
           WHERE p.user_id = ? AND r.status IN ('waiting','preparing','battling')
           ORDER BY r.created_at DESC LIMIT 1`,
          [user.userId]
        );
        if (pRows.length === 0) return;
        const roomId = pRows[0].room_id;
        await battleEngine.surrender(io, pool, { roomId, userId: user.userId });
      } catch (err) {
        console.error('[PK] surrender 错误:', err);
      }
    });

    socket.on('pk:reconnect', async (data = {}) => {
      try {
        if (!data.room_id) return;
        const res = await battleEngine.handleReconnect(io, pool, {
          roomId: data.room_id,
          userId: user.userId,
          socketId: socket.id,
        });
        if (res && res.status === 'battling') {
          // 对局恢复：重新加入房间房间频道（收 tick/结算等）
          socket.join(data.room_id);
        } else if (!res || res.status === 'gone') {
          // 对局不存在/已结束：让前端回大厅并清本地记录
          socket.emit('pk:room_error', { code: 'battle_gone', message: '对局已结束' });
        }
      } catch (err) {
        console.error('[PK] reconnect 错误:', err);
      }
    });

    // ========== 断线处理 ==========
    socket.on('disconnect', async () => {
      console.log(`[PK] ${user.username} 断开连接 socket=${socket.id}`);
      matcher.removeFromQueue(user.userId);
      if (socket.data.matchCheckTimer) {
        clearInterval(socket.data.matchCheckTimer);
      }
      // 检查是否在房间/对战中
      try {
        const [pRows] = await pool.query(
          `SELECT p.room_id, r.status FROM pk_room_players p
           JOIN pk_rooms r ON p.room_id = r.id
           WHERE p.user_id = ? AND r.status IN ('battling','waiting','preparing')`,
          [user.userId]
        );
        if (pRows.length > 0) {
          const { room_id, status } = pRows[0];
          if (status === 'battling') {
            await battleEngine.handleDisconnect(io, pool, {
              roomId: room_id,
              userId: user.userId,
            });
          } else {
            // waiting/preparing：房主离开则解散，否则仅移除该玩家
            await roomManager.leaveRoom(pool, { roomId: room_id, userId: user.userId });
            const state = await roomManager.getRoomState(pool, room_id);
            if (state) {
              io.to(room_id).emit('pk:room_updated', { room_id, state });
            }
          }
        }
      } catch (err) {
        console.error('[PK] disconnect 处理错误:', err);
      }
    });
  });

  // 服务器重启时恢复
  battleEngine.recoverBattles(pool).catch((err) => {
    console.error('[PK] 恢复对战状态失败:', err);
  });

  return io;
}

module.exports = { init };
