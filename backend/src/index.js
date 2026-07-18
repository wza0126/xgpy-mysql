require('./env');
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const SecureAuth = require('./secure-auth');
const { LicenseManager, FEATURES } = require('./license-manager');
const { runMigrations } = require('./migrate');
const PythonSandbox = require('./python-sandbox');
const PythonGrader = require('./python-grader');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const pythonSandbox = new PythonSandbox({ maxExecutionTime: 3000 });
const pythonGrader = new PythonGrader();
const { getSystemConfig } = require('./public-config');

const app = express();
const secureAuth = new SecureAuth(pool);
const licenseManager = new LicenseManager(pool);
let notificationScheduler = null;

// 确保上传文件夹存在（使用脚本所在目录，不依赖工作目录）
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ===== 上传文件路径归一化 =====
// 数据库中统一以相对路径 /uploads/... 存储，不包含协议/主机/盘符，
// 保证开发环境上传的文件在生产环境同源部署下也能正常访问。
// 各种历史脏数据（完整URL、Windows绝对路径）也统一归一化为相对路径。
function toRelativeUploadPath(input) {
  if (!input || typeof input !== 'string') return input;
  let s = input.trim();
  if (!s) return s;
  // 完整URL：http(s)://任意主机/uploads/... → /uploads/...
  // 注意：只处理指向本站 /uploads/ 的链接，外部链接（不含 /uploads/）保持原样
  s = s.replace(/^https?:\/\/[^/"'\s<>]+(\/uploads\/)/i, '$1');
  // Windows 反斜杠统一为正斜杠
  s = s.replace(/\\/g, '/');
  // 绝对文件路径（如 C:/xxx/backend/uploads/a.png）截取 /uploads/ 起部分
  const m = s.match(/\/uploads\/.+$/);
  if (m) return m[0];
  return s;
}

// 将 /uploads/... 相对路径解析为服务器上的绝对文件路径（用于删除等磁盘操作）
function resolveUploadPath(rel) {
  if (!rel) return null;
  const r = toRelativeUploadPath(rel);
  if (!r || !r.startsWith('/uploads/')) return null;
  const sub = r.replace(/^\/uploads\//, '');
  // 防路径穿越
  if (sub.includes('..')) return null;
  return path.join(uploadsDir, sub);
}

// 确保题目图片子目录存在
const questionImgDirs = ['content', 'options', 'explanation'];
questionImgDirs.forEach(dir => {
  const fullPath = path.join(uploadsDir, 'questions', dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// 配置 multer 存储（桌面背景）
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'background-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB 限制
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件 (jpeg, jpg, png, gif, webp)'));
    }
  }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// 静态文件服务 - 提供上传的图片
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/public/site-config', async (req, res) => {
  try {
    const rows = await getSystemConfig();
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error in GET /api/public/site-config:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 认证中间件
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ data: null, error: 'Unauthorized - No token provided' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (!validation.valid) {
      return res.status(401).json({ data: null, error: validation.error });
    }
    
    // 将验证后的用户信息添加到 request 中
    req.user = validation.session;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ data: null, error: 'Authentication failed' });
  }
}

// 授权检查中间件工厂函数
function requireLicense(feature) {
  return async function(req, res, next) {
    try {
      const result = await licenseManager.checkFeatureLicense(feature);
      if (!result.allowed) {
        return res.status(403).json({ 
          data: null, 
          error: '该功能需要授权激活后才能使用',
          licenseStatus: result.status
        });
      }
      req.licenseStatus = result.status;
      next();
    } catch (error) {
      console.error('License check error:', error);
      res.status(500).json({ data: null, error: '授权验证失败' });
    }
  };
}

// 表名与付费功能的映射关系
const TABLE_FEATURE_MAP = {
  'apps': FEATURES.APP_MANAGER,
  'app_visibility': FEATURES.APP_MANAGER,
  'pet_config': FEATURES.PET,
  'pets': FEATURES.PET,
  'pet_foods': FEATURES.PET,
  'student_pets': FEATURES.PET,
  'prizes': FEATURES.PRIZES,
  'prize_class_visibility': FEATURES.PRIZES,
  'internet_codes': FEATURES.PRIZES,
  'exchange_records': FEATURES.PRIZES,
};

// 检查表操作是否需要授权
function checkTableLicense(tableName, method) {
  const feature = TABLE_FEATURE_MAP[tableName];
  if (!feature) return null;
  if (method === 'GET') return null;
  return feature;
}

function formatRow(row, forWriting = false) {
  const formatted = { ...row };
  
  // 在读取数据时处理字段映射
  if (!forWriting) {
    // 处理 system_config 表的字段映射
    if (formatted.config_key !== undefined) {
      formatted.key = formatted.config_key;
      delete formatted.config_key;
    }
    
    // 处理 allow_login 字段，统一转换为布尔值
    if (formatted.allow_login !== undefined) {
      formatted.allow_login = formatted.allow_login === 1 || formatted.allow_login === true;
    }
    
    // 处理 can_use_app 字段，统一转换为布尔值
    if (formatted.can_use_app !== undefined) {
      formatted.can_use_app = formatted.can_use_app === 1 || formatted.can_use_app === true;
    }
    
    // 处理 can_exchange_internet_code 字段，统一转换为布尔值
    if (formatted.can_exchange_internet_code !== undefined) {
      formatted.can_exchange_internet_code = formatted.can_exchange_internet_code === 1 || formatted.can_exchange_internet_code === true;
    }
    
    // 解析 JSON 字段（仅在读取时）
    ['options', 'answers', 'tags', 'value', 'score', 'answer', 'class_ids', 'required_keywords', 'syntax_errors', 'missing_keywords', 'tag_filters', 'question_ids', 'selected_question_ids', 'blank_answers', 'blank_weights', 'blank_results'].forEach(key => {
      if (formatted[key] && typeof formatted[key] === 'string') {
        try {
          formatted[key] = JSON.parse(formatted[key]);
        } catch {}
      }
    });
    
    // 处理日期字段 - 直接返回字符串，不转换为 Date 对象
    const dateFields = ['created_at', 'updated_at', 'used_at', 'created', 'completed_at', 'timestamp', 'started_at', 'submitted_at', 'graded_at'];
    dateFields.forEach(field => {
      if (formatted[field]) {
        // 如果是 Date 对象，转换为 MySQL 格式的字符串 (YYYY-MM-DD HH:mm:ss)
        if (formatted[field] instanceof Date) {
          const pad = (n) => n.toString().padStart(2, '0');
          const date = formatted[field];
          formatted[field] = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        }
        // 如果已经是字符串，保持原样
      }
    });
    
    // 将 grading 相关的字段嵌套到 grading 对象中（用于提交记录查询）
    if (formatted.grading_id !== undefined && formatted.grading_id !== null) {
      formatted.grading = {
        id: formatted.grading_id,
        total_score: formatted.grade_score || 0,
        syntax_score: formatted.syntax_score || 0,
        output_score: formatted.output_score || 0,
        logic_score: formatted.logic_score || 0,
        comment: formatted.comment || '',
        blank_results: formatted.blank_results || [],
        is_ai_graded: formatted.is_ai_graded === 1 || formatted.is_ai_graded === true,
        manually_adjusted: formatted.manually_adjusted === 1 || formatted.manually_adjusted === true,
        show_reference_code: formatted.show_reference_code === 1 || formatted.show_reference_code === true
      };
      // 清理不再需要的扁平字段
      delete formatted.grading_id;
      delete formatted.grade_score;
      delete formatted.syntax_score;
      delete formatted.output_score;
      delete formatted.logic_score;
      delete formatted.comment;
      delete formatted.blank_results;
      delete formatted.is_ai_graded;
      delete formatted.manually_adjusted;
      delete formatted.show_reference_code;
      delete formatted.syntax_errors;
      delete formatted.output_diff;
      delete formatted.missing_keywords;
      delete formatted.graded_at;
    }
  }
  
  return formatted;
}

function formatRows(rows) {
  return rows.map(formatRow);
}

app.get('/', (req, res, next) => {
  if (process.env.XGPY_SERVE_FRONTEND === 'true') return next();

  res.json({
    message: 'XGPY Backend Server is running',
    status: 'ok',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /',
      'GET /api/health',
      'GET /api/tables/:tableName',
      'GET /api/tables/:tableName/:id',
      'POST /api/tables/:tableName',
      'PUT /api/tables/:tableName/:id',
      'DELETE /api/tables/:tableName/:id',
      'POST /api/query',
      'POST /api/auth/login',
      'POST /api/auth/password',
      'GET /api/auth/session',
      'POST /api/import'
    ]
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 获取班级列表
app.get('/api/classes', async (req, res) => {
  try {
    const { teacher_id } = req.query;
    let query = 'SELECT id, name FROM classes';
    const params = [];
    
    if (teacher_id) {
      query += ' WHERE teacher_id = ?';
      params.push(teacher_id);
    }
    
    query += ' ORDER BY name ASC';
    const [rows] = await pool.query(query, params);
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/classes:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.get('/api/tables/:tableName', authenticate, async (req, res) => {
  try {
    const { tableName } = req.params;
    const { columns, filters, order, limit, offset } = req.query;
    
    let query = `SELECT * FROM ??`;
    const params = [tableName];
    
    if (filters) {
      let filterObj = JSON.parse(filters);
      
      // 处理 system_config 表的 key 字段转换
      if (tableName === 'system_config' && filterObj.key !== undefined) {
        const newFilterObj = {};
        Object.keys(filterObj).forEach(key => {
          if (key === 'key') {
            newFilterObj['config_key'] = filterObj[key];
          } else {
            newFilterObj[key] = filterObj[key];
          }
        });
        filterObj = newFilterObj;
      }
      
      console.log('=== POST /api/query ===');
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      
      const conditions = [];
      
      Object.keys(filterObj).forEach(key => {
        const value = filterObj[key];
        
        if (key.endsWith('_in')) {
          // 处理 _in 操作符: column_in: [v1, v2] -> column IN (v1, v2)
          const column = key.replace('_in', '');
          const values = Array.isArray(value) ? value : [value];
          conditions.push(`${column} IN (${values.map(() => '?').join(', ')})`);
          params.push(...values);
        } else if (key.endsWith('_neq')) {
          // 处理 _neq 操作符: column_neq: value -> column != value
          const column = key.replace('_neq', '');
          conditions.push(`${column} != ?`);
          params.push(value);
        } else if (key.endsWith('_gt')) {
          const column = key.replace('_gt', '');
          conditions.push(`${column} > ?`);
          params.push(value);
        } else if (key.endsWith('_gte')) {
          const column = key.replace('_gte', '');
          conditions.push(`${column} >= ?`);
          params.push(value);
        } else if (key.endsWith('_lt')) {
          const column = key.replace('_lt', '');
          conditions.push(`${column} < ?`);
          params.push(value);
        } else if (key.endsWith('_lte')) {
          const column = key.replace('_lte', '');
          conditions.push(`${column} <= ?`);
          params.push(value);
        } else if (key.endsWith('_like')) {
          const column = key.replace('_like', '');
          conditions.push(`${column} LIKE ?`);
          params.push(value);
        } else if (key.endsWith('_ilike')) {
          const column = key.replace('_ilike', '');
          conditions.push(`${column} LIKE ?`);
          params.push(value);
        } else {
          // 默认等于操作
          conditions.push(`${key} = ?`);
          params.push(value);
        }
      });
      
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
    }
    
    if (order) {
      query += ` ORDER BY ${order}`;
    }
    
    if (limit) {
      query += ` LIMIT ?`;
      params.push(parseInt(limit));
      if (offset) {
        query += ` OFFSET ?`;
        params.push(parseInt(offset));
      }
    }
    
    const [rows] = await pool.query(query, params);
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/tables:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

app.get('/api/tables/:tableName/:id', authenticate, async (req, res) => {
  try {
    const { tableName, id } = req.params;
    const [rows] = await pool.query('SELECT * FROM ?? WHERE id = ?', [tableName, id]);
    
    if (rows.length === 0) {
      res.json({ data: null, error: 'Not found' });
    } else {
      res.json({ data: formatRow(rows[0]), error: null });
    }
  } catch (error) {
    console.error('Error in GET /api/tables/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/tables/:tableName', authenticate, async (req, res) => {
  try {
    const { tableName } = req.params;
    
    const feature = checkTableLicense(tableName, 'POST');
    if (feature) {
      const licenseResult = await licenseManager.checkFeatureLicense(feature);
      if (!licenseResult.allowed) {
        return res.status(403).json({ 
          data: null, 
          error: '该功能需要授权激活后才能使用',
          licenseStatus: licenseResult.status
        });
      }
    }
    
    const data = { ...req.body };
    
    console.log('=== POST /api/tables/:tableName ===');
    console.log('Table:', tableName);
    console.log('Data:', JSON.stringify(data, null, 2));
    
    if (!data.id) {
      data.id = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // 处理 system_config 表的字段映射
    if (tableName === 'system_config' && data.key !== undefined) {
      data.config_key = data.key;
      delete data.key;
    }
    
    // 对于 student_answers 表，确保 answer 字段不为空或 null
    if (tableName === 'student_answers' && (data.answer === undefined || data.answer === null || data.answer === '')) {
      console.warn('Skipping insert: answer field is empty');
      res.json({ data: [], error: 'Answer field cannot be empty' });
      return;
    }
    
    // 对于 system_config 表，使用先删除再插入的方式确保更新
    if (tableName === 'system_config') {
      console.log('Handling system_config with delete + insert');
      
      // 先删除已存在的记录（通过 config_key）
      if (data.config_key) {
        await pool.query('DELETE FROM system_config WHERE config_key = ?', [data.config_key]);
      }
      
      // 然后插入新记录
      const columns = Object.keys(data);
      const values = columns.map(col => {
        const v = data[col];
        if (v === null || v === undefined) return null;
        if (typeof v === 'object') return JSON.stringify(v);
        return v;
      });
      
      const escapedColumns = columns.map(col => `\`${col}\``).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      
      const query = `INSERT INTO ?? (${escapedColumns}) VALUES (${placeholders})`;
      console.log('Insert query:', query);
      console.log('Insert values:', values);
      
      await pool.query(query, [tableName, ...values]);
      
      res.json({ data: [data], error: null });
      return;
    }
    
    const columns = Object.keys(data);
    const values = columns.map(col => {
      const v = data[col];
      if (v === null || v === undefined) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    const placeholders = columns.map(() => '?').join(', ');
    const escapedColumns = columns.map(col => `\`${col}\``).join(', ');
    
    const query = `INSERT INTO ?? (${escapedColumns}) VALUES (${placeholders})`;
    console.log('Query:', query);
    console.log('Values:', values);
    
    await pool.query(query, [tableName, ...values]);
    
    res.json({ data: [data], error: null });
  } catch (error) {
    console.error('Error in POST /api/tables:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

app.put('/api/tables/:tableName/:id', authenticate, async (req, res) => {
  try {
    const { tableName, id } = req.params;
    
    const feature = checkTableLicense(tableName, 'PUT');
    if (feature) {
      const licenseResult = await licenseManager.checkFeatureLicense(feature);
      if (!licenseResult.allowed) {
        return res.status(403).json({ 
          data: null, 
          error: '该功能需要授权激活后才能使用',
          licenseStatus: licenseResult.status
        });
      }
    }
    
    let data = { ...req.body };
    
    console.log('=== PUT /api/tables ===');
    console.log('Table:', tableName);
    console.log('ID:', id);
    console.log('Data:', JSON.stringify(data, null, 2));
    
    // 处理 system_config 表的字段映射
    if (tableName === 'system_config' && data.key !== undefined) {
      data.config_key = data.key;
      delete data.key;
    }
    
    // 删除 id 字段，不要更新 id
    delete data.id;
    
    // 检查是否有数据要更新
    const keys = Object.keys(data);
    if (keys.length === 0) {
      res.status(400).json({ data: [], error: 'No data to update' });
      return;
    }
    
    // 构建查询参数
    const values = [];
    let setClause = '';
    
    keys.forEach((key, index) => {
      if (index > 0) {
        setClause += ', ';
      }
      // 确保字段名正确转义
      setClause += pool.escapeId(key) + ' = ?';
      
      // 处理特殊字段 - 将对象转换为JSON字符串
      let value = data[key];
      if (typeof value === 'object' && value !== null) {
        value = JSON.stringify(value);
      }
      
      values.push(value);
    });
    
    values.push(id);
    
    const query = `UPDATE ${pool.escapeId(tableName)} SET ${setClause} WHERE id = ?`;
    
    console.log('Query:', query);
    console.log('Values:', values);
    
    const [result] = await pool.query(query, values);
    
    if (result.affectedRows === 0) {
      res.status(404).json({ data: [], error: 'Not found' });
    } else {
      res.json({ data: [{ id, ...data }], error: null });
    }
  } catch (error) {
    console.error('Error in PUT /api/tables:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

app.delete('/api/tables/:tableName/:id', authenticate, async (req, res) => {
  try {
    const { tableName, id } = req.params;
    
    const feature = checkTableLicense(tableName, 'DELETE');
    if (feature) {
      const licenseResult = await licenseManager.checkFeatureLicense(feature);
      if (!licenseResult.allowed) {
        return res.status(403).json({ 
          data: null, 
          error: '该功能需要授权激活后才能使用',
          licenseStatus: licenseResult.status
        });
      }
    }
    
    const [result] = await pool.query('DELETE FROM ?? WHERE id = ?', [tableName, id]);
    
    // 即使没有删除任何行也返回成功，因为记录可能已经不存在了
    res.json({ data: [{ id }], error: null });
  } catch (error) {
    console.error('Error in DELETE /api/tables:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

app.post('/api/query', authenticate, async (req, res) => {
  try {
    console.log('=== POST /api/query ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Authenticated user:', req.user?.username);
    
    let { table, filters, columns, order, limit, offset } = req.body;
    
    // 处理 system_config 表的 key 字段转换
    const isSystemConfig = table === 'system_config';
    if (isSystemConfig && filters) {
      const newFilters = {};
      Object.keys(filters).forEach(key => {
        if (key === 'key') {
          newFilters['config_key'] = filters[key];
        } else {
          newFilters[key] = filters[key];
        }
      });
      filters = newFilters;
    }
    
    let query = 'SELECT * FROM ??';
    const params = [table];
    
    if (filters && Object.keys(filters).length > 0) {
      const conditions = [];
      
      console.log('Processing filters:', JSON.stringify(filters, null, 2));
      
      Object.keys(filters).forEach(key => {
        const value = filters[key];
        
        console.log('  Processing filter:', key, '=', JSON.stringify(value));
        
        // 处理 _in 后缀: id_in -> id IN (...)
        if (key.endsWith('_in')) {
          const column = key.replace('_in', '');
          console.log('    Detected _in suffix, column:', column);
          
          if (Array.isArray(value)) {
            conditions.push(`${column} IN (${value.map(() => '?').join(', ')})`);
            params.push(...value);
            console.log('    Added IN condition for', column, 'with', value.length, 'values');
          } else {
            conditions.push(`${column} = ?`);
            params.push(value);
          }
        } else if (key.endsWith('_gte')) {
          // 处理 _gte 后缀: exchanged_at_gte -> exchanged_at >= ?
          const column = key.replace('_gte', '');
          params.push(value);
          conditions.push(`${column} >= ?`);
        } else if (key.endsWith('_lte')) {
          // 处理 _lte 后缀: exchanged_at_lte -> exchanged_at <= ?
          const column = key.replace('_lte', '');
          params.push(value);
          conditions.push(`${column} <= ?`);
        } else if (key.endsWith('_gt')) {
          // 处理 _gt 后缀: created_at_gt -> created_at > ?
          const column = key.replace('_gt', '');
          params.push(value);
          conditions.push(`${column} > ?`);
        } else if (key.endsWith('_lt')) {
          // 处理 _lt 后缀: created_at_lt -> created_at < ?
          const column = key.replace('_lt', '');
          params.push(value);
          conditions.push(`${column} < ?`);
        } else if (key.endsWith('_neq')) {
          // 处理 _neq 后缀: status_neq -> status != ?
          const column = key.replace('_neq', '');
          params.push(value);
          conditions.push(`${column} != ?`);
        } else if (Array.isArray(value)) {
          // 直接是数组的情况
          conditions.push(`${key} IN (${value.map(() => '?').join(', ')})`);
          params.push(...value);
        } else if (value === null) {
          conditions.push(`${key} IS NULL`);
        } else {
          params.push(value);
          conditions.push(`${key} = ?`);
        }
      });
      
      query += ` WHERE ${conditions.join(' AND ')}`;
      console.log('Generated query:', query);
      console.log('Params:', params);
    }
    
    if (order) {
      query += ` ORDER BY ${order.column || order} ${order.ascending ? 'ASC' : 'DESC'}`;
    }
    
    if (limit) {
      query += ` LIMIT ?`;
      params.push(parseInt(limit));
      if (offset) {
        query += ` OFFSET ?`;
        params.push(parseInt(offset));
      }
    }
    
    const [rows] = await pool.query(query, params);
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in POST /api/query:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    let { username, password } = req.body;
    
    // 如果用户名包含 @meoo.local，去掉这个后缀
    if (username && username.includes('@meoo.local')) {
      username = username.replace('@meoo.local', '');
    }
    
    console.log('Login attempt:', { username: req.body.username, processedUsername: username, password: '***' });
    
    const crypto = require('crypto');
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    console.log('Computed hash:', passwordHash);
    
    const [rows] = await pool.query(
      'SELECT * FROM profiles WHERE username = ?',
      [username]
    );
    
    console.log('Found users:', rows.length);
    if (rows.length > 0) {
      console.log('User hash:', rows[0].password_hash);
    }
    
    if (rows.length === 0 || rows[0].password_hash !== passwordHash) {
      res.status(401).json({ data: null, error: 'Invalid credentials' });
    } else {
      const user = formatRow(rows[0]);
      const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');
      res.json({
        data: {
          user,
          session: {
            access_token: token,
            user
          }
        },
        error: null
      });
    }
  } catch (error) {
    console.error('Error in POST /api/auth/login:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/auth/password', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ data: null, error: 'Password must be at least 6 characters' });
    }
    
    const crypto = require('crypto');
    const passwordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    
    await pool.query(
      'UPDATE profiles SET password_hash = ? WHERE id = ?',
      [passwordHash, userId]
    );
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in POST /api/auth/password:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.get('/api/auth/session', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM profiles WHERE id = ?', [req.user.userId]);
    
    if (rows.length === 0) {
      res.json({ data: { session: null }, error: 'User not found' });
    } else {
      res.json({
        data: {
          session: {
            access_token: req.headers.authorization.replace('Bearer ', ''),
            user: formatRow(rows[0])
          }
        },
        error: null
      });
    }
  } catch (error) {
    console.error('Error in GET /api/auth/session:', error);
    res.status(500).json({ data: { session: null }, error: error.message });
  }
});

// ============ 安全认证 API ============

app.post('/api/auth/secure-login', async (req, res) => {
  try {
    let { username, password } = req.body;
    
    if (username && username.includes('@meoo.local')) {
      username = username.replace('@meoo.local', '');
    }
    
    const deviceInfo = req.headers['x-device-info'] || 'Unknown Device';
    const ipAddress = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress || 'Unknown';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    console.log('Secure login attempt:', { username, deviceInfo, ipAddress });
    
    const result = await secureAuth.secureLogin(username, password, deviceInfo, ipAddress, userAgent);
    
    if (!result.success) {
      res.status(401).json({ data: null, error: result.error });
    } else {
      res.json({
        data: {
          user: result.user,
          session: {
            access_token: result.token,
            sessionId: result.sessionId,
            expiresAt: result.sessionInfo.expiresAt,
            activeSessions: result.sessionInfo.activeSessions,
            maxSessions: result.sessionInfo.maxSessions
          }
        },
        error: null
      });
    }
  } catch (error) {
    console.error('Error in POST /api/auth/secure-login:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ data: null, error: 'Unauthorized' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (!validation.valid) {
      return res.status(401).json({ data: null, error: validation.error });
    }
    
    const result = await secureAuth.logout(validation.session.id, validation.session.userId);
    res.json({ data: result, error: null });
  } catch (error) {
    console.error('Error in POST /api/auth/logout:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.get('/api/auth/sessions', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ data: null, error: 'Unauthorized' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (!validation.valid) {
      return res.status(401).json({ data: null, error: validation.error });
    }
    
    const result = await secureAuth.getUserSessions(validation.session.userId);
    res.json({ data: result.sessions, error: null });
  } catch (error) {
    console.error('Error in GET /api/auth/sessions:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/auth/logout-session/:sessionId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ data: null, error: 'Unauthorized' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (!validation.valid) {
      return res.status(401).json({ data: null, error: validation.error });
    }
    
    const result = await secureAuth.forceLogoutSession(req.params.sessionId, validation.session.userId);
    
    if (!result.success) {
      res.status(400).json({ data: null, error: result.error });
    } else {
      res.json({ data: result, error: null });
    }
  } catch (error) {
    console.error('Error in POST /api/auth/logout-session:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/auth/logout-others', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ data: null, error: 'Unauthorized' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (!validation.valid) {
      return res.status(401).json({ data: null, error: validation.error });
    }
    
    const result = await secureAuth.logoutOtherDevices(validation.session.userId, validation.session.id);
    
    if (!result.success) {
      res.status(400).json({ data: null, error: result.error });
    } else {
      res.json({ data: result, error: null });
    }
  } catch (error) {
    console.error('Error in POST /api/auth/logout-others:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.get('/api/auth/login-history', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ data: null, error: 'Unauthorized' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (!validation.valid) {
      return res.status(401).json({ data: null, error: validation.error });
    }
    
    const limit = parseInt(req.query.limit) || 20;
    const result = await secureAuth.getLoginHistory(validation.session.userId, limit);
    res.json({ data: result.history, error: null });
  } catch (error) {
    console.error('Error in GET /api/auth/login-history:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.get('/api/auth/security-stats', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ data: null, error: 'Unauthorized' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (!validation.valid) {
      return res.status(401).json({ data: null, error: validation.error });
    }
    
    const result = await secureAuth.getSecurityStats(validation.session.userId);
    res.json({ data: result.stats, error: null });
  } catch (error) {
    console.error('Error in GET /api/auth/security-stats:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.get('/api/auth/validate-session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.json({ data: { valid: false }, error: 'No token' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (validation.valid) {
      res.json({
        data: {
          valid: true,
          session: {
            userId: validation.session.userId,
            username: validation.session.username,
            role: validation.session.role
          }
        },
        error: null
      });
    } else {
      res.json({ data: { valid: false }, error: validation.error });
    }
  } catch (error) {
    console.error('Error in GET /api/auth/validate-session:', error);
    res.status(500).json({ data: { valid: false }, error: error.message });
  }
});

// 获取安全设置
app.get('/api/security-settings', async (req, res) => {
  try {
    const [settings] = await pool.query('SELECT * FROM security_settings WHERE id = 1');
    if (settings.length > 0) {
      res.json({ data: settings[0], error: null });
    } else {
      res.json({ data: null, error: '未找到安全设置' });
    }
  } catch (error) {
    console.error('Error in GET /api/security-settings:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 更新安全设置
app.put('/api/security-settings', async (req, res) => {
  try {
    const {
      max_concurrent_sessions_teacher,
      max_concurrent_sessions_student,
      session_timeout_hours,
      allow_multiple_devices_teacher,
      allow_multiple_devices_student,
      enable_ip_binding,
      require_password_change_days,
      enable_login_alert
    } = req.body;

    const [result] = await pool.query(`
      INSERT INTO security_settings (
        id, max_concurrent_sessions_teacher, max_concurrent_sessions_student, 
        session_timeout_hours, allow_multiple_devices_teacher, 
        allow_multiple_devices_student, enable_ip_binding,
        require_password_change_days, enable_login_alert,
        updated_at
      ) VALUES (
        1, ?, ?, ?, ?, ?, ?, ?, ?, NOW()
      ) ON DUPLICATE KEY UPDATE
        max_concurrent_sessions_teacher = ?,
        max_concurrent_sessions_student = ?,
        session_timeout_hours = ?,
        allow_multiple_devices_teacher = ?,
        allow_multiple_devices_student = ?,
        enable_ip_binding = ?,
        require_password_change_days = ?,
        enable_login_alert = ?,
        updated_at = NOW()
    `, [
      max_concurrent_sessions_teacher,
      max_concurrent_sessions_student,
      session_timeout_hours,
      allow_multiple_devices_teacher ? 1 : 0,
      allow_multiple_devices_student ? 1 : 0,
      enable_ip_binding ? 1 : 0,
      require_password_change_days,
      enable_login_alert ? 1 : 0,
      // ON DUPLICATE KEY UPDATE 的参数
      max_concurrent_sessions_teacher,
      max_concurrent_sessions_student,
      session_timeout_hours,
      allow_multiple_devices_teacher ? 1 : 0,
      allow_multiple_devices_student ? 1 : 0,
      enable_ip_binding ? 1 : 0,
      require_password_change_days,
      enable_login_alert ? 1 : 0
    ]);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in PUT /api/security-settings:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取所有用户会话统计（教师权限）
app.get('/api/admin/sessions-stats', async (req, res) => {
  try {
    // 定义活跃时间阈值：30分钟内有活动才算真正在线
    const ACTIVITY_THRESHOLD_MINUTES = 30;
    
    const [stats] = await pool.query(`
      SELECT 
        p.id,
        p.username,
        p.real_name,
        p.role,
        p.class_id,
        c.name as class_name,
        COUNT(DISTINCT CASE 
          WHEN ls.is_active = TRUE 
          AND ls.expires_at > NOW() 
          AND ls.last_active_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
          THEN ls.id 
          ELSE NULL 
        END) as active_session_count,
        MAX(ls.last_active_at) as last_activity,
        MAX(CASE 
          WHEN ls.is_active = TRUE 
          AND ls.expires_at > NOW() 
          AND ls.last_active_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
          THEN ls.ip_address 
          ELSE NULL 
        END) as ip_address
      FROM profiles p
      LEFT JOIN login_sessions ls ON p.id = ls.user_id
      LEFT JOIN classes c ON p.class_id = c.id
      GROUP BY p.id, p.username, p.real_name, p.role, p.class_id, c.name
      ORDER BY active_session_count DESC, last_activity DESC
    `, [ACTIVITY_THRESHOLD_MINUTES, ACTIVITY_THRESHOLD_MINUTES]);
    res.json({ data: stats, error: null });
  } catch (error) {
    console.error('Error in GET /api/admin/sessions-stats:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 强制踢出用户所有设备（教师权限）
app.post('/api/admin/force-logout/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    await pool.query(
      'UPDATE login_sessions SET is_active = FALSE WHERE user_id = ?',
      [userId]
    );

    res.json({ data: { success: true, message: '已踢出用户所有设备' }, error: null });
  } catch (error) {
    console.error('Error in POST /api/admin/force-logout:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ============== 业务API：积分兑换（带事务和唯一约束）==============
app.post('/api/business/exchange-prize', authenticate, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { student_id, prize_id, redemption_code } = req.body;
    
    if (!student_id || !prize_id) {
      await connection.rollback();
      return res.status(400).json({ 
        data: null, 
        error: '缺少必填字段' 
      });
    }

    // 1. 获取奖品信息（带排他锁）
    const [prizes] = await connection.query(
      'SELECT * FROM prizes WHERE id = ? FOR UPDATE', 
      [prize_id]
    );
    
    if (prizes.length === 0) {
      await connection.rollback();
      return res.status(404).json({ 
        data: null, 
        error: '奖品不存在' 
      });
    }
    
    const prize = prizes[0];
    
    if (!prize.is_active) {
      await connection.rollback();
      return res.status(400).json({
        data: null,
        error: '奖品已下架'
      });
    }
    
    const prizePoints = prize.points_cost || 0;
    
    if (prizePoints <= 0) {
      await connection.rollback();
      return res.status(400).json({
        data: null,
        error: '奖品积分配置错误'
      });
    }
    
    // 2. 检查学生积分（带排他锁）
    const [students] = await connection.query(
      'SELECT id, current_points, username FROM profiles WHERE id = ? FOR UPDATE', 
      [student_id]
    );
    
    if (students.length === 0) {
      await connection.rollback();
      return res.status(404).json({ 
        data: null, 
        error: '学生不存在' 
      });
    }
    
    const student = students[0];
    
    if (student.current_points < prizePoints) {
      await connection.rollback();
      return res.status(400).json({ 
        data: null, 
        error: '积分不足' 
      });
    }
    
    // 3. 检查今日兑换次数（根据 daily_limit 判断）
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    
    const [existingExchange] = await connection.query(`
      SELECT COUNT(*) as count FROM exchange_records 
      WHERE student_id = ? 
        AND prize_id = ? 
        AND exchanged_at >= ? 
        AND exchanged_at <= ?
    `, [student_id, prize_id, startOfDay, endOfDay]);
    
    const todayExchangeCount = existingExchange[0].count || 0;
    
    // daily_limit > 0 表示有每日限制，0 或负数表示无限制
    if (prize.daily_limit > 0 && todayExchangeCount >= prize.daily_limit) {
      await connection.rollback();
      return res.status(400).json({ 
        data: null, 
        error: `今日兑换次数已达上限（${prize.daily_limit}次），请明天再试` 
      });
    }

    // 3.5 如果是认证码类奖品，在事务内原子分配一个未使用的码，彻底避免并发竞争
    let assignedCode = redemption_code || null;
    if (prize.type === 'internet_code' && !assignedCode) {
      // 使用 FOR UPDATE 行级锁原子选取
      const [availableCodes] = await connection.query(
        'SELECT id, code FROM internet_codes WHERE is_used = FALSE LIMIT 1 FOR UPDATE',
        []
      );

      if (availableCodes.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          data: null,
          error: '认证码库存不足，请联系老师补充'
        });
      }

      assignedCode = availableCodes[0].code;
    }

    // 3.6 检查库存（装备类和普通类奖品，stock > 0 表示有限库存）
    if (prize.type !== 'internet_code' && prize.stock > 0) {
      // 统计已兑换数量
      const [exchangeCount] = await connection.query(
        'SELECT COUNT(*) as count FROM exchange_records WHERE prize_id = ?',
        [prize_id]
      );
      if (exchangeCount[0].count >= prize.stock) {
        await connection.rollback();
        return res.status(400).json({
          data: null,
          error: '库存不足'
        });
      }
    }
    
    // 4. 扣除积分
    await connection.query(`
      UPDATE profiles 
      SET current_points = current_points - ?, max_points = GREATEST(max_points, current_points) 
      WHERE id = ?
    `, [prizePoints, student_id]);
    
    // 5. 记录积分流水
    await connection.query(`
      INSERT INTO point_transactions (
        student_id, amount, reason, source_type, created_at
      ) VALUES (?, ?, ?, 'system', NOW())
    `, [student_id, -prizePoints, `兑换：${prize.name}`]);
    
    // 6. 创建兑换记录
    const exchangeRecordId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await connection.query(`
      INSERT INTO exchange_records (
        id, student_id, prize_id, prize_name, points_cost, exchanged_at, code
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?)
    `, [exchangeRecordId, student_id, prize_id, prize.name, prizePoints, assignedCode]);
    
    // 7. 如果有赋值到兑换码，标记为已使用
    if (assignedCode && prize.type === 'internet_code') {
      await connection.query(`
        UPDATE internet_codes 
        SET used_by = ?, used_by_username = ?, used_at = NOW(), is_used = TRUE 
        WHERE code = ? AND is_used = FALSE 
        LIMIT 1
      `, [student_id, student.username, assignedCode]);
    }

    // 7.5 如果是装备类奖品，给学生添加装备
    if (prize.type === 'equipment' && prize.equipment_id) {
      // 检查装备是否存在
      const [equipments] = await connection.query(
        'SELECT id, name, icon, crit_bonus FROM equipments WHERE id = ? AND is_active = true',
        [prize.equipment_id]
      );

      if (equipments.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          data: null,
          error: '装备不存在或已下架'
        });
      }

      const equipment = equipments[0];

      // 插入学生装备表（已有则数量+1）
      const seId = `se_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await connection.query(
        `INSERT INTO student_equipments (id, student_id, equipment_id, quantity)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
        [seId, student_id, prize.equipment_id]
      );

      // 在兑换记录中记录装备ID
      await connection.query(
        'UPDATE exchange_records SET equipment_id = ? WHERE id = ?',
        [prize.equipment_id, exchangeRecordId]
      );
    }

    // 7.6 如果是皮肤类奖品，给学生添加皮肤
    if (prize.type === 'skin' && prize.skin_id) {
      const ssId = `ss_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      // INSERT IGNORE 避免重复兑换导致唯一键冲突
      await connection.query(
        `INSERT IGNORE INTO student_skins (id, student_id, skin_id)
         VALUES (?, ?, ?)`,
        [ssId, student_id, prize.skin_id]
      );

      // 在兑换记录中记录皮肤ID
      await connection.query(
        'UPDATE exchange_records SET skin_id = ? WHERE id = ?',
        [prize.skin_id, exchangeRecordId]
      );
    }

    await connection.commit();
    
    // 获取更新后的学生信息
    const [updatedStudent] = await connection.query(
      'SELECT * FROM profiles WHERE id = ?', 
      [student_id]
    );
    
    res.json({ 
      data: { 
        success: true, 
        exchange_id: exchangeRecordId,
        code: assignedCode,
        student: formatRow(updatedStudent[0])
      }, 
      error: null 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in exchange-prize:', error);
    
    res.status(500).json({ 
      data: null, 
      error: error.message 
    });
  } finally {
    connection.release();
  }
});

// ============== 业务API：提交答题（带幂等性和防重复）==============
app.post('/api/business/submit-answer', authenticate, async (req, res) => {
  console.log('[SUBMIT-ANSWER CALLED]', { student_id: req.body.student_id, source: req.body.source });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { 
      student_id, question_id, answer, is_correct, 
      points_change, source, lesson_id, test_id, test_record_id 
    } = req.body;
    
    if (!student_id || !question_id) {
      await connection.rollback();
      return res.status(400).json({ 
        data: null, 
        error: '缺少必填字段' 
      });
    }

    // 检查学生信息（带排他锁）
    const [students] = await connection.query(
      'SELECT id, current_points FROM profiles WHERE id = ? FOR UPDATE', 
      [student_id]
    );
    
    if (students.length === 0) {
      await connection.rollback();
      return res.status(404).json({ 
        data: null, 
        error: '学生不存在' 
      });
    }
    
    // 1. 检查是否已经提交过该题（防止重复提交，practice 来源允许重复，不检查）
    const src = source || 'practice';
    if (src !== 'practice') {
      const [existingAnswer] = await connection.query(`
        SELECT id, is_correct FROM student_answers 
        WHERE student_id = ? AND question_id = ?
        ${lesson_id ? 'AND lesson_id = ?' : ''}
        LIMIT 1
      `, lesson_id ? [student_id, question_id, lesson_id] : [student_id, question_id]);
      
      if (existingAnswer.length > 0) {
        // 非 practice 来源拒绝重复提交
        await connection.rollback();
        return res.status(400).json({ 
          data: null, 
          error: '该题已经提交过了' 
        });
      }
    }
    
    // 2. 更新积分（如果有变化）
    if (points_change !== undefined && points_change !== 0) {
      const newPoints = students[0].current_points + points_change;
      if (newPoints < 0) {
        await connection.rollback();
        return res.status(400).json({ 
          data: null, 
          error: '积分不足' 
        });
      }
      
      const totalPointsEarnedIncrement = points_change > 0 ? points_change : 0;
      await connection.query(`
        UPDATE profiles 
        SET current_points = ?, max_points = GREATEST(max_points, ?), total_points_earned = total_points_earned + ?
        WHERE id = ?
      `, [newPoints, newPoints, totalPointsEarnedIncrement, student_id]);
      
      // 记录积分流水
      await connection.query(`
        INSERT INTO point_transactions (
          student_id, amount, reason, source_type, created_at
        ) VALUES (?, ?, ?, ?, NOW())
      `, [
        student_id, 
        points_change, 
        is_correct ? '答题正确' : '答题错误', 
        source || 'practice'
      ]);
    }
    
    // 3. 创建答题记录
    let answerId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await connection.query(`
      INSERT INTO student_answers (
        id, student_id, question_id, answer, is_correct, 
        points_change, source, test_id, test_record_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      answerId, student_id, question_id, answer, 
      is_correct ? 1 : 0, points_change || 0, source || 'practice', 
      test_id || null, test_record_id || null
    ]);

    // ========== 刷题打怪游戏逻辑 ==========
    let power_multiplier = 1.0;
    let crit_rate = 5;
    let is_crit = false;
    let crit_final_score = points_change || 0;
    let final_score = points_change || 0;
    let newStreak = 0;
    let newCritStreak = 0;
    let newWrong = 0;
    let newHonor = null;
    let droppedEquipments = [];

    // 读取游戏相关字段
      const [profileRows] = await connection.query(
        'SELECT total_correct, curr_streak, curr_crit_streak, curr_wrong, perfect_10_times, triple_crit_times, wrong_3_times, extra_crit FROM profiles WHERE id = ?',
        [student_id]
      );

      const [petRows] = await connection.query(
        'SELECT growth_level FROM student_pets WHERE student_id = ? ORDER BY growth_level DESC LIMIT 1',
        [student_id]
      );

      if (profileRows.length > 0) {
         const gp = profileRows[0];
         const oldStreak = gp.curr_streak || 0;
         const oldCritStreak = gp.curr_crit_streak || 0;
         const oldWrong = gp.curr_wrong || 0;
         const petLevel = petRows.length > 0 ? (petRows[0].growth_level || 1) : 1;
         const extraCrit = parseFloat(gp.extra_crit) || 0;
         // 实时统计实际正确答题数（避免 profiles.total_correct 计数器不一致）
         const [correctCountRows] = await connection.query(
           'SELECT COUNT(*) AS cnt FROM student_answers WHERE student_id = ? AND is_correct = 1',
           [student_id]
         );
         const oldTotalCorrect = correctCountRows[0]?.cnt || 0;
         console.log('[GAME] profile fields:', { total_correct: oldTotalCorrect, pet_level: petLevel, curr_streak: gp.curr_streak });

      // 读取 system_config 游戏配置
      const [configRows] = await connection.query(
        `SELECT config_key, value FROM system_config 
         WHERE config_key IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['points_correct_answer', 'crit_base_rate', 'crit_max_rate',
         'honor_perfect_buff_crit', 'honor_perfect_buff_minutes',
         'honor_critstreak_buff_crit', 'honor_critstreak_buff_minutes',
         'honor_wrong_debuff_crit', 'honor_wrong_debuff_minutes', 'points_wrong_answer']
      );

      const cfg = {};
      configRows.forEach(row => {
        let v = row.value;
        if (typeof v === 'string') {
          try { v = JSON.parse(v); } catch {}
        }
        cfg[row.config_key] = v?.value ?? v;
      });

      const pointsCorrectAnswer = cfg['points_correct_answer'] || 10;
      const pointsWrongAnswer = cfg['points_wrong_answer'] || -5;
      const critBaseRate = parseFloat(cfg['crit_base_rate']) || 5;
      const critMaxRate = parseFloat(cfg['crit_max_rate']) || 30;
      const honorPerfectBuffCrit = parseFloat(cfg['honor_perfect_buff_crit']) || 5;
      const honorPerfectBuffMinutes = parseInt(cfg['honor_perfect_buff_minutes']) || 10;
      const honorCritstreakBuffCrit = parseFloat(cfg['honor_critstreak_buff_crit']) || 10;
      const honorCritstreakBuffMinutes = parseInt(cfg['honor_critstreak_buff_minutes']) || 10;
      const honorWrongDebuffCrit = parseFloat(cfg['honor_wrong_debuff_crit']) || 10;
      const honorWrongDebuffMinutes = parseInt(cfg['honor_wrong_debuff_minutes']) || 1;

      // 战力倍率
      power_multiplier = 1 + 0.1 * petLevel;

      // 查询当前生效 Buff 暴击率修正
      const [buffRows] = await connection.query(
        'SELECT IFNULL(SUM(crit_modifier), 0) AS total_mod FROM student_buffs WHERE student_id = ? AND expires_at > NOW()',
        [student_id]
      );
      const buffSum = parseFloat(buffRows[0]?.total_mod) || 0;

      // 装备暴击加成
      const [eqRows] = await connection.query(
        `SELECT IFNULL(SUM(e.crit_bonus * se.quantity), 0) AS total_eq_crit 
         FROM student_equipments se 
         JOIN equipments e ON se.equipment_id = e.id 
         WHERE se.student_id = ?`,
        [student_id]
      );
      const equipmentCritSum = parseFloat(eqRows[0]?.total_eq_crit) || 0;

      // 皮肤暴击加成
      const SKIN_CRIT_BONUS = {
        'skin_minimal_white': 1,
        'skin_forest_green': 1,
        'skin_ocean_blue': 2,
        'skin_aurora_purple': 3,
        'skin_sunset_gold': 3,
        'skin_royal_gold': 5,
        'skin_galaxy_star': 5,
      };
      const [skinRowsSubmit] = await connection.query(
        'SELECT active_skin_id FROM profiles WHERE id = ?',
        [student_id]
      );
      const activeSkinIdSubmit = skinRowsSubmit[0]?.active_skin_id || null;
      const skinCritBonus = activeSkinIdSubmit ? (SKIN_CRIT_BONUS[activeSkinIdSubmit] || 0) : 0;

      // 暴击率 = Min(crit_base_rate + floor(total_correct/100) + extra_crit + buff总和 + 装备加成 + 皮肤加成, crit_max_rate)，下限5%
      crit_rate = critBaseRate + Math.floor(oldTotalCorrect / 100) + extraCrit + buffSum + equipmentCritSum + skinCritBonus;
      crit_rate = Math.min(crit_rate, critMaxRate);
      crit_rate = Math.max(crit_rate, 5);

      if (is_correct) {
        // ---- 答对 ----
        newStreak = oldStreak + 1;
        newWrong = 0;

        final_score = pointsCorrectAnswer * power_multiplier;

        // 暴击判定
        is_crit = (Math.random() * 100) <= crit_rate;
        if (is_crit) {
          crit_final_score = final_score * 2;
          newCritStreak = oldCritStreak + 1;
        } else {
          crit_final_score = final_score;
          newCritStreak = 0;
        }

        // 若最终得分与原 points_change 不同，补差额
        const diff = Math.round(crit_final_score) - (points_change || 0);
        if (diff !== 0) {
          const [cur] = await connection.query(
            'SELECT current_points FROM profiles WHERE id = ? FOR UPDATE', [student_id]
          );
          const curPts = cur[0]?.current_points || 0;
          const newPts = Math.max(0, curPts + diff);
          const totalPointsEarnedDiff = diff > 0 ? diff : 0;
          await connection.query(
            'UPDATE profiles SET current_points = ?, max_points = GREATEST(max_points, ?), total_points_earned = total_points_earned + ? WHERE id = ?',
            [newPts, newPts, totalPointsEarnedDiff, student_id]
          );
          await connection.query(
            'INSERT INTO point_transactions (student_id, amount, reason, source_type, created_at) VALUES (?, ?, ?, ?, NOW())',
            [student_id, diff, '答题暴击额外奖励', source || 'practice']
          );
        }

        // 荣誉 —— 十连对（每满10连对触发一次）
        if (newStreak >= 10 && Math.floor(newStreak / 10) > Math.floor(oldStreak / 10)) {
          const buffId = `buff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await connection.query(
            'INSERT INTO student_buffs (id, student_id, buff_type, crit_modifier, expires_at, created_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())',
            [buffId, student_id, 'perfect_crit', honorPerfectBuffCrit, honorPerfectBuffMinutes]
          );
          newHonor = { type: 'perfect_10', name: '十全十美', buff_crit: honorPerfectBuffCrit, buff_minutes: honorPerfectBuffMinutes };
        }

        // 荣誉 —— 三连暴击
        if (is_crit && newCritStreak >= 3 && oldCritStreak < 3) {
          const buffId = `buff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await connection.query(
            'INSERT INTO student_buffs (id, student_id, buff_type, crit_modifier, expires_at, created_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())',
            [buffId, student_id, 'critstreak_crit', honorCritstreakBuffCrit, honorCritstreakBuffMinutes]
          );
          newHonor = { type: 'triple_crit', name: '三连暴击', buff_crit: honorCritstreakBuffCrit, buff_minutes: honorCritstreakBuffMinutes };
        }

        // 装备掉落（答对时每件装备独立掷骰）
        const [activeEquipments] = await connection.query(
          'SELECT id, name, icon, drop_rate, crit_bonus FROM equipments WHERE is_active = true'
        );
        for (const eq of activeEquipments) {
          if (Math.random() * 100 < parseFloat(eq.drop_rate)) {
            await connection.query(
              `INSERT INTO student_equipments (id, student_id, equipment_id, quantity) 
               VALUES (?, ?, ?, 1) 
               ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
              [`se_${Date.now()}_${Math.random().toString(36).substr(2,9)}`, student_id, eq.id]
            );
            droppedEquipments.push({ id: eq.id, name: eq.name, icon: eq.icon, crit_bonus: parseFloat(eq.crit_bonus) });
          }
        }
      } else {
        // ---- 答错 ----
        newWrong = oldWrong + 1;
        newStreak = 0;
        newCritStreak = 0;
        final_score = pointsWrongAnswer;
        crit_final_score = pointsWrongAnswer;

        // 荣誉 —— 三连错
        if (newWrong >= 3 && oldWrong < 3) {
          const buffId = `buff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await connection.query(
            'INSERT INTO student_buffs (id, student_id, buff_type, crit_modifier, expires_at, created_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())',
            [buffId, student_id, 'wrong_debuff', -honorWrongDebuffCrit, honorWrongDebuffMinutes]
          );
          newHonor = { type: 'wrong_3', name: '三连错', debuff_crit: -honorWrongDebuffCrit, debuff_minutes: honorWrongDebuffMinutes };
        }
      }

      // 组装 UPDATE profiles —— 游戏字段
      const updFields = [];
      const updValues = [];

      if (is_correct) {
        updFields.push('total_correct = total_correct + 1');
      }
      updFields.push('curr_streak = ?');
      updValues.push(newStreak);
      updFields.push('curr_crit_streak = ?');
      updValues.push(newCritStreak);
      updFields.push('curr_wrong = ?');
      updValues.push(newWrong);

      if (newHonor?.type === 'perfect_10') {
        updFields.push('perfect_10_times = perfect_10_times + 1');
      } else if (newHonor?.type === 'triple_crit') {
        updFields.push('triple_crit_times = triple_crit_times + 1');
      } else if (newHonor?.type === 'wrong_3') {
        updFields.push('wrong_3_times = wrong_3_times + 1');
      }

      updValues.push(student_id);
      await connection.query(
        `UPDATE profiles SET ${updFields.join(', ')} WHERE id = ?`,
        updValues
      );
    }

    await connection.commit();

    // 获取更新后的学生信息
    const [updatedStudent] = await connection.query(
      'SELECT * FROM profiles WHERE id = ?', 
      [student_id]
    );

    res.json({ 
      data: { 
        success: true, 
        answer_id: answerId,
        student: formatRow(updatedStudent[0]),
        power_multiplier: Math.round(power_multiplier * 100) / 100,
        crit_rate: Math.round(crit_rate * 10) / 10,
        is_crit: is_crit,
        crit_final_score: Math.round(crit_final_score),
        final_score: Math.round(final_score),
        current_streak: newStreak,
        current_crit_streak: newCritStreak,
        current_wrong: newWrong,
        new_honor: newHonor,
        dropped_equipments: droppedEquipments
      }, 
      error: null 
    });
    console.log('[GAME RESPONSE] final_score:', Math.round(final_score), 'power:', Math.round(power_multiplier * 100) / 100, 'crit:', is_crit, 'streak:', newStreak, 'new_honor:', newHonor?.type);
  } catch (error) {
    await connection.rollback();
    console.error('Error in submit-answer:', error);
    res.status(500).json({ 
      data: null, 
      error: error.message 
    });
  } finally {
    connection.release();
  }
});

// ============== 业务API：宠物喂食（防止重复）==============
app.post('/api/business/feed-pet', authenticate, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { student_id, pet_id, food_amount = 1 } = req.body;
    
    if (!student_id || !pet_id) {
      await connection.rollback();
      return res.status(400).json({ 
        data: null, 
        error: '缺少必填字段' 
      });
    }

    const amount = parseInt(food_amount, 10);
    if (isNaN(amount) || amount < 1 || amount > 100) {
      await connection.rollback();
      return res.status(400).json({
        data: null,
        error: '食物数量必须在1到100之间'
      });
    }

    // 获取宠物信息（带锁，按创建时间排序确保取到最早的一条）
    const [pets] = await connection.query(
      'SELECT * FROM student_pets WHERE student_id = ? AND pet_id = ? ORDER BY adopted_at ASC LIMIT 1 FOR UPDATE',
      [student_id, pet_id]
    );
    
    if (pets.length === 0) {
      await connection.rollback();
      return res.status(404).json({ 
        data: null, 
        error: '宠物不存在' 
      });
    }
    
    const pet = pets[0];
    
    // 获取食物信息
    const { food_id } = req.body;
    const [foods] = await connection.query(
      'SELECT * FROM pet_foods WHERE id = ? AND is_active = TRUE',
      [food_id]
    );
    
    if (foods.length === 0) {
      await connection.rollback();
      return res.status(404).json({ 
        data: null, 
        error: '食物不存在或已停用' 
      });
    }
    
    const food = foods[0];
    const unitCost = food.points_cost || 5;
    const unitGrowth = food.growth_value || 10;
    const cost = unitCost * amount;
    const growth_value = unitGrowth * amount;
    
    // 检查学生积分（带锁）
    const [students] = await connection.query(
      'SELECT * FROM profiles WHERE id = ? FOR UPDATE', 
      [student_id]
    );
    
    if (students.length === 0) {
      await connection.rollback();
      return res.status(404).json({ 
        data: null, 
        error: '学生不存在' 
      });
    }
    
    const student = students[0];
    if (student.current_points < cost) {
      await connection.rollback();
      return res.status(400).json({ 
        data: null, 
        error: '积分不足' 
      });
    }
    
    // 扣除积分
    await connection.query(`
      UPDATE profiles 
      SET current_points = current_points - ? 
      WHERE id = ?
    `, [cost, student_id]);
    
    // 记录积分流水
    await connection.query(`
      INSERT INTO point_transactions (student_id, amount, reason, source_type, created_at)
      VALUES (?, ?, ?, 'pet_feed', NOW())
    `, [student_id, -cost, '宠物喂食']);
    
    // 获取等级配置
    const [configRows] = await connection.query('SELECT level_base_threshold, level_threshold_increment, max_stage FROM pet_config LIMIT 1');
    const levelConfig = configRows[0] || { level_base_threshold: 50, level_threshold_increment: 50, max_stage: 5 };
    const baseThreshold = levelConfig.level_base_threshold || 50;
    const increment = levelConfig.level_threshold_increment || 50;

    // 更新宠物成长值
    const newGrowthValue = pet.growth_value + growth_value;
    let newGrowthLevel = pet.growth_level;

    // 计算等级：等级可以无限上升，阶段（形态）在前端用 max_stage 限制
    // 累计阈值：到达等级n+1所需的总成长值 = baseThreshold * n + increment * n * (n-1) / 2
    if (newGrowthValue <= 0) {
      newGrowthLevel = 1;
    } else {
      // 先估算一个大致范围，再精确计算
      // 近似公式： increment/2 * n^2 + (baseThreshold - increment/2) * n - growthValue = 0
      const a = increment / 2;
      const b = baseThreshold - increment / 2;
      const c = -newGrowthValue;
      const approxN = Math.floor((-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a));

      // 从近似值附近开始精确计算，找到刚好满足的等级
      let startLevel = Math.max(1, approxN - 2);
      let cumulative = 0;
      // 计算到 startLevel 的累计
      for (let i = 1; i < startLevel; i++) {
        cumulative += baseThreshold + (i - 1) * increment;
      }
      newGrowthLevel = startLevel;
      while (true) {
        const threshold = baseThreshold + (newGrowthLevel - 1) * increment;
        if (newGrowthValue < cumulative + threshold) {
          break;
        }
        cumulative += threshold;
        newGrowthLevel++;
      }
    }
    
    await connection.query(`
      UPDATE student_pets 
      SET growth_value = ?, growth_level = ?
      WHERE id = ?
    `, [newGrowthValue, newGrowthLevel, pet.id]);
    
    await connection.commit();
    
    // 获取更新后的信息
    const [updatedPet] = await connection.query(
      'SELECT * FROM student_pets WHERE id = ?', 
      [pet.id]
    );
    const [updatedStudent] = await connection.query(
      'SELECT * FROM profiles WHERE id = ?', 
      [student_id]
    );
    
    res.json({ 
      data: { 
        success: true, 
        pet: updatedPet[0],
        student: formatRow(updatedStudent[0]),
        level_up: newGrowthLevel > pet.growth_level
      }, 
      error: null 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in feed-pet:', error);
    res.status(500).json({ 
      data: null, 
      error: error.message 
    });
  } finally {
    connection.release();
  }
});

// ============== 业务API：提交测试（防止重复）==============
app.post('/api/business/submit-test', authenticate, async (req, res) => {
  console.log('[submit-test] 接收到测试提交请求');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { 
      student_id, 
      test_id, 
      answers, 
      questions 
    } = req.body;
    console.log('[submit-test] student_id:', student_id, 'test_id:', test_id);
    
    if (!student_id || !test_id || !answers || !questions) {
      await connection.rollback();
      return res.status(400).json({ 
        data: null, 
        error: '缺少必填字段' 
      });
    }

    // 先计算得分
    let correct = 0;
    const total = questions.length;

    const normalizeAnswer = (ans) => {
      return (ans || '').toLowerCase().trim();
    };

    const getAnswersArray = (ansField) => {
      if (!ansField) return [];
      let parsed;
      try {
        parsed = typeof ansField === 'string' ? JSON.parse(ansField) : ansField;
      } catch {
        parsed = ansField;
      }
      if (Array.isArray(parsed?.answers)) return parsed.answers;
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string') return [parsed];
      return [];
    };

    const getCompositeSubQuestions = (ansField) => {
      const parsed = getAnswersArray(ansField);
      return Array.isArray(parsed) ? parsed : [];
    };

    const normalizeBlankAnswers = (answers) => {
      if (!Array.isArray(answers)) return [[]];
      if (answers.length === 0) return [[]];
      if (answers.some(item => Array.isArray(item))) {
        return answers.map(item => Array.isArray(item) ? item : item ? [item] : []);
      }
      return answers.map(item => item ? [item] : []);
    };

    const checkFillBlankAnswer = (userAnswers, correctAnswers) => {
      const normalized = normalizeBlankAnswers(correctAnswers);
      if (userAnswers.length !== normalized.length) return false;
      return userAnswers.every((userAns, idx) => {
        const correctList = normalized[idx] || [];
        return correctList.some(ca => ca.toLowerCase().trim() === (userAns || '').toLowerCase().trim());
      });
    };

    const checkChoiceAnswer = (userAnswer, correctAnswers, multiple) => {
      if (multiple) {
        const userList = (userAnswer || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).sort();
        const correctList = (correctAnswers || []).map(s => s.trim().toUpperCase()).filter(Boolean).sort();
        return userList.length === correctList.length && userList.every((v, i) => v === correctList[i]);
      }
      return (correctAnswers || []).some(ca => ca.toLowerCase().trim() === (userAnswer || '').toLowerCase().trim());
    };

    for (const q of questions) {
      const userAnswer = answers[q.id];
      if (!userAnswer) continue;
      if (q.type === 'composite') {
        try {
          const parsed = JSON.parse(userAnswer);
          const subQs = getCompositeSubQuestions(q.answers);
          const allCorrect = subQs.every((sq, idx) => {
            if (sq.type === 'choice') {
              const ans = parsed.choice_answers?.[idx] || '';
              return checkChoiceAnswer(ans, sq.answers || [], sq.multiple || false);
            } else if (sq.type === 'fill_blank') {
              const ans = parsed.blank_answers?.[idx] || [];
              return checkFillBlankAnswer(ans, sq.answers || []);
            }
            return false;
          });
          if (allCorrect) correct++;
        } catch {
          // 解析失败不计分
        }
      } else {
        const correctAnswers = getAnswersArray(q.answers);
        const isCorrect = correctAnswers.some(
          (ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer)
        );
        if (isCorrect) correct++;
      }
    }

    const score = Math.round((correct / total) * 100);

    // 获取测试信息
    const [tests] = await connection.query(
      'SELECT * FROM tests WHERE id = ?',
      [test_id]
    );
    
    if (tests.length === 0) {
      await connection.rollback();
      return res.status(404).json({ 
        data: null, 
        error: '测试不存在' 
      });
    }
    
    const test = tests[0];
    
    // 检查考试是否已结束
    if (!test.is_active && test.type === 'exam') {
      await connection.rollback();
      return res.status(400).json({
        data: null,
        error: '考试已结束，无法提交'
      });
    }
    
    const passingScore = test.passing_score || 60;
    const isPassed = score >= passingScore;
    const pointsEarned = isPassed ? Math.round((score / 100) * (test.points_reward || 50)) : 0;
    let internetCode = null;

    // 处理认证码奖励（先查，确保 test_record 写入正确的 internet_code）
    if (isPassed && test.allow_internet_code && test.internet_code_reward > 0) {
      const [todayCodes] = await connection.query(
        'SELECT COUNT(*) as cnt FROM test_records WHERE student_id = ? AND internet_code IS NOT NULL AND DATE(completed_at) = CURDATE()',
        [student_id]
      );
      if (todayCodes[0].cnt === 0) {
        const [availableCodes] = await connection.query(
          'SELECT * FROM internet_codes WHERE is_used = false ORDER BY RAND() LIMIT ? FOR UPDATE',
          [test.internet_code_reward]
        );
        if (availableCodes.length > 0) {
          internetCode = availableCodes[0].code;
          const [studentRows] = await connection.query(
            'SELECT username FROM profiles WHERE id = ?',
            [student_id]
          );
          const studentUsername = studentRows.length > 0 ? studentRows[0].username : '';
          await connection.query(
            'UPDATE internet_codes SET is_used = true, used_by = ?, used_by_username = ?, used_at = NOW(), source = \'test\', source_id = ? WHERE id = ? AND is_used = false',
            [student_id, studentUsername, test_id, availableCodes[0].id]
          );
        }
      }
    }

    // 先插入 test_record
    const testRecordId = `tr_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
    const [testRecordResult] = await connection.query(
      'INSERT INTO test_records (id, test_id, student_id, score, correct_count, total_count, points_earned, internet_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [testRecordId, test_id, student_id, score, correct, total, pointsEarned, internetCode]
    );
    
    // 处理积分
    if (pointsEarned > 0) {
      // 检查学生积分（带锁）
      const [students] = await connection.query(
        'SELECT * FROM profiles WHERE id = ? FOR UPDATE',
        [student_id]
      );
      
      if (students.length > 0) {
        // 增加积分
        await connection.query(
          'UPDATE profiles SET current_points = current_points + ?, total_points_earned = total_points_earned + ? WHERE id = ?',
          [pointsEarned, pointsEarned, student_id]
        );
        
        // 记录积分流水
        await connection.query(
          'INSERT INTO point_transactions (student_id, amount, reason, source_type, created_at) VALUES (?, ?, ?, \'test\', NOW())',
          [student_id, pointsEarned, `测试通过: ${test.title || test.name}`]
        );
      }
    }
    
    // 处理学生答案和错题
    for (const q of questions) {
      const userAnswer = (answers[q.id] || '').trim();
      let isCorrect = false;
      if (q.type === 'composite') {
        try {
          const parsed = JSON.parse(userAnswer);
          const subQs = getCompositeSubQuestions(q.answers);
          isCorrect = subQs.every((sq, idx) => {
            if (sq.type === 'choice') {
              const ans = parsed.choice_answers?.[idx] || '';
              return checkChoiceAnswer(ans, sq.answers || [], sq.multiple || false);
            } else if (sq.type === 'fill_blank') {
              const ans = parsed.blank_answers?.[idx] || [];
              return checkFillBlankAnswer(ans, sq.answers || []);
            }
            return false;
          });
        } catch {
          isCorrect = false;
        }
      } else {
        isCorrect = getAnswersArray(q.answers).some(
          (ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer)
        );
      }

      if (userAnswer) {
        // 插入学生答案
        const saId = `sa_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        await connection.query(
          'INSERT INTO student_answers (id, student_id, question_id, answer, is_correct, points_change, source, test_id, test_record_id, created_at) VALUES (?, ?, ?, ?, ?, 0, \'test\', ?, ?, NOW())',
          [saId, student_id, q.id, userAnswer, isCorrect ? 1 : 0, test_id, testRecordId]
        );
      }

      if (!isCorrect) {
        // 处理错题
        const [existingWrongs] = await connection.query(
          'SELECT * FROM wrong_questions WHERE student_id = ? AND question_id = ?',
          [student_id, q.id]
        );

        if (existingWrongs.length > 0) {
          await connection.query(
            'UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_at = NOW() WHERE id = ?',
            [existingWrongs[0].id]
          );
        } else {
          const wqId = `wq_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
          await connection.query(
            'INSERT INTO wrong_questions (id, student_id, question_id, wrong_count, last_wrong_at, created_at) VALUES (?, ?, ?, 1, NOW(), NOW())',
            [wqId, student_id, q.id]
          );
        }
      }
    }

    // 装备掉落（考试及格，掉率为练习时10倍）
    let droppedEquipments = [];
    console.log('[submit-test] isPassed:', isPassed, 'allow_equipment_drop:', test.allow_equipment_drop);
    if (isPassed && test.allow_equipment_drop) {
      const [activeEquipments] = await connection.query(
        'SELECT id, name, icon, drop_rate, crit_bonus FROM equipments WHERE is_active = true'
      );
      console.log('[submit-test] 活跃装备数量:', activeEquipments.length);
      for (const eq of activeEquipments) {
        const dropChance = Math.random() * 100;
        const dropThreshold = parseFloat(eq.drop_rate) * 10;
        console.log('[submit-test] 装备:', eq.name, '随机数:', dropChance.toFixed(2), '阈值:', dropThreshold, '是否掉落:', dropChance < dropThreshold);
        if (dropChance < dropThreshold) {
          await connection.query(
            `INSERT INTO student_equipments (id, student_id, equipment_id, quantity) 
             VALUES (?, ?, ?, 1) 
             ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
            [`se_${Date.now()}_${Math.random().toString(36).substr(2,9)}`, student_id, eq.id]
          );
          droppedEquipments.push({ id: eq.id, name: eq.name, icon: eq.icon, crit_bonus: parseFloat(eq.crit_bonus) });
        }
      }
    }
    console.log('[submit-test] 掉落装备:', droppedEquipments);

    await connection.commit();
    
    // 获取更新后的学生信息
    const [updatedStudent] = await connection.query(
      'SELECT * FROM profiles WHERE id = ?',
      [student_id]
    );
    
    res.json({ 
      data: { 
        success: true, 
        score,
        correct,
        total,
        is_passed: isPassed,
        points_earned: pointsEarned,
        internet_code: internetCode,
        test_record_id: testRecordId,
        dropped_equipments: droppedEquipments,
        student: formatRow(updatedStudent[0])
      }, 
      error: null 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in submit-test:', error);
    res.status(500).json({ 
      data: null, 
      error: error.message 
    });
  } finally {
    connection.release();
  }
});

// ============== 业务API：测试装备掉落 ==============
app.post('/api/business/test-equipment-drop', authenticate, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { student_id, test_id, score, is_passed } = req.body;
    console.log('[test-equipment-drop] student_id:', student_id, 'test_id:', test_id, 'is_passed:', is_passed);
    
    if (!student_id || !test_id) {
      return res.status(400).json({ data: null, error: '缺少必填字段' });
    }

    const [tests] = await connection.query('SELECT * FROM tests WHERE id = ?', [test_id]);
    if (tests.length === 0) {
      return res.status(404).json({ data: null, error: '测试不存在' });
    }
    
    const test = tests[0];
    const isPassed = is_passed !== undefined ? is_passed : (score >= (test.passing_score || 60));
    
    let droppedEquipments = [];
    console.log('[test-equipment-drop] isPassed:', isPassed, 'allow_equipment_drop:', test.allow_equipment_drop);
    
    if (isPassed && test.allow_equipment_drop) {
      const [activeEquipments] = await connection.query(
        'SELECT id, name, icon, drop_rate, crit_bonus FROM equipments WHERE is_active = true'
      );
      console.log('[test-equipment-drop] 活跃装备数量:', activeEquipments.length);
      
      for (const eq of activeEquipments) {
        const dropChance = Math.random() * 100;
        const dropThreshold = parseFloat(eq.drop_rate) * 10;
        console.log('[test-equipment-drop] 装备:', eq.name, '随机数:', dropChance.toFixed(2), '阈值:', dropThreshold);
        
        if (dropChance < dropThreshold) {
          await connection.query(
            `INSERT INTO student_equipments (id, student_id, equipment_id, quantity) 
             VALUES (?, ?, ?, 1) 
             ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
            [`se_${Date.now()}_${Math.random().toString(36).substr(2,9)}`, student_id, eq.id]
          );
          droppedEquipments.push({ id: eq.id, name: eq.name, icon: eq.icon, crit_bonus: parseFloat(eq.crit_bonus) });
        }
      }
    }
    
    console.log('[test-equipment-drop] 掉落装备:', droppedEquipments);
    
    res.json({ 
      data: { dropped_equipments: droppedEquipments }, 
      error: null 
    });
  } catch (error) {
    console.error('[test-equipment-drop] Error:', error);
    res.status(500).json({ data: null, error: error.message });
  } finally {
    connection.release();
  }
});

// ============== 业务API：提交考试 ==============
app.post('/api/business/submit-exam', authenticate, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { 
      student_id, 
      test_id, 
      answers, 
      questions 
    } = req.body;
    
    if (!student_id || !test_id || !answers || !questions) {
      await connection.rollback();
      return res.status(400).json({ 
        data: null, 
        error: '缺少必填字段' 
      });
    }

    let correct = 0;
    const total = questions.length;

    const normalizeAnswer = (ans) => {
      return (ans || '').toLowerCase().trim();
    };

    const getAnswersArray = (ansField) => {
      if (!ansField) return [];
      let parsed;
      try {
        parsed = typeof ansField === 'string' ? JSON.parse(ansField) : ansField;
      } catch {
        parsed = ansField;
      }
      if (Array.isArray(parsed?.answers)) return parsed.answers;
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string') return [parsed];
      return [];
    };

    const getCompositeSubQuestions = (ansField) => {
      const parsed = getAnswersArray(ansField);
      return Array.isArray(parsed) ? parsed : [];
    };

    const normalizeBlankAnswers = (answers) => {
      if (!Array.isArray(answers)) return [[]];
      if (answers.length === 0) return [[]];
      if (answers.some(item => Array.isArray(item))) {
        return answers.map(item => Array.isArray(item) ? item : item ? [item] : []);
      }
      return answers.map(item => item ? [item] : []);
    };

    const checkFillBlankAnswer = (userAnswers, correctAnswers) => {
      const normalized = normalizeBlankAnswers(correctAnswers);
      if (userAnswers.length !== normalized.length) return false;
      return userAnswers.every((userAns, idx) => {
        const correctList = normalized[idx] || [];
        return correctList.some(ca => ca.toLowerCase().trim() === (userAns || '').toLowerCase().trim());
      });
    };

    const checkChoiceAnswer = (userAnswer, correctAnswers, multiple) => {
      if (multiple) {
        const userList = (userAnswer || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).sort();
        const correctList = (correctAnswers || []).map(s => s.trim().toUpperCase()).filter(Boolean).sort();
        return userList.length === correctList.length && userList.every((v, i) => v === correctList[i]);
      }
      return (correctAnswers || []).some(ca => ca.toLowerCase().trim() === (userAnswer || '').toLowerCase().trim());
    };

    for (const q of questions) {
      const userAnswer = answers[q.id];
      if (!userAnswer) continue;
      if (q.type === 'composite') {
        try {
          const parsed = JSON.parse(userAnswer);
          const subQs = getCompositeSubQuestions(q.answers);
          const allCorrect = subQs.every((sq, idx) => {
            if (sq.type === 'choice') {
              const ans = parsed.choice_answers?.[idx] || '';
              return checkChoiceAnswer(ans, sq.answers || [], sq.multiple || false);
            } else if (sq.type === 'fill_blank') {
              const ans = parsed.blank_answers?.[idx] || [];
              return checkFillBlankAnswer(ans, sq.answers || []);
            }
            return false;
          });
          if (allCorrect) correct++;
        } catch {
          // 解析失败不计分
        }
      } else {
        const correctAnswers = getAnswersArray(q.answers);
        const isCorrect = correctAnswers.some(
          (ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer)
        );
        if (isCorrect) correct++;
      }
    }

    const score = Math.round((correct / total) * 100);

    const [tests] = await connection.query(
      'SELECT * FROM tests WHERE id = ?',
      [test_id]
    );
    
    if (tests.length === 0) {
      await connection.rollback();
      return res.status(404).json({ 
        data: null, 
        error: '考试不存在' 
      });
    }
    
    const test = tests[0];
    
    if (!test.is_active) {
      await connection.rollback();
      return res.status(400).json({
        data: null,
        error: '考试已结束，无法提交'
      });
    }
    
    const passingScore = test.passing_score || 60;
    const isPassed = score >= passingScore;
    const pointsEarned = isPassed ? Math.round((score / 100) * (test.points_reward || 50)) : 0;
    let internetCodes = [];

    if (isPassed && test.allow_internet_code && test.internet_code_reward > 0) {
      const [todayCodes] = await connection.query(
        'SELECT COUNT(*) as cnt FROM exam_records WHERE student_id = ? AND internet_codes_earned > 0 AND DATE(completed_at) = CURDATE()',
        [student_id]
      );
      if (todayCodes[0].cnt === 0) {
        const [availableCodes] = await connection.query(
          'SELECT * FROM internet_codes WHERE is_used = false ORDER BY RAND() LIMIT ? FOR UPDATE',
          [test.internet_code_reward]
        );
        if (availableCodes.length > 0) {
          internetCodes = availableCodes.map(c => c.code);
          const [studentRows] = await connection.query(
            'SELECT username FROM profiles WHERE id = ?',
            [student_id]
          );
          const studentUsername = studentRows.length > 0 ? studentRows[0].username : '';
          for (const code of internetCodes) {
            await connection.query(
              'UPDATE internet_codes SET is_used = true, used_by = ?, used_by_username = ?, used_at = NOW(), source = \'exam\', source_id = ? WHERE code = ? AND is_used = false',
              [student_id, studentUsername, test_id, code]
            );
          }
        }
      }
    }

    const [examRecordData] = await connection.query(
      'SELECT id FROM exam_records WHERE test_id = ? AND student_id = ?',
      [test_id, student_id]
    );
    
    let examRecordId = examRecordData.length > 0 ? examRecordData[0].id : null;
    
    if (examRecordId) {
      await connection.query(
        'UPDATE exam_records SET score = ?, correct_count = ?, total_count = ?, points_earned = ?, internet_codes_earned = ?, is_passed = ?, completed_at = NOW() WHERE id = ?',
        [score, correct, total, pointsEarned, internetCodes.length, isPassed ? 1 : 0, examRecordId]
      );
    } else {
      examRecordId = `er_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
      await connection.query(
        'INSERT INTO exam_records (id, test_id, student_id, score, correct_count, total_count, points_earned, internet_codes_earned, is_passed, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [examRecordId, test_id, student_id, score, correct, total, pointsEarned, internetCodes.length, isPassed ? 1 : 0]
      );
    }
    
    if (pointsEarned > 0) {
      const [students] = await connection.query(
        'SELECT * FROM profiles WHERE id = ? FOR UPDATE',
        [student_id]
      );
      
      if (students.length > 0) {
        await connection.query(
          'UPDATE profiles SET current_points = current_points + ?, total_points_earned = total_points_earned + ? WHERE id = ?',
          [pointsEarned, pointsEarned, student_id]
        );
        
        await connection.query(
          'INSERT INTO point_transactions (student_id, amount, reason, source_type, created_at) VALUES (?, ?, ?, \'exam\', NOW())',
          [student_id, pointsEarned, `考试通过: ${test.title || test.name}`]
        );
      }
    }
    
    for (const q of questions) {
      const userAnswer = (answers[q.id] || '').trim();
      let isCorrect = false;
      if (q.type === 'composite') {
        try {
          const parsed = JSON.parse(userAnswer);
          const subQs = getCompositeSubQuestions(q.answers);
          isCorrect = subQs.every((sq, idx) => {
            if (sq.type === 'choice') {
              const ans = parsed.choice_answers?.[idx] || '';
              return checkChoiceAnswer(ans, sq.answers || [], sq.multiple || false);
            } else if (sq.type === 'fill_blank') {
              const ans = parsed.blank_answers?.[idx] || [];
              return checkFillBlankAnswer(ans, sq.answers || []);
            }
            return false;
          });
        } catch {
          isCorrect = false;
        }
      } else {
        isCorrect = getAnswersArray(q.answers).some(
          (ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer)
        );
      }

      if (userAnswer) {
        const saId = `sa_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        await connection.query(
          'INSERT INTO student_answers (id, student_id, question_id, answer, is_correct, points_change, source, test_id, test_record_id, created_at) VALUES (?, ?, ?, ?, ?, 0, \'exam\', ?, ?, NOW())',
          [saId, student_id, q.id, userAnswer, isCorrect ? 1 : 0, test_id, examRecordId]
        );
      }

      if (!isCorrect) {
        const [existingWrongs] = await connection.query(
          'SELECT * FROM wrong_questions WHERE student_id = ? AND question_id = ?',
          [student_id, q.id]
        );

        if (existingWrongs.length > 0) {
          await connection.query(
            'UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_at = NOW() WHERE id = ?',
            [existingWrongs[0].id]
          );
        } else {
          const wqId = `wq_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
          await connection.query(
            'INSERT INTO wrong_questions (id, student_id, question_id, wrong_count, last_wrong_at, created_at) VALUES (?, ?, ?, 1, NOW(), NOW())',
            [wqId, student_id, q.id]
          );
        }
      }
    }

    let droppedEquipments = [];
    if (isPassed && test.allow_equipment_drop) {
      const [activeEquipments] = await connection.query(
        'SELECT id, name, icon, drop_rate, crit_bonus FROM equipments WHERE is_active = true'
      );
      for (const eq of activeEquipments) {
        if (Math.random() * 100 < parseFloat(eq.drop_rate) * 10) {
          await connection.query(
            `INSERT INTO student_equipments (id, student_id, equipment_id, quantity) 
             VALUES (?, ?, ?, 1) 
             ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
            [`se_${Date.now()}_${Math.random().toString(36).substr(2,9)}`, student_id, eq.id]
          );
          droppedEquipments.push({ id: eq.id, name: eq.name, icon: eq.icon, crit_bonus: parseFloat(eq.crit_bonus) });
        }
      }
    }

    await connection.commit();
    
    const [updatedStudent] = await connection.query(
      'SELECT * FROM profiles WHERE id = ?',
      [student_id]
    );
    
    res.json({ 
      data: { 
        success: true, 
        score,
        correct,
        total,
        is_passed: isPassed,
        points_earned: pointsEarned,
        internet_codes: internetCodes,
        exam_record_id: examRecordId,
        dropped_equipments: droppedEquipments,
        student: formatRow(updatedStudent[0])
      }, 
      error: null 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in submit-exam:', error);
    res.status(500).json({ 
      data: null, 
      error: error.message 
    });
  } finally {
    connection.release();
  }
});

// ============== 业务API：保存考试进度（断点续考）==============
app.post('/api/business/exam-progress', authenticate, async (req, res) => {
  try {
    const { exam_record_id, student_id, test_id, answers, current_index, time_remaining } = req.body;

    if (!exam_record_id || !student_id || !test_id) {
      return res.status(400).json({ data: null, error: '缺少必填字段' });
    }

    // 使用 REPLACE INTO 实现插入或更新
    const progressId = `ep_${exam_record_id}`;
    await pool.query(
      `INSERT INTO exam_progress (id, exam_record_id, student_id, test_id, answers, current_index, time_remaining, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         answers = VALUES(answers),
         current_index = VALUES(current_index),
         time_remaining = VALUES(time_remaining),
         updated_at = NOW()`,
      [progressId, exam_record_id, student_id, test_id, JSON.stringify(answers || {}), current_index || 0, time_remaining || 0]
    );

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in exam-progress:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ============== 业务API：获取考试进度（断点续考）==============
app.get('/api/business/exam-progress/:examRecordId', authenticate, async (req, res) => {
  try {
    const { examRecordId } = req.params;

    const [rows] = await pool.query(
      'SELECT * FROM exam_progress WHERE exam_record_id = ?',
      [examRecordId]
    );

    if (rows.length === 0) {
      return res.json({ data: null, error: null });
    }

    const progress = rows[0];
    // 解析 answers JSON字段
    if (progress.answers && typeof progress.answers === 'string') {
      try {
        progress.answers = JSON.parse(progress.answers);
      } catch {
        progress.answers = {};
      }
    }

    res.json({ data: progress, error: null });
  } catch (error) {
    console.error('Error in get exam-progress:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ============== 业务API：删除考试进度（考试完成后）==============
app.delete('/api/business/exam-progress/:examRecordId', authenticate, async (req, res) => {
  try {
    const { examRecordId } = req.params;

    await pool.query('DELETE FROM exam_progress WHERE exam_record_id = ?', [examRecordId]);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in delete exam-progress:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ============== 业务API：结束考试（教师端）==============
// 结束考试后：
// 1. 已完成的学生：不变
// 2. 未完成但有答题记录的学生：用exam_progress缓存答案评分（强行提交）
// 3. 未参加的学生：创建0分记录
app.post('/api/business/close-exam', authenticate, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { test_id } = req.body;

    if (!test_id) {
      await connection.rollback();
      return res.status(400).json({ data: null, error: '缺少考试ID' });
    }

    // 1. 获取考试信息
    const [testRows] = await connection.query(
      'SELECT * FROM tests WHERE id = ?',
      [test_id]
    );

    if (testRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ data: null, error: '考试不存在' });
    }

    const test = testRows[0];
    const passingScore = test.passing_score || 60;

    // 2. 获取考试题目
    let questionIds = [];
    if (test.question_ids) {
      try {
        const parsed = typeof test.question_ids === 'string'
          ? JSON.parse(test.question_ids)
          : test.question_ids;
        if (Array.isArray(parsed)) questionIds = parsed;
      } catch {
        questionIds = [];
      }
    }

    let questions = [];
    if (questionIds.length > 0) {
      const placeholders = questionIds.map(() => '?').join(',');
      [questions] = await connection.query(
        `SELECT * FROM questions WHERE id IN (${placeholders})`,
        questionIds
      );
    }

    const totalCount = questions.length;

    // 辅助函数：标准化答案
    const normalizeAnswer = (ans) => {
      return (ans || '').toString().toLowerCase().trim();
    };

    const getAnswersArray = (ansField) => {
      if (!ansField) return [];
      let parsed;
      try {
        parsed = typeof ansField === 'string' ? JSON.parse(ansField) : ansField;
      } catch {
        parsed = ansField;
      }
      if (Array.isArray(parsed?.answers)) return parsed.answers;
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string') return [parsed];
      return [];
    };

    const getCompositeSubQuestions = (ansField) => {
      const parsed = getAnswersArray(ansField);
      return Array.isArray(parsed) ? parsed : [];
    };

    const normalizeBlankAnswers = (answers) => {
      if (!Array.isArray(answers)) return [[]];
      if (answers.length === 0) return [[]];
      if (answers.some(item => Array.isArray(item))) {
        return answers.map(item => Array.isArray(item) ? item : item ? [item] : []);
      }
      return answers.map(item => item ? [item] : []);
    };

    const checkFillBlankAnswer = (userAnswers, correctAnswers) => {
      const normalized = normalizeBlankAnswers(correctAnswers);
      if (userAnswers.length !== normalized.length) return false;
      return userAnswers.every((userAns, idx) => {
        const correctList = normalized[idx] || [];
        return correctList.some(ca => ca.toLowerCase().trim() === (userAns || '').toLowerCase().trim());
      });
    };

    const checkChoiceAnswer = (userAnswer, correctAnswers, multiple) => {
      if (multiple) {
        const userList = (userAnswer || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).sort();
        const correctList = (correctAnswers || []).map(s => s.trim().toUpperCase()).filter(Boolean).sort();
        return userList.length === correctList.length && userList.every((v, i) => v === correctList[i]);
      }
      return (correctAnswers || []).some(ca => ca.toLowerCase().trim() === (userAnswer || '').toLowerCase().trim());
    };

    // 3. 获取所有应该参加考试的学生（根据 class_ids）
    let targetClassIds = [];
    if (test.class_ids) {
      try {
        const parsed = typeof test.class_ids === 'string'
          ? JSON.parse(test.class_ids)
          : test.class_ids;
        if (Array.isArray(parsed)) targetClassIds = parsed;
      } catch {
        targetClassIds = [];
      }
    }

    let allStudents = [];
    if (targetClassIds.length > 0) {
      const placeholders = targetClassIds.map(() => '?').join(',');
      [allStudents] = await connection.query(
        `SELECT id, username, real_name, class_id FROM profiles WHERE role = 'student' AND class_id IN (${placeholders})`,
        targetClassIds
      );
    } else {
      // 没有设置 class_ids，面向所有学生
      [allStudents] = await connection.query(
        `SELECT id, username, real_name, class_id FROM profiles WHERE role = 'student'`
      );
    }

    // 4. 获取所有已有考试记录
    const [existingRecords] = await connection.query(
      'SELECT * FROM exam_records WHERE test_id = ?',
      [test_id]
    );

    const recordsByStudent = new Map();
    existingRecords.forEach((r) => recordsByStudent.set(r.student_id, r));

    // 5. 获取所有答题进度缓存
    const [progressRows] = await connection.query(
      'SELECT * FROM exam_progress WHERE test_id = ?',
      [test_id]
    );

    const progressByStudent = new Map();
    progressRows.forEach((p) => progressByStudent.set(p.student_id, p));

    let forcedSubmitCount = 0;
    let noAttendCount = 0;

    // 6. 遍历每个学生，处理其考试状态
    for (const student of allStudents) {
      const existingRecord = recordsByStudent.get(student.id);

      // 6.1 已完成的学生：跳过
      if (existingRecord && existingRecord.completed_at) {
        continue;
      }

      // 6.2 未完成但有答题记录的学生：用 exam_progress 评分后提交
      if (existingRecord && !existingRecord.completed_at) {
        let answers = {};
        const progress = progressByStudent.get(student.id);
        if (progress && progress.answers) {
          try {
            answers = typeof progress.answers === 'string'
              ? JSON.parse(progress.answers)
              : progress.answers;
          } catch {
            answers = {};
          }
        }

        // 计算得分
        let correct = 0;
        for (const q of questions) {
          const userAnswer = answers[q.id];
          if (!userAnswer) continue;
          if (q.type === 'composite') {
            try {
              const parsed = JSON.parse(userAnswer);
              const subQs = getCompositeSubQuestions(q.answers);
              const allCorrect = subQs.every((sq, idx) => {
                if (sq.type === 'choice') {
                  const ans = parsed.choice_answers?.[idx] || '';
                  return checkChoiceAnswer(ans, sq.answers || [], sq.multiple || false);
                } else if (sq.type === 'fill_blank') {
                  const ans = parsed.blank_answers?.[idx] || [];
                  return checkFillBlankAnswer(ans, sq.answers || []);
                }
                return false;
              });
              if (allCorrect) correct++;
            } catch {
              // 解析失败不计分
            }
          } else {
            const correctAnswers = getAnswersArray(q.answers);
            const isCorrect = correctAnswers.some(
              (ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer)
            );
            if (isCorrect) correct++;
          }
        }

        const score = totalCount > 0 ? Math.round((correct / totalCount) * 100) : 0;
        const isPassed = score >= passingScore;
        const pointsEarned = isPassed ? Math.round((score / 100) * (test.points_reward || 50)) : 0;

        await connection.query(
          `UPDATE exam_records 
           SET score = ?, correct_count = ?, total_count = ?, 
               points_earned = ?, internet_codes_earned = 0, is_passed = ?, 
               completed_at = NOW()
           WHERE id = ?`,
          [score, correct, totalCount, pointsEarned, isPassed ? 1 : 0, existingRecord.id]
        );

        // 记录学生答案
        for (const q of questions) {
          const userAnswer = (answers[q.id] || '').trim();
          if (!userAnswer) continue;

          let isCorrect = false;
          if (q.type === 'composite') {
            try {
              const parsed = JSON.parse(userAnswer);
              const subQs = getCompositeSubQuestions(q.answers);
              isCorrect = subQs.every((sq, idx) => {
                if (sq.type === 'choice') {
                  const ans = parsed.choice_answers?.[idx] || '';
                  return checkChoiceAnswer(ans, sq.answers || [], sq.multiple || false);
                } else if (sq.type === 'fill_blank') {
                  const ans = parsed.blank_answers?.[idx] || [];
                  return checkFillBlankAnswer(ans, sq.answers || []);
                }
                return false;
              });
            } catch {
              isCorrect = false;
            }
          } else {
            const correctAnswers = getAnswersArray(q.answers);
            isCorrect = correctAnswers.some(
              (ans) => normalizeAnswer(ans) === normalizeAnswer(userAnswer)
            );
          }

          const answerId = `sa_${student.id.substring(0, 10)}_${q.id.substring(0, 10)}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          await connection.query(
            `INSERT INTO student_answers (id, student_id, question_id, answer, is_correct, points_change, source, test_id, test_record_id, created_at) 
             VALUES (?, ?, ?, ?, ?, 0, 'exam', ?, ?, NOW())`,
            [answerId, student.id, q.id, userAnswer, isCorrect ? 1 : 0, test_id, existingRecord.id]
          );

          if (!isCorrect) {
            const [existingWrongs] = await connection.query(
              'SELECT * FROM wrong_questions WHERE student_id = ? AND question_id = ?',
              [student.id, q.id]
            );
            if (existingWrongs.length > 0) {
              await connection.query(
                'UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_at = NOW() WHERE id = ?',
                [existingWrongs[0].id]
              );
            } else {
              const wrongId = `wq_${student.id.substring(0, 10)}_${q.id.substring(0, 10)}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
              await connection.query(
                'INSERT INTO wrong_questions (id, student_id, question_id, wrong_count, last_wrong_at, created_at) VALUES (?, ?, ?, 1, NOW(), NOW())',
                [wrongId, student.id, q.id]
              );
            }
          }
        }

        // 处理积分
        if (pointsEarned > 0) {
          const [students] = await connection.query(
            'SELECT * FROM profiles WHERE id = ? FOR UPDATE',
            [student.id]
          );
          if (students.length > 0) {
            await connection.query(
              'UPDATE profiles SET current_points = current_points + ?, total_points_earned = total_points_earned + ? WHERE id = ?',
              [pointsEarned, pointsEarned, student.id]
            );
            await connection.query(
              `INSERT INTO point_transactions (student_id, amount, reason, source_type, created_at) 
               VALUES (?, ?, ?, 'system', NOW())`,
              [student.id, pointsEarned, `考试通过（强行提交）: ${test.title}`]
            );
          }
        }

        // 装备掉落（考试及格，掉率为练习时10倍）
        if (isPassed && test.allow_equipment_drop) {
          const [activeEquipments] = await connection.query(
            'SELECT id, name, icon, drop_rate, crit_bonus FROM equipments WHERE is_active = true'
          );
          for (const eq of activeEquipments) {
            if (Math.random() * 100 < parseFloat(eq.drop_rate) * 10) {
              await connection.query(
                `INSERT INTO student_equipments (id, student_id, equipment_id, quantity) 
                 VALUES (?, ?, ?, 1) 
                 ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
                [`se_${Date.now()}_${Math.random().toString(36).substr(2,9)}`, student.id, eq.id]
              );
            }
          }
        }

        forcedSubmitCount++;
        continue;
      }

      // 6.3 未参加考试的学生：创建 0 分记录
      if (!existingRecord) {
        const recordId = `rec_${test_id.substring(0, 10)}_${student.id.substring(0, 10)}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        await connection.query(
          `INSERT INTO exam_records (id, test_id, student_id, selected_question_ids, score, correct_count, total_count, points_earned, internet_codes_earned, is_passed, started_at, completed_at)
           VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, NOW(), NOW())`,
          [recordId, test_id, student.id, JSON.stringify(questionIds), totalCount]
        );
        noAttendCount++;
      }
    }

    // 7. 更新考试状态为已结束
    await connection.query(
      'UPDATE tests SET is_active = false WHERE id = ?',
      [test_id]
    );

    await connection.commit();

    res.json({
      data: {
        success: true,
        total_students: allStudents.length,
        forced_submit_count: forcedSubmitCount,
        no_attend_count: noAttendCount
      },
      error: null
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in close-exam:', error);
    res.status(500).json({ data: null, error: error.message });
  } finally {
    connection.release();
  }
});

// ============== 业务API：检查考试是否已结束（学生端）==============
app.get('/api/business/exam-is-closed/:testId', authenticate, async (req, res) => {
  try {
    const { testId } = req.params;

    const [rows] = await pool.query(
      'SELECT is_active FROM tests WHERE id = ? AND type = "exam"',
      [testId]
    );

    if (rows.length === 0) {
      return res.json({ data: { isClosed: true }, error: null });
    }

    res.json({ data: { isClosed: !rows[0].is_active }, error: null });
  } catch (error) {
    console.error('Error in exam-is-closed:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/auth/refresh-session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ data: null, error: 'Unauthorized' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const validation = await secureAuth.validateToken(token);
    
    if (!validation.valid) {
      return res.status(401).json({ data: null, error: validation.error });
    }
    
    const newTokenResult = secureAuth.generateToken();
    const sessionId = validation.session.id;
    const userId = validation.session.userId;
    
    const [settings] = await pool.query(
      'SELECT session_timeout_hours FROM security_settings WHERE id = 1'
    );
    const timeoutHours = settings[0]?.session_timeout_hours || 24;
    const expiresAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);
    
    await pool.query(`
      UPDATE login_sessions 
      SET token = ?, expires_at = ?, last_active_at = NOW()
      WHERE id = ?
    `, [newTokenResult.hash, expiresAt, sessionId]);
    
    res.json({
      data: {
        access_token: newTokenResult.raw,
        expiresAt: expiresAt
      },
      error: null
    });
  } catch (error) {
    console.error('Error in POST /api/auth/refresh-session:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/import', authenticate, async (req, res) => {
  try {
    const data = req.body;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query('USE xgpy');

      const tableOrder = [
        'classes', 'profiles', 'knowledge_points', 'questions',
        'student_answers', 'wrong_questions', 'tests', 'test_records',
        'notes', 'pets', 'student_pets', 'pet_foods', 'pet_tips',
        'prizes', 'internet_codes', 'exchange_records', 'system_config',
        'prize_class_visibility', 'code_snippets', 'user_roles', 'pet_config',
        'apps', 'app_visibility', 'student_app_usage', 'app_usage_logs', 'app_reviews',
        'login_history', 'login_sessions', 'notifications',
        'notification_recipients', 'point_transactions',
        'ai_qa_history', 'python_magic_progress', 'backup_records',
        'word_list', 'student_word_progress',
      ];

      const summary = {};
      let errorCount = 0;
      let errorMessages = [];

      for (const tableName of tableOrder) {
        if (data[tableName] && Array.isArray(data[tableName])) {
          const rows = data[tableName];
          if (rows.length === 0) {
            summary[tableName] = { skipped: true, reason: 'no_data' };
            continue;
          }

          await connection.query(`DELETE FROM ${tableName}`);

          let inserted = 0;
          for (const row of rows) {
            const processedRow = { ...row };

            const columns = Object.keys(processedRow);
            if (columns.length === 0) continue;

            const values = columns.map(col => {
              const v = processedRow[col];
              if (v === null || v === undefined) return null;
              if (typeof v === 'object') return JSON.stringify(v);
              return v;
            });
            const placeholders = columns.map(() => '?').join(', ');

            try {
              await connection.query(
                `INSERT INTO ${tableName} (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
                values
              );
              inserted++;
            } catch (err) {
              errorCount++;
              errorMessages.push(`${tableName}: ${err.message}`);
            }
          }
          summary[tableName] = { total: rows.length, inserted };
        }
      }

      await connection.query(`
        INSERT INTO system_config (id, config_key, value, updated_at)
        VALUES ('import_marker', 'last_import_date', ?, NOW())
        ON DUPLICATE KEY UPDATE value = ?, updated_at = NOW()
      `, [JSON.stringify({ value: new Date().toISOString() }), JSON.stringify({ value: new Date().toISOString() })]);

      await connection.commit();
      connection.release();
      res.json({
        data: {
          success: true,
          summary,
          errorCount,
          errors: errorMessages.slice(0, 20)
        },
        error: null
      });
    } catch (error) {
      try { await connection.rollback(); } catch (r) { /* ignore */ }
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('Error in POST /api/import:', error);
    res.status(500).json({ data: { success: false }, error: error.message });
  }
});

// ===== 系统授权接口 =====
const crypto = require('crypto');
const { exec } = require('child_process');

function execPromise(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 3000 }, (err, stdout) => {
      if (err) { resolve(''); return; }
      resolve(stdout.trim());
    });
  });
}

// 获取机器码
app.get('/api/license/machine-code', async (req, res) => {
  try {
    const [cpuId, biosSerial, macAddr, diskSerial] = await Promise.all([
      execPromise('wmic cpu get processorid /value'),
      execPromise('wmic bios get serialnumber /value'),
      execPromise('wmic nic where "NetEnabled=true" get MACAddress /value'),
      execPromise('wmic diskdrive get serialnumber /value'),
    ]);

    const cpu = (cpuId.match(/ProcessorId=(.+)/i) || [])[1] || 'UNKNOWN_CPU';
    const bios = (biosSerial.match(/SerialNumber=(.+)/i) || [])[1] || 'UNKNOWN_BIOS';
    const mac = (macAddr.match(/MACAddress=(.+)/i) || [])[1] || 'UNKNOWN_MAC';
    const disk = (diskSerial.match(/SerialNumber=(.+)/i) || [])[1] || 'UNKNOWN_DISK';

    const raw = `${cpu.trim()}|${bios.trim()}|${mac.trim()}|${disk.trim()}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
    const machineCode = licenseManager.formatCode(hash);

    await pool.query(
      'INSERT INTO system_license (id, machine_code) VALUES (1, ?) ON DUPLICATE KEY UPDATE machine_code = ?',
      [machineCode, machineCode]
    );

    res.json({ data: { machineCode, raw }, error: null });
  } catch (error) {
    console.error('获取机器码失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 激活系统
app.post('/api/license/activate', authenticate, async (req, res) => {
  try {
    const { licenseCode } = req.body;
    const result = await licenseManager.activateLicense(licenseCode);
    
    if (!result.success) {
      return res.status(400).json({ data: null, error: result.error });
    }
    
    res.json({ 
      data: { 
        success: true, 
        message: result.message,
        newExpiresAt: result.newExpiresAt,
        status: result.status
      }, 
      error: null 
    });
  } catch (error) {
    console.error('激活失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 查询授权状态
app.get('/api/license/status', async (req, res) => {
  try {
    const status = await licenseManager.getLicenseStatus();
    res.json({ data: status, error: null });
  } catch (error) {
    console.error('查询授权状态失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 根据机器码生成授权码（仅超级管理员）
app.post('/api/license/generate', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ data: null, error: '仅超级管理员可执行此操作' });
    }

    const { machineCode, months } = req.body;
    if (!machineCode) {
      return res.status(400).json({ data: null, error: '请输入机器码' });
    }

    const licenseCode = licenseManager.generateLicenseCode(machineCode, months || undefined);
    res.json({ data: { licenseCode }, error: null });
  } catch (error) {
    console.error('生成授权码失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/leaderboard', async (req, res) => {
  try {
    const { filterType, classId } = req.body;
    
    // 使用子查询确保每个学生只有一行
    let query = `
      SELECT 
        p.id as student_id,
        p.username,
        p.real_name,
        p.class_id,
        p.current_points,
        p.max_points,
        p.total_points_earned,
        p.perfect_10_times,
        c.name as class_name,
        COALESCE(pet_stats.growth_level, 1) as pet_level,
        COALESCE(pet_stats.growth_value, 0) as pet_growth,
        COALESCE(answer_stats.total_answers, 0) as total_answers,
        COALESCE(answer_stats.correct_answers, 0) as correct_answers,
        COALESCE(answer_stats.accuracy, 0) as accuracy
      FROM profiles p
      LEFT JOIN classes c ON p.class_id = c.id
      -- 子查询获取每个学生的答题统计
      LEFT JOIN (
        SELECT 
          student_id,
          COUNT(id) as total_answers,
          SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_answers,
          ROUND(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(id), 0), 1) as accuracy
        FROM student_answers
        GROUP BY student_id
      ) answer_stats ON p.id = answer_stats.student_id
      -- 子查询获取每个学生的萌宠数据（取最高成长值的那条）
      LEFT JOIN (
        SELECT 
          sp.student_id,
          sp.growth_level,
          sp.growth_value
        FROM student_pets sp
        INNER JOIN (
          SELECT student_id, MAX(growth_value) as max_growth
          FROM student_pets
          GROUP BY student_id
        ) max_pet ON sp.student_id = max_pet.student_id AND sp.growth_value = max_pet.max_growth
      ) pet_stats ON p.id = pet_stats.student_id
      WHERE p.role = 'student'
    `;
    
    const params = [];
    
    if (filterType === 'class' && classId) {
      query += ' AND p.class_id = ?';
      params.push(classId);
    }
    
    // 不再需要对 student_pets 字段 GROUP BY，因为每个学生只有一行
    query += ' GROUP BY p.id, p.username, p.real_name, p.class_id, p.current_points, p.max_points, p.total_points_earned, p.perfect_10_times, c.name, pet_stats.growth_level, pet_stats.growth_value, answer_stats.total_answers, answer_stats.correct_answers, answer_stats.accuracy';
    
    // 无论哪种排序方式，都添加稳定的次要排序键（学生ID）
    if (filterType === 'points') {
      query += ' ORDER BY p.current_points DESC, p.id ASC';
    } else if (filterType === 'accuracy') {
      query += ' ORDER BY accuracy DESC, p.id ASC';
    } else if (filterType === 'answers') {
      query += ' ORDER BY total_answers DESC, p.id ASC';
    } else {
      query += ' ORDER BY p.current_points DESC, p.id ASC';
    }
    
    query += ' LIMIT 100';
    
    const [rows] = await pool.query(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error in POST /api/leaderboard:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 更新教师密码的API
app.put('/api/teachers/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    
    if (!password || password.length < 6) {
      return res.status(400).json({ data: null, error: 'Password must be at least 6 characters' });
    }
    
    const crypto = require('crypto');
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    
    const [result] = await pool.query(
      'UPDATE profiles SET password_hash = ? WHERE id = ? AND role = ?',
      [passwordHash, id, 'teacher']
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ data: null, error: 'Teacher not found' });
    }
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error updating teacher password:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 添加新教师账号的API
app.post('/api/teachers', async (req, res) => {
  try {
    const { username, password, real_name } = req.body;
    
    if (!username || !password || !real_name) {
      return res.status(400).json({ data: null, error: 'Missing required fields' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ data: null, error: 'Password must be at least 6 characters' });
    }
    
    const [existing] = await pool.query('SELECT id FROM profiles WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ data: null, error: 'Username already exists' });
    }
    
    const crypto = require('crypto');
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    
    await pool.query(
      'INSERT INTO profiles (id, username, password_hash, real_name, role, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [id, username, passwordHash, real_name, 'teacher']
    );
    
    res.json({ data: { id, username, real_name }, error: null });
  } catch (error) {
    console.error('Error adding teacher:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 更新教师信息的API
app.put('/api/teachers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, real_name } = req.body;
    
    if (!username || !real_name) {
      return res.status(400).json({ data: null, error: 'Missing required fields' });
    }
    
    const [existing] = await pool.query(
      'SELECT id FROM profiles WHERE username = ? AND id != ? AND role = ?',
      [username, id, 'teacher']
    );
    if (existing.length > 0) {
      return res.status(400).json({ data: null, error: 'Username already exists' });
    }
    
    const [result] = await pool.query(
      'UPDATE profiles SET username = ?, real_name = ? WHERE id = ? AND role = ?',
      [username, real_name, id, 'teacher']
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ data: null, error: 'Teacher not found' });
    }
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 通知系统 API ====================

// 获取学生的通知列表
app.get('/api/notifications/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { unread_only } = req.query;

    let query = `
      SELECT 
        n.*,
        nr.is_read,
        nr.read_at,
        nr.point_change,
        nr.point_change_reason,
        t.real_name as teacher_name,
        CASE 
          WHEN n.notification_type = 'all' THEN '全体学生'
          WHEN n.notification_type = 'class' THEN c.name
          ELSE '指定学生'
        END as target_name
      FROM notifications n
      LEFT JOIN notification_recipients nr ON n.id = nr.notification_id AND nr.student_id = ?
      LEFT JOIN profiles t ON n.teacher_id = t.id
      LEFT JOIN classes c ON n.target_class_id = c.id
      WHERE n.published_at IS NOT NULL
        AND (n.notification_type = 'all' OR nr.student_id IS NOT NULL)
    `;

    const params = [studentId];

    if (unread_only === 'true') {
      query += ' AND (nr.is_read = FALSE OR nr.is_read IS NULL)';
    }

    query += ' ORDER BY n.published_at DESC LIMIT 100';

    const [rows] = await pool.query(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error getting student notifications:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 获取学生的未读通知数量
app.get('/api/notifications/student/:studentId/unread-count', async (req, res) => {
  try {
    const { studentId } = req.params;

    const [rows] = await pool.query(`
      SELECT COUNT(*) as count
      FROM notifications n
      LEFT JOIN notification_recipients nr ON n.id = nr.notification_id AND nr.student_id = ?
      WHERE n.published_at IS NOT NULL
        AND (n.notification_type = 'all' OR nr.student_id IS NOT NULL)
        AND (nr.is_read = FALSE OR nr.is_read IS NULL)
    `, [studentId]);

    res.json({ data: { count: rows[0].count }, error: null });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ data: { count: 0 }, error: error.message });
  }
});

// 标记通知为已读
app.put('/api/notifications/recipient/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({ data: null, error: 'studentId is required' });
    }

    await pool.query(`
      UPDATE notification_recipients 
      SET is_read = TRUE, read_at = NOW()
      WHERE notification_id = ? AND student_id = ?
    `, [notificationId, studentId]);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 标记所有通知为已读
app.put('/api/notifications/student/:studentId/read-all', async (req, res) => {
  try {
    const { studentId } = req.params;

    await pool.query(`
      UPDATE notification_recipients 
      SET is_read = TRUE, read_at = NOW()
      WHERE student_id = ? AND (is_read = FALSE OR is_read IS NULL)
    `, [studentId]);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取教师的通知列表（只能获取自己创建的）
app.get('/api/notifications/teacher/:teacherId', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { status } = req.query;

    let query = `
      SELECT 
        n.*,
        t.real_name as teacher_name,
        c.name as class_name,
        (SELECT COUNT(*) FROM notification_recipients WHERE notification_id = n.id) as total_recipients,
        (SELECT COUNT(*) FROM notification_recipients WHERE notification_id = n.id AND is_read = TRUE) as read_count
      FROM notifications n
      LEFT JOIN profiles t ON n.teacher_id = t.id
      LEFT JOIN classes c ON n.target_class_id = c.id
      WHERE n.teacher_id = ?
    `;

    const params = [teacherId];

    if (status === 'scheduled') {
      query += ' AND n.scheduled_at IS NOT NULL AND n.published_at IS NULL';
    } else if (status === 'published') {
      query += ' AND n.published_at IS NOT NULL';
    } else if (status === 'draft') {
      query += ' AND n.scheduled_at IS NULL AND n.published_at IS NULL';
    }

    query += ' ORDER BY n.created_at DESC';

    const [rows] = await pool.query(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error getting teacher notifications:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 获取通知详情和统计
app.get('/api/notifications/:id/statistics', async (req, res) => {
  try {
    console.log('=== GET /api/notifications/:id/statistics ===');
    console.log('Params:', req.params);
    console.log('Query:', req.query);
    
    const { id } = req.params;
    const { teacher_id } = req.query;

    console.log('Checking notification:', id, 'for teacher:', teacher_id);
    
    // 首先检查权限
    const [notification] = await pool.query(
      'SELECT * FROM notifications WHERE id = ? AND teacher_id = ?',
      [id, teacher_id]
    );

    console.log('Notification found:', notification.length > 0);
    
    if (notification.length === 0) {
      console.log('Returning 403 - no notification found');
      return res.status(403).json({ data: null, error: '无权查看此通知或通知不存在' });
    }

    const [recipients] = await pool.query(`
      SELECT 
        nr.*,
        p.username,
        p.real_name,
        p.class_id,
        c.name as class_name
      FROM notification_recipients nr
      LEFT JOIN profiles p ON nr.student_id = p.id
      LEFT JOIN classes c ON p.class_id = c.id
      WHERE nr.notification_id = ?
      ORDER BY nr.is_read ASC, nr.created_at DESC
    `, [id]);

    const readCount = recipients.filter(r => r.is_read).length;
    const unreadCount = recipients.filter(r => !r.is_read).length;

    res.json({
      data: {
        total_recipients: recipients.length,
        read_count: readCount,
        unread_count: unreadCount,
        read_rate: recipients.length > 0 ? Math.round(readCount / recipients.length * 100) : 0,
        recipients: recipients
      },
      error: null
    });
  } catch (error) {
    console.error('Error getting notification statistics:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 创建通知
app.post('/api/notifications', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      teacher_id,
      title,
      content,
      notification_type,
      target_class_id,
      target_student_ids,
      has_point_reward,
      point_reward_amount,
      point_reward_reason,
      has_point_penalty,
      point_penalty_amount,
      point_penalty_reason,
      enable_app_access,
      can_open_exchange_module,
      enable_focus_mode,
      has_buff,
      buff_type,
      buff_modifier,
      buff_duration,
      scheduled_at
    } = req.body;

    if (!teacher_id || !title || !content) {
      return res.status(400).json({ data: null, error: '缺少必填字段' });
    }

    // 处理内容中的积分信息
    let finalContent = content;
    if (has_point_reward && point_reward_amount > 0) {
      finalContent += `\n\n🎁 积分奖励：+${point_reward_amount} 分\n原因：${point_reward_reason}`;
    }
    if (has_point_penalty && point_penalty_amount > 0) {
      finalContent += `\n\n⚠️ 积分扣除：-${point_penalty_amount} 分\n原因：${point_penalty_reason}`;
    }
    
    // 添加积分兑换模块和应用访问控制提示
    if (can_open_exchange_module !== undefined) {
      finalContent += `\n\n📶 积分兑换模块：${can_open_exchange_module ? '✅ 允许打开' : '❌ 禁止打开'}`;
    }
    if (enable_app_access !== undefined) {
      finalContent += `\n📱 应用访问：${enable_app_access ? '✅ 允许' : '❌ 禁止'}`;
    }
    
    // 添加Buff提示
    if (has_buff && buff_modifier && buff_duration) {
      const buffDesc = buff_modifier > 0 ? `⚡ 暴击率 +${buff_modifier}%` : `⚡ 暴击率 ${buff_modifier}%`;
      finalContent += `\n${buffDesc} (持续${buff_duration}分钟)`;
    }

    // 插入通知记录
    const [notificationResult] = await connection.query(`
      INSERT INTO notifications (
        teacher_id, title, content, notification_type, target_class_id, 
        target_student_ids, has_point_reward, point_reward_amount, point_reward_reason,
        has_point_penalty, point_penalty_amount, point_penalty_reason,
        can_open_exchange_module, enable_app_access, enable_focus_mode, 
        has_buff, buff_type, buff_modifier, buff_duration,
        scheduled_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      teacher_id,
      title,
      finalContent,
      notification_type || 'all',
      target_class_id || null,
      JSON.stringify(target_student_ids || []),
      has_point_reward || false,
      point_reward_amount || 0,
      point_reward_reason || '',
      has_point_penalty || false,
      point_penalty_amount || 0,
      point_penalty_reason || '',
      can_open_exchange_module !== false,
      enable_app_access !== false,
      enable_focus_mode !== false,
      has_buff || false,
      buff_type || 'teacher_crit',
      buff_modifier || null,
      buff_duration || null,
      scheduled_at || null,
      scheduled_at ? null : new Date()
    ]);

    const notificationId = notificationResult.insertId;

    // 如果是立即发布，处理接收者和积分
    if (!scheduled_at) {
      await processNotificationDelivery(connection, notificationId, {
        notification_type,
        target_class_id,
        target_student_ids,
        has_point_reward,
        point_reward_amount,
        point_reward_reason,
        has_point_penalty,
        point_penalty_amount,
        point_penalty_reason,
        can_open_exchange_module,
        enable_app_access,
        enable_focus_mode,
        has_buff,
        buff_type,
        buff_modifier,
        buff_duration,
        teacher_id
      });
    }

    await connection.commit();
    res.json({ 
      data: { 
        id: notificationId, 
        success: true,
        message: scheduled_at ? '通知已保存，将在指定时间发布' : '通知已发布'
      }, 
      error: null 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating notification:', error);
    res.status(500).json({ data: null, error: error.message });
  } finally {
    connection.release();
  }
});

// 处理通知分发和积分
async function processNotificationDelivery(connection, notificationId, options) {
  const {
    notification_type,
    target_class_id,
    target_student_ids,
    has_point_reward,
    point_reward_amount,
    point_reward_reason,
    has_point_penalty,
    point_penalty_amount,
    point_penalty_reason,
    can_open_exchange_module,
    enable_app_access,
    has_buff,
    buff_type,
    buff_modifier,
    buff_duration,
    teacher_id
  } = options;

  let students = [];

  if (notification_type === 'class' && target_class_id) {
    const [rows] = await connection.query('SELECT id FROM profiles WHERE class_id = ? AND role = ?', [target_class_id, 'student']);
    students = rows;
  } else if (notification_type === 'student' && target_student_ids && target_student_ids.length > 0) {
    students = target_student_ids.map(id => ({ id }));
  } else {
    throw new Error('请选择发送对象');
  }

  for (const student of students) {
    const studentId = student.id;
    let pointChange = 0;
    let pointChangeReason = '';

    if (has_point_reward && point_reward_amount > 0) {
      pointChange = point_reward_amount;
      pointChangeReason = point_reward_reason;
    } else if (has_point_penalty && point_penalty_amount > 0) {
      pointChange = -point_penalty_amount;
      pointChangeReason = point_penalty_reason;
    }

    // 插入接收者记录
    await connection.query(`
      INSERT INTO notification_recipients (
        notification_id, student_id, point_change, point_change_reason
      ) VALUES (?, ?, ?, ?)
    `, [notificationId, studentId, pointChange, pointChangeReason]);

    // 如果有积分变动，更新学生积分
    if (pointChange !== 0) {
      // 更新 profiles 表的积分
      await connection.query(`
        UPDATE profiles 
        SET current_points = GREATEST(0, current_points + ?)
        WHERE id = ?
      `, [pointChange, studentId]);

      // 记录积分变动历史
      await connection.query(`
        INSERT INTO point_transactions (
          student_id, amount, reason, source_type, source_id, teacher_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [studentId, pointChange, pointChangeReason, 'notification', notificationId, teacher_id]);
    }

    // 如果设置了兑换码或应用访问权限，更新对应学生配置
    if (can_open_exchange_module !== undefined || enable_app_access !== undefined) {
      let updateFields = [];
      let updateParams = [];

      if (can_open_exchange_module !== undefined) {
        updateFields.push('can_open_exchange_module = ?');
        updateParams.push(can_open_exchange_module);
      }
      if (enable_app_access !== undefined) {
        updateFields.push('can_use_app = ?');
        updateParams.push(enable_app_access);
      }
      updateParams.push(studentId);

      await connection.query(`
        UPDATE profiles 
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `, updateParams);
    }

    // 如果有buff，给学生发放buff
    if (has_buff && buff_modifier && buff_duration) {
      const buffId = `buff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await connection.query(`
        INSERT INTO student_buffs (id, student_id, buff_type, crit_modifier, expires_at, created_at)
        VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())
      `, [buffId, studentId, buff_type || 'teacher_crit', buff_modifier, buff_duration]);
    }
  }
}

// 更新通知
app.put('/api/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { teacher_id, ...updateData } = req.body;

    // 检查权限
    const [notification] = await pool.query(
      'SELECT * FROM notifications WHERE id = ? AND teacher_id = ?',
      [id, teacher_id]
    );

    if (notification.length === 0) {
      return res.status(403).json({ data: null, error: '无权修改此通知或通知不存在' });
    }

    // 如果已发布，不允许修改
    if (notification[0].published_at) {
      return res.status(400).json({ data: null, error: '已发布的通知无法修改' });
    }

    const allowedFields = [
      'title', 'content', 'notification_type', 'target_class_id', 
      'target_student_ids', 'has_point_reward', 'point_reward_amount', 
      'point_reward_reason', 'has_point_penalty', 'point_penalty_amount', 
      'point_penalty_reason', 'scheduled_at'
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (updateData[key] !== undefined) {
        updates[key] = key === 'target_student_ids' ? JSON.stringify(updateData[key]) : updateData[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ data: null, error: '没有要更新的字段' });
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    await pool.query(`UPDATE notifications SET ${setClause} WHERE id = ?`, values);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error updating notification:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 删除通知
app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { teacher_id } = req.body;

    // 检查权限
    const [notification] = await pool.query(
      'SELECT * FROM notifications WHERE id = ? AND teacher_id = ?',
      [id, teacher_id]
    );

    if (notification.length === 0) {
      return res.status(403).json({ data: null, error: '无权删除此通知或通知不存在' });
    }

    // 删除通知（会级联删除接收者记录）
    await pool.query('DELETE FROM notifications WHERE id = ?', [id]);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取班级的学生列表
app.get('/api/classes/:classId/students', async (req, res) => {
  try {
    const { classId } = req.params;

    const [students] = await pool.query(`
      SELECT id, username, real_name, current_points 
      FROM profiles 
      WHERE class_id = ? AND role = 'student'
      ORDER BY real_name ASC
    `, [classId]);

    res.json({ data: students, error: null });
  } catch (error) {
    console.error('Error getting class students:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 清理过期和不活跃的会话
async function cleanupStaleSessions() {
  try {
    // 定义清理阈值
    const INACTIVE_THRESHOLD_MINUTES = 60; // 1小时不活跃
    const EXPIRED_THRESHOLD_HOURS = 1; // 已过期超过1小时
    
    // 标记不活跃的会话为非活动状态
    const [updateResult] = await pool.query(`
      UPDATE login_sessions 
      SET is_active = FALSE 
      WHERE is_active = TRUE 
      AND last_active_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
    `, [INACTIVE_THRESHOLD_MINUTES]);
    
    if (updateResult.affectedRows > 0) {
      console.log(`已标记 ${updateResult.affectedRows} 个不活跃会话为离线状态`);
    }
    
    // 彻底删除已过期较长时间的会话
    const [deleteResult] = await pool.query(`
      DELETE FROM login_sessions 
      WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [EXPIRED_THRESHOLD_HOURS]);
    
    if (deleteResult.affectedRows > 0) {
      console.log(`已清理 ${deleteResult.affectedRows} 个过期会话`);
    }
  } catch (error) {
    console.error('Error cleaning up stale sessions:', error);
  }
}

// 检查并发布定时通知
async function checkAndPublishScheduledNotifications() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [scheduledNotifications] = await connection.query(`
      SELECT * FROM notifications 
      WHERE scheduled_at IS NOT NULL 
        AND published_at IS NULL 
        AND scheduled_at <= NOW()
    `);

    if (scheduledNotifications.length > 0) {
      console.log(`=== 发现 ${scheduledNotifications.length} 个待发布的定时通知 ===`);
    }

    for (const notification of scheduledNotifications) {
      console.log(`发布通知: ${notification.id} - ${notification.title}`);
      
      // 更新发布时间
      await connection.query(
        'UPDATE notifications SET published_at = NOW() WHERE id = ?',
        [notification.id]
      );

      console.log(`  can_open_exchange_module=${notification.can_open_exchange_module} (type=${typeof notification.can_open_exchange_module})`);
      console.log(`  enable_app_access=${notification.enable_app_access} (type=${typeof notification.enable_app_access})`);

      // 处理分发和积分
      await processNotificationDelivery(connection, notification.id, {
        notification_type: notification.notification_type,
        target_class_id: notification.target_class_id,
        target_student_ids: notification.target_student_ids ? JSON.parse(notification.target_student_ids) : [],
        has_point_reward: notification.has_point_reward,
        point_reward_amount: notification.point_reward_amount,
        point_reward_reason: notification.point_reward_reason,
        has_point_penalty: notification.has_point_penalty,
        point_penalty_amount: notification.point_penalty_amount,
        point_penalty_reason: notification.point_penalty_reason,
        can_open_exchange_module: notification.can_open_exchange_module,
        enable_app_access: notification.enable_app_access,
        enable_focus_mode: notification.enable_focus_mode,
        has_buff: notification.has_buff,
        buff_type: notification.buff_type,
        buff_modifier: notification.buff_modifier,
        buff_duration: notification.buff_duration,
        teacher_id: notification.teacher_id
      });
    }

    await connection.commit();
    connection.release();

    return { published_count: scheduledNotifications.length };
  } catch (error) {
    console.error('Error checking scheduled notifications:', error);
    if (connection) {
      try { await connection.rollback(); } catch (e) {}
      connection.release();
    }
    return { error: error.message };
  }
}

// 定时发布检查（手动调用 API）
app.get('/api/notifications/check-scheduled', async (req, res) => {
  const result = await checkAndPublishScheduledNotifications();
  if (result.error) {
    res.status(500).json({ data: null, error: result.error });
  } else {
    res.json({ data: { published_count: result.published_count }, error: null });
  }
});

// 获取学生当前Buff列表
app.get('/api/student-buffs/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const [buffs] = await pool.query(`
      SELECT id, buff_type, crit_modifier, expires_at, created_at
      FROM student_buffs
      WHERE student_id = ? AND expires_at > NOW()
      ORDER BY expires_at ASC
    `, [studentId]);
    
    res.json({ data: buffs, error: null });
  } catch (error) {
    console.error('Error fetching student buffs:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== Python 编程模块 API ====================

// === 学生端 API ===

// 获取编程任务列表
app.get('/api/python/tasks', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const userId = user.userId || user.user_id;
    const [userProfile] = await pool.query('SELECT class_id, role FROM profiles WHERE id = ?', [userId]);
    const profile = userProfile[0];

    let query = `
      SELECT t.*,
      s.status as submission_status,
      s.id as submission_id,
      g.total_score as grade_score
      FROM python_tasks t
      LEFT JOIN python_submissions s ON t.id = s.task_id AND s.student_id = ?
      LEFT JOIN python_gradings g ON s.id = g.submission_id
      WHERE t.is_active = TRUE
    `;
    const params = [userId];

    // 如果学生有班级，只显示对应班级的任务或无班级限制的任务
    if (profile && profile.role === 'student' && profile.class_id) {
      query += ` AND (
        JSON_CONTAINS(t.class_ids, ?) OR t.class_ids IS NULL OR JSON_LENGTH(t.class_ids) = 0
      )`;
      params.push(JSON.stringify(profile.class_id));
    }

    query += ' ORDER BY t.created_at DESC';

    const [rows] = await pool.query(query, params);
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/python/tasks:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 获取单个编程任务详情
app.get('/api/python/tasks/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const [rows] = await pool.query('SELECT * FROM python_tasks WHERE id = ?', [taskId]);
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: 'Task not found' });
    }
    res.json({ data: formatRow(rows[0]), error: null });
  } catch (error) {
    console.error('Error in GET /api/python/tasks/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 运行Python代码
app.post('/api/python/run', authenticate, async (req, res) => {
  try {
    const { code, input } = req.body;
    const user = req.user;
    const userId = user.userId || user.user_id;

    console.log('=== POST /api/python/run ===');
    console.log('User ID:', userId);
    console.log('Code length:', code?.length);

    if (!code) {
      return res.status(400).json({ data: null, error: 'Code is required' });
    }

    const result = await pythonSandbox.executeCode(code, input || '');
    console.log('Execution result:', result);

    // 记录运行日志
    const logId = uuidv4();
    await pool.query(
      `INSERT INTO python_run_logs 
      (id, student_id, code, input_data, actual_output, error_output, 
      execution_time_ms, status, run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        logId,
        userId,
        code.substring(0, 5000),
        input,
        result.output,
        result.error,
        result.execution_time_ms,
        result.status
      ]
    );

    res.json({
      data: {
        success: result.success,
        output: result.output,
        error: result.error,
        status: result.status,
        execution_time_ms: result.execution_time_ms
      },
      error: null
    });
  } catch (error) {
    console.error('Error in POST /api/python/run:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 保存草稿
app.post('/api/python/drafts', authenticate, async (req, res) => {
  try {
    const { title, code, task_id } = req.body;
    const user = req.user;
    const userId = user.userId || user.user_id;

    const id = uuidv4();
    await pool.query(
      `INSERT INTO python_drafts (id, student_id, title, code, task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, userId, title || '未命名草稿', code, task_id || null]
    );

    const [newDraft] = await pool.query('SELECT * FROM python_drafts WHERE id = ?', [id]);
    res.json({ data: formatRow(newDraft[0]), error: null });
  } catch (error) {
    console.error('Error in POST /api/python/drafts:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取草稿列表
app.get('/api/python/drafts', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const userId = user.userId || user.user_id;
    const [rows] = await pool.query(
      'SELECT * FROM python_drafts WHERE student_id = ? ORDER BY updated_at DESC',
      [userId]
    );
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/python/drafts:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 更新草稿
app.put('/api/python/drafts/:draftId', authenticate, async (req, res) => {
  try {
    const { draftId } = req.params;
    const { title, code } = req.body;

    await pool.query(
      'UPDATE python_drafts SET title = ?, code = ?, updated_at = NOW() WHERE id = ?',
      [title, code, draftId]
    );

    const [updated] = await pool.query('SELECT * FROM python_drafts WHERE id = ?', [draftId]);
    res.json({ data: formatRow(updated[0]), error: null });
  } catch (error) {
    console.error('Error in PUT /api/python/drafts/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 删除草稿
app.delete('/api/python/drafts/:draftId', authenticate, async (req, res) => {
  try {
    const { draftId } = req.params;
    await pool.query('DELETE FROM python_drafts WHERE id = ?', [draftId]);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in DELETE /api/python/drafts/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 提交作业
app.post('/api/python/submit', authenticate, async (req, res) => {
  try {
    const { task_id, code } = req.body;
    const user = req.user;
    const userId = user.userId || user.user_id;

    // 检查任务是否存在且允许提交
    const [tasks] = await pool.query('SELECT * FROM python_tasks WHERE id = ?', [task_id]);
    if (tasks.length === 0) {
      return res.status(404).json({ data: null, error: 'Task not found' });
    }
    const task = tasks[0];

    // 检查是否已过截止时间
    if (task.deadline) {
      const now = new Date();
      const deadline = new Date(task.deadline);
      if (now > deadline && !task.allow_late_submission === 0) {
        return res.status(400).json({ data: null, error: '已过截止时间，无法提交' });
      }
    }

    const isLate = task.deadline ? (new Date() > new Date(task.deadline)) : false;
    let submissionId;

    if (req.body.id) {
      // 更新已有的提交
      submissionId = req.body.id;
      await pool.query(
        'UPDATE python_submissions SET code = ?, submitted_at = NOW(), is_late = ?, status = ? WHERE id = ?',
        [code, isLate, 'submitted', submissionId]
      );
    } else {
      // 检查是否已提交过
      const [existing] = await pool.query(
        'SELECT * FROM python_submissions WHERE task_id = ? AND student_id = ?',
        [task_id, userId]
      );

      if (existing.length > 0) {
        submissionId = existing[0].id;
        await pool.query(
          'UPDATE python_submissions SET code = ?, submitted_at = NOW(), is_late = ?, status = ? WHERE id = ?',
          [code, isLate, 'submitted', submissionId]
        );
        // 删除旧的批改记录，以便重新批改
        await pool.query('DELETE FROM python_gradings WHERE submission_id = ?', [submissionId]);
      } else {
        // 新建提交
        submissionId = uuidv4();
        await pool.query(
          `INSERT INTO python_submissions (id, task_id, student_id, code, submitted_at, is_late, status)
          VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
          [submissionId, task_id, userId, code, isLate, 'submitted']
        );
      }
    }

    // 重新查询最新的提交记录
    const [submissions] = await pool.query('SELECT * FROM python_submissions WHERE id = ?', [submissionId]);
    const submission = formatRow(submissions[0]);

    // 自动评分：填空题始终评分，编程题需要AI配置
    let pointReward = 0;
    try {
      const formattedTask = formatRow(task);
      const isFillBlank = formattedTask.task_type === 'fill_blank';
      const aiConfig = isFillBlank ? { apiBaseUrl: 'local', apiKey: 'local' } : await pythonGrader.getAIConfig(pool);
      
      if (isFillBlank || (aiConfig.apiBaseUrl && aiConfig.apiKey)) {
        console.log(`自动评分: submission ${submissionId}, task ${task_id}, type=${formattedTask.task_type}`);
        const gradeResult = await pythonGrader.gradeSubmission(submission, formattedTask, pool);
        if (gradeResult) {
          await pool.query('INSERT INTO python_gradings SET ?', [gradeResult]);
          await pool.query('UPDATE python_submissions SET status = ? WHERE id = ?', ['graded', submissionId]);
          submission.status = 'graded';
          submission.grading = {
            total_score: gradeResult.total_score,
            comment: gradeResult.comment,
            blank_results: gradeResult.blank_results
          };

          if (isFillBlank) {
            // 编程填空题：满分奖励100积分，取消低分处罚
            const fullScore = formattedTask.total_score || 100;
            if (gradeResult.total_score >= fullScore) {
              const [existingRewards] = await pool.query(
                'SELECT id FROM point_transactions WHERE student_id = ? AND source_type = ? AND source_id = ? AND amount > 0',
                [userId, 'python_submit', submissionId]
              );
              if (existingRewards.length === 0) {
                pointReward = 100;
                await pool.query(
                  'UPDATE profiles SET current_points = current_points + ?, total_points_earned = total_points_earned + ? WHERE id = ?',
                  [pointReward, pointReward, userId]
                );
                await pool.query(
                  `INSERT INTO point_transactions (student_id, amount, reason, source_type, source_id, teacher_id)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [userId, pointReward, 'Python编程填空满分奖励', 'python_submit', submissionId, null]
                );
              }
            }
          } else {
            // 普通编程作业：评分 >= 80 自动奖励 50 积分
            if (gradeResult.total_score >= 80) {
              const [existingRewards] = await pool.query(
                'SELECT id FROM point_transactions WHERE student_id = ? AND source_type = ? AND source_id = ? AND amount > 0',
                [userId, 'python_submit', submissionId]
              );
              if (existingRewards.length === 0) {
                pointReward = 50;
                await pool.query(
                  'UPDATE profiles SET current_points = current_points + ?, total_points_earned = total_points_earned + ? WHERE id = ?',
                  [pointReward, pointReward, userId]
                );
                await pool.query(
                  `INSERT INTO point_transactions (student_id, amount, reason, source_type, source_id, teacher_id)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [userId, pointReward, 'Python编程作业高分奖励（80分以上）', 'python_submit', submissionId, null]
                );
              }
            }

            // 评分 <= 40 自动扣除 50 积分
            if (gradeResult.total_score <= 40) {
              const [existingPenalties] = await pool.query(
                'SELECT id FROM point_transactions WHERE student_id = ? AND source_type = ? AND source_id = ? AND amount < 0',
                [userId, 'python_submit', submissionId]
              );
              if (existingPenalties.length === 0) {
                pointReward = -50;
                await pool.query(
                  'UPDATE profiles SET current_points = GREATEST(0, current_points - 50) WHERE id = ?',
                  [userId]
                );
                await pool.query(
                  `INSERT INTO point_transactions (student_id, amount, reason, source_type, source_id, teacher_id)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [userId, -50, 'Python编程作业低分处罚（40分及以下）', 'python_submit', submissionId, null]
                );
              }
            }
          }
        }
      }
    } catch (gradeError) {
      console.error('自动评分失败（不影响提交）:', gradeError.message);
    }

    res.json({ data: { ...submission, point_reward: pointReward !== 0 ? pointReward : undefined }, error: null });
  } catch (error) {
    console.error('Error in POST /api/python/submit:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取提交详情（含批改结果）
app.get('/api/python/submissions/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;
    const userId = user.userId || user.user_id;
    const [rows] = await pool.query(
        `SELECT s.id, s.task_id, s.student_id, s.code, s.submitted_at, s.is_late, s.status,
              g.id as grading_id, g.total_score as grade_score, g.syntax_score, g.output_score, g.logic_score,
              g.comment, g.syntax_errors, g.output_diff, g.missing_keywords, g.blank_results,
              g.is_ai_graded, g.manually_adjusted, g.show_reference_code, g.graded_at
      FROM python_submissions s
      LEFT JOIN python_gradings g ON s.id = g.submission_id
      WHERE s.task_id = ? AND s.student_id = ?`,
      [taskId, userId]
    );
    if (rows.length > 0) {
      res.json({ data: formatRow(rows[0]), error: null });
    } else {
      res.json({ data: null, error: null });
    }
  } catch (error) {
    console.error('Error in GET /api/python/submissions/:taskId:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// === 教师端 API ===

// 创建/更新编程任务
app.post('/api/python/teacher/tasks', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const {
      title, description, task_type, class_ids, total_score, deadline, 
      allow_late_submission, allow_run_code, max_run_seconds,
      reference_code, expected_output, hint, required_keywords,
      blank_template, blank_answers, blank_weights
    } = req.body;

    if (!title) {
      return res.status(400).json({ data: null, error: '任务标题不能为空' });
    }

    const userId = user.userId || user.user_id;

    const id = uuidv4();
    const classes = class_ids && Array.isArray(class_ids) && class_ids.length > 0 
      ? class_ids 
      : [];

    await pool.query(
      `INSERT INTO python_tasks 
      (id, title, description, task_type, class_ids, total_score, deadline,
      allow_late_submission, allow_run_code, max_run_seconds,
      reference_code, expected_output, hint, required_keywords,
      blank_template, blank_answers, blank_weights,
      is_active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, NOW(), NOW())`,
      [
        id, title, description || '', task_type || 'code',
        JSON.stringify(classes),
        total_score || 100, deadline || null,
        allow_late_submission || false,
        allow_run_code !== false,
        max_run_seconds || 3,
        reference_code || '', expected_output || '', hint || '',
        JSON.stringify(required_keywords || []),
        blank_template || '',
        JSON.stringify(blank_answers || []),
        JSON.stringify(blank_weights || []),
        userId
      ]
    );

    const [newTask] = await pool.query('SELECT * FROM python_tasks WHERE id = ?', [id]);
    res.json({ data: formatRow(newTask[0]), error: null });
  } catch (error) {
    console.error('Error in POST /api/python/teacher/tasks:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 教师获取任务列表
app.get('/api/python/teacher/tasks', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM python_tasks ORDER BY created_at DESC'
    );
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/python/teacher/tasks:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 更新编程任务
app.put('/api/python/teacher/tasks/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const updateData = req.body;

    const allowed = [
      'title', 'description', 'task_type', 'class_ids', 'total_score',
      'deadline', 'allow_late_submission', 'allow_run_code',
      'max_run_seconds', 'reference_code', 'expected_output',
      'hint', 'required_keywords', 'is_active',
      'blank_template', 'blank_answers', 'blank_weights'
    ];

    const jsonFields = ['class_ids', 'required_keywords', 'blank_answers', 'blank_weights'];
    const updates = {};
    for (const key of allowed) {
      if (updateData[key] !== undefined) {
        if (jsonFields.includes(key)) {
          const val = updateData[key];
          if (typeof val === 'string') {
            try { JSON.parse(val); updates[key] = val; } catch { updates[key] = JSON.stringify([]); }
          } else if (Array.isArray(val) || typeof val === 'object') {
            updates[key] = JSON.stringify(val);
          } else {
            updates[key] = JSON.stringify([]);
          }
        } else {
          updates[key] = updateData[key];
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date();
      const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await pool.query(
        `UPDATE python_tasks SET ${setClause} WHERE id = ?`,
        [...Object.values(updates), taskId]
      );
    }

    const [updated] = await pool.query('SELECT * FROM python_tasks WHERE id = ?', [taskId]);
    res.json({ data: formatRow(updated[0]), error: null });
  } catch (error) {
    console.error('Error in PUT /api/python/teacher/tasks/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 删除编程任务（同步删除关联的提交和批改）
app.delete('/api/python/teacher/tasks/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    // 先删除批改记录
    await pool.query(
      'DELETE g FROM python_gradings g INNER JOIN python_submissions s ON g.submission_id = s.id WHERE s.task_id = ?',
      [taskId]
    );
    // 再删除提交记录
    await pool.query('DELETE FROM python_submissions WHERE task_id = ?', [taskId]);
    // 最后删除任务
    await pool.query('DELETE FROM python_tasks WHERE id = ?', [taskId]);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in DELETE /api/python/teacher/tasks/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 批量删除学生提交（恢复为未提交状态）
app.post('/api/python/teacher/delete-submissions', authenticate, async (req, res) => {
  try {
    const { submission_ids } = req.body;
    if (!submission_ids || !Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({ data: null, error: '请选择要删除的提交' });
    }

    for (const id of submission_ids) {
      // 删除批改记录
      await pool.query('DELETE FROM python_gradings WHERE submission_id = ?', [id]);
      // 删除提交记录
      await pool.query('DELETE FROM python_submissions WHERE id = ?', [id]);
    }

    res.json({ data: { deleted_count: submission_ids.length }, error: null });
  } catch (error) {
    console.error('Error in POST /api/python/teacher/delete-submissions:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取作业提交列表
app.get('/api/python/teacher/submissions/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { class_id } = req.query;
    let queryStr = `SELECT s.id, s.task_id, s.student_id, s.code, s.submitted_at, s.is_late, s.status,
              p.username, p.real_name, p.class_id as student_class_id,
              g.id as grading_id, g.total_score as grade_score, g.syntax_score, g.output_score, g.logic_score,
              g.comment, g.syntax_errors, g.output_diff, g.missing_keywords, g.blank_results,
              g.is_ai_graded, g.manually_adjusted, g.show_reference_code, g.graded_at
      FROM python_submissions s
      LEFT JOIN profiles p ON s.student_id = p.id
      LEFT JOIN python_gradings g ON s.id = g.submission_id
      WHERE s.task_id = ?`;
    const params = [taskId];

    if (class_id) {
      queryStr += ' AND p.class_id = ?';
      params.push(class_id);
    }

    queryStr += ' ORDER BY p.username ASC';

    const [rows] = await pool.query(queryStr, params);
    const formatted = formatRows(rows);
    res.json({ data: formatted, error: null });
  } catch (error) {
    console.error('Error in GET /api/python/teacher/submissions/:taskId:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 获取未提交作业的学生
app.get('/api/python/teacher/unsubmitted/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { class_id } = req.query;

    if (!class_id) {
      return res.json({ data: [], error: null });
    }

    const [rows] = await pool.query(
      `SELECT p.id, p.username, p.real_name
      FROM profiles p
      WHERE p.class_id = ? AND p.role = 'student'
      AND p.id NOT IN (
        SELECT s.student_id FROM python_submissions s WHERE s.task_id = ?
      )
      ORDER BY p.username ASC`,
      [class_id, taskId]
    );
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/python/teacher/unsubmitted/:taskId:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// AI批改单个作业
app.post('/api/python/teacher/grade/:submissionId', authenticate, async (req, res) => {
  try {
    const licenseResult = await licenseManager.checkFeatureLicense(FEATURES.AI);
    if (!licenseResult.allowed) {
      return res.status(403).json({ 
        data: null, 
        error: 'AI批改功能需要授权激活后才能使用',
        licenseStatus: licenseResult.status
      });
    }
    
    const { submissionId } = req.params;
    const [submissions] = await pool.query('SELECT * FROM python_submissions WHERE id = ?', [submissionId]);
    if (submissions.length === 0) {
      return res.status(404).json({ data: null, error: 'Submission not found' });
    }
    const submission = submissions[0];

    const [tasks] = await pool.query('SELECT * FROM python_tasks WHERE id = ?', [submission.task_id]);
    const task = formatRow(tasks[0]);

    const gradeResult = await pythonGrader.gradeSubmission(submission, task, pool);

    // 检查是否已有批改记录
    const [existingGrades] = await pool.query('SELECT * FROM python_gradings WHERE submission_id = ?', [submissionId]);
    if (existingGrades.length > 0) {
      await pool.query(
        `UPDATE python_gradings SET ? WHERE submission_id = ?`,
        [gradeResult, submissionId]
      );
    } else {
      await pool.query('INSERT INTO python_gradings SET ?', [gradeResult]);
    }

    // 验证 grading 记录已保存，再更新状态
    const [verifyGrade] = await pool.query('SELECT * FROM python_gradings WHERE submission_id = ?', [submissionId]);
    if (verifyGrade.length > 0) {
      await pool.query(
        'UPDATE python_submissions SET status = ? WHERE id = ?',
        ['graded', submissionId]
      );
    }

    res.json({ data: gradeResult, error: null });
  } catch (error) {
    console.error('Error in POST /api/python/teacher/grade/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 批量AI批改全班作业
app.post('/api/python/teacher/grade-task/:taskId', authenticate, async (req, res) => {
  try {
    const licenseResult = await licenseManager.checkFeatureLicense(FEATURES.AI);
    if (!licenseResult.allowed) {
      return res.status(403).json({ 
        data: null, 
        error: 'AI批改功能需要授权激活后才能使用',
        licenseStatus: licenseResult.status
      });
    }
    
    const { taskId } = req.params;
    const [tasks] = await pool.query('SELECT * FROM python_tasks WHERE id = ?', [taskId]);
    if (tasks.length === 0) {
      return res.status(404).json({ data: null, error: 'Task not found' });
    }
    const task = formatRow(tasks[0]);

    const [submissions] = await pool.query(
      'SELECT * FROM python_submissions WHERE task_id = ? AND status IN (?)',
      [taskId, ['submitted']]
    );

    const results = [];
    for (const submission of submissions) {
      try {
        const gradeResult = await pythonGrader.gradeSubmission(submission, task, pool);

        const [existingGrades] = await pool.query('SELECT * FROM python_gradings WHERE submission_id = ?', [submission.id]);
        if (existingGrades.length > 0) {
          await pool.query(
            'UPDATE python_gradings SET ? WHERE submission_id = ?',
            [gradeResult, submission.id]
          );
        } else {
          await pool.query('INSERT INTO python_gradings SET ?', [gradeResult]);
        }

        const [verifyGrade] = await pool.query('SELECT * FROM python_gradings WHERE submission_id = ?', [submission.id]);
        if (verifyGrade.length > 0) {
          await pool.query(
            'UPDATE python_submissions SET status = ? WHERE id = ?',
            ['graded', submission.id]
          );
        }

        results.push({ submission_id: submission.id, success: true, grade: gradeResult });
      } catch (e) {
        results.push({ submission_id: submission.id, success: false, error: e.message });
      }
    }

    res.json({ data: { graded_count: results.length, results: results }, error: null });
  } catch (error) {
    console.error('Error in POST /api/python/teacher/grade-task/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 教师手动调整分数
app.put('/api/python/teacher/grade/:submissionId', authenticate, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { adjusted_score, adjusted_comment, show_reference_code } = req.body;
    const user = req.user;

    await pool.query(
      `UPDATE python_gradings 
      SET manually_adjusted = TRUE, adjusted_score = ?, adjusted_by = ?, adjusted_comment = ?,
      show_reference_code = COALESCE(?, show_reference_code), updated_at = NOW()
      WHERE submission_id = ?`,
      [adjusted_score, user.user_id, adjusted_comment, show_reference_code, submissionId]
    );

    const [updated] = await pool.query('SELECT * FROM python_gradings WHERE submission_id = ?', [submissionId]);
    res.json({ data: formatRow(updated[0]), error: null });
  } catch (error) {
    console.error('Error in PUT /api/python/teacher/grade/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 导出作业情况（支持班级筛选）
app.get('/api/python/teacher/export', authenticate, async (req, res) => {
  try {
    const { class_id } = req.query;

    let taskQuery = 'SELECT id, title, total_score, task_type FROM python_tasks WHERE is_active = TRUE ORDER BY created_at ASC';
    const taskParams = [];
    const [taskRows] = await pool.query(taskQuery, taskParams);
    const tasks = taskRows.map(t => ({ id: t.id, title: t.title, total_score: t.total_score, task_type: t.task_type }));

    let studentQuery = 'SELECT id, username, real_name, class_id FROM profiles WHERE role = ?';
    const studentParams = ['student'];
    if (class_id) {
      studentQuery += ' AND class_id = ?';
      studentParams.push(class_id);
    }
    studentQuery += ' ORDER BY username ASC';
    const [studentRows] = await pool.query(studentQuery, studentParams);
    const students = studentRows.map(s => ({ id: s.id, username: s.username, real_name: s.real_name, class_id: s.class_id }));

    const allResults = [];
    for (const task of tasks) {
      const [submissionRows] = await pool.query(
        `SELECT s.student_id, s.submitted_at, s.status,
                g.total_score, g.syntax_score, g.output_score, g.logic_score
         FROM python_submissions s
         LEFT JOIN python_gradings g ON s.id = g.submission_id
         WHERE s.task_id = ?`,
        [task.id]
      );

      const taskResults = {};
      submissionRows.forEach(row => {
        taskResults[row.student_id] = {
          submitted_at: row.submitted_at,
          status: row.status,
          total_score: row.total_score || 0,
          syntax_score: row.syntax_score || 0,
          output_score: row.output_score || 0,
          logic_score: row.logic_score || 0
        };
      });

      allResults.push({ task, results: taskResults });
    }

    let csv = '\uFEFF';
    csv += '班级,学生用户名,学生姓名';
    tasks.forEach(task => {
      csv += `,${task.title}(总分${task.total_score}),得分,状态`;
    });
    csv += '\n';

    for (const student of students) {
      csv += `${student.class_id || ''},${student.username},${student.real_name || ''}`;
      for (const taskResult of allResults) {
        const submission = taskResult.results[student.id];
        if (submission) {
          const statusText = submission.status === 'graded' ? '已批改' : submission.status === 'submitted' ? '待批改' : submission.status;
          csv += `,,${submission.total_score},${statusText}`;
        } else {
          csv += ',,未提交,未提交';
        }
      }
      csv += '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=python_homework_export_${class_id ? `class_${class_id}_` : ''}${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error in GET /api/python/teacher/export:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== Python 编程模块 API 结束 ====================

// ==================== AI 答疑模块 API 开始 ====================

async function getAiQaConfig(pool) {
  try {
    const [rows] = await pool.query(
      'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?, ?, ?, ?)',
      ['ai_api_base_url', 'ai_api_key', 'ai_model', 'ai_temperature', 'ai_qa_system_prompt', 'ai_qa_points_per_question']
    );
    
    const config = {};
    rows.forEach(row => {
      let value = row.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {}
      }
      config[row.config_key] = value?.value ?? value;
    });
    
    const [appRows] = await pool.query(
      'SELECT * FROM apps WHERE id = ?',
      ['app_ai_qa']
    );
    
    let appConfig = {};
    if (appRows.length > 0 && appRows[0].config) {
      try {
        if (typeof appRows[0].config === 'string') {
          appConfig = JSON.parse(appRows[0].config);
        } else {
          appConfig = appRows[0].config;
        }
      } catch {}
    }
    
    return {
      ...config,
      ...appConfig,
      ai_api_base_url: appConfig.ai_api_base_url || config.ai_api_base_url || '',
      ai_api_key: appConfig.ai_api_key || config.ai_api_key || '',
      ai_model: appConfig.ai_model || config.ai_model || 'deepseek-v4-flash',
      ai_temperature: appConfig.ai_temperature ?? config.ai_temperature ?? 0.7,
      ai_qa_system_prompt: appConfig.ai_qa_system_prompt || config.ai_qa_system_prompt || '你是江苏省高中信息技术、Python编程专属答疑老师。',
      ai_qa_points_per_question: appConfig.pointsPerQuestion ?? config.ai_qa_points_per_question ?? 5
    };
  } catch (error) {
    console.error('获取AI答疑配置失败:', error);
    return {
      ai_api_base_url: '',
      ai_api_key: '',
      ai_model: 'deepseek-v4-flash',
      ai_temperature: 0.7,
      ai_qa_system_prompt: '你是江苏省高中信息技术、Python编程专属答疑老师。',
      ai_qa_points_per_question: 5
    };
  }
}

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

app.post('/api/ai-qa/ask', authenticate, async (req, res) => {
  try {
    const licenseResult = await licenseManager.checkFeatureLicense(FEATURES.AI);
    if (!licenseResult.allowed) {
      return res.status(403).json({ 
        data: null, 
        error: 'AI答疑功能需要授权激活后才能使用',
        licenseStatus: licenseResult.status
      });
    }
    
    const { question, history = [] } = req.body;
    const userId = req.user.userId;
    
    if (!question || !question.trim()) {
      return res.status(400).json({ data: null, error: '请输入问题' });
    }
    
    const config = await getAiQaConfig(pool);
    const pointsPerQuestion = config.ai_qa_points_per_question || 5;
    
    const [profileRows] = await pool.query(
      'SELECT id, current_points FROM profiles WHERE id = ?',
      [userId]
    );
    
    if (profileRows.length === 0) {
      return res.status(404).json({ data: null, error: '用户不存在' });
    }
    
    const profile = profileRows[0];
    if (profile.current_points < pointsPerQuestion) {
      return res.status(400).json({ 
        data: null, 
        error: `积分不足！需要 ${pointsPerQuestion} 积分，当前仅有 ${profile.current_points} 积分` 
      });
    }
    
    const messages = [
      { role: 'system', content: config.ai_qa_system_prompt },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: question }
    ];
    
    // 先查答疑知识库（短时重试机制：第一次没命中，等待后再查一次）
    const crypto = require('crypto');
    const questionHash = crypto.createHash('md5').update(question.trim()).digest('hex');
    
    const searchKnowledgeBase = async () => {
      const [rows] = await pool.query(
        'SELECT answer FROM ai_qa_knowledge_base WHERE question_hash = ?',
        [questionHash]
      );
      return rows;
    };
    
    let kbRows = await searchKnowledgeBase();
    
    let answer = '';
    let fromKnowledgeBase = false;
    
    if (kbRows.length > 0) {
      // 命中答疑库，直接返回
      answer = kbRows[0].answer;
      fromKnowledgeBase = true;
      // 增加命中次数
      await pool.query(
        'UPDATE ai_qa_knowledge_base SET hit_count = hit_count + 1 WHERE question_hash = ?',
        [questionHash]
      );
    } else {
      // 第一次未命中，短时等待后再查一次（应对并发场景）
      await new Promise(resolve => setTimeout(resolve, 800));
      kbRows = await searchKnowledgeBase();
      
      if (kbRows.length > 0) {
        // 第二次命中
        answer = kbRows[0].answer;
        fromKnowledgeBase = true;
        await pool.query(
          'UPDATE ai_qa_knowledge_base SET hit_count = hit_count + 1 WHERE question_hash = ?',
          [questionHash]
        );
      } else {
        // 两次都未命中，调用AI
        try {
          answer = await callAiApi(config, messages);
        } catch (error) {
          console.error('调用AI失败:', error);
          return res.status(500).json({ 
            data: null, 
            error: 'AI服务暂时不可用，请稍后重试或联系管理员' 
          });
        }
        
        if (!answer) {
          return res.status(500).json({ data: null, error: 'AI返回空内容' });
        }
        
        // 将新的问答存入答疑库（异步，不阻塞返回）
        const kbId = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        pool.query(
          'INSERT INTO ai_qa_knowledge_base (id, question_hash, question, answer, created_by) VALUES (?, ?, ?, ?, ?)',
          [kbId, questionHash, question.trim(), answer, userId]
        ).catch(err => console.error('存入答疑库失败:', err));
      }
    }
    
    // 扣除积分（无论是否命中答疑库都扣除）
    await pool.query(
      'UPDATE profiles SET current_points = current_points - ?, max_points = GREATEST(max_points, current_points - ?), updated_at = NOW() WHERE id = ?',
      [pointsPerQuestion, pointsPerQuestion, userId]
    );
    
    await pool.query(
      'INSERT INTO point_transactions (student_id, amount, reason, source_type, created_at) VALUES (?, ?, ?, ?, NOW())',
      [userId, -pointsPerQuestion, 'AI答疑提问', 'system']
    );
    
    const historyId = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await pool.query(
      'INSERT INTO ai_qa_history (id, student_id, question, answer, created_at) VALUES (?, ?, ?, ?, NOW())',
      [historyId, userId, question, answer]
    );
    
    const [updatedProfiles] = await pool.query(
      'SELECT * FROM profiles WHERE id = ?',
      [userId]
    );
    
    res.json({ 
      data: { 
        answer, 
        historyId, 
        profile: formatRow(updatedProfiles[0]),
        pointsSpent: pointsPerQuestion,
        fromKnowledgeBase
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error in POST /api/ai-qa/ask:', error);
    res.status(500).json({ data: null, error: error.message || '请求失败' });
  }
});

app.get('/api/ai-qa/history', authenticate, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const userId = req.user.userId;
    
    const [rows] = await pool.query(
      'SELECT * FROM ai_qa_history WHERE student_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [userId, parseInt(limit), parseInt(offset)]
    );
    
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/ai-qa/history:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

app.get('/api/ai-qa/config', authenticate, async (req, res) => {
  try {
    const config = await getAiQaConfig(pool);
    res.json({ 
      data: { 
        pointsPerQuestion: config.ai_qa_points_per_question || 5,
        subjectScope: config.subjectScope || 'information_tech,python',
        difficulty: config.difficulty || 'high_school_basic',
        codeCheckEnabled: config.codeCheckEnabled !== false,
        codeRunEnabled: config.codeRunEnabled !== false,
        suggestedQuestions: config.suggestedQuestions || [
          '什么是二进制？',
          'Python中for循环怎么用？',
          '什么是递归？',
          '列表和元组有什么区别？',
          '什么是面向对象编程？',
          'Python中字典怎么用？'
        ]
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error in GET /api/ai-qa/config:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== AI 答疑知识库管理 API ====================

// 获取答疑库列表
app.get('/api/ai-qa-kb/list', authenticate, async (req, res) => {
  try {
    const { limit = 20, offset = 0, keyword = '' } = req.query;
    
    let query = `
      SELECT kb.*, p.username as creator_name 
      FROM ai_qa_knowledge_base kb 
      LEFT JOIN profiles p ON kb.created_by = p.id
    `;
    let countQuery = 'SELECT COUNT(*) as total FROM ai_qa_knowledge_base';
    const params = [];
    const countParams = [];
    
    if (keyword) {
      query += ' WHERE kb.question LIKE ? OR kb.answer LIKE ?';
      countQuery += ' WHERE question LIKE ? OR answer LIKE ?';
      params.push(`%${keyword}%`, `%${keyword}%`);
      countParams.push(`%${keyword}%`, `%${keyword}%`);
    }
    
    query += ' ORDER BY kb.hit_count DESC, kb.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [rows] = await pool.query(query, params);
    const [countResult] = await pool.query(countQuery, countParams);
    
    res.json({ 
      data: { 
        list: formatRows(rows), 
        total: countResult[0].total 
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error in GET /api/ai-qa-kb/list:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 添加答疑库条目
app.post('/api/ai-qa-kb', authenticate, async (req, res) => {
  try {
    const { question, answer } = req.body;
    const teacherId = req.user.userId;
    
    if (!question || !answer) {
      return res.status(400).json({ data: null, error: '问题和回答不能为空' });
    }
    
    const crypto = require('crypto');
    const questionHash = crypto.createHash('md5').update(question.trim()).digest('hex');
    
    // 检查是否已存在
    const [existing] = await pool.query(
      'SELECT id FROM ai_qa_knowledge_base WHERE question_hash = ?',
      [questionHash]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ data: null, error: '该问题已存在于答疑库中' });
    }
    
    const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await pool.query(
      'INSERT INTO ai_qa_knowledge_base (id, question_hash, question, answer, created_by) VALUES (?, ?, ?, ?, ?)',
      [id, questionHash, question.trim(), answer, teacherId]
    );
    
    res.json({ data: { id, success: true }, error: null });
  } catch (error) {
    console.error('Error in POST /api/ai-qa-kb:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 更新答疑库条目
app.put('/api/ai-qa-kb/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer } = req.body;
    
    if (!question || !answer) {
      return res.status(400).json({ data: null, error: '问题和回答不能为空' });
    }
    
    const crypto = require('crypto');
    const questionHash = crypto.createHash('md5').update(question.trim()).digest('hex');
    
    await pool.query(
      'UPDATE ai_qa_knowledge_base SET question = ?, answer = ?, question_hash = ?, updated_at = NOW() WHERE id = ?',
      [question.trim(), answer, questionHash, id]
    );
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in PUT /api/ai-qa-kb/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 删除答疑库条目
app.delete('/api/ai-qa-kb/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query('DELETE FROM ai_qa_knowledge_base WHERE id = ?', [id]);
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in DELETE /api/ai-qa-kb/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== AI 答疑模块 API 结束 ====================

// ==================== 心理健康模块 API 开始 ====================

// 心理健康咨询系统提示词
const DEFAULT_MENTAL_HEALTH_SYSTEM_PROMPT = `你是持证专职高中心理健康咨询师，深耕普通高中心理辅导，熟悉高中生生理发育、学业压力、亲子矛盾、同伴社交、早恋迷茫、考试焦虑、自卑内耗、厌学情绪、青春期情绪波动等高频问题。

工作准则：
1. 沟通语气：温和共情、平等平视学生，不用说教、训斥、居高临下式话术，用词贴合15-18岁高中生理解水平。
2. 问诊逻辑：先共情安抚情绪→分步引导倾诉问题根源→客观分析成因→给出落地、可执行的小方法，杜绝空泛鸡汤。
3. 边界规范：发现重度抑郁自伤、自杀倾向、校园霸凌虐待、极端心理危机，立刻提醒用户告知学校心理老师、家长或就医；不做精神疾病确诊，疑似重症建议线下三甲心理科就诊。
4. 保密原则：承诺保护用户隐私，但涉及危机情况时会提醒需要寻求帮助。

回答输出格式：
先1句共情回应来访者当下情绪；
针对性拆解困扰产生的关键原因（学业/家庭/社交三类优先）；
提供2-3条简易落地实操方案（短时间就能做到，适配高中生作息）；
如需跟进，主动抛出1个引导提问，深挖细节。

禁止行为：
不灌输偏激价值观、不怂恿对抗父母/学校；
不迷信解梦、玄学心理疗法；
不随意判定抑郁症、焦虑症等精神病症。

根据用户身份（学生/家长/教师），自动调整沟通方式：
- 学生来访：侧重情绪疏导、自我调节、学习心态
- 家长来访：侧重亲子沟通、青春期相处方式
- 教师来访：侧重班级群体心理、厌学学生干预`;

// 预警关键词（用于检测需要关注的内容）
const ALERT_KEYWORDS = [
  // 自杀/自伤相关
  '自杀', '不想活', '结束生命', '自伤', '自残', '割腕', '轻生',
  // 校园霸凌/受欺负（受害者）
  '被霸凌', '被欺负', '被打', '被孤立', '被排挤',
  // 暴力行为（施暴者）- 新增
  '打人', '伤害他人', '腿打断了', '打断了腿', '砍人', '杀人',
  '揍人', '暴力', '虐待动物', '报复', '想报复',
  // 心理困扰
  '重度抑郁', '焦虑症', '抑郁症', '强迫症',
  // 学业相关
  '不想上学', '厌学', '逃学', '学习压力',
  // 情绪问题
  '焦虑到崩溃', '压力太大', '受不了', '绝望', '崩溃',
  // 家庭问题
  '家暴', '虐待', '被虐待', '亲子矛盾', '离家出走',
  // 其他危机信号
  '想不开', '活着没意思', '恨这个世界', '讨厌自己'
];

// 获取心理健康配置
async function getMentalHealthConfig(pool) {
  try {
    const [rows] = await pool.query(
      'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?)',
      ['ai_api_base_url', 'ai_api_key', 'ai_model']
    );
    
    const config = {};
    rows.forEach(row => {
      let value = row.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {}
      }
      config[row.config_key] = value?.value ?? value;
    });
    
    const [appRows] = await pool.query(
      'SELECT * FROM apps WHERE id = ?',
      ['app_mental_health']
    );
    
    let appConfig = {};
    if (appRows.length > 0 && appRows[0].config) {
      try {
        if (typeof appRows[0].config === 'string') {
          appConfig = JSON.parse(appRows[0].config);
        } else {
          appConfig = appRows[0].config;
        }
      } catch {}
    }
    
    return {
      ...config,
      ...appConfig,
      ai_api_base_url: appConfig.ai_api_base_url || config.ai_api_base_url || '',
      ai_api_key: appConfig.ai_api_key || config.ai_api_key || '',
      ai_model: appConfig.ai_model || config.ai_model || 'deepseek-v4-flash',
      ai_temperature: appConfig.ai_temperature ?? 0.8,
      mental_health_system_prompt: appConfig.systemPrompt || DEFAULT_MENTAL_HEALTH_SYSTEM_PROMPT,
      alert_sensitivity: appConfig.alertSensitivity || 'medium',
      is_free: appConfig.isFree !== false
    };
  } catch (error) {
    console.error('获取心理健康配置失败:', error);
    return {
      ai_api_base_url: '',
      ai_api_key: '',
      ai_model: 'deepseek-v4-flash',
      ai_temperature: 0.8,
      mental_health_system_prompt: DEFAULT_MENTAL_HEALTH_SYSTEM_PROMPT,
      alert_sensitivity: 'medium',
      is_free: true
    };
  }
}

// 检测是否需要触发预警
function shouldTriggerAlert(message, sensitivity) {
  const lowerMessage = message.toLowerCase();
  
  // 根据敏感度设置阈值
  let threshold = 1;
  if (sensitivity === 'low') threshold = 2;
  if (sensitivity === 'high') threshold = 1;
  
  let matchCount = 0;
  for (const keyword of ALERT_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      matchCount++;
      if (matchCount >= threshold) {
        return true;
      }
    }
  }
  return false;
}

// 创建心理健康相关表（如果不存在）
async function ensureMentalHealthTables(pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mental_health_chat_history (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        user_type ENUM('student', 'parent', 'teacher') DEFAULT 'student',
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mental_health_alerts (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        user_type ENUM('student', 'parent', 'teacher') DEFAULT 'student',
        chat_id VARCHAR(50),
        alert_type VARCHAR(100),
        alert_content TEXT,
        is_resolved BOOLEAN DEFAULT FALSE,
        resolved_by VARCHAR(50),
        resolved_at TIMESTAMP NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_is_resolved (is_resolved),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS mental_health_access (
        id INT PRIMARY KEY AUTO_INCREMENT,
        access_password VARCHAR(255) NULL,
        enabled BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 初始化心理健康访问密码配置
    await pool.query(`
      INSERT IGNORE INTO mental_health_access (id, access_password, enabled) VALUES (1, NULL, TRUE)
    `);
    
    // 插入默认配置和应用（如果不存在）
    await pool.query(`
      INSERT IGNORE INTO system_config (id, config_key, value)
      VALUES
        ('config_mental_health_enabled', 'mental_health_enabled', JSON_OBJECT('value', TRUE))
    `);
    
    await pool.query(`
      INSERT IGNORE INTO apps (id, name, description, icon, type, price_type, points_price, category, is_active, is_marketplace, config, created_by)
      VALUES (
        'app_mental_health',
        '润心伴学',
        '高中心理健康AI咨询助手，遵循保密原则，温和共情，提供学业压力、人际社交、情绪调节等方面的支持和建议。',
        '💚',
        'mental_health',
        'free',
        0,
        '心理关怀',
        TRUE,
        TRUE,
        JSON_OBJECT(
          'alertSensitivity', 'medium',
          'isFree', TRUE,
          'logRetention', TRUE
        ),
        'teacher1'
      )
    `);
    
  } catch (error) {
    console.error('创建心理健康表失败:', error);
  }
}

// 心理健康咨询接口
app.post('/api/mental-health/chat', authenticate, async (req, res) => {
  try {
    const { message, userType = 'student', history = [] } = req.body;
    const userId = req.user.userId;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ data: null, error: '请输入内容' });
    }
    
    // 确保表存在
    await ensureMentalHealthTables(pool);
    
    const config = await getMentalHealthConfig(pool);
    
    // 构建系统提示词，加入用户类型信息
    let systemPrompt = config.mental_health_system_prompt;
    if (userType === 'student') {
      systemPrompt += '\n\n当前用户是一名高中生，请以学生友好的方式进行交流。';
    } else if (userType === 'parent') {
      systemPrompt += '\n\n当前用户是高中生家长，请从家庭教育和亲子沟通的角度提供建议。';
    } else if (userType === 'teacher') {
      systemPrompt += '\n\n当前用户是高中教师，请从班级管理和学生心理辅导的角度提供建议。';
    }
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];
    
    let answer = '';
    try {
      answer = await callAiApi(config, messages);
    } catch (error) {
      console.error('调用AI失败:', error);
      return res.status(500).json({ 
        data: null, 
        error: '心理健康咨询服务暂时不可用，请稍后重试或直接联系学校心理老师' 
      });
    }
    
    if (!answer) {
      return res.status(500).json({ data: null, error: 'AI返回空内容' });
    }
    
    // 保存聊天记录
    const historyId = `mh_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await pool.query(
      'INSERT INTO mental_health_chat_history (id, user_id, user_type, question, answer, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [historyId, userId, userType, message, answer]
    );
    
    // 检查是否需要触发预警
    const alertGenerated = shouldTriggerAlert(message + '\n' + answer, config.alert_sensitivity);
    let alertId = null;
    
    if (alertGenerated) {
      alertId = `mha_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await pool.query(
        `INSERT INTO mental_health_alerts (id, user_id, user_type, chat_id, alert_type, alert_content, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [alertId, userId, userType, historyId, '心理健康预警', message + '\n\n---\n\n' + answer]
      );
    }
    
    // 获取用户信息（如果需要）
    const [updatedProfiles] = await pool.query(
      'SELECT * FROM profiles WHERE id = ?',
      [userId]
    );
    
    res.json({ 
      data: { 
        answer, 
        historyId, 
        alertGenerated,
        profile: updatedProfiles.length > 0 ? formatRow(updatedProfiles[0]) : null
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error in POST /api/mental-health/chat:', error);
    res.status(500).json({ data: null, error: error.message || '请求失败' });
  }
});

// 获取心理健康聊天历史
app.get('/api/mental-health/history', authenticate, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const userId = req.user.userId;
    
    await ensureMentalHealthTables(pool);
    
    const [rows] = await pool.query(
      'SELECT * FROM mental_health_chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [userId, parseInt(limit), parseInt(offset)]
    );
    
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/mental-health/history:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 教师端：获取心理健康预警列表
app.get('/api/mental-health/alerts', authenticate, async (req, res) => {
  try {
    const { limit = 50, offset = 0, is_resolved = null } = req.query;
    const userRole = req.user.role;
    
    if (userRole !== 'teacher' && userRole !== 'admin') {
      return res.status(403).json({ data: null, error: '无权访问' });
    }
    
    await ensureMentalHealthTables(pool);
    
    let query = `
      SELECT 
        a.*,
        p.username,
        p.real_name,
        p.class_id,
        c.name as class_name
      FROM mental_health_alerts a
      LEFT JOIN profiles p ON a.user_id = p.id
      LEFT JOIN classes c ON p.class_id = c.id
    `;
    const params = [];
    
    if (is_resolved !== null) {
      query += ' WHERE a.is_resolved = ?';
      params.push(is_resolved === 'true' || is_resolved === true);
    }
    
    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [rows] = await pool.query(query, params);
    
    res.json({ data: formatRows(rows), error: null });
  } catch (error) {
    console.error('Error in GET /api/mental-health/alerts:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 教师端：标记预警为已解决
app.put('/api/mental-health/alerts/:id/resolve', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    if (userRole !== 'teacher' && userRole !== 'admin') {
      return res.status(403).json({ data: null, error: '无权访问' });
    }
    
    await ensureMentalHealthTables(pool);
    
    await pool.query(
      'UPDATE mental_health_alerts SET is_resolved = TRUE, resolved_by = ?, resolved_at = NOW(), notes = ? WHERE id = ?',
      [userId, notes || null, id]
    );
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in PUT /api/mental-health/alerts/:id/resolve:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 教师端：删除预警
app.delete('/api/mental-health/alerts/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.role;
    
    if (userRole !== 'teacher' && userRole !== 'admin') {
      return res.status(403).json({ data: null, error: '无权访问' });
    }
    
    await ensureMentalHealthTables(pool);
    
    await pool.query('DELETE FROM mental_health_alerts WHERE id = ?', [id]);
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in DELETE /api/mental-health/alerts/:id:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 心理健康外部访问 API ====================

// 获取心理健康访问密码配置（需要教师权限）
app.get('/api/mental-health/access-config', authenticate, async (req, res) => {
  try {
    const userRole = req.user.role;
    
    if (userRole !== 'teacher' && userRole !== 'admin') {
      return res.status(403).json({ data: null, error: '无权访问' });
    }
    
    await ensureMentalHealthTables(pool);
    
    const [rows] = await pool.query('SELECT * FROM mental_health_access WHERE id = 1');
    
    res.json({ 
      data: rows.length > 0 ? {
        enabled: rows[0].enabled,
        hasPassword: !!rows[0].access_password
      } : {
        enabled: true,
        hasPassword: false
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error in GET /api/mental-health/access-config:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 设置心理健康访问密码（需要教师权限）
app.put('/api/mental-health/access-config', authenticate, async (req, res) => {
  try {
    const userRole = req.user.role;
    
    if (userRole !== 'teacher' && userRole !== 'admin') {
      return res.status(403).json({ data: null, error: '无权访问' });
    }
    
    const { password, enabled } = req.body;
    
    await ensureMentalHealthTables(pool);
    
    if (password !== undefined) {
      // 如果设置密码为空，清除密码
      if (password === '') {
        await pool.query('UPDATE mental_health_access SET access_password = NULL WHERE id = 1');
      } else {
        await pool.query('UPDATE mental_health_access SET access_password = ? WHERE id = 1', [password]);
      }
    }
    
    if (enabled !== undefined) {
      await pool.query('UPDATE mental_health_access SET enabled = ? WHERE id = 1', [enabled]);
    }
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in PUT /api/mental-health/access-config:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 验证访问密码（无需登录）
app.post('/api/mental-health/verify-password', async (req, res) => {
  try {
    const { password } = req.body;
    
    await ensureMentalHealthTables(pool);
    
    const [rows] = await pool.query('SELECT * FROM mental_health_access WHERE id = 1');
    
    if (rows.length === 0 || !rows[0].enabled) {
      return res.status(403).json({ data: null, error: '访问未启用' });
    }
    
    // 如果设置了密码，则验证
    if (rows[0].access_password) {
      if (!password || password !== rows[0].access_password) {
        return res.status(401).json({ data: null, error: '密码错误' });
      }
    }
    
    res.json({ data: { valid: true }, error: null });
  } catch (error) {
    console.error('Error in POST /api/mental-health/verify-password:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取预警列表（外部访问，需要密码验证）
app.post('/api/mental-health/external/alerts', async (req, res) => {
  try {
    const { password, limit = 50, offset = 0, is_resolved = null } = req.body;
    
    await ensureMentalHealthTables(pool);
    
    const [rows] = await pool.query('SELECT * FROM mental_health_access WHERE id = 1');
    
    if (rows.length === 0 || !rows[0].enabled) {
      return res.status(403).json({ data: null, error: '访问未启用' });
    }
    
    // 如果设置了密码，则验证
    if (rows[0].access_password) {
      if (!password || password !== rows[0].access_password) {
        return res.status(401).json({ data: null, error: '密码错误' });
      }
    }
    
    let query = `
      SELECT 
        a.*,
        p.username,
        p.real_name,
        p.class_id,
        c.name as class_name
      FROM mental_health_alerts a
      LEFT JOIN profiles p ON a.user_id = p.id
      LEFT JOIN classes c ON p.class_id = c.id
    `;
    const params = [];
    
    if (is_resolved !== null) {
      query += ' WHERE a.is_resolved = ?';
      params.push(is_resolved === 'true' || is_resolved === true);
    }
    
    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [alertRows] = await pool.query(query, params);
    
    res.json({ data: formatRows(alertRows), error: null });
  } catch (error) {
    console.error('Error in POST /api/mental-health/external/alerts:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 外部访问：标记预警为已解决
app.post('/api/mental-health/external/alerts/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { password, notes } = req.body;
    
    await ensureMentalHealthTables(pool);
    
    const [rows] = await pool.query('SELECT * FROM mental_health_access WHERE id = 1');
    
    if (rows.length === 0 || !rows[0].enabled) {
      return res.status(403).json({ data: null, error: '访问未启用' });
    }
    
    if (rows[0].access_password) {
      if (!password || password !== rows[0].access_password) {
        return res.status(401).json({ data: null, error: '密码错误' });
      }
    }
    
    await pool.query(
      'UPDATE mental_health_alerts SET is_resolved = TRUE, resolved_at = NOW(), notes = ? WHERE id = ?',
      [notes || null, id]
    );
    
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error in POST /api/mental-health/external/alerts/:id/resolve:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 心理健康模块 API 结束 ====================

// ==================== 原有 API 结束 ====================

// ==================== 刷题打怪游戏 API ====================

// 获取当前学生 Active Buff 列表
app.get('/api/student/buffs', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const [rows] = await pool.query(
      `SELECT id, buff_type, crit_modifier, 
              TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining_seconds
       FROM student_buffs 
       WHERE student_id = ? AND expires_at > NOW()
       ORDER BY expires_at ASC`,
      [userId]
    );

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error in GET /api/student/buffs:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 获取荣誉统计数据
app.get('/api/student/honors', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const [rows] = await pool.query(
      'SELECT perfect_10_times, triple_crit_times, wrong_3_times, studious_times FROM profiles WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: '学生不存在' });
    }

    res.json({
      data: {
        perfect_10_times: rows[0].perfect_10_times || 0,
        triple_crit_times: rows[0].triple_crit_times || 0,
        wrong_3_times: rows[0].wrong_3_times || 0,
        studious_times: rows[0].studious_times || 0,
        honors: [
          { type: 'perfect_10', name: '十全十美', times: rows[0].perfect_10_times || 0 },
          { type: 'triple_crit', name: '三连暴击', times: rows[0].triple_crit_times || 0 },
          { type: 'wrong_3', name: '三连错', times: rows[0].wrong_3_times || 0 },
          { type: 'studious', name: '勤学好问', times: rows[0].studious_times || 0 }
        ]
      },
      error: null
    });
  } catch (error) {
    console.error('Error in GET /api/student/honors:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ============== 学习模块已看记录 ==============
// 获取学生已看问题列表
app.get('/api/student/learn-visited', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const [rows] = await pool.query(
      'SELECT question_key FROM learn_visited_records WHERE student_id = ?',
      [userId]
    );
    const keys = rows.map(r => r.question_key);
    res.json({ data: keys, error: null });
  } catch (error) {
    console.error('获取学习已看记录失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 标记问题为已看
app.post('/api/student/learn-visited', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { question_key, question_text } = req.body;
    if (!question_key) {
      return res.status(400).json({ data: null, error: '缺少 question_key' });
    }
    // 使用 INSERT IGNORE 避免重复键报错
    await pool.query(
      'INSERT IGNORE INTO learn_visited_records (student_id, question_key, question_text) VALUES (?, ?, ?)',
      [userId, question_key, question_text || null]
    );
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('标记学习已看记录失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 学习打卡：每看10题触发勤学好问buff，每日限一次
app.post('/api/student/learn-studious-checkin', authenticate, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const userId = req.user.userId || req.user.id;

    // 锁定 profiles 行，确保同一用户的并发请求串行执行
    await connection.query(
      'SELECT studious_times FROM profiles WHERE id = ? FOR UPDATE',
      [userId]
    );

    // 1. 统计今日已看题目数
    const [todayRows] = await connection.query(
      `SELECT COUNT(*) AS cnt FROM learn_visited_records 
       WHERE student_id = ? AND DATE(visited_at) = CURDATE()`,
      [userId]
    );
    const todayCount = todayRows[0]?.cnt || 0;

    // 2. 使用 studious_checkins 表原子性检查今日是否已触发
    //    先尝试插入今日打卡记录（唯一索引保证不会重复插入）
    const checkinId = `sc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [insertResult] = await connection.query(
      `INSERT IGNORE INTO studious_checkins (id, student_id, check_date, question_count)
       VALUES (?, ?, CURDATE(), ?)`,
      [checkinId, userId, todayCount]
    );

    // 如果 insertResult.affectedRows === 0，说明今日记录已存在，读取现有记录
    let triggeredToday = false;
    if (insertResult.affectedRows === 0) {
      const [existingRows] = await connection.query(
        'SELECT triggered FROM studious_checkins WHERE student_id = ? AND check_date = CURDATE()',
        [userId]
      );
      triggeredToday = !!existingRows[0]?.triggered;
    }

    // 更新今日看题数
    await connection.query(
      'UPDATE studious_checkins SET question_count = ? WHERE student_id = ? AND check_date = CURDATE()',
      [todayCount, userId]
    );

    let triggered = false;
    let honorInfo = null;
    let buffInfo = null;

    // 3. 今日看题>=10 且 今日未触发过 → 发放勤学好问buff
    if (todayCount >= 10 && !triggeredToday) {
      // 读取系统配置
      const [cfgRows] = await connection.query(
        "SELECT config_key, value FROM system_config WHERE config_key IN ('honor_studious_buff_crit', 'honor_studious_buff_minutes')"
      );
      const cfg = {};
      cfgRows.forEach(row => {
        let val = row.value;
        if (typeof val === 'string') {
          try { val = JSON.parse(val); } catch {}
        }
        if (typeof val === 'object' && val !== null && val.value !== undefined) {
          val = val.value;
        }
        cfg[row.config_key] = val;
      });

      const studiousBuffCrit = parseFloat(cfg['honor_studious_buff_crit']) || 8;
      const studiousBuffMinutes = parseInt(cfg['honor_studious_buff_minutes']) || 30;

      // 发放buff
      const buffId = `buff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await connection.query(
        'INSERT INTO student_buffs (id, student_id, buff_type, crit_modifier, expires_at, created_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())',
        [buffId, userId, 'studious_crit', studiousBuffCrit, studiousBuffMinutes]
      );

      // 增加勤学好问荣誉次数
      await connection.query(
        'UPDATE profiles SET studious_times = studious_times + 1 WHERE id = ?',
        [userId]
      );

      // 标记今日已触发
      await connection.query(
        'UPDATE studious_checkins SET triggered = 1 WHERE student_id = ? AND check_date = CURDATE()',
        [userId]
      );

      triggered = true;
      honorInfo = { type: 'studious', name: '勤学好问', description: `今日学习10题，获得暴击加成Buff` };
      buffInfo = { id: buffId, buff_type: 'studious_crit', crit_modifier: studiousBuffCrit, duration_minutes: studiousBuffMinutes };
    }

    await connection.commit();

    res.json({
      data: {
        success: true,
        today_count: todayCount,
        triggered,
        triggered_today: triggeredToday || triggered,
        honor: honorInfo,
        buff: buffInfo,
      },
      error: null
    });
  } catch (error) {
    await connection.rollback();
    console.error('学习打卡失败:', error);
    res.status(500).json({ data: null, error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== 装备管理 API ====================

// 获取所有装备
app.get('/api/teacher/equipments', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM equipments ORDER BY created_at DESC');
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('获取装备列表失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 新增装备
app.post('/api/teacher/equipments', authenticate, async (req, res) => {
  try {
    const { name, drop_rate, crit_bonus, icon } = req.body;
    if (!name) return res.status(400).json({ data: null, error: '装备名称不能为空' });
    const id = `eq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await pool.query(
      'INSERT INTO equipments (id, name, drop_rate, crit_bonus, icon) VALUES (?, ?, ?, ?, ?)',
      [id, name, parseFloat(drop_rate) || 1, parseFloat(crit_bonus) || 1, icon || '⚔️']
    );
    const [rows] = await pool.query('SELECT * FROM equipments WHERE id = ?', [id]);
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('新增装备失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 编辑装备
app.put('/api/teacher/equipments/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, drop_rate, crit_bonus, icon, is_active } = req.body;
    await pool.query(
      'UPDATE equipments SET name = ?, drop_rate = ?, crit_bonus = ?, icon = ?, is_active = ? WHERE id = ?',
      [name, parseFloat(drop_rate) || 1, parseFloat(crit_bonus) || 1, icon || '⚔️', is_active !== undefined ? is_active : true, id]
    );
    const [rows] = await pool.query('SELECT * FROM equipments WHERE id = ?', [id]);
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('编辑装备失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 删除装备（软删除）
app.delete('/api/teacher/equipments/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE equipments SET is_active = false WHERE id = ?', [id]);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('删除装备失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取学生实时战力/暴击率/Buff 等统计
app.get('/api/student/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const [profileRows] = await pool.query(
      'SELECT total_correct, extra_crit FROM profiles WHERE id = ?',
      [userId]
    );

    if (profileRows.length === 0) {
      return res.status(404).json({ data: null, error: '学生不存在' });
    }

    const [petRows] = await pool.query(
      'SELECT growth_level FROM student_pets WHERE student_id = ? ORDER BY growth_level DESC LIMIT 1',
      [userId]
    );

    const gp = profileRows[0];
    // 实时统计实际正确答题数（避免 profiles.total_correct 计数器不一致）
    const [correctCountRows] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM student_answers WHERE student_id = ? AND is_correct = 1',
      [userId]
    );
    const totalCorrect = correctCountRows[0]?.cnt || 0;
    const petLevel = petRows.length > 0 ? (petRows[0].growth_level || 1) : 1;
    const extraCrit = parseFloat(gp.extra_crit) || 0;

    // 读取 system_config
    const [configRows] = await pool.query(
      'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?)',
      ['crit_base_rate', 'crit_max_rate', 'points_correct_answer']
    );

    const cfg = {};
    configRows.forEach(row => {
      let v = row.value;
      if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch {}
      }
      cfg[row.config_key] = v?.value ?? v;
    });

    const critBaseRate = parseFloat(cfg['crit_base_rate']) || 5;
    const critMaxRate = parseFloat(cfg['crit_max_rate']) || 30;
    const pointsCorrectAnswer = cfg['points_correct_answer'] || 10;

    // 战力倍率
    const powerMult = 1 + 0.1 * petLevel;

    // 当前 Buff 暴击修正
    const [buffRows] = await pool.query(
      'SELECT IFNULL(SUM(crit_modifier), 0) AS total_mod FROM student_buffs WHERE student_id = ? AND expires_at > NOW()',
      [userId]
    );
    const buffSum = parseFloat(buffRows[0]?.total_mod) || 0;

    // 装备暴击加成
    const [eqRows] = await pool.query(
      `SELECT IFNULL(SUM(e.crit_bonus * se.quantity), 0) AS total_eq_crit
       FROM student_equipments se
       JOIN equipments e ON se.equipment_id = e.id
       WHERE se.student_id = ?`,
      [userId]
    );
    const equipmentCritSum = parseFloat(eqRows[0]?.total_eq_crit) || 0;

    // 皮肤暴击加成（激活的皮肤永久加成）
    const SKIN_CRIT_BONUS = {
      'skin_minimal_white': 1,
      'skin_forest_green': 1,
      'skin_ocean_blue': 2,
      'skin_aurora_purple': 3,
      'skin_sunset_gold': 3,
      'skin_royal_gold': 5,
      'skin_galaxy_star': 5,
    };
    const [skinRows] = await pool.query(
      'SELECT active_skin_id FROM profiles WHERE id = ?',
      [userId]
    );
    const activeSkinId = skinRows[0]?.active_skin_id || null;
    const skinCritBonus = activeSkinId ? (SKIN_CRIT_BONUS[activeSkinId] || 0) : 0;

    // 学生装备列表
    const [equipmentList] = await pool.query(
      `SELECT e.id, e.name, e.icon, e.crit_bonus, se.quantity
       FROM student_equipments se
       JOIN equipments e ON se.equipment_id = e.id
       WHERE se.student_id = ?
       ORDER BY se.acquired_at DESC`,
      [userId]
    );

    // 暴击率
    const critRate = Math.min(
      Math.max(critBaseRate + Math.floor(totalCorrect / 100) + extraCrit + buffSum + equipmentCritSum + skinCritBonus, 5),
      critMaxRate
    );

    // 当前 Active Buff 列表
    const [activeBuffs] = await pool.query(
      `SELECT id, buff_type, crit_modifier,
              TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining_seconds
       FROM student_buffs
       WHERE student_id = ? AND expires_at > NOW()
       ORDER BY expires_at ASC`,
      [userId]
    );

    res.json({
      data: {
        total_correct: totalCorrect,
        pet_level: petLevel,
        extra_crit: extraCrit,
        power_multiplier: Math.round(powerMult * 100) / 100,
        crit_base_rate: critBaseRate,
        crit_max_rate: critMaxRate,
        crit_rate: Math.round(critRate * 10) / 10,
        crit_rate_breakdown: {
          base: critBaseRate,
          from_correct_count: Math.floor(totalCorrect / 100),
          from_extra_crit: extraCrit,
          from_buffs: buffSum,
          from_equipment: equipmentCritSum,
          from_skin: skinCritBonus
        },
        points_correct_answer: pointsCorrectAnswer,
        active_buffs: activeBuffs,
        equipment_list: equipmentList,
        active_skin_id: activeSkinId
      },
      error: null
    });
  } catch (error) {
    console.error('Error in GET /api/student/stats:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取学生测试历史记录（带测试名称）
app.get('/api/student/test-history', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const [records] = await pool.query(
      `SELECT tr.id, tr.test_id, tr.student_id, tr.score, tr.correct_count, tr.total_count, tr.points_earned, tr.internet_code, tr.completed_at,
              t.title as test_name
       FROM test_records tr
       LEFT JOIN tests t ON tr.test_id = t.id COLLATE utf8mb4_unicode_ci
       WHERE tr.student_id = ?
       ORDER BY tr.completed_at DESC
       LIMIT 10`,
      [userId]
    );
    res.json({ data: records, error: null });
  } catch (error) {
    console.error('Error in GET /api/student/test-history:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 游戏系统诊断 API ====================
app.get('/api/student/game-diagnostics', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const results = {};

    // 1. 检查 profiles 表字段
    const [profileCols] = await pool.query(
      "SHOW COLUMNS FROM profiles WHERE FIELD IN ('total_correct','curr_streak','curr_crit_streak','curr_wrong','perfect_10_times','triple_crit_times','wrong_3_times','extra_crit','pet_level')"
    );
    results.profile_columns = profileCols.map(c => c.Field);

    // 2. 检查 student_buffs 表
    const [buffTables] = await pool.query(
      "SHOW TABLES LIKE 'student_buffs'"
    );
    results.buff_table_exists = buffTables.length > 0;

    // 3. 检查 system_config 游戏配置
    const [configRows] = await pool.query(
      "SELECT config_key FROM system_config WHERE config_key IN ('crit_base_rate','crit_max_rate','points_correct_answer')"
    );
    results.game_config_keys = configRows.map(r => r.config_key);

    // 4. 读取 profiles 游戏字段
    const [profileRows] = await pool.query(
      'SELECT total_correct, curr_streak, curr_crit_streak, curr_wrong, pet_level FROM profiles WHERE id = ?',
      [userId]
    );
    results.profile_data = profileRows.length > 0 ? profileRows[0] : null;

    // 5. 检查当前系统配置值
    const [rawConfigs] = await pool.query(
      'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['points_correct_answer', 'crit_base_rate', 'crit_max_rate',
       'honor_perfect_buff_crit', 'honor_perfect_buff_minutes',
       'honor_critstreak_buff_crit', 'honor_critstreak_buff_minutes',
       'honor_wrong_debuff_crit', 'honor_wrong_debuff_minutes', 'points_wrong_answer']
    );
    results.raw_configs = rawConfigs.map(r => ({ key: r.config_key, raw_value: r.value }));

    res.json({ data: results, error: null });
  } catch (error) {
    console.error('Error in game-diagnostics:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 桌面背景上传和管理 API ====================

// 上传桌面背景图片
app.post('/api/desktop-background/upload', authenticate, upload.single('background'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ data: null, error: '未上传文件' });
    }

    // 构建图片URL（统一存相对路径，保证跨环境可访问）
    const imageUrl = `/uploads/${req.file.filename}`;

    // 更新系统配置
    const id = 'config_desktop_background';
    const configKey = 'desktop_background';
    const value = JSON.stringify({ value: imageUrl });

    await pool.query(`
      INSERT INTO system_config (id, config_key, value, updated_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
      value = ?, updated_at = NOW()
    `, [id, configKey, value, value]);

    res.json({ 
      data: { 
        url: imageUrl,
        filename: req.file.filename,
        success: true 
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error uploading desktop background:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取当前桌面背景配置
app.get('/api/desktop-background', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM system_config WHERE config_key = ?',
      ['desktop_background']
    );

    if (rows.length > 0) {
      const config = rows[0];
      let value = config.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {}
      }
      const url = typeof value === 'object' && value.value ? value.value : value;
      res.json({ data: { url: toRelativeUploadPath(url) }, error: null });
    } else {
      // 返回默认背景
      const defaultUrl = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=2070&auto=format&fit=crop';
      res.json({ data: { url: defaultUrl }, error: null });
    }
  } catch (error) {
    console.error('Error getting desktop background:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 桌面背景上传和管理 API 结束 ====================

// ==================== 学生自定义背景管理 API ====================

// 获取学生自定义背景配置
app.get('/api/student/custom-background', authenticate, async (req, res) => {
  try {
    const studentId = req.user?.userId;
    if (!studentId) {
      return res.status(401).json({ data: null, error: '未登录' });
    }

    // 获取学生信息
    const [students] = await pool.query(
      'SELECT custom_background, class_id FROM profiles WHERE id = ?',
      [studentId]
    );

    if (students.length === 0) {
      return res.status(404).json({ data: null, error: '学生不存在' });
    }

    const student = students[0];

    // 检查是否有自定义背景权限
    const [configRows] = await pool.query(
      'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?, ?)',
      ['student_custom_bg_enabled', 'student_custom_bg_class_ids', 'student_free_bg_per_day', 'student_custom_bg_points']
    );

    const configs = {};
    configRows.forEach(row => {
      let value = row.value;
      if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch {}
      }
      configs[row.config_key] = typeof value === 'object' && value.value !== undefined ? value.value : value;
    });

    const isEnabled = configs.student_custom_bg_enabled === true || configs.student_custom_bg_enabled === 'true' || configs.student_custom_bg_enabled === 1;
    const allowedClassIds = Array.isArray(configs.student_custom_bg_class_ids) ? configs.student_custom_bg_class_ids : [];
    const freePerDay = parseInt(configs.student_free_bg_per_day) || 1;
    const pointsCost = parseInt(configs.student_custom_bg_points) || 100;

    // 检查该学生班级是否在允许列表中
    const hasPermission = isEnabled && allowedClassIds.includes(student.class_id);

    res.json({
      data: {
        customBackground: hasPermission ? toRelativeUploadPath(student.custom_background) : null,
        hasPermission,
        freePerDay,
        pointsCost
      },
      error: null
    });
  } catch (error) {
    console.error('Error getting student custom background:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 学生设置自定义背景（随机抽取）
app.post('/api/student/custom-background', authenticate, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const studentId = req.user?.userId;
    if (!studentId) {
      return res.status(401).json({ data: null, error: '未登录' });
    }

    await connection.beginTransaction();

    // 获取学生信息（加锁）
    const [students] = await connection.query(
      'SELECT id, custom_background, class_id, current_points, free_bg_changes_today, last_free_bg_reset FROM profiles WHERE id = ? FOR UPDATE',
      [studentId]
    );

    if (students.length === 0) {
      await connection.rollback();
      return res.status(404).json({ data: null, error: '学生不存在' });
    }

    const student = students[0];

    // 检查权限
    const [configRows] = await connection.query(
      'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?, ?)',
      ['student_custom_bg_enabled', 'student_custom_bg_class_ids', 'student_custom_bg_points', 'student_free_bg_per_day']
    );

    const configs = {};
    configRows.forEach(row => {
      let value = row.value;
      if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch {}
      }
      configs[row.config_key] = typeof value === 'object' && value.value !== undefined ? value.value : value;
    });

    const isEnabled = configs.student_custom_bg_enabled === true || configs.student_custom_bg_enabled === 'true' || configs.student_custom_bg_enabled === 1;
    const allowedClassIds = Array.isArray(configs.student_custom_bg_class_ids) ? configs.student_custom_bg_class_ids : [];
    const pointsCost = parseInt(configs.student_custom_bg_points) || 10;
    const freePerDay = parseInt(configs.student_free_bg_per_day) || 1;

    if (!isEnabled || !allowedClassIds.includes(student.class_id)) {
      await connection.rollback();
      return res.status(403).json({ data: null, error: '您的班级未开放自定义背景权限' });
    }

    // 检查免费次数 - 使用本地日期避免时区问题
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let freeChangesToday = student.free_bg_changes_today || 0;
    let lastReset = null;
    if (student.last_free_bg_reset) {
      const d = new Date(student.last_free_bg_reset);
      lastReset = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // 如果是新的一天，重置免费次数
    if (lastReset !== today) {
      freeChangesToday = 0;
      await connection.query(
        'UPDATE profiles SET free_bg_changes_today = 0, last_free_bg_reset = CURDATE() WHERE id = ?',
        [studentId]
      );
    }

    // 判断是否需要扣积分
    let needToDeductPoints = freeChangesToday >= freePerDay;

    // 检查积分是否足够
    if (needToDeductPoints && student.current_points < pointsCost) {
      await connection.rollback();
      return res.status(400).json({
        data: null,
        error: `积分不足，需要 ${pointsCost} 积分，当前积分 ${student.current_points}`
      });
    }

    // 获取可用的背景列表
    const [backgrounds] = await connection.query(
      'SELECT id, url, name FROM desktop_backgrounds WHERE is_active = 1 ORDER BY sort_order ASC, created_at DESC'
    );
    // 归一化历史完整URL为相对路径后再写入学生背景
    backgrounds.forEach(bg => { bg.url = toRelativeUploadPath(bg.url); });

    if (backgrounds.length === 0) {
      await connection.rollback();
      return res.status(404).json({ data: null, error: '暂无可用的背景图片，请联系老师上传' });
    }

    // 随机选择一个背景（排除当前的）
    const currentBg = student.custom_background;
    const availableBgs = backgrounds.filter(bg => bg.url !== currentBg);

    if (availableBgs.length === 0 && backgrounds.length === 1) {
      // 只有一个背景且和当前相同，允许重复选择
      const selectedBg = backgrounds[0];

      // 更新学生背景
      await connection.query(
        'UPDATE profiles SET custom_background = ? WHERE id = ?',
        [selectedBg.url, studentId]
      );

      await connection.commit();
      return res.json({
        data: {
          background: selectedBg,
          pointsDeducted: 0,
          freeRemaining: freePerDay - freeChangesToday - 1,
          message: '设置成功！当前只有一个背景可选'
        },
        error: null
      });
    }

    if (availableBgs.length === 0) {
      await connection.rollback();
      return res.status(400).json({ data: null, error: '没有其他可选的背景' });
    }

    // 随机选择
    const randomIndex = Math.floor(Math.random() * availableBgs.length);
    const selectedBg = availableBgs[randomIndex];

    // 扣积分或使用免费次数
    if (needToDeductPoints) {
      await connection.query(
        'UPDATE profiles SET current_points = current_points - ?, custom_background = ? WHERE id = ?',
        [pointsCost, selectedBg.url, studentId]
      );

      // 记录积分变动
      const transactionId = Math.floor(Math.random() * 1000000000);
      await connection.query(
        `INSERT INTO point_transactions (id, student_id, amount, reason, source_type, source_id, created_at)
         VALUES (?, ?, ?, '随机设置桌面背景', 'system', ?, NOW())`,
        [transactionId, studentId, -pointsCost, studentId]
      );
    } else {
      // 使用免费次数
      await connection.query(
        'UPDATE profiles SET custom_background = ?, free_bg_changes_today = free_bg_changes_today + 1 WHERE id = ?',
        [selectedBg.url, studentId]
      );
    }

    await connection.commit();

    res.json({
      data: {
        background: selectedBg,
        pointsDeducted: needToDeductPoints ? pointsCost : 0,
        freeRemaining: needToDeductPoints ? 0 : freePerDay - freeChangesToday - 1,
        message: needToDeductPoints ? `已扣除 ${pointsCost} 积分` : '使用免费次数'
      },
      error: null
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error setting student custom background:', error);
    res.status(500).json({ data: null, error: error.message });
  } finally {
    connection.release();
  }
});

// 学生恢复默认背景
app.post('/api/student/custom-background/reset', authenticate, async (req, res) => {
  try {
    const studentId = req.user?.userId;
    if (!studentId) {
      return res.status(401).json({ data: null, error: '未登录' });
    }

    // 清除自定义背景
    await pool.query(
      'UPDATE profiles SET custom_background = NULL WHERE id = ?',
      [studentId]
    );

    res.json({
      data: { success: true, message: '已恢复默认背景' },
      error: null
    });
  } catch (error) {
    console.error('Error resetting student custom background:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 窗口皮肤系统 API ====================

// 皮肤元数据镜像（后端使用，与前端 windowSkins.ts 保持同步）
const WINDOW_SKINS_META = [
  { id: 'skin_minimal_white', name: '极简白', description: '简约纯净，返璞归真', tier: 'common', critBonus: 1, pointsCost: 100 },
  { id: 'skin_forest_green', name: '森林绿', description: '清新自然，绿意盎然', tier: 'common', critBonus: 1, pointsCost: 150 },
  { id: 'skin_ocean_blue', name: '海洋蓝', description: '深海湛蓝，心旷神怡', tier: 'common', critBonus: 2, pointsCost: 250 },
  { id: 'skin_aurora_purple', name: '紫霞幻彩', description: '紫霞流转，梦幻绮丽', tier: 'rare', critBonus: 3, pointsCost: 800 },
  { id: 'skin_sunset_gold', name: '日落橙金', description: '落日熔金，温暖绚烂', tier: 'rare', critBonus: 3, pointsCost: 800 },
  { id: 'skin_royal_gold', name: '流光金黑', description: '帝王尊享，金碧辉煌', tier: 'legendary', critBonus: 5, pointsCost: 2500 },
  { id: 'skin_galaxy_star', name: '星河璀璨', description: '银河倒泻，星海璀璨', tier: 'legendary', critBonus: 5, pointsCost: 2500 },
];

// 获取所有可用皮肤元数据
app.get('/api/skins', authenticate, async (req, res) => {
  try {
    res.json({
      data: { skins: WINDOW_SKINS_META },
      error: null
    });
  } catch (error) {
    console.error('Error getting skins:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取学生拥有的皮肤 + 当前激活皮肤
app.get('/api/student/my-skins', authenticate, async (req, res) => {
  try {
    const studentId = req.user?.userId;
    if (!studentId) {
      return res.status(401).json({ data: null, error: '未登录' });
    }

    // 查询学生拥有的皮肤
    const [ownedSkins] = await pool.query(
      'SELECT skin_id, acquired_at FROM student_skins WHERE student_id = ? ORDER BY acquired_at DESC',
      [studentId]
    );

    // 查询当前激活皮肤
    const [profileRows] = await pool.query(
      'SELECT active_skin_id FROM profiles WHERE id = ?',
      [studentId]
    );

    const activeSkinId = profileRows[0]?.active_skin_id || null;

    res.json({
      data: {
        ownedSkins,
        activeSkinId
      },
      error: null
    });
  } catch (error) {
    console.error('Error getting student skins:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 设置激活的皮肤
app.post('/api/student/active-skin', authenticate, async (req, res) => {
  try {
    const studentId = req.user?.userId;
    if (!studentId) {
      return res.status(401).json({ data: null, error: '未登录' });
    }

    const { skinId } = req.body;

    // skinId 为 null 时表示取消激活（恢复默认蓝）
    if (skinId === null || skinId === undefined) {
      await pool.query(
        'UPDATE profiles SET active_skin_id = NULL WHERE id = ?',
        [studentId]
      );
      return res.json({
        data: { success: true, activeSkinId: null, message: '已恢复默认皮肤' },
        error: null
      });
    }

    // 校验学生拥有该皮肤
    const [owned] = await pool.query(
      'SELECT id FROM student_skins WHERE student_id = ? AND skin_id = ?',
      [studentId, skinId]
    );

    if (owned.length === 0) {
      return res.status(403).json({ data: null, error: '您尚未拥有该皮肤' });
    }

    // 校验 skinId 有效
    const skinMeta = WINDOW_SKINS_META.find(s => s.id === skinId);
    if (!skinMeta) {
      return res.status(400).json({ data: null, error: '皮肤不存在' });
    }

    await pool.query(
      'UPDATE profiles SET active_skin_id = ? WHERE id = ?',
      [skinId, studentId]
    );

    res.json({
      data: {
        success: true,
        activeSkinId: skinId,
        skinName: skinMeta.name,
        critBonus: skinMeta.critBonus,
        message: `已激活皮肤「${skinMeta.name}」，暴击率 +${skinMeta.critBonus}%`
      },
      error: null
    });
  } catch (error) {
    console.error('Error setting active skin:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 教师获取学生背景配置
app.get('/api/config/student-bg-settings', authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (userRole !== 'teacher' && userRole !== 'super_admin') {
      return res.status(403).json({ data: null, error: '无权限访问' });
    }

    const [configRows] = await pool.query(
      'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?, ?)',
      ['student_custom_bg_enabled', 'student_custom_bg_class_ids', 'student_custom_bg_points', 'student_free_bg_per_day']
    );

    const configs = {
      enabled: false,
      classIds: [],
      points: 10,
      freePerDay: 1
    };

    configRows.forEach(row => {
      let value = row.value;
      if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch {}
      }
      const actualValue = typeof value === 'object' && value.value !== undefined ? value.value : value;

      switch (row.config_key) {
        case 'student_custom_bg_enabled':
          configs.enabled = actualValue === true || actualValue === 'true' || actualValue === 1;
          break;
        case 'student_custom_bg_class_ids':
          configs.classIds = Array.isArray(actualValue) ? actualValue : [];
          break;
        case 'student_custom_bg_points':
          configs.points = parseInt(actualValue) || 10;
          break;
        case 'student_free_bg_per_day':
          configs.freePerDay = parseInt(actualValue) || 1;
          break;
      }
    });

    res.json({ data: configs, error: null });
  } catch (error) {
    console.error('Error getting student bg settings:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 教师更新学生背景配置
app.put('/api/config/student-bg-settings', authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (userRole !== 'teacher' && userRole !== 'super_admin') {
      return res.status(403).json({ data: null, error: '无权限访问' });
    }

    const { enabled, classIds, points, freePerDay } = req.body;

    // 更新配置
    const updates = [
      { key: 'student_custom_bg_enabled', id: 'config_student_custom_bg_enabled', value: { value: Boolean(enabled) } },
      { key: 'student_custom_bg_class_ids', id: 'config_student_custom_bg_class_ids', value: { value: Array.isArray(classIds) ? classIds : [] } },
      { key: 'student_custom_bg_points', id: 'config_student_custom_bg_points', value: { value: parseInt(points) || 10 } },
      { key: 'student_free_bg_per_day', id: 'config_student_free_bg_per_day', value: { value: parseInt(freePerDay) || 1 } }
    ];

    for (const update of updates) {
      await pool.query(
        `INSERT INTO system_config (id, config_key, value, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE value = ?, updated_at = NOW()`,
        [update.id, update.key, JSON.stringify(update.value), JSON.stringify(update.value)]
      );
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error updating student bg settings:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 获取可用背景列表
app.get('/api/desktop-backgrounds/list', async (req, res) => {
  try {
    const [backgrounds] = await pool.query(
      'SELECT id, name, url, is_active, sort_order, created_at FROM desktop_backgrounds ORDER BY sort_order ASC, created_at DESC'
    );
    // 归一化历史数据中的完整URL为相对路径，保证跨环境可访问
    backgrounds.forEach(bg => { bg.url = toRelativeUploadPath(bg.url); });

    res.json({ data: backgrounds, error: null });
  } catch (error) {
    console.error('Error getting desktop backgrounds list:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 添加背景到背景库
app.post('/api/desktop-backgrounds', authenticate, upload.single('background'), async (req, res) => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (userRole !== 'teacher' && userRole !== 'super_admin') {
      return res.status(403).json({ data: null, error: '无权限访问' });
    }

    if (!req.file) {
      return res.status(400).json({ data: null, error: '未上传文件' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const name = req.body.name || req.file.originalname.split('.')[0];

    const id = 'bg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // 获取最大排序号
    const [maxOrderRows] = await pool.query('SELECT MAX(sort_order) as max_order FROM desktop_backgrounds');
    const sortOrder = (maxOrderRows[0]?.max_order || 0) + 1;

    await pool.query(
      `INSERT INTO desktop_backgrounds (id, name, url, is_active, sort_order)
       VALUES (?, ?, ?, 1, ?)`,
      [id, name, imageUrl, sortOrder]
    );

    res.json({
      data: {
        id,
        name,
        url: imageUrl,
        is_active: 1,
        sort_order: sortOrder,
        success: true
      },
      error: null
    });
  } catch (error) {
    console.error('Error adding desktop background:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 更新背景状态
app.put('/api/desktop-backgrounds/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (userRole !== 'teacher' && userRole !== 'super_admin') {
      return res.status(403).json({ data: null, error: '无权限访问' });
    }

    const { id } = req.params;
    const { name, is_active, sort_order } = req.body;

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }
    if (sort_order !== undefined) {
      updates.push('sort_order = ?');
      values.push(sort_order);
    }

    if (updates.length === 0) {
      return res.status(400).json({ data: null, error: '没有需要更新的字段' });
    }

    values.push(id);
    await pool.query(
      `UPDATE desktop_backgrounds SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error updating desktop background:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 删除背景
app.delete('/api/desktop-backgrounds/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (userRole !== 'teacher' && userRole !== 'super_admin') {
      return res.status(403).json({ data: null, error: '无权限访问' });
    }

    const { id } = req.params;

    // 获取背景信息
    const [bgs] = await pool.query('SELECT url FROM desktop_backgrounds WHERE id = ?', [id]);

    if (bgs.length === 0) {
      return res.status(404).json({ data: null, error: '背景不存在' });
    }

    // 删除数据库记录
    await pool.query('DELETE FROM desktop_backgrounds WHERE id = ?', [id]);

    // 尝试删除文件
    const bg = bgs[0];
    if (bg.url && bg.url.includes('/uploads/')) {
      const filename = bg.url.split('/uploads/')[1];
      if (filename) {
        const filePath = path.join(uploadsDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting desktop background:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 学生自定义背景管理 API 结束 ====================

// ==================== 通用图片上传和管理 API ====================

// 获取上传目录中的所有背景图片
app.get('/api/uploads/backgrounds', async (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir);
    const backgrounds = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) && file.startsWith('background-');
      })
      .map(file => {
        const stats = fs.statSync(path.join(uploadsDir, file));
        return {
          filename: file,
          url: `/uploads/${file}`,
          size: stats.size,
          createdAt: stats.birthtime
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    res.json({ data: backgrounds, error: null });
  } catch (error) {
    console.error('Error getting backgrounds:', error);
    res.status(500).json({ data: [], error: error.message });
  }
});

// 删除指定的背景图片
app.delete('/api/uploads/backgrounds/:filename', authenticate, async (req, res) => {
  try {
    const { filename } = req.params;
    
    // 安全检查：只允许删除 background- 开头的文件
    if (!filename.startsWith('background-')) {
      return res.status(403).json({ data: null, error: '非法文件名' });
    }
    
    const filePath = path.join(uploadsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ data: null, error: '文件不存在' });
    }
    
    // 检查是否正在被使用
    const [configs] = await pool.query(
      "SELECT * FROM system_config WHERE config_key = 'desktop_background'"
    );
    
    if (configs.length > 0) {
      let configValue = configs[0].value;
      if (typeof configValue === 'string') {
        try {
          configValue = JSON.parse(configValue);
        } catch {}
      }
      const currentUrl = typeof configValue === 'object' && configValue.value ? configValue.value : configValue;
      
      if (currentUrl && currentUrl.includes(filename)) {
        return res.status(400).json({ 
          data: null, 
          error: '该图片正在被使用，无法删除。请先切换到其他背景后再删除。' 
        });
      }
    }
    
    fs.unlinkSync(filePath);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting background:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 萌宠图片上传
app.post('/api/uploads/pet-image', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ data: null, error: '未上传文件' });
    }

    const { pet_id, level } = req.body;
    
    if (!pet_id) {
      return res.status(400).json({ data: null, error: '缺少萌宠ID' });
    }

    // 构建图片URL（统一存相对路径，保证跨环境可访问）
    const imageUrl = `/uploads/${req.file.filename}`;

    // 更新萌宠记录
    const fieldName = `image_level_${level || 1}`;
    await pool.query(
      `UPDATE pets SET ${pool.escapeId(fieldName)} = ? WHERE id = ?`,
      [imageUrl, pet_id]
    );

    res.json({ 
      data: { 
        url: imageUrl,
        filename: req.file.filename,
        fieldName: fieldName,
        success: true 
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error uploading pet image:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 通用图片上传和管理 API 结束 ====================

// ==================== 题目图片上传 API 开始 ====================

const questionImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const type = req.query.type || 'content';
    const validTypes = ['content', 'options', 'explanation'];
    const targetType = validTypes.includes(type) ? type : 'content';
    const targetDir = path.join(uploadsDir, 'questions', targetType);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'qimg-' + uniqueSuffix + ext);
  }
});

const questionImageUpload = multer({
  storage: questionImageStorage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件 (jpeg, jpg, png, gif, webp)'));
    }
  }
});

app.post('/api/upload/question-image', authenticate, questionImageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ data: null, error: '未接收到图片文件' });
    }
    const type = req.query.type || 'content';
    // 统一存相对路径，保证开发环境上传的题目图片在生产环境也能正常显示
    const imageUrl = `/uploads/questions/${type}/${req.file.filename}`;
    res.json({
      data: {
        url: imageUrl,
        filename: req.file.filename,
        size: req.file.size,
        type: type
      },
      error: null
    });
  } catch (error) {
    console.error('Error uploading question image:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 题目图片上传 API 结束 ====================

// ==================== Python魔法学院 API 开始 ====================

// 获取游戏进度
app.get('/api/python-magic/progress', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await pool.query(
      'SELECT * FROM python_magic_progress WHERE user_id = ?',
      [userId]
    );
    if (rows.length === 0) {
      const id = `pm_${userId}_${Date.now()}`;
      await pool.query(
        'INSERT INTO python_magic_progress (id, user_id, current_chapter, current_step, completed_challenges, badges, total_xp, reward_claimed) VALUES (?, ?, 0, ?, ?, ?, 0, ?)',
        [id, userId, 'dialogue', '[]', '[]', false]
      );
      const [newRows] = await pool.query(
        'SELECT * FROM python_magic_progress WHERE user_id = ?',
        [userId]
      );
      return res.json({ data: newRows[0], error: null });
    }
    const progress = rows[0];
    if (typeof progress.completed_challenges === 'string') {
      try { progress.completed_challenges = JSON.parse(progress.completed_challenges); } catch {}
    }
    if (typeof progress.badges === 'string') {
      try { progress.badges = JSON.parse(progress.badges); } catch {}
    }
    res.json({ data: progress, error: null });
  } catch (error) {
    console.error('获取游戏进度失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 保存游戏进度
async function grantPythonMagicReward(userId, progressId) {
  const [rewardCheck] = await pool.query(
    'SELECT reward_claimed FROM python_magic_progress WHERE id = ?',
    [progressId]
  );
  if (rewardCheck.length === 0 || rewardCheck[0].reward_claimed) {
    return { granted: false };
  }

  const [appConfig] = await pool.query(
    'SELECT config FROM apps WHERE id = ?',
    ['app_python_magic_academy']
  );
  if (appConfig.length === 0) {
    return { granted: false };
  }

  let config;
  try {
    config = typeof appConfig[0].config === 'string' ? JSON.parse(appConfig[0].config) : appConfig[0].config;
  } catch {
    return { granted: false };
  }

  if (!config.reward_enabled) {
    return { granted: false };
  }

  const pointsReward = config.points_reward || 0;
  const equipmentId = config.equipment_id || '';

  let grantedPoints = 0;
  let grantedEquipment = null;

  await pool.beginTransaction();
  try {
    if (pointsReward > 0) {
      await pool.query(
        'UPDATE profiles SET current_points = current_points + ?, max_points = GREATEST(max_points, current_points), total_points_earned = total_points_earned + ? WHERE id = ?',
        [pointsReward, pointsReward, userId]
      );
      await pool.query(
        'INSERT INTO point_transactions (student_id, amount, reason, source_type, created_at) VALUES (?, ?, ?, ?, NOW())',
        [userId, pointsReward, 'Python魔法学院毕业奖励', 'system']
      );
      grantedPoints = pointsReward;
    }

    if (equipmentId) {
      const [equipments] = await pool.query(
        'SELECT id, name, icon, crit_bonus FROM equipments WHERE id = ? AND is_active = true',
        [equipmentId]
      );
      if (equipments.length > 0) {
        const equipment = equipments[0];
        const [existing] = await pool.query(
          'SELECT id, quantity FROM student_equipments WHERE student_id = ? AND equipment_id = ?',
          [userId, equipmentId]
        );

        if (existing.length > 0) {
          await pool.query(
            'UPDATE student_equipments SET quantity = quantity + 1 WHERE id = ?',
            [existing[0].id]
          );
        } else {
          const seId = `se_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await pool.query(
            'INSERT INTO student_equipments (id, student_id, equipment_id, quantity) VALUES (?, ?, ?, 1)',
            [seId, userId, equipmentId]
          );
        }
        grantedEquipment = equipment;
      }
    }

    await pool.query(
      'UPDATE python_magic_progress SET reward_claimed = true WHERE id = ?',
      [progressId]
    );

    await pool.commit();
    return { granted: true, points: grantedPoints, equipment: grantedEquipment };
  } catch (error) {
    await pool.rollback();
    console.error('发放Python魔法学院奖励失败:', error);
    return { granted: false };
  }
}

app.post('/api/python-magic/progress', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { current_chapter, current_step, completed_challenges, badges, total_xp } = req.body;
    
    const [existing] = await pool.query(
      'SELECT id, reward_claimed FROM python_magic_progress WHERE user_id = ?',
      [userId]
    );
    
    let progressId = null;
    let shouldGrantReward = false;

    if (existing.length === 0) {
      progressId = `pm_${userId}_${Date.now()}`;
      await pool.query(
        'INSERT INTO python_magic_progress (id, user_id, current_chapter, current_step, completed_challenges, badges, total_xp, reward_claimed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [progressId, userId, current_chapter || 0, current_step || 'dialogue', JSON.stringify(completed_challenges || []), JSON.stringify(badges || []), total_xp || 0, false]
      );
    } else {
      progressId = existing[0].id;
      shouldGrantReward = !existing[0].reward_claimed && current_step === 'completed' && current_chapter >= 7;
      await pool.query(
        'UPDATE python_magic_progress SET current_chapter = ?, current_step = ?, completed_challenges = ?, badges = ?, total_xp = ? WHERE user_id = ?',
        [current_chapter || 0, current_step || 'dialogue', JSON.stringify(completed_challenges || []), JSON.stringify(badges || []), total_xp || 0, userId]
      );
    }
    
    let rewardResult = null;
    if (shouldGrantReward && progressId) {
      rewardResult = await grantPythonMagicReward(userId, progressId);
    }

    const [rows] = await pool.query(
      'SELECT * FROM python_magic_progress WHERE user_id = ?',
      [userId]
    );
    const progress = rows[0];
    if (typeof progress.completed_challenges === 'string') {
      try { progress.completed_challenges = JSON.parse(progress.completed_challenges); } catch {}
    }
    if (typeof progress.badges === 'string') {
      try { progress.badges = JSON.parse(progress.badges); } catch {}
    }
    
    res.json({ data: progress, reward: rewardResult, error: null });
  } catch (error) {
    console.error('保存游戏进度失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 小智AI对话
app.post('/api/python-magic/chat', authenticate, async (req, res) => {
  try {
    const { message, chapter_id, context } = req.body;
    const userId = req.user.userId;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ data: null, error: '请输入问题' });
    }
    
    const config = await getAiQaConfig(pool);
    if (!config.ai_api_base_url || !config.ai_api_key) {
      return res.status(400).json({ data: null, error: 'AI API未配置，请联系管理员' });
    }
    
    const systemPrompt = `你是"小智"，Python魔法学院中的AI魔法伙伴。
你的设定：
- 你是一只友善、活泼的发光魔法生物，是玩家的AI伙伴
- 你生活在Python魔法学院中，熟悉学院的所有教授和课程
- 你用魔法世界和编程的比喻来讲解Python知识
- 你始终鼓励玩家，耐心解答每一个问题
- 当玩家卡住时，你给出提示而不是直接给答案
- 你的语言风格亲切、活泼，像一个热心的学长/学姐

当前玩家所在的魔法学院章节：${chapter_id || 0}（0=序章，1-7=对应章节）
${context ? '当前对话上下文：' + context : ''}

回答规则：
1. 用魔法/冒险的比喻来解释Python概念
2. 如果玩家在问代码问题，先引导思考，再给提示
3. 绝不直接给出完整答案代码，而是引导玩家自己写出代码
4. 回答简洁明了，适合中学生理解
5. 每次回复控制在100字以内`;
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ];
    
    const reply = await callAiApi(config, messages);
    
    res.json({ data: { reply }, error: null });
  } catch (error) {
    console.error('小智对话失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== Python魔法学院 API 结束 ====================

// ==================== 课堂任务模块 API 开始 ====================

// 课堂任务资源上传 multer 配置
const taskResourceStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const taskId = req.params.taskId;
    const dir = path.join(uploadsDir, 'tasks', taskId || 'temp');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // 修复中文文件名编码
    let originalName = file.originalname;
    try { originalName = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch {}
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  }
});

const taskResourceUpload = multer({
  storage: taskResourceStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowedExts = /\.(pdf|ppt|pptx|doc|docx|xls|xlsx|csv|jpg|jpeg|png|gif|webp|bmp|mp4|avi|mov|wmv|py|zip|rar|7z|html|htm|mdb|accdb)$/i;
    if (allowedExts.test(path.extname(file.originalname))) {
      return cb(null, true);
    }
    cb(new Error('不支持的文件类型'));
  }
});

// 辅助函数：安全解析 JSON
function taskSafeJsonParse(str, defaultVal) {
  if (str == null) return defaultVal;
  if (typeof str !== 'string') return str;
  try { return JSON.parse(str); } catch { return defaultVal; }
}

// 辅助函数：根据扩展名获取资源类型
function getTaskResourceType(ext) {
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  const map = {
    pdf: 'pdf',
    ppt: 'ppt', pptx: 'ppt',
    doc: 'word', docx: 'word',
    xls: 'excel', xlsx: 'excel', csv: 'excel',
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image',
    mp4: 'video', avi: 'video', mov: 'video', wmv: 'video',
    py: 'python',
    zip: 'zip', rar: 'zip', '7z': 'zip',
    html: 'html', htm: 'html',
    mdb: 'access', accdb: 'access'
  };
  return map[e] || 'file';
}

// 辅助函数：拼接资源完整 URL
// 统一返回相对路径 /uploads/...（数据库也只存相对路径），前端同源访问即可
function formatTaskResourceUrl(req, taskId, filePath) {
  if (!filePath) return null;
  return toRelativeUploadPath(filePath);
}

// 教师角色检查中间件
function requireTeacher(req, res, next) {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ data: null, error: '仅教师可访问该接口' });
  }
  next();
}

function requireStudent(req, res, next) {
  if (req.user.role !== 'student') {
    return res.status(403).json({ data: null, error: '仅学生可访问该接口' });
  }
  next();
}

// ===== 教师端接口 =====

// 0. 获取题库列表（支持标签/类型/关键词筛选和分页）
app.get('/api/teacher/questions', authenticate, requireTeacher, async (req, res) => {
  try {
    const { type, tag, keyword, page, pageSize } = req.query;
    let sql = 'SELECT id, type, content, options, answers, tags, explanation FROM questions WHERE 1=1';
    const params = [];
    if (type && type !== 'all') {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (tag) {
      sql += ' AND (tags IS NOT NULL AND JSON_CONTAINS(tags, JSON_QUOTE(?)))';
      params.push(tag);
    }
    if (keyword) {
      sql += ' AND content LIKE ?';
      params.push(`%${keyword}%`);
    }
    // 获取总数
    const countSql = sql.replace('SELECT id, type, content, options, answers, tags, explanation', 'SELECT COUNT(*) AS total');
    const [[{ total }]] = await pool.query(countSql, params);
    // 分页
    const pageNum = parseInt(page) || 1;
    const pageSizeNum = parseInt(pageSize) || 50;
    const offset = (pageNum - 1) * pageSizeNum;
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSizeNum, offset);
    const [rows] = await pool.query(sql, params);
    // 收集所有标签用于前端筛选
    const [allTagsRows] = await pool.query('SELECT DISTINCT tags FROM questions WHERE tags IS NOT NULL');
    const allTagsSet = new Set();
    allTagsRows.forEach(r => {
      if (r.tags) {
        try {
          const parsed = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
          if (Array.isArray(parsed)) parsed.forEach(t => allTagsSet.add(t));
        } catch {}
      }
    });
    res.json({ data: formatRows(rows), total, tags: Array.from(allTagsSet), page: pageNum, pageSize: pageSizeNum, error: null });
  } catch (error) {
    console.error('获取题库列表失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 1. 创建课堂任务
app.post('/api/teacher/tasks', authenticate, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { class_ids, title, learning_objectives, start_time, deadline, force_video_watch, min_study_duration, access_type, passing_score, pass_reward_points } = req.body;
    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    const accessKey = crypto.randomUUID().replace(/-/g, '').substr(0, 32);
    const accessTypeVal = access_type === 'public' ? 1 : 0;
    const classIdArr = Array.isArray(class_ids) ? class_ids : [];
    const firstClassId = classIdArr[0] || '';
    const minStudyDur = Math.max(0, parseInt(min_study_duration) || 0);
    const passingScore = Math.max(0, parseInt(passing_score) || 0);
    const passReward = Math.max(0, parseInt(pass_reward_points) || 0);
    const [result] = await pool.query(
      `INSERT INTO task_class (id, class_id, class_ids, teacher_id, title, learning_objectives, start_time, deadline, status, access_key, force_video_watch, min_study_duration, passing_score, pass_reward_points, access_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [taskId, firstClassId, JSON.stringify(classIdArr), teacherId, title, learning_objectives || null, start_time || null, deadline || null, accessKey, force_video_watch ? 1 : 0, minStudyDur, passingScore, passReward, accessTypeVal]
    );
    res.json({ data: { id: taskId, access_key: accessKey }, error: null });
  } catch (error) {
    console.error('创建课堂任务失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 2. 获取教师任务列表
app.get('/api/teacher/tasks', authenticate, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { status } = req.query;
    let sql = 'SELECT * FROM task_class WHERE teacher_id = ?';
    const params = [teacherId];
    if (status !== undefined && status !== '') {
      sql += ' AND status = ?';
      let statusVal = parseInt(status);
      if (isNaN(statusVal)) {
        const statusMap = { draft: 0, published: 1, archived: 2 };
        statusVal = statusMap[status] ?? 0;
      }
      params.push(statusVal);
    }
    sql += ' ORDER BY is_pinned DESC, created_at DESC';
    const [tasks] = await pool.query(sql, params);
    const enriched = await Promise.all(tasks.map(async (t) => {
      const [[r]] = await pool.query('SELECT COUNT(*) AS cnt FROM task_resource WHERE task_id = ?', [t.id]);
      const [[q]] = await pool.query('SELECT COUNT(*) AS cnt FROM task_question WHERE task_id = ?', [t.id]);
      const [[c]] = await pool.query('SELECT COUNT(*) AS cnt FROM task_study_log WHERE task_id = ? AND status = 2', [t.id]);
      // 计算总学生数
      const classIds = t.class_ids ? JSON.parse(t.class_ids) : (t.class_id ? [t.class_id] : []);
      let totalStudents = 0;
      if (classIds.length > 0) {
        const placeholders = classIds.map(() => '?').join(',');
        const [[s]] = await pool.query(`SELECT COUNT(*) AS cnt FROM profiles WHERE class_id IN (${placeholders}) AND role = 'student'`, classIds);
        totalStudents = s.cnt;
      }
      // 加上公开链接的访客提交数
      const [[gc]] = await pool.query('SELECT COUNT(*) AS cnt FROM task_study_log WHERE task_id = ? AND student_id LIKE "guest_%"', [t.id]);
      const completedStudents = c.cnt;
      const totalWithGuests = totalStudents + gc.cnt;
      const completionRate = totalWithGuests > 0 ? Math.round((completedStudents / totalWithGuests) * 100) : 0;
      return {
        ...t,
        resource_count: r.cnt,
        question_count: q.cnt,
        completed_count: completedStudents,
        completed_students: completedStudents,
        total_students: totalStudents,
        completion_rate: completionRate,
      };
    }));
    res.json({ data: enriched, error: null });
  } catch (error) {
    console.error('获取教师任务列表失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 3. 获取任务详情
app.get('/api/teacher/tasks/:taskId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT * FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    const [resources] = await pool.query('SELECT * FROM task_resource WHERE task_id = ? ORDER BY sort_order, created_at', [taskId]);
    // 格式化资源URL
    const formattedResources = resources.map(r => {
      let file_url = null;
      if (r.file_path) {
        const normalized = r.file_path.replace(/\\/g, '/').replace(/^.*\/uploads\//, '/uploads/');
        file_url = normalized;
      } else if (r.url) {
        file_url = r.url;
      }
      return { ...r, file_url, content: r.html_content || null };
    });
    const [questions] = await pool.query(
      `SELECT tq.*, q.type AS q_type, q.content AS q_content, q.options AS q_options, q.answers AS q_answers, q.explanation AS q_explanation
       FROM task_question tq
       LEFT JOIN questions q ON tq.question_id = q.id COLLATE utf8mb4_unicode_ci
       WHERE tq.task_id = ?
       ORDER BY tq.sort_order, tq.created_at`, [taskId]);
    const formattedQuestions = questions.map(q => {
      const isTemp = !q.question_id;
      const content = isTemp ? q.temp_content : q.q_content;
      const type = isTemp ? q.temp_type : q.q_type;
      const options = isTemp ? taskSafeJsonParse(q.temp_options, null) : taskSafeJsonParse(q.q_options, null);
      const answers = isTemp ? (q.temp_answer ? [q.temp_answer] : []) : taskSafeJsonParse(q.q_answers, []);
      const explanation = isTemp ? null : q.q_explanation;
      return { ...q, content, type, options, answers, explanation };
    });
    res.json({ data: { task, resources: formattedResources, questions: formattedQuestions }, error: null });
  } catch (error) {
    console.error('获取任务详情失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 4. 更新任务
app.put('/api/teacher/tasks/:taskId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const { title, learning_objectives, start_time, deadline, force_video_watch, min_study_duration, access_type, status, class_ids, passing_score, pass_reward_points } = req.body;
    const fields = [];
    const params = [];
    fields.push('title = ?');
    params.push(title);
    fields.push('learning_objectives = ?');
    params.push(learning_objectives || null);
    fields.push('start_time = ?');
    params.push(start_time || null);
    fields.push('deadline = ?');
    params.push(deadline || null);
    fields.push('force_video_watch = ?');
    params.push(force_video_watch ? 1 : 0);
    if (min_study_duration !== undefined) {
      fields.push('min_study_duration = ?');
      params.push(Math.max(0, parseInt(min_study_duration) || 0));
    }
    if (passing_score !== undefined) {
      fields.push('passing_score = ?');
      params.push(Math.max(0, parseInt(passing_score) || 0));
    }
    if (pass_reward_points !== undefined) {
      fields.push('pass_reward_points = ?');
      params.push(Math.max(0, parseInt(pass_reward_points) || 0));
    }
    fields.push('access_type = ?');
    params.push(access_type === 'public' ? 1 : (access_type === 'private' ? 0 : (access_type != null ? access_type : 0)));
    fields.push('status = ?');
    params.push(status != null ? status : 0);
    if (class_ids !== undefined) {
      fields.push('class_ids = ?');
      params.push(JSON.stringify(class_ids));
    }
    fields.push('updated_at = NOW()');
    params.push(taskId, teacherId);
    const [result] = await pool.query(
      `UPDATE task_class SET ${fields.join(', ')} WHERE id = ? AND teacher_id = ?`,
      params
    );
    if (result.affectedRows === 0) return res.status(404).json({ data: null, error: '任务不存在' });
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('更新任务失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 5. 删除任务
app.delete('/api/teacher/tasks/:taskId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT id FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    const [resources] = await pool.query('SELECT file_path FROM task_resource WHERE task_id = ?', [taskId]);
    resources.forEach(r => {
      const absPath = resolveUploadPath(r.file_path);
      if (absPath && fs.existsSync(absPath)) {
        try { fs.unlinkSync(absPath); } catch {}
      }
    });
    const taskDir = path.join(uploadsDir, 'tasks', taskId);
    if (fs.existsSync(taskDir)) {
      try { fs.rmSync(taskDir, { recursive: true, force: true }); } catch {}
    }
    await pool.query('DELETE FROM task_resource WHERE task_id = ?', [taskId]);
    await pool.query('DELETE FROM task_question WHERE task_id = ?', [taskId]);
    await pool.query('DELETE FROM task_study_log WHERE task_id = ?', [taskId]);
    await pool.query('DELETE FROM task_class WHERE id = ?', [taskId]);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('删除任务失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 6. 上传资源
app.post('/api/teacher/tasks/:taskId/resources', authenticate, requireTeacher, (req, res, next) => {
  taskResourceUpload.array('files', 20)(req, res, (err) => {
    if (err) {
      console.error('Multer上传错误:', err);
      return res.status(400).json({ data: null, error: '文件上传失败: ' + (err.message || '未知错误') });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT id FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    const files = req.files || [];
    const created = [];
    for (const file of files) {
      // 修复中文文件名编码：multer 默认 latin1，需转为 utf8
      let originalName = file.originalname;
      try {
        originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      } catch {}
      const ext = path.extname(originalName);
      const type = getTaskResourceType(ext);
      let htmlContent = null;
      if (type === 'html') {
        try { htmlContent = fs.readFileSync(file.path, 'utf-8'); } catch { htmlContent = null; }
      }
      if (type !== 'video' && file.size > 50 * 1024 * 1024) {
        try { fs.unlinkSync(file.path); } catch {}
        continue;
      }
      const resourceId = 'res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
      // 统一存相对路径 /uploads/...，避免绑定开发环境绝对路径
      const relativePath = toRelativeUploadPath(file.path);
      const [r] = await pool.query(
        `INSERT INTO task_resource (id, task_id, type, file_path, original_filename, title, html_content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [resourceId, taskId, type, relativePath, originalName, originalName, htmlContent]
      );
      created.push({ id: resourceId, type, file_path: relativePath, url: formatTaskResourceUrl(req, taskId, relativePath), original_filename: originalName, title: originalName });
    }
    if (files.length === 0 && req.body) {
      const { type, url, title, html_content } = req.body;
      if (type === 'link' && url) {
        const resourceId = 'res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        const [r] = await pool.query(
          `INSERT INTO task_resource (id, task_id, type, url, title, created_at) VALUES (?, ?, 'link', ?, ?, NOW())`,
          [resourceId, taskId, url, title || '外链资源']
        );
        created.push({ id: resourceId, type: 'link', url, title: title || '外链资源' });
      } else if (type === 'html' && html_content) {
        const resourceId = 'res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        const [r] = await pool.query(
          `INSERT INTO task_resource (id, task_id, type, html_content, title, created_at) VALUES (?, ?, 'html', ?, ?, NOW())`,
          [resourceId, taskId, html_content, title || 'HTML资源']
        );
        created.push({ id: resourceId, type: 'html', html_content, title: title || 'HTML资源' });
      }
    }
    res.json({ data: created, error: null });
  } catch (error) {
    console.error('上传任务资源失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 7. 资源排序
app.put('/api/teacher/tasks/:taskId/resources/sort', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { resources } = req.body;
    for (const r of (resources || [])) {
      await pool.query('UPDATE task_resource SET sort_order = ? WHERE id = ? AND task_id = ?', [r.sort_order, r.id, taskId]);
    }
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('资源排序失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 8. 删除资源
app.delete('/api/teacher/tasks/:taskId/resources/:resourceId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId, resourceId } = req.params;
    const [[resource]] = await pool.query('SELECT file_path FROM task_resource WHERE id = ? AND task_id = ?', [resourceId, taskId]);
    const resourceAbsPath = resource ? resolveUploadPath(resource.file_path) : null;
    if (resourceAbsPath && fs.existsSync(resourceAbsPath)) {
      try { fs.unlinkSync(resourceAbsPath); } catch {}
    }
    await pool.query('DELETE FROM task_resource WHERE id = ? AND task_id = ?', [resourceId, taskId]);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('删除资源失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 9. 添加题目
app.post('/api/teacher/tasks/:taskId/questions', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT id FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    const { question_id, score, temp_content, temp_type, temp_options, temp_answer } = req.body;
    const questionId = 'tq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    let result;
    if (question_id) {
      [result] = await pool.query(
        `INSERT INTO task_question (id, task_id, question_id, score, created_at) VALUES (?, ?, ?, ?, NOW())`,
        [questionId, taskId, question_id, score || 0]
      );
    } else {
      [result] = await pool.query(
        `INSERT INTO task_question (id, task_id, question_id, score, temp_content, temp_type, temp_options, temp_answer, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NOW())`,
        [questionId, taskId, score || 0, temp_content, temp_type, temp_options ? JSON.stringify(temp_options) : null, temp_answer]
      );
    }
    res.json({ data: { id: questionId }, error: null });
  } catch (error) {
    console.error('添加题目失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 10. 删除题目
app.delete('/api/teacher/tasks/:taskId/questions/:questionId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId, questionId } = req.params;
    await pool.query('DELETE FROM task_question WHERE id = ? AND task_id = ?', [questionId, taskId]);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('删除题目失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 11. 发布任务
app.post('/api/teacher/tasks/:taskId/publish', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT * FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    let accessKey = task.access_key;
    if (!accessKey) {
      accessKey = crypto.randomUUID().replace(/-/g, '').substr(0, 32);
    }
    const startTime = task.start_time || new Date();
    await pool.query(
      `UPDATE task_class SET status = 1, access_key = ?, start_time = COALESCE(start_time, ?), updated_at = NOW() WHERE id = ?`,
      [accessKey, startTime, taskId]
    );
    res.json({ data: { success: true, access_key: accessKey }, error: null });
  } catch (error) {
    console.error('发布任务失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 11.5 置顶/取消置顶任务
app.put('/api/teacher/tasks/:taskId/pin', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const isPinned = req.body && req.body.is_pinned ? 1 : 0;
    const [result] = await pool.query(
      'UPDATE task_class SET is_pinned = ?, updated_at = NOW() WHERE id = ? AND teacher_id = ?',
      [isPinned, taskId, teacherId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ data: null, error: '任务不存在' });
    res.json({ data: { success: true, is_pinned: isPinned }, error: null });
  } catch (error) {
    console.error('设置任务置顶失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 12. 复制任务
app.post('/api/teacher/tasks/:taskId/duplicate', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT * FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    const newTaskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    const newAccessKey = crypto.randomUUID().replace(/-/g, '').substr(0, 32);
    await pool.query(
      `INSERT INTO task_class (id, class_id, class_ids, teacher_id, title, learning_objectives, start_time, deadline, status, access_key, force_video_watch, min_study_duration, access_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NOW(), NOW())`,
      [newTaskId, task.class_id, task.class_ids, teacherId, (task.title || '') + '_副本', task.learning_objectives, null, null, newAccessKey, task.force_video_watch, task.min_study_duration || 0, task.access_type]
    );
    const [resources] = await pool.query('SELECT * FROM task_resource WHERE task_id = ?', [taskId]);
    for (const r of resources) {
      const newResourceId = 'res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
      await pool.query(
        `INSERT INTO task_resource (id, task_id, type, file_path, url, html_content, original_filename, title, sort_order, duration, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [newResourceId, newTaskId, r.type, r.file_path, r.url, r.html_content, r.original_filename, r.title, r.sort_order, r.duration]
      );
    }
    const [questions] = await pool.query('SELECT * FROM task_question WHERE task_id = ?', [taskId]);
    for (const q of questions) {
      const newQuestionId = 'tq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
      await pool.query(
        `INSERT INTO task_question (id, task_id, question_id, score, sort_order, temp_content, temp_type, temp_options, temp_answer, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [newQuestionId, newTaskId, q.question_id, q.score, q.sort_order, q.temp_content, q.temp_type, q.temp_options, q.temp_answer]
      );
    }
    res.json({ data: { id: newTaskId, access_key: newAccessKey }, error: null });
  } catch (error) {
    console.error('复制任务失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 13. 获取学生完成数据
app.get('/api/teacher/tasks/:taskId/students', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT class_id, class_ids FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    const classIds = task.class_ids ? JSON.parse(task.class_ids) : (task.class_id ? [task.class_id] : []);
    const result = [];
    // 查询班级内学生
    if (classIds.length > 0) {
      const placeholders = classIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT p.id AS student_id, p.real_name, p.username, p.class_id,
                COALESCE(tsl.status, 0) AS status_num,
                COALESCE(tsl.total_score, 0) AS total_score,
                tsl.submit_time,
                COALESCE(tsl.watch_duration, 0) AS watch_duration,
                tsl.answers,
                c.name AS class_name
         FROM profiles p
         LEFT JOIN classes c ON p.class_id = c.id COLLATE utf8mb4_unicode_ci
         LEFT JOIN task_study_log tsl ON tsl.student_id = p.id COLLATE utf8mb4_unicode_ci AND tsl.task_id = ?
         WHERE p.class_id IN (${placeholders}) AND p.role = 'student'
         ORDER BY p.class_id, p.id`,
        [taskId, ...classIds]
      );
      const statusMap = { 0: 'not_started', 1: 'in_progress', 2: 'completed' };
      rows.forEach(r => {
        result.push({
          student_id: r.student_id,
          real_name: r.real_name,
          username: r.username,
          class_name: r.class_name,
          status: statusMap[r.status_num] || 'not_started',
          score: r.total_score,
          submitted_at: r.submit_time,
          watch_duration: r.watch_duration,
          answers: r.answers,
        });
      });
    }
    // 查询公开链接提交的访客记录（student_id 以 guest_ 开头）
    const [guestRows] = await pool.query(
      `SELECT id AS log_id, student_id, total_score, submit_time, watch_duration, answers
       FROM task_study_log
       WHERE task_id = ? AND student_id LIKE 'guest_%'
       ORDER BY submit_time DESC`,
      [taskId]
    );
    guestRows.forEach(r => {
      const match = r.student_id.match(/^guest_([^_]+)_\d+$/);
      const guestName = match ? match[1] : r.student_id.replace('guest_', '').slice(-6);
      result.push({
        student_id: r.student_id,
        real_name: '访客-' + guestName,
        username: r.student_id,
        class_name: '公开链接',
        status: 'completed',
        score: r.total_score,
        submitted_at: r.submit_time,
        watch_duration: r.watch_duration || 0,
        answers: r.answers,
      });
    });
    res.json({ data: result, error: null });
  } catch (error) {
    console.error('获取学生完成数据失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 13b. 获取任务分析数据（题目列表+学生答题详情+正确率统计）
app.get('/api/teacher/tasks/:taskId/analysis', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT class_id, class_ids FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });

    // 获取题目列表
    const [taskQuestions] = await pool.query(
      `SELECT tq.id AS tq_id, tq.question_id, tq.score, tq.sort_order, tq.temp_content, tq.temp_type, tq.temp_options, tq.temp_answer,
              q.type AS q_type, q.content AS q_content, q.options AS q_options, q.answers AS q_answers, q.explanation AS q_explanation
       FROM task_question tq
       LEFT JOIN questions q ON tq.question_id = q.id COLLATE utf8mb4_unicode_ci
       WHERE tq.task_id = ?
       ORDER BY tq.sort_order, tq.created_at`, [taskId]);

    const questions = taskQuestions.map((q, idx) => {
      const isTemp = !q.question_id;
      const content = isTemp ? q.temp_content : q.q_content;
      const type = isTemp ? q.temp_type : q.q_type;
      const options = isTemp ? taskSafeJsonParse(q.temp_options, null) : taskSafeJsonParse(q.q_options, null);
      const answers = isTemp ? (q.temp_answer ? taskGetAnswersArray(q.temp_answer) : []) : taskGetAnswersArray(q.q_answers);
      const explanation = isTemp ? null : q.q_explanation;
      return {
        tq_id: q.tq_id,
        question_id: q.question_id,
        index: idx,
        content,
        type: type || 'fill_blank',
        options,
        correct_answers: answers,
        score: q.score,
        explanation,
      };
    });

    // 获取学生列表（含答题数据）
    const classIds = task.class_ids ? JSON.parse(task.class_ids) : (task.class_id ? [task.class_id] : []);
    const students = [];

    if (classIds.length > 0) {
      const placeholders = classIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT p.id AS student_id, p.real_name, p.username,
                COALESCE(tsl.status, 0) AS status_num,
                COALESCE(tsl.total_score, 0) AS total_score,
                tsl.submit_time,
                tsl.answers
         FROM profiles p
         LEFT JOIN task_study_log tsl ON tsl.student_id = p.id COLLATE utf8mb4_unicode_ci AND tsl.task_id = ?
         WHERE p.class_id IN (${placeholders}) AND p.role = 'student'
         ORDER BY p.class_id, p.id`,
        [taskId, ...classIds]
      );
      const statusMap = { 0: 'not_started', 1: 'in_progress', 2: 'completed' };
      rows.forEach(r => {
        students.push({
          student_id: r.student_id,
          real_name: r.real_name,
          username: r.username,
          status: statusMap[r.status_num] || 'not_started',
          score: r.total_score,
          submitted_at: r.submit_time,
          answers: r.answers,
        });
      });
    }

    // 公开链接提交的访客
    const [guestRows] = await pool.query(
      `SELECT id AS log_id, student_id, total_score, submit_time, answers
       FROM task_study_log
       WHERE task_id = ? AND student_id LIKE 'guest_%'
       ORDER BY submit_time DESC`,
      [taskId]
    );
    guestRows.forEach(r => {
      const match = r.student_id.match(/^guest_([^_]+)_\d+$/);
      const guestName = match ? match[1] : r.student_id.replace('guest_', '').slice(-6);
      students.push({
        student_id: r.student_id,
        real_name: '访客-' + guestName,
        username: r.student_id,
        status: 'completed',
        score: r.total_score,
        submitted_at: r.submit_time,
        answers: r.answers,
      });
    });

    // 评估每个学生的答题正确性
    const studentResults = students.map(s => {
      let parsedAnswers = [];
      try {
        parsedAnswers = s.answers ? JSON.parse(s.answers) : [];
      } catch { parsedAnswers = []; }
      const answersMap = {};
      parsedAnswers.forEach(a => {
        answersMap[a.question_id || a.tq_id] = a.answer;
      });

      const questionResults = questions.map(q => {
        const key = q.question_id || q.tq_id;
        const studentAnswer = answersMap[key] !== undefined ? answersMap[key] : answersMap[q.tq_id];
        const isCorrect = studentAnswer !== undefined && taskCheckAnswerCorrect(studentAnswer, q.type, q.correct_answers, q.options);
        return {
          tq_id: q.tq_id,
          question_id: q.question_id,
          student_answer: studentAnswer !== undefined ? String(studentAnswer) : null,
          is_correct: isCorrect,
          answered: studentAnswer !== undefined,
        };
      });

      return {
        student_id: s.student_id,
        real_name: s.real_name,
        username: s.username,
        status: s.status,
        score: s.score,
        submitted_at: s.submitted_at,
        question_results: questionResults,
      };
    });

    // 计算每题正确率（只统计已作答的学生）
    const questionStats = questions.map(q => {
      const answeredStudents = studentResults.filter(s => {
        const qr = s.question_results.find(r => r.tq_id === q.tq_id);
        return qr && qr.answered;
      });
      const correctCount = answeredStudents.filter(s => {
        const qr = s.question_results.find(r => r.tq_id === q.tq_id);
        return qr && qr.is_correct;
      }).length;
      return {
        tq_id: q.tq_id,
        question_id: q.question_id,
        index: q.index,
        content: q.content ? (q.content.length > 80 ? q.content.substring(0, 80) + '...' : q.content) : '',
        type: q.type,
        score: q.score,
        correct_count: correctCount,
        answered_count: answeredStudents.length,
        total_students: studentResults.length,
        correct_rate: answeredStudents.length > 0 ? Math.round((correctCount / answeredStudents.length) * 100) : 0,
      };
    });

    res.json({ data: { questions, students: studentResults, question_stats: questionStats }, error: null });
  } catch (error) {
    console.error('获取任务分析数据失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 14. 导出成绩 CSV
app.get('/api/teacher/tasks/:taskId/export', authenticate, requireTeacher, async (req, res) => {
  try {
    const { taskId } = req.params;
    const teacherId = req.user.userId;
    const [[task]] = await pool.query('SELECT class_id, class_ids, title FROM task_class WHERE id = ? AND teacher_id = ?', [taskId, teacherId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    const classIds = task.class_ids ? JSON.parse(task.class_ids) : (task.class_id ? [task.class_id] : []);
    if (classIds.length === 0) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=task_${taskId}_scores_${new Date().toISOString().slice(0, 10)}.csv`);
      res.send('\uFEFF班级,学生姓名,用户名,完成状态,得分,提交时间,观看时长(秒)\n');
      return;
    }
    const placeholders = classIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT p.id AS student_id, p.real_name, p.username, p.class_id,
              COALESCE(tsl.status, 0) AS status,
              COALESCE(tsl.total_score, 0) AS total_score,
              tsl.submit_time,
              COALESCE(tsl.watch_duration, 0) AS watch_duration,
              c.name AS class_name
       FROM profiles p
       LEFT JOIN classes c ON p.class_id = c.id COLLATE utf8mb4_unicode_ci
       LEFT JOIN task_study_log tsl ON tsl.student_id = p.id COLLATE utf8mb4_unicode_ci AND tsl.task_id = ?
       WHERE p.class_id IN (${placeholders}) AND p.role = 'student'
       ORDER BY p.class_id, p.id`,
      [taskId, ...classIds]
    );
    const statusText = (s) => ['未开始', '进行中', '已完成', '已逾期'][s] || String(s);
    let csv = '\uFEFF';
    csv += '班级,学生姓名,用户名,完成状态,得分,提交时间,观看时长(秒)\n';
    for (const r of rows) {
      csv += `"${(r.class_name || '').replace(/"/g, '""')}","${(r.real_name || '').replace(/"/g, '""')}","${(r.username || '').replace(/"/g, '""')}","${statusText(r.status)}",${r.total_score},${r.submit_time ? new Date(r.submit_time).toLocaleString('zh-CN') : ''},${r.watch_duration}\n`;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=task_${taskId}_scores_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('导出成绩失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ===== 学生端接口 =====

// 15. 获取本班任务列表
app.get('/api/student/tasks', authenticate, async (req, res) => {
  try {
    const studentId = req.user.userId;
    const classId = req.user.classId;
    const [tasks] = await pool.query(
      `SELECT t.*, p.real_name AS teacher_name
       FROM task_class t
       LEFT JOIN profiles p ON t.teacher_id = p.id COLLATE utf8mb4_unicode_ci
       WHERE t.status = 1 AND ( (t.class_ids IS NOT NULL AND JSON_CONTAINS(t.class_ids, JSON_QUOTE(?))) OR t.class_id = ? )
       ORDER BY t.is_pinned DESC, t.created_at DESC`,
      [classId, classId]
    );
    const [logs] = await pool.query(
      'SELECT task_id, status, total_score, submit_time, answers FROM task_study_log WHERE student_id = ?',
      [studentId]
    );
    const logMap = {};
    logs.forEach(l => { logMap[l.task_id] = l; });
    const enriched = tasks.map(t => {
      const log = logMap[t.id] || { status: 0, total_score: 0, submit_time: null };
      return {
        ...t,
        teacher_name: t.teacher_name || '未知教师',
        study_status: log.status,
        study_total_score: log.total_score,
        study_submit_time: log.submit_time,
        study_log: log
      };
    });
    res.json({ data: enriched, error: null });
  } catch (error) {
    console.error('获取学生任务列表失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 16. 获取任务详情
app.get('/api/student/tasks/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const studentId = req.user.userId;
    const classId = req.user.classId;
    const [[task]] = await pool.query('SELECT * FROM task_class WHERE id = ?', [taskId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    const taskClassIds = task.class_ids ? JSON.parse(task.class_ids) : (task.class_id ? [String(task.class_id)] : []);
    if (!taskClassIds.includes(String(classId))) {
      return res.status(403).json({ data: null, error: '无权访问该任务' });
    }
    const [resources] = await pool.query('SELECT * FROM task_resource WHERE task_id = ? ORDER BY sort_order, created_at', [taskId]);
    // 格式化资源：拼接可访问的 file_url，映射 html_content 到 content
    const formattedResources = resources.map(r => {
      let file_url = null;
      if (r.file_path) {
        const normalized = r.file_path.replace(/\\/g, '/').replace(/^.*\/uploads\//, '/uploads/');
        file_url = normalized;
      } else if (r.url) {
        file_url = r.url;
      }
      return { ...r, file_url, content: r.html_content || null };
    });
    const [questions] = await pool.query(
      `SELECT tq.id, tq.task_id, tq.question_id, tq.score, tq.sort_order, tq.temp_content, tq.temp_type, tq.temp_options, tq.temp_answer,
              q.type AS q_type, q.content AS q_content, q.options AS q_options, q.answers AS q_answers, q.explanation AS q_explanation
       FROM task_question tq
       LEFT JOIN questions q ON tq.question_id = q.id COLLATE utf8mb4_unicode_ci
       WHERE tq.task_id = ?
       ORDER BY tq.sort_order, tq.created_at`, [taskId]);
    // 映射题目字段：题库题用 q_ 前缀字段，临时题用 temp_ 前缀字段，统一输出为 content/type/options/answers/explanation
    const formattedQuestions = questions.map(q => {
      const isTemp = !q.question_id;
      const content = isTemp ? q.temp_content : q.q_content;
      const type = isTemp ? q.temp_type : q.q_type;
      const options = isTemp ? taskSafeJsonParse(q.temp_options, null) : taskSafeJsonParse(q.q_options, null);
      const answers = isTemp ? (q.temp_answer ? [q.temp_answer] : []) : taskSafeJsonParse(q.q_answers, []);
      const explanation = isTemp ? null : q.q_explanation;
      return { ...q, content, type, options, answers, explanation };
    });
    const [[log]] = await pool.query('SELECT * FROM task_study_log WHERE student_id = ? AND task_id = ?', [studentId, taskId]);
    res.json({ data: { task, resources: formattedResources, questions: formattedQuestions, study_log: log || null }, error: null });
  } catch (error) {
    console.error('获取学生任务详情失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 17. 更新观看/浏览进度
app.post('/api/student/tasks/:taskId/progress', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const studentId = req.user.userId;
    const { video_progress, resources_viewed, watch_duration } = req.body;

    const [[existing]] = await pool.query(
      'SELECT * FROM task_study_log WHERE student_id = ? AND task_id = ?',
      [studentId, taskId]
    );

    let finalVideoProgress = null;
    let finalResourcesViewed = null;
    let finalWatchDuration = null;
    let finalStatus = existing ? existing.status : 0;

    if (video_progress != null) {
      const newVp = Number(video_progress) || 0;
      let oldVp = 0;
      if (existing && existing.video_progress != null) {
        try {
          const parsed = typeof existing.video_progress === 'string'
            ? JSON.parse(existing.video_progress)
            : existing.video_progress;
          oldVp = Number(parsed) || 0;
        } catch {
          oldVp = 0;
        }
      }
      finalVideoProgress = JSON.stringify(Math.max(oldVp, newVp));
    }

    if (resources_viewed != null) {
      let newRv = [];
      try {
        newRv = Array.isArray(resources_viewed) ? resources_viewed : JSON.parse(resources_viewed);
      } catch {
        newRv = [];
      }
      let oldRv = [];
      if (existing && existing.resources_viewed != null) {
        try {
          const parsed = typeof existing.resources_viewed === 'string'
            ? JSON.parse(existing.resources_viewed)
            : existing.resources_viewed;
          oldRv = Array.isArray(parsed) ? parsed : [];
        } catch {
          oldRv = [];
        }
      }
      const merged = Array.from(new Set([...oldRv, ...newRv]));
      finalResourcesViewed = JSON.stringify(merged);
    }

    if (watch_duration != null) {
      const newWd = Number(watch_duration) || 0;
      const oldWd = existing && existing.watch_duration != null ? Number(existing.watch_duration) || 0 : 0;
      finalWatchDuration = Math.max(oldWd, newWd);
    }

    if (finalStatus === 0) finalStatus = 1;

    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    const fields = ['id', 'student_id', 'task_id', 'status', 'created_at', 'updated_at'];
    const values = [logId, studentId, taskId, finalStatus, 'NOW()', 'NOW()'];
    const placeholders = ['?', '?', '?', '?', 'NOW()', 'NOW()'];
    const params = [logId, studentId, taskId, finalStatus];

    if (finalVideoProgress != null) {
      fields.push('video_progress');
      values.push('?');
      placeholders.push('?');
      params.push(finalVideoProgress);
    }
    if (finalResourcesViewed != null) {
      fields.push('resources_viewed');
      values.push('?');
      placeholders.push('?');
      params.push(finalResourcesViewed);
    }
    if (finalWatchDuration != null) {
      fields.push('watch_duration');
      values.push('?');
      placeholders.push('?');
      params.push(finalWatchDuration);
    }

    const updateFields = ['status = VALUES(status)', 'updated_at = NOW()'];
    if (finalVideoProgress != null) updateFields.push('video_progress = VALUES(video_progress)');
    if (finalResourcesViewed != null) updateFields.push('resources_viewed = VALUES(resources_viewed)');
    if (finalWatchDuration != null) updateFields.push('watch_duration = VALUES(watch_duration)');

    await pool.query(
      `INSERT INTO task_study_log (${fields.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON DUPLICATE KEY UPDATE ${updateFields.join(', ')}`,
      params
    );

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('更新学习进度失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

function taskNormalizeAnswer(ans) {
  return (ans || '').toLowerCase().trim();
}

function taskGetAnswersArray(ansField) {
  if (!ansField) return [];
  let parsed;
  try {
    parsed = typeof ansField === 'string' ? JSON.parse(ansField) : ansField;
  } catch {
    parsed = ansField;
  }
  if (Array.isArray(parsed?.answers)) return parsed.answers;
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'string') return [parsed];
  return [];
}

function taskGetOptionsArray(optField) {
  if (!optField) return [];
  let parsed;
  try {
    parsed = typeof optField === 'string' ? JSON.parse(optField) : optField;
  } catch {
    parsed = optField;
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed?.options && Array.isArray(parsed.options)) return parsed.options;
  return [];
}

function taskCheckAnswerCorrect(userAnswer, questionType, correctAnswers, options) {
  const normUser = taskNormalizeAnswer(userAnswer);
  const answers = taskGetAnswersArray(correctAnswers);
  const opts = taskGetOptionsArray(options);
  
  if (questionType === 'fill_blank') {
    return answers.some(a => taskNormalizeAnswer(a) === normUser);
  }
  
  if (questionType === 'choice' || questionType === 'multiple_choice') {
    const isMultiple = questionType === 'multiple_choice' || answers.length > 1;
    
    if (isMultiple) {
      const userList = (userAnswer || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).sort();
      let correctList = [];
      
      const allLetterAnswers = answers.every(a => /^[A-Z]$/i.test(taskNormalizeAnswer(a)));
      if (allLetterAnswers) {
        correctList = answers.map(a => taskNormalizeAnswer(a).toUpperCase()).sort();
      } else {
        answers.forEach(a => {
          const idx = opts.findIndex(o => taskNormalizeAnswer(o) === taskNormalizeAnswer(a));
          if (idx >= 0) {
            correctList.push(String.fromCharCode(65 + idx));
          }
        });
        correctList.sort();
      }
      
      return userList.length === correctList.length && userList.every((v, i) => v === correctList[i]);
    } else {
      const isLetterAnswer = /^[A-Z]$/i.test(normUser);
      
      if (answers.some(a => taskNormalizeAnswer(a) === normUser)) {
        return true;
      }
      
      if (isLetterAnswer && opts.length > 0) {
        const idx = normUser.toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < opts.length) {
          const optionText = taskNormalizeAnswer(opts[idx]);
          return answers.some(a => taskNormalizeAnswer(a) === optionText);
        }
      }
      
      if (!isLetterAnswer && opts.length > 0) {
        return answers.some(a => {
          const normAns = taskNormalizeAnswer(a);
          const ansIdx = opts.findIndex(o => taskNormalizeAnswer(o) === normAns);
          return ansIdx >= 0 && taskNormalizeAnswer(opts[ansIdx]) === normUser;
        });
      }
      
      return false;
    }
  }
  
  return answers.some(a => taskNormalizeAnswer(a) === normUser);
}

// 18. 提交答题
app.post('/api/student/tasks/:taskId/submit', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const studentId = req.user.userId;
    const { answers } = req.body;
    const [taskQuestions] = await pool.query(
      `SELECT tq.id AS tq_id, tq.question_id, tq.score, tq.temp_type, tq.temp_answer, tq.temp_options,
              q.type AS q_type, q.answers AS q_answers, q.options AS q_options
       FROM task_question tq
       LEFT JOIN questions q ON tq.question_id = q.id COLLATE utf8mb4_unicode_ci
       WHERE tq.task_id = ?`, [taskId]);
    let totalScore = 0;
    const answerResults = [];
    const answersMap = {};
    (answers || []).forEach(a => { answersMap[a.question_id || a.tq_id] = a.answer; });
    for (const tq of taskQuestions) {
      const studentAnswer = answersMap[tq.question_id] !== undefined ? answersMap[tq.question_id] : answersMap[tq.tq_id];
      let correct = false;
      if (tq.question_id) {
        correct = taskCheckAnswerCorrect(studentAnswer, tq.q_type, tq.q_answers, tq.q_options);
      } else {
        const tempType = tq.temp_type || 'fill_blank';
        correct = taskCheckAnswerCorrect(studentAnswer, tempType, tq.temp_answer, tq.temp_options);
      }
      if (correct) totalScore += Number(tq.score) || 0;
      answerResults.push({ question_id: tq.question_id || tq.tq_id, correct, score: correct ? Number(tq.score) : 0 });
    }
    const answersJson = JSON.stringify(answers || []);
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    await pool.query(
      `INSERT INTO task_study_log (id, student_id, task_id, answers, total_score, submit_time, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), 2, NOW(), NOW())
       ON DUPLICATE KEY UPDATE answers = VALUES(answers), total_score = VALUES(total_score), submit_time = VALUES(submit_time), status = VALUES(status), updated_at = NOW()`,
      [logId, studentId, taskId, answersJson, totalScore]
    );
    res.json({ data: { total_score: totalScore, answers: answerResults.map(r => ({ question_id: r.question_id, is_correct: r.correct, score: r.score })), results: answerResults }, error: null });
  } catch (error) {
    console.error('提交答题失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 19. 获取公开链接
app.get('/api/student/tasks/:taskId/access', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const [[task]] = await pool.query('SELECT access_key, access_type FROM task_class WHERE id = ?', [taskId]);
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    res.json({ data: task, error: null });
  } catch (error) {
    console.error('获取公开链接失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ===== 公开访问接口（无需认证）=====

// 20. 通过密钥或任务ID访问任务
app.get('/api/task-public/:accessKey', async (req, res) => {
  try {
    const { accessKey } = req.params;
    // 先尝试用access_key查询，再用id查询
    let [[task]] = await pool.query('SELECT * FROM task_class WHERE access_key = ?', [accessKey]);
    if (!task) {
      [[task]] = await pool.query('SELECT * FROM task_class WHERE id = ? AND status = 1', [accessKey]);
    }
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    if (Number(task.access_type) !== 1) {
      return res.status(403).json({ data: null, error: '该任务未公开' });
    }
    const [resources] = await pool.query('SELECT * FROM task_resource WHERE task_id = ? ORDER BY sort_order, created_at', [task.id]);
    // 格式化资源URL
    const formattedResources = resources.map(r => {
      let file_url = null;
      if (r.file_path) {
        const normalized = r.file_path.replace(/\\/g, '/').replace(/^.*\/uploads\//, '/uploads/');
        file_url = normalized;
      } else if (r.url) {
        file_url = r.url;
      }
      return { ...r, file_url, content: r.html_content || null };
    });
    const [questions] = await pool.query(
      `SELECT tq.id, tq.task_id, tq.question_id, tq.score, tq.sort_order, tq.temp_content, tq.temp_type, tq.temp_options, tq.temp_answer,
              q.type AS q_type, q.content AS q_content, q.options AS q_options, q.answers AS q_answers, q.explanation AS q_explanation
       FROM task_question tq
       LEFT JOIN questions q ON tq.question_id = q.id COLLATE utf8mb4_unicode_ci
       WHERE tq.task_id = ?
       ORDER BY tq.sort_order, tq.created_at`, [task.id]);
    const formattedQuestions = questions.map(q => {
      const isTemp = !q.question_id;
      const content = isTemp ? q.temp_content : q.q_content;
      const type = isTemp ? q.temp_type : q.q_type;
      const options = isTemp ? taskSafeJsonParse(q.temp_options, null) : taskSafeJsonParse(q.q_options, null);
      const answers = isTemp ? (q.temp_answer ? [q.temp_answer] : []) : taskSafeJsonParse(q.q_answers, []);
      const explanation = isTemp ? null : q.q_explanation;
      return { ...q, content, type, options, answers, explanation };
    });
    res.json({ data: { task, resources: formattedResources, questions: formattedQuestions }, error: null });
  } catch (error) {
    console.error('公开访问任务失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 21. 公开提交答题
app.post('/api/task-public/:accessKey/submit', async (req, res) => {
  try {
    const { accessKey } = req.params;
    const { student_id, answers } = req.body;
    let [[task]] = await pool.query('SELECT id, access_type FROM task_class WHERE access_key = ?', [accessKey]);
    if (!task) {
      [[task]] = await pool.query('SELECT id, access_type FROM task_class WHERE id = ? AND status = 1', [accessKey]);
    }
    if (!task) return res.status(404).json({ data: null, error: '任务不存在' });
    if (Number(task.access_type) !== 1) {
      return res.status(403).json({ data: null, error: '该任务未公开' });
    }
    const taskId = task.id;
    const safeStudentId = (student_id || '').startsWith('guest_') ? student_id : `guest_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const [taskQuestions] = await pool.query(
      `SELECT tq.id AS tq_id, tq.question_id, tq.score, tq.temp_type, tq.temp_answer, tq.temp_options,
              q.type AS q_type, q.answers AS q_answers, q.options AS q_options
       FROM task_question tq
       LEFT JOIN questions q ON tq.question_id = q.id COLLATE utf8mb4_unicode_ci
       WHERE tq.task_id = ?`, [taskId]);
    let totalScore = 0;
    const answerResults = [];
    const answersMap = {};
    (answers || []).forEach(a => { answersMap[a.question_id || a.tq_id] = a.answer; });
    for (const tq of taskQuestions) {
      const studentAnswer = answersMap[tq.question_id] !== undefined ? answersMap[tq.question_id] : answersMap[tq.tq_id];
      let correct = false;
      if (tq.question_id) {
        correct = taskCheckAnswerCorrect(studentAnswer, tq.q_type, tq.q_answers, tq.q_options);
      } else {
        const tempType = tq.temp_type || 'fill_blank';
        correct = taskCheckAnswerCorrect(studentAnswer, tempType, tq.temp_answer, tq.temp_options);
      }
      if (correct) totalScore += Number(tq.score) || 0;
      answerResults.push({ question_id: tq.question_id || tq.tq_id, correct, score: correct ? Number(tq.score) : 0 });
    }
    const answersJson = JSON.stringify(answers || []);
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    await pool.query(
      `INSERT INTO task_study_log (id, student_id, task_id, answers, total_score, submit_time, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), 2, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         answers = VALUES(answers),
         total_score = VALUES(total_score),
         submit_time = NOW(),
         status = 2,
         updated_at = NOW()`,
      [logId, safeStudentId, taskId, answersJson, totalScore]
    );
    res.json({ data: { total_score: totalScore, answers: answerResults.map(r => ({ question_id: r.question_id, is_correct: r.correct, score: r.score })), results: answerResults }, error: null });
  } catch (error) {
    console.error('公开提交答题失败:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ==================== 课堂任务模块 API 结束 ====================

async function startServer(options = {}) {
  const configuredPort = options.port ?? parseInt(process.env.PORT, 10);
  const configuredHost = options.host ?? process.env.HOST;
  const port = configuredPort || 3001;
  const host = configuredHost || '0.0.0.0';

// ===== 课堂点名模块接口 =====

// 1. 获取班级学生列表（带在线状态）
app.get('/api/teacher/roll-call/students/:classId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    // 校验班级归属
    const [classRows] = await pool.query('SELECT id, teacher_id FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) {
      return res.status(404).json({ data: null, error: '班级不存在' });
    }
    if (classRows[0].teacher_id !== req.user.userId) {
      return res.status(403).json({ data: null, error: '无权限访问该班级' });
    }
    const [students] = await pool.query(`
      SELECT p.id, p.username, p.real_name, p.current_points, p.max_points, p.total_correct,
        (SELECT COUNT(*) FROM login_sessions ls
         WHERE ls.user_id = p.id
           AND ls.is_active = TRUE
           AND ls.expires_at > NOW()
           AND ls.last_active_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) > 0 AS is_online
      FROM profiles p
      WHERE p.class_id = ? AND p.role = 'student'
      ORDER BY p.real_name ASC
    `, [classId]);
    res.json({ data: students, error: null });
  } catch (error) {
    console.error('Error in GET /api/teacher/roll-call/students/:classId:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 2. 获取班级座位布局
app.get('/api/teacher/roll-call/seating/:classId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const [classRows] = await pool.query('SELECT id, teacher_id FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) {
      return res.status(404).json({ data: null, error: '班级不存在' });
    }
    if (classRows[0].teacher_id !== req.user.userId) {
      return res.status(403).json({ data: null, error: '无权限访问该班级' });
    }
    const [seats] = await pool.query(
      'SELECT id, class_id, seat_number, student_id, position_x, position_y, is_locked, updated_at FROM roll_call_seating WHERE class_id = ? ORDER BY seat_number',
      [classId]
    );
    const [layoutRows] = await pool.query(
      'SELECT id, class_id, layout_data, is_locked, updated_at FROM roll_call_layout WHERE class_id = ?',
      [classId]
    );
    const layout = layoutRows.length > 0
      ? {
          is_locked: layoutRows[0].is_locked === 1 || layoutRows[0].is_locked === true,
          layout_data: typeof layoutRows[0].layout_data === 'string'
            ? JSON.parse(layoutRows[0].layout_data)
            : layoutRows[0].layout_data,
        }
      : { is_locked: false, layout_data: { version: 1 } };
    res.json({ data: { seats, layout }, error: null });
  } catch (error) {
    console.error('Error in GET /api/teacher/roll-call/seating/:classId:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 3. 保存座位布局（事务：先 DELETE 再批量 INSERT）
app.post('/api/teacher/roll-call/seating/:classId/save', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const { seats = [], is_locked = false } = req.body;
    const [classRows] = await pool.query('SELECT id, teacher_id FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) {
      return res.status(404).json({ data: null, error: '班级不存在' });
    }
    if (classRows[0].teacher_id !== req.user.userId) {
      return res.status(403).json({ data: null, error: '无权限访问该班级' });
    }
    // 如果整体锁定则禁止
    const [layoutRows] = await pool.query('SELECT is_locked FROM roll_call_layout WHERE class_id = ?', [classId]);
    if (layoutRows.length > 0 && (layoutRows[0].is_locked === 1 || layoutRows[0].is_locked === true)) {
      return res.status(403).json({ data: null, error: '座位图已锁定，请先解锁' });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM roll_call_seating WHERE class_id = ?', [classId]);
      if (seats.length > 0) {
        const values = seats.map((s) => [
          `rcs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          classId,
          s.seat_number,
          s.student_id || null,
          s.position_x ?? 0,
          s.position_y ?? 0,
          s.is_locked ? 1 : 0,
        ]);
        await conn.query(
          'INSERT INTO roll_call_seating (id, class_id, seat_number, student_id, position_x, position_y, is_locked) VALUES ?',
          [values]
        );
      }
      await conn.query(
        'INSERT INTO roll_call_layout (id, class_id, layout_data, is_locked) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE layout_data = VALUES(layout_data), is_locked = VALUES(is_locked)',
        [`rcl_${classId}`, classId, JSON.stringify({ version: 1 }), is_locked ? 1 : 0]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ data: { ok: true }, error: null });
  } catch (error) {
    console.error('Error in POST /api/teacher/roll-call/seating/:classId/save:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 4. 自动排座位：按 username 末尾数字升序
app.post('/api/teacher/roll-call/seating/:classId/auto-arrange', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const [classRows] = await pool.query('SELECT id, teacher_id FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) {
      return res.status(404).json({ data: null, error: '班级不存在' });
    }
    if (classRows[0].teacher_id !== req.user.userId) {
      return res.status(403).json({ data: null, error: '无权限访问该班级' });
    }
    const [layoutRows] = await pool.query('SELECT is_locked FROM roll_call_layout WHERE class_id = ?', [classId]);
    if (layoutRows.length > 0 && (layoutRows[0].is_locked === 1 || layoutRows[0].is_locked === true)) {
      return res.status(403).json({ data: null, error: '座位图已锁定，请先解锁' });
    }
    const [students] = await pool.query(
      `SELECT id, username, real_name FROM profiles WHERE class_id = ? AND role = 'student'`,
      [classId]
    );
    // 解析末尾数字
    const parseNumber = (str) => {
      const m = String(str).match(/(\d+)\s*$/);
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    };
    const sorted = [...students].sort((a, b) => {
      const na = parseNumber(a.username);
      const nb = parseNumber(b.username);
      if (na !== nb) return na - nb;
      return String(a.username).localeCompare(String(b.username));
    });
    // 填充到 8x8 网格
    const seats = sorted.slice(0, 64).map((s, i) => ({
      seat_number: i + 1,
      student_id: s.id,
      position_x: i % 8,
      position_y: Math.floor(i / 8),
      is_locked: false,
    }));
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM roll_call_seating WHERE class_id = ?', [classId]);
      if (seats.length > 0) {
        const values = seats.map((s) => [
          `rcs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          classId,
          s.seat_number,
          s.student_id,
          s.position_x,
          s.position_y,
          s.is_locked ? 1 : 0,
        ]);
        await conn.query(
          'INSERT INTO roll_call_seating (id, class_id, seat_number, student_id, position_x, position_y, is_locked) VALUES ?',
          [values]
        );
      }
      await conn.query(
        'INSERT INTO roll_call_layout (id, class_id, layout_data, is_locked) VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE layout_data = VALUES(layout_data), is_locked = 0',
        [`rcl_${classId}`, classId, JSON.stringify({ version: 1 })]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ data: { ok: true, count: seats.length }, error: null });
  } catch (error) {
    console.error('Error in POST /api/teacher/roll-call/seating/:classId/auto-arrange:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/teacher/roll-call/seating/:classId/reverse-arrange', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const [classRows] = await pool.query('SELECT id, teacher_id FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) {
      return res.status(404).json({ data: null, error: '班级不存在' });
    }
    if (classRows[0].teacher_id !== req.user.userId) {
      return res.status(403).json({ data: null, error: '无权限访问该班级' });
    }

    // 获取当前所有座位记录
    const [existingSeats] = await pool.query(
      'SELECT seat_number, student_id, position_x, position_y, is_locked FROM roll_call_seating WHERE class_id = ?',
      [classId]
    );

    // 构建完整64个座位（已有记录的用数据库位置，空座位用默认位置）
    const seatMap = new Map();
    existingSeats.forEach(s => seatMap.set(s.seat_number, s));

    const allSeats = [];
    for (let i = 0; i < 64; i++) {
      const seat_number = i + 1;
      const existing = seatMap.get(seat_number);
      const position_x = existing?.position_x ?? (i % 8);
      const position_y = existing?.position_y ?? Math.floor(i / 8);
      allSeats.push({
        seat_number,
        student_id: existing?.student_id || null,
        position_x,
        position_y,
        is_locked: existing ? !!(existing.is_locked === 1 || existing.is_locked === true) : false,
      });
    }

    // 反转所有座位的位置：左上↔右下
    const reversedSeats = allSeats.map(s => ({
      ...s,
      position_x: 7 - s.position_x,
      position_y: 7 - s.position_y,
    }));

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM roll_call_seating WHERE class_id = ?', [classId]);
      const values = reversedSeats.map((seat) => [
        `rcs_${classId}_${seat.seat_number}`,
        classId,
        seat.seat_number,
        seat.student_id,
        seat.position_x,
        seat.position_y,
        seat.is_locked ? 1 : 0,
      ]);
      await conn.query(
        'INSERT INTO roll_call_seating (id, class_id, seat_number, student_id, position_x, position_y, is_locked) VALUES ?',
        [values]
      );
      await conn.commit();
      res.json({ data: { success: true, count: reversedSeats.length }, error: null });
    } catch (txError) {
      await conn.rollback();
      throw txError;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Error in POST /api/teacher/roll-call/seating/:classId/reverse-arrange:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 5. 锁定/解锁整张座位图
app.post('/api/teacher/roll-call/lock/:classId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const { is_locked = true } = req.body;
    const [classRows] = await pool.query('SELECT id, teacher_id FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) {
      return res.status(404).json({ data: null, error: '班级不存在' });
    }
    if (classRows[0].teacher_id !== req.user.userId) {
      return res.status(403).json({ data: null, error: '无权限访问该班级' });
    }
    await pool.query(
      'INSERT INTO roll_call_layout (id, class_id, layout_data, is_locked) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_locked = VALUES(is_locked)',
      [`rcl_${classId}`, classId, JSON.stringify({ version: 1 }), is_locked ? 1 : 0]
    );
    res.json({ data: { is_locked: !!is_locked }, error: null });
  } catch (error) {
    console.error('Error in POST /api/teacher/roll-call/lock/:classId:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 6. 签发代理 token（教师远程控制学生桌面），5 分钟过期
app.get('/api/teacher/roll-call/proxy-token/:studentId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { studentId } = req.params;
    // 校验学生属于该教师的班级
    const [studentRows] = await pool.query(
      `SELECT p.id, p.class_id, p.real_name, p.username, c.teacher_id
       FROM profiles p
       LEFT JOIN classes c ON p.class_id = c.id
       WHERE p.id = ? AND p.role = 'student'`,
      [studentId]
    );
    if (studentRows.length === 0) {
      return res.status(404).json({ data: null, error: '学生不存在' });
    }
    if (studentRows[0].teacher_id !== req.user.userId) {
      return res.status(403).json({ data: null, error: '该学生不属于您的班级' });
    }
    // 生成 token
    const tokenInfo = secureAuth.generateToken();
    console.log(`[PROXY TOKEN] 为学生 ${studentId} (${studentRows[0].username}) 签发代理 token`, {
      tokenPreview: tokenInfo.raw.slice(0, 30) + '...',
      teacherId: req.user.userId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const sessionId = uuidv4();
    await pool.query(
      `INSERT INTO login_sessions (id, user_id, token, device_info, ip_address, user_agent, created_at, last_active_at, expires_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, TRUE)`,
      [
        sessionId,
        studentId,
        tokenInfo.hash,
        `教师远程控制 from ${req.user.userId}`,
        req.ip || '',
        req.headers['user-agent'] || '',
        expiresAt,
      ]
    );
    res.json({
      data: {
        token: tokenInfo.raw,
        session_id: sessionId,
        expires_at: expiresAt.toISOString(),
        student: {
          id: studentRows[0].id,
          username: studentRows[0].username,
          real_name: studentRows[0].real_name,
        },
      },
      error: null,
    });
  } catch (error) {
    console.error('Error in GET /api/teacher/roll-call/proxy-token/:studentId:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 7. 撤销代理 token（教师关闭远程控制弹窗时调用）
app.delete('/api/teacher/roll-call/proxy-token/:sessionId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { sessionId } = req.params;
    await pool.query('DELETE FROM login_sessions WHERE id = ?', [sessionId]);
    res.json({ data: { ok: true }, error: null });
  } catch (error) {
    console.error('Error in DELETE /api/teacher/roll-call/proxy-token/:sessionId:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 8. 保存考勤记录
app.post('/api/teacher/roll-call/attendance/:classId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const { attendance_data, note } = req.body;
    
    // 校验班级归属
    const [classRows] = await pool.query('SELECT teacher_id FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) return res.status(404).json({ data: null, error: '班级不存在' });
    if (classRows[0].teacher_id !== req.user.userId) return res.status(403).json({ data: null, error: '无权限' });

    const totalCount = attendance_data.length;
    const onlineCount = attendance_data.filter(s => s.is_online).length;
    const absentCount = totalCount - onlineCount;
    const recordId = uuidv4();

    await pool.query(
      `INSERT INTO roll_call_attendance (id, class_id, teacher_id, record_time, total_count, online_count, absent_count, attendance_data, note)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [recordId, classId, req.user.userId, totalCount, onlineCount, absentCount, JSON.stringify(attendance_data), note || null]
    );

    res.json({ data: { id: recordId, record_time: new Date().toISOString(), total_count: totalCount, online_count: onlineCount, absent_count: absentCount }, error: null });
  } catch (error) {
    console.error('Error in POST /api/teacher/roll-call/attendance:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 9. 获取考勤记录列表
app.get('/api/teacher/roll-call/attendance/:classId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const [classRows] = await pool.query('SELECT teacher_id FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) return res.status(404).json({ data: null, error: '班级不存在' });
    if (classRows[0].teacher_id !== req.user.userId) return res.status(403).json({ data: null, error: '无权限' });

    const [records] = await pool.query(
      `SELECT id, record_time, total_count, online_count, absent_count, note
       FROM roll_call_attendance WHERE class_id = ? ORDER BY record_time DESC LIMIT 50`,
      [classId]
    );

    res.json({ data: records, error: null });
  } catch (error) {
    console.error('Error in GET /api/teacher/roll-call/attendance:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 10. 获取单条考勤记录详情
app.get('/api/teacher/roll-call/attendance-detail/:recordId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { recordId } = req.params;
    const [rows] = await pool.query(
      `SELECT r.*, c.teacher_id FROM roll_call_attendance r JOIN classes c ON r.class_id = c.id WHERE r.id = ?`,
      [recordId]
    );
    if (rows.length === 0) return res.status(404).json({ data: null, error: '记录不存在' });
    if (rows[0].teacher_id !== req.user.userId) return res.status(403).json({ data: null, error: '无权限' });

    const row = rows[0];
    res.json({
      data: {
        id: row.id,
        class_id: row.class_id,
        record_time: row.record_time,
        total_count: row.total_count,
        online_count: row.online_count,
        absent_count: row.absent_count,
        attendance_data: typeof row.attendance_data === 'string' ? JSON.parse(row.attendance_data) : row.attendance_data,
        note: row.note,
      },
      error: null,
    });
  } catch (error) {
    console.error('Error in GET /api/teacher/roll-call/attendance-detail:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 11. 生成/获取班级公开访问令牌（班主任免登录查看）
app.post('/api/teacher/roll-call/public-token/:classId', authenticate, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const [classRows] = await pool.query('SELECT teacher_id, roll_call_public_token FROM classes WHERE id = ?', [classId]);
    if (classRows.length === 0) return res.status(404).json({ data: null, error: '班级不存在' });
    if (classRows[0].teacher_id !== req.user.userId) return res.status(403).json({ data: null, error: '无权限' });

    let token = classRows[0].roll_call_public_token;
    if (!token) {
      token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '').slice(0, 16);
      await pool.query('UPDATE classes SET roll_call_public_token = ? WHERE id = ?', [token, classId]);
    }

    res.json({ data: { token, url: `/share/roll-call/${token}` }, error: null });
  } catch (error) {
    console.error('Error in POST /api/teacher/roll-call/public-token:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ===== 公开访问接口（免登录，需 token） =====

// 公开：获取班级点名信息
app.get('/api/public/roll-call/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [classRows] = await pool.query(
      'SELECT id, name, teacher_id FROM classes WHERE roll_call_public_token = ?',
      [token]
    );
    if (classRows.length === 0) return res.status(404).json({ data: null, error: '无效的访问链接' });

    const classInfo = classRows[0];

    // 获取学生在线状态
    const [students] = await pool.query(`
      SELECT p.id, p.username, p.real_name,
        (SELECT COUNT(*) FROM login_sessions ls
         WHERE ls.user_id = p.id AND ls.is_active = TRUE AND ls.expires_at > NOW()
           AND ls.last_active_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) > 0 AS is_online
      FROM profiles p WHERE p.class_id = ? AND p.role = 'student' ORDER BY p.real_name ASC
    `, [classInfo.id]);

    // 获取座位布局
    const [seats] = await pool.query(
      'SELECT seat_number, student_id, position_x, position_y FROM roll_call_seating WHERE class_id = ? ORDER BY seat_number',
      [classInfo.id]
    );

    res.json({
      data: {
        class_name: classInfo.name,
        students: students.map(s => ({ ...s, is_online: !!s.is_online })),
        seats: seats,
        online_count: students.filter(s => s.is_online).length,
        total_count: students.length,
      },
      error: null,
    });
  } catch (error) {
    console.error('Error in GET /api/public/roll-call:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 公开：获取考勤记录列表
app.get('/api/public/roll-call/:token/attendance', async (req, res) => {
  try {
    const { token } = req.params;
    const [classRows] = await pool.query('SELECT id FROM classes WHERE roll_call_public_token = ?', [token]);
    if (classRows.length === 0) return res.status(404).json({ data: null, error: '无效的访问链接' });

    const [records] = await pool.query(
      `SELECT id, record_time, total_count, online_count, absent_count, note
       FROM roll_call_attendance WHERE class_id = ? ORDER BY record_time DESC LIMIT 30`,
      [classRows[0].id]
    );

    res.json({ data: records, error: null });
  } catch (error) {
    console.error('Error in GET /api/public/roll-call/attendance:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 公开：获取单条考勤记录详情
app.get('/api/public/roll-call/:token/attendance/:recordId', async (req, res) => {
  try {
    const { token, recordId } = req.params;
    const [classRows] = await pool.query('SELECT id FROM classes WHERE roll_call_public_token = ?', [token]);
    if (classRows.length === 0) return res.status(404).json({ data: null, error: '无效的访问链接' });

    const [rows] = await pool.query(
      'SELECT * FROM roll_call_attendance WHERE id = ? AND class_id = ?',
      [recordId, classRows[0].id]
    );
    if (rows.length === 0) return res.status(404).json({ data: null, error: '记录不存在' });

    const row = rows[0];
    res.json({
      data: {
        id: row.id,
        record_time: row.record_time,
        total_count: row.total_count,
        online_count: row.online_count,
        absent_count: row.absent_count,
        attendance_data: typeof row.attendance_data === 'string' ? JSON.parse(row.attendance_data) : row.attendance_data,
        note: row.note,
      },
      error: null,
    });
  } catch (error) {
    console.error('Error in GET /api/public/roll-call/attendance-detail:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ===== 公开分享页面（微信图文卡片） =====
app.get('/share/roll-call/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [classRows] = await pool.query(
      'SELECT id, name FROM classes WHERE roll_call_public_token = ?',
      [token]
    );

    if (classRows.length === 0) {
      return res.status(404).send('无效的访问链接');
    }

    const classInfo = classRows[0];
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // 返回带 OG 标签的 HTML，然后通过 JS 跳转到前端 HashRouter
    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${classInfo.name} - 课堂点名</title>
  <meta property="og:type" content="website">
  <meta property="og:title" content="${classInfo.name} 信息课点名系统">
  <meta property="og:description" content="点击查看考勤记录">
  <meta property="og:image" content="${baseUrl}/logo.png">
  <style>
    body { margin:0; padding:0; display:flex; align-items:center; justify-content:center; height:100vh; background:#0f172a; color:#94a3b8; font-family:system-ui,-apple-system,sans-serif; }
    .loading { text-align:center; }
    .loading i { font-size:2rem; margin-bottom:.5rem; display:block; color:#22d3ee; animation:spin 1s linear infinite; }
    @keyframes spin { 100% { transform:rotate(360deg); } }
  </style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
  <div class="loading">
    <i class="fa-solid fa-circle-notch"></i>
    <div>正在加载 ${classInfo.name} 点名系统...</div>
  </div>
  <script>
    window.location.replace('/#/roll-call-public?token=${token}');
  </script>
</body>
</html>`);
  } catch (error) {
    console.error('Error in GET /share/roll-call/:token:', error);
    res.status(500).send('服务器错误');
  }
});

// ===== 课堂点名模块 - 学生端接口（完整功能，与教师端同步） =====

// 辅助：获取学生所在班级 ID
async function getStudentClassId(userId) {
  const [rows] = await pool.query('SELECT class_id FROM profiles WHERE id = ? AND role = ?', [userId, 'student']);
  return rows.length > 0 ? rows[0].class_id : null;
}

// 1. 学生获取班级学生列表（带在线状态）
app.get('/api/student/roll-call/students', authenticate, async (req, res) => {
  try {
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) {
      return res.json({ data: [], error: null });
    }
    const [students] = await pool.query(`
      SELECT p.id, p.username, p.real_name, p.current_points, p.max_points, p.total_correct,
        (SELECT COUNT(*) FROM login_sessions ls
         WHERE ls.user_id = p.id
           AND ls.is_active = TRUE
           AND ls.expires_at > NOW()
           AND ls.last_active_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) > 0 AS is_online
      FROM profiles p
      WHERE p.class_id = ? AND p.role = 'student'
      ORDER BY p.real_name ASC
    `, [classId]);
    res.json({ data: students, error: null });
  } catch (error) {
    console.error('Error in GET /api/student/roll-call/students:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 2. 学生获取班级座位布局
app.get('/api/student/roll-call/seating', authenticate, async (req, res) => {
  try {
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) {
      return res.json({ data: { seats: [], layout: { is_locked: false, layout_data: { version: 1 } } }, error: null });
    }
    const [seats] = await pool.query(
      'SELECT id, class_id, seat_number, student_id, position_x, position_y, is_locked, updated_at FROM roll_call_seating WHERE class_id = ? ORDER BY seat_number',
      [classId]
    );
    const [layoutRows] = await pool.query(
      'SELECT id, class_id, layout_data, is_locked, updated_at FROM roll_call_layout WHERE class_id = ?',
      [classId]
    );
    const layout = layoutRows.length > 0
      ? {
          is_locked: layoutRows[0].is_locked === 1 || layoutRows[0].is_locked === true,
          layout_data: typeof layoutRows[0].layout_data === 'string'
            ? JSON.parse(layoutRows[0].layout_data)
            : layoutRows[0].layout_data,
        }
      : { is_locked: false, layout_data: { version: 1 } };
    res.json({ data: { seats, layout }, error: null });
  } catch (error) {
    console.error('Error in GET /api/student/roll-call/seating:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 3. 学生保存座位布局（事务：先 DELETE 再批量 INSERT）
app.post('/api/student/roll-call/seating/save', authenticate, async (req, res) => {
  try {
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) {
      return res.status(400).json({ data: null, error: '您没有所属班级' });
    }
    const { seats = [], is_locked = false } = req.body;
    // 如果整体锁定则禁止
    const [layoutRows] = await pool.query('SELECT is_locked FROM roll_call_layout WHERE class_id = ?', [classId]);
    if (layoutRows.length > 0 && (layoutRows[0].is_locked === 1 || layoutRows[0].is_locked === true)) {
      return res.status(403).json({ data: null, error: '座位图已锁定，请先解锁' });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM roll_call_seating WHERE class_id = ?', [classId]);
      if (seats.length > 0) {
        const values = seats.map((s) => [
          `rcs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          classId,
          s.seat_number,
          s.student_id || null,
          s.position_x ?? 0,
          s.position_y ?? 0,
          s.is_locked ? 1 : 0,
        ]);
        await conn.query(
          'INSERT INTO roll_call_seating (id, class_id, seat_number, student_id, position_x, position_y, is_locked) VALUES ?',
          [values]
        );
      }
      await conn.query(
        'INSERT INTO roll_call_layout (id, class_id, layout_data, is_locked) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE layout_data = VALUES(layout_data), is_locked = VALUES(is_locked)',
        [`rcl_${classId}`, classId, JSON.stringify({ version: 1 }), is_locked ? 1 : 0]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ data: { ok: true }, error: null });
  } catch (error) {
    console.error('Error in POST /api/student/roll-call/seating/save:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 4. 学生自动排座位：按 username 末尾数字升序
app.post('/api/student/roll-call/seating/auto-arrange', authenticate, async (req, res) => {
  try {
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) {
      return res.status(400).json({ data: null, error: '您没有所属班级' });
    }
    const [layoutRows] = await pool.query('SELECT is_locked FROM roll_call_layout WHERE class_id = ?', [classId]);
    if (layoutRows.length > 0 && (layoutRows[0].is_locked === 1 || layoutRows[0].is_locked === true)) {
      return res.status(403).json({ data: null, error: '座位图已锁定，请先解锁' });
    }
    const [students] = await pool.query(
      `SELECT id, username, real_name FROM profiles WHERE class_id = ? AND role = 'student'`,
      [classId]
    );
    const parseNumber = (str) => {
      const m = String(str).match(/(\d+)\s*$/);
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    };
    const sorted = [...students].sort((a, b) => {
      const na = parseNumber(a.username);
      const nb = parseNumber(b.username);
      if (na !== nb) return na - nb;
      return String(a.username).localeCompare(String(b.username));
    });
    const seats = sorted.slice(0, 64).map((s, i) => ({
      seat_number: i + 1,
      student_id: s.id,
      position_x: i % 8,
      position_y: Math.floor(i / 8),
      is_locked: false,
    }));
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM roll_call_seating WHERE class_id = ?', [classId]);
      if (seats.length > 0) {
        const values = seats.map((s) => [
          `rcs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          classId,
          s.seat_number,
          s.student_id,
          s.position_x,
          s.position_y,
          s.is_locked ? 1 : 0,
        ]);
        await conn.query(
          'INSERT INTO roll_call_seating (id, class_id, seat_number, student_id, position_x, position_y, is_locked) VALUES ?',
          [values]
        );
      }
      await conn.query(
        'INSERT INTO roll_call_layout (id, class_id, layout_data, is_locked) VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE layout_data = VALUES(layout_data), is_locked = 0',
        [`rcl_${classId}`, classId, JSON.stringify({ version: 1 })]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ data: { ok: true, count: seats.length }, error: null });
  } catch (error) {
    console.error('Error in POST /api/student/roll-call/seating/auto-arrange:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

app.post('/api/student/roll-call/seating/reverse-arrange', authenticate, async (req, res) => {
  try {
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) {
      return res.status(400).json({ data: null, error: '您没有所属班级' });
    }

    // 获取当前所有座位记录
    const [existingSeats] = await pool.query(
      'SELECT seat_number, student_id, position_x, position_y, is_locked FROM roll_call_seating WHERE class_id = ?',
      [classId]
    );

    // 构建完整64个座位（已有记录的用数据库位置，空座位用默认位置）
    const seatMap = new Map();
    existingSeats.forEach(s => seatMap.set(s.seat_number, s));

    const allSeats = [];
    for (let i = 0; i < 64; i++) {
      const seat_number = i + 1;
      const existing = seatMap.get(seat_number);
      const position_x = existing?.position_x ?? (i % 8);
      const position_y = existing?.position_y ?? Math.floor(i / 8);
      allSeats.push({
        seat_number,
        student_id: existing?.student_id || null,
        position_x,
        position_y,
        is_locked: existing ? !!(existing.is_locked === 1 || existing.is_locked === true) : false,
      });
    }

    // 反转所有座位的位置
    const reversedSeats = allSeats.map(s => ({
      ...s,
      position_x: 7 - s.position_x,
      position_y: 7 - s.position_y,
    }));

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM roll_call_seating WHERE class_id = ?', [classId]);
      const values = reversedSeats.map((seat) => [
        `rcs_${classId}_${seat.seat_number}`,
        classId,
        seat.seat_number,
        seat.student_id,
        seat.position_x,
        seat.position_y,
        seat.is_locked ? 1 : 0,
      ]);
      await conn.query(
        'INSERT INTO roll_call_seating (id, class_id, seat_number, student_id, position_x, position_y, is_locked) VALUES ?',
        [values]
      );
      await conn.commit();
      res.json({ data: { success: true, count: reversedSeats.length }, error: null });
    } catch (txError) {
      await conn.rollback();
      throw txError;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Error in POST /api/student/roll-call/seating/reverse-arrange:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 5. 学生锁定/解锁整张座位图
app.post('/api/student/roll-call/lock', authenticate, async (req, res) => {
  try {
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) {
      return res.status(400).json({ data: null, error: '您没有所属班级' });
    }
    const { is_locked = true } = req.body;
    await pool.query(
      'INSERT INTO roll_call_layout (id, class_id, layout_data, is_locked) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_locked = VALUES(is_locked)',
      [`rcl_${classId}`, classId, JSON.stringify({ version: 1 }), is_locked ? 1 : 0]
    );
    res.json({ data: { is_locked: !!is_locked }, error: null });
  } catch (error) {
    console.error('Error in POST /api/student/roll-call/lock:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 学生端：保存考勤记录
app.post('/api/student/roll-call/attendance', authenticate, requireStudent, async (req, res) => {
  try {
    const { attendance_data, note } = req.body;
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) return res.status(404).json({ data: null, error: '学生未加入班级' });

    const totalCount = attendance_data.length;
    const onlineCount = attendance_data.filter(s => s.is_online).length;
    const absentCount = totalCount - onlineCount;
    const recordId = uuidv4();

    await pool.query(
      `INSERT INTO roll_call_attendance (id, class_id, teacher_id, record_time, total_count, online_count, absent_count, attendance_data, note)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [recordId, classId, req.user.userId, totalCount, onlineCount, absentCount, JSON.stringify(attendance_data), note || null]
    );

    res.json({ data: { id: recordId, record_time: new Date().toISOString(), total_count: totalCount, online_count: onlineCount, absent_count: absentCount }, error: null });
  } catch (error) {
    console.error('Error in POST /api/student/roll-call/attendance:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 学生端：获取考勤记录列表
app.get('/api/student/roll-call/attendance', authenticate, requireStudent, async (req, res) => {
  try {
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) return res.status(404).json({ data: null, error: '学生未加入班级' });

    const [records] = await pool.query(
      `SELECT id, record_time, total_count, online_count, absent_count, note
       FROM roll_call_attendance WHERE class_id = ? ORDER BY record_time DESC LIMIT 30`,
      [classId]
    );

    res.json({ data: records, error: null });
  } catch (error) {
    console.error('Error in GET /api/student/roll-call/attendance:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 学生端：获取单条考勤记录详情
app.get('/api/student/roll-call/attendance-detail/:recordId', authenticate, requireStudent, async (req, res) => {
  try {
    const { recordId } = req.params;
    const classId = await getStudentClassId(req.user.userId);
    if (!classId) return res.status(404).json({ data: null, error: '学生未加入班级' });

    const [rows] = await pool.query(
      'SELECT * FROM roll_call_attendance WHERE id = ? AND class_id = ?',
      [recordId, classId]
    );
    if (rows.length === 0) return res.status(404).json({ data: null, error: '记录不存在' });

    const row = rows[0];
    res.json({
      data: {
        id: row.id,
        record_time: row.record_time,
        total_count: row.total_count,
        online_count: row.online_count,
        absent_count: row.absent_count,
        attendance_data: typeof row.attendance_data === 'string' ? JSON.parse(row.attendance_data) : row.attendance_data,
        note: row.note,
      },
      error: null,
    });
  } catch (error) {
    console.error('Error in GET /api/student/roll-call/attendance-detail:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// 学生端不提供 proxy-token 端点：原实现允许任意学生为同班同学签发完整登录凭证，
// 构成认证绕过（可冒充同学答题/消费积分）。远程控制仅限教师在 /api/teacher/roll-call/proxy-token 使用。

// 8. 学生获取班级信息
app.get('/api/student/class-info', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [profileRows] = await pool.query(`
      SELECT p.class_id, c.name as class_name, c.teacher_id, t.real_name as teacher_name
      FROM profiles p
      LEFT JOIN classes c ON p.class_id = c.id
      LEFT JOIN profiles t ON c.teacher_id = t.id
      WHERE p.id = ?
    `, [userId]);
    if (profileRows.length === 0) {
      return res.json({ data: null, error: '用户不存在' });
    }
    const row = profileRows[0];
    res.json({
      data: {
        class_id: row.class_id,
        name: row.class_name,
        teacher_id: row.teacher_id,
        teacher_name: row.teacher_name,
      },
      error: null,
    });
  } catch (error) {
    console.error('Error in GET /api/student/class-info:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

// ===== 远程控制：验证 proxy_token 并返回目标学生信息 =====
app.get('/api/proxy/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ data: null, error: '缺少 token 参数' });
    }

    // 对 token 进行哈希处理（与登录验证相同的方式）
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 查找匹配的 session
    const [sessions] = await pool.query(`
      SELECT ls.id, ls.user_id, ls.expires_at, ls.is_active,
             p.id as student_id, p.username, p.real_name, p.role, p.class_id,
             p.current_points, p.max_points, p.total_correct, p.hidden_features
      FROM login_sessions ls
      JOIN profiles p ON ls.user_id = p.id
      WHERE ls.token = ? AND ls.is_active = TRUE AND ls.expires_at > NOW()
    `, [tokenHash]);

    if (sessions.length === 0) {
      return res.status(401).json({ data: null, error: 'token 无效或已过期' });
    }

    const session = sessions[0];

    // 返回目标学生的完整信息
    res.json({
      data: {
        id: session.student_id,
        username: session.username,
        real_name: session.real_name,
        role: session.role,
        class_id: session.class_id,
        current_points: session.current_points || 0,
        max_points: session.max_points || 0,
        total_correct: session.total_correct || 0,
        hidden_features: session.hidden_features || '["paint_board", "roll_call"]',
        session_id: session.id,
        expires_at: session.expires_at,
      },
      error: null,
    });
  } catch (error) {
    console.error('Error in GET /api/proxy/verify:', error);
    res.status(500).json({ data: null, error: error.message });
  }
});

  await runMigrations();

  const server = app.listen(port, host, () => {
    console.log(`XGPY Backend Server running on http://${host}:${port}`);
    console.log(`MariaDB: ${process.env.DB_HOST || '192.168.10.110'}:${process.env.DB_PORT || '3306'}`);

    // 启动定时任务，每分钟检查一次待发布通知
    if (!notificationScheduler) {
      console.log('定时任务已启动：每分钟检查待发布通知');
      checkAndPublishScheduledNotifications();
      notificationScheduler = setInterval(checkAndPublishScheduledNotifications, 60000);
    }
    
    // 启动会话清理定时任务，每5分钟运行一次
    console.log('定时任务已启动：每5分钟清理不活跃会话');
    cleanupStaleSessions();
    setInterval(cleanupStaleSessions, 5 * 60 * 1000); // 5分钟
  });

  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
};
