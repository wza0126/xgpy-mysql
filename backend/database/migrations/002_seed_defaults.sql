INSERT IGNORE INTO profiles (id, username, password_hash, role, real_name, current_points, max_points, can_exchange_internet_code, can_open_exchange_module, can_use_app)
VALUES
  ('teacher1', 'teacher', SHA2('meoo.local', 256), 'teacher', '王老师', 0, 0, FALSE, TRUE, TRUE),
  ('student1', 'student', SHA2('meoo.local', 256), 'student', '小明', 200, 500, TRUE, TRUE, TRUE),
  ('student2', 'zhangsan', SHA2('meoo.local', 256), 'student', '张三', 150, 500, TRUE, TRUE, TRUE);

INSERT IGNORE INTO classes (id, name, teacher_id, allow_login)
VALUES ('class1', '初三一班', 'teacher1', TRUE);

UPDATE profiles
SET class_id = 'class1'
WHERE username IN ('student', 'zhangsan') AND class_id IS NULL;

INSERT IGNORE INTO system_config (id, config_key, value)
VALUES
  ('config_points_correct_answer', 'points_correct_answer', JSON_OBJECT('value', 10)),
  ('config_points_wrong_answer', 'points_wrong_answer', JSON_OBJECT('value', -5)),
  ('config_points_test_correct', 'points_test_correct', JSON_OBJECT('value', 15)),
  ('config_points_test_wrong', 'points_test_wrong', JSON_OBJECT('value', -3)),
  ('config_points_wrong_correct', 'points_wrong_correct', JSON_OBJECT('value', 12)),
  ('config_points_wrong_wrong', 'points_wrong_wrong', JSON_OBJECT('value', -4)),
  ('config_master_question_threshold', 'master_question_threshold', JSON_OBJECT('value', 3)),
  ('config_pet_adoption_threshold', 'pet_adoption_threshold', JSON_OBJECT('value', 100)),
  ('config_pet_change_threshold', 'pet_change_threshold', JSON_OBJECT('value', 100)),
  ('config_pet_food_effect', 'pet_food_effect', JSON_OBJECT('value', 10)),
  ('config_test_passing_score', 'test_passing_score', JSON_OBJECT('value', 60)),
  ('config_ai_api_base_url', 'ai_api_base_url', JSON_OBJECT('value', '')),
  ('config_ai_api_key', 'ai_api_key', JSON_OBJECT('value', '')),
  ('config_ai_model', 'ai_model', JSON_OBJECT('value', 'qwen3.6-plus')),
  ('config_ai_temperature', 'ai_temperature', JSON_OBJECT('value', 0.7)),
  ('config_ai_max_tokens', 'ai_max_tokens', JSON_OBJECT('value', 2000));

INSERT IGNORE INTO word_list (id, word, phonetic, meaning, example, level, category, order_index)
VALUES
  ('word_1', 'apple', '/ˈæpl/', '苹果', 'I eat an apple every day.', 'easy', '水果', 1),
  ('word_2', 'book', '/bʊk/', '书', 'I am reading a book.', 'easy', '学习', 2),
  ('word_3', 'computer', '/kəmˈpjuːtər/', '电脑', 'I use computer every day.', 'easy', '科技', 3),
  ('word_4', 'student', '/ˈstjuːdnt/', '学生', 'I am a student.', 'easy', '人物', 4),
  ('word_5', 'teacher', '/ˈtiːtʃər/', '老师', 'My teacher is very nice.', 'easy', '人物', 5),
  ('word_6', 'happy', '/ˈhæpi/', '快乐的', 'I am very happy today.', 'easy', '情感', 6),
  ('word_7', 'beautiful', '/ˈbjuːtɪfl/', '美丽的', 'The flower is beautiful.', 'medium', '形容词', 7),
  ('word_8', 'important', '/ɪmˈpɔːrtnt/', '重要的', 'Learning is important.', 'medium', '形容词', 8),
  ('word_9', 'programming', '/ˈproʊɡræmɪŋ/', '编程', 'I love programming.', 'medium', '科技', 9),
  ('word_10', 'algorithm', '/ˈælɡərɪðəm/', '算法', 'This algorithm is efficient.', 'hard', '科技', 10),
  ('word_11', 'database', '/ˈdeɪtəbeɪs/', '数据库', 'We store data in database.', 'hard', '科技', 11),
  ('word_12', 'network', '/ˈnetwɜːrk/', '网络', 'The network is fast.', 'medium', '科技', 12),
  ('word_13', 'function', '/ˈfʌŋkʃn/', '函数', 'This function returns a value.', 'medium', '编程', 13),
  ('word_14', 'variable', '/ˈveriəbl/', '变量', 'Declare a variable.', 'medium', '编程', 14),
  ('word_15', 'loop', '/luːp/', '循环', 'Use loop to repeat.', 'easy', '编程', 15),
  ('word_16', 'conditional', '/kənˈdɪʃənl/', '条件的', 'If statement is conditional.', 'medium', '编程', 16),
  ('word_17', 'array', '/əˈreɪ/', '数组', 'Store multiple values in array.', 'medium', '编程', 17),
  ('word_18', 'object', '/ˈɒbdʒɪkt/', '对象', 'JavaScript uses objects.', 'hard', '编程', 18),
  ('word_19', 'class', '/klæs/', '类', 'Create a class in Python.', 'hard', '编程', 19),
  ('word_20', 'inheritance', '/ɪnˈherɪtns/', '继承', 'Use inheritance to extend class.', 'hard', '编程', 20);

INSERT IGNORE INTO apps (id, name, description, icon, type, price_type, points_price, category, is_active, is_marketplace, config, created_by)
VALUES ('app_word', '背单词', '通过科学的记忆方法，帮助你高效学习英语单词。支持单词范围选择和每日学习目标设置。', '📚', 'learning_tool', 'free', 0, '学习工具', TRUE, TRUE, JSON_OBJECT('wordRange', 'all', 'dailyGoal', 20), 'teacher1');

INSERT IGNORE INTO app_visibility (id, app_id, class_id, is_visible)
VALUES ('av_word_class1', 'app_word', 'class1', TRUE);

INSERT IGNORE INTO security_settings (
  id,
  max_concurrent_sessions,
  session_timeout_hours,
  allow_multiple_devices,
  enable_ip_binding,
  require_password_change_days,
  enable_login_alert,
  max_concurrent_sessions_teacher,
  max_concurrent_sessions_student,
  allow_multiple_devices_teacher,
  allow_multiple_devices_student
)
VALUES (1, 3, 24, TRUE, FALSE, 90, FALSE, 3, 3, TRUE, TRUE);
