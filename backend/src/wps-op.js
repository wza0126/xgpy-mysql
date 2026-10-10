/**
 * WPS 操作题（学测信息技术操作题）一期后端
 * ============================================================
 * 形态：教师上传模板 → 学生用真 WPS 做题 → 上传 xlsx → 服务端逐评分点判分 → 回执。
 *
 * ⛔ 安全红线（与全站判分铁律一致）：
 *   1) 评分点 wps_spec.steps[].checks[] **就是答案**，学生端接口一律经 stripSpecForStudent 剥离，
 *      只下发步骤标题 / 说明 / 演示视频位。
 *   2) 判分 100% 在服务端做，前端传来的分数一概不采信。
 *   3) questions.wps_spec 已加入 QUESTION_ANSWER_FIELDS，通用表接口 /api/tables/questions
 *      对学生同样会剥离，避免从旁路泄露答案。
 *
 * 幂等：同一学生 + 同一题 + 同一份文件（sha256）重复提交不会重复记分，只回放上次结果。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const grader = require('./wps-grader');

const ALLOWED_EXT = /\.(xlsx|xlsm)$/i;

function safeJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/**
 * 给学生看的问题视图：只保留"题目本身"（题干、步骤说明、演示视频），
 * ⛔ 绝不包含 checks[]（答案）与 grader（判分口径）。
 */
function stripSpecForStudent(spec) {
  const s = safeJson(spec, {});
  return {
    version: s.version || 1,
    full_score: Number(s.full_score) || 10,
    template: s.template
      ? { name: s.template.name || '', path: s.template.path || '', size: s.template.size || null }
      : null,
    steps: (Array.isArray(s.steps) ? s.steps : []).map((st, i) => ({
      id: st.id || ('s' + (i + 1)),
      index: i + 1,
      title: st.title || '',
      desc: st.desc || '',
      score: Number(st.score) || 0,
      video_url: st.video_url || '',
      check_count: Array.isArray(st.checks) ? st.checks.length : 0,
    })),
  };
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

function registerWpsOp(app, deps) {
  const { pool, authenticate, requireTeacher, requireStudent, uploadsDir } = deps;

  const baseDir = path.join(uploadsDir, 'wps-op');
  const templateDir = path.join(baseDir, 'templates');
  const submissionDir = path.join(baseDir, 'submissions');
  for (const dir of [templateDir, submissionDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const makeStorage = (dir, prefix) => multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.xlsx').toLowerCase();
      cb(null, prefix + '-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    },
  });

  const wpsFileFilter = (req, file, cb) => {
    // ⛔ 只收 OOXML（xlsx/xlsm）：WPS 原生 .et 与二进制 .xls 判分引擎读不了，
    //    这里直接拒绝并给出可操作的提示，避免"上传成功但判不了分"的困惑。
    let original = file.originalname || '';
    try { original = Buffer.from(original, 'latin1').toString('utf8'); } catch { /* 保持原样 */ }
    if (ALLOWED_EXT.test(original)) return cb(null, true);
    cb(new Error('只支持 .xlsx / .xlsm 格式。请在 WPS 中「另存为 → Excel 工作簿(*.xlsx)」后再上传。'));
  };

  const templateUpload = multer({ storage: makeStorage(templateDir, 'tpl'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: wpsFileFilter });
  const submissionUpload = multer({ storage: makeStorage(submissionDir, 'sub'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: wpsFileFilter });

  const fixName = (name) => {
    try { return Buffer.from(name || '', 'latin1').toString('utf8'); } catch { return name || ''; }
  };

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

  /** 上传模板文件（学生下载用） */
  app.post('/api/teacher/wps-op/template', authenticate, requireTeacher, wrapUpload(templateUpload.single('file')), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ data: null, error: '未接收到文件' });
      const originalName = fixName(req.file.originalname);
      res.json({
        data: {
          path: '/uploads/wps-op/templates/' + req.file.filename,
          name: originalName,
          size: req.file.size,
          stored_name: req.file.filename,
        },
        error: null,
      });
    } catch (e) {
      console.error('wps-op template upload error:', e);
      res.status(500).json({ data: null, error: e.message });
    }
  });

  /**
   * 上传"标准答案"文件 → 解析 OOXML 结构并自动生成评分点骨架。
   * 这是"题库录入方便"的关键：老师把做好的答案表丢进来，评分点自动填好，再改改分值即可。
   */
  app.post('/api/teacher/wps-op/inspect', authenticate, requireTeacher, wrapUpload(submissionUpload.single('file')), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ data: null, error: '未接收到文件' });
      const summary = await grader.inspectFile(req.file.path);
      let suggested = null;
      try {
        suggested = await grader.suggestSpec(req.file.path, { sheet: req.body && req.body.sheet ? req.body.sheet : undefined });
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
    };
    res.json({ data: { kinds: grader.CHECK_KINDS, doc }, error: null });
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
        return {
          id: r.id,
          content: r.content,
          cluster_id: r.cluster_id,
          sub_topic: r.sub_topic,
          full_score: spec.full_score,
          step_count: spec.steps.length,
          template_name: spec.template ? spec.template.name : '',
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
      const [subs] = await pool.query(
        `SELECT id, original_filename, score_obtained, full_score, graded_at, created_at,
                CASE WHEN score_detail IS NULL THEN NULL ELSE JSON_EXTRACT(score_detail, '$.submitted_at') END AS x
           FROM wps_op_submissions WHERE student_id = ? AND question_id = ?
          ORDER BY created_at DESC LIMIT 20`, [studentId, questionId]);
      res.json({
        data: {
          id: q.id,
          content: q.content,
          cluster_id: q.cluster_id,
          sub_topic: q.sub_topic,
          spec: stripSpecForStudent(q.wps_spec),
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

  return { stripSpecForStudent };
}

module.exports = { registerWpsOp, stripSpecForStudent };
