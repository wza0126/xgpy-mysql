// PK 对战引擎（出题/计时/收卷/结算）
// 设计文档 5.3 答题流程 + 5.4 结算流程

const crypto = require('crypto');
const { calcRankChange, calcSystemPoints, judgeByScore } = require('./rankCalc');
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

  // 写库
  await pool.query(
    `UPDATE pk_rooms SET status = 'battling', question_ids = ?, started_at = ?, ends_at = ?
     WHERE id = ?`,
    [JSON.stringify(questionIds), startedAt, endsAt, roomId]
  );

  // 缓存对战状态
  const battleState = {
    questionIds,
    endsAt: endsAt.getTime(),
    players: new Map(
      playerIds.map((uid) => [
        uid,
        { score: 0, correct: 0, wrong: 0, durationMs: 0, answered: new Set() },
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

  // 获取玩家信息
  const [playersRows] = await pool.query(
    `SELECT p.*, pr.username, pr.real_name, pr.pk_rank_tier, pr.pk_rank_stars, pr.pk_points,
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

  // 合并到 playersRows
  const playerA = { ...a, score: aState.score, correct: aState.correct, wrong: aState.wrong, durationMs: aState.durationMs };
  const playerB = { ...b, score: bState.score, correct: bState.correct, wrong: bState.wrong, durationMs: bState.durationMs };

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

    winnerSystemPts = calcSystemPoints(winner.correct, true, basePoints);
    loserSystemPts = calcSystemPoints(loser.correct, false, basePoints);
  } else {
    // 平局：双方都按做对题数发，无奖励
    winnerSystemPts = calcSystemPoints(playerA.correct, false, basePoints);
    loserSystemPts = calcSystemPoints(playerB.correct, false, basePoints);
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
      return conn.query(
        `UPDATE pk_room_players SET
          final_score = ?, final_correct = ?, final_wrong = ?, final_duration_ms = ?,
          result = ?, rank_points_change = ?, system_points_earned = ?
         WHERE room_id = ? AND user_id = ?`,
        [p.score, p.correct, p.wrong, p.durationMs, result, pkDelta, sysPts, roomId, p.user_id]
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
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [winnerNewRank.tier, winnerNewRank.stars, winnerPkDelta, winnerSystemPts, winnerSystemPts, winner.user_id]
      );
      await conn.query(
        `UPDATE profiles SET
          pk_rank_tier = ?, pk_rank_stars = ?,
          pk_points = GREATEST(0, pk_points + ?),
          current_points = current_points + ?,
          total_points_earned = total_points_earned + ?,
          pk_total_losses = pk_total_losses + 1,
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [loserNewRank.tier, loserNewRank.stars, loserPkDelta, loserSystemPts, loserSystemPts, loser.user_id]
      );
    } else {
      // 平局：段位不变，仅更新积分和战绩
      await conn.query(
        `UPDATE profiles SET
          current_points = current_points + ?,
          total_points_earned = total_points_earned + ?,
          pk_total_draws = pk_total_draws + 1,
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [winnerSystemPts, winnerSystemPts, playerA.user_id]
      );
      await conn.query(
        `UPDATE profiles SET
          current_points = current_points + ?,
          total_points_earned = total_points_earned + ?,
          pk_total_draws = pk_total_draws + 1,
          pk_battles_today = pk_battles_today + 1,
          pk_battles_date = CURDATE()
         WHERE id = ?`,
        [loserSystemPts, loserSystemPts, playerB.user_id]
      );
    }

    // 写 point_transactions（表结构：student_id / amount / reason / source_type / source_id）
    const writeTransaction = (userId, amount, isWinner) => {
      if (amount <= 0) return Promise.resolve();
      const roomCode = 'quick'; // TODO: 实际从 pk_rooms 取 room_code
      const result = isWinner ? 'win' : (isDraw ? 'draw' : 'lose');
      return conn.query(
        `INSERT INTO point_transactions (student_id, amount, source_type, source_id, reason, created_at)
         VALUES (?, ?, 'system', ?, ?, NOW())`,
        [
          userId,
          amount,
          roomId,
          `PK对战：${roomCode} ${result}`,
        ]
      );
    };

    if (!isDraw) {
      await writeTransaction(winnerId, winnerSystemPts, true);
      await writeTransaction(loserId, loserSystemPts, false);
    } else {
      await writeTransaction(playerA.user_id, winnerSystemPts, false);
      await writeTransaction(playerB.user_id, loserSystemPts, false);
    }

    // 更新房间状态
    await conn.query("UPDATE pk_rooms SET status = 'finished' WHERE id = ?", [roomId]);

    await conn.commit();
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
  io.to(roomId).emit('pk:battle_end', { room_id: roomId });
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
