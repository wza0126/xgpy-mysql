// 代码农场 · Python 子集解释器（零依赖，纯前端）
// ============================================================
// 为什么自己写而不用服务端沙箱：
//   生产是 pkg 打的单文件 exe，服务器上不一定装了 Python；而「代码农场」要求即时反馈
//   （写完就能看到作物变化）。所以这里内置一个**受限 Python 子集**解释器，
//   覆盖高中必修1 的核心语法（顺序 / 选择 / 循环 / 函数 / 变量），学生写的就是真 Python 语法。
//
// ⛔ 判分边界：解释器只把学生代码翻译成「操作序列 ops」，真正的生长 / 收获 / 积分
//    由后端 farm.js 结算（前端提交的 ops 在后端还会被夹取与限次）。
//
// 支持的语法：
//   · 注释 #，空行
//   · 变量赋值 = += -= *= /=，数字 / 字符串 / True / False / None
//   · 算术 + - * / // % **，比较 == != < > <= >=，逻辑 and or not，括号
//   · if / elif / else、for x in range(...)、while、break / continue / pass
//   · def 定义函数、return
//   · 内置 print 与农场 API（见 FARM_API）
//
// 不支持的（会给出明确提示）：列表/字典字面量、import、类、切片、多返回值等。

export interface FarmOps {
  op: string;
  n?: number;
  crop?: string;
}

export interface FarmMirror {
  crop: string | null;
  growth: number;
  moisture: number;
  nutrient: number;
  stage: number;
  // ⛔ 语义 = 「今天还剩几次劳作」：播种/除草/收获 各扣 1，water(n)/fertilize(n) 各扣 n
  opsLeft: number;
  day: number;
  weather: string; // sunny / rainy / drought（影响成长与吸收）
}

export interface FarmRunResult {
  ops: FarmOps[];
  prints: string[];
  error: string | null;
  errorLine: number | null;
  mirror: FarmMirror;
}

// 与后端 farm.js 保持一致的操作常量（前端只在「本地镜像」里估算，最终以后端为准）
const LABOR_GROWTH = 16; // ⛔ 每吸收一份水/肥的生长量（满水满肥时）
const WATER_PER_UNIT = 12;
const FERT_PER_UNIT = 12;
const MAX_PARAM = 10; // 单次 water/fertilize 最多带几份（同时也是它要花的劳作次数）
const WEED_GROWTH = 24; // 除草加成（满水满肥时，实际要乘水肥系数）= LABOR_GROWTH × 1.5
const MAX_OPS_DEFAULT = 80;
const MAX_STEPS = 40000;

// 天气对生长的倍率（与后端 WEATHER 一致）
const WEATHER_GROWTH: Record<string, number> = { sunny: 1.0, rainy: 1.2, drought: 0.6 };

// 生长值 -> 阶段（与后端 stageOf 一致）：0 空地 / 1 幼苗 / 2 成长 / 3 成熟
function stageOf(growth: number, crop: string | null): number {
  if (!crop) return 0;
  if (growth >= 100) return 3;
  if (growth >= 50) return 2;
  return 1;
}

// 作物别名：中英文都认，方便学生写 plant("小麦") 或 plant("wheat")
const CROP_ALIAS: Record<string, string> = {
  wheat: 'wheat', 小麦: 'wheat',
  carrot: 'carrot', 胡萝卜: 'carrot',
  corn: 'corn', 玉米: 'corn',
};

// 「内置示例」：教师没在后台配置默认代码时的兜底，也是教师端「载入内置示例」的填充内容。
// ⛔ 改动这里要连带核对：后端 farm.js 的耕作口径、学生手册、以及
//    backend/scripts/debug/verify_farm_ui.cjs 里「默认代码恰好消耗 8 次劳作」的断言
//    （播种 1 + 浇到满 5 + 施肥 2 = 8）。
export const FARM_EXAMPLE_CODE = `# 用 Python 照顾你的地
# 先播下种子（可选 wheat 小麦 / carrot 胡萝卜 / corn 玉米）
if crop() == None:
    plant("wheat")

# 水分不够就浇水（水分满了再浇是浪费）
while moisture() < 100:
    water()

# 养分不够就施肥
if nutrient() < 80:
    fertilize(2)

print("水分", moisture(), "养分", nutrient())
`;

export const FARM_API_DOC = [
  { call: 'plant("wheat")', desc: '播种（花 1 次劳作）：wheat 小麦 / carrot 胡萝卜 / corn 玉米' },
  { call: 'water(n)', desc: '浇水 n 份（花 n 次劳作）：每份 +12 水分，上限 100。水满了还浇就是白花力气；水分越高，后面每次除草也越值钱' },
  { call: 'fertilize(n)', desc: '施肥 n 份（花 n 次劳作）：每份 +12 养分，上限 100。同上，别施多；养分越高，后面每次除草也越值钱' },
  { call: 'weed()', desc: '除草松土（花 1 次劳作）：成长 +24×水肥系数。水肥 100/100 时 +24（= 1.5 次浇水），水肥越低越不划算' },
  { call: 'harvest()', desc: '收获（花 1 次劳作）：只有成熟才能收，收获得积分' },
  { call: 'moisture()', desc: '读当前水分（0-100）' },
  { call: 'nutrient()', desc: '读当前养分（0-100）' },
  { call: 'growth()', desc: '读当前生长值（0-100）' },
  { call: 'stage()', desc: '读阶段：0 空地 / 1 幼苗 / 2 成长 / 3 成熟' },
  { call: 'crop()', desc: '读当前作物名（空地返回 None）' },
  { call: 'ops_left()', desc: '读今天还剩几次劳作（每次农活都会扣，写 while 循环时很有用）' },
  { call: 'print(x)', desc: '输出，方便调试' },
];

// ============ 词法 ============

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'kw'; v: string };

const KEYWORDS = new Set([
  'if', 'elif', 'else', 'for', 'while', 'in', 'and', 'or', 'not',
  'True', 'False', 'None', 'def', 'return', 'break', 'continue', 'pass',
]);

const OPS = [
  '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=',
  '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', ',', ':', '.',
];

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}
function isNameStart(c: string): boolean {
  return /[A-Za-z_\u4e00-\u9fa5]/.test(c);
}
function isNamePart(c: string): boolean {
  return /[A-Za-z0-9_\u4e00-\u9fa5]/.test(c);
}

export class FarmSyntaxError extends Error {
  line: number;
  constructor(msg: string, line: number) {
    super(msg);
    this.name = 'FarmSyntaxError';
    this.line = line;
  }
}

function tokenize(src: string, lineNo: number): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '#') break; // 注释到行尾
    // 字符串
    if (c === '"' || c === "'") {
      const q = c;
      let s = '';
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < n) {
          const nx = src[i + 1];
          s += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
          i += 2;
          continue;
        }
        s += src[i];
        i++;
      }
      if (i >= n) throw new FarmSyntaxError('字符串没有用引号收尾', lineNo);
      i++; // 跳过收尾引号
      out.push({ t: 'str', v: s });
      continue;
    }
    // 数字
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      let j = i;
      while (j < n && (isDigit(src[j]) || src[j] === '.')) j++;
      const raw = src.slice(i, j);
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new FarmSyntaxError('看不懂这个数字：' + raw, lineNo);
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    // 标识符 / 关键字
    if (isNameStart(c)) {
      let j = i;
      while (j < n && isNamePart(src[j])) j++;
      const w = src.slice(i, j);
      out.push(KEYWORDS.has(w) ? { t: 'kw', v: w } : { t: 'name', v: w });
      i = j;
      continue;
    }
    // 运算符
    let matched = '';
    for (const op of OPS) {
      if (src.startsWith(op, i)) { matched = op; break; }
    }
    if (!matched) throw new FarmSyntaxError('不认识的符号：' + c, lineNo);
    out.push({ t: 'op', v: matched });
    i += matched.length;
  }
  return out;
}

interface LLine {
  indent: number;
  tokens: Tok[];
  lineNo: number;
}

function toLogicalLines(code: string): LLine[] {
  const raw = code.replace(/\r\n?/g, '\n').split('\n');
  const out: LLine[] = [];
  for (let k = 0; k < raw.length; k++) {
    const line = raw[k];
    const lead = (line.match(/^[ \t]*/) || [''])[0];
    let indent = 0;
    for (const ch of lead) indent += ch === '\t' ? 4 : 1;
    const toks = tokenize(line.slice(lead.length), k + 1);
    if (!toks.length) continue;
    out.push({ indent, tokens: toks, lineNo: k + 1 });
  }
  return out;
}

// ============ 语法树 ============

type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'none' }
  | { k: 'var'; name: string; line: number }
  | { k: 'bin'; op: string; a: Expr; b: Expr; line: number }
  | { k: 'un'; op: string; a: Expr; line: number }
  | { k: 'call'; name: string; args: Expr[]; line: number };

type Stmt =
  | { k: 'assign'; name: string; op: string; expr: Expr; line: number }
  | { k: 'expr'; expr: Expr; line: number }
  | { k: 'if'; branches: { cond: Expr | null; body: Stmt[] }[]; line: number }
  | { k: 'for'; varName: string; iter: Expr; body: Stmt[]; line: number }
  | { k: 'while'; cond: Expr; body: Stmt[]; line: number }
  | { k: 'def'; name: string; params: string[]; body: Stmt[]; line: number }
  | { k: 'return'; expr: Expr | null; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'pass'; line: number };

// ============ 表达式解析 ============

class ExprParser {
  toks: Tok[];
  pos = 0;
  line: number;

  constructor(toks: Tok[], line: number) {
    this.toks = toks;
    this.line = line;
  }

  peek(): Tok | null {
    return this.pos < this.toks.length ? this.toks[this.pos] : null;
  }
  next(): Tok | null {
    return this.pos < this.toks.length ? this.toks[this.pos++] : null;
  }
  expectOp(v: string): void {
    const t = this.next();
    if (!t || t.t !== 'op' || t.v !== v) {
      throw new FarmSyntaxError('这里应该有一个「' + v + '」', this.line);
    }
  }
  isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'op' && t.v === v;
  }
  isKw(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'kw' && t.v === v;
  }

  parseFull(): Expr {
    const e = this.parseOr();
    if (this.pos < this.toks.length) {
      const t = this.toks[this.pos];
      throw new FarmSyntaxError('表达式后面多了看不懂的内容', this.line);
    }
    return e;
  }

  parseOr(): Expr {
    let a = this.parseAnd();
    while (this.isKw('or')) {
      this.next();
      const b = this.parseAnd();
      a = { k: 'bin', op: 'or', a, b, line: this.line };
    }
    return a;
  }

  parseAnd(): Expr {
    let a = this.parseNot();
    while (this.isKw('and')) {
      this.next();
      const b = this.parseNot();
      a = { k: 'bin', op: 'and', a, b, line: this.line };
    }
    return a;
  }

  parseNot(): Expr {
    if (this.isKw('not')) {
      this.next();
      const a = this.parseNot();
      return { k: 'un', op: 'not', a, line: this.line };
    }
    return this.parseCmp();
  }

  parseCmp(): Expr {
    let a = this.parseAdd();
    const t = this.peek();
    if (t && t.t === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(t.v)) {
      this.next();
      const b = this.parseAdd();
      a = { k: 'bin', op: t.v, a, b, line: this.line };
    }
    return a;
  }

  parseAdd(): Expr {
    let a = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) {
        this.next();
        const b = this.parseMul();
        a = { k: 'bin', op: t.v, a, b, line: this.line };
        continue;
      }
      break;
    }
    return a;
  }

  parseMul(): Expr {
    let a = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && ['*', '/', '//', '%'].includes(t.v)) {
        this.next();
        const b = this.parseUnary();
        a = { k: 'bin', op: t.v, a, b, line: this.line };
        continue;
      }
      break;
    }
    return a;
  }

  parseUnary(): Expr {
    const t = this.peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.next();
      const a = this.parseUnary();
      return { k: 'un', op: t.v, a, line: this.line };
    }
    return this.parsePow();
  }

  parsePow(): Expr {
    const a = this.parseAtom();
    if (this.isOp('**')) {
      this.next();
      const b = this.parseUnary();
      return { k: 'bin', op: '**', a, b, line: this.line };
    }
    return a;
  }

  parseAtom(): Expr {
    const t = this.next();
    if (!t) throw new FarmSyntaxError('表达式不完整', this.line);
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'kw') {
      if (t.v === 'True') return { k: 'bool', v: true };
      if (t.v === 'False') return { k: 'bool', v: false };
      if (t.v === 'None') return { k: 'none' };
      throw new FarmSyntaxError('关键字「' + t.v + '」不能出现在这个位置', this.line);
    }
    if (t.t === 'name') {
      if (this.isOp('(')) {
        this.next();
        const args: Expr[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.parseOr());
            if (this.isOp(',')) { this.next(); continue; }
            break;
          }
        }
        this.expectOp(')');
        return { k: 'call', name: t.v, args, line: this.line };
      }
      return { k: 'var', name: t.v, line: this.line };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = this.parseOr();
      this.expectOp(')');
      return e;
    }
    if (t.t === 'op' && t.v === '[') {
      throw new FarmSyntaxError('农场里还不支持列表，用变量和循环就够了', this.line);
    }
    throw new FarmSyntaxError('这里的写法看不懂', this.line);
  }
}

// ============ 语句解析 ============

class Parser {
  lines: LLine[];
  i = 0;

  constructor(lines: LLine[]) {
    this.lines = lines;
  }

  parseProgram(): Stmt[] {
    if (!this.lines.length) return [];
    const base = Math.min.apply(null, this.lines.map((l) => l.indent));
    return this.parseBlock(base);
  }

  parseBlock(indent: number): Stmt[] {
    const out: Stmt[] = [];
    while (this.i < this.lines.length) {
      const L = this.lines[this.i];
      if (L.indent < indent) break;
      if (L.indent > indent) throw new FarmSyntaxError('缩进对不上，检查一下这一行前面的空格', L.lineNo);
      out.push(this.parseStmt());
    }
    return out;
  }

  parseBody(parentIndent: number): Stmt[] {
    if (this.i >= this.lines.length) {
      throw new FarmSyntaxError('冒号后面需要缩进的代码块', this.lines[this.i - 1].lineNo);
    }
    const L = this.lines[this.i];
    if (L.indent <= parentIndent) {
      throw new FarmSyntaxError('冒号后面需要缩进的代码块', this.lines[this.i - 1].lineNo);
    }
    return this.parseBlock(L.indent);
  }

  // 取出 `if 条件:` / `for x in y:` 里 `:` 之前的 token
  condTokens(L: LLine, head: number): Tok[] {
    const toks = L.tokens.slice(head);
    if (!toks.length || toks[toks.length - 1].t !== 'op' || (toks[toks.length - 1] as any).v !== ':') {
      throw new FarmSyntaxError('这一行结尾需要「:」', L.lineNo);
    }
    const body = toks.slice(0, toks.length - 1);
    if (!body.length) throw new FarmSyntaxError('条件不能为空', L.lineNo);
    return body;
  }

  parseStmt(): Stmt {
    const L = this.lines[this.i];
    const t0 = L.tokens[0];

    if (t0.t === 'kw') {
      if (t0.v === 'if') return this.parseIf();
      if (t0.v === 'for') return this.parseFor();
      if (t0.v === 'while') return this.parseWhile();
      if (t0.v === 'def') return this.parseDef();
      if (t0.v === 'return') {
        this.i++;
        const rest = L.tokens.slice(1);
        const expr = rest.length ? new ExprParser(rest, L.lineNo).parseFull() : null;
        return { k: 'return', expr, line: L.lineNo };
      }
      if (t0.v === 'break') { this.i++; return { k: 'break', line: L.lineNo }; }
      if (t0.v === 'continue') { this.i++; return { k: 'continue', line: L.lineNo }; }
      if (t0.v === 'pass') { this.i++; return { k: 'pass', line: L.lineNo }; }
      if (t0.v === 'elif' || t0.v === 'else') {
        throw new FarmSyntaxError('「' + t0.v + '」没有对应的 if', L.lineNo);
      }
      throw new FarmSyntaxError('这里不能写「' + t0.v + '」', L.lineNo);
    }

    this.i++;

    // 赋值
    const t1 = L.tokens[1];
    if (t0.t === 'name' && t1 && t1.t === 'op' && ['=', '+=', '-=', '*=', '/='].includes(t1.v)) {
      const rest = L.tokens.slice(2);
      if (!rest.length) throw new FarmSyntaxError('赋值号右边是空的', L.lineNo);
      return { k: 'assign', name: t0.v, op: t1.v, expr: new ExprParser(rest, L.lineNo).parseFull(), line: L.lineNo };
    }

    return { k: 'expr', expr: new ExprParser(L.tokens, L.lineNo).parseFull(), line: L.lineNo };
  }

  parseIf(): Stmt {
    const L = this.lines[this.i];
    const line = L.lineNo;
    const branches: { cond: Expr | null; body: Stmt[] }[] = [];

    const cond0 = new ExprParser(this.condTokens(L, 1), line).parseFull();
    this.i++;
    branches.push({ cond: cond0, body: this.parseBody(L.indent) });

    for (;;) {
      if (this.i >= this.lines.length) break;
      const N = this.lines[this.i];
      const f = N.tokens[0];
      if (N.indent !== L.indent || f.t !== 'kw') break;
      if (f.v === 'elif') {
        const c = new ExprParser(this.condTokens(N, 1), N.lineNo).parseFull();
        this.i++;
        branches.push({ cond: c, body: this.parseBody(N.indent) });
        continue;
      }
      if (f.v === 'else') {
        if (N.tokens.length !== 2 || N.tokens[1].t !== 'op' || (N.tokens[1] as any).v !== ':') {
          throw new FarmSyntaxError('else 这一行只能写 else:', N.lineNo);
        }
        this.i++;
        branches.push({ cond: null, body: this.parseBody(N.indent) });
        break;
      }
      break;
    }
    return { k: 'if', branches, line };
  }

  parseFor(): Stmt {
    const L = this.lines[this.i];
    const body = this.condTokens(L, 1); // 形如 [x, in, range(...)]
    if (body.length < 3 || body[0].t !== 'name' || body[1].t !== 'kw' || (body[1] as any).v !== 'in') {
      throw new FarmSyntaxError('for 要写成：for 变量 in range(次数):', L.lineNo);
    }
    const varName = (body[0] as any).v as string;
    const iter = new ExprParser(body.slice(2), L.lineNo).parseFull();
    this.i++;
    return { k: 'for', varName, iter, body: this.parseBody(L.indent), line: L.lineNo };
  }

  parseWhile(): Stmt {
    const L = this.lines[this.i];
    const cond = new ExprParser(this.condTokens(L, 1), L.lineNo).parseFull();
    this.i++;
    return { k: 'while', cond, body: this.parseBody(L.indent), line: L.lineNo };
  }

  parseDef(): Stmt {
    const L = this.lines[this.i];
    const toks = L.tokens;
    if (toks.length < 4 || toks[1].t !== 'name') {
      throw new FarmSyntaxError('def 要写成：def 函数名(参数):', L.lineNo);
    }
    const name = (toks[1] as any).v as string;
    if (toks[2].t !== 'op' || (toks[2] as any).v !== '(') {
      throw new FarmSyntaxError('函数名后面要跟括号', L.lineNo);
    }
    const params: string[] = [];
    let j = 3;
    if (toks[j] && toks[j].t === 'op' && (toks[j] as any).v === ')') {
      j++;
    } else {
      for (;;) {
        if (!toks[j] || toks[j].t !== 'name') throw new FarmSyntaxError('参数名不对', L.lineNo);
        params.push((toks[j] as any).v as string);
        j++;
        if (toks[j] && toks[j].t === 'op' && (toks[j] as any).v === ',') { j++; continue; }
        break;
      }
      if (!toks[j] || toks[j].t !== 'op' || (toks[j] as any).v !== ')') {
        throw new FarmSyntaxError('参数列表缺少收尾的括号', L.lineNo);
      }
      j++;
    }
    if (!toks[j] || toks[j].t !== 'op' || (toks[j] as any).v !== ':') {
      throw new FarmSyntaxError('def 这一行结尾需要「:」', L.lineNo);
    }
    if (params.length > 6) throw new FarmSyntaxError('参数太多了（最多 6 个）', L.lineNo);
    this.i++;
    return { k: 'def', name, params, body: this.parseBody(L.indent), line: L.lineNo };
  }
}

// ============ 求值 ============

interface UserFunc {
  params: string[];
  body: Stmt[];
  env: Map<string, any>;
}

type Ctrl =
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'return'; value: any }
  | null;

const CTRL_BREAK: Ctrl = { kind: 'break' };
const CTRL_CONTINUE: Ctrl = { kind: 'continue' };

export class FarmRuntimeError extends Error {
  line: number;
  constructor(msg: string, line: number) {
    super(msg);
    this.name = 'FarmRuntimeError';
    this.line = line;
  }
}

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error('这个值不能当数字用');
}

function fmtVal(v: any): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v);
}

function truthy(v: any): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (v === 0 || v === 0.0) return false;
  if (v === '') return false;
  return true;
}

class Interp {
  mirror: FarmMirror;
  ops: FarmOps[] = [];
  prints: string[] = [];
  steps = 0;
  maxOps: number;
  curLine = 0;
  laborWarned = false; // 劳作次数不够只提示一次，避免刷屏

  constructor(mirror: FarmMirror, maxOps: number) {
    this.mirror = { ...mirror };
    this.maxOps = maxOps;
  }

  bump(line: number): void {
    this.curLine = line;
    this.steps++;
    if (this.steps > MAX_STEPS) {
      throw new FarmRuntimeError('代码跑得太久了（可能是死循环），已停下', line);
    }
  }

  pushOp(op: FarmOps, line: number): void {
    if (this.ops.length >= this.maxOps) {
      throw new FarmRuntimeError('一次代码里的操作太多了（上限 ' + this.maxOps + ' 条）', line);
    }
    this.ops.push(op);
  }

  // ⛔ 扣劳作：与后端同口径（每个动作单位扣 1 次）。不够就跳过，并只提示一次。
  spend(cost: number): boolean {
    if (cost > this.mirror.opsLeft) {
      if (!this.laborWarned) {
        this.laborWarned = true;
        this.prints.push(
          '[!] 今天的劳作次数不够了（这次还要 ' + cost + ' 次，只剩 ' + this.mirror.opsLeft +
          ' 次），后面的农活没有执行'
        );
      }
      return false;
    }
    this.mirror.opsLeft -= cost;
    return true;
  }

  // ⛔ 吸收：每补进一份水/肥就调用一次（与后端 applyOps 同口径）
  absorb(): number {
    if (!this.mirror.crop) return 0;
    const mf = Math.min(1, this.mirror.moisture / 100);
    const nf = Math.min(1, this.mirror.nutrient / 100);
    const w = WEATHER_GROWTH[this.mirror.weather] ?? 1;
    const before = this.mirror.growth;
    this.mirror.growth = Math.min(100, before + LABOR_GROWTH * mf * nf * w);
    this.mirror.stage = stageOf(this.mirror.growth, this.mirror.crop);
    return this.mirror.growth - before;
  }

  // 补 n 份水或肥，逐份吸收。返回实际补进去的份数（补不进去的份数照样花力气）。
  pour(kind: 'water' | 'fertilize', n: number): number {
    const unit = kind === 'water' ? WATER_PER_UNIT : FERT_PER_UNIT;
    let ups = 0;
    for (let i = 0; i < n; i++) {
      const b = kind === 'water' ? this.mirror.moisture : this.mirror.nutrient;
      const v = Math.min(100, b + unit);
      if (kind === 'water') this.mirror.moisture = v;
      else this.mirror.nutrient = v;
      if (v > b) {
        ups++;
        this.absorb();
      }
    }
    return ups;
  }

  // ---------- 表达式 ----------
  evalExpr(e: Expr, env: Map<string, any>): any {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'bool': return e.v;
      case 'none': return null;
      case 'var': {
        if (env.has(e.name)) return env.get(e.name);
        throw new FarmRuntimeError('变量「' + e.name + '」还没有赋值', e.line);
      }
      case 'un': {
        const a = this.evalExpr(e.a, env);
        if (e.op === 'not') return !truthy(a);
        if (e.op === '-') return -toNum(a);
        return toNum(a);
      }
      case 'bin': {
        if (e.op === 'and') {
          const a = this.evalExpr(e.a, env);
          return truthy(a) ? this.evalExpr(e.b, env) : a;
        }
        if (e.op === 'or') {
          const a = this.evalExpr(e.a, env);
          return truthy(a) ? a : this.evalExpr(e.b, env);
        }
        const a = this.evalExpr(e.a, env);
        const b = this.evalExpr(e.b, env);
        return this.binop(e.op, a, b, e.line);
      }
      case 'call': return this.evalCall(e, env);
      default: throw new FarmRuntimeError('表达式无法求值', this.curLine);
    }
  }

  binop(op: string, a: any, b: any, line: number): any {
    try {
      switch (op) {
        case '+':
          if (typeof a === 'string' || typeof b === 'string') return fmtVal(a) + fmtVal(b);
          return toNum(a) + toNum(b);
        case '-': return toNum(a) - toNum(b);
        case '*': return toNum(a) * toNum(b);
        case '/': {
          const d = toNum(b);
          if (d === 0) throw new Error('不能除以 0');
          return toNum(a) / d;
        }
        case '//': {
          const d = toNum(b);
          if (d === 0) throw new Error('不能除以 0');
          return Math.floor(toNum(a) / d);
        }
        case '%': {
          const d = toNum(b);
          if (d === 0) throw new Error('不能除以 0');
          return toNum(a) % d;
        }
        case '**': return Math.pow(toNum(a), toNum(b));
        case '==': return this.eq(a, b);
        case '!=': return !this.eq(a, b);
        case '<': return toNum(a) < toNum(b);
        case '>': return toNum(a) > toNum(b);
        case '<=': return toNum(a) <= toNum(b);
        case '>=': return toNum(a) >= toNum(b);
        default: throw new Error('不支持的运算：' + op);
      }
    } catch (err) {
      throw new FarmRuntimeError((err as Error).message, line);
    }
  }

  eq(a: any, b: any): boolean {
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    if (typeof a === 'number' || typeof b === 'number' || typeof a === 'boolean' || typeof b === 'boolean') {
      return toNum(a) === toNum(b);
    }
    return a === b;
  }

  // ---------- 内置函数 ----------
  callBuiltin(name: string, args: any[], line: number): { handled: boolean; value?: any } {
    const arg = (i: number, d: any) => (args.length > i ? args[i] : d);
    switch (name) {
      case 'print':
        this.prints.push(args.map(fmtVal).join(' '));
        return { handled: true, value: null };

      case 'range': {
        const a0 = args.length >= 2 ? Math.round(toNum(args[0])) : 0;
        const a1 = args.length >= 2 ? Math.round(toNum(args[1])) : Math.round(toNum(arg(0, 0)));
        const step = args.length >= 3 ? Math.round(toNum(args[2])) : 1;
        if (step === 0) throw new FarmRuntimeError('range 的步长不能是 0', line);
        const out: number[] = [];
        if (step > 0) {
          for (let v = a0; v < a1; v += step) { out.push(v); if (out.length > 100000) break; }
        } else {
          for (let v = a0; v > a1; v += step) { out.push(v); if (out.length > 100000) break; }
        }
        return { handled: true, value: out };
      }

      case 'plant':
      case '播种': {
        const raw = String(arg(0, ''));
        const c = CROP_ALIAS[raw];
        if (!c) {
          this.prints.push('[!] 没有「' + raw + '」这种作物，可选 wheat(小麦) / carrot(胡萝卜) / corn(玉米)');
          return { handled: true, value: null };
        }
        if (this.mirror.crop) {
          this.prints.push('[!] 这块地还种着作物，先收获');
          return { handled: true, value: null };
        }
        if (!this.spend(1)) return { handled: true, value: null };
        this.mirror.crop = c;
        this.mirror.growth = 0;
        this.mirror.stage = 1;
        this.pushOp({ op: 'plant', crop: c }, line);
        return { handled: true, value: null };
      }

      case 'water':
      case '浇水': {
        const n = Math.max(1, Math.min(MAX_PARAM, Math.round(toNum(arg(0, 1)))));
        if (!this.spend(n)) return { handled: true, value: null };
        const ups = this.pour('water', n);
        const warn =
          '[!] 只浇进去 ' + ups + ' 份，另外 ' + (n - ups) + ' 份因为水满了白花力气（每份水都要花 1 次劳作）';
        if (ups < n && !this.prints.includes(warn)) this.prints.push(warn);
        this.pushOp({ op: 'water', n }, line);
        return { handled: true, value: null };
      }

      case 'fertilize':
      case '施肥': {
        const n = Math.max(1, Math.min(MAX_PARAM, Math.round(toNum(arg(0, 1)))));
        if (!this.spend(n)) return { handled: true, value: null };
        const ups = this.pour('fertilize', n);
        const warn =
          '[!] 只施进去 ' + ups + ' 份，另外 ' + (n - ups) + ' 份因为养分满了白花力气（每份肥都要花 1 次劳作）';
        if (ups < n && !this.prints.includes(warn)) this.prints.push(warn);
        this.pushOp({ op: 'fertilize', n }, line);
        return { handled: true, value: null };
      }

      case 'weed':
      case '除草': {
        if (!this.mirror.crop) {
          this.prints.push('[!] 空地没有杂草可除');
          return { handled: true, value: null };
        }
        if (!this.spend(1)) return { handled: true, value: null };
        // ⛔ 除草的收益也看水肥：水肥不足时松土几乎没用（与后端一致）
        const mf = Math.min(1, this.mirror.moisture / 100);
        const nf = Math.min(1, this.mirror.nutrient / 100);
        const w = WEATHER_GROWTH[this.mirror.weather] ?? 1;
        const add = WEED_GROWTH * mf * nf * w;
        this.mirror.growth = Math.min(100, this.mirror.growth + add);
        this.mirror.stage = stageOf(this.mirror.growth, this.mirror.crop);
        const warn = '[!] 水肥不足，除草几乎没用——先把水补到 100、肥补到 100 再来除草';
        if (add < 1 && !this.prints.includes(warn)) this.prints.push(warn);
        this.pushOp({ op: 'weed' }, line);
        return { handled: true, value: null };
      }

      case 'harvest':
      case '收获': {
        if (!this.mirror.crop) {
          this.prints.push('[!] 空地没什么可收的');
          return { handled: true, value: null };
        }
        if (this.mirror.growth < 100) {
          const g = Math.round(this.mirror.growth * 100) / 100;
          this.prints.push('[!] 作物还没成熟，收不了（' + g + '/100），再浇点水施点肥');
          return { handled: true, value: null };
        }
        if (!this.spend(1)) return { handled: true, value: null };
        this.pushOp({ op: 'harvest' }, line);
        this.mirror.crop = null;
        this.mirror.growth = 0;
        this.mirror.stage = 0;
        this.mirror.moisture = 50;
        this.mirror.nutrient = 50;
        return { handled: true, value: null };
      }

      case 'moisture': case '水分': return { handled: true, value: Math.round(this.mirror.moisture * 100) / 100 };
      case 'nutrient': case '养分': return { handled: true, value: Math.round(this.mirror.nutrient * 100) / 100 };
      case 'growth': case '生长': return { handled: true, value: Math.round(this.mirror.growth * 100) / 100 };
      case 'stage': case '阶段': return { handled: true, value: this.mirror.stage };
      case 'crop': case '作物': return { handled: true, value: this.mirror.crop };
      case 'ops_left': case '剩余劳作': return { handled: true, value: this.mirror.opsLeft };
      case 'day': case '天数': return { handled: true, value: this.mirror.day };

      default:
        return { handled: false };
    }
  }

  evalCall(e: { k: 'call'; name: string; args: Expr[]; line: number }, env: Map<string, any>): any {
    const vals = e.args.map((a) => this.evalExpr(a, env));

    const b = this.callBuiltin(e.name, vals, e.line);
    if (b.handled) return b.value;

    const fn = env.get(e.name);
    if (fn && typeof fn === 'object' && (fn as UserFunc).body) {
      const f = fn as UserFunc;
      if (vals.length !== f.params.length) {
        throw new FarmRuntimeError(
          '函数「' + e.name + '」需要 ' + f.params.length + ' 个参数，实际给了 ' + vals.length + ' 个',
          e.line
        );
      }
      const local = new Map<string, any>(f.env);
      f.params.forEach((p, i) => local.set(p, vals[i]));
      const c = this.execBlock(f.body, local);
      if (c && c.kind === 'return') return c.value;
      return null;
    }

    throw new FarmRuntimeError('没有名为「' + e.name + '」的函数', e.line);
  }

  // ---------- 语句 ----------
  execBlock(stmts: Stmt[], env: Map<string, any>): Ctrl {
    for (const s of stmts) {
      const c = this.execStmt(s, env);
      if (c) return c;
    }
    return null;
  }

  execStmt(s: Stmt, env: Map<string, any>): Ctrl {
    this.bump(s.line);
    switch (s.k) {
      case 'pass':
        return null;

      case 'expr': {
        this.evalExpr(s.expr, env);
        return null;
      }

      case 'assign': {
        const v = this.evalExpr(s.expr, env);
        if (s.op === '=') {
          env.set(s.name, v);
          return null;
        }
        const cur = env.has(s.name)
          ? env.get(s.name)
          : (() => { throw new FarmRuntimeError('变量「' + s.name + '」还没有赋值，不能这样累加', s.line); })();
        const op = s.op[0];
        env.set(s.name, this.binop(op, cur, v, s.line));
        return null;
      }

      case 'if': {
        for (const br of s.branches) {
          if (br.cond === null || truthy(this.evalExpr(br.cond, env))) {
            return this.execBlock(br.body, env);
          }
        }
        return null;
      }

      case 'while': {
        for (;;) {
          this.bump(s.line);
          if (!truthy(this.evalExpr(s.cond, env))) break;
          const c = this.execBlock(s.body, env);
          if (c) {
            if (c.kind === 'break') break;
            if (c.kind === 'return') return c;
            // continue 落到下一轮
          }
        }
        return null;
      }

      case 'for': {
        const it = this.evalExpr(s.iter, env);
        let items: any[];
        if (Array.isArray(it)) items = it;
        else if (typeof it === 'string') items = it.split('');
        else throw new FarmRuntimeError('for 只能遍历 range(...) 或字符串', s.line);
        for (const item of items) {
          this.bump(s.line);
          env.set(s.varName, item);
          const c = this.execBlock(s.body, env);
          if (c) {
            if (c.kind === 'break') break;
            if (c.kind === 'return') return c;
          }
        }
        return null;
      }

      case 'def': {
        env.set(s.name, { params: s.params, body: s.body, env } as UserFunc);
        return null;
      }

      case 'return':
        return { kind: 'return', value: s.expr ? this.evalExpr(s.expr, env) : null };

      case 'break':
        return CTRL_BREAK;

      case 'continue':
        return CTRL_CONTINUE;

      default:
        return null;
    }
  }
}

// ============ 对外入口 ============

export function runFarmCode(
  code: string,
  mirror: FarmMirror,
  opts?: { maxOps?: number }
): FarmRunResult {
  const maxOps = Math.max(1, Math.min(MAX_OPS_DEFAULT, opts && opts.maxOps ? opts.maxOps : MAX_OPS_DEFAULT));
  const interp = new Interp(mirror, maxOps);
  if (!code || !code.trim()) {
    return { ops: [], prints: [], error: null, errorLine: null, mirror: interp.mirror };
  }
  if (code.length > 8000) {
    return { ops: [], prints: [], error: '代码太长了（上限 8000 字符）', errorLine: null, mirror: interp.mirror };
  }
  try {
    const lines = toLogicalLines(code);
    const ast = new Parser(lines).parseProgram();
    const env = new Map<string, any>();
    interp.execBlock(ast, env);
    return { ops: interp.ops, prints: interp.prints, error: null, errorLine: null, mirror: interp.mirror };
  } catch (err) {
    const e = err as any;
    const line = typeof e.line === 'number' ? e.line : interp.curLine || null;
    let msg = e && e.message ? String(e.message) : '代码执行出错';
    if (e instanceof FarmSyntaxError) msg = '语法错误：' + msg;
    else if (e instanceof FarmRuntimeError) msg = '运行错误：' + msg;
    return { ops: interp.ops, prints: interp.prints, error: msg, errorLine: line, mirror: interp.mirror };
  }
}
