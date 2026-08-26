-- 测试/考试及格后允许兑换、允许访问应用中心两个开关
-- 与 pass_grant_browser 同模式：学生及格后自动开通对应权限并收到系统通知
-- 字段对应通知管理中创建通知的"允许兑换(can_open_exchange_module)"和"允许使用应用(enable_app_access / profiles.can_use_app)"
ALTER TABLE tests
  ADD COLUMN IF NOT EXISTS pass_grant_exchange TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '学生及格后允许兑换（同步 profiles.can_open_exchange_module = 1）',
  ADD COLUMN IF NOT EXISTS pass_grant_app_center TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '学生及格后允许访问应用中心（同步 profiles.can_use_app = 1）';
