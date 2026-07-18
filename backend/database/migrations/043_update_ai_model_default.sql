-- 更新 AI 模型默认值为 DeepSeek V4 系列
-- deepseek-chat / deepseek-reasoner 将于 2026/07/24 弃用，qwen3.6-plus 为旧默认值
-- 仅当当前配置为旧模型时才更新，不覆盖用户已设置的新模型
UPDATE system_config
SET value = JSON_OBJECT('value', 'deepseek-v4-flash')
WHERE config_key = 'ai_model'
  AND (
    value LIKE '%qwen3.6-plus%'
    OR value LIKE '%deepseek-chat%'
    OR value LIKE '%deepseek-reasoner%'
  );
