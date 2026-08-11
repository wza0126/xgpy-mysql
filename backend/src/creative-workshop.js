// ==============================================
// AI创意工坊模块
// 学生用AI生成单HTML网页作品 → 提交审核 → 教师审核上架到工坊应用中心
// → 其他学生积分购买 → 作者按比例提成
// 路由分组：
//   /api/creative-workshop/*            学生端（生成/作品集/应用中心/购买/收益）
//   /api/creative-workshop/teacher/*    教师端（审核/管理/配置/收益统计）
// ==============================================

const { v4: uuidv4 } = require('uuid');

const SYSTEM_PROMPT = [
  '你是一名专业的网页开发工程师。根据用户的需求描述，生成一个完整的单文件HTML网页。',
  '要求：',
  '1. 只输出一个完整的HTML文件，以 <!DOCTYPE html> 开头，包含 html/head/body 结构',
  '2. 所有CSS样式内嵌在 <style> 标签中，所有JavaScript内嵌在 <script> 标签中',
  '3. 不引用任何外部资源（不加载外部图片、字体、CDN库、在线API）',
  '4. 界面美观现代，使用合理的配色、间距和布局，图标用CSS或内联SVG绘制',
  '5. 适合中学生使用，内容健康向上',
  '6. 直接输出HTML代码，不要用代码块(```)包裹，不要输出任何解释文字',
].join('\n');

function extractHtml(content) {
  if (!content) return '';
  let text = content.trim();
  // 去掉可能的代码块包裹 ```html ... ```
  const fenceMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1] && fenceMatch[1].includes('<html')) {
    text = fenceMatch[1].trim();
  }
  // 截取 <!DOCTYPE 或 <html 开始到 </html> 结束
  const start = text.search(/<!DOCTYPE|<\/?html/i);
  const endTag = text.lastIndexOf('</html>');
  if (start >= 0 && endTag > start) {
    return text.slice(start, endTag + '</html>'.length);
  }
  return text;
}

// 读取工坊配置
async function getWorkshopConfig(pool) {
  const [rows] = await pool.query('SELECT * FROM ai_workshop_config WHERE id = 1');
  if (rows.length === 0) {
    return {
      id: 1,
      enabled: true,
      author_share_percent: 60,
      min_price: 1,
      max_price: 100,
      daily_gen_limit: 10,
      gen_cost: 2,
      modify_cost: 1,
      open_cost: 0,
      min_requirement_chars: 10,
      enabled_classes: null,
    };
  }
  const cfg = rows[0];
  let enabledClasses = cfg.enabled_classes;
  if (typeof enabledClasses === 'string') {
    try { enabledClasses = JSON.parse(enabledClasses); } catch { enabledClasses = null; }
  }
  return { ...cfg, enabled_classes: enabledClasses };
}

// 班级是否允许访问工坊
function classAllowed(profile, config) {
  if (!config.enabled_classes || config.enabled_classes.length === 0) return true;
  if (profile.role === 'teacher') return true;
  return config.enabled_classes.includes(profile.class_id);
}

// 读取 AI 配置（与 AI 答疑模块同一套 system_config 配置）
async function getAIConfig(pool) {
  const [rows] = await pool.query(
    'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?, ?)',
    ['ai_api_base_url', 'ai_api_key', 'ai_model', 'ai_temperature']
  );
  const config = {};
  rows.forEach((row) => {
    let value = row.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch {}
    }
    config[row.config_key] = value?.value ?? value;
  });
  return {
    ai_api_base_url: config.ai_api_base_url || '',
    ai_api_key: config.ai_api_key || '',
    ai_model: config.ai_model || 'deepseek-v4-flash',
    ai_temperature: config.ai_temperature ?? 0.7,
  };
}

// 调用 AI 生成 HTML
async function callAiApi(config, messages) {
  if (!config.ai_api_base_url || !config.ai_api_key) {
    throw new Error('AI API未配置，请联系管理员');
  }
  const apiUrl = `${config.ai_api_base_url}/chat/completions`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ai_api_key}`,
    },
    body: JSON.stringify({
      messages,
      model: config.ai_model,
      temperature: config.ai_temperature,
      stream: false,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('AI API调用失败:', response.status, errorText);
    throw new Error(`AI API调用失败: ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// 统计学生当天 AI 生成/修改次数（每次操作都会插入一条版本记录）
// connection 可以是 pool 或 transaction connection，事务内调用时使用连接级隔离
async function countDailyUsage(connection, studentId) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS cnt
     FROM ai_work_versions v
     JOIN ai_works w ON v.work_id = w.id
     WHERE w.student_id = ? AND v.created_at >= CURDATE()`,
    [studentId]
  );
  return rows[0]?.cnt || 0;
}

// 扣减积分（事务内调用）
// 关键：UPDATE 自带 WHERE current_points >= ? 原子性校验，并发下两个事务同时扣减时，
// 第二个事务的行级锁等待会读到提交后的最新值，若余额不足则 affectedRows=0，
// 从而阻止积分被扣为负数。调用方需通过 try/catch 回滚事务。
async function deductPoints(connection, studentId, amount, reason, sourceId) {
  const [result] = await connection.query(
    'UPDATE profiles SET current_points = current_points - ? WHERE id = ? AND current_points >= ?',
    [amount, studentId, amount]
  );
  if ((result.affectedRows ?? 0) === 0) {
    throw new Error('积分不足，扣减失败');
  }
  await connection.query(
    `INSERT INTO point_transactions (student_id, amount, reason, source_type, source_id, created_at)
     VALUES (?, ?, ?, 'system', ?, NOW())`,
    [studentId, -amount, reason, sourceId]
  );
}

// 增加积分（事务内调用）
async function addPoints(connection, studentId, amount, reason, sourceId) {
  await connection.query(
    'UPDATE profiles SET current_points = current_points + ?, max_points = GREATEST(max_points, current_points + ?), total_points_earned = total_points_earned + ? WHERE id = ?',
    [amount, amount, amount, studentId]
  );
  await connection.query(
    `INSERT INTO point_transactions (student_id, amount, reason, source_type, source_id, created_at)
     VALUES (?, ?, ?, 'system', ?, NOW())`,
    [studentId, amount, reason, sourceId]
  );
}

// 作品类别（工坊固定 5 类）
const WORK_CATEGORIES = ['创意工具', '学习助手', '生活妙用', '艺术表达', '小游戏'];
function validCategory(c) {
  return WORK_CATEGORIES.includes(c) ? c : null;
}

function registerCreativeWorkshop(app, pool, authenticate, requireTeacher, requireStudent, licenseManager, FEATURES) {
  // ==================== 学生端 ====================

  // 获取工坊配置 + 当前学生可访问性
  app.get('/api/creative-workshop/config', authenticate, async (req, res) => {
    try {
      const config = await getWorkshopConfig(pool);
      const [profileRows] = await pool.query(
        'SELECT id, role, class_id, current_points FROM profiles WHERE id = ?',
        [req.user.userId]
      );
      const profile = profileRows[0];
      const licenseResult = await licenseManager.checkFeatureLicense(FEATURES.CREATIVE);
      return res.json({
        data: {
          ...config,
          accessible: config.enabled && classAllowed(profile, config),
          licenseValid: licenseResult.allowed,
        },
        error: null,
      });
    } catch (error) {
      console.error('获取工坊配置失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 生成新作品
  app.post('/api/creative-workshop/generate', authenticate, requireStudent, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { requirement, title = '', category } = req.body || {};
      const userId = req.user.userId;

      const config = await getWorkshopConfig(pool);
      if (!config.enabled) {
        return res.status(403).json({ data: null, error: 'AI创意工坊暂未开放' });
      }
      const [profileRows] = await pool.query(
        'SELECT id, role, class_id, current_points FROM profiles WHERE id = ?',
        [userId]
      );
      const profile = profileRows[0];
      if (!classAllowed(profile, config)) {
        return res.status(403).json({ data: null, error: '你的班级暂未开放AI创意工坊' });
      }
      const licenseResult = await licenseManager.checkFeatureLicense(FEATURES.CREATIVE);
      if (!licenseResult.allowed) {
        return res.status(403).json({ data: null, error: 'AI创意工坊功能需要授权激活后才能使用', licenseStatus: licenseResult.status });
      }
      if (!requirement || requirement.trim().length < config.min_requirement_chars) {
        return res.status(400).json({ data: null, error: `需求描述至少 ${config.min_requirement_chars} 个字` });
      }
      if (profile.current_points < config.gen_cost) {
        return res.status(400).json({ data: null, error: `积分不足！AI生成需要 ${config.gen_cost} 积分` });
      }

      // Phase 1: 快速预检查（无锁），过滤明显超出限额的请求
      const preUsage = await countDailyUsage(pool, userId);
      if (preUsage >= config.daily_gen_limit) {
        return res.status(400).json({ data: null, error: `今日生成/修改次数已达上限（${config.daily_gen_limit}次），请明天再来` });
      }

      // AI 生成（慢操作，在事务外执行以避免长时间持有行锁）
      const aiConfig = await getAIConfig(pool);
      const content = await callAiApi(aiConfig, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `需求描述：${requirement}` },
      ]);
      const html = extractHtml(content);
      if (!html) {
        return res.status(500).json({ data: null, error: 'AI返回内容无效，请重试' });
      }

      const workId = 'aw_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
      const workTitle = title.trim() || (requirement.trim().slice(0, 20) || '未命名作品');

      // Phase 2: 事务内加锁重检 + 写入，防止并发超限
      // 锁 profile 行使同一学生的所有操作串行化，countDailyUsage 读到一致的快照
      await connection.beginTransaction();
      await connection.query('SELECT id FROM profiles WHERE id = ? FOR UPDATE', [userId]);
      const finalUsage = await countDailyUsage(connection, userId);
      if (finalUsage >= config.daily_gen_limit) {
        await connection.rollback();
        return res.status(400).json({ data: null, error: `今日生成/修改次数已达上限（${config.daily_gen_limit}次），请明天再来` });
      }

      await deductPoints(connection, userId, config.gen_cost, `AI创意工坊生成（${workTitle}）`, workId);
      const workCategory = validCategory(category) || '创意工具';
      await connection.query(
        `INSERT INTO ai_works (id, student_id, title, description, icon, requirement, code, price, status, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [workId, userId, workTitle, '', '🧩', requirement.trim(), html, 0, workCategory]
      );
      await connection.query(
        `INSERT INTO ai_work_versions (work_id, code, note, created_at) VALUES (?, ?, ?, NOW())`,
        [workId, html, 'AI首次生成']
      );
      await connection.commit();

      res.json({ data: { id: workId, title: workTitle, pointsCost: config.gen_cost }, error: null });
    } catch (error) {
      await connection.rollback();
      console.error('AI创意工坊生成失败:', error);
      res.status(500).json({ data: null, error: error.message });
    } finally {
      connection.release();
    }
  });

  // AI 修改作品
  app.post('/api/creative-workshop/:id/modify', authenticate, requireStudent, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const workId = req.params.id;
      const { request } = req.body || {};
      const userId = req.user.userId;

      const config = await getWorkshopConfig(pool);
      if (!config.enabled) {
        return res.status(403).json({ data: null, error: 'AI创意工坊暂未开放' });
      }
      if (!request || request.trim().length < config.min_requirement_chars) {
        return res.status(400).json({ data: null, error: `修改要求至少 ${config.min_requirement_chars} 个字` });
      }
      const [workRows] = await pool.query('SELECT * FROM ai_works WHERE id = ? AND student_id = ?', [workId, userId]);
      if (workRows.length === 0) {
        return res.status(404).json({ data: null, error: '作品不存在' });
      }
      const work = workRows[0];
      const [profileRows] = await pool.query('SELECT id, current_points FROM profiles WHERE id = ?', [userId]);
      if (profileRows[0].current_points < config.modify_cost) {
        return res.status(400).json({ data: null, error: `积分不足！AI修改需要 ${config.modify_cost} 积分` });
      }

      // Phase 1: 快速预检查（无锁）
      const preUsage = await countDailyUsage(pool, userId);
      if (preUsage >= config.daily_gen_limit) {
        return res.status(400).json({ data: null, error: `今日生成/修改次数已达上限（${config.daily_gen_limit}次），请明天再来` });
      }

      // AI 生成（慢操作，事务外执行）
      const aiConfig = await getAIConfig(pool);
      const content = await callAiApi(aiConfig, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `现有代码如下：\n\n${work.code}\n\n用户的新需求：${request}` },
      ]);
      const html = extractHtml(content);
      if (!html) {
        return res.status(500).json({ data: null, error: 'AI返回内容无效，请重试' });
      }

      // Phase 2: 事务内加锁重检 + 写入
      await connection.beginTransaction();
      await connection.query('SELECT id FROM profiles WHERE id = ? FOR UPDATE', [userId]);
      const finalUsage = await countDailyUsage(connection, userId);
      if (finalUsage >= config.daily_gen_limit) {
        await connection.rollback();
        return res.status(400).json({ data: null, error: `今日生成/修改次数已达上限（${config.daily_gen_limit}次），请明天再来` });
      }

      await deductPoints(connection, userId, config.modify_cost, `AI创意工坊修改（${work.title}）`, workId);
      await connection.query('UPDATE ai_works SET code = ?, status = IF(status = \'approved\', \'draft\', status) WHERE id = ?', [html, workId]);
      await connection.query(
        `INSERT INTO ai_work_versions (work_id, code, note, created_at) VALUES (?, ?, ?, NOW())`,
        [workId, html, request.trim().slice(0, 200)]
      );
      await connection.commit();

      res.json({ data: { id: workId, pointsCost: config.modify_cost }, error: null });
    } catch (error) {
      await connection.rollback();
      console.error('AI创意工坊修改失败:', error);
      res.status(500).json({ data: null, error: error.message });
    } finally {
      connection.release();
    }
  });

  // 我的作品列表
  app.get('/api/creative-workshop/my-works', authenticate, requireStudent, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT id, title, description, icon, price, status, reject_reason, view_count, purchase_count, is_featured, created_at, updated_at FROM ai_works WHERE student_id = ? ORDER BY updated_at DESC',
        [req.user.userId]
      );
      res.json({ data: rows, error: null });
    } catch (error) {
      console.error('获取我的作品失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 作品详情（含代码）
  app.get('/api/creative-workshop/my-works/:id', authenticate, requireStudent, async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM ai_works WHERE id = ? AND student_id = ?', [req.params.id, req.user.userId]);
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: '作品不存在' });
      }
      const [versions] = await pool.query(
        'SELECT id, note, created_at FROM ai_work_versions WHERE work_id = ? ORDER BY id DESC',
        [req.params.id]
      );
      res.json({ data: { ...rows[0], versions }, error: null });
    } catch (error) {
      console.error('获取作品详情失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 更新作品信息（标题/简介/图标/价格/代码手动编辑）
  app.put('/api/creative-workshop/my-works/:id', authenticate, requireStudent, async (req, res) => {
    try {
      const workId = req.params.id;
      const { title, description, icon, price, code, category } = req.body || {};
      const [rows] = await pool.query('SELECT * FROM ai_works WHERE id = ? AND student_id = ?', [workId, req.user.userId]);
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: '作品不存在' });
      }
      const work = rows[0];
      const config = await getWorkshopConfig(pool);

      const fields = [];
      const values = [];
      if (title !== undefined) { fields.push('title = ?'); values.push(String(title).slice(0, 100)); }
      if (description !== undefined) { fields.push('description = ?'); values.push(String(description).slice(0, 2000)); }
      if (icon !== undefined) { fields.push('icon = ?'); values.push(String(icon).slice(0, 50)); }
      if (category !== undefined) {
        const c = validCategory(category);
        if (!c) return res.status(400).json({ data: null, error: '请选择有效的作品类别' });
        fields.push('category = ?'); values.push(c);
      }
      if (price !== undefined) {
        const p = Math.floor(Number(price) || 0);
        if (p < config.min_price || p > config.max_price) {
          return res.status(400).json({ data: null, error: `定价需在 ${config.min_price} - ${config.max_price} 积分之间` });
        }
        fields.push('price = ?'); values.push(p);
      }
      if (code !== undefined) {
        fields.push('code = ?'); values.push(String(code));
        // 手动编辑代码也记录版本
        await pool.query(
          `INSERT INTO ai_work_versions (work_id, code, note, created_at) VALUES (?, ?, '手动编辑', NOW())`,
          [workId, String(code)]
        );
        // 已上架作品修改代码后回到草稿状态，需重新审核
        if (work.status === 'approved') {
          fields.push('status = \'draft\'');
          fields.push('reject_reason = NULL');
        }
      }
      if (fields.length === 0) {
        return res.status(400).json({ data: null, error: '没有需要更新的内容' });
      }
      fields.push('updated_at = NOW()');
      await pool.query(`UPDATE ai_works SET ${fields.join(', ')} WHERE id = ?`, [...values, workId]);
      res.json({ data: { id: workId }, error: null });
    } catch (error) {
      console.error('更新作品失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 删除作品
  app.delete('/api/creative-workshop/my-works/:id', authenticate, requireStudent, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const workId = req.params.id;
      const userId = req.user.userId;
      const [rows] = await pool.query('SELECT id, title, price FROM ai_works WHERE id = ? AND student_id = ?', [workId, userId]);
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: '作品不存在' });
      }

      // 关键修复：有购买记录的作品禁止直接删除，否则买家花积分购买的作品会从
      // my-apps 的 INNER JOIN 查询中消失，积分永久损失且无退款路径。
      // 需要先下架再联系管理员走批量退款流程，避免单方面卷款跑路。
      const [purchaseRows] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM ai_work_purchases WHERE work_id = ?',
        [workId]
      );
      if ((purchaseRows[0]?.cnt || 0) > 0) {
        return res.status(400).json({
          data: null,
          error: `该作品已有 ${purchaseRows[0].cnt} 位学生购买，为保护买家权益不能直接删除。如需下架请联系老师处理。`,
        });
      }

      await connection.beginTransaction();
      await connection.query('DELETE FROM ai_work_reviews WHERE work_id = ?', [workId]);
      await connection.query('DELETE FROM ai_work_versions WHERE work_id = ?', [workId]);
      await connection.query('DELETE FROM ai_works WHERE id = ?', [workId]);
      await connection.commit();

      res.json({ data: { success: true }, error: null });
    } catch (error) {
      try { await connection.rollback(); } catch (_) { /* ignore */ }
      console.error('删除作品失败:', error);
      res.status(500).json({ data: null, error: error.message });
    } finally {
      connection.release();
    }
  });

  // 提交审核
  app.post('/api/creative-workshop/my-works/:id/submit', authenticate, requireStudent, async (req, res) => {
    try {
      const workId = req.params.id;
      const [rows] = await pool.query('SELECT * FROM ai_works WHERE id = ? AND student_id = ?', [workId, req.user.userId]);
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: '作品不存在' });
      }
      const work = rows[0];
      const config = await getWorkshopConfig(pool);
      if (!work.title || !work.title.trim()) {
        return res.status(400).json({ data: null, error: '请先填写作品名称' });
      }
      if (!work.requirement || work.requirement.trim().length < config.min_requirement_chars) {
        return res.status(400).json({ data: null, error: `需求描述至少 ${config.min_requirement_chars} 个字` });
      }
      if (!work.code || work.code.trim().length < 50) {
        return res.status(400).json({ data: null, error: '作品代码为空或过短，请先生成内容' });
      }
      if (work.price < config.min_price || work.price > config.max_price) {
        return res.status(400).json({ data: null, error: `定价需在 ${config.min_price} - ${config.max_price} 积分之间` });
      }
      await pool.query(
        "UPDATE ai_works SET status = 'pending', reject_reason = NULL, updated_at = NOW() WHERE id = ?",
        [workId]
      );
      res.json({ data: { id: workId }, error: null });
    } catch (error) {
      console.error('提交审核失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 应用中心列表（已上架作品，支持类别筛选/推荐筛选/排序）
  app.get('/api/creative-workshop/market', authenticate, requireStudent, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { category, featured, sort } = req.query;
      const conditions = ["w.status = 'approved'"];
      const values = [userId, userId];
      if (category && category !== 'all') {
        if (WORK_CATEGORIES.includes(category)) {
          conditions.push('w.category = ?');
          values.push(category);
        }
      }
      if (featured === '1' || featured === 'true') {
        conditions.push('w.is_featured = TRUE');
      }
      const orderMap = {
        rating: 'w.is_featured DESC, r.avg_rating IS NULL, r.avg_rating DESC, r.rating_count DESC, w.created_at DESC',
        views: 'w.is_featured DESC, w.view_count DESC, w.created_at DESC',
        sales: 'w.is_featured DESC, w.purchase_count DESC, w.created_at DESC',
        price: 'w.is_featured DESC, w.price DESC, w.created_at DESC',
        newest: 'w.is_featured DESC, w.created_at DESC',
      };
      const orderBy = orderMap[sort] || orderMap.newest;
      const [rows] = await pool.query(
        `SELECT w.id, w.title, w.description, w.icon, w.price, w.view_count, w.purchase_count, w.is_featured, w.category, w.created_at,
                p.real_name AS author_name,
                w.student_id = ? AS is_owner,
                EXISTS(SELECT 1 FROM ai_work_purchases pu WHERE pu.work_id = w.id AND pu.buyer_id = ?) AS purchased,
                COALESCE(r.avg_rating, 0) AS avg_rating,
                COALESCE(r.rating_count, 0) AS rating_count
         FROM ai_works w
         LEFT JOIN profiles p ON p.id = w.student_id
         LEFT JOIN (
           SELECT work_id, ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS rating_count
           FROM ai_work_ratings
           GROUP BY work_id
         ) r ON r.work_id = w.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${orderBy}`,
        values
      );
      res.json({ data: rows, error: null });
    } catch (error) {
      console.error('获取应用中心失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 应用详情（含代码，未购买只能预览部分信息）
  app.get('/api/creative-workshop/market/:id', authenticate, requireStudent, async (req, res) => {
    try {
      const workId = req.params.id;
      const userId = req.user.userId;
      const [rows] = await pool.query(
        `SELECT w.*, p.real_name AS author_name
         FROM ai_works w
         LEFT JOIN profiles p ON p.id = w.student_id
         WHERE w.id = ? AND w.status = 'approved'`,
        [workId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: '应用不存在' });
      }
      const work = rows[0];
      await pool.query('UPDATE ai_works SET view_count = view_count + 1 WHERE id = ?', [workId]);
      const [purchaseRows] = await pool.query(
        'SELECT id FROM ai_work_purchases WHERE work_id = ? AND buyer_id = ?',
        [workId, userId]
      );
      const isOwner = work.student_id === userId;
      const purchased = purchaseRows.length > 0 || isOwner;
      res.json({ data: { ...work, purchased, isOwner }, error: null });
    } catch (error) {
      console.error('获取应用详情失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 购买应用
  app.post('/api/creative-workshop/market/:id/purchase', authenticate, requireStudent, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const workId = req.params.id;
      const userId = req.user.userId;
      const config = await getWorkshopConfig(pool);

      // 关键修复：beginTransaction() 必须在所有行锁查询之前开启，
      // 且所有 SELECT...FOR UPDATE 必须在事务的 connection 上执行（不能用 pool.query）。
      // 否则 pool.query 的临时连接在 auto-commit 下锁会立刻释放，形同虚设。
      await connection.beginTransaction();

      const [workRows] = await connection.query(
        'SELECT * FROM ai_works WHERE id = ? AND status = \'approved\' FOR UPDATE',
        [workId]
      );
      if (workRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ data: null, error: '应用不存在或已下架' });
      }
      const work = workRows[0];
      if (work.student_id === userId) {
        await connection.rollback();
        return res.status(400).json({ data: null, error: '不能购买自己的作品' });
      }
      // 购买记录也加 FOR UPDATE 防并发 INSERT：先查（锁范围），后写
      const [purchaseRows] = await connection.query(
        'SELECT id FROM ai_work_purchases WHERE work_id = ? AND buyer_id = ? FOR UPDATE',
        [workId, userId]
      );
      if (purchaseRows.length > 0) {
        await connection.rollback();
        return res.status(400).json({ data: null, error: '你已经购买过该应用' });
      }
      const [buyerRows] = await connection.query(
        'SELECT id, current_points FROM profiles WHERE id = ? FOR UPDATE',
        [userId]
      );
      if (!buyerRows[0] || buyerRows[0].current_points < work.price) {
        await connection.rollback();
        return res.status(400).json({ data: null, error: `积分不足！该应用需要 ${work.price} 积分` });
      }
      // 锁作者积分行（避免加作者提成时的写冲突等待到 commit 前才发现死锁）
      await connection.query(
        'SELECT id FROM profiles WHERE id = ? FOR UPDATE',
        [work.student_id]
      );

      const authorShare = Math.round(work.price * (config.author_share_percent / 100));
      const purchaseId = 'ap_' + Date.now() + '_' + Math.floor(Math.random() * 10000);

      // 扣买家积分（内部含原子性余额校验，双重保险）
      await deductPoints(connection, userId, work.price, `购买创意工坊应用：${work.title}`, workId);
      // 加作者积分
      await addPoints(connection, work.student_id, authorShare, `创意工坊应用售出提成：${work.title}`, workId);
      // 记购买记录
      await connection.query(
        `INSERT INTO ai_work_purchases (id, work_id, buyer_id, price, author_share, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [purchaseId, workId, userId, work.price, authorShare]
      );
      // 购买量+1
      await connection.query('UPDATE ai_works SET purchase_count = purchase_count + 1 WHERE id = ?', [workId]);
      await connection.commit();

      res.json({ data: { id: purchaseId, price: work.price, authorShare }, error: null });
    } catch (error) {
      try { await connection.rollback(); } catch (_) { /* ignore rollback after commit error */ }
      console.error('购买创意工坊应用失败:', error);
      res.status(500).json({ data: null, error: error.message });
    } finally {
      connection.release();
    }
  });

  // 打开应用（已购买者每次打开消耗 open_cost 积分，作者本人免费；积分按提成比例奖励给作者）
  app.post('/api/creative-workshop/market/:id/open', authenticate, requireStudent, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const workId = req.params.id;
      const userId = req.user.userId;
      const config = await getWorkshopConfig(pool);
      const openCost = Number(config.open_cost) || 0;

      const [workRows] = await pool.query(
        'SELECT * FROM ai_works WHERE id = ? AND status = \'approved\'',
        [workId]
      );
      if (workRows.length === 0) {
        return res.status(404).json({ data: null, error: '应用不存在或已下架' });
      }
      const work = workRows[0];
      // 作者本人打开免费
      if (work.student_id === userId) {
        return res.json({ data: { opened: true, cost: 0 }, error: null });
      }
      const [purchaseRows] = await pool.query(
        'SELECT id FROM ai_work_purchases WHERE work_id = ? AND buyer_id = ?',
        [workId, userId]
      );
      if (purchaseRows.length === 0) {
        return res.status(400).json({ data: null, error: '请先购买该应用' });
      }
      if (openCost <= 0) {
        return res.json({ data: { opened: true, cost: 0 }, error: null });
      }

      await connection.beginTransaction();
      const [buyerRows] = await connection.query(
        'SELECT id, current_points FROM profiles WHERE id = ? FOR UPDATE',
        [userId]
      );
      if (!buyerRows[0] || buyerRows[0].current_points < openCost) {
        await connection.rollback();
        return res.status(400).json({ data: null, error: `积分不足！打开该应用需要 ${openCost} 积分` });
      }
      await connection.query(
        'SELECT id FROM profiles WHERE id = ? FOR UPDATE',
        [work.student_id]
      );
      const authorShare = Math.round(openCost * (config.author_share_percent / 100));
      await deductPoints(connection, userId, openCost, `打开创意工坊应用：${work.title}`, workId);
      if (authorShare > 0) {
        await addPoints(connection, work.student_id, authorShare, `创意工坊应用打开提成：${work.title}`, workId);
      }
      await connection.commit();

      res.json({ data: { opened: true, cost: openCost, authorShare }, error: null });
    } catch (error) {
      try { await connection.rollback(); } catch (_) { /* ignore */ }
      console.error('打开创意工坊应用失败:', error);
      res.status(500).json({ data: null, error: error.message });
    } finally {
      connection.release();
    }
  });

  // 评分应用（仅购买者可评，每人每应用限评一次，可修改）
  app.post('/api/creative-workshop/market/:id/rating', authenticate, requireStudent, async (req, res) => {
    try {
      const workId = req.params.id;
      const userId = req.user.userId;
      const rating = Math.round(Number(req.body?.rating) || 0);
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ data: null, error: '评分须为 1-5 星' });
      }
      const [workRows] = await pool.query(
        'SELECT student_id FROM ai_works WHERE id = ? AND status = \'approved\'',
        [workId]
      );
      if (workRows.length === 0) {
        return res.status(404).json({ data: null, error: '应用不存在或已下架' });
      }
      if (workRows[0].student_id === userId) {
        return res.status(400).json({ data: null, error: '不能给自己的作品评分' });
      }
      const [purchaseRows] = await pool.query(
        'SELECT id FROM ai_work_purchases WHERE work_id = ? AND buyer_id = ?',
        [workId, userId]
      );
      if (purchaseRows.length === 0) {
        return res.status(400).json({ data: null, error: '购买后才能评分' });
      }
      await pool.query(
        `INSERT INTO ai_work_ratings (work_id, student_id, rating, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE rating = VALUES(rating), updated_at = NOW()`,
        [workId, userId, rating]
      );
      res.json({ data: { success: true, rating }, error: null });
    } catch (error) {
      console.error('应用评分失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 我的已购应用
  app.get('/api/creative-workshop/my-apps', authenticate, requireStudent, async (req, res) => {
    try {
      const userId = req.user.userId;
      const [rows] = await pool.query(
        `SELECT w.id, w.title, w.description, w.icon, w.category, w.purchase_count,
                w.status AS work_status,
                -- 关键修复：只有 approved 状态才返回当前 code；其余状态（draft/removed/rejected/pending）
                -- 不泄露未审核/已下架代码，但保留购买记录在列表中，避免买家误以为积分被吞。
                -- （删除作品的场景由 DELETE 接口的购买量>0 校验兜底，不会走到这里。）
                CASE WHEN w.status = 'approved' THEN w.code ELSE '' END AS code,
                pu.price, pu.created_at AS purchased_at,
                rt.rating AS my_rating
         FROM ai_work_purchases pu
         -- 用 LEFT JOIN 保证 ai_work_purchases 行一定出现；
         -- 若未来作品行因异常情况被删，也至少能显示一个"作品已删除"的占位信息（由前端根据 work_status 判空渲染）
         LEFT JOIN ai_works w ON w.id = pu.work_id
         LEFT JOIN ai_work_ratings rt ON rt.work_id = pu.work_id AND rt.student_id = pu.buyer_id
         WHERE pu.buyer_id = ?
         ORDER BY pu.created_at DESC`,
        [userId]
      );
      res.json({ data: rows, error: null });
    } catch (error) {
      console.error('获取我的应用失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 我的收益明细
  app.get('/api/creative-workshop/revenue', authenticate, requireStudent, async (req, res) => {
    try {
      const userId = req.user.userId;
      const [works] = await pool.query(
        'SELECT id, title, price, purchase_count, view_count, is_featured FROM ai_works WHERE student_id = ?',
        [userId]
      );
      const [purchases] = await pool.query(
        `SELECT pu.id, w.title, pu.price, pu.author_share, pu.created_at
         FROM ai_work_purchases pu
         JOIN ai_works w ON w.id = pu.work_id
         WHERE w.student_id = ? ORDER BY pu.created_at DESC`,
        [userId]
      );
      // 打开应用提成（addPoints 写入 point_transactions，reason 以"打开提成"标记）
      const [openRevenueRows] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS open_revenue, COUNT(*) AS open_count
         FROM point_transactions
         WHERE student_id = ? AND amount > 0 AND reason LIKE '创意工坊应用打开提成%'`,
        [userId]
      );
      const [opens] = await pool.query(
        `SELECT pt.id, COALESCE(w.title, '未知作品') AS title, pt.amount, pt.created_at
         FROM point_transactions pt
         LEFT JOIN ai_works w ON w.id = pt.source_id
         WHERE pt.student_id = ? AND pt.amount > 0 AND pt.reason LIKE '创意工坊应用打开提成%'
         ORDER BY pt.created_at DESC`,
        [userId]
      );
      const purchaseRevenue = purchases.reduce((sum, p) => sum + (Number(p.author_share) || 0), 0);
      const openRevenue = Number(openRevenueRows[0]?.open_revenue) || 0;
      const totalRevenue = purchaseRevenue + openRevenue;
      const totalPurchases = purchases.length;
      res.json({
        data: {
          works,
          purchases,
          opens,
          totalRevenue,
          openRevenue,
          openCount: Number(openRevenueRows[0]?.open_count) || 0,
          totalPurchases,
        },
        error: null,
      });
    } catch (error) {
      console.error('获取收益失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // ==================== 教师端 ====================

  // 获取/更新配置
  app.get('/api/creative-workshop/teacher/config', authenticate, requireTeacher, async (req, res) => {
    try {
      const config = await getWorkshopConfig(pool);
      const [classes] = await pool.query('SELECT id, name FROM classes ORDER BY name');
      res.json({ data: { ...config, classes }, error: null });
    } catch (error) {
      console.error('获取工坊配置失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  app.put('/api/creative-workshop/teacher/config', authenticate, requireTeacher, async (req, res) => {
    try {
      const { enabled, author_share_percent, min_price, max_price, daily_gen_limit, gen_cost, modify_cost, open_cost, min_requirement_chars, enabled_classes } = req.body || {};
      const sets = [];
      const values = [];
      if (typeof enabled === 'boolean') { sets.push('enabled = ?'); values.push(enabled); }
      if (author_share_percent !== undefined) {
        const p = Math.min(100, Math.max(0, Math.floor(Number(author_share_percent) || 0)));
        sets.push('author_share_percent = ?'); values.push(p);
      }
      if (min_price !== undefined) { sets.push('min_price = ?'); values.push(Math.max(0, Math.floor(Number(min_price) || 0))); }
      if (max_price !== undefined) { sets.push('max_price = ?'); values.push(Math.max(0, Math.floor(Number(max_price) || 0))); }
      if (daily_gen_limit !== undefined) { sets.push('daily_gen_limit = ?'); values.push(Math.max(1, Math.floor(Number(daily_gen_limit) || 1))); }
      if (gen_cost !== undefined) { sets.push('gen_cost = ?'); values.push(Math.max(0, Math.floor(Number(gen_cost) || 0))); }
      if (modify_cost !== undefined) { sets.push('modify_cost = ?'); values.push(Math.max(0, Math.floor(Number(modify_cost) || 0))); }
      if (open_cost !== undefined) { sets.push('open_cost = ?'); values.push(Math.max(0, Math.floor(Number(open_cost) || 0))); }
      if (min_requirement_chars !== undefined) { sets.push('min_requirement_chars = ?'); values.push(Math.max(1, Math.floor(Number(min_requirement_chars) || 1))); }
      if (enabled_classes !== undefined) {
        const classes = Array.isArray(enabled_classes) ? enabled_classes : [];
        sets.push('enabled_classes = ?'); values.push(JSON.stringify(classes));
      }
      if (sets.length === 0) {
        return res.status(400).json({ data: null, error: '没有需要更新的配置' });
      }
      sets.push('updated_at = NOW()');
      await pool.query(`UPDATE ai_workshop_config SET ${sets.join(', ')} WHERE id = 1`, values);
      res.json({ data: { success: true }, error: null });
    } catch (error) {
      console.error('更新工坊配置失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 教师查看作品列表（状态/类别筛选 + 排序）
  app.get('/api/creative-workshop/teacher/works', authenticate, requireTeacher, async (req, res) => {
    try {
      const { status, category, featured, sort } = req.query;
      let sql = `SELECT w.*, p.real_name AS author_name, c.name AS class_name,
                        COALESCE(r.avg_rating, 0) AS avg_rating,
                        COALESCE(r.rating_count, 0) AS rating_count
                 FROM ai_works w
                 LEFT JOIN profiles p ON p.id = w.student_id
                 LEFT JOIN classes c ON c.id = p.class_id
                 LEFT JOIN (
                   SELECT work_id, ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS rating_count
                   FROM ai_work_ratings
                   GROUP BY work_id
                 ) r ON r.work_id = w.id`;
      const conditions = [];
      const values = [];
      if (status && status !== 'all') {
        conditions.push('w.status = ?');
        values.push(status);
      }
      if (category && category !== 'all') {
        if (WORK_CATEGORIES.includes(category)) {
          conditions.push('w.category = ?');
          values.push(category);
        }
      }
      if (featured === '1' || featured === 'true') {
        conditions.push('w.is_featured = TRUE');
      }
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      const orderMap = {
        rating: 'r.avg_rating IS NULL, r.avg_rating DESC, r.rating_count DESC, w.created_at DESC',
        views: 'w.view_count DESC, w.created_at DESC',
        sales: 'w.purchase_count DESC, w.created_at DESC',
        price: 'w.price DESC, w.created_at DESC',
        newest: 'w.created_at DESC',
      };
      sql += ' ORDER BY ' + (orderMap[sort] || orderMap.newest);
      const [rows] = await pool.query(sql, values);
      res.json({ data: rows, error: null });
    } catch (error) {
      console.error('获取作品列表失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 教师查看作品详情
  app.get('/api/creative-workshop/teacher/works/:id', authenticate, requireTeacher, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT w.*, p.real_name AS author_name, c.name AS class_name
         FROM ai_works w
         LEFT JOIN profiles p ON p.id = w.student_id
         LEFT JOIN classes c ON c.id = p.class_id
         WHERE w.id = ?`,
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: '作品不存在' });
      }
      const [versions] = await pool.query(
        'SELECT id, note, created_at FROM ai_work_versions WHERE work_id = ? ORDER BY id DESC',
        [req.params.id]
      );
      const [reviews] = await pool.query(
        'SELECT * FROM ai_work_reviews WHERE work_id = ? ORDER BY id DESC',
        [req.params.id]
      );
      res.json({ data: { ...rows[0], versions, reviews }, error: null });
    } catch (error) {
      console.error('获取作品详情失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 审核作品（通过/驳回）
  app.post('/api/creative-workshop/teacher/works/:id/review', authenticate, requireTeacher, async (req, res) => {
    try {
      const workId = req.params.id;
      const { action, reason = '' } = req.body || {};
      if (!['approved', 'rejected'].includes(action)) {
        return res.status(400).json({ data: null, error: '无效的审核操作' });
      }
      const [rows] = await pool.query('SELECT id FROM ai_works WHERE id = ? AND status = \'pending\'', [workId]);
      if (rows.length === 0) {
        return res.status(400).json({ data: null, error: '作品不存在或不在待审核状态' });
      }
      await pool.query(
        'UPDATE ai_works SET status = ?, reject_reason = ?, updated_at = NOW() WHERE id = ?',
        [action === 'approved' ? 'approved' : 'rejected', action === 'rejected' ? (reason || '未通过审核') : null, workId]
      );
      await pool.query(
        `INSERT INTO ai_work_reviews (work_id, reviewer_id, action, reason, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [workId, req.user.userId, action, reason]
      );
      res.json({ data: { success: true }, error: null });
    } catch (error) {
      console.error('审核作品失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 推荐/取消推荐
  app.post('/api/creative-workshop/teacher/works/:id/feature', authenticate, requireTeacher, async (req, res) => {
    try {
      const workId = req.params.id;
      const { featured } = req.body || {};
      await pool.query(
        'UPDATE ai_works SET is_featured = ?, featured_at = IF(?, NOW(), NULL), updated_at = NOW() WHERE id = ?',
        [!!featured, !!featured, workId]
      );
      res.json({ data: { success: true }, error: null });
    } catch (error) {
      console.error('推荐作品失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 下架/恢复
  app.post('/api/creative-workshop/teacher/works/:id/toggle', authenticate, requireTeacher, async (req, res) => {
    try {
      const workId = req.params.id;
      const [rows] = await pool.query('SELECT status FROM ai_works WHERE id = ?', [workId]);
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: '作品不存在' });
      }
      const newStatus = rows[0].status === 'removed' ? 'approved' : 'removed';
      await pool.query('UPDATE ai_works SET status = ?, updated_at = NOW() WHERE id = ?', [newStatus, workId]);
      res.json({ data: { status: newStatus }, error: null });
    } catch (error) {
      console.error('下架/恢复作品失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 教师删除作品（级联删除版本/审核/购买记录）
  app.delete('/api/creative-workshop/teacher/works/:id', authenticate, requireTeacher, async (req, res) => {
    try {
      const workId = req.params.id;
      const [rows] = await pool.query('SELECT purchase_count FROM ai_works WHERE id = ?', [workId]);
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: '作品不存在' });
      }
      if ((rows[0].purchase_count || 0) > 0) {
        return res.status(400).json({ data: null, error: '该作品已有购买记录，不能直接删除' });
      }
      await pool.query('DELETE FROM ai_works WHERE id = ?', [workId]);
      await pool.query('DELETE FROM ai_work_versions WHERE work_id = ?', [workId]);
      await pool.query('DELETE FROM ai_work_reviews WHERE work_id = ?', [workId]);
      res.json({ data: { success: true }, error: null });
    } catch (error) {
      console.error('删除作品失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // 批量操作：approve / reject / feature / unfeature / remove / restore / delete
  app.post('/api/creative-workshop/teacher/works/batch', authenticate, requireTeacher, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { action, ids = [], reason = '' } = req.body || {};
      if (!action || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ data: null, error: '请选择要操作的作品' });
      }
      const VALID_ACTIONS = ['approve', 'reject', 'feature', 'unfeature', 'remove', 'restore', 'delete'];
      if (!VALID_ACTIONS.includes(action)) {
        return res.status(400).json({ data: null, error: '无效的批量操作' });
      }
      const placeholders = ids.map(() => '?').join(', ');
      let success = 0;
      let skipped = 0;

      await connection.beginTransaction();
      if (action === 'delete') {
        // 有购买记录的作品不删除
        const [protectedRows] = await connection.query(
          `SELECT id FROM ai_works WHERE id IN (${placeholders}) AND purchase_count > 0`,
          ids
        );
        const protectedIds = protectedRows.map((r) => r.id);
        const deletable = ids.filter((id) => !protectedIds.includes(id));
        if (deletable.length > 0) {
          const dp = deletable.map(() => '?').join(', ');
          await connection.query(`DELETE FROM ai_works WHERE id IN (${dp})`, deletable);
          await connection.query(`DELETE FROM ai_work_versions WHERE work_id IN (${dp})`, deletable);
          await connection.query(`DELETE FROM ai_work_reviews WHERE work_id IN (${dp})`, deletable);
        }
        success = deletable.length;
        skipped = protectedIds.length;
      } else if (action === 'approve' || action === 'reject') {
        const [rows] = await connection.query(
          `SELECT id FROM ai_works WHERE id IN (${placeholders}) AND status = 'pending'`,
          ids
        );
        const pendingIds = rows.map((r) => r.id);
        if (pendingIds.length > 0) {
          const pp = pendingIds.map(() => '?').join(', ');
          const targetStatus = action === 'approve' ? 'approved' : 'rejected';
          await connection.query(
            `UPDATE ai_works SET status = ?, reject_reason = ?, updated_at = NOW() WHERE id IN (${pp})`,
            [targetStatus, action === 'reject' ? (reason || '未通过审核') : null, ...pendingIds]
          );
          const reviewerId = req.user.userId;
          const reviewAction = action === 'approve' ? 'approved' : 'rejected';
          for (const id of pendingIds) {
            await connection.query(
              `INSERT INTO ai_work_reviews (work_id, reviewer_id, action, reason, created_at)
               VALUES (?, ?, ?, ?, NOW())`,
              [id, reviewerId, reviewAction, reason]
            );
          }
        }
        success = pendingIds.length;
        skipped = ids.length - pendingIds.length;
      } else if (action === 'feature' || action === 'unfeature') {
        const featured = action === 'feature';
        await connection.query(
          `UPDATE ai_works SET is_featured = ?, featured_at = IF(?, NOW(), NULL), updated_at = NOW() WHERE id IN (${placeholders})`,
          [featured, featured, ...ids]
        );
        success = ids.length;
      } else if (action === 'remove' || action === 'restore') {
        const targetStatus = action === 'remove' ? 'removed' : 'approved';
        await connection.query(
          `UPDATE ai_works SET status = ?, updated_at = NOW() WHERE id IN (${placeholders})`,
          [targetStatus, ...ids]
        );
        success = ids.length;
      }
      await connection.commit();

      res.json({ data: { success, skipped }, error: null });
    } catch (error) {
      try { await connection.rollback(); } catch (_) { /* ignore */ }
      console.error('批量操作作品失败:', error);
      res.status(500).json({ data: null, error: error.message });
    } finally {
      connection.release();
    }
  });

  // 收益与流水统计
  app.get('/api/creative-workshop/teacher/revenue', authenticate, requireTeacher, async (req, res) => {
    try {
      const [authors] = await pool.query(
        `SELECT p.id AS student_id, p.real_name, c.name AS class_name,
                COUNT(DISTINCT w.id) AS work_count,
                SUM(w.purchase_count) AS total_sales,
                COALESCE(SUM(pu.author_share), 0)
                  + COALESCE((SELECT SUM(pt.amount) FROM point_transactions pt
                              WHERE pt.student_id = p.id AND pt.amount > 0
                                AND pt.reason LIKE '创意工坊应用打开提成%'), 0) AS total_revenue
         FROM ai_works w
         JOIN profiles p ON p.id = w.student_id
         LEFT JOIN classes c ON c.id = p.class_id
         LEFT JOIN ai_work_purchases pu ON pu.work_id = w.id
         GROUP BY p.id, p.real_name, c.name
         ORDER BY total_revenue DESC`
      );
      const [purchases] = await pool.query(
        `SELECT pu.id, w.title, w.student_id, p.real_name AS author_name,
                b.real_name AS buyer_name, pu.price, pu.author_share, pu.created_at
         FROM ai_work_purchases pu
         JOIN ai_works w ON w.id = pu.work_id
         JOIN profiles p ON p.id = w.student_id
         LEFT JOIN profiles b ON b.id = pu.buyer_id
         ORDER BY pu.created_at DESC`
      );
      // 打开应用提成流水
      const [opens] = await pool.query(
        `SELECT pt.id, COALESCE(w.title, '未知作品') AS title, pt.amount, pt.created_at,
                p.real_name AS author_name
         FROM point_transactions pt
         LEFT JOIN ai_works w ON w.id = pt.source_id
         LEFT JOIN profiles p ON p.id = pt.student_id
         WHERE pt.amount > 0 AND pt.reason LIKE '创意工坊应用打开提成%'
         ORDER BY pt.created_at DESC`
      );
      const [config] = await pool.query('SELECT author_share_percent FROM ai_workshop_config WHERE id = 1');
      res.json({
        data: {
          authors,
          purchases,
          opens,
          authorSharePercent: config[0]?.author_share_percent || 60,
        },
        error: null,
      });
    } catch (error) {
      console.error('获取收益统计失败:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });
}

module.exports = { registerCreativeWorkshop };
