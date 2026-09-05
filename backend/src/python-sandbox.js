// Python代码安全执行沙箱
// 适配江苏省高中信息技术课标 - 仅允许基础语法
//
// 隔离策略（2026-09 加固，面向 Windows 部署，无需容器）：
//  1. spawn 增加 -S（不加载 site，避免 os 等模块在启动时自动进入 sys.modules）
//    与 -X utf8（保证输出编码为 UTF-8，不受 PYTHONIOENCODING 影响）
//  2. 包装器内用自定义 __import__ 拦截危险模块；清空危险内建（open/eval/exec/compile 等）
//  3. 执行前静态扫描：剔除注释/字符串（f-string 除外）后，
//     检测 危险 import 与 危险标识符（sys/os/socket/__builtins__/open 等）
//  4. 环境变量白名单（不再全量继承，避免泄露 DB 口令/TOKEN_SECRET）
//  5. 输出字节上限 + 超时/超限时杀整个进程树（Windows 用 taskkill /T），防止孤儿进程

const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 查找真实的 Python 可执行文件路径（跳过 WindowsApps 别名）
function findPythonPath() {
  // 1. 尝试常见的安装路径
  const candidates = [
    'C:\\Users\\jgtty\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
    'C:\\Users\\jgtty\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
    'C:\\Users\\jgtty\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    'C:\\Python310\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files\\Python311\\python.exe',
    'C:\\Program Files\\Python310\\python.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 2. 尝试 where python（排除 WindowsApps）
  try {
    const output = execSync('where python', { encoding: 'utf-8', windowsHide: true });
    const lines = output.trim().split('\n').map(s => s.trim());
    const real = lines.find(l => l && !l.includes('WindowsApps'));
    if (real && fs.existsSync(real)) return real;
  } catch {}
  // 3. 回退到 'python'
  return 'python';
}

const PYTHON_PATH = findPythonPath();

// 禁止导入的模块（含网络/文件/进程/反射等全部风险面）
const DENY_MODULE_ROOTS = [
  'os', 'sys', 'subprocess', 'socket', 'ssl', 'http', 'urllib', 'requests',
  'ftplib', 'smtplib', 'poplib', 'imaplib', 'telnetlib', 'xmlrpc',
  'asyncio', 'ctypes', 'shutil', 'pathlib', 'glob', 'tempfile',
  'multiprocessing', 'threading', 'pickle', 'marshal', 'io', 'codecs',
  'msvcrt', 'winreg', 'importlib', 'runpy', 'site', 'builtins',
];

// 危险标识符（模块名 + 反射/文件/执行类函数），按词边界精确匹配代码 token
const DENY_IDENTIFIERS = DENY_MODULE_ROOTS.concat([
  'eval', 'exec', 'compile', 'open', 'globals', 'locals', 'vars',
  '__import__', '__builtins__', 'breakpoint', 'memoryview',
]);

// 输出/输入/代码长度安全上限
const MAX_OUTPUT_CHARS = 200 * 1024;       // 单次运行 stdout+stderr 累计上限（字符）
const MAX_CODE_LENGTH = 10000;             // 提交代码长度上限
const MAX_INPUT_LENGTH = 5000;             // 输入数据长度上限

// 固定沙箱工作目录：学生代码运行于此，相对路径写入不会落到后端目录
const SANDBOX_DIR = path.join(os.tmpdir(), 'xgpy-py-sandbox');
try { fs.mkdirSync(SANDBOX_DIR, { recursive: true }); } catch (_) {}

// 环境变量白名单（防止把 .env / 数据库口令 / TOKEN_SECRET 带入子进程）
function buildPythonEnv() {
  const env = {};
  const allowedKeys = [
    'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP',
    'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  ];
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

// Windows：用 taskkill 杀掉整个进程树，避免超时后子进程成为孤儿继续占用 CPU
function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } else {
      try { process.kill(-pid, 'SIGKILL'); } catch (_) { process.kill(pid, 'SIGKILL'); }
    }
  } catch (_) {}
}

function generateId() {
  return 'py_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

// 剔除注释与普通字符串字面量用于静态扫描。
// 带前缀的字符串（r/b/u/f/rb/br/rf/fr 等）原样保留：f-string 内含可执行表达式，抹掉会漏检
function stripCommentsAndStrings(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  let state = 'code'; // code | comment | str1 | str3 | keep1 | keep3
  let quoteChar = '';
  let prefixed = false;

  const emit = (ch) => { out += ch; };
  const pad = (ch) => { out += (ch === '\n' ? '\n' : ' '); };

  while (i < n) {
    const ch = code[i];

    if (state === 'code') {
      if (ch === '#') {
        state = 'comment';
        pad(ch);
        i++;
      } else if (ch === '"' || ch === "'") {
        const triple = code[i + 1] === ch && code[i + 2] === ch;
        // 判断紧邻的前缀字母（r/b/u/f 组合）
        let j = i - 1;
        while (j >= 0 && /[A-Za-z_]/.test(code[j])) j--;
        prefixed = (j < i - 1);
        quoteChar = ch;
        emit(ch);
        i += 1;
        if (triple) { emit(ch); emit(ch); i += 2; }
        state = prefixed ? (triple ? 'keep3' : 'keep1') : (triple ? 'str3' : 'str1');
      } else {
        emit(ch);
        i++;
      }
    } else if (state === 'comment') {
      if (ch === '\n') { state = 'code'; emit(ch); }
      else pad(ch);
      i++;
    } else if (state === 'str1' || state === 'keep1') {
      // 转义：跳过下一个字符（内容模式照写；占位模式置空格）
      if (ch === '\\') {
        if (state === 'keep1') { emit(ch); if (i + 1 < n) emit(code[i + 1]); }
        else pad(ch);
        i += 2;
      } else if (ch === quoteChar) {
        emit(ch); // 结束引号：占位/原样都补回引号，避免把相邻标识符合并误判
        state = 'code';
        i++;
      } else {
        if (state === 'keep1') emit(ch); else pad(ch);
        i++;
      }
    } else if (state === 'str3' || state === 'keep3') {
      if (ch === '\\') {
        if (state === 'keep3') { emit(ch); if (i + 1 < n) emit(code[i + 1]); }
        else pad(ch);
        i += 2;
      } else if (ch === quoteChar && code[i + 1] === quoteChar && code[i + 2] === quoteChar) {
        emit(ch); emit(ch); emit(ch);
        state = 'code';
        i += 3;
      } else {
        if (state === 'keep3') emit(ch); else pad(ch);
        i++;
      }
    }
  }
  return out;
}

class PythonSandbox {
  constructor(options = {}) {
    this.maxExecutionTime = options.maxExecutionTime || 3000; // 默认3秒
    this.maxMemoryKB = options.maxMemoryKB || 10240; // 10MB（保留字段）
  }

  // 静态代码审查：剥离注释/字符串后，检查危险 import 与危险标识符
  static checkCodeSafety(code) {
    const errors = [];

    const stripped = stripCommentsAndStrings(code);

    // 1) 危险 import：import os / from socket import * 等（行首或分号后）
    const importRe = /(?:^|[;\n])\s*import\s+([A-Za-z_][\w.]*)/gm;
    let m;
    while ((m = importRe.exec(stripped)) !== null) {
      const root = m[1].split('.')[0];
      if (DENY_MODULE_ROOTS.includes(root)) {
        errors.push({ type: 'blocked_module', message: `禁止使用模块 "${root}" - 超出高中课标范围`, line: null });
      }
    }
    const fromRe = /(?:^|[;\n])\s*from\s+([A-Za-z_][\w.]*)\s+import/gm;
    while ((m = fromRe.exec(stripped)) !== null) {
      const root = m[1].split('.')[0];
      if (DENY_MODULE_ROOTS.includes(root)) {
        errors.push({ type: 'blocked_module', message: `禁止使用模块 "${root}" - 超出高中课标范围`, line: null });
      }
    }

    // 2) 危险标识符：sys.modules['os']、__builtins__['open']、getattr(...) 等绕过方式
    if (errors.length === 0) {
      for (const name of DENY_IDENTIFIERS) {
        const re = new RegExp(`(^|[^A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
        if (re.test(stripped)) {
          errors.push({
            type: 'blocked_identifier',
            message: `禁止使用标识符 "${name}" - 存在安全风险`,
            line: null,
          });
          break;
        }
      }
    }

    return { isSafe: errors.length === 0, errors, warnings: [] };
  }

  static findLineNumber(code, keyword) {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(keyword)) return i + 1;
    }
    return null;
  }

  // 创建安全的包装代码
  static wrapCodeForExecution(userCode, inputData = '') {
    // 预检查
    const safetyCheck = this.checkCodeSafety(userCode);
    if (!safetyCheck.isSafe) {
      return { shouldExecute: false, error: safetyCheck.errors[0].message };
    }

    const denyList = JSON.stringify(DENY_MODULE_ROOTS);

    // 创建安全包装器 - 注意：这是Python代码，必须使用Python语法
    const wrapperCode =
`import sys
import os as _real_os
_SANDBOX_DENY = set(${denyList})
_real_import = __import__
def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    _root = name.split('.')[0] if isinstance(name, str) else ''
    # 已在 sys.modules 中的放行：random 等标准库内部会 import os，此时返回下方安装的安全存根
    if _root in _SANDBOX_DENY and _root not in sys.modules:
        raise ImportError('module is blocked in sandbox: ' + str(name))
    return _real_import(name, globals, locals, fromlist, level)
__b = __builtins__ if isinstance(__builtins__, dict) else vars(__builtins__)
__b['__import__'] = _safe_import
# 用最小安全存根替换真实 os：保留标准库可能用到的 name/sep/urandom，
# 移除 system/popen/open 等危险能力（os 模块不再整体暴露给学生）
if 'os' in sys.modules:
    import types as _types
    _stub = _types.SimpleNamespace()
    _stub._xgpy_os_stub = True
    _stub.name = _real_os.name
    _stub.sep = _real_os.sep
    _stub.urandom = _real_os.urandom
    sys.modules['os'] = _stub
del _real_os
# 运行时清除危险内建。注意：exec/compile/memoryview 是 importlib 加载标准库所必需，不能移除；
# 移除 open/eval/vars/globals/locals 后，学生难以再经由 vars()['__builtins__'] 之类路径取回文件操作能力
for _bn in ('open', 'eval', 'vars', 'globals', 'locals', 'breakpoint'):
    __b.pop(_bn, None)

class SafeOutput:
    def __init__(self):
        self.buffer = []
    def write(self, s):
        self.buffer.append(s)
    def flush(self):
        pass

class SafeInput:
    def __init__(self, input_data):
        self.lines = input_data.split('\\n') if input_data else []
        self.index = 0
    def readline(self):
        if self.index < len(self.lines):
            line = self.lines[self.index] + '\\n'
            self.index += 1
            return line
        return ''

_original_stdout = sys.stdout
_original_stdin = sys.stdin

sys.stdout = SafeOutput()
sys.stdin = SafeInput('''` + inputData.replace(/'/g, "\\'") + `''')

# 重写 input 函数，让提示文本和输入值写入 stderr，方便学生看清输入输出
_original_input = __builtins__.input if isinstance(__builtins__, dict) else __builtins__.input
def _safe_input(prompt=''):
    sys.stderr.write(str(prompt))
    val = _original_input()
    sys.stderr.write(val + '\\n')
    sys.stderr.flush()
    return val
__builtins__.input = _safe_input

` + userCode + `

_output_result = ''.join(sys.stdout.buffer)
sys.stdout = _original_stdout
sys.stdin = _original_stdin
print(_output_result)
`;

    return { shouldExecute: true, wrappedCode: wrapperCode };
  }

  // 纯语法检查（不执行代码，只检查是否可编译）
  static checkSyntaxOnly(code) {
    return new Promise((resolve) => {
      const python = spawn(PYTHON_PATH, ['-X', 'utf8', '-c', [
        'import sys, ast',
        'try:',
        '    ast.parse(sys.stdin.read())',
        '    print("OK")',
        'except SyntaxError as e:',
        '    print(f"ERROR:{e.lineno}:{e.msg}")',
        '    sys.exit(1)',
      ].join('\n')], {
        timeout: 5000,
        windowsHide: true,
        cwd: SANDBOX_DIR,
        env: buildPythonEnv(),
      });

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => { stdout += data.toString(); });
      python.stderr.on('data', (data) => { stderr += data.toString(); });

      python.on('close', (code) => {
        if (code === 0) {
          resolve({ valid: true, errors: [] });
        } else {
          const line = stdout.match(/ERROR:(\d+):(.+)/);
          resolve({
            valid: false,
            errors: [{
              type: 'syntax_error',
              message: line ? line[2] : (stderr || '语法错误'),
              line: line ? parseInt(line[1]) : null,
            }],
          });
        }
      });

      python.stdin.write(code);
      python.stdin.end();
    });
  }

  // 执行Python代码
  async executeCode(code, inputData = '') {
    const startTime = Date.now();

    // 长度守卫：防止超大代码/输入打满子进程或传输
    if (!code || typeof code !== 'string' || code.length > MAX_CODE_LENGTH) {
      return { success: false, status: 'blocked', error: '代码为空或超出长度限制', output: '', execution_time_ms: 0 };
    }
    if (inputData && inputData.length > MAX_INPUT_LENGTH) {
      return { success: false, status: 'blocked', error: '输入数据过长', output: '', execution_time_ms: 0 };
    }

    // 预检查
    const safetyResult = PythonSandbox.checkCodeSafety(code);
    if (!safetyResult.isSafe) {
      return {
        success: false,
        status: 'blocked',
        error: safetyResult.errors[0].message,
        output: '',
        execution_time_ms: 0,
      };
    }

    // 包装代码
    const wrapResult = PythonSandbox.wrapCodeForExecution(code, inputData);
    if (!wrapResult.shouldExecute) {
      return {
        success: false,
        status: 'blocked',
        error: wrapResult.error,
        output: '',
        execution_time_ms: 0,
      };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let executionTime = 0;
      let timedOut = false;
      let outputTruncated = false;
      let killedForOutput = false;
      const maxExecutionTime = this.maxExecutionTime;

      // 累计输出字符数；超过上限即杀进程树并标记截断
      const appendOutput = (bucket, text) => {
        const combined = stdout.length + stderr.length;
        const remaining = MAX_OUTPUT_CHARS - combined;
        if (remaining <= 0) {
          if (!killedForOutput) {
            killedForOutput = true;
            outputTruncated = true;
            killProcessTree(python.pid);
          }
          return;
        }
        bucket.push(text.slice(0, remaining));
      };

      const stdoutParts = [];
      const stderrParts = [];

      // 启动Python进程：-S 不加载 site、-X utf8 强制 UTF-8
      const python = spawn(PYTHON_PATH, ['-X', 'utf8', '-S', '-c', wrapResult.wrappedCode], {
        windowsHide: true,
        cwd: SANDBOX_DIR,
        env: buildPythonEnv(),
      });

      const finish = (result) => {
        if (outputTruncated) result.output_truncated = true;
        resolve(result);
      };

      const timeoutId = setTimeout(() => {
        timedOut = true;
        killProcessTree(python.pid);
        finish({
          success: false,
          status: 'timeout',
          error: '代码执行超时（超过' + (maxExecutionTime / 1000) + '秒），请检查是否有死循环',
          output: stdout,
          execution_time_ms: maxExecutionTime,
        });
      }, maxExecutionTime);

      python.stdout.on('data', (data) => {
        if (timedOut) return;
        const text = data.toString();
        stdout += text;
        appendOutput(stdoutParts, text);
      });

      python.stderr.on('data', (data) => {
        if (timedOut) return;
        const text = data.toString();
        stderr += text;
        appendOutput(stderrParts, text);
      });

      python.on('close', (code) => {
        clearTimeout(timeoutId);
        if (timedOut) return;

        executionTime = Date.now() - startTime;

        // 输出超限被强制终止时，按“截断”而非运行错误返回已收集的部分
        if (killedForOutput) {
          const partialStdout = stdoutParts.join('') || '';
          finish({
            success: true,
            status: 'success',
            output: partialStdout + '\n[提示] 程序输出过长，已自动截断。',
            printOutput: partialStdout,
            execution_time_ms: executionTime,
          });
          return;
        }

        // stderr 可能包含 input 提示文本，仅当 exit code 非零时视为错误
        if (code !== 0) {
          const translatedError = this.translateError(stderrParts.join(''));
          finish({
            success: false,
            status: 'runtime_error',
            error: translatedError,
            output: stdoutParts.join(''),
            execution_time_ms: executionTime,
          });
        } else {
          // 成功时，将 stderr（包含 input 提示文本+输入值）和 stdout 分别返回
          const cleanStderr = (stderrParts.join('') || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const cleanStdout = (stdoutParts.join('') || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          let displayOutput = '';
          if (cleanStderr && cleanStdout) {
            displayOutput = cleanStderr + '\n' + cleanStdout;
          } else if (cleanStderr) {
            displayOutput = cleanStderr;
          } else {
            displayOutput = cleanStdout;
          }
          finish({
            success: true,
            status: 'success',
            output: displayOutput,
            printOutput: cleanStdout || '',
            execution_time_ms: executionTime,
          });
        }
      });

      python.on('error', (err) => {
        clearTimeout(timeoutId);
        finish({
          success: false,
          status: 'runtime_error',
          error: '执行失败: ' + err.message,
          output: stdoutParts.join(''),
          execution_time_ms: 0,
        });
      });
    });
  }

  // 简单的错误信息翻译
  translateError(errorText) {
    const translations = {
      'SyntaxError': '语法错误',
      'IndentationError': '缩进错误',
      'NameError': '名称错误',
      'TypeError': '类型错误',
      'ValueError': '值错误',
      'ZeroDivisionError': '除零错误',
      'IndexError': '索引错误',
      'KeyError': '键错误',
      'AttributeError': '属性错误',
      'EOFError': '文件结束错误',
      'RuntimeError': '运行时错误',
      'ModuleNotFoundError': '模块未找到',
      'not defined': '未定义',
      'invalid syntax': '语法无效',
      'expected an indented block': '需要缩进',
      'unexpected indent': '意外的缩进',
      'unindent does not match': '缩进不匹配'
    };

    let result = errorText;
    for (const [eng, zh] of Object.entries(translations)) {
      result = result.replace(new RegExp(eng, 'g'), zh);
    }
    return result;
  }
}

module.exports = PythonSandbox;
