// 测试点名 API
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const BASE = 'http://localhost:3101';

(async () => {
  console.log('=== 1. 教师登录 ===');
  const loginRes = await fetch(`${BASE}/api/auth/secure-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password: 'test123456' }),
  });
  const loginJson = await loginRes.json();
  console.log('登录响应:', JSON.stringify(loginJson).slice(0, 600));
  if (!loginJson.data?.session?.access_token) {
    console.log('尝试其他密码 sy/123456...');
    const r2 = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sy', password: '123456' }),
    });
    const j2 = await r2.json();
    console.log('sy 登录响应:', JSON.stringify(j2).slice(0, 200));
    if (!j2.data?.session?.access_token) {
      console.log('登录失败，请检查密码');
      process.exit(1);
    }
    var token = j2.data.session.access_token;
  } else {
    var token = loginJson.data.session.access_token;
  }
  console.log('Token 前缀:', token.slice(0, 20));

  const classId = '79691958-faff-48ee-96d2-d2d288129e1b';
  const headers = { 'Authorization': `Bearer ${token}` };

  console.log('\n=== 2. GET /api/teacher/roll-call/students/:classId ===');
  const s1 = await fetch(`${BASE}/api/teacher/roll-call/students/${classId}`, { headers });
  const j1 = await s1.json();
  console.log('状态:', s1.status);
  console.log('数据:', JSON.stringify(j1).slice(0, 500));

  console.log('\n=== 3. GET /api/teacher/roll-call/seating/:classId ===');
  const s2 = await fetch(`${BASE}/api/teacher/roll-call/seating/${classId}`, { headers });
  const j2 = await s2.json();
  console.log('状态:', s2.status);
  console.log('数据:', JSON.stringify(j2).slice(0, 500));

  // 获取该班级学生 ID（用于保存）
  const stuList = j1.data || [];
  if (stuList.length === 0) {
    console.log('该班级无学生，跳过保存测试');
  } else {
    console.log('\n=== 4. POST /api/teacher/roll-call/seating/:classId/save ===');
    const sampleSeats = stuList.slice(0, 3).map((s, i) => ({
      seat_number: i + 1,
      student_id: s.id,
      position_x: i,
      position_y: 0,
      is_locked: false,
    }));
    const s3 = await fetch(`${BASE}/api/teacher/roll-call/seating/${classId}/save`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seats: sampleSeats, is_locked: false }),
    });
    const j3 = await s3.json();
    console.log('状态:', s3.status);
    console.log('响应:', JSON.stringify(j3).slice(0, 300));

    console.log('\n=== 4.5 POST /api/teacher/roll-call/seating/:classId/auto-arrange ===');
    const s6 = await fetch(`${BASE}/api/teacher/roll-call/seating/${classId}/auto-arrange`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j6 = await s6.json();
    console.log('状态:', s6.status);
    console.log('响应:', JSON.stringify(j6));
  }

  console.log('\n=== 5. POST /api/teacher/roll-call/lock/:classId ===');
  const s4 = await fetch(`${BASE}/api/teacher/roll-call/lock/${classId}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_locked: true }),
  });
  const j4 = await s4.json();
  console.log('状态:', s4.status);
  console.log('响应:', JSON.stringify(j4));

  console.log('\n=== 7. GET /api/teacher/roll-call/proxy-token/:studentId ===');
  if (j1.data && j1.data.length > 0) {
    const targetStudent = j1.data[0];
    const s7 = await fetch(`${BASE}/api/teacher/roll-call/proxy-token/${targetStudent.id}`, { headers });
    const j7 = await s7.json();
    console.log('状态:', s7.status);
    console.log('响应:', JSON.stringify(j7).slice(0, 500));

    if (j7.data?.session_id) {
      console.log('\n=== 8. DELETE /api/teacher/roll-call/proxy-token/:sessionId ===');
      const s8 = await fetch(`${BASE}/api/teacher/roll-call/proxy-token/${j7.data.session_id}`, {
        method: 'DELETE',
        headers,
      });
      const j8 = await s8.json();
      console.log('状态:', s8.status);
      console.log('响应:', JSON.stringify(j8));
    }
  }
  console.log('\n=== 9. 解锁布局（清理） ===');
  const lockUnlock = await fetch(`${BASE}/api/teacher/roll-call/lock/${classId}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_locked: false }),
  });
  console.log('解锁响应:', await lockUnlock.json());
})().catch(e => { console.error('错误:', e); process.exit(1); });
