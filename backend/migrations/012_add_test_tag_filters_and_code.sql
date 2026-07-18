-- 为 tests 表添加题目标签筛选字段
ALTER TABLE tests 
ADD COLUMN IF NOT EXISTS tag_filters JSON DEFAULT NULL,
ADD COLUMN IF NOT EXISTS allow_internet_code BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS internet_code_reward INT DEFAULT 0;

-- 为 test_records 表添加认证码字段
ALTER TABLE test_records 
ADD COLUMN IF NOT EXISTS internet_codes_earned INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS internet_code VARCHAR(100) DEFAULT NULL;
