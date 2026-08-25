-- 班级管理快捷开关（与通知、点名模块对应学生级开关双向同步）
-- 班级级开关默认 1（允许），切换时会同步改该班所有学生的 profiles 对应字段；
-- 反之在通知分发/点名批量操作时，如果作用对象是全班，也会反向同步更新 classes 对应字段。
ALTER TABLE classes ADD COLUMN IF NOT EXISTS app_center_enabled TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '是否允许该班级学生使用应用中心（同步 profiles.can_use_app）';
ALTER TABLE classes ADD COLUMN IF NOT EXISTS exchange_enabled TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '是否允许该班级学生打开积分兑换模块（同步 profiles.can_open_exchange_module）';
ALTER TABLE classes ADD COLUMN IF NOT EXISTS internet_enabled TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '是否允许该班级学生上网冲浪（同步 profiles.can_use_browser）';
