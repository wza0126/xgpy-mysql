-- 清洗上传文件引用中的绝对地址，统一为相对路径 /uploads/...
-- 背景：历史上传接口把 http://主机/uploads/... 完整URL或服务器绝对路径存入数据库，
--       导致开发环境上传的文件在生产环境无法访问。
-- 规则：仅处理指向本站 /uploads/ 的地址；外部链接（如对象存储，不含 /uploads/）不受影响。

-- 1. 桌面背景库
UPDATE desktop_backgrounds
SET url = REGEXP_REPLACE(url, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE url REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

-- 2. 学生自定义背景
UPDATE profiles
SET custom_background = REGEXP_REPLACE(custom_background, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE custom_background REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

-- 3. 宠物图片（仅清理指向本站 /uploads/ 的地址，外部存储地址保持不变）
UPDATE pets
SET image_level_1 = REGEXP_REPLACE(image_level_1, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE image_level_1 REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

UPDATE pets
SET image_level_2 = REGEXP_REPLACE(image_level_2, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE image_level_2 REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

-- 4. 题目富文本（题干、选项、答案、解析）中的图片地址
UPDATE questions
SET content = REGEXP_REPLACE(content, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE content REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

UPDATE questions
SET options = REGEXP_REPLACE(options, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE options REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

UPDATE questions
SET answers = REGEXP_REPLACE(answers, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE answers REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

UPDATE questions
SET explanation = REGEXP_REPLACE(explanation, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE explanation REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

-- 5. 课堂任务临时题富文本
UPDATE task_question
SET temp_content = REGEXP_REPLACE(temp_content, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE temp_content REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

UPDATE task_question
SET temp_options = REGEXP_REPLACE(temp_options, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE temp_options REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

UPDATE task_question
SET temp_answer = REGEXP_REPLACE(temp_answer, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE temp_answer REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

-- 6. 系统配置中的背景配置等
UPDATE system_config
SET value = REGEXP_REPLACE(value, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE value REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

-- 7. 课堂任务资源 HTML 内容中的引用
UPDATE task_resource
SET html_content = REGEXP_REPLACE(html_content, 'https?://[^/ "<>[:space:]]+/uploads/', '/uploads/')
WHERE html_content REGEXP 'https?://[^/ "<>[:space:]]+/uploads/';

-- 8. 课堂任务资源文件路径：服务器绝对路径（如 C:\xxx\backend\uploads\a.pdf）→ 相对路径
UPDATE task_resource
SET file_path = CONCAT('/uploads/', SUBSTRING_INDEX(REPLACE(file_path, '\\', '/'), '/uploads/', -1))
WHERE file_path IS NOT NULL
  AND REPLACE(file_path, '\\', '/') LIKE '%/uploads/%'
  AND REPLACE(file_path, '\\', '/') NOT LIKE '/uploads/%';
