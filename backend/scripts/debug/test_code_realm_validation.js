// 最小化自检：模拟新加的 validateCompletionClaimed 逻辑
// 运行: node backend/scripts/debug/test_code_realm_validation.js

function validateCompletionClaimed(payload) {
  if (payload.current_step !== 'completed') return null;
  const chapters = Array.isArray(payload.completed_chapters) ? payload.completed_chapters : [];
  const unique = new Set(chapters);
  if (unique.size >= 7) return null;
  return '通关校验失败：完成章节数不足 7 章，无法领取通关奖励';
}

const cases = [
  {
    name: '① 未通关（正常存档推进）→ 不应报错',
    payload: { current_step: 'boss', completed_chapters: [1, 2, 3] },
    expect: null,
  },
  {
    name: '② 仅声称 completed 但章节为空 → 应被拒绝',
    payload: { current_step: 'completed', completed_chapters: [] },
    expect: '通关校验失败：完成章节数不足 7 章，无法领取通关奖励',
  },
  {
    name: '③ 声称 completed 但只有 3 章 → 应被拒绝',
    payload: { current_step: 'completed', completed_chapters: [1, 2, 3] },
    expect: '通关校验失败：完成章节数不足 7 章，无法领取通关奖励',
  },
  {
    name: '④ 正常通关：完成 7 章 → 放行',
    payload: { current_step: 'completed', completed_chapters: [1, 2, 3, 4, 5, 6, 7] },
    expect: null,
  },
  {
    name: '⑤ 含重复章节但恰好 7 个唯一 → 放行',
    payload: { current_step: 'completed', completed_chapters: [1, 1, 2, 3, 4, 5, 6, 7] },
    expect: null,
  },
  {
    name: '⑥ completed_chapters 不是数组 → 应被拒绝',
    payload: { current_step: 'completed', completed_chapters: null },
    expect: '通关校验失败：完成章节数不足 7 章，无法领取通关奖励',
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const actual = validateCompletionClaimed(c.payload);
  const ok = actual === c.expect;
  if (ok) {
    pass++;
    console.log(`[PASS] ${c.name}`);
  } else {
    fail++;
    console.log(`[FAIL] ${c.name}\n   期望: ${JSON.stringify(c.expect)}\n   实际: ${JSON.stringify(actual)}`);
  }
}
console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
