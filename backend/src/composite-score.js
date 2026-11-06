'use strict';

/**
 * 综合题 / 填空题判分（纯函数，无 IO）
 * ============================================================
 * 2026-11-06 从 index.js 抽出来：任务指标、资格校验、练习判分要共用同一套口径。
 * ⛔ 判分逻辑的唯一实现就在这里，index.js 通过 require 使用，禁止在别处再写一份
 *    （历史教训：submit-test 与 submit-exam 各写一份判分，改一处漏一处 → 高二5 全班交卷失败）。
 * 上层入口 judgeCompositeAnswer / judgeQuestionAnswer 仍在 index.js。
 */

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

function taskNormalizeCorrectAnswers(ansField, questionType, options) {
  let arr = taskGetAnswersArray(ansField);
  arr = arr
    .flatMap(a => (typeof a === 'string' && a.includes(',') ? a.split(',').map(s => s.trim()).filter(Boolean) : [a]))
    .filter(a => a !== null && a !== undefined && String(a).trim() !== '');

  if (questionType === 'choice' || questionType === 'multiple_choice') {
    const opts = taskGetOptionsArray(options);
    const mapped = arr.map(a => {
      const norm = taskNormalizeAnswer(a);
      if (/^[a-z]$/.test(norm)) return norm.toUpperCase();
      const idx = opts.findIndex(o => taskNormalizeAnswer(o) === norm);
      return idx >= 0 ? String.fromCharCode(65 + idx) : String(a).trim();
    });
    return Array.from(new Set(mapped)).sort();
  }

  return arr.map(a => String(a).trim());
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

function judgeNormalizeBlankAnswers(value) {
  if (!Array.isArray(value)) return [[]];
  if (value.length === 0) return [[]];
  if (value.some(item => Array.isArray(item))) {
    return value.map(item => (Array.isArray(item) ? item : (item ? [item] : [])));
  }
  return value.map(item => (item ? [item] : []));
}

function judgeFillBlankAnswer(userAnswers, correctAnswers) {
  let userList = Array.isArray(userAnswers)
    ? userAnswers
    : (userAnswers === undefined || userAnswers === null || userAnswers === '' ? [] : [userAnswers]);
  // 去掉尾部的空元素再比长度：有些调用方会把数组补到固定长度（如 ['AI','流程图','','']），
  // 严格按长度比对会把「两空都填对」判成错（2026-10-26 综合题填空小题不得分就是这个原因）。
  // 只裁尾部空串不会放过漏填：少填一空时长度仍不足，照样判错。
  while (userList.length > 0 && String(userList[userList.length - 1] ?? '').trim() === '') {
    userList = userList.slice(0, -1);
  }
  const normalized = judgeNormalizeBlankAnswers(correctAnswers);
  if (userList.length !== normalized.length) return false;
  return userList.every((userAns, idx) =>
    (normalized[idx] || []).some(ca => taskNormalizeAnswer(ca) === taskNormalizeAnswer(userAns))
  );
}

function judgeCompositeSubResults(correctField, userAnswerRaw) {
  const subQuestions = taskGetAnswersArray(correctField);
  if (!Array.isArray(subQuestions)) return [];
  let parsedUser = {};
  try {
    parsedUser = typeof userAnswerRaw === 'string' ? JSON.parse(userAnswerRaw) : (userAnswerRaw || {});
  } catch {
    parsedUser = {};
  }
  if (!parsedUser || typeof parsedUser !== 'object') parsedUser = {};
  return subQuestions.map((sq, idx) => {
    if (!sq || typeof sq !== 'object') return false;
    if (sq.type === 'fill_blank') {
      return judgeFillBlankAnswer(parsedUser.blank_answers?.[idx], sq.answers);
    }
    if (sq.type === 'choice' || sq.type === 'multiple_choice') {
      const multiple = sq.multiple === true || sq.type === 'multiple_choice';
      return taskCheckAnswerCorrect(
        parsedUser.choice_answers?.[idx],
        multiple ? 'multiple_choice' : 'choice',
        sq.answers,
        sq.options
      );
    }
    return false;
  });
}

function getCompositeCredit(correctField, userAnswerRaw) {
  const subs = taskGetAnswersArray(correctField);
  const weight = Array.isArray(subs) && subs.length ? subs.length : 1;
  const subResults = judgeCompositeSubResults(correctField, userAnswerRaw);
  const credit = subResults.filter(Boolean).length;
  return { credit, weight, subResults };
}

module.exports = {
  taskNormalizeAnswer,
  taskGetAnswersArray,
  taskGetOptionsArray,
  taskNormalizeCorrectAnswers,
  taskCheckAnswerCorrect,
  judgeNormalizeBlankAnswers,
  judgeFillBlankAnswer,
  judgeCompositeSubResults,
  getCompositeCredit,
};
