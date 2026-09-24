// PK 对战引擎（出题/计时/收卷/结算）
// 设计文档 5.3 答题流程 + 5.4 结算流程

const crypto = require('crypto');
const { calcRankChange, calcSystemPoints, judgeByScore } = require('./rankCalc');
const { calcNewWinStreak, judgePkHonors, rollEquipmentDrops } = require('./pkHonors');
const roomManager = require('./roomManager');

/**
 * 内存中的对战进行中状态
 * key: roomId, value: { questionIds, endsAt, players: Map<userId, {score, correct, wrong, socketId}> }
 */
const battles = new Map();

/**
 * 每秒 tick 定时器
 * key: roomId, value: setInterval handle
 */
const tickTimers = new Map();

/**
 * 断线宽限定时器
 * key: roomId_userId, value: { timer, graceEndsAt }
 */
const graceTimers = new Map();

/**
 * 从题库抽取题目
 * @param {object} pool
 * @param {object} config { tagFilters, clusterFilters, difficultyMin, difficultyMax, questionCount }
 * @returns {Promise<string[]>} questionId 列表
 */
async function pickQuestions(pool, config) {
  let sql = 'SELECT id FROM questions WHERE 1=1';
  const params = [];

  // 注意：questions 表没有 difficulty 列（migration 001），难度范围筛选忽略

  // 标签筛选：questions.tags 是 JSON 数组，用 JSON_CONTAINS 匹配（含任一标签即命中）
  if (Array.isArray(config.tagFilters) && config.tagFilters.length > 0) {
    const ors = config.tagFilters.map(() => 'JSON_CONTAINS(tags, JSON_QUOTE(?))').join(' OR ');
    sql += ` AND (tags IS NOT NULL AND (${ors}))`;
    params.push(...config.tagFilters);
  }

  // AI 聚类筛选
  if (Array.isArray(config.clusterFilters) && config.clusterFilters.length > 0) {
    const placeholders = config.clusterFilters.map(() => '?').join(',');
    sql += ` AND cluster_id IN (${placeholders})`;
    params.push(...config.clusterFilters);
  }

  sql += ' ORDER BY RAND() LIMIT ?';
  params.push(config.questionCount);

  const [rows] = await pool.query(sql, params);
  return rows.map((r) => r.id);
}

/**
 * 获取题目完整内容（含题干、选项、答案）
 */
async function loadQuestions(pool, questionIds) {
  if (questionIds.length === 0) return [];
  const placeholders = questionIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, type AS question_type, content AS question_text, options AS answers,
            answers AS correct_answer
     FROM questions WHERE id IN (${placeholders})`,
    questionIds
  );
  // 保持 questionIds 的顺序
  return questionIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
}

/**
 * 答案归一化（复用现有测试模块的判定逻辑）
 * 与 frontend PracticeModule / TestModule 的判定保持一致
 */
function normalizeAnswer(answer) {
  if (!answer) return '';
  return String(answer).trim().toLowerCase();
}

/**
 * 解析选项列为数组（兼容 {options:[...]} / 数组 / JSON 字符串 / 键值对象）
 */
function getOptionsArray(optionsRaw) {
  if (Array.isArray(optionsRaw)) return optionsRaw.map((o) => (o && typeof o === 'object' ? o.text ?? o.label ?? o.content ?? String(o) : String(o)));
  if (optionsRaw && typeof optionsRaw === 'object') {
    if (Array.isArray(optionsRaw.options)) return optionsRaw.options.map(String);
    if (Array.isArray(optionsRaw.answers)) return optionsRaw.answers.map(String);
    return Object.values(optionsRaw).map(String);
  }
  if (typeof optionsRaw === 'string') {
    try {
      const parsed = JSON.parse(optionsRaw);
      if (Array.isArray(parsed)) return parsed.map(String);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.options)) return parsed.options.map(String);
    } catch { /* 非 JSON，按单条处理 */ }
    return [optionsRaw];
  }
  return [];
}

/**
 * 判断答案对错
 * 参考后端 taskCheckAnswerCorrect（测试模块标准判分）：
 * - 正确答案可能是字母（"A"）或选项文本，学生答案可能是字母，需用 options 映射
 * - 答案数量 >1 视为多选，多选须全对
 */
function checkAnswer(question, studentAnswer) {
  if (studentAnswer === undefined || studentAnswer === null || studentAnswer === '') return false;

  // correct_answer = 正确答案（loadQuestions 别名后）；answers = 正确答案列（SELECT * 原始行）
  // options = 选项列（SELECT * 原始行才有）。统一取法：优先 question.options，其次 question.answers
  let correctRaw = question.correct_answer;
  if (correctRaw == null) correctRaw = question.answers;
  const options = getOptionsArray(question.options != null ? question.options : question.answers);

  // 正确答案归一为数组（参考练习模块 getAnswers：parsed?.answers || parsed）
  let correctList = [];
  if (Array.isArray(correctRaw)) {
    correctList = correctRaw.map((c) => (c && typeof c === 'object' ? c.text ?? c.label ?? c.content ?? String(c) : String(c)));
  } else if (typeof correctRaw === 'string') {
    try {
      const parsed = JSON.parse(correctRaw);
      if (Array.isArray(parsed)) correctList = parsed.map(String);
      else if (parsed && Array.isArray(parsed.answers)) correctList = parsed.answers.map(String);
      else if (parsed && typeof parsed === 'object') correctList = Object.values(parsed).map(String);
      else correctList = [correctRaw];
    } catch {
      correctList = correctRaw.split(',').map((s) => s.trim());
    }
  } else if (correctRaw && typeof correctRaw === 'object') {
    // {answers: ["A"]} 格式 → 取 answers 字段（与练习模块 getAnswers 一致）
    if (Array.isArray(correctRaw.answers)) correctList = correctRaw.answers.map(String);
    else if (Array.isArray(correctRaw.options)) correctList = correctRaw.options.map(String);
    else correctList = Object.values(correctRaw).flat().map(String);
  }
  correctList = correctList.map((s) => s.trim()).filter(Boolean);
  if (correctList.length === 0) return false;

  const normUser = normalizeAnswer(studentAnswer);
  const questionType = question.question_type || question.type;

  if (questionType === 'fill_blank') {
    return correctList.some((c) => normalizeAnswer(c) === normUser);
  }

  if (questionType === 'choice' || questionType === 'multiple_choice') {
    const isMultiple = questionType === 'multiple_choice' || correctList.length > 1;

    if (isMultiple) {
      // 多选：全对才得分（无序比较字母）
      const userList = String(studentAnswer).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).sort();
      let correctLetters = [];
      const allLetterAnswers = correctList.every((c) => /^[A-Z]$/i.test(c));
      if (allLetterAnswers) {
        correctLetters = correctList.map((c) => c.toUpperCase()).sort();
      } else if (options.length > 0) {
        // 答案存的是选项文本 → 映射到选项字母
        correctList.forEach((c) => {
          const idx = options.findIndex((o) => normalizeAnswer(o) === normalizeAnswer(c));
          if (idx >= 0) correctLetters.push(String.fromCharCode(65 + idx));
        });
        correctLetters.sort();
      } else {
        correctLetters = correctList.map((c) => c.toUpperCase()).sort();
      }
      return userList.length === correctLetters.length && userList.every((v, i) => v === correctLetters[i]);
    }

    // 单选
    if (correctList.some((c) => normalizeAnswer(c) === normUser)) return true;
    const isLetterAnswer = /^[A-Z]$/i.test(normUser);
    if (isLetterAnswer && options.length > 0) {
      // 学生答字母、答案存文本 → 用选项索引映射
      const idx = normUser.toUpperCase().charCodeAt(0) - 65;
      if (idx >= 0 && idx < options.length) {
        const optionText = normalizeAnswer(options[idx]);
        return correctList.some((c) => normalizeAnswer(c) === optionText);
      }
    }
    return false;
  }

  // 其他类型兜底
  return correctList.some((c) => normalizeAnswer(c) === normUser);
}

/**
 * 数值兜底：非有限数时返回默认值
 */
function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 开战（从 preparing → battling）
 * @param {object} io socket.io 实例
 * @param {object} pool
 * @param {object} params { roomId, config, playerIds }
 */
async function startBattle(io, pool, { roomId, config, playerIds }) {
  // 校验双方玩家记录仍在（防止对手在准备阶段断开被 leaveRoom 删记录，
  // 导致对局以单人对战进行、结算时历史数据缺失）
  const [cntRows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM pk_room_players WHERE room_id = ?',
    [roomId]
  );
  if (cntRows[0].cnt !== 2) {
    await pool.query(
      "UPDATE pk_rooms SET status = 'abandoned' WHERE id = ?",
      [roomId]
    );
    io.to(roomId).emit('pk:room_error', {
      code: 'player_missing',
      message: '有玩家已离开房间，无法开始对战',
    });
    return;
  }

  // 抽题
  const questionIds = await pickQuestions(pool, config);
  if (questionIds.length === 0) {
    // 无题可抽 → 解散房间，双方平局
    await pool.query(
      "UPDATE pk_rooms SET status = 'abandoned' WHERE id = ?",
      [roomId]
    );
    io.to(roomId).emit('pk:room_error', { code: 'no_questions', message: '题库范围内无可用题目' });
    return;
  }

  const questions = await loadQuestions(pool, questionIds);
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + config.duration_seconds * 1000);

  // 写库（同时把活动快照写进玩家行：历史统计不再依赖 JOIN，且不受配置改动污染）
  await pool.query(
    `UPDATE pk_rooms SET status = 'battling', question_ids = ?, started_at = ?, ends_at = ?
     WHERE id = ?`,
    [JSON.stringify(questionIds), startedAt, endsAt, roomId]
  );

  await pool.query(
    `UPDATE pk_room_players
     SET config_id = ?, config_name = ?, question_count = ?, duration_seconds = ?
     WHERE room_id = ?`,
    [
      config.id || null,
      config.name || null,
      config.question_count != null ? config.question_count : questionIds.length,
      config.duration_seconds != null ? config.duration_seconds : null,
      roomId,
    ]
  );

  // 缓存对战状态（含活动配置，结算时用于奖励计算，避免再查库且保证与开局一致）
  const battleState = {
    questionIds,
    endsAt: endsAt.getTime(),
    config: config || {},
    players: new Map(
      playerIds.map((uid) => [
        uid,
        {
          score: 0, correct: 0, wrong: 0, durationMs: 0, answered: new Set(),
          // 荣誉「愈战愈勇」用：前半程是否落后过（在赛程过半那一刻判定一次，
          // 之后锁定，避免后期反超再落后再反超导致口径摇摆）
          behindAtHalf: false, halfChecked: false,
        },
      ])
    ),
  };
  battles.set(roomId, battleState);

  // 玩家信息（姓名/段位，供对战页显示）
  const [playerProfiles] = await pool.query(
    `SELECT id, username, real_name, pk_rank_tier, pk_rank_stars
     FROM profiles WHERE id IN (?)`,
    [playerIds]
  );

  // 广播开战
  io.to(roomId).emit('pk:battle_start', {
    questions: questions.map((q) => ({
      id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      answers: q.answers,
      difficulty: q.difficulty,
    })),
    duration: config.duration_seconds,
    ends_at: endsAt.toISOString(),
    players: playerProfiles.map((p) => ({
      user_id: p.id,
      username: p.username,
      real_name: p.real_name,
      tier: p.pk_rank_tier || 0,
      stars: p.pk_rank_stars || 0,
    })),
  });

  // 启动每秒 tick
  const timer = setInterval(() => {
    tick(io, pool, roomId);
  }, 1000);
  tickTimers.set(roomId, timer);
}

/**
 * 每秒 tick：推送剩余时间 + 排行榜，时间到收卷
 */
function tick(io, pool, roomId) {
  const state = battles.get(roomId);
  if (!state) {
    clearTickTimer(roomId);
    return;
  }

  const remaining = Math.max(0, Math.floor((state.endsAt - Date.now()) / 1000));

  // 排行榜（脱敏：仅分数 + 对错数）
  const leaderboard = Array.from(state.players.entries()).map(([userId, p]) => ({
    userId,
    score: p.score,
    correct: p.correct,
    wrong: p.wrong,
  }));

  io.to(roomId).emit('pk:tick', { remaining, leaderboard });

  // 时间到
  if (remaining <= 0) {
    clearTickTimer(roomId);
    finishBattle(io, pool, roomId, 'timeout').catch((err) => {
      console.error('[PK] 超时结算失败:', err);
      // 即使结算失败也通知前端结束，避免卡在答题页
      io.to(roomId).emit('pk:battle_end', { room_id: roomId });
    });
  }
}

/**
 * 提交单题答案
 * @returns {object} { success, correct?, scoreChange?, myScore?, oppScore? }
 */
async function submitAnswer(io, pool, { roomId, userId, questionId, answer, costMs }) {
  const state = battles.get(roomId);
  if (!state) return { success: false, error: '对战不存在或已结束' };

  const player = state.players.get(userId);
  if (!player) return { success: false, error: '非本局玩家' };
  if (player.answered.has(questionId)) {
    return { success: false, error: '已答过此题' };
  }

  // 校验题目属于本局
  if (!state.questionIds.includes(questionId)) {
    return { success: false, error: '非本局题目' };
  }

  // 加载题目
  const [qRows] = await pool.query('SELECT * FROM questions WHERE id = ?', [questionId]);
  if (qRows.length === 0) return { success: false, error: '题目不存在' };
  const question = qRows[0];

  // 校验 costMs 不超过总时长
  if (costMs > (state.endsAt - Date.now()) + 5000) {
    costMs = Math.max(0, state.endsAt - Date.now()); // 异常值剔除
  }

  const isCorrect = checkAnswer(question, answer);
  console.log('[PK] submitAnswer 判分:', {
    questionId,
    type: question.type,
    answer: answer,
    'question.answers': JSON.stringify(question.answers),
    'question.options': JSON.stringify(question.options),
    isCorrect,
  });
  const scoreChange = isCorrect ? +1 : -1;
  player.score += scoreChange;
  if (isCorrect) player.correct += 1;
  else player.wrong += 1;
  player.durationMs += costMs;
  player.answered.add(questionId);

  // 写流水
  await pool.query(
    `INSERT INTO pk_match_answers (room_id, user_id, question_id, answer, is_correct, cost_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [roomId, userId, questionId, answer, isCorrect ? 1 : 0, costMs]
  );

  // 找对手分数
  const otherEntries = Array.from(state.players.entries()).filter(
    ([uid]) => uid !== userId
  );
  const oppScore = otherEntries.length > 0 ? otherEntries[0][1].score : 0;

  // 荣誉「愈战愈勇」判定点：整个房间的作答进度过半时，记录下双方当时是否落后。
  // 判定一次即锁定（halfChecked），保证口径稳定 —— 否则「先落后→反超→再落后」
  // 会随作答顺序得到不同结论。
  if (!state.halfChecked && otherEntries.length > 0) {
    const totalAnswered = Array.from(state.players.values())
      .reduce((s, p) => s + p.answered.size, 0);
    const totalQuestions = state.questionIds.length * state.players.size;
    if (totalQuestions > 0 && totalAnswered >= totalQuestions / 2) {
      state.halfChecked = true;
      const oppPlayer = otherEntries[0][1];
      // 落后 = 自己分数严格低于对手（同分不算落后）
      player.behindAtHalf = player.score < oppPlayer.score;
      oppPlayer.behindAtHalf = oppPlayer.score < player.score;
    }
  }

  // 回提交者
  io.to(roomId).emit('pk:answer_result', {
    question_id: questionId,
    correct: isCorrect,
    score_change: scoreChange,
    my_score: player.score,
    opp_score: oppScore,
  });

  // 广播对手（脱敏）
  io.to(roomId).emit('pk:opponent_scored', {
    opponent_score: player.score,
    opponent_correct: player.correct,
  });

  // 检查双方是否全答完
  const allAnswered = Array.from(state.players.values()).every(
    (p) => p.answered.size >= state.questionIds.length
  );
  if (allAnswered) {
    clearTickTimer(roomId);
    finishBattle(io, pool, roomId, 'all_answered');
  }

  return {
    success: true,
    correct: isCorrect,
    score_change: scoreChange,
    my_score: player.score,
    opp_score: oppScore,
  };
}

/**
 * 投降
 */
async function surrender(io, pool, { roomId, userId }) {
  const state = battles.get(roomId);
  if (!state) return false;
  // 直接结算，标记该玩家负
  clearTickTimer(roomId);
  await finishBattle(io, pool, roomId, 'surrender', { loserId: userId });
  return true;
}

/**
 * 玩家断线处理
 */
async function handleDisconnect(io, pool, { roomId, userId }) {
  const state = battles.get(roomId);
  if (!state) return;

  // 标记断线时间
  await pool.query(
    'UPDATE pk_room_players SET disconnected_at = NOW() WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );

  // 通知对方
  io.to(roomId).emit('pk:opponent_disconnected', { grace_seconds: 60 });

  // 启动 60 秒宽限定时器
  const key = `${roomId}_${userId}`;
  const timer = setTimeout(() => {
    // 超时未重连 → 判该玩家负
    clearTickTimer(roomId);
    finishBattle(io, pool, roomId, 'disconnect_timeout', { loserId: userId });
    graceTimers.delete(key);
  }, 60 * 1000);
  graceTimers.set(key, timer);
}

/**
 * 玩家重连（断线恢复）
 * 返回 { status: 'battling'|'room'|'gone' }
 * - battling：对局进行中，向重连者推送 pk:battle_resume（题目/玩家/时间/已答题）
 * - room：房间等待中，向重连者推送 pk:room_updated
 * - gone：房间不存在/已结束
 */
async function handleReconnect(io, pool, { roomId, userId, socketId }) {
  // 房间状态
  const [roomRows] = await pool.query('SELECT * FROM pk_rooms WHERE id = ?', [roomId]);
  if (roomRows.length === 0) return { status: 'gone' };
  const room = roomRows[0];

  // 对战中：恢复对局状态
  const state = battles.get(roomId);
  if (room.status === 'battling' && state) {
    // 清宽限定时器
    const key = `${roomId}_${userId}`;
    const timer = graceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      graceTimers.delete(key);
    }

    // 清除断线标记
    await pool.query(
      'UPDATE pk_room_players SET disconnected_at = NULL WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );

    // 通知对方
    io.to(roomId).emit('pk:opponent_reconnected', {});

    // 重新加载题目
    const [qRows] = await pool.query(
      `SELECT id, type AS question_type, content AS question_text, options AS answers
       FROM questions WHERE id IN (?)`,
      [state.questionIds]
    );
    const qMap = new Map(qRows.map((q) => [q.id, q]));
    const questions = state.questionIds
      .map((id) => qMap.get(id))
      .filter(Boolean)
      .map((q) => ({
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        answers: q.answers,
      }));

    // 玩家信息 + 当前得分
    const [playerProfiles] = await pool.query(
      `SELECT id, username, real_name, pk_rank_tier, pk_rank_stars
       FROM profiles WHERE id IN (?)`,
      [Array.from(state.players.keys())]
    );
    const players = playerProfiles.map((p) => {
      const ps = state.players.get(p.id) || {};
      return {
        user_id: p.id,
        username: p.username,
        real_name: p.real_name,
        tier: p.pk_rank_tier || 0,
        stars: p.pk_rank_stars || 0,
        score: ps.score || 0,
        correct: ps.correct || 0,
        wrong: ps.wrong || 0,
      };
    });

    // 本玩家已答题集合
    const myState = state.players.get(userId);
    const answered = myState ? Array.from(myState.answered) : [];

    io.to(socketId).emit('pk:battle_resume', {
      room_id: roomId,
      questions,
      players,
      ends_at: new Date(state.endsAt).toISOString(),
      answered,
    });
    return { status: 'battling' };
  }

  // 房间等待中：恢复房间页
  if (room.status === 'waiting' || room.status === 'preparing') {
    // 玩家可能已因断开被 leaveRoom 移出房间，此时不允许恢复
    const [stillIn] = await pool.query(
      'SELECT id FROM pk_room_players WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );
    if (stillIn.length === 0) return { status: 'gone' };
    const rState = await roomManager.getRoomState(pool, roomId);
    if (rState) {
      io.to(socketId).emit('pk:room_updated', { room_id: roomId, state: rState });
      return { status: 'room' };
    }
  }

  return { status: 'gone' };
}

/**
 * 结算
 * @param {string} trigger 'timeout'|'all_answered'|'surrender'|'disconnect_timeout'
 * @param {object?} extra { loserId? }
 */
async function finishBattle(io, pool, roomId, trigger, extra = {}) {
  const state = battles.get(roomId);
  if (!state) return;

  // 防止重复结算
  battles.delete(roomId);
  clearTickTimer(roomId);

  // 房间信息（房间码用于积分流水备注；config_id 兜底）
  const [roomRows] = await pool.query(
    'SELECT room_code, config_id FROM pk_rooms WHERE id = ?',
    [roomId]
  );
  const roomCode = roomRows.length > 0 ? roomRows[0].room_code : null;
  const roomConfigId = roomRows.length > 0 ? roomRows[0].config_id : null;

  // 本局活动配置（开局时缓存在内存状态里，保证结算口径与开局一致）
  const config = state.config || {};

  // 获取玩家信息
  // pk_win_streak 必须取：连胜达人荣誉靠「旧连胜 → 新连胜」的状态跃迁判定，
  // 缺了它就只能拿 pk_total_wins 猜，跨对局连续性无法还原。
  const [playersRows] = await pool.query(
    `SELECT p.*, pr.username, pr.real_name, pr.pk_rank_tier, pr.pk_rank_stars, pr.pk_points,
     pr.pk_win_streak,
     c.pk_battle_enabled, pr.class_id
     FROM pk_room_players p
     JOIN profiles pr ON p.user_id = pr.id
     LEFT JOIN classes c ON pr.class_id = c.id
     WHERE p.room_id = ?`,
    [roomId]
  );

  if (playersRows.length !== 2) {
    // 异常状态 → 平局
    await pool.query("UPDATE pk_rooms SET status = 'finished' WHERE id = ?", [roomId]);
    io.to(roomId).emit('pk:battle_end', { room_id: roomId });
    return;
  }

  const a = playersRows[0];
  const b = playersRows[1];

  // 从内存状态取分数
  const aState = state.players.get(a.user_id) || { score: 0, correct: 0, wrong: 0, durationMs: 0 };
  const bState = state.players.get(b.user_id) || { score: 0, correct: 0, wrong: 0, durationMs: 0 };

  // 合并到 playersRows（behindAtHalf 来自内存状态，荣誉「愈战愈勇」依赖它）
  const playerA = {
    ...a, score: aState.score, correct: aState.correct, wrong: aState.wrong,
    durationMs: aState.durationMs, behindAtHalf: !!aState.behindAtHalf,
    pk_win_streak: Number(a.pk_win_streak) || 0,
  };
  const playerB = {
    ...b, score: bState.score, correct: bState.correct, wrong: bState.wrong,
    durationMs: bState.durationMs, behindAtHalf: !!bState.behindAtHalf,
    pk_win_streak: Number(b.pk_win_streak) || 0,
  };

  // 判定胜负
  let winnerId = null;
  let loserId = null;
  let isDraw = false;

  if (trigger === 'surrender' || trigger === 'disconnect_timeout') {
    loserId = extra.loserId;
    winnerId = playersRows.find((p) => p.user_id !== loserId).user_id;
  } else {
    const result = judgeByScore(
      { score: playerA.score, durationMs: playerA.durationMs },
      { score: playerB.score, durationMs: playerB.durationMs }
    );
    if (result === 'a_win') {
      winnerId = a.user_id;
      loserId = b.user_id;
    } else if (result === 'b_win') {
      winnerId = b.user_id;
      loserId = a.user_id;
    } else {
      isDraw = true;
    }
  }

  // 计算段位变化
  let winnerNewRank = null, loserNewRank = null;
  let winnerPkDelta = 0, loserPkDelta = 0;
  let winnerSystemPts = 0, loserSystemPts = 0;
  // 惜败鼓励分（分别记录，用于落库与流水拆分）
  let consolationWinner = 0, consolationLoser = 0;
  // 结算回执载荷（事务成功后才赋值，失败保持空 —— 避免学生看到"获得装备"却查不到）
  let droppedEquipmentsFinal = {};
  let honorsFinal = {};

  // 获取基础分配置
  const [cfgRows] = await pool.query(
    "SELECT value FROM system_config WHERE config_key = 'points_correct_answer'"
  );
  // mysql2 对 JSON 列默认返回已解析对象，需兼容字符串
  let basePoints = 10;
  if (cfgRows.length > 0) {
    let parsed = cfgRows[0].value;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }
    if (parsed && parsed.value != null) basePoints = Number(parsed.value);
  }

  // 活动奖励配置（优先取开局时缓存的活动配置；缺省时用与旧行为一致的默认值）
  const rewardCfg = {
    multiplier: numOr(config.points_multiplier, 1),
    winBonusRate: numOr(config.win_bonus_rate, 0.5),
    drawBonusRate: numOr(config.draw_bonus_rate, 0),
    consolationPoints: Math.max(0, Math.floor(numOr(config.consolation_points, 0))),
    consolationGap: Math.max(0, Math.floor(numOr(config.consolation_gap, 2))),
    firstBattlePoints: Math.max(0, Math.floor(numOr(config.first_battle_points, 0))),
    dailyBattlesTarget: Math.max(0, Math.floor(numOr(config.daily_battles_target, 0))),
    dailyBattlesPoints: Math.max(0, Math.floor(numOr(config.daily_battles_points, 0))),
  };

  // PK 装备掉落配置（迁移 087）。默认关闭 ⇒ 完全维持旧行为，不引入意外掉落。
  // 掉率系数钳制到 [0, 5]：练习侧测试/考试是 ×10，PK 不应超过那个量级太多，
  // 否则「刷 PK 拿装备」会压过练习模块的教学价值。
  const dropCfg = {
    enabled: Number(config.equipment_drop_enabled) === 1 || config.equipment_drop_enabled === true,
    multiplier: Math.min(5, Math.max(0, numOr(config.equipment_drop_multiplier, 1))),
  };

  // ===== PK 专属荣誉：结算前先算好（纯函数，便于验证）=====
  // 每人的「新连胜场次」与「本局触发哪些荣誉」都在这里定下来，
  // 事务内只负责落库，避免把判定逻辑散进 SQL 拼接。
  const honorByUser = {};
  const newStreakByUser = {};
  {
    const resolveFor = (player, result) => {
      const oldStreak = player.pk_win_streak;
      const newStreak = calcNewWinStreak(oldStreak, result);
      newStreakByUser[player.user_id] = newStreak;
      honorByUser[player.user_id] = judgePkHonors({
        result,
        oldWinStreak: oldStreak,
        newWinStreak: newStreak,
        correct: player.correct,
        wrong: player.wrong,
        behindAtHalf: player.behindAtHalf,
      });
    };
    if (!isDraw) {
      resolveFor(playerA.user_id === winnerId ? playerA : playerB, 'win');
      resolveFor(playerA.user_id === winnerId ? playerB : playerA, 'lose');
    } else {
      resolveFor(playerA, 'draw');
      resolveFor(playerB, 'draw');
    }
  }

  if (!isDraw) {
    const winner = playerA.user_id === winnerId ? playerA : playerB;
    const loser = playerA.user_id === winnerId ? playerB : playerA;
    const rankResult = calcRankChange(
      winner.pk_rank_tier, winner.pk_rank_stars,
      loser.pk_rank_tier, loser.pk_rank_stars
    );
    winnerNewRank = rankResult.winner;
    loserNewRank = rankResult.loser;
    winnerPkDelta = rankResult.winnerPkDelta;
    loserPkDelta = rankResult.loserPkDelta;

    winnerSystemPts = calcSystemPoints(winner.correct, true, {
      basePoints,
      multiplier: rewardCfg.multiplier,
      winBonusRate: rewardCfg.winBonusRate,
    });
    loserSystemPts = calcSystemPoints(loser.correct, false, {
      basePoints,
      multiplier: rewardCfg.multiplier,
    });

    // 惜败鼓励：分差不超过阈值时给输方补偿（只看净得分差，与做题数无关）
    if (rewardCfg.consolationPoints > 0) {
      const gap = Math.abs(winner.score - loser.score);
      if (gap <= rewardCfg.consolationGap) {
        consolationWinner = 0;
        consolationLoser = rewardCfg.consolationPoints;
        loserSystemPts += consolationLoser;
      }
    }
  } else {
    // 平局：双方都按做对题数发，可加平局加成
    winnerSystemPts = calcSystemPoints(playerA.correct, false, {
      basePoints,
      multiplier: rewardCfg.multiplier,
      drawBonusRate: rewardCfg.drawBonusRate,
      isDraw: true,
    });
    loserSystemPts = calcSystemPoints(playerB.correct, false, {
      basePoints,
      multiplier: rewardCfg.multiplier,
      drawBonusRate: rewardCfg.drawBonusRate,
      isDraw: true,
    });
  }

  // 更新 profiles + pk_room_players（用事务）
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 更新 pk_room_players
    const updatePlayer = (p, isWinner) => {
      const result = isWinner ? 'win' : (isDraw ? 'draw' : 'lose');
      const rankChange = isWinner ? winnerNewRank : loserNewRank;
      const pkDelta = isWinner ? winnerPkDelta : loserPkDelta;
      let sysPts = isWinner ? winnerSystemPts : loserSystemPts;
      if (isNaN(sysPts) || sysPts == null) sysPts = 0;
      const consol = isWinner ? consolationWinner : consolationLoser;
      return conn.query(
        `UPDATE pk_room_players SET
          final_score = ?, final_correct = ?, final_wrong = ?, final_duration_ms = ?,
          result = ?, rank_points_change = ?, system_points_earned = ?,
          consolation_points = ?, bonus_points = ?
         WHERE room_id = ? AND user_id = ?`,
        [p.score, p.correct, p.wrong, p.durationMs, result, pkDelta, sysPts, consol, 0, roomId, p.user_id]
      );
    };

    if (!isDraw) {
      const winner = playerA.user_id === winnerId ? playerA : playerB;
      const loser = playerA.user_id === winnerId ? playerB : playerA;
      await updatePlayer({ ...winner, score: winner.score, correct: winner.correct, wrong: winner.wrong, durationMs: winner.durationMs }, true);
      await updatePlayer({ ...loser, score: loser.score, correct: loser.correct, wrong: loser.wrong, durationMs: loser.durationMs }, false);
    } else {
      await updatePlayer({ ...playerA, score: playerA.score, correct: playerA.correct, wrong: playerA.wrong, durationMs: playerA.durationMs }, false);
      await updatePlayer({ ...playerB, score: playerB.score, correct: playerB.correct, wrong: playerB.wrong, durationMs: playerB.durationMs }, false);
    }

    // 更新 profiles（段位 + PK积分 + 系统积分 + 战绩 + 今日次数）
    const updateProfile = (userId, newRank, pkDelta, sysPts, isWinner, isDraw) => {
      const winsInc = isWinner ? 1 : 0;
      const lossesInc = (!isWinner && !isDraw) ? 1 : 0;
      const drawsInc = isDraw ? 1 : 0;
      return conn.query(
        `UPDATE profiles SET
          pk_rank_tier = ?, pk_rank_stars = ?,
          pk_points = GREATEST(0, pk_points + ?),
          current_points = current_points + ?,
          total_points_earned = total_points_earned + ?,
          pk_total_wins = pk_total_wins + ?,
          pk_total_losses = pk_total_losses + ?,
          pk_total_draws = pk_total_draws + ?,
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [
          newRank ? newRank.tier : 0, // 平局时 newRank 为 null，用 0 占位（实际不改）
          newRank ? newRank.stars : 0,
          pkDelta,
          sysPts,
          sysPts,
          winsInc,
          lossesInc,
          drawsInc,
          userId,
        ]
      );
    };

    // 注意：平局时段位不变，上面用 0 占位是错的，需要分开处理
    // 重写：平局不更新段位字段
    //
    // pk_win_streak 与 3 个 PK 荣誉计数列在此一并落库（迁移 087）。
    // 荣誉计数用「本局是否触发」决定 +1 还是 +0，判定已在事务外算好（honorByUser）。
    const honorInc = (userId, honorType) =>
      (honorByUser[userId] || []).some((h) => h.type === honorType) ? 1 : 0;

    if (!isDraw) {
      const winner = playersRows.find((p) => p.user_id === winnerId);
      const loser = playersRows.find((p) => p.user_id !== winnerId);
      await conn.query(
        `UPDATE profiles SET
          pk_rank_tier = ?, pk_rank_stars = ?,
          pk_points = GREATEST(0, pk_points + ?),
          current_points = current_points + ?,
          total_points_earned = total_points_earned + ?,
          pk_total_wins = pk_total_wins + 1,
          pk_win_streak = ?,
          pk_streak_3_times = pk_streak_3_times + ?,
          pk_flawless_times = pk_flawless_times + ?,
          pk_comeback_times = pk_comeback_times + ?,
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [
          winnerNewRank.tier, winnerNewRank.stars, winnerPkDelta, winnerSystemPts, winnerSystemPts,
          newStreakByUser[winner.user_id] ?? 0,
          honorInc(winner.user_id, 'pk_streak_3'),
          honorInc(winner.user_id, 'pk_flawless'),
          honorInc(winner.user_id, 'pk_comeback'),
          winner.user_id,
        ]
      );
      await conn.query(
        `UPDATE profiles SET
          pk_rank_tier = ?, pk_rank_stars = ?,
          pk_points = GREATEST(0, pk_points + ?),
          current_points = current_points + ?,
          total_points_earned = total_points_earned + ?,
          pk_total_losses = pk_total_losses + 1,
          pk_win_streak = ?,
          pk_streak_3_times = pk_streak_3_times + ?,
          pk_flawless_times = pk_flawless_times + ?,
          pk_comeback_times = pk_comeback_times + ?,
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [
          loserNewRank.tier, loserNewRank.stars, loserPkDelta, loserSystemPts, loserSystemPts,
          // 输方连胜清零；「零失误」仍可能达成（做对全部题但净得分低仍可能输）
          newStreakByUser[loser.user_id] ?? 0,
          honorInc(loser.user_id, 'pk_streak_3'),
          honorInc(loser.user_id, 'pk_flawless'),
          honorInc(loser.user_id, 'pk_comeback'),
          loser.user_id,
        ]
      );
    } else {
      // 平局：段位不变，仅更新积分和战绩
      await conn.query(
        `UPDATE profiles SET
          current_points = current_points + ?,
          total_points_earned = total_points_earned + ?,
          pk_total_draws = pk_total_draws + 1,
          pk_win_streak = ?,
          pk_flawless_times = pk_flawless_times + ?,
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [
          winnerSystemPts, winnerSystemPts,
          newStreakByUser[playerA.user_id] ?? 0,
          honorInc(playerA.user_id, 'pk_flawless'),
          playerA.user_id,
        ]
      );
      await conn.query(
        `UPDATE profiles SET
          current_points = current_points + ?,
          total_points_earned = total_points_earned + ?,
          pk_total_draws = pk_total_draws + 1,
          pk_win_streak = ?,
          pk_flawless_times = pk_flawless_times + ?,
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [
          loserSystemPts, loserSystemPts,
          newStreakByUser[playerB.user_id] ?? 0,
          honorInc(playerB.user_id, 'pk_flawless'),
          playerB.user_id,
        ]
      );
    }

    // 写 point_transactions（表结构：student_id / amount / source_type / source_id / reason / created_at）
    // source_type 用 'pk_battle' 区分来源，使「PK 发了多少积分」可查（迁移 086 补的枚举值）
    const writeTransaction = (userId, amount, outcome) => {
      if (amount <= 0) return Promise.resolve();
      return conn.query(
        `INSERT INTO point_transactions (student_id, amount, source_type, source_id, reason, created_at)
         VALUES (?, ?, 'pk_battle', ?, ?, NOW())`,
        [
          userId,
          amount,
          roomId,
          `PK对战：${roomCode || 'quick'} ${outcome}`,
        ]
      );
    };

    if (!isDraw) {
      await writeTransaction(winnerId, winnerSystemPts, 'win');
      await writeTransaction(loserId, loserSystemPts, 'lose');
    } else {
      await writeTransaction(playerA.user_id, winnerSystemPts, 'draw');
      await writeTransaction(playerB.user_id, loserSystemPts, 'draw');
    }

    // ===== 参与类奖励（每日限一次，走 pk_daily_rewards 唯一索引 + INSERT IGNORE 幂等）=====
    // 1) 每日首战奖励  2) 单日完成 N 场奖励
    // 设计要点：奖励「参与」而非「胜负」，让中下游学生也有正反馈。
    const grantParticipationRewards = async (userId) => {
      const granted = { first_battle: 0, daily_battles: 0 };

      const tryGrant = async (rewardType, points) => {
        if (points <= 0) return 0;
        const rid = `pkr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const [ins] = await conn.query(
          `INSERT IGNORE INTO pk_daily_rewards (id, user_id, reward_date, reward_type, points, room_id)
           VALUES (?, ?, CURDATE(), ?, ?, ?)`,
          [rid, userId, rewardType, points, roomId]
        );
        // affectedRows = 0 ⇒ 今天已发过，跳过（幂等）
        if (!ins || ins.affectedRows === 0) return 0;

        await conn.query(
          `UPDATE profiles SET current_points = current_points + ?, total_points_earned = total_points_earned + ?
           WHERE id = ?`,
          [points, points, userId]
        );
        await conn.query(
          `INSERT INTO point_transactions (student_id, amount, source_type, source_id, reason, created_at)
           VALUES (?, ?, 'pk_battle', ?, ?, NOW())`,
          [userId, points, roomId, `PK对战：${roomCode || 'quick'} ${rewardType === 'first_battle' ? '每日首战奖励' : `单日${rewardCfg.dailyBattlesTarget}场奖励`}`]
        );
        return points;
      };

      granted.first_battle = await tryGrant('first_battle', rewardCfg.firstBattlePoints);

      if (rewardCfg.dailyBattlesTarget > 0 && rewardCfg.dailyBattlesPoints > 0) {
        const [cntRows] = await conn.query(
          'SELECT pk_battles_today FROM profiles WHERE id = ?',
          [userId]
        );
        // 注意：上面刚 +1，所以此处已含本场
        const battlesToday = cntRows.length > 0 ? Number(cntRows[0].pk_battles_today) : 0;
        if (battlesToday >= rewardCfg.dailyBattlesTarget) {
          granted.daily_battles = await tryGrant('daily_battles', rewardCfg.dailyBattlesPoints);
        }
      }

      return granted;
    };

    const rewardByUser = {};
    if (!isDraw) {
      rewardByUser[winnerId] = await grantParticipationRewards(winnerId);
      rewardByUser[loserId] = await grantParticipationRewards(loserId);
    } else {
      rewardByUser[playerA.user_id] = await grantParticipationRewards(playerA.user_id);
      rewardByUser[playerB.user_id] = await grantParticipationRewards(playerB.user_id);
    }

    // 把参与类奖励回写到 pk_room_players.bonus_points（统计面板要展示）
    for (const [uid, g] of Object.entries(rewardByUser)) {
      const bonus = (g.first_battle || 0) + (g.daily_battles || 0);
      if (bonus > 0) {
        await conn.query(
          'UPDATE pk_room_players SET bonus_points = ? WHERE room_id = ? AND user_id = ?',
          [bonus, roomId, uid]
        );
      }
    }

    // ===== 段位变化历史（迁移 087）：只记「变化点」，平局/未变化不记 =====
    // 趋势图只关心段位怎么走的，若每局都写一行会让表随对局数线性膨胀。
    const writeRankHistory = async (player, newRank, result) => {
      if (!newRank) return;
      const fromTier = Number(player.pk_rank_tier) || 0;
      const fromStars = Number(player.pk_rank_stars) || 0;
      if (fromTier === newRank.tier && fromStars === newRank.stars) return;
      await conn.query(
        `INSERT INTO pk_rank_history
         (user_id, class_id, room_id, from_tier, from_stars, to_tier, to_stars, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [player.user_id, player.class_id || null, roomId,
          fromTier, fromStars, newRank.tier, newRank.stars, result]
      );
    };
    if (!isDraw) {
      await writeRankHistory(playerA.user_id === winnerId ? playerA : playerB, winnerNewRank, 'win');
      await writeRankHistory(playerA.user_id === winnerId ? playerB : playerA, loserNewRank, 'lose');
    }
    // 平局段位不变 → 不写历史

    // ===== PK 装备掉落（迁移 087，默认关闭）=====
    // 与练习侧口径一致：每件装备独立掷骰，判据 Math.random()*100 < 实际掉率。
    // 只在答对 ≥1 题时触发（一题没答对却掉装备，会让掉落变成「挂机奖励」）。
    const droppedByUser = {};
    if (dropCfg.enabled && dropCfg.multiplier > 0) {
      try {
        const [activeEquipments] = await conn.query(
          'SELECT id, name, icon, drop_rate, crit_bonus FROM equipments WHERE is_active = true'
        );
        for (const p of [playerA, playerB]) {
          if (p.correct <= 0) { droppedByUser[p.user_id] = []; continue; }
          const dropped = rollEquipmentDrops(activeEquipments, dropCfg.multiplier);
          for (const eq of dropped) {
            await conn.query(
              `INSERT INTO student_equipments (id, student_id, equipment_id, quantity)
               VALUES (?, ?, ?, 1)
               ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
              [`se_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, p.user_id, eq.id]
            );
          }
          droppedByUser[p.user_id] = dropped;
        }
      } catch (err) {
        // 掉落失败不能连累结算（积分/段位已经算好了）
        console.error('[PK] 装备掉落失败（不改动结算结果）:', err.message);
      }
    }

    // 更新房间状态
    await conn.query("UPDATE pk_rooms SET status = 'finished' WHERE id = ?", [roomId]);

    await conn.commit();

    // 结算成功后才对外广播掉落/荣誉 —— 若事务回滚，学生不会看到 "获得了装备" 却查不到
    droppedEquipmentsFinal = droppedByUser;
    honorsFinal = honorByUser;
  } catch (err) {
    await conn.rollback();
    console.error('PK 结算失败:', err);
    // 即使事务失败也通知前端结束，避免卡在答题页
    io.to(roomId).emit('pk:battle_end', { room_id: roomId });
    return;
  } finally {
    conn.release();
  }

  // 对战中答错的题加入错题集（upsert：已有则累加错误次数）
  try {
    const [wrongRows] = await pool.query(
      `SELECT user_id, question_id FROM pk_match_answers
       WHERE room_id = ? AND is_correct = 0`,
      [roomId]
    );
    for (const row of wrongRows) {
      const [existing] = await pool.query(
        'SELECT id FROM wrong_questions WHERE student_id = ? AND question_id = ?',
        [row.user_id, row.question_id]
      );
      if (existing.length > 0) {
        await pool.query(
          'UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_at = NOW() WHERE id = ?',
          [existing[0].id]
        );
      } else {
        const wqId = `wq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await pool.query(
          'INSERT INTO wrong_questions (id, student_id, question_id, wrong_count, last_wrong_at, created_at) VALUES (?, ?, ?, 1, NOW(), NOW())',
          [wqId, row.user_id, row.question_id]
        );
      }
    }
    if (wrongRows.length > 0) {
      console.log(`[PK] 结算后写入错题集 ${roomId}: ${wrongRows.length} 条`);
    }
  } catch (err) {
    console.error('PK 写入错题集失败:', err);
  }

  // 通知前端拉结算
  // 附带本局掉落与荣誉（按用户分组），前端据此就地弹出「获得装备 / 达成荣誉」动效，
  // 无需再发一次请求 —— 结算页加载有延迟，等问题答完再弹会错过最佳反馈时机。
  io.to(roomId).emit('pk:battle_end', {
    room_id: roomId,
    dropped_equipments: droppedEquipmentsFinal,
    new_honors: honorsFinal,
  });
}

/**
 * 清除 tick 定时器
 */
function clearTickTimer(roomId) {
  const t = tickTimers.get(roomId);
  if (t) {
    clearInterval(t);
    tickTimers.delete(roomId);
  }
}

/**
 * 服务器重启时恢复（扫库，battling 房间标 abandoned，双方平局）
 */
async function recoverBattles(pool) {
  const [rows] = await pool.query(
    "SELECT id FROM pk_rooms WHERE status = 'battling'"
  );
  for (const row of rows) {
    await pool.query("UPDATE pk_rooms SET status = 'abandoned' WHERE id = ?", [row.id]);
    console.log(`PK 房间 ${row.id} 因服务器重启标记为 abandoned`);
  }
}

module.exports = {
  startBattle,
  submitAnswer,
  surrender,
  handleDisconnect,
  handleReconnect,
  finishBattle,
  recoverBattles,
  battles,
};
