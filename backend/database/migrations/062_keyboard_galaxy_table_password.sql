-- 键盘星域：对战桌增加密码列（首位入座设置，次位需输入正确才能入座）
ALTER TABLE typing_rooms ADD COLUMN IF NOT EXISTS password VARCHAR(4) DEFAULT NULL COMMENT '4位数字密码，NULL表示无密码';

-- 学生对学生数字消息表：每条记录保存发送人、接收人、数字内容、时间
-- 每日限发 3 条，仅支持数字，最长 8 位
CREATE TABLE IF NOT EXISTS student_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id VARCHAR(50) NOT NULL COMMENT '发送人学生ID',
  sender_username VARCHAR(100) NOT NULL COMMENT '发送人账号',
  sender_real_name VARCHAR(100) COMMENT '发送人姓名',
  receiver_id VARCHAR(50) NOT NULL COMMENT '接收人学生ID',
  receiver_username VARCHAR(100) NOT NULL COMMENT '接收人账号',
  receiver_real_name VARCHAR(100) COMMENT '接收人姓名',
  content VARCHAR(8) NOT NULL COMMENT '数字内容，长度 1-8位',
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
  is_read BOOLEAN DEFAULT FALSE COMMENT '是否已读',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sender_id (sender_id),
  INDEX idx_receiver_id (receiver_id),
  INDEX idx_sent_at (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学生间数字消息发送记录';
