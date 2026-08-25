# AI 创意工坊代码搜索与预览文字定位设计

> 版本：v1 · 日期：2026-08-25 · 状态：已批准，方案 A

## 背景

AI 创意工坊编辑区左右两栏：左 iframe 实时预览，右原生 `<textarea>` 代码编辑器。学生反映：
1. 长代码中找不到特定字符段，缺少搜索跳转功能
2. 在预览里看到一段文字/元素，想快速找到对应代码，肉眼扫描困难

## 方案选择

选 **方案 A（原生 textarea 增强）**，不改编辑器、不引重型依赖。

- 搜索：代码编辑栏 title 右侧加 🔍 按钮，Ctrl/Cmd+F 弹出搜索条（输入框 + 上一个/下一个/关闭 + 匹配数），找到后 `setSelectionRange` + 滚动
- 预览定位：iframe 加载完后给 `contentDocument` 挂 `mouseup` 监听，取选中纯文本，在 code 中 `indexOf` 匹配后滚动定位；匹配不到静默放弃

## 数据/组件改动范围

**仅前端**：`frontend/src/components/student/CreativeWorkshop.tsx`
- 新增搜索条 UI（搜索栏、输入、上/下/关闭）
- 搜索匹配计数与循环跳转
- textarea 滚动定位工具函数 `scrollTextareaToRange`
- iframe selection 监听与 post-加载绑定
- Ctrl/Cmd+F 键盘快捷键（仅在 textarea/编辑栏聚焦时生效，避免与浏览器全局冲突）

## 详细设计

### 1. 代码搜索条 UI

```
┌─ 代码编辑 [🔍] ───────────────────────┐
│ 🔍 [搜索...]   3/12  [↑] [↓] [×]       │ ← 搜索条（打开后）
├────────────────────────────────────────┤
│ <textarea> ...                         │
└────────────────────────────────────────┘
```

状态：
- `searchOpen: boolean`（默认 false，点 🔍 或 Ctrl/Cmd+F 打开）
- `searchQuery: string`
- `searchMatches: number[]`（匹配的 start 索引数组，query 变化时重新算）
- `searchIndex: number`（当前第几个，-1 表示无匹配）

行为：
- query 为空：不匹配，显示 `0/0`
- query 非空：`let i = code.indexOf(query, 0)` 遍历全部，得到 `number[]`
- 下一个：`(searchIndex + 1) % matches.length`；上一个：`(searchIndex - 1 + matches.length) % matches.length`
- setSelectionRange(matches[i], matches[i]+query.length)，再滚动
- Esc / 点 ×：searchOpen=false，清空匹配但不清空 query（下次打开还在）
- 失焦或切换作品时：关闭搜索条
- 搜索大小写**不敏感**（`code.toLowerCase()` 和 `query.toLowerCase()` 匹配）

### 2. textarea 滚动定位工具函数 scrollTextareaToRange

原生 textarea 没有"滚到第 N 个字符"API。做法：
1. 通过换行符把 code 拆成 lines，计算目标 start 所在 `lineIndex`（0-based）
2. 取 `lineHeight = parseInt(getComputedStyle(textarea).lineHeight)`，取不到就估算 `textarea.clientHeight / 行数（用 \n 数 + 1 估）`
3. `desiredScrollTop = Math.max(0, lineIndex * lineHeight - textarea.clientHeight / 3)`
   - 减 clientHeight/3 是把目标行定位到视图靠上 1/3，上下文更充分
4. `textarea.scrollTop = desiredScrollTop`
5. 兜底：setSelectionRange 后大多数浏览器会滚到可见区，但这个微调能让位置更可预测

### 3. 预览选中 → 代码定位

时机：iframe load 事件触发后绑定一次。因为 iframe 用 `srcDoc={code}`，每次 code 变化都会重新渲染 → 所以需要监听 iframe 的 onLoad，并在 onLoad 里重新绑定：
- 但用户实际选择文字时 code 不一定会变动（编辑时不实时刷新？需要看现状——当前 code 和 iframe srcDoc 是同步绑定的，每次打字都会触发 iframe reload，导致 selection 丢失。）
- **策略调整**：code 变化不会自动触发文字选择，因此只需要在 code 没有变化的窗口里做匹配。简化做法：每次 iframe onLoad 后把 selection 监听器重新挂到新的 contentDocument。

mouseup 触发时：
1. `iframe.contentWindow.getSelection().toString().trim()`
2. 长度 < 2：跳过（太短误触高）
3. 精确匹配：`code.indexOf(selected)` → 找到就跳
4. 找不到：去掉所有空白后比 `code.replace(/\s+/g,'').indexOf(selected.replace(/\s+/g,''))`，再反向映射回原字符串中的位置（遍历恢复空白）——复杂度高，第一版不做
5. 第一版只做**精确匹配**，找不到静默放弃

定位到后：
- `setSelectionRange(start, start + selected.length)` + scrollTextareaToRange
- 可选：临时加一个"flash"提示（在搜索条位置显示一个 toast：「已定位到代码」，1.2s 后消失）

### 4. Ctrl/Cmd+F 快捷键

仅当 focus 在 CreativeWorkshop 内部或 textarea 里时拦截，避免影响浏览器全局 Ctrl+F：
- 实际上直接 document 级 keydown 监听，判断 `(e.ctrlKey || e.metaKey) && e.key === 'f'`，如果当前 creativeWorkshop 组件已挂载，`e.preventDefault()` 打开搜索条并 focus 搜索框
- 组件卸载时 removeEventListener

## 不做的事（Out of Scope）

- 引入 Monaco/CodeMirror 等重型编辑器
- 搜索替换（只有搜索，无替换）
- 搜索高亮 overlay（只靠原生 selection 选中态）
- HTML 标签打断时的模糊反向映射（第一版只做精确匹配，找不到静默）

## 错误处理

- 搜索 query 过长（>100 字符）：直接不匹配，避免 indexOf 性能
- iframe selection 跨元素拿不到纯字符串：静默跳过
- iframe onLoad 没触发时（srcDoc 空）：不绑定监听

## 测试要点

- 在大型 HTML（500+ 行）中搜 `</div>`：正确循环跳转、匹配数准确、每跳都滚动到视图
- Ctrl+F 打开搜索条、Esc 关闭、关闭后再打开仍有上次的 query
- 预览中有"欢迎使用"几个字，选中后能跳到对应包含那几个字的代码行（如果代码里是 `<span>欢迎使用</span>`，字不连续则定位失败→静默，符合预期）
- 编辑代码后搜索，匹配是最新内容
- 切换到其他作品：搜索条自动关闭
