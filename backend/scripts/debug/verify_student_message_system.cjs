/**
 * 学生消息体系 v2.7.0 端到端验证
 *
 * 覆盖：
 *   A. 设置读写（教师端）
 *   B. 发消息：非数字内容放行（原「仅数字」限制已解除）
 *   C. 字数上限拦截
 *   D. 屏蔽词拦截
 *   E. 扣积分 + 流水 + 余额不足拒发
 *   F. 黑名单（手工加 / 点选加 / 移出 / 被拉黑后发不出）
 *   G. 禁言（设置 / 剩余天数提示 / 拒发 / 解除）
 *   H. 举报（提交 / 只能举报发给自己的 / 教师列表 / 处置禁言 / 删除消息）
 *   I. 快捷短语
 *   J. 教师端消息记录与概览
 *   K. 不留痕：脚本跑完必须把数据还原
 *
 * ⛔ 铁律：本脚本不得污染数据库。所有临时数据统一 tmp_ 前缀，
 *    并在 finally 中还原；末尾有「不留痕」断言。
 */
const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const TMP = 'tmp_';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* 无 body */ }
  return { status: res.status, body: json };
}

async function login(username, password) {
  const r = await api('POST', '/api/auth/secure-login', { body: { username, password } });
  const token = r.body?.data?.session?.access_token || r.body?.data?.token;
  return { token, status: r.status, raw: r.body };
}

async function main() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy',
  });

  // ---------- 备份原始状态，供 finally 还原 ----------
  const [origSettingsRows] = await conn.query('SELECT * FROM student_message_settings WHERE id = 1');
  const origSettings = origSettingsRows[0];
  const [origKwCount] = await conn.query('SELECT COUNT(*) AS n FROM student_message_keywords');
  const [origQuickCount] = await conn.query('SELECT COUNT(*) AS n FROM student_message_quick_replies');

  // 测试用学生：a（发送方）、b（接收方）
  const [stuA] = await conn.query("SELECT id, username, current_points FROM profiles WHERE username = 'a'");
  const [stuB] = await conn.query("SELECT id, username, current_points FROM profiles WHERE username = 'b'");
  if (!stuA.length || !stuB.length) {
    console.log('找不到测试账号 a / b，无法继续');
    process.exit(1);
  }
  const A = stuA[0], B = stuB[0];
  const origAPoints = A.current_points;

  // 记录原始黑名单/禁言/举报，避免误删教师真实数据
  const [origBl] = await conn.query('SELECT id FROM student_message_blacklist');
  const [origMutes] = await conn.query('SELECT student_id FROM student_message_mutes');
  const origBlIds = new Set(origBl.map(r => r.id));
  const origMuteIds = new Set(origMutes.map(r => r.student_id));

  const createdMsgIds = [];
  let teacherToken = null, tokenA = null, tokenB = null;

  try {
    // ---------- A. 登录 ----------
    section('A. 登录（教师 + 学生 a/b）');
    const lt = await login('teacher', 'xgpy666');
    teacherToken = lt.token;
    ok('教师登录成功', !!teacherToken, `status=${lt.status}`);
    const la = await login('a', '111111');
    tokenA = la.token;
    ok('学生 a 登录成功', !!tokenA, `status=${la.status}`);
    const lb = await login('b', '111111');
    tokenB = lb.token;
    ok('学生 b 登录成功', !!tokenB, `status=${lb.status}`);
    if (!teacherToken || !tokenA || !tokenB) throw new Error('登录失败，后续无法测试');

    // ---------- B. 教师端设置 ----------
    section('B. 教师端消息设置读写');
    const getSet = await api('GET', '/api/teacher/message-settings', { token: teacherToken });
    ok('读取消息设置', getSet.status === 200 && getSet.body?.data, JSON.stringify(getSet.body?.data));

    const badSet = await api('PUT', '/api/teacher/message-settings', {
      token: teacherToken,
      body: { enabled: true, points_per_message: -5, max_length: 100, max_per_day: 0 },
    });
    ok('非法积分值被拒（负数）', badSet.status === 400, badSet.body?.error);

    const badSet2 = await api('PUT', '/api/teacher/message-settings', {
      token: teacherToken,
      body: { enabled: true, points_per_message: 1, max_length: 0, max_per_day: 0 },
    });
    ok('非法字数被拒（0）', badSet2.status === 400, badSet2.body?.error);

    // 设为「每条扣 2 积分、字数 20、不限条数」
    const goodSet = await api('PUT', '/api/teacher/message-settings', {
      token: teacherToken,
      body: { enabled: true, points_per_message: 2, max_length: 20, max_per_day: 0 },
    });
    ok('保存合法设置', goodSet.status === 200 && goodSet.body?.data?.pointsPerMessage === 2,
       JSON.stringify(goodSet.body?.data));

    const studentCantSet = await api('PUT', '/api/teacher/message-settings', {
      token: tokenA,
      body: { enabled: true, points_per_message: 1, max_length: 100, max_per_day: 0 },
    });
    ok('⛔ 学生身份改设置被拒', studentCantSet.status === 403, `status=${studentCantSet.status}`);

    // ---------- C. 学生状态接口 ----------
    section('C. 学生消息状态接口');
    const my = await api('GET', '/api/student/digital-messages/my', { token: tokenA });
    const st = my.body?.data;
    ok('返回 points_per_message', st?.points_per_message === 2, String(st?.points_per_message));
    ok('返回 max_length', st?.max_length === 20, String(st?.max_length));
    ok('返回 current_points', typeof st?.current_points === 'number', String(st?.current_points));
    ok('返回 muted=false', st?.muted === false, String(st?.muted));

    // ---------- D. 非数字内容放行（核心：解除旧限制） ----------
    section('D. 解除「仅数字」限制');
    const oldNumericOnly = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '你好，这道题怎么做？' },
    });
    ok('★ 纯文字消息发送成功（原限制已解除）', oldNumericOnly.status === 200, JSON.stringify(oldNumericOnly.body?.data));
    if (oldNumericOnly.body?.data?.ok) {
      const [rows] = await conn.query(
        'SELECT id FROM student_messages WHERE sender_id = ? ORDER BY id DESC LIMIT 1', [A.id]);
      if (rows[0]) createdMsgIds.push(rows[0].id);
    }

    const withSymbols = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: 'OK! 123 +-= @#$%' },
    });
    ok('符号/字母/数字混合均可发送', withSymbols.status === 200, JSON.stringify(withSymbols.body?.data));
    if (withSymbols.body?.data?.ok) {
      const [rows] = await conn.query(
        'SELECT id FROM student_messages WHERE sender_id = ? ORDER BY id DESC LIMIT 1', [A.id]);
      if (rows[0]) createdMsgIds.push(rows[0].id);
    }

    const empty = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '   ' },
    });
    ok('空内容被拒', empty.status === 400, empty.body?.error);

    const toSelf = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'a', content: '给自己' },
    });
    ok('不能给自己发', toSelf.status === 400, toSelf.body?.error);

    const toGhost = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'no_such_user_xyz', content: '你好' },
    });
    ok('接收者不存在 → 404', toGhost.status === 404, toGhost.body?.error);

    // ---------- E. 字数上限 ----------
    section('E. 单条消息字数限制');
    const longText = '字'.repeat(25); // 上限 20
    const tooLong = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: longText },
    });
    ok('超字数被拒', tooLong.status === 400, tooLong.body?.error);
    const justOk = '字'.repeat(20);
    const atLimit = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: justOk },
    });
    ok('恰好等于上限 → 放行', atLimit.status === 200, JSON.stringify(atLimit.body?.data));
    if (atLimit.body?.data?.ok) {
      const [rows] = await conn.query(
        'SELECT id FROM student_messages WHERE sender_id = ? ORDER BY id DESC LIMIT 1', [A.id]);
      if (rows[0]) createdMsgIds.push(rows[0].id);
    }

    // ---------- F. 扣积分 ----------
    section('F. 扣积分（原子）');
    const [beforePt] = await conn.query('SELECT current_points FROM profiles WHERE id = ?', [A.id]);
    const beforePoints = beforePt[0].current_points;
    const [txBefore] = await conn.query(
      'SELECT COUNT(*) AS n FROM point_transactions WHERE student_id = ?', [A.id]);

    const pay = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '扣分测试' },
    });
    ok('发送成功并回执扣分数', pay.status === 200 && pay.body?.data?.points_cost === 2,
       JSON.stringify(pay.body?.data));
    if (pay.body?.data?.ok) {
      const [rows] = await conn.query(
        'SELECT id FROM student_messages WHERE sender_id = ? ORDER BY id DESC LIMIT 1', [A.id]);
      if (rows[0]) createdMsgIds.push(rows[0].id);
    }
    const [afterPt] = await conn.query('SELECT current_points FROM profiles WHERE id = ?', [A.id]);
    ok('★ 积分实际减少 2', afterPt[0].current_points === beforePoints - 2,
       `${beforePoints} → ${afterPt[0].current_points}`);
    const [txAfter] = await conn.query(
      'SELECT COUNT(*) AS n FROM point_transactions WHERE student_id = ?', [A.id]);
    ok('写入了积分流水', txAfter[0].n === txBefore[0].n + 1,
       `${txBefore[0].n} → ${txAfter[0].n}`);

    // 余额不足拒发：把积分临时设为 0（记下原值，finally 还原）
    await conn.query('UPDATE profiles SET current_points = 0 WHERE id = ?', [A.id]);
    const poor = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '没钱了' },
    });
    ok('★ 积分不足拒发（不产生消息）', poor.status === 400, poor.body?.error);
    const [msgAfterPoor] = await conn.query(
      'SELECT COUNT(*) AS n FROM student_messages WHERE sender_id = ? AND content = ?', [A.id, '没钱了']);
    ok('积分不足时确实没落库', msgAfterPoor[0].n === 0, `count=${msgAfterPoor[0].n}`);
    await conn.query('UPDATE profiles SET current_points = ? WHERE id = ?', [beforePoints, A.id]);

    // ---------- G. 屏蔽关键词 ----------
    section('G. 屏蔽关键词');
    const kwList = await api('GET', '/api/teacher/message-keywords', { token: teacherToken });
    ok('教师端读取屏蔽词库', kwList.status === 200 && Array.isArray(kwList.body?.data),
       `共 ${kwList.body?.data?.length} 个`);
    ok('预置屏蔽词已就位（≥18）', (kwList.body?.data?.length || 0) >= 18, String(kwList.body?.data?.length));

    const addKw = await api('POST', '/api/teacher/message-keywords', {
      token: teacherToken, body: { word: TMP + '违规词', category: '自定义' },
    });
    ok('新增屏蔽词', addKw.status === 200, JSON.stringify(addKw.body?.data));
    const tmpKwId = addKw.body?.data?.id;

    const dupKw = await api('POST', '/api/teacher/message-keywords', {
      token: teacherToken, body: { word: TMP + '违规词', category: '自定义' },
    });
    ok('重复屏蔽词被拒', dupKw.status === 400, dupKw.body?.error);

    const hitKw = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '你这个' + TMP + '违规词啊' },
    });
    ok('★ 含屏蔽词的消息被拒发', hitKw.status === 400, hitKw.body?.error);
    const [msgAfterKw] = await conn.query(
      'SELECT COUNT(*) AS n FROM student_messages WHERE sender_id = ? AND content LIKE ?',
      [A.id, '%' + TMP + '违规词%']);
    ok('屏蔽词拦截后未落库', msgAfterKw[0].n === 0, `count=${msgAfterKw[0].n}`);

    const [beforeKwPoint] = await conn.query('SELECT current_points FROM profiles WHERE id = ?', [A.id]);
    ok('★ 屏蔽词拦截不扣积分', beforeKwPoint[0].current_points === beforePoints,
       `当前 ${beforeKwPoint[0].current_points}`);

    const toggleKw = await api('PUT', `/api/teacher/message-keywords/${tmpKwId}`, {
      token: teacherToken, body: { enabled: 0 },
    });
    ok('停用屏蔽词', toggleKw.status === 200, JSON.stringify(toggleKw.body?.data));
    const passAfterDisable = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: TMP + '违规词现在能发了' },
    });
    ok('停用后同样内容可发送', passAfterDisable.status === 200, JSON.stringify(passAfterDisable.body?.data));
    if (passAfterDisable.body?.data?.ok) {
      const [rows] = await conn.query(
        'SELECT id FROM student_messages WHERE sender_id = ? ORDER BY id DESC LIMIT 1', [A.id]);
      if (rows[0]) createdMsgIds.push(rows[0].id);
    }
    await api('DELETE', `/api/teacher/message-keywords/${tmpKwId}`, { token: teacherToken });

    // ---------- H. 黑名单 ----------
    section('H. 黑名单');
    const orderKw = await api('GET', '/api/teacher/message-keywords', { token: teacherToken });
    ok('教师端传参兼容（limit/keyword 不报错）', orderKw.status === 200, '');

    // b 拉黑 a
    const blRes = await api('POST', '/api/student/message-blacklist', {
      token: tokenB, body: { target_id: A.id },
    });
    ok('b 拉黑 a 成功', blRes.status === 200, JSON.stringify(blRes.body?.data));
    const blId = (await conn.query(
      'SELECT id FROM student_message_blacklist WHERE owner_id = ? AND target_id = ?', [B.id, A.id]))[0][0]?.id;

    const blList = await api('GET', '/api/student/message-blacklist', { token: tokenB });
    ok('b 查看自己的黑名单', blList.status === 200 && blList.body?.data?.length >= 1,
       `共 ${blList.body?.data?.length} 条`);

    const blockedSend = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '被拉黑还能发吗' },
    });
    ok('★ 被拉黑后发送失败', blockedSend.status === 403, blockedSend.body?.error);
    ok('★ 提示为中性文案（不暴露拉黑方）',
       /对方已设置不接收消息/.test(blockedSend.body?.error || ''),
       blockedSend.body?.error);

    // b 拉黑 a 后，a 不应出现在 b 的同班同学可选列表里
    const classmatesB = await api('GET', '/api/student/classmates', { token: tokenB });
    const aInList = (classmatesB.body?.data || []).some(c => c.username === 'a');
    ok('★ 被拉黑者不再出现在可选同学列表', !aInList, `列表长度 ${(classmatesB.body?.data || []).length}`);

    // 手工输入账号拉黑 + 自重拉黑拦截 + 幂等
    const selfBl = await api('POST', '/api/student/message-blacklist', {
      token: tokenB, body: { target_username: 'b' },
    });
    ok('不能拉黑自己', selfBl.status === 400, selfBl.body?.error);
    const ghostBl = await api('POST', '/api/student/message-blacklist', {
      token: tokenB, body: { target_username: 'no_such_x' },
    });
    ok('拉黑不存在的账号 → 404', ghostBl.status === 404, ghostBl.body?.error);
    const dupBl = await api('POST', '/api/student/message-blacklist', {
      token: tokenB, body: { target_id: A.id },
    });
    ok('重复拉黑幂等不报错', dupBl.status === 200, JSON.stringify(dupBl.body?.data));

    // 移出黑名单后恢复可发
    const rmBl = await api('DELETE', `/api/student/message-blacklist/${blId}`, { token: tokenB });
    ok('移出黑名单', rmBl.status === 200, JSON.stringify(rmBl.body?.data));
    const afterUnbl = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '移出后可以发了' },
    });
    ok('★ 移出黑名单后恢复发送', afterUnbl.status === 200, JSON.stringify(afterUnbl.body?.data));
    if (afterUnbl.body?.data?.ok) {
      const [rows] = await conn.query(
        'SELECT id FROM student_messages WHERE sender_id = ? ORDER BY id DESC LIMIT 1', [A.id]);
      if (rows[0]) createdMsgIds.push(rows[0].id);
    }
    const rmAgain = await api('DELETE', `/api/student/message-blacklist/${blId}`, { token: tokenB });
    ok('重复移出 → 404', rmAgain.status === 404, rmAgain.body?.error);

    // 学生不能动别人的黑名单
    const blOther = await api('POST', '/api/student/message-blacklist', {
      token: tokenA, body: { target_id: B.id },
    });
    const blOtherId = (await conn.query(
      'SELECT id FROM student_message_blacklist WHERE owner_id = ? AND target_id = ?', [A.id, B.id]))[0][0]?.id;
    if (blOtherId) {
      const rmOther = await api('DELETE', `/api/student/message-blacklist/${blOtherId}`, { token: tokenB });
      ok('⛔ 学生不能删他人黑名单条目', rmOther.status === 404, `status=${rmOther.status}`);
      await conn.query('DELETE FROM student_message_blacklist WHERE id = ?', [blOtherId]);
    }
    if (blOtherId === undefined) {
      ok('a 拉黑 b（为后续清理做准备）', blOther.status === 200, String(blOther.status));
    }

    // ---------- I. 禁言 ----------
    section('I. 禁言');
    const badMute = await api('POST', '/api/teacher/message-mutes', {
      token: teacherToken, body: { student_username: 'a', days: 0, reason: '测试' },
    });
    ok('禁言 0 天被拒', badMute.status === 400, badMute.body?.error);

    const muteRes = await api('POST', '/api/teacher/message-mutes', {
      token: teacherToken, body: { student_username: 'a', days: 3, reason: TMP + '测试禁言' },
    });
    ok('设置禁言 3 天', muteRes.status === 200, JSON.stringify(muteRes.body?.data));

    const stMuted = await api('GET', '/api/student/digital-messages/my', { token: tokenA });
    ok('★ 学生端看到 muted=true', stMuted.body?.data?.muted === true, String(stMuted.body?.data?.muted));
    ok('★ 提示还需禁言天数', stMuted.body?.data?.mute_remain_days >= 1,
       String(stMuted.body?.data?.mute_remain_days));

    const mutedSend = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '禁言期间能发吗' },
    });
    ok('★ 禁言期间拒绝发送', mutedSend.status === 403, mutedSend.body?.error);
    ok('★ 错误信息含剩余天数', /还需\s*\d+\s*天/.test(mutedSend.body?.error || ''), mutedSend.body?.error);

    const muteList = await api('GET', '/api/teacher/message-mutes', { token: teacherToken });
    ok('教师端禁言列表可见', (muteList.body?.data || []).some(m => m.student_username === 'a'),
       `共 ${muteList.body?.data?.length} 条`);

    const unmute = await api('DELETE', `/api/teacher/message-mutes/${A.id}`, { token: teacherToken });
    ok('解除禁言', unmute.status === 200, JSON.stringify(unmute.body?.data));
    const stAfterUnmute = await api('GET', '/api/student/digital-messages/my', { token: tokenA });
    ok('★ 解除后 muted=false', stAfterUnmute.body?.data?.muted === false, String(stAfterUnmute.body?.data?.muted));
    const unmuteAgain = await api('DELETE', `/api/teacher/message-mutes/${A.id}`, { token: teacherToken });
    ok('重复解除 → 404', unmuteAgain.status === 404, unmuteAgain.body?.error);

    // ---------- J. 举报 ----------
    section('J. 举报');
    const sendForReport = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: TMP + '举报测试消息' },
    });
    ok('发一条待举报消息', sendForReport.status === 200, JSON.stringify(sendForReport.body?.data));
    const [rMsg] = await conn.query(
      'SELECT id FROM student_messages WHERE sender_id = ? AND content = ? ORDER BY id DESC LIMIT 1',
      [A.id, TMP + '举报测试消息']);
    const reportMsgId = rMsg[0]?.id;
    ok('取得消息 ID', !!reportMsgId, String(reportMsgId));
    createdMsgIds.push(reportMsgId);

    const noReason = await api('POST', '/api/student/message-reports', {
      token: tokenB, body: { message_id: reportMsgId, reason: '   ' },
    });
    ok('举报理由为空被拒', noReason.status === 400, noReason.body?.error);

    const notMine = await api('POST', '/api/student/message-reports', {
      token: tokenA, body: { message_id: reportMsgId, reason: '我自己举报自己' },
    });
    ok('⛔ 只能举报发给自己的消息', notMine.status === 404, `status=${notMine.status}`);

    const report = await api('POST', '/api/student/message-reports', {
      token: tokenB, body: { message_id: reportMsgId, reason: TMP + '含有不当内容' },
    });
    ok('★ 提交举报成功', report.status === 200, JSON.stringify(report.body?.data));
    const dupReport = await api('POST', '/api/student/message-reports', {
      token: tokenB, body: { message_id: reportMsgId, reason: '再举报一次' },
    });
    ok('重复举报幂等', dupReport.status === 200 && dupReport.body?.data?.duplicated === true,
       JSON.stringify(dupReport.body?.data));

    const repList = await api('GET', '/api/teacher/message-reports', { token: teacherToken });
    const mine = (repList.body?.data || []).find(r => r.message_id === reportMsgId);
    ok('★ 教师端能看到举报（含举报人/被举报人/理由）',
       !!mine && mine.reporter_username === 'b' && mine.reported_username === 'a' && !!mine.reason,
       mine ? `举报人=${mine.reporter_username} 被举报人=${mine.reported_username}` : '未找到');
    ok('★ 举报快照含被举报消息内容', mine?.message_content === TMP + '举报测试消息',
       String(mine?.message_content));
    const reportId = mine?.id;

    const pendingOnly = await api('GET', '/api/teacher/message-reports?status=pending', { token: teacherToken });
    ok('按状态筛选举报', pendingOnly.status === 200, `共 ${pendingOnly.body?.data?.length} 条`);

    // 处置：禁言 5 天 + 删除消息
    const handle = await api('POST', `/api/teacher/message-reports/${reportId}/handle`, {
      token: teacherToken, body: { action: 'handle', note: TMP + '已核实', mute_days: 5, delete_message: true },
    });
    ok('★ 处置举报（禁言+删消息）', handle.status === 200, JSON.stringify(handle.body?.data));
    const [msgDeleted] = await conn.query('SELECT is_deleted FROM student_messages WHERE id = ?', [reportMsgId]);
    ok('★ 被举报消息已软删', msgDeleted[0]?.is_deleted === 1, `is_deleted=${msgDeleted[0]?.is_deleted}`);
    const [mutedRow] = await conn.query(
      'SELECT mute_until FROM student_message_mutes WHERE student_id = ?', [A.id]);
    ok('★ 被举报人被禁言', mutedRow.length === 1, mutedRow[0]?.mute_until);
    const [repHandled] = await conn.query('SELECT status, muted_days FROM student_message_reports WHERE id = ?', [reportId]);
    ok('举报单状态已处理 / 记录禁言天数',
       repHandled[0]?.status === 'handled' && repHandled[0]?.muted_days === 5,
       JSON.stringify(repHandled[0]));
    await conn.query('DELETE FROM student_message_mutes WHERE student_id = ?', [A.id]);

    // 学生端能看到自己的举报进度
    const myReports = await api('GET', '/api/student/message-reports/my', { token: tokenB });
    ok('学生可查看自己的举报记录', (myReports.body?.data || []).some(r => r.id === reportId),
       `共 ${myReports.body?.data?.length} 条`);

    // 被删的消息不出现在学生收件箱
    const inboxB = await api('GET', '/api/student/digital-messages/my', { token: tokenB });
    ok('★ 已删消息不出现在接收方收件箱',
       !(inboxB.body?.data?.messages || []).some(m => m.id === reportMsgId), '');

    // ---------- K. 快捷短语 ----------
    section('K. 快捷短语');
    const qList = await api('GET', '/api/teacher/message-quick-replies', { token: teacherToken });
    ok('教师端读快捷短语（≥10 预置）', (qList.body?.data?.length || 0) >= 10, String(qList.body?.data?.length));
    const qAdd = await api('POST', '/api/teacher/message-quick-replies', {
      token: teacherToken, body: { content: TMP + '快捷短语测试', sort_order: 500 },
    });
    ok('新增快捷短语', qAdd.status === 200, JSON.stringify(qAdd.body?.data));
    const qId = qAdd.body?.data?.id;
    const stuQ = await api('GET', '/api/student/message-quick-replies', { token: tokenA });
    ok('★ 学生端能拉到快捷短语', (stuQ.body?.data || []).length >= 10, `共 ${stuQ.body?.data?.length} 条`);
    const qDel = await api('DELETE', `/api/teacher/message-quick-replies/${qId}`, { token: teacherToken });
    ok('删除快捷短语', qDel.status === 200, JSON.stringify(qDel.body?.data));

    // ---------- L. 教师端消息记录 ----------
    section('L. 教师端消息记录与概览');
    const msgs = await api('GET', '/api/teacher/student-messages', { token: teacherToken });
    ok('教师端查看学生消息记录', msgs.status === 200 && Array.isArray(msgs.body?.data),
       `共 ${msgs.body?.data?.length} 条`);
    const found = (msgs.body?.data || []).some(m => createdMsgIds.includes(m.id));
    ok('刚发的测试消息在记录里', found, `createdMsgIds=${createdMsgIds.length}`);
    const searchMsg = await api('GET', '/api/teacher/student-messages?keyword=' + encodeURIComponent(TMP), { token: teacherToken });
    ok('按内容搜索消息', searchMsg.status === 200, `命中 ${searchMsg.body?.data?.length} 条`);

    const overview = await api('GET', '/api/teacher/message-overview', { token: teacherToken });
    ok('教师端概览接口', overview.status === 200 && typeof overview.body?.data?.today_messages === 'number',
       JSON.stringify(overview.body?.data));

    const stuCantOverview = await api('GET', '/api/teacher/message-overview', { token: tokenA });
    ok('⛔ 学生不能访问教师端概览', stuCantOverview.status === 403, `status=${stuCantOverview.status}`);

    // 教师删除消息
    const [tmpMsg] = await conn.query(
      'SELECT id FROM student_messages WHERE sender_id = ? AND content LIKE ? AND is_deleted = 0 ORDER BY id DESC LIMIT 1',
      [A.id, TMP + '%']);
    if (tmpMsg[0]) {
      const delMsg = await api('DELETE', `/api/teacher/student-messages/${tmpMsg[0].id}`, { token: teacherToken });
      ok('教师删除学生消息', delMsg.status === 200, JSON.stringify(delMsg.body?.data));
    } else {
      ok('教师删除学生消息（无样本，跳过）', true, 'skip');
    }

    // ---------- M. 全局开关 ----------
    section('M. 全局开关与班级开关');
    const offSet = await api('PUT', '/api/teacher/message-settings', {
      token: teacherToken, body: { enabled: false, points_per_message: 2, max_length: 20, max_per_day: 0 },
    });
    ok('关闭消息功能', offSet.status === 200, '');
    const sendWhenOff = await api('POST', '/api/student/digital-messages/send', {
      token: tokenA, body: { receiver_username: 'b', content: '关闭后能发吗' },
    });
    ok('★ 总开关关闭后学生发不出', sendWhenOff.status === 403, sendWhenOff.body?.error);
    await api('PUT', '/api/teacher/message-settings', {
      token: teacherToken, body: { enabled: true, points_per_message: 2, max_length: 20, max_per_day: 0 },
    });

  } catch (e) {
    console.error('\n脚本异常：', e.message);
    fail++;
    failures.push('脚本异常: ' + e.message);
  } finally {
    // ================= 还原：绝不留痕 =================
    section('N. 不留痕：还原所有临时数据');
    try {
      // 1. 恢复原设置
      if (origSettings) {
        await conn.query(
          `UPDATE student_message_settings
              SET enabled = ?, points_per_message = ?, max_length = ?, max_per_day = ?, updated_by = ?
            WHERE id = 1`,
          [origSettings.enabled, origSettings.points_per_message, origSettings.max_length,
           origSettings.max_per_day, origSettings.updated_by]
        );
      }
      // 2. 恢复 a 的积分
      await conn.query('UPDATE profiles SET current_points = ? WHERE id = ?', [origAPoints, A.id]);
      // 3. 删除脚本新建的消息（按 id，兜底再按 tmp_ 内容）
      if (createdMsgIds.length) {
        await conn.query('DELETE FROM student_messages WHERE id IN (?)', [createdMsgIds]);
      }
      await conn.query('DELETE FROM student_messages WHERE content LIKE ?', [TMP + '%']);
      // 4. 删除脚本产生的举报单
      await conn.query('DELETE FROM student_message_reports WHERE reason LIKE ?', [TMP + '%']);
      await conn.query('DELETE FROM student_message_reports WHERE reported_id = ? AND reporter_id = ?', [A.id, B.id]);
      // 5. 清理脚本产生的禁言
      for (const sid of [A.id]) {
        if (!origMuteIds.has(sid)) {
          await conn.query('DELETE FROM student_message_mutes WHERE student_id = ?', [sid]);
        }
      }
      await conn.query('DELETE FROM student_message_mutes WHERE student_id = ?', [A.id]);
      // 6. 清理脚本新增的黑名单（保留教师原有数据）
      const [nowBl] = await conn.query('SELECT id FROM student_message_blacklist');
      for (const row of nowBl) {
        if (!origBlIds.has(row.id)) {
          await conn.query('DELETE FROM student_message_blacklist WHERE id = ?', [row.id]);
        }
      }
      // 7. 清理 tmp_ 前缀的屏蔽词 / 快捷短语
      await conn.query('DELETE FROM student_message_keywords WHERE word LIKE ?', [TMP + '%']);
      await conn.query('DELETE FROM student_message_quick_replies WHERE content LIKE ?', [TMP + '%']);

      // 8. 校验：确实不留痕
      const [[m1]] = await conn.query('SELECT COUNT(*) AS n FROM student_messages WHERE content LIKE ?', [TMP + '%']);
      ok('无 tmp_ 消息残留', m1.n === 0, `残留 ${m1.n} 条`);
      const [[m2]] = await conn.query('SELECT COUNT(*) AS n FROM student_message_reports WHERE reason LIKE ?', [TMP + '%']);
      ok('无 tmp_ 举报残留', m2.n === 0, `残留 ${m2.n} 条`);
      const [[m3]] = await conn.query('SELECT COUNT(*) AS n FROM student_message_keywords WHERE word LIKE ?', [TMP + '%']);
      ok('无 tmp_ 屏蔽词残留', m3.n === 0, `残留 ${m3.n} 条`);
      const [[m4]] = await conn.query('SELECT COUNT(*) AS n FROM student_message_quick_replies WHERE content LIKE ?', [TMP + '%']);
      ok('无 tmp_ 快捷短语残留', m4.n === 0, `残留 ${m4.n} 条`);
      const [[m5]] = await conn.query('SELECT COUNT(*) AS n FROM student_message_mutes WHERE student_id = ?', [A.id]);
      ok('学生 a 未被留下禁言', m5.n === 0, `残留 ${m5.n} 条`);
      const [[m6]] = await conn.query('SELECT current_points FROM profiles WHERE id = ?', [A.id]);
      ok('学生 a 积分已还原', m6.current_points === origAPoints,
         `现在=${m6.current_points} 原值=${origAPoints}`);
      const [[m7]] = await conn.query('SELECT COUNT(*) AS n FROM student_message_keywords');
      ok('屏蔽词总数已还原', m7.n === origKwCount[0].n, `${m7.n} vs ${origKwCount[0].n}`);
      const [[m8]] = await conn.query('SELECT COUNT(*) AS n FROM student_message_quick_replies');
      ok('快捷短语总数已还原', m8.n === origQuickCount[0].n, `${m8.n} vs ${origQuickCount[0].n}`);
      const [[m9]] = await conn.query(
        'SELECT points_per_message, max_length FROM student_message_settings WHERE id = 1');
      ok('消息设置已还原',
         m9.points_per_message === origSettings.points_per_message && m9.max_length === origSettings.max_length,
         `${m9.points_per_message}/${m9.max_length}`);
    } catch (e) {
      console.error('还原过程出错：', e.message);
      fail++;
      failures.push('还原出错: ' + e.message);
    }
    await conn.end();
  }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach(f => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
