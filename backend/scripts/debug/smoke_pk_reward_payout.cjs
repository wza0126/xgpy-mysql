/**
 * smoke_pk_reward_payout.cjs
 *
 * 目的：真实驱动一次 PK 结算（battleEngine.finishBattle），端到端验证奖励发放。
 *
 * 为什么需要这一层：上面那个 smoke_pk_rewards_stats 只验证了「配置能存能读」和
 * 「函数算得对」，但**没有证明结算路径真的会用上这些配置**。历史上踩过这个坑
 * （handler 手搭 config 子集导致奖励字段被丢掉），所以这里直接跑一遍结算。
 *
 * 做法：
 *   1. 造两个临时学生 + 一个临时活动配置（带明显可辨的奖励值）
 *   2. 造一个 pk_rooms + 两行 pk_room_players，并把对战状态塞进 battleEngine.battles
 *   3. 调 finishBattle，用假的 io 收集 emit
 *   4. 断言：pk_room_players / profiles / point_transactions / pk_daily_rewards 四处都落对了
 *   5. 再跑一次结算，验证每日限一次的参与奖励**不会重复发**
 *   6. 清理全部临时数据
 *
 * 用法：node scripts/debug/smoke_pk_reward_payout.cjs
 */

const pool = require('../../src/db');
const battleEngine = require('../../src/pk-socket/battleEngine');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

const rid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/** 极简 io 桩：只收集 emit 调用 */
function fakeIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return {
        emit(event, payload) { emitted.push({ room, event, payload }); },
      };
    },
  };
}

async function main() {
  const stamp = Date.now();
  const uA = rid('tmpstu');
  const uB = rid('tmpstu');
  const roomId = rid('tmproom');
  const cfgId = rid('tmpcfg');

  const [[clsRow]] = await pool.query("SELECT id FROM classes LIMIT 1");
  const classId = clsRow?.id;

  // 记下初始积分，便于事后比对
  const created = { users: [], config: cfgId, room: roomId };

  try {
    // ══ 准备数据 ═════════════════════════════════════════════════════════
    section('准备：造两个临时学生 + 带奖励的活动配置');

    for (const uid of [uA, uB]) {
      await pool.query(
        `INSERT INTO profiles (id, username, real_name, role, class_id, current_points, total_points_earned,
           pk_rank_tier, pk_rank_stars, pk_points, pk_battles_today, pk_battles_date,
           pk_total_wins, pk_total_losses, pk_total_draws)
         VALUES (?, ?, ?, 'student', ?, 0, 0, 1, 2, 0, 0, NULL, 0, 0, 0)`,
        [uid, uid.slice(-8), '临时学生', classId]
      );
      created.users.push(uid);
    }
    ok('两个临时学生创建成功', true);

    // 奖励配置：倍率 2、赢方 +100%、平局 +50%、惜败 30（分差≤5）、首战 20、满 1 场 40
    // 故意把 daily_battles_target 设为 1，这样第一场就能同时触发首战与全勤两种奖励
    await pool.query(
      `INSERT INTO pk_battle_configs
       (id, teacher_id, name, mode, duration_seconds, question_count, is_active,
        points_multiplier, win_bonus_rate, draw_bonus_rate,
        consolation_points, consolation_gap, first_battle_points,
        daily_battles_target, daily_battles_points)
       VALUES (?, 'teacher', '__tmp_payout', 'timed', 180, 10, 0, 2.00, 1.00, 0.50, 30, 5, 20, 1, 40)`,
      [cfgId]
    );
    ok('奖励配置创建成功（倍率2 / 赢+100% / 首战20 / 满1场40 / 惜败30）', true);

    // 房间 + 两行玩家（含开局快照）
    await pool.query(
      `INSERT INTO pk_rooms (id, config_id, room_code, host_user_id, status)
       VALUES (?, ?, 'A1B2', ?, 'battling')`,
      [roomId, cfgId, uA]
    );
    for (const [i, uid] of [uA, uB].entries()) {
      await pool.query(
        `INSERT INTO pk_room_players
         (id, room_id, user_id, is_host, is_ready, config_id, config_name, question_count, duration_seconds)
         VALUES (?, ?, ?, ?, 1, ?, '__tmp_payout', 10, 180)`,
        [rid('pkp'), roomId, uid, i === 0 ? 1 : 0, cfgId]
      );
    }
    ok('房间与玩家行创建成功（带开局快照）', true);

    // ══ 第一次结算 ═══════════════════════════════════════════════════════
    section('第 1 次结算：A 做对 8 题、B 做对 6 题（A 赢，分差 2 ≤ 5 触发惜败）');

    const io = fakeIo();
    // 直接塞内存状态（模拟真实对战进行中）
    battleEngine.battles.set(roomId, {
      questionIds: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'],
      endsAt: Date.now() + 10000,
      config: {
        id: cfgId,
        name: '__tmp_payout',
        duration_seconds: 180,
        question_count: 10,
        points_multiplier: 2,
        win_bonus_rate: 1,
        draw_bonus_rate: 0.5,
        consolation_points: 30,
        consolation_gap: 5,
        first_battle_points: 20,
        daily_battles_target: 1,
        daily_battles_points: 40,
      },
      players: new Map([
        [uA, { score: 8, correct: 8, wrong: 0, durationMs: 30000, answered: new Set() }],
        [uB, { score: 6, correct: 6, wrong: 0, durationMs: 40000, answered: new Set() }],
      ]),
    });

    await battleEngine.finishBattle(io, pool, roomId, 'all_answered');

    // ---- 断言 1：pk_room_players ----
    const [rows] = await pool.query(
      'SELECT * FROM pk_room_players WHERE room_id = ? ORDER BY user_id = ? DESC',
      [roomId, uA]
    );
    const rowA = rows.find((r) => r.user_id === uA);
    const rowB = rows.find((r) => r.user_id === uB);

    ok('A 判为 win', rowA?.result === 'win', String(rowA?.result));
    ok('B 判为 lose', rowB?.result === 'lose', String(rowB?.result));

    // A（赢方）：8 题 × 10 基础分 × 倍率2 × (1+加成1) = 320 → 记在 system_points_earned
    // 注意：参与类奖励（首战20 + 满场40 = 60）单独记在 bonus_points，不与对局积分混在一起，
    //       这样统计面板才能把「打得好」和「来得勤」分开看。
    const expectA = Math.floor(8 * 10 * 2 * 2);
    const expectAParticipation = 20 + 40;
    ok(`A 对局积分 = 8×10×2×2 = ${expectA}`, Number(rowA?.system_points_earned) === expectA,
      `实际 ${rowA?.system_points_earned}`);

    // B（输方）：6 题 × 10 × 2 × 1 = 120；惜败 +30 → 150
    const expectB = Math.floor(6 * 10 * 2) + 30;
    const expectBParticipation = 20 + 40;
    ok(`B 对局积分 = 6×10×2 + 惜败30 = ${expectB}`, Number(rowB?.system_points_earned) === expectB,
      `实际 ${rowB?.system_points_earned}`);
    ok('B 记录了惜败鼓励分 30', Number(rowB?.consolation_points) === 30, String(rowB?.consolation_points));
    ok(`B 记录了参与类奖励 ${expectBParticipation}（首战20+满场40）`,
      Number(rowB?.bonus_points) === expectBParticipation, String(rowB?.bonus_points));
    ok('A 的惜败鼓励为 0（赢方不享受）', Number(rowA?.consolation_points) === 0);
    ok(`A 的参与类奖励为 ${expectAParticipation}`, Number(rowA?.bonus_points) === expectAParticipation, String(rowA?.bonus_points));

    // ---- 断言 2：profiles 积分确实到账（对局积分 + 参与奖励都要到账）----
    const totalA = expectA + expectAParticipation;
    const totalB = expectB + expectBParticipation;
    const [profRows] = await pool.query(
      'SELECT id, current_points, total_points_earned, pk_total_wins, pk_total_losses, pk_battles_today FROM profiles WHERE id IN (?, ?)',
      [uA, uB]
    );
    const pA = profRows.find((r) => r.id === uA);
    const pB = profRows.find((r) => r.id === uB);
    ok(`A 账户积分到账 ${totalA}（对局 ${expectA} + 参与 ${expectAParticipation}）`,
      Number(pA?.current_points) === totalA, String(pA?.current_points));
    ok(`B 账户积分到账 ${totalB}`, Number(pB?.current_points) === totalB, String(pB?.current_points));
    ok('A total_points_earned 与 current_points 一致', Number(pA?.total_points_earned) === totalA);
    ok('A 胜场 +1', Number(pA?.pk_total_wins) === 1, String(pA?.pk_total_wins));
    ok('B 负场 +1', Number(pB?.pk_total_losses) === 1, String(pB?.pk_total_losses));

    // ---- 断言 3：point_transactions 用 pk_battle（隐患1 端到端）----
    const [txRows] = await pool.query(
      "SELECT student_id, amount, source_type, reason FROM point_transactions WHERE source_id = ? ORDER BY amount DESC",
      [roomId]
    );
    ok('PK 积分流水全部记为 pk_battle',
      txRows.length > 0 && txRows.every((t) => t.source_type === 'pk_battle'),
      txRows.map((t) => t.source_type).join(','));
    const txA = txRows.filter((t) => t.student_id === uA).reduce((s, t) => s + Number(t.amount), 0);
    const txB = txRows.filter((t) => t.student_id === uB).reduce((s, t) => s + Number(t.amount), 0);
    ok('流水金额合计 = 账户到账（A）', txA === totalA, `${txA} vs ${totalA}`);
    ok('流水金额合计 = 账户到账（B）', txB === totalB, `${txB} vs ${totalB}`);
    ok('流水备注使用真实房间码 A1B2（不是 quick）',
      txRows.some((t) => String(t.reason).includes('A1B2')),
      txRows.map((t) => t.reason).join(' | ').slice(0, 160));

    // ---- 断言 4：pk_daily_rewards 记录了参与奖励 ----
    const [drRows] = await pool.query(
      'SELECT user_id, reward_type, points FROM pk_daily_rewards WHERE user_id IN (?, ?)',
      [uA, uB]
    );
    ok('两人各记录了 2 笔每日奖励（首战 + 满场）', drRows.length === 4, `${drRows.length} 笔`);
    ok('记录了 first_battle 类型', drRows.filter((r) => r.reward_type === 'first_battle').length === 2);
    ok('记录了 daily_battles 类型', drRows.filter((r) => r.reward_type === 'daily_battles').length === 2);

    // ══ 第二次结算：验证每日限一次不重复发 ═══════════════════════════════
    section('第 2 次结算：同一天再来一局，参与类奖励不得重复发放');

    const roomId2 = rid('tmproom');
    await pool.query(
      `INSERT INTO pk_rooms (id, config_id, room_code, host_user_id, status)
       VALUES (?, ?, 'C3D4', ?, 'battling')`,
      [roomId2, cfgId, uA]
    );
    for (const [i, uid] of [uA, uB].entries()) {
      await pool.query(
        `INSERT INTO pk_room_players (id, room_id, user_id, is_host, is_ready) VALUES (?, ?, ?, ?, 1)`,
        [rid('pkp'), roomId2, uid, i === 0 ? 1 : 0]
      );
    }
    // 记下第二次结算前的积分
    const [beforeRows] = await pool.query(
      'SELECT id, current_points FROM profiles WHERE id IN (?, ?)', [uA, uB]
    );
    const beforeA = Number(beforeRows.find((r) => r.id === uA).current_points);
    const beforeB = Number(beforeRows.find((r) => r.id === uB).current_points);

    const io2 = fakeIo();
    battleEngine.battles.set(roomId2, {
      questionIds: ['q1', 'q2'],
      endsAt: Date.now() + 10000,
      config: {
        id: cfgId, name: '__tmp_payout', duration_seconds: 180, question_count: 10,
        points_multiplier: 2, win_bonus_rate: 1, draw_bonus_rate: 0.5,
        consolation_points: 30, consolation_gap: 5,
        first_battle_points: 20, daily_battles_target: 1, daily_battles_points: 40,
      },
      players: new Map([
        [uA, { score: 2, correct: 2, wrong: 0, durationMs: 10000, answered: new Set() }],
        [uB, { score: 1, correct: 1, wrong: 0, durationMs: 12000, answered: new Set() }],
      ]),
    });
    await battleEngine.finishBattle(io2, pool, roomId2, 'all_answered');

    const [afterRows] = await pool.query(
      'SELECT id, current_points FROM profiles WHERE id IN (?, ?)', [uA, uB]
    );
    const afterA = Number(afterRows.find((r) => r.id === uA).current_points);
    const afterB = Number(afterRows.find((r) => r.id === uB).current_points);

    // A 赢：2题×10×2×2 = 80（无参与奖励）
    ok('第2局 A 只拿到本局积分 80（参与奖励不重复发）',
      afterA - beforeA === 80, `增量 ${afterA - beforeA}`);
    // B 输：1题×10×2 = 20，分差1≤5 → +30惜败 = 50（无参与奖励）
    ok('第2局 B 只拿到 20 + 惜败30 = 50（参与奖励不重复发）',
      afterB - beforeB === 50, `增量 ${afterB - beforeB}`);

    const [drRows2] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM pk_daily_rewards WHERE user_id IN (?, ?)', [uA, uB]
    );
    ok('每日奖励记录仍为 4 笔（未重复插入）', Number(drRows2[0].cnt) === 4, `${drRows2[0].cnt} 笔`);

  } finally {
    // ══ 清理 ═════════════════════════════════════════════════════════════
    section('清理临时数据');
    try { battleEngine.battles.delete(roomId); } catch { /* ignore */ }
    await pool.query('DELETE FROM point_transactions WHERE source_id LIKE ?', ['tmproom%']).catch(() => {});
    await pool.query('DELETE FROM pk_daily_rewards WHERE user_id IN (?)', [[uA, uB]]).catch(() => {});
    await pool.query('DELETE FROM pk_room_players WHERE room_id LIKE ?', ['tmproom%']).catch(() => {});
    await pool.query('DELETE FROM pk_rooms WHERE id LIKE ?', ['tmproom%']).catch(() => {});
    await pool.query('DELETE FROM pk_battle_configs WHERE id = ?', [cfgId]).catch(() => {});
    await pool.query('DELETE FROM profiles WHERE id IN (?)', [[uA, uB]]).catch(() => {});
    // 兜底：清掉可能残留的当日奖励（按 user_id 已删，这里再兜一层）
    await pool.query("DELETE FROM pk_daily_rewards WHERE user_id LIKE 'tmpstu%'").catch(() => {});
    console.log('  （已清理临时学生/房间/配置/奖励记录）');
  }

  console.log('\n' + '═'.repeat(56));
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (failures.length > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('═'.repeat(56));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
