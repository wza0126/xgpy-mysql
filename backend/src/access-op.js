/**
 * Access 操作题（学测信息技术操作题）后端
 * ============================================================
 * 形态与 WPS 操作题**完全一致**（复用同一套产品链路与评分点模型）：
 *   教师上传模板（空白 .accdb + 可选的 xlsx/txt 数据源）→ 学生用真 Access 做题
 *     → 上传 .accdb → 服务端逐评分点判分 → 回执。
 *
 * 与 wps-op.js 的差异只在"判什么"：
 *   WPS 判 OOXML 文档结构（wps-grader.js），Access 判库内表/字段/类型/主键/记录/排序/筛选
 *   （access-grader.js，底层是 vendor/mdb-reader.cjs）。
 *
 * ⛔ 安全红线（与全站判分铁律一致）：
 *   1) 评分点 access_spec.steps[].checks[] **就是答案**，学生端接口一律经 stripSpecForStudent
 *      剥离，只下发步骤标题 / 说明 / 演示视频位 / 模板清单。
 *   2) 判分 100% 在服务端做，前端传来的分数一概不采信。
 *   3) questions.access_spec 已加入 QUESTION_ANSWER_FIELDS，通用表接口 /api/tables/questions
 *      对学生同样会剥离，避免从旁路泄露答案。
 *
 * 幂等：同一学生 + 同一题 + 同一份文件（sha256）重复提交不会重复记分，只回放上次结果。
 *
 * 其余要点：
 *   · 模板支持多文件（templates[]）：一道导入题可能同时要"空白库 + xlsx 数据源"。
 *   · 演示视频：与本项目 WPS 操作题同一套（可本地上传 / 外链抓取到本地），一步可挂多条。
 *   · 默认满分 100。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Transform, Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { v4: uuidv4 } = require('uuid');
const grader = require('./access-grader');
const { stripSpecForStudent, normalizeTemplates } = require('./wps-op');

const DB_EXT = /\.(accdb|mdb)$/i;                       // 作答文件：必须 Access 库
const TEMPLATE_EXT = /\.(accdb|mdb|xlsx|xlsm|csv|txt)$/i; // 模板：空白库 + 数据源
const EXTRA_EXT = /\.(txt|csv|xlsx|xlsm)$/i;            // 导出题另交的附件
const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i;
const DEFAULT_FULL_SCORE = 100;
const VIDEO_MAX_MB = Number(process.env.ACCESS_VIDEO_MAX_MB || 200);
const VIDEO_FETCH_TIMEOUT_MS = Number(process.env.ACCESS_VIDEO_FETCH_TIMEOUT_MS || 60000);

function safeJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}
function fixUtf8Name(name) {
  try { return Buffer.from(name || '', 'latin1').toString('utf8'); } catch { return name || ''; }
}
function guessKind(name) {
  const ext = String(path.extname(String(name || '')) || '').toLowerCase();
  if (ext === '.txt' || ext === '.csv') return 'text';
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx';
  return 'accdb';
}

function registerAccessOp(app, deps) {
  const { pool, authenticate, requireTeacher, requireStudent, uploadsDir } = deps;

  const baseDir = path.join(uploadsDir, 'access-op');
  const templateDir = path.join(baseDir, 'templates');
  const submissionDir = path.join(baseDir, 'submissions');
  const videoDir = path.join(baseDir, 'videos');
  const extraDir = path.join(baseDir, 'extras');
  for (const dir of [templateDir, submissionDir, videoDir, extraDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const makeStorage = (dir, prefix, fallbackExt) => multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = (path.extname(fixUtf8Name(file.originalname)) || fallbackExt).toLowerCase();
      cb(null, prefix + '-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    },
  });

  const dbFileFilter = (req, file, cb) => {
    const original = fixUtf8Name(file.originalname);
    if (DB_EXT.test(original)) return cb(null, true);
    cb(new Error('作答文件只支持 .accdb / .mdb。请在 Access 中「文件 → 保存」后再上传。'));
  };
  // 二期：提交接口主文件(file)=.accdb，导出附件(extras)=txt/csv/xlsx —— 同一个 multer 实例按字段名分流
  const submitFileFilter = (req, file, cb) => {
    const original = fixUtf8Name(file.originalname);
    if (file.fieldname === 'extras') {
      if (EXTRA_EXT.test(original)) return cb(null, true);
      return cb(new Error('导出附件只支持 .txt / .csv / .xlsx / .xlsm。'));
    }
    if (DB_EXT.test(original)) return cb(null, true);
    cb(new Error('作答文件只支持 .accdb / .mdb。请在 Access 中「文件 → 保存」后再上传。'));
  };
  const templateFileFilter = (req, file, cb) => {
    const original = fixUtf8Name(file.originalname);
    if (TEMPLATE_EXT.test(original)) return cb(null, true);
    cb(new Error('模板只支持 .accdb / .mdb / .xlsx / .txt / .csv。导入题记得把数据源（xlsx）一起传上来。'));
  };
  const extraFileFilter = (req, file, cb) => {
    const original = fixUtf8Name(file.originalname);
    if (EXTRA_EXT.test(original)) return cb(null, true);
    cb(new Error('另交的附件只支持 .txt / .csv / .xlsx / .xlsm（导出题要另交的文件）。'));
  };
  const videoFileFilter = (req, file, cb) => {
    const original = fixUtf8Name(file.originalname);
    if (VIDEO_EXT.test(original)) return cb(null, true);
    cb(new Error('演示视频只支持 mp4 / webm / ogg / mov 格式。'));
  };

  const LIMIT = 60 * 1024 * 1024; // .accdb 里可能有 OLE 附件，给到 60MB
  const templateUpload = multer({ storage: makeStorage(templateDir, 'tpl', '.accdb'), limits: { fileSize: LIMIT }, fileFilter: templateFileFilter });
  // 二期：提交接口专用 storage —— extras 落 extras 目录，主文件落 submissions 目录
  const submitStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'extras' ? extraDir : submissionDir),
    filename: (req, file, cb) => {
      const ext = (path.extname(fixUtf8Name(file.originalname)) || '.accdb').toLowerCase();
      cb(null, (file.fieldname === 'extras' ? 'ext' : 'sub') + '-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    },
  });
  const submissionUpload = multer({ storage: submitStorage, limits: { fileSize: LIMIT }, fileFilter: submitFileFilter });
  const extraUpload = multer({ storage: makeStorage(extraDir, 'ext', '.txt'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: extraFileFilter });
  const videoUpload = multer({ storage: makeStorage(videoDir, 'vid', '.mp4'), limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 }, fileFilter: videoFileFilter });

  const wrapUpload = (mw) => (req, res, next) => {
    mw(req, res, (err) => {
      if (err) return res.status(400).json({ data: null, error: err.message || '文件上传失败' });
      next();
    });
  };

  // ---------------------------------------------------------------
  // 教师端
  // ---------------------------------------------------------------

  /** 上传模板文件（学生下载用）。支持一次多个：空白库 + xlsx 数据源。 */
  app.post('/api/teacher/access-op/template', authenticate, requireTeacher, wrapUpload(templateUpload.any()), async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ data: null, error: '未接收到文件' });
      const items = files.map((f) => {
        const name = fixUtf8Name(f.originalname);
        return {
          path: '/uploads/access-op/templates/' + f.filename,
          name,
          size: f.size,
          stored_name: f.filename,
          kind: guessKind(name),
        };
      });
      res.json({ data: { files: items, ...items[0] }, error: null });
    } catch (e) {
      console.error('access-op template upload error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /** 上传一份"做好的答案库" → 解析结构并自动生成评分点骨架 */
  app.post('/api/teacher/access-op/inspect', authenticate, requireTeacher, wrapUpload(submissionUpload.single('file')), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ data: null, error: '未接收到文件' });
      const summary = await grader.inspectFile(req.file.path);
      let suggested = null;
      try {
        suggested = await grader.suggestSpec(req.file.path, {
          full_score: req.body && req.body.full_score ? Number(req.body.full_score) : DEFAULT_FULL_SCORE,
        });
      } catch (e) {
        console.warn('access-op suggestSpec failed:', e.message);
      }
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.json({ data: { summary, suggested_spec: suggested }, error: null });
    } catch (e) {
      try { if (req.file) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      console.error('access-op inspect error:', e);
      res.status(500).json({ data: null, error: '库文件无法解析：' + e.message + '。请确认是 Access 直接保存出来的 .accdb（不要加密）。' });
    }
  });

  /** 校验评分点规格 */
  app.post('/api/teacher/access-op/validate-spec', authenticate, requireTeacher, async (req, res) => {
    try {
      const result = grader.validateSpec(req.body && req.body.spec, req.body && req.body.full_score);
      res.json({ data: result, error: null });
    } catch (e) {
      res.status(400).json({ data: null, error: e.message });
    }
  });

  /** 可用的检查器类型清单（教师端下拉用） */
  app.get('/api/teacher/access-op/check-kinds', authenticate, requireTeacher, (req, res) => {
    const doc = {
      accdb_table: { label: '表存在 / 不存在', fields: ['table', 'absent'] },
      accdb_columns: { label: '字段名与顺序', fields: ['table', 'columns', 'contains', 'absent', 'unordered'] },
      accdb_column_type: { label: '字段类型 / 字段大小', fields: ['table', 'column', 'type', 'size'] },
      accdb_primary_key: { label: '主键', fields: ['table', 'columns', 'order', 'absent'] },
      accdb_rows: { label: '记录（数量/包含/不含）', fields: ['table', 'count', 'contains', 'absent'] },
      accdb_row_update: { label: '记录字段值（改记录）', fields: ['table', 'match', 'expect'] },
      accdb_sort: { label: '排序', fields: ['table', 'column', 'columns', 'order', 'mode'] },
      accdb_filter: { label: '筛选', fields: ['table', 'column', 'op', 'value'] },
      accdb_object: { label: '对象存在（表/查询/窗体…）', fields: ['name', 'object_type', 'absent'] },
    };
    res.json({ data: { kinds: grader.CHECK_KINDS, doc, video_max_mb: VIDEO_MAX_MB }, error: null });
  });

  /** 上传本地演示视频（同 WPS，一个步骤可挂多条） */
  app.post('/api/teacher/access-op/video', authenticate, requireTeacher, wrapUpload(videoUpload.single('file')), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ data: null, error: '未接收到视频文件' });
      res.json({
        data: {
          url: '/uploads/access-op/videos/' + req.file.filename,
          name: fixUtf8Name(req.file.originalname),
          size: req.file.size,
          stored_name: req.file.filename,
          source: 'local',
        },
        error: null,
      });
    } catch (e) {
      console.error('access-op video upload error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /** 把外网演示视频抓取到本地后引用（机房断网也能播） */
  app.post('/api/teacher/access-op/video/fetch', authenticate, requireTeacher, async (req, res) => {
    const url = String((req.body && req.body.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ data: null, error: '请填写以 http:// 或 https:// 开头的视频直链' });
    }
    let outPath = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), VIDEO_FETCH_TIMEOUT_MS);
      let resp;
      try { resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow' }); }
      finally { clearTimeout(timer); }
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
          url: '/uploads/access-op/videos/' + fileName,
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
      console.error('access-op video fetch error:', e);
      const hint = /abort|timeout|fetch failed|ENOTFOUND|ECONN/i.test(String(e.message))
        ? '（如果这台机器连不上外网，请改用「上传本地视频」）'
        : '';
      res.status(400).json({ data: null, error: '抓取失败：' + e.message + hint });
    }
  });

  /** 学生在某题上的提交记录（教师查看/讲评用） */
  app.get('/api/teacher/access-op/submissions', authenticate, requireTeacher, async (req, res) => {
    try {
      const questionId = (req.query.questionId || '').toString().trim();
      const studentId = (req.query.studentId || '').toString().trim();
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const where = ["s.kind = 'access'"];
      const params = [];
      if (questionId) { where.push('s.question_id = ?'); params.push(questionId); }
      if (studentId) { where.push('s.student_id = ?'); params.push(studentId); }
      const [rows] = await pool.query(
        `SELECT s.id, s.student_id, s.question_id, s.source, s.original_filename, s.file_size,
                s.score_obtained, s.full_score, s.graded_at, s.created_at,
                p.real_name, p.username
           FROM wps_op_submissions s
           LEFT JOIN profiles p ON p.id = s.student_id
          WHERE ${where.join(' AND ')}
          ORDER BY s.created_at DESC
          LIMIT ?`, [...params, limit]);
      res.json({ data: rows, error: null });
    } catch (e) {
      console.error('access-op submissions error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 教师端 · Access 操作题练习情况总览
   * 口径与 WPS 完全一致：每题取该生最高分，学生总分 = Σ 各题最高分。
   */
  app.get('/api/teacher/access-op/analytics', authenticate, requireTeacher, async (req, res) => {
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

      const [qRows] = await pool.query(
        `SELECT id, content, cluster_id, practice_enabled, access_spec
           FROM questions WHERE type = 'access_op'
          ORDER BY cluster_id ASC, created_at ASC`);
      const questions = qRows.map((q) => {
        const spec = safeJson(q.access_spec, {});
        return {
          id: q.id,
          title: String(q.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 36) || q.id,
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

      const scoreMap = new Map();
      if (students.length) {
        const ids = students.map((s) => s.id);
        const [sRows] = await pool.query(
          `SELECT student_id, question_id, MAX(score_obtained) AS best,
                  MAX(full_score) AS full_score, COUNT(*) AS tries
             FROM wps_op_submissions
            WHERE kind = 'access' AND student_id IN (?)
            GROUP BY student_id, question_id`, [ids]);
        for (const r of sRows) {
          scoreMap.set(`${r.student_id}::${r.question_id}`, { best: Number(r.best), full: Number(r.full_score), tries: Number(r.tries) });
        }
      }

      const fullMark = questions.reduce((a, q) => a + q.full_score, 0);
      const out = students.map((s) => {
        const scores = {};
        let total = 0;
        let doneCount = 0;
        for (const q of questions) {
          const hit = scoreMap.get(`${s.id}::${q.id}`);
          if (hit) { scores[q.id] = hit; total += hit.best; doneCount += 1; }
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

      const perQuestion = questions.map((q) => {
        let sum = 0, n = 0, max = null, min = null;
        for (const st of out) {
          const hit = st.scores[q.id];
          if (!hit) continue;
          sum += hit.best; n += 1;
          if (max === null || hit.best > max) max = hit.best;
          if (min === null || hit.best < min) min = hit.best;
        }
        return { question_id: q.id, submitted: n, avg: n ? Math.round((sum / n) * 100) / 100 : null, max, min };
      });

      res.json({
        data: { classes, class_id: pickClassId || '', questions, students: out, per_question: perQuestion, student_count: out.length, full_mark: Math.round(fullMark * 100) / 100 },
        error: null,
      });
    } catch (e) {
      console.error('access-op analytics error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---------------------------------------------------------------
  // 学生端
  // ---------------------------------------------------------------

  /** 可练的操作题列表 + 我的最好成绩 */
  app.get('/api/student/access-op/questions', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const [rows] = await pool.query(
        `SELECT id, content, cluster_id, sub_topic, access_spec
           FROM questions
          WHERE type = 'access_op' AND practice_enabled = 1
          ORDER BY cluster_id ASC, created_at DESC`);
      const [mine] = await pool.query(
        `SELECT question_id, MAX(score_obtained) AS best, COUNT(*) AS tries, MAX(full_score) AS full_score
           FROM wps_op_submissions WHERE kind = 'access' AND student_id = ? GROUP BY question_id`, [studentId]);
      const mineMap = new Map(mine.map((m) => [m.question_id, m]));
      const list = rows.map((r) => {
        const spec = stripSpecForStudent(r.access_spec);
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
      console.error('access-op list error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /** 题目详情（含脱敏评分点）+ 我的历史提交 */
  app.get('/api/student/access-op/:questionId', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const questionId = req.params.questionId;
      const [rows] = await pool.query(
        `SELECT id, content, cluster_id, sub_topic, access_spec
           FROM questions WHERE id = ? AND type = 'access_op' LIMIT 1`, [questionId]);
      if (!rows.length) return res.status(404).json({ data: null, error: '操作题不存在或已下架' });
      const q = rows[0];
      const [subs] = await pool.query(
        `SELECT id, original_filename, score_obtained, full_score, graded_at, created_at
           FROM wps_op_submissions WHERE kind = 'access' AND student_id = ? AND question_id = ?
          ORDER BY created_at DESC LIMIT 20`, [studentId, questionId]);
      res.json({
        data: {
          id: q.id,
          content: q.content,
          cluster_id: q.cluster_id,
          sub_topic: q.sub_topic,
          spec: stripSpecForStudent(q.access_spec),
          submissions: subs.map((s) => ({
            id: s.id,
            filename: s.original_filename,
            score: Number(s.score_obtained),
            full_score: Number(s.full_score),
            graded_at: s.graded_at,
            created_at: s.created_at,
          })),
        },
        error: null,
      });
    } catch (e) {
      console.error('access-op detail error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /** 最近一次判分结果（含逐评分点明细） */
  app.get('/api/student/access-op/:questionId/result', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const [rows] = await pool.query(
        `SELECT id, score_obtained, full_score, score_detail, original_filename, graded_at, created_at
           FROM wps_op_submissions WHERE kind = 'access' AND student_id = ? AND question_id = ?
          ORDER BY created_at DESC LIMIT 1`, [studentId, req.params.questionId]);
      if (!rows.length) return res.json({ data: null, error: null });
      const r = rows[0];
      const detail = safeJson(r.score_detail, null);
      const shaped = detail ? { ...detail } : null;
      if (shaped) { delete shaped.sha256; }
      res.json({
        data: {
          submission_id: r.id,
          filename: r.original_filename,
          score: Number(r.score_obtained),
          full_score: Number(r.full_score),
          graded_at: r.graded_at,
          created_at: r.created_at,
          detail: shaped,
        },
        error: null,
      });
    } catch (e) {
      console.error('access-op result error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 下载「我自己」提交的作答库（只能下自己的，归属校验同 WPS）。
   * 用途：学生下载上次交的 .accdb，在此基础上修改后再上传。
   */
  app.get('/api/student/access-op/submissions/:submissionId/file', authenticate, requireStudent, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT file_path, original_filename FROM wps_op_submissions
          WHERE id = ? AND student_id = ? AND kind = 'access' LIMIT 1`, [req.params.submissionId, req.user.userId]);
      if (!rows.length || !rows[0].file_path) return res.status(404).json({ data: null, error: '提交记录不存在' });
      const rel = String(rows[0].file_path).replace(/^\/+/, '').replace(/^uploads[\\/]/, '');
      const abs = path.resolve(uploadsDir, rel);
      // ⛔ 防目录穿越：解析后必须仍落在 submissions 目录内
      if (!abs.startsWith(submissionDir + path.sep)) return res.status(400).json({ data: null, error: '非法文件路径' });
      if (!fs.existsSync(abs)) return res.status(404).json({ data: null, error: '文件已不存在（可能被清理）' });
      res.download(abs, rows[0].original_filename || path.basename(abs));
    } catch (e) {
      console.error('access-op submission download error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 提交作答并判分。
   * ⛔ 必须 requireStudent（理由同 WPS：结果要落 student_answers，教师提交会污染统计）。
   * 支持同时提交：主文件（.accdb）+ 导出题另交的附件（txt/xlsx，字段名 extras[]）。
   */
  app.post('/api/student/access-op/:questionId/submit', authenticate, requireStudent,
    wrapUpload(submissionUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'extras', maxCount: 10 }])),
    async (req, res) => {
      const cleanup = (fs2) => { try { if (fs2 && fs2.path) fs.unlinkSync(fs2.path); } catch { /* ignore */ } };
      try {
        const studentId = req.user.userId;
        const questionId = req.params.questionId;
        const main = req.files && req.files.file && req.files.file[0];
        const extras = (req.files && req.files.extras) || [];
        if (!main) return res.status(400).json({ data: null, error: '未接收到作答文件（.accdb）' });

        const [rows] = await pool.query(
          `SELECT id, type, content, access_spec, practice_enabled FROM questions WHERE id = ? LIMIT 1`, [questionId]);
        if (!rows.length) { cleanup(main); extras.forEach(cleanup); return res.status(404).json({ data: null, error: '操作题不存在' }); }
        const q = rows[0];
        if (q.type !== 'access_op') { cleanup(main); extras.forEach(cleanup); return res.status(400).json({ data: null, error: '该题不是 Access 操作题' }); }

        const spec = safeJson(q.access_spec, null);
        if (!spec || !Array.isArray(spec.steps) || !spec.steps.length) {
          cleanup(main); extras.forEach(cleanup);
          return res.status(400).json({ data: null, error: '该题尚未配置评分点，暂时无法判分' });
        }

        let result;
        try {
          // 二期：导出题附件一并送判（accdb_export 检查器按 type/match 匹配附件）
          const extraPayload = [];
          for (const f of extras) {
            try {
              const name = fixUtf8Name(f.originalname);
              extraPayload.push({ name, kind: guessKind(name), buffer: fs.readFileSync(f.path) });
            } catch (e) { /* 读不到的附件按"没有"处理 */ }
          }
          result = await grader.gradeFile(main.path, spec, extraPayload);
        } catch (gradeErr) {
          cleanup(main); extras.forEach(cleanup);
          return res.status(400).json({
            data: null,
            error: '库文件无法识别：' + gradeErr.message + '。请确认是 Access 直接保存出来的 .accdb（不要加密、不要改扩展名）。',
          });
        }

        const originalName = fixUtf8Name(main.originalname);
        const full = Number(result.full_score) || 0;
        const obtained = Number(result.score) || 0;
        const isFull = full > 0 && Math.abs(obtained - full) < 1e-9;
        const specSource = (req.body && req.body.source) ? String(req.body.source).slice(0, 20) : 'practice';
        const refId = (req.body && req.body.ref_id) ? String(req.body.ref_id).slice(0, 50) : null;

        // ⛔ 幂等：同一学生 + 同一题 + 同一份文件不重复记分
        const [dupRows] = await pool.query(
          `SELECT id, score_obtained, full_score, score_detail, graded_at, created_at
             FROM wps_op_submissions
            WHERE kind = 'access' AND student_id = ? AND question_id = ? AND file_sha256 = ?
            ORDER BY created_at DESC LIMIT 1`, [studentId, questionId, result.sha256]);
        if (dupRows.length) {
          cleanup(main); extras.forEach(cleanup);
          const prev = dupRows[0];
          const detail = safeJson(prev.score_detail, null);
          const shaped = detail ? { ...detail } : null;
          if (shaped) delete shaped.sha256;
          return res.json({
            data: {
              duplicate: true,
              submission_id: prev.id,
              score: Number(prev.score_obtained),
              full_score: Number(prev.full_score),
              passed: Number(prev.score_obtained) >= Number(prev.full_score),
              created_at: prev.created_at,
              detail: shaped,
              message: '这份文件与上次提交完全相同，未重复记分，以下是上次的判分结果。',
            },
            error: null,
          });
        }

        result.submitted_at = new Date().toISOString();
        result.filename = originalName;
        const extraMeta = extras.map((f) => ({
          name: fixUtf8Name(f.originalname),
          path: '/uploads/access-op/extras/' + f.filename,
          size: f.size,
          kind: guessKind(fixUtf8Name(f.originalname)),
        }));

        const submissionId = 'acc_' + uuidv4().replace(/-/g, '').slice(0, 24);
        await pool.query(
          `INSERT INTO wps_op_submissions
             (id, student_id, question_id, source, ref_id, file_path, original_filename, file_size,
              file_sha256, score_obtained, full_score, score_detail, kind, extra_files, graded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'access', ?, NOW())`,
          [submissionId, studentId, questionId, specSource, refId,
           '/uploads/access-op/submissions/' + main.filename,
           originalName, main.size, result.sha256, obtained, full,
           JSON.stringify(result), extraMeta.length ? JSON.stringify(extraMeta) : null]);

        // 进入既有统计口径：满分才算答对（掌握门禁用的就是 is_correct）
        try {
          await pool.query(
            `INSERT INTO student_answers
               (id, student_id, question_id, answer, is_correct, points_change, source, score_obtained, score_detail, created_at)
             VALUES (?, ?, ?, ?, ?, 0, 'practice', ?, ?, NOW())`,
            ['ans_acc_' + uuidv4().replace(/-/g, '').slice(0, 20), studentId, questionId,
             `[Access操作题] ${originalName} #${String(result.sha256).slice(0, 16)}`,
             isFull ? 1 : 0, obtained, JSON.stringify(result)]);
        } catch (ansErr) {
          console.error('access-op student_answers 写入失败（判分结果已保存）:', ansErr.message);
        }

        const shaped = { ...result };
        delete shaped.sha256;
        res.json({
          data: {
            duplicate: false,
            submission_id: submissionId,
            score: obtained,
            full_score: full,
            percent: result.percent,
            passed: isFull,
            created_at: result.submitted_at,
            detail: shaped,
          },
          error: null,
        });
      } catch (e) {
        const main = req.files && req.files.file && req.files.file[0];
        cleanup(main);
        (((req.files || {}).extras) || []).forEach(cleanup);
        console.error('access-op submit error:', e);
        res.status(500).json({ data: null, error: e.message });
      }
    });

  return { stripSpecForStudent, normalizeTemplates };
}

module.exports = { registerAccessOp };
