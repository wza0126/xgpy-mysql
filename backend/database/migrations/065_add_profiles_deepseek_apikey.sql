-- profiles 表添加学生自绑 DeepSeek API Key 字段
-- 背景：DeepSeek 涨价后允许学生绑定自有 Key 创作，绑定后不扣积分、无次数限制
-- NULL 表示走平台 Key + 扣积分流程；非 NULL 表示用学生 Key + 跳过扣分
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deepseek_api_key VARCHAR(128) NULL
  COMMENT '学生自绑的 DeepSeek API Key（明文存储，NULL 表示走平台 Key）';
