// 测试签发 proxy token 时是否会踢掉教师主会话
async function main() {
  // 1. 教师登录
  const loginRes = await fetch('http://localhost:3101/api/auth/secure-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'teacher',
      password: 'meoo.local',
      deviceInfo: 'test-script'
    })
  });
  const loginData = await loginRes.json();
  console.log('教师登录结果:', JSON.stringify(loginData, null, 2));

  if (!loginData.data?.session?.access_token) {
    console.error('登录失败');
    return;
  }

  const teacherToken = loginData.data.session.access_token;
  const teacherUser = loginData.data.user;
  console.log('教师 token:', teacherToken.substring(0, 30) + '...');
  console.log('教师 ID:', teacherUser.id);

  // 2. 验证教师 token 有效
  const sessionRes = await fetch('http://localhost:3101/api/auth/session', {
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const sessionData = await sessionRes.json();
  console.log('教师 session 验证:', sessionRes.status, JSON.stringify(sessionData, null, 2));

  // 3. 找一个学生
  const studentsRes = await fetch('http://localhost:3101/api/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    },
    body: JSON.stringify({
      table: 'profiles',
      filters: { role: 'student' },
      limit: 1
    })
  });
  const studentsData = await studentsRes.json();
  console.log('学生查询:', studentsRes.status);
  if (!studentsData.data || studentsData.data.length === 0) {
    console.error('找不到学生');
    return;
  }
  const studentId = studentsData.data[0].id;
  console.log('学生 ID:', studentId);

  // 4. 签发代理 token（关键步骤）
  const proxyRes = await fetch(`http://localhost:3101/api/teacher/roll-call/proxy-token/${studentId}`, {
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const proxyData = await proxyRes.json();
  console.log('代理 token 签发:', proxyRes.status, JSON.stringify(proxyData, null, 2));

  // 5. 再次验证教师 token
  const sessionRes2 = await fetch('http://localhost:3101/api/auth/session', {
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const sessionData2 = await sessionRes2.json();
  console.log('签发代理后教师 session 验证:', sessionRes2.status, JSON.stringify(sessionData2.data?.session?.user?.id || sessionData2.error, null, 2));

  // 6. 关闭/撤销代理 token
  console.log('\n--- 撤销代理 token ---');
  const sessionId = proxyData.data.session_id;
  console.log('撤销 sessionId:', sessionId);
  const revokeRes = await fetch(`http://localhost:3101/api/teacher/roll-call/proxy-token/${sessionId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const revokeData = await revokeRes.json();
  console.log('撤销响应:', revokeRes.status, JSON.stringify(revokeData, null, 2));

  // 7. 再次验证教师 token
  const sessionRes3 = await fetch('http://localhost:3101/api/auth/session', {
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const sessionData3 = await sessionRes3.json();
  console.log('撤销后教师 session 验证:', sessionRes3.status, JSON.stringify(sessionData3, null, 2));
}

main().catch(console.error);
