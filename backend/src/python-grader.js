// AI作业批改引擎 - 集成DeepSeek API
// 适配江苏省高中信息技术课标

const crypto = require('crypto');
const PythonSandbox = require('./python-sandbox');

function generateId() {
  return 'pygrade_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

function mysqlNow() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

class PythonGrader {
  constructor(options = {}) {
    this.syntaxWeight = options.syntaxWeight || 0.4;
    this.outputWeight = options.outputWeight || 0.4;
    this.logicWeight = options.logicWeight || 0.2;
    this.sandbox = new PythonSandbox({ maxExecutionTime: 3000 });
  }

  // 获取AI配置
  async getAIConfig(pool) {
    try {
      const [rows] = await pool.query(
        'SELECT config_key, value FROM system_config WHERE config_key IN (?, ?, ?, ?)',
        ['ai_api_base_url', 'ai_api_key', 'ai_model', 'ai_temperature']
      );
      
      const config = {};
      rows.forEach(row => {
        const key = row.config_key;
        const value = row.value;
        config[key] = typeof value === 'string' ? JSON.parse(value).value : value.value;
      });
      
      return {
        apiBaseUrl: config.ai_api_base_url || '',
        apiKey: config.ai_api_key || '',
        model: config.ai_model || 'deepseek-v4-flash',
        temperature: config.ai_temperature || 0.7
      };
    } catch (error) {
      console.error('获取AI配置失败:', error);
      return {
        apiBaseUrl: '',
        apiKey: '',
        model: 'deepseek-v4-flash',
        temperature: 0.7
      };
    }
  }

  // 调用DeepSeek API
  async callDeepSeekAPI(config, messages) {
    if (!config.apiBaseUrl || !config.apiKey) {
      throw new Error('AI API未配置，请在系统设置中配置DeepSeek API');
    }

    const apiUrl = `${config.apiBaseUrl}/chat/completions`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        messages,
        model: config.model,
        temperature: config.temperature,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // 填空题评分
  gradeFillBlanks(code, task) {
    const blankAnswers = task.blank_answers || [];
    const blankWeights = task.blank_weights || [];
    const totalScore = task.total_score || 100;

    if (!blankAnswers || blankAnswers.length === 0) {
      return {
        total_score: 0,
        syntax_score: 0,
        output_score: 0,
        logic_score: 0,
        comment: '未配置填空答案',
        blank_results: []
      };
    }

    // 从学生提交的完整代码中提取答案
    const studentAnswers = this.extractBlankAnswers(code, task.blank_template || '');
    const blankResults = [];
    let totalWeight = 0;
    let earnedWeight = 0;

    for (let i = 0; i < blankAnswers.length; i++) {
      const correctAnswers = blankAnswers[i] || [];
      const studentAnswer = (studentAnswers[i] || '').trim();
      const weight = blankWeights[i] != null ? Number(blankWeights[i]) : (100 / blankAnswers.length);
      totalWeight += weight;

      const isCorrect = correctAnswers.some(ans => ans.trim() === studentAnswer);
      if (isCorrect) {
        earnedWeight += weight;
      }

      blankResults.push({
        index: i + 1,
        student_answer: studentAnswer,
        correct_answers: correctAnswers,
        is_correct: isCorrect,
        weight: weight
      });
    }

    const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * totalScore) : 0;

    const correctCount = blankResults.filter(r => r.is_correct).length;
    const comment = `填空题评分：共 ${blankAnswers.length} 空，答对 ${correctCount} 空，得分 ${score}/${totalScore}`;

    return {
      total_score: score,
      syntax_score: 0,
      output_score: score,
      logic_score: 0,
      comment,
      blank_results: blankResults
    };
  }

  // 从完整代码中提取学生填写的答案（基于模板）
  extractBlankAnswers(code, template) {
    const placeholderRegex = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g;
    const templatePlaceholders = [];
    let match;
    while ((match = placeholderRegex.exec(template)) !== null) {
      templatePlaceholders.push({ index: match.index, char: match[0] });
    }
    if (templatePlaceholders.length === 0) return [];

    const answers = [];
    let codePos = 0;
    let templatePos = 0;

    for (let i = 0; i < templatePlaceholders.length; i++) {
      const phInfo = templatePlaceholders[i];
      const prefix = template.substring(templatePos, phInfo.index);

      let codeStart;
      if (prefix) {
        codeStart = code.indexOf(prefix, codePos);
        if (codeStart === -1) {
          answers.push('');
          templatePos = phInfo.index + phInfo.char.length;
          continue;
        }
        codePos = codeStart + prefix.length;
      }

      let suffix = '';
      if (i < templatePlaceholders.length - 1) {
        const nextPhInfo = templatePlaceholders[i + 1];
        suffix = template.substring(phInfo.index + phInfo.char.length, nextPhInfo.index);
      } else {
        suffix = template.substring(phInfo.index + phInfo.char.length);
      }

      let answerEnd = code.length;
      if (suffix) {
        const suffixPos = code.indexOf(suffix, codePos);
        if (suffixPos !== -1) {
          answerEnd = suffixPos;
        }
      }

      answers.push(code.substring(codePos, answerEnd));
      codePos = answerEnd;
      templatePos = phInfo.index + phInfo.char.length;
    }

    return answers;
  }

  // 主批改函数 - 优先使用AI API
  async gradeSubmission(submission, task, pool) {
    const { student_id, task_id, code } = submission;
    const submission_id = submission.id;

    // 填空题走单独评分逻辑
    if (task.task_type === 'fill_blank') {
      const result = this.gradeFillBlanks(code, task);
      return {
        id: generateId(),
        submission_id,
        task_id,
        student_id,
        total_score: result.total_score,
        syntax_score: result.syntax_score,
        output_score: result.output_score,
        logic_score: result.logic_score,
        comment: result.comment,
        syntax_errors: JSON.stringify([]),
        output_diff: '',
        missing_keywords: JSON.stringify([]),
        blank_results: JSON.stringify(result.blank_results || []),
        is_ai_graded: false,
        manually_adjusted: false,
        show_reference_code: result.total_score >= (task.total_score || 100) * 0.6,
        graded_at: mysqlNow(),
        updated_at: mysqlNow()
      };
    }

    // 先进行基础语法检测（快速失败）
    const syntaxResult = await this.checkSyntax(code);
    const syntaxErrors = syntaxResult.errors;
    const syntaxScore = syntaxResult.score;

    // 获取AI配置
    const aiConfig = await this.getAIConfig(pool);
    
    let aiGradeResult = null;
    
    // 如果配置了AI API，尝试使用AI批改
    if (aiConfig.apiBaseUrl && aiConfig.apiKey) {
      try {
        aiGradeResult = await this.gradeWithAI(code, task, syntaxResult, aiConfig);
      } catch (error) {
        console.error('AI批改失败，使用规则引擎:', error.message);
      }
    }

    // 如果AI批改成功，使用AI结果
    if (aiGradeResult) {
      return {
        id: generateId(),
        submission_id,
        task_id,
        student_id,
        total_score: aiGradeResult.total_score,
        syntax_score: aiGradeResult.syntax_score,
        output_score: aiGradeResult.output_score,
        logic_score: aiGradeResult.logic_score,
        comment: aiGradeResult.comment,
        syntax_errors: JSON.stringify(syntaxErrors),
        output_diff: aiGradeResult.output_diff || '',
        missing_keywords: JSON.stringify(aiGradeResult.missing_keywords || []),
        is_ai_graded: true,
        manually_adjusted: false,
        show_reference_code: aiGradeResult.total_score >= task.total_score * 0.6,
        graded_at: mysqlNow(),
        updated_at: mysqlNow()
      };
    }

    // 回退到规则引擎批改
    return await this.gradeWithRules(submission, task, syntaxResult, syntaxErrors, syntaxScore);
  }

  // 使用AI进行批改
  async gradeWithAI(code, task, syntaxResult, aiConfig) {
    const systemPrompt = `你是一位专业的Python编程教育专家，擅长为江苏省高中生批改Python编程作业。
请根据任务要求和学生的代码进行详细批改，给出分数和评语。

评分标准：
- 语法正确性（40%）：代码是否有语法错误
- 运行结果正确性（40%）：输出是否符合预期
- 逻辑结构完整性（20%）：是否使用了要求的关键字和结构

请返回JSON格式的批改结果：
{
  "total_score": 总分（根据任务总分和得分比例计算）,
  "syntax_score": 语法分数（满分40）,
  "output_score": 输出分数（满分40）,
  "logic_score": 逻辑分数（满分20）,
  "comment": "详细的中文评语，包括优点、问题和改进建议",
  "output_diff": "输出差异说明（如有）",
  "missing_keywords": ["缺少的关键字列表"]
}`;

    const userPrompt = `请批改以下Python编程作业：

任务标题：${task.title || 'Python编程'}
任务描述：${task.description || '无'}
总分：${task.total_score || 100}分
预期输出：${task.expected_output || '无明确输出要求'}
要求关键字：${task.required_keywords ? task.required_keywords.join(', ') : '无'}

学生代码：
\`\`\`python
${code}
\`\`\`

语法检测结果：${syntaxResult.score >= 1 ? '✅ 无语法错误' : `❌ 存在语法错误: ${syntaxResult.errors.map(e => e.message).join('; ')}`}

请进行详细批改，确保评语：
1. 指出代码的优点
2. 指出存在的问题和错误
3. 提供具体的改进建议
4. 鼓励学生继续学习`;

    try {
      const aiResponse = await this.callDeepSeekAPI(aiConfig, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      // 解析AI返回结果
      let gradeResult;
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          gradeResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('无法解析AI返回结果');
        }
      } catch (e) {
        console.error('解析AI批改结果失败:', e);
        return null;
      }

      // 验证和规范化分数
      const totalScore = Math.max(0, Math.min(task.total_score || 100, gradeResult.total_score || 0));
      const syntaxScore = Math.max(0, Math.min(40, gradeResult.syntax_score || 0));
      const outputScore = Math.max(0, Math.min(40, gradeResult.output_score || 0));
      const logicScore = Math.max(0, Math.min(20, gradeResult.logic_score || 0));

      return {
        total_score: totalScore,
        syntax_score: syntaxScore,
        output_score: outputScore,
        logic_score: logicScore,
        comment: gradeResult.comment || 'AI批改完成',
        output_diff: gradeResult.output_diff || '',
        missing_keywords: gradeResult.missing_keywords || []
      };
    } catch (error) {
      console.error('AI批改失败:', error);
      throw error;
    }
  }

  // 使用规则引擎进行批改（备用方案）
  async gradeWithRules(submission, task, syntaxResult, syntaxErrors, syntaxScore) {
    const { student_id, task_id, code } = submission;
    const submission_id = submission.id;
    
    let outputScore = 0;
    let logicScore = 0;
    const missingKeywords = [];
    let outputDiff = '';

    // 输出比对
    if (task.expected_output && syntaxResult.canRun) {
      const outputResult = await this.compareOutput(code, task.expected_output);
      outputScore = outputResult.score;
      outputDiff = outputResult.diff;
    } else if (!task.expected_output && syntaxResult.canRun) {
      // 没有设置预期输出时，代码通过语法检查就给满分
      outputScore = 1;
    } else {
      outputScore = syntaxResult.canRun ? 0.5 : 0;
    }

    // 逻辑检查
    const logicResult = this.checkLogic(code, task.required_keywords || []);
    logicScore = logicResult.score;
    missingKeywords.push(...logicResult.missing);

    // 计算总分
    const totalScore = Math.round(
      syntaxScore * this.syntaxWeight * task.total_score +
      outputScore * this.outputWeight * task.total_score +
      logicScore * this.logicWeight * task.total_score
    );

    // 生成评语
    const comment = this.generateComment(syntaxResult, outputScore, logicResult, task.total_score);

    return {
      id: generateId(),
      submission_id,
      task_id,
      student_id,
      total_score: totalScore,
      syntax_score: Math.round(syntaxScore * task.total_score * this.syntaxWeight),
      output_score: Math.round(outputScore * task.total_score * this.outputWeight),
      logic_score: Math.round(logicScore * task.total_score * this.logicWeight),
      comment,
      syntax_errors: JSON.stringify(syntaxErrors),
      output_diff: outputDiff,
      missing_keywords: JSON.stringify(missingKeywords),
      is_ai_graded: true,
      manually_adjusted: false,
      show_reference_code: totalScore >= task.total_score * 0.6,
      graded_at: mysqlNow(),
      updated_at: mysqlNow()
    };
  }

  // 语法检测（纯编译检查，不执行代码）
  async checkSyntax(code) {
    // 先做安全检查
    const safetyCheck = PythonSandbox.checkCodeSafety(code);
    
    if (!safetyCheck.isSafe) {
      return {
        score: 0,
        canRun: false,
        errors: safetyCheck.errors.map(e => ({
          type: e.type,
          message: e.message,
          line: e.line
        }))
      };
    }

    // 使用ast.parse做纯语法检查，不实际运行代码
    const syntaxResult = await PythonSandbox.checkSyntaxOnly(code);
    
    if (syntaxResult.valid) {
      return {
        score: 1,
        canRun: true,
        errors: []
      };
    } else {
      return {
        score: 0.3,
        canRun: false,
        errors: syntaxResult.errors
      };
    }
  }

  // 输出比对
  async compareOutput(code, expectedOutput) {
    try {
      const result = await this.sandbox.executeCode(code, '');
      
      if (!result.success) {
        return { score: 0, diff: '代码运行失败，无法比对输出' };
      }

      const cleanExpected = this.normalizeOutput(expectedOutput);
      const cleanActual = this.normalizeOutput(result.printOutput !== undefined ? result.printOutput : result.output);

      if (cleanExpected === cleanActual) {
        return { score: 1, diff: '' };
      }

      const similarity = this.calculateSimilarity(cleanExpected, cleanActual);
      
      return {
        score: similarity,
        diff: `期望: "${cleanExpected}"\n实际: "${cleanActual}"`
      };
    } catch (error) {
      return {
        score: 0,
        diff: '输出比对失败: ' + error.message
      };
    }
  }

  // 逻辑检查
  checkLogic(code, requiredKeywords = []) {
    const missing = [];
    let score = 1;

    if (requiredKeywords.length > 0) {
      for (const keyword of requiredKeywords) {
        if (!code.includes(keyword)) {
          missing.push(keyword);
        }
      }

      if (missing.length > 0) {
        score = 1 - (missing.length / requiredKeywords.length) * 0.5;
      }
    }

    const hasStructure = this.hasBasicStructure(code);
    if (!hasStructure && code.trim().length > 0) {
      score = Math.max(0, score - 0.2);
    }

    return { score, missing };
  }

  hasBasicStructure(code) {
    const trimmed = code.trim();
    if (!trimmed) return false;

    const hasAssignment = /\w+\s*=/.test(trimmed);
    const hasPrint = /print\s*\(/.test(trimmed);
    const hasIf = /if\s+/.test(trimmed);
    const hasLoop = /(for|while)\s+/.test(trimmed);

    return hasAssignment || hasPrint || hasIf || hasLoop;
  }

  normalizeOutput(output) {
    if (!output) return '';
    return output
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  calculateSimilarity(str1, str2) {
    if (!str1 && !str2) return 1;
    if (!str1 || !str2) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;

    const editDistance = this.levenshtein(longer, shorter);
    return 1 - (editDistance / longer.length);
  }

  levenshtein(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }

    return dp[m][n];
  }

  // 生成评语（规则引擎版本）
  generateComment(syntaxResult, outputScore, logicResult, totalScore) {
    const comments = [];

    if (syntaxResult.score >= 1) {
      comments.push('✅ 语法正确，代码结构完整');
    } else if (syntaxResult.score >= 0.7) {
      comments.push('⚠️ 语法基本正确，但有一些小问题');
    } else {
      comments.push('❌ 存在语法错误，请仔细检查');
    }

    if (outputScore >= 1) {
      comments.push('✅ 运行结果完全正确！');
    } else if (outputScore >= 0.7) {
      comments.push('⚠️ 运行结果基本正确，但有一些差异');
    } else if (outputScore > 0) {
      comments.push('❌ 运行结果与预期不符');
    }

    if (logicResult.missing.length > 0) {
      comments.push(`⚠️ 缺少要求的关键字: ${logicResult.missing.join(', ')}`);
    }

    if (syntaxResult.score >= 1 && outputScore >= 1 && logicResult.score >= 1) {
      comments.push('🎉 太棒了！代码写得非常好！');
    } else if (syntaxResult.score >= 0.8 && outputScore >= 0.8) {
      comments.push('👍 做得不错，继续加油！');
    } else {
      comments.push('💪 再仔细检查一下，你可以做得更好！');
    }

    return comments.join('\n');
  }
}

module.exports = PythonGrader;
