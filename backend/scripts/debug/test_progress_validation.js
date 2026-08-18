// 轻量校验脚本：验证 validateCompletionClaimed 的服务端防刷逻辑
// 运行：node backend/scripts/debug/test_progress_validation.js

const REALM_VALID_CHAPTER_IDS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);

function validateCompletionClaimed(payload) {
  if (payload.current_step !== 'completed') return null;
  const chapters = Array.isArray(payload.completed_chapters) ? payload.completed_chapters : [];
  if (chapters.length !== REALM_VALID_CHAPTER_IDS.length) {
    return '通关校验失败：完成章节数不足 7 章，无法领取通关奖励';
  }
  const submitted = new Set(chapters);
  for (const id of REALM_VALID_CHAPTER_IDS) {
    if (!submitted.has(id)) {
      return '通关校验失败：章节数据非法，请完成所有 7 大秘境后再提交通关';
    }
  }
  if (submitted.size !== REALM_VALID_CHAPTER_IDS.length) {
    return '通关校验失败：章节数据存在重复，无法领取通关奖励';
  }
  return null;
}

const cases = [
  // 正常通关：应通过
  { name: '正常 1..7 通关', payload: { current_step: 'completed', completed_chapters: [1, 2, 3, 4, 5, 6, 7] }, expect: null },
  // 攻击：伪造 7 个无关字符串 ID（原实现会错误放行）
  { name: '攻击：7 个伪造字符串 ID', payload: { current_step: 'completed', completed_chapters: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, expect: 'fail' },
  // 攻击：整数 ID 但缺失第 7 章
  { name: '攻击：缺第 7 章', payload: { current_step: 'completed', completed_chapters: [1, 2, 3, 4, 5, 6] }, expect: 'fail' },
  // 攻击：混入负数和大整数
  { name: '攻击：非法整数 ID', payload: { current_step: 'completed', completed_chapters: [-1, 0, 99, 100, 101, 102, 103] }, expect: 'fail' },
  // 攻击：重复章节
  { name: '攻击：重复章节', payload: { current_step: 'completed', completed_chapters: [1, 1, 1, 2, 2, 3, 3] }, expect: 'fail' },
  // 非通关步骤：不过滤
  { name: '非 completed 步骤放行', payload: { current_step: 'map', completed_chapters: [] }, expect: null },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const err = validateCompletionClaimed(c.payload);
  const ok = c.expect === 'fail' ? err !== null : err === null;
  if (ok) {
    pass++;
    console.log(`[PASS] ${c.name}`);
  } else {
    fail++;
    console.log(`[FAIL] ${c.name} -> got error=${JSON.stringify(err)}`);
  }
}
console.log(`\nSummary: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
