// 测试Buff功能
const pool = require('./src/db');

async function test() {
  try {
    // 1. 获取教师信息
    const [teachers] = await pool.query("SELECT id, username, real_name FROM profiles WHERE role = 'teacher' LIMIT 5");
    console.log('=== 教师列表 ===');
    console.log(JSON.stringify(teachers, null, 2));
    
    // 2. 获取学生a的信息
    const [students] = await pool.query("SELECT id, username, real_name, class_id FROM profiles WHERE username = 'a' AND role = 'student' LIMIT 1");
    console.log('\n=== 学生a信息 ===');
    console.log(JSON.stringify(students, null, 2));
    
    if (students.length > 0 && teachers.length > 0) {
      const teacherId = teachers[0].id;
      const studentId = students[0].id;
      const classId = students[0].class_id;
      
      console.log(`\n教师ID: ${teacherId}`);
      console.log(`学生ID: ${studentId}`);
      console.log(`班级ID: ${classId}`);
      
      // 3. 发送带buff的通知 - 用班级发送
      console.log('\n=== 发送带buff的通知 ===');
      const response = await fetch('http://localhost:3101/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacher_id: teacherId,
          title: '测试Buff通知',
          content: '这是一条测试Buff的通知，附带+15%暴击率Buff。',
          notification_type: 'class',
          target_class_id: classId,
          target_student_ids: [],
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
          buff_duration: 30,
          scheduled_at: null
        })
      });
      
      const result = await response.json();
      console.log('发送结果:', JSON.stringify(result, null, 2));
      
      // 4. 检查学生是否获得buff
      console.log('\n=== 学生当前buff ===');
      const [buffs] = await pool.query(
        'SELECT id, student_id, buff_type, crit_modifier, expires_at, created_at FROM student_buffs WHERE student_id = ? AND expires_at > NOW() ORDER BY created_at DESC',
        [studentId]
      );
      console.log(JSON.stringify(buffs, null, 2));
      
      // 5. 检查通知记录是否包含buff字段
      console.log('\n=== 最新通知 ===');
      const [notifs] = await pool.query(
        'SELECT id, title, has_buff, buff_type, buff_modifier, buff_duration, created_at FROM notifications WHERE teacher_id = ? ORDER BY id DESC LIMIT 3',
        [teacherId]
      );
      console.log(JSON.stringify(notifs, null, 2));
    }
    
    await pool.end();
  } catch(e) {
    console.error('测试失败:', e);
    process.exit(1);
  }
}

test();
