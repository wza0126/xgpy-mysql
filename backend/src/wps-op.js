/**
 * WPS 操作题（学测信息技术操作题）后端
 * ============================================================
 * 形态：教师上传模板（可为 xlsx 模板 + txt 数据源）→ 学生用真 WPS 做题
 *       → 上传 xlsx → 服务端逐评分点判分 → 回执。
 *
 * ⛔ 安全红线（与全站判分铁律一致）：
 *   1) 评分点 wps_spec.steps[].checks[] **就是答案**，学生端接口一律经 stripSpecForStudent 剥离，
 *      只下发步骤标题 / 说明 / 演示视频位 / 模板清单。
 *   2) 判分 100% 在服务端做，前端传来的分数一概不采信。
 *   3) questions.wps_spec 已加入 QUESTION_ANSWER_FIELDS，通用表接口 /api/tables/questions
 *      对学生同样会剥离，避免从旁路泄露答案。
 *
 * 幂等：同一学生 + 同一题 + 同一份文件（sha256）重复提交不会重复记分，只回放上次结果。
 *
 * 其余要点：
 *   · 模板支持多文件（templates[]）：一道题可能同时要"空白表 + txt 数据源"。
 *     旧数据里的单个 template 字段继续兼容（normalizeTemplates 会合并）。
 *   · 演示视频：可本地上传（POST /video）或给外网链接自动抓取到本地（POST /video/fetch）。
 *     机房断网时外链用不了，抓成本地文件后就和网络无关了。
 *   · 题干分块（spec.stem_blocks）：题干可以是"文字块 + 视频块"的顺序列表，教师能对着
 *     自己原题的每一步插视频 —— 平台上"评分步骤"是按标准答案自动生成的，措辞常与教师
 *     原题不同，所以视频不能只挂在评分步骤上。questions.content 仍照旧写全文（列表标题 /
 *     兜底渲染用），两者不冲突。
 *   · 默认满分 100（学测操作题评分点很细，10 分不够用）。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Transform, Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { v4: uuidv4 } = require('uuid');
const grader = require('./wps-grader');

const ALLOWED_EXT = /\.(xlsx|xlsm)$/i;                  // 作答文件：必须 OOXML，判分引擎读它
const TEMPLATE_EXT = /\.(xlsx|xlsm|txt|csv)$/i;         // 模板：含 txt/csv 数据源
const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i;     // 演示视频
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;       // 题干图片（刻意不收 svg：同源直出会带 XSS 风险）
const DEFAULT_FULL_SCORE = 100;
const VIDEO_MAX_MB = Number(process.env.WPS_VIDEO_MAX_MB || 200);
const VIDEO_FETCH_TIMEOUT_MS = Number(process.env.WPS_VIDEO_FETCH_TIMEOUT_MS || 60000);
// 题干图片比视频小得多，上限单独给；WPS 与 Access 共用同一个环境变量
const IMAGE_MAX_MB = Number(process.env.OP_IMAGE_MAX_MB || 20);
const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.OP_IMAGE_FETCH_TIMEOUT_MS || 30000);

function safeJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function fixUtf8Name(name) {
  try { return Buffer.from(name || '', 'latin1').toString('utf8'); } catch { return name || ''; }
}

/** 由文件名推断模板种类：text（txt/csv 数据源）/ xlsx（表格模板） */
function guessKind(name) {
  const ext = String(path.extname(String(name || '')) || '').toLowerCase();
  if (ext === '.txt' || ext === '.csv') return 'text';
  return 'xlsx';
}

/** 题干 HTML → 一行纯文本标题（教师端表格列头用） */
function plainTitle(html, max = 36) {
  const s = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * 统一模板字段。
 * 新格式：spec.templates = [{ name, path, size, kind }]
 * 旧格式：spec.template  = { name, path, size }  ← 一期数据，必须继续认
 */
function normalizeTemplates(spec) {
  const s = safeJson(spec, {});
  const out = [];
  const push = (t) => {
    if (!t || !t.path) return;
    const name = t.name || path.basename(String(t.path));
    out.push({
      name,
      path: String(t.path),
      size: t.size === undefined ? null : t.size,
      kind: t.kind || guessKind(name),
    });
  };
  if (Array.isArray(s.templates)) s.templates.forEach(push);
  push(s.template);
  // 去重（同一 path 只留一条）
  const seen = new Set();
  return out.filter((t) => (seen.has(t.path) ? false : (seen.add(t.path), true)));
}

/**
 * 给学生看的问题视图：只保留"题目本身"（题干、步骤说明、演示视频、模板清单），
 * ⛔ 绝不包含 checks[]（答案）与 grader（判分口径）。
 */
function stripSpecForStudent(spec) {
  const s = safeJson(spec, {});
  const templates = normalizeTemplates(s);
  return {
    version: s.version || 1,
    full_score: Number(s.full_score) || DEFAULT_FULL_SCORE,
    templates,
    template: templates[0] || null, // 兼容只认单个模板的旧前端
    stem_blocks: normalizeStemBlocks(s), // 题干分块（文字块 + 视频块，按序渲染）
    steps: (Array.isArray(s.steps) ? s.steps : []).map((st, i) => {
      const videos = normalizeVideoUrls(st);
      return {
        id: st.id || ('s' + (i + 1)),
        index: i + 1,
        title: st.title || '',
        desc: st.desc || '',
        score: Number(st.score) || 0,
        video_url: videos[0] || '',   // 兼容只认单视频的旧前端
        video_urls: videos,           // 一个步骤可挂多条演示视频
        check_count: Array.isArray(st.checks) ? st.checks.length : 0,
        // 多工作表：这一步在哪张工作表上完成（学生端提示"请在「套餐3」表中操作"）
        sheet: st.sheet || '',
      };
    }),
  };
}

/**
 * 统一步骤视频字段。
 * 新格式：step.video_urls = [url, ...]（一个步骤可配多条视频）
 * 旧格式：step.video_url  = url          ← 一期数据，必须继续认
 */
function normalizeVideoUrls(step) {
  const st = step || {};
  const out = [];
  const push = (u) => {
    const v = String(u || '').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  if (Array.isArray(st.video_urls)) st.video_urls.forEach(push);
  push(st.video_url);
  return out;
}

/**
 * 题干分块里的素材地址集合（视频块 / 图片块共用）。
 * 新字段：block.urls[] / block.url；同时兼容步骤视频的老字段 video_urls / video_url，
 * 避免历史数据或手写 JSON 读不回来。
 */
function collectBlockUrls(b) {
  const out = [];
  const push = (u) => {
    const v = String(u || '').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  if (Array.isArray(b.urls)) b.urls.forEach(push);
  push(b.url);
  if (Array.isArray(b.video_urls)) b.video_urls.forEach(push);
  push(b.video_url);
  return out;
}

/**
 * 统一"题干分块"字段。
 * 新格式：spec.stem_blocks = [{type:'text',html}, {type:'video',title,urls[]}, {type:'image',title,urls[]}, ...]
 *         —— 题干 = 文字块 / 视频块 / 图片块按顺序交替，教师可在任意一步后面挂演示视频或图示。
 * 旧格式：只有 questions.content 一段 HTML（没有分块）→ 返回 []，前端回退整体渲染。
 *
 * 规则：空文字块、以及没有任何素材的视频块/图片块一律丢弃（教师端会给每一步留空位，
 * 没填素材的占位块不应该落库，否则学生端会出现一堆空壳）。
 */
function normalizeStemBlocks(spec) {
  const s = safeJson(spec, {});
  const raw = Array.isArray(s.stem_blocks) ? s.stem_blocks : [];
  const out = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'video' || b.type === 'image') {
      const urls = collectBlockUrls(b);
      if (!urls.length) continue;
      out.push({ type: b.type, title: String(b.title || '').trim(), url: urls[0], urls });
    } else {
      const html = String(b.html || '').trim();
      if (!html) continue;
      out.push({ type: 'text', html });
    }
  }
  return out;
}

/** 提交回执给学生看的形态（去掉内部字段，保留逐评分点明细——作答后可见） */
function shapeResultForStudent(result) {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  delete out.sha256;
  delete out.fileList;
  delete out.parts;
  return out;
}

/**
 * 操作题「题干图片」的上传 / 外链抓取路由（WPS 与 Access 共用，避免两边实现漂移）。
 *   POST <base>/image        —— 上传本地图片
 *   POST <base>/image/fetch  —— 把外网图片抓到本地后引用（机房断网也能看）
 * 返回体与模板/视频一致：{ url, name, size, stored_name, source }，前端一套代码两端通用。
 * base 形如 /api/teacher/wps-op；图片落到 <dir>，对外地址是 <urlPrefix>/<文件名>。
 */
function createOpImageRoutes(app, opts) {
  const { authenticate, requireTeacher, dir, urlPrefix, base } = opts;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) => {
        const ext = (path.extname(fixUtf8Name(file.originalname)) || '.png').toLowerCase();
        cb(null, 'img-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
      },
    }),
    limits: { fileSize: IMAGE_MAX_MB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (IMAGE_EXT.test(fixUtf8Name(file.originalname))) return cb(null, true);
      cb(new Error('题干图片只支持 png / jpg / jpeg / gif / webp / bmp 格式。'));
    },
  });
  const wrap = (mw) => (req, res, next) => {
    mw(req, res, (err) => (err ? res.status(400).json({ data: null, error: err.message || '图片上传失败' }) : next()));
  };

  app.post(base + '/image', authenticate, requireTeacher, wrap(upload.single('file')), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ data: null, error: '未接收到图片文件' });
      res.json({
        data: {
          url: urlPrefix + '/' + req.file.filename,
          name: fixUtf8Name(req.file.originalname),
          size: req.file.size,
          stored_name: req.file.filename,
          source: 'local',
        },
        error: null,
      });
    } catch (e) {
      console.error('op image upload error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  app.post(base + '/image/fetch', authenticate, requireTeacher, async (req, res) => {
    const url = String((req.body && req.body.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ data: null, error: '请填写以 http:// 或 https:// 开头的图片直链' });
    }
    let outPath = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), IMAGE_FETCH_TIMEOUT_MS);
      let resp;
      try {
        resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) throw new Error('对方返回 HTTP ' + resp.status);

      const ct = String(resp.headers.get('content-type') || '');
      // 对方给的不是图片（网页 / JSON 报错页 / 防盗链页）就直说，别存成一个坏文件。
      // octet-stream 放行：有些图床不报 content-type。
      if (ct && !/^image\//i.test(ct) && !/^application\/octet-stream/i.test(ct)) {
        throw new Error(`这个地址返回的不是图片（Content-Type: ${ct.slice(0, 40)}），请换图片直链`);
      }
      let ext = '';
      try { ext = (path.extname(new URL(url).pathname) || '').toLowerCase(); } catch { ext = ''; }
      if (!IMAGE_EXT.test(ext)) {
        if (/png/.test(ct)) ext = '.png';
        else if (/gif/.test(ct)) ext = '.gif';
        else if (/webp/.test(ct)) ext = '.webp';
        else if (/bmp/.test(ct)) ext = '.bmp';
        else ext = '.jpg';
      }
      const maxBytes = IMAGE_MAX_MB * 1024 * 1024;
      const declared = Number(resp.headers.get('content-length') || 0);
      if (declared && declared > maxBytes) {
        throw new Error(`图片约 ${(declared / 1048576).toFixed(1)}MB，超过上限 ${IMAGE_MAX_MB}MB`);
      }

      const fileName = 'img-url-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
      outPath = path.join(dir, fileName);
      let received = 0;
      const limiter = new Transform({
        transform(chunk, enc, cb) {
          received += chunk.length;
          if (received > maxBytes) return cb(new Error(`图片超过上限 ${IMAGE_MAX_MB}MB`));
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(resp.body), limiter, fs.createWriteStream(outPath));

      let baseName = url;
      try { baseName = path.basename(new URL(url).pathname) || url; } catch { /* 保持原样 */ }
      res.json({
        data: {
          url: urlPrefix + '/' + fileName,
          name: baseName,
          size: received,
          stored_name: fileName,
          source: 'fetched',
          source_url: url,
        },
        error: null,
      });
    } catch (e) {
      if (outPath) { try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* ignore */ } }
      console.error('op image fetch error:', e);
      const hint = /abort|timeout|fetch failed|ENOTFOUND|ECONN/i.test(String(e.message))
        ? '（如果这台机器连不上外网，请改用「上传本地图片」）'
        : '';
      res.status(400).json({ data: null, error: '抓取失败：' + e.message + hint });
    }
  });
}

function registerWpsOp(app, deps) {
  const { pool, authenticate, requireTeacher, requireStudent, uploadsDir } = deps;

  const baseDir = path.join(uploadsDir, 'wps-op');
  const templateDir = path.join(baseDir, 'templates');
  const submissionDir = path.join(baseDir, 'submissions');
  const videoDir = path.join(baseDir, 'videos');
  const imageDir = path.join(baseDir, 'images');
  for (const dir of [templateDir, submissionDir, videoDir, imageDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // 题干图片：上传 / 外链抓取（与 Access 共用同一实现，见 createOpImageRoutes）
  createOpImageRoutes(app, {
    authenticate,
    requireTeacher,
    dir: imageDir,
    urlPrefix: '/uploads/wps-op/images',
    base: '/api/teacher/wps-op',
  });

  const makeStorage = (dir, prefix, fallbackExt) => multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = (path.extname(fixUtf8Name(file.originalname)) || fallbackExt).toLowerCase();
      cb(null, prefix + '-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    },
  });

  const wpsFileFilter = (req, file, cb) => {
    // ⛔ 只收 OOXML（xlsx/xlsm）：WPS 原生 .et 与二进制 .xls 判分引擎读不了，
    //    这里直接拒绝并给出可操作的提示，避免"上传成功但判不了分"的困惑。
    const original = fixUtf8Name(file.originalname);
    if (ALLOWED_EXT.test(original)) return cb(null, true);
    cb(new Error('只支持 .xlsx / .xlsm 格式。请在 WPS 中「另存为 → Excel 工作簿(*.xlsx)」后再上传。'));
  };

  const templateFileFilter = (req, file, cb) => {
    const original = fixUtf8Name(file.originalname);
    if (TEMPLATE_EXT.test(original)) return cb(null, true);
    cb(new Error('模板只支持 .xlsx / .xlsm / .txt / .csv。有些题目要求"从 txt 导入数据"，把数据源一起传上来即可。'));
  };

  const videoFileFilter = (req, file, cb) => {
    const original = fixUtf8Name(file.originalname);
    if (VIDEO_EXT.test(original)) return cb(null, true);
    cb(new Error('演示视频只支持 mp4 / webm / ogg / mov 格式。'));
  };

  const templateUpload = multer({ storage: makeStorage(templateDir, 'tpl', '.xlsx'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: templateFileFilter });
  const submissionUpload = multer({ storage: makeStorage(submissionDir, 'sub', '.xlsx'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: wpsFileFilter });
  const videoUpload = multer({ storage: makeStorage(videoDir, 'vid', '.mp4'), limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 }, fileFilter: videoFileFilter });

  const fixName = fixUtf8Name;

  // multer 的错误要转成 JSON（否则前端拿到 HTML 报错页）
  const wrapUpload = (mw) => (req, res, next) => {
    mw(req, res, (err) => {
      if (err) {
        return res.status(400).json({ data: null, error: err.message || '文件上传失败' });
      }
      next();
    });
  };

  // ---------------------------------------------------------------
  // 教师端
  // ---------------------------------------------------------------

  /**
   * 上传模板文件（学生下载用）。支持一次多个：空白表格 + txt 数据源。
   * 兼容：老的单个字段（data.path / data.name）仍然返回，旧的出题界面不用改。
   */
  app.post('/api/teacher/wps-op/template', authenticate, requireTeacher, wrapUpload(templateUpload.any()), async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ data: null, error: '未接收到文件' });
      const items = files.map((f) => {
        const name = fixName(f.originalname);
        return {
          path: '/uploads/wps-op/templates/' + f.filename,
          name,
          size: f.size,
          stored_name: f.filename,
          kind: guessKind(name),
        };
      });
      res.json({ data: { files: items, ...items[0] }, error: null });
    } catch (e) {
      console.error('wps-op template upload error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 上传"标准答案"文件 → 解析 OOXML 结构并自动生成评分点骨架。
   * 这是"题库录入方便"的关键：老师把做好的答案表丢进来，评分点自动填好，再改改分值即可。
   * 能识别：合并/字体/对齐、公式与数值、小数显示、图表，以及排序 / 自动筛选 / 分类汇总 / 条件格式。
   */
  app.post('/api/teacher/wps-op/inspect', authenticate, requireTeacher, wrapUpload(submissionUpload.single('file')), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ data: null, error: '未接收到文件' });
      const summary = await grader.inspectFile(req.file.path);
      let suggested = null;
      try {
        suggested = await grader.suggestSpec(req.file.path, {
          sheet: req.body && req.body.sheet ? req.body.sheet : undefined,
          full_score: req.body && req.body.full_score ? Number(req.body.full_score) : DEFAULT_FULL_SCORE,
        });
      } catch (e) {
        console.warn('wps-op suggestSpec failed:', e.message);
      }
      // 解析用的临时文件不保留（它不是学生的提交，也不该出现在提交列表里）
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.json({ data: { summary, suggested_spec: suggested }, error: null });
    } catch (e) {
      try { if (req.file) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      console.error('wps-op inspect error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /** 校验评分点规格（总分是否等于满分、有没有不支持的检查类型） */
  app.post('/api/teacher/wps-op/validate-spec', authenticate, requireTeacher, async (req, res) => {
    try {
      const spec = req.body && req.body.spec;
      const full = req.body && req.body.full_score;
      const result = grader.validateSpec(spec, full);
      res.json({ data: result, error: null });
    } catch (e) {
      res.status(400).json({ data: null, error: e.message });
    }
  });

  /** 可用的评分点类型清单（教师端下拉用，避免手打 kind 拼错） */
  app.get('/api/teacher/wps-op/check-kinds', authenticate, requireTeacher, (req, res) => {
    const doc = {
      sheet_exists: { label: '工作表存在', fields: ['sheet'] },
      merged: { label: '合并单元格', fields: ['range'] },
      cell_text: { label: '单元格文本', fields: ['ref', 'text', 'ci'] },
      cell_value: { label: '单元格数值（带容差）', fields: ['ref', 'value', 'tol'] },
      cell_has_formula: { label: '必须使用公式', fields: ['ref'] },
      cell_formula: { label: '公式内容一致', fields: ['ref', 'formula'] },
      formula_tokens: { label: '公式引用指定单元格', fields: ['ref', 'tokens'] },
      sum_range: { label: 'SUM 求和且区间正确', fields: ['ref', 'range'] },
      range_formula: { label: '区域内全部使用公式', fields: ['range'] },
      range_values: { label: '区域内数值全部正确', fields: ['range', 'values', 'tol'] },
      range_integer_display: { label: '区域内不保留小数', fields: ['range'] },
      integer_display: { label: '单元格不保留小数', fields: ['ref'] },
      font: { label: '字体名称/加粗/字号', fields: ['ref', 'name', 'bold', 'size'] },
      align: { label: '水平对齐', fields: ['ref', 'horizontal'] },
      number_format: { label: '数字格式小数位', fields: ['ref', 'decimals', 'mode'] },
      chart: { label: '图表', fields: ['index', 'chartType', 'barDir', 'title', 'catRange', 'valRange'] },
      auto_filter: { label: '自动筛选', fields: ['range', 'columns', 'minColumns'] },
      sorted_range: { label: '区域按某列有序（排序）', fields: ['range', 'col', 'order'] },
      subtotal: { label: '分类汇总', fields: ['range', 'fn', 'minCount', 'requireOutline'] },
      cond_format: { label: '条件格式', fields: ['range', 'type', 'operator', 'value', 'fillColor'] },
    };
    res.json({ data: { kinds: grader.CHECK_KINDS, doc, video_max_mb: VIDEO_MAX_MB }, error: null });
  });

  /**
   * 上传本地演示视频（每个操作步骤可挂一段）。
   * 机房不开放外网时，外链视频用不了 → 直接传文件最稳。
   */
  app.post('/api/teacher/wps-op/video', authenticate, requireTeacher, wrapUpload(videoUpload.single('file')), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ data: null, error: '未接收到视频文件' });
      res.json({
        data: {
          url: '/uploads/wps-op/videos/' + req.file.filename,
          name: fixName(req.file.originalname),
          size: req.file.size,
          stored_name: req.file.filename,
          source: 'local',
        },
        error: null,
      });
    } catch (e) {
      console.error('wps-op video upload error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 把外网演示视频抓取到本地后引用。
   * 用途：老师手上只有 B 站/网盘的链接，先抓到本地，之后机房断网也能播。
   * ⚠️ 服务端需要能访问外网；抓不到就退回"本地上传"。
   */
  app.post('/api/teacher/wps-op/video/fetch', authenticate, requireTeacher, async (req, res) => {
    const url = String((req.body && req.body.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ data: null, error: '请填写以 http:// 或 https:// 开头的视频直链' });
    }
    let outPath = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), VIDEO_FETCH_TIMEOUT_MS);
      let resp;
      try {
        resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) throw new Error('对方返回 HTTP ' + resp.status);

      const ct = String(resp.headers.get('content-type') || '');
      let ext = '';
      try { ext = (path.extname(new URL(url).pathname) || '').toLowerCase(); } catch { ext = ''; }
      if (!VIDEO_EXT.test(ext)) {
        if (/webm/.test(ct)) ext = '.webm';
        else if (/ogg/.test(ct)) ext = '.ogg';
        else if (/quicktime/.test(ct)) ext = '.mov';
        else ext = '.mp4';
      }
      const maxBytes = VIDEO_MAX_MB * 1024 * 1024;
      const declared = Number(resp.headers.get('content-length') || 0);
      if (declared && declared > maxBytes) {
        throw new Error(`视频约 ${(declared / 1048576).toFixed(1)}MB，超过上限 ${VIDEO_MAX_MB}MB（可把链接交给本地录制后上传）`);
      }

      const fileName = 'vid-url-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
      outPath = path.join(videoDir, fileName);
      let received = 0;
      const limiter = new Transform({
        transform(chunk, enc, cb) {
          received += chunk.length;
          if (received > maxBytes) return cb(new Error(`视频超过上限 ${VIDEO_MAX_MB}MB`));
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(resp.body), limiter, fs.createWriteStream(outPath));

      let baseName = url;
      try { baseName = path.basename(new URL(url).pathname) || url; } catch { /* 保持原样 */ }
      res.json({
        data: {
          url: '/uploads/wps-op/videos/' + fileName,
          name: baseName,
          size: received,
          stored_name: fileName,
          source: 'fetched',
          source_url: url,
        },
        error: null,
      });
    } catch (e) {
      if (outPath) { try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* ignore */ } }
      console.error('wps-op video fetch error:', e);
      const hint = /abort|timeout|fetch failed|ENOTFOUND|ECONN/i.test(String(e.message))
        ? '（如果这台机器连不上外网，请改用「上传本地视频」）'
        : '';
      res.status(400).json({ data: null, error: '抓取失败：' + e.message + hint });
    }
  });

  /** 学生在某题上的提交记录（教师查看/讲评用） */
  app.get('/api/teacher/wps-op/submissions', authenticate, requireTeacher, async (req, res) => {
    try {
      const questionId = (req.query.questionId || '').toString().trim();
      const studentId = (req.query.studentId || '').toString().trim();
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const where = [];
      const params = [];
      if (questionId) { where.push('s.question_id = ?'); params.push(questionId); }
      if (studentId) { where.push('s.student_id = ?'); params.push(studentId); }
      const [rows] = await pool.query(
        `SELECT s.id, s.student_id, s.question_id, s.source, s.original_filename, s.file_size,
                s.score_obtained, s.full_score, s.graded_at, s.created_at,
                p.real_name, p.username
           FROM wps_op_submissions s
           LEFT JOIN profiles p ON p.id = s.student_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY s.created_at DESC
          LIMIT ?`, [...params, limit]);
      res.json({ data: rows, error: null });
    } catch (e) {
      console.error('wps-op submissions error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 教师端 · WPS 操作题练习情况总览
   * ---------------------------------------------------------------
   * 口径（和学生的"我的最好成绩"一致）：每题取该生在该题上的**最高分**
   *   score(student, question) = MAX(wps_op_submissions.score_obtained)
   *   学生总分 = Σ 各题最高分；未做过的题不计入（按 0 计但单独统计 done_count）
   * 返回：班级列表 + 学生名单 + 所有操作题 + 最高分矩阵 + 每生总分 + 每题平均/最高
   */
  app.get('/api/teacher/wps-op/analytics', authenticate, requireTeacher, async (req, res) => {
    try {
      const teacherId = req.user.userId;
      const role = req.user.role;

      const classSql = (role === 'super_admin' || role === 'admin')
        ? 'SELECT id, name FROM classes ORDER BY name'
        : 'SELECT id, name FROM classes WHERE teacher_id = ? ORDER BY name';
      const [classes] = await pool.query(classSql, (role === 'super_admin' || role === 'admin') ? [] : [teacherId]);

      const pickClassId = String(req.query.classId || '').trim();
      const targetClassIds = pickClassId
        ? classes.filter((c) => String(c.id) === pickClassId).map((c) => c.id)
        : classes.map((c) => c.id);

      // 所有 WPS 操作题（含下架的也列出来，便于讲评；前端标注）
      const [qRows] = await pool.query(
        `SELECT id, content, cluster_id, practice_enabled, wps_spec
           FROM questions WHERE type = 'wps_op'
          ORDER BY cluster_id ASC, created_at ASC`);
      const questions = qRows.map((q) => {
        const spec = safeJson(q.wps_spec, {});
        return {
          id: q.id,
          title: plainTitle(q.content, 36) || q.id,
          cluster_id: q.cluster_id || '',
          full_score: Number(spec.full_score) || DEFAULT_FULL_SCORE,
          step_count: Array.isArray(spec.steps) ? spec.steps.length : 0,
          practice_enabled: Number(q.practice_enabled) === 1 ? 1 : 0,
        };
      });

      let students = [];
      if (targetClassIds.length) {
        const [rows] = await pool.query(
          `SELECT p.id, p.username, p.real_name, p.class_id, c.name AS class_name
             FROM profiles p
             LEFT JOIN classes c ON c.id = p.class_id
            WHERE p.class_id IN (?) AND p.role = 'student'
            ORDER BY c.name ASC, p.real_name ASC, p.username ASC`,
          [targetClassIds]);
        students = rows;
      }

      const scoreMap = new Map(); // `${studentId}::${questionId}` → { best, full, tries }
      if (students.length) {
        const ids = students.map((s) => s.id);
        const [sRows] = await pool.query(
          `SELECT student_id, question_id,
                  MAX(score_obtained) AS best,
                  MAX(full_score) AS full_score,
                  COUNT(*) AS tries
             FROM wps_op_submissions
            WHERE student_id IN (?)
            GROUP BY student_id, question_id`, [ids]);
        for (const r of sRows) {
          scoreMap.set(`${r.student_id}::${r.question_id}`, {
            best: Number(r.best),
            full: Number(r.full_score),
            tries: Number(r.tries),
          });
        }
      }

      const fullMark = questions.reduce((a, q) => a + q.full_score, 0);
      const out = students.map((s) => {
        const scores = {};
        let total = 0;
        let doneCount = 0;
        for (const q of questions) {
          const hit = scoreMap.get(`${s.id}::${q.id}`);
          if (hit) {
            scores[q.id] = hit;
            total += hit.best;
            doneCount += 1;
          }
        }
        return {
          id: s.id,
          username: s.username,
          real_name: s.real_name,
          class_id: s.class_id,
          class_name: s.class_name || '',
          scores,
          total: Math.round(total * 100) / 100,
          done_count: doneCount,
          full_mark: Math.round(fullMark * 100) / 100,
        };
      });

      // 每题的整体情况（教师一眼看出哪道题全班都栽了）
      const perQuestion = questions.map((q) => {
        let sum = 0, n = 0, max = null, min = null;
        for (const st of out) {
          const hit = st.scores[q.id];
          if (!hit) continue;
          sum += hit.best;
          n += 1;
          if (max === null || hit.best > max) max = hit.best;
          if (min === null || hit.best < min) min = hit.best;
        }
        return {
          question_id: q.id,
          submitted: n,
          avg: n ? Math.round((sum / n) * 100) / 100 : null,
          max,
          min,
        };
      });

      res.json({
        data: {
          classes,
          class_id: pickClassId || '',
          questions,
          students: out,
          per_question: perQuestion,
          student_count: out.length,
          full_mark: Math.round(fullMark * 100) / 100,
        },
        error: null,
      });
    } catch (e) {
      console.error('wps-op analytics error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---------------------------------------------------------------
  // 学生端
  // ---------------------------------------------------------------

  /** 可练的操作题列表 + 我的最好成绩 */
  app.get('/api/student/wps-op/questions', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const [rows] = await pool.query(
        `SELECT id, content, cluster_id, sub_topic, wps_spec
           FROM questions
          WHERE type = 'wps_op' AND practice_enabled = 1
          ORDER BY cluster_id ASC, created_at DESC`);
      const [mine] = await pool.query(
        `SELECT question_id, MAX(score_obtained) AS best, COUNT(*) AS tries, MAX(full_score) AS full_score
           FROM wps_op_submissions WHERE student_id = ? GROUP BY question_id`, [studentId]);
      const mineMap = new Map(mine.map((m) => [m.question_id, m]));
      const list = rows.map((r) => {
        const spec = stripSpecForStudent(r.wps_spec);
        const m = mineMap.get(r.id);
        const tpl = spec.templates[0];
        return {
          id: r.id,
          content: r.content,
          cluster_id: r.cluster_id,
          sub_topic: r.sub_topic,
          full_score: spec.full_score,
          step_count: spec.steps.length,
          template_name: tpl ? tpl.name : '',
          template_count: spec.templates.length,
          best_score: m ? Number(m.best) : null,
          tries: m ? Number(m.tries) : 0,
        };
      });
      res.json({ data: list, error: null });
    } catch (e) {
      console.error('wps-op list error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /** 题目详情（含脱敏评分点）+ 我的历史提交 */
  app.get('/api/student/wps-op/:questionId', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const questionId = req.params.questionId;
      const [rows] = await pool.query(
        `SELECT id, content, cluster_id, sub_topic, wps_spec
           FROM questions WHERE id = ? AND type = 'wps_op' LIMIT 1`, [questionId]);
      if (!rows.length) return res.status(404).json({ data: null, error: '操作题不存在或已下架' });
      const q = rows[0];
      // 每条历史提交都带上自己的判分明细（score_detail）→ 学生端点历史记录即可复看错在哪。
      // ⛔ 只回本人提交（WHERE student_id = ?）；明细经 shapeResultForStudent 脱敏。
      const [subs] = await pool.query(
        `SELECT id, original_filename, score_obtained, full_score, score_detail, graded_at, created_at
           FROM wps_op_submissions WHERE student_id = ? AND question_id = ?
          ORDER BY created_at DESC LIMIT 20`, [studentId, questionId]);
      res.json({
        data: {
          id: q.id,
          content: q.content,
          cluster_id: q.cluster_id,
          sub_topic: q.sub_topic,
          spec: stripSpecForStudent(q.wps_spec),
          submissions: subs.map((s) => {
            const detail = safeJson(s.score_detail, null);
            return {
              id: s.id,
              filename: s.original_filename,
              score: Number(s.score_obtained),
              full_score: Number(s.full_score),
              graded_at: s.graded_at,
              created_at: s.created_at,
              detail: detail ? shapeResultForStudent(detail) : null,
            };
          }),
        },
        error: null,
      });
    } catch (e) {
      console.error('wps-op detail error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /** 最近一次判分结果（含逐评分点明细） */
  app.get('/api/student/wps-op/:questionId/result', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const [rows] = await pool.query(
        `SELECT id, score_obtained, full_score, score_detail, original_filename, graded_at, created_at
           FROM wps_op_submissions WHERE student_id = ? AND question_id = ?
          ORDER BY created_at DESC LIMIT 1`, [studentId, req.params.questionId]);
      if (!rows.length) return res.json({ data: null, error: null });
      const r = rows[0];
      const detail = safeJson(r.score_detail, null);
      res.json({
        data: {
          submission_id: r.id,
          filename: r.original_filename,
          score: Number(r.score_obtained),
          full_score: Number(r.full_score),
          graded_at: r.graded_at,
          created_at: r.created_at,
          detail: detail ? shapeResultForStudent(detail) : null,
        },
        error: null,
      });
    } catch (e) {
      console.error('wps-op result error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 下载「我自己」提交的作答文件（只能下自己的）。
   * 用途：学生下载上次交的文件，在此基础上修改后再上传，避免从头重做。
   * ⛔ 归属校验：WHERE student_id = ?，别人的提交一概 404。
   */
  app.get('/api/student/wps-op/submissions/:submissionId/file', authenticate, requireStudent, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT file_path, original_filename FROM wps_op_submissions
          WHERE id = ? AND student_id = ? AND kind = 'wps' LIMIT 1`, [req.params.submissionId, req.user.userId]);
      if (!rows.length || !rows[0].file_path) return res.status(404).json({ data: null, error: '提交记录不存在' });
      const rel = String(rows[0].file_path).replace(/^\/+/, '').replace(/^uploads[\\/]/, '');
      const abs = path.resolve(uploadsDir, rel);
      // ⛔ 防目录穿越：解析后必须仍落在 submissions 目录内
      if (!abs.startsWith(submissionDir + path.sep)) return res.status(400).json({ data: null, error: '非法文件路径' });
      if (!fs.existsSync(abs)) return res.status(404).json({ data: null, error: '文件已不存在（可能被清理）' });
      res.download(abs, rows[0].original_filename || path.basename(abs));
    } catch (e) {
      console.error('wps-op submission download error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 提交作答并判分。
   * ⛔ 必须 requireStudent：本接口会把结果写进 student_answers（掌握口径按 student_id 统计），
   *    若放行教师，教师的提交会以教师 id 落进答题记录，污染统计且无法归属到任何学生。
   *    教师自测请走「远程控制学生桌面」（proxy_token 已把 req.user 换成学生）。
   */
  app.post('/api/student/wps-op/:questionId/submit', authenticate, requireStudent, wrapUpload(submissionUpload.single('file')), async (req, res) => {
    const cleanupUploaded = () => { try { if (req.file) fs.unlinkSync(req.file.path); } catch { /* ignore */ } };
    try {
      const studentId = req.user.userId;
      const questionId = req.params.questionId;
      if (!req.file) return res.status(400).json({ data: null, error: '未接收到作答文件' });

      const [rows] = await pool.query(
        `SELECT id, type, content, wps_spec, practice_enabled FROM questions WHERE id = ? LIMIT 1`, [questionId]);
      if (!rows.length) { cleanupUploaded(); return res.status(404).json({ data: null, error: '操作题不存在' }); }
      const q = rows[0];
      if (q.type !== 'wps_op') { cleanupUploaded(); return res.status(400).json({ data: null, error: '该题不是 WPS 操作题' }); }

      const spec = safeJson(q.wps_spec, null);
      if (!spec || !Array.isArray(spec.steps) || !spec.steps.length) {
        cleanupUploaded();
        return res.status(400).json({ data: null, error: '该题尚未配置评分点，暂时无法判分' });
      }

      // 判分（服务端权威）
      let result;
      try {
        result = await grader.gradeFile(req.file.path, spec);
      } catch (gradeErr) {
        cleanupUploaded();
        return res.status(400).json({
          data: null,
          error: '文件无法识别：' + gradeErr.message + '。请确认用 WPS 表格编辑并「另存为 .xlsx」后再上传。',
        });
      }

      const originalName = fixName(req.file.originalname);
      const full = Number(result.full_score) || 0;
      const obtained = Number(result.score) || 0;
      const isFull = full > 0 && Math.abs(obtained - full) < 1e-9;
      const specSource = (req.body && req.body.source) ? String(req.body.source).slice(0, 20) : 'practice';
      const refId = (req.body && req.body.ref_id) ? String(req.body.ref_id).slice(0, 50) : null;

      // ⛔ 幂等：同一学生 + 同一题 + 同一份文件不重复记分，只回放上次结果
      const [dupRows] = await pool.query(
        `SELECT id, score_obtained, full_score, score_detail, graded_at, created_at
           FROM wps_op_submissions
          WHERE student_id = ? AND question_id = ? AND file_sha256 = ?
          ORDER BY created_at DESC LIMIT 1`, [studentId, questionId, result.sha256]);
      if (dupRows.length) {
        cleanupUploaded();
        const prev = dupRows[0];
        const detail = safeJson(prev.score_detail, null);
        return res.json({
          data: {
            duplicate: true,
            submission_id: prev.id,
            score: Number(prev.score_obtained),
            full_score: Number(prev.full_score),
            passed: Number(prev.score_obtained) >= Number(prev.full_score),
            created_at: prev.created_at,
            detail: detail ? shapeResultForStudent(detail) : null,
            message: '这份文件与上次提交完全相同，未重复记分，以下是上次的判分结果。',
          },
          error: null,
        });
      }

      result.submitted_at = new Date().toISOString();
      result.filename = originalName;

      const submissionId = 'wps_' + uuidv4().replace(/-/g, '').slice(0, 24);
      await pool.query(
        `INSERT INTO wps_op_submissions
           (id, student_id, question_id, source, ref_id, file_path, original_filename, file_size,
            file_sha256, score_obtained, full_score, score_detail, graded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [submissionId, studentId, questionId, specSource, refId,
         '/uploads/wps-op/submissions/' + req.file.filename,
         originalName, req.file.size, result.sha256, obtained, full,
         JSON.stringify(result)]);

      // 进入既有统计口径：练习来源 + 满分才算答对（掌握门禁用的就是 is_correct）
      // ⛔ 积分不在这里发（一期不涉及积分），points_change 固定 0，避免牵动积分原子写铁律。
      try {
        await pool.query(
          `INSERT INTO student_answers
             (id, student_id, question_id, answer, is_correct, points_change, source, score_obtained, score_detail, created_at)
           VALUES (?, ?, ?, ?, ?, 0, 'practice', ?, ?, NOW())`,
          ['ans_wps_' + uuidv4().replace(/-/g, '').slice(0, 20), studentId, questionId,
           `[WPS操作题] ${originalName} #${String(result.sha256).slice(0, 16)}`,
           isFull ? 1 : 0, obtained, JSON.stringify(result)]);
      } catch (ansErr) {
        // 统计写入失败不影响判分回执，但要留痕
        console.error('wps-op student_answers 写入失败（判分结果已保存）:', ansErr.message);
      }

      res.json({
        data: {
          duplicate: false,
          submission_id: submissionId,
          score: obtained,
          full_score: full,
          percent: result.percent,
          passed: isFull,
          created_at: result.submitted_at,
          detail: shapeResultForStudent(result),
        },
        error: null,
      });
    } catch (e) {
      cleanupUploaded();
      console.error('wps-op submit error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  return { stripSpecForStudent, normalizeTemplates, normalizeStemBlocks };
}

module.exports = { registerWpsOp, stripSpecForStudent, normalizeTemplates, normalizeStemBlocks, createOpImageRoutes, shapeResultForStudent };
