-- 上网权限奖励体系
-- 通知勾选"允许上网"后，发出时给所有接收学生开通上网权限
-- 测试/考试勾选"及格后允许上网"后，学生及格自动开通并收到系统通知

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS grant_browser TINYINT(1) NOT NULL DEFAULT 0 COMMENT '发出通知时给接收学生开通上网权限';

ALTER TABLE tests
  ADD COLUMN IF NOT EXISTS pass_grant_browser TINYINT(1) NOT NULL DEFAULT 0 COMMENT '学生及格后自动开通上网权限（type=test/exam 通用）';
