// 测试发送带buff的通知
const API_URL = 'http://localhost:3101/api/notifications';

async function test() {
  // 1. 获取教师信息
  const teacherId = 'f8c913f6-4d4a-4e3e-8a7b-c3a8e7d3f1e2'; // 先试试常见的
  
  // 2. 先获取学生a的ID
  const profilesUrl = 'http://localhost:3101/api/profiles';
  try {
    const res = await fetch(`${profilesUrl}?role=student`);
    const data = await res.json();
    console.log('学生列表:', JSON.stringify(data, null, 2));
  } catch(e) {
    console.log('获取学生列表失败:', e.message);
  }
  
  // 3. 用已知的通知API - 直接构造请求
  const payload = {
    teacher_id: 'teacher', // 可能是username，让我们试试
    title: '测试Buff通知',
    content: '这是一条测试Buff的通知，附带+15%暴击率。',
    notification_type: 'student',
    target_class_id: null,
    target_student_ids: ['1'], // 假设学生a的ID是1
    has_point_reward: false,
    point_reward_amount: 0,
    point_reward_reason: '',
    has_point_penalty: false,
    point_penalty_amount: 0,
    point_penalty_reason: '',
    can_open_exchange_module: true,
    enable_app_access: true,
    enable_focus_mode: true,
    has_buff: true,
    buff_type: 'teacher_crit',
    buff_modifier: 15,
    buff_duration: 10,
    scheduled_at: null
  };
  
  console.log('发送通知 payload:', JSON.stringify(payload, null, 2));
  
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('发送结果:', JSON.stringify(data, null, 2));
  } catch(e) {
    console.error('发送失败:', e.message);
  }
}

test();
