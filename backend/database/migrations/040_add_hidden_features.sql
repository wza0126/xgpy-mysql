-- 学生隐藏功能配置
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hidden_features JSON DEFAULT NULL
    COMMENT '学生隐藏功能配置，JSON数组，包含要隐藏的功能key，如["paint_board"]'
    AFTER can_exchange_internet_code;
