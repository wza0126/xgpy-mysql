// Python代码安全执行沙箱
// 适配江苏省高中信息技术课标 - 仅允许基础语法

const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
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
    const output = execSync('where python', { encoding: 'utf-8' });
    const lines = output.trim().split('\n').map(s => s.trim());
    const real = lines.find(l => l && !l.includes('WindowsApps'));
    if (real && fs.existsSync(real)) return real;
  } catch {}
  // 3. 回退到 'python'
  return 'python';
}

const PYTHON_PATH = findPythonPath();

// 禁止的模块和函数（高中阶段不需要）
const BLOCKED_MODULES = [
  'os', 'sys', 'subprocess', 'threading', 'multiprocessing',
  'socket', 'http', 'urllib', 'requests', 'pickle', 'marshal',
  'eval', 'exec', 'compile', 'globals', 'locals', '__import__',
  'file', 'open', 'write', 'read',
  'memory', 'gc', 'ctypes', 'shutil', 'pathlib'
];

// 允许的基础语法关键字（高中课标）
const ALLOWED_KEYWORDS = [
  'and', 'as', 'assert', 'break', 'class', 'continue', 'def',
  'del', 'elif', 'else', 'except', 'False', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'True', 'try', 'while', 'with', 'yield'
];

// 内置安全函数白名单
const SAFE_BUILTINS = [
  'abs', 'all', 'any', 'bin', 'bool', 'chr', 'dict', 'dir',
  'divmod', 'enumerate', 'float', 'format', 'hex', 'int', 'len',
  'list', 'map', 'max', 'min', 'oct', 'ord', 'pow', 'range',
  'repr', 'reversed', 'round', 'set', 'slice', 'sorted', 'str',
  'sum', 'tuple', 'type', 'zip'
];

function generateId() {
  return 'py_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

class PythonSandbox {
  constructor(options = {}) {
    this.maxExecutionTime = options.maxExecutionTime || 3000; // 默认3秒
    this.maxMemoryKB = options.maxMemoryKB || 10240; // 10MB
  }

  // 静态代码审查 - 预检查安全风险
  static checkCodeSafety(code) {
    const errors = [];
    const warnings = [];

    // 检查是否有危险的导入
    for (const module of BLOCKED_MODULES) {
      const importRegex = new RegExp(`(import\\s+${module}|from\\s+${module})`, 'i');
      if (importRegex.test(code)) {
        errors.push({
          type: 'blocked_module',
          message: '禁止使用模块 "' + module + '" - 超出高中课标范围',
          line: this.findLineNumber(code, module)
        });
      }
    }

    // 检查危险函数调用
    const dangerousFunctions = ['eval(', 'exec(', 'compile(', 'open('];
    for (const func of dangerousFunctions) {
      if (code.includes(func)) {
        errors.push({
          type: 'dangerous_function',
          message: '禁止使用函数 "' + func.replace('(', '') + '" - 存在安全风险',
          line: this.findLineNumber(code, func)
        });
      }
    }

    // 检查文件操作
    const fileOps = ['read(', 'write(', 'open('];
    for (const op of fileOps) {
      if (code.includes(op)) {
        errors.push({
          type: 'file_operation',
          message: '禁止文件操作 - 当前环境不支持',
          line: this.findLineNumber(code, op)
        });
      }
    }

    return {
      isSafe: errors.length === 0,
      errors,
      warnings
    };
  }

  static findLineNumber(code, keyword) {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(keyword)) {
        return i + 1;
      }
    }
    return null;
  }

  // 创建安全的包装代码
  static wrapCodeForExecution(userCode, inputData = '') {
    // 预检查
    const safetyCheck = this.checkCodeSafety(userCode);
    if (!safetyCheck.isSafe) {
      return {
        shouldExecute: false,
        error: safetyCheck.errors[0].message
      };
    }

    // 创建安全包装器 - 注意：这是Python代码，必须使用Python语法
    const wrapperCode =
`import sys
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
    import sys as _sys
    _sys.stderr.write(str(prompt))
    val = _original_input()
    _sys.stderr.write(val + '\\n')
    _sys.stderr.flush()
    return val
__builtins__.input = _safe_input

` + userCode + `

_output_result = ''.join(sys.stdout.buffer)
sys.stdout = _original_stdout
sys.stdin = _original_stdin
print(_output_result)
`;

    return {
      shouldExecute: true,
      wrappedCode: wrapperCode
    };
  }

  // 纯语法检查（不执行代码，只检查是否可编译）
  static checkSyntaxOnly(code) {
    return new Promise((resolve) => {
      const python = spawn(PYTHON_PATH, ['-c', [
        'import sys, ast',
        'try:',
        '    ast.parse(sys.stdin.read())',
        '    print("OK")',
        'except SyntaxError as e:',
        '    print(f"ERROR:{e.lineno}:{e.msg}")',
        '    sys.exit(1)',
      ].join('\n')], {
        timeout: 5000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

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
              line: line ? parseInt(line[1]) : null
            }]
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

    // 预检查
    const safetyResult = PythonSandbox.checkCodeSafety(code);
    if (!safetyResult.isSafe) {
      return {
        success: false,
        status: 'blocked',
        error: safetyResult.errors[0].message,
        output: '',
        execution_time_ms: 0
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
        execution_time_ms: 0
      };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let executionTime = 0;
      let timedOut = false;

      // 启动Python进程
      const python = spawn(PYTHON_PATH, ['-c', wrapResult.wrappedCode], {
        timeout: this.maxExecutionTime,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1'
        }
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        python.kill('SIGKILL');
        resolve({
          success: false,
          status: 'timeout',
          error: '代码执行超时（超过' + (this.maxExecutionTime/1000) + '秒），请检查是否有死循环',
          output: stdout,
          execution_time_ms: this.maxExecutionTime
        });
      }, this.maxExecutionTime);

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (timedOut) return;
        
        executionTime = Date.now() - startTime;

        // stderr 可能包含 input 提示文本，仅当 exit code 非零时视为错误
        if (code !== 0) {
          // 翻译错误信息为中文
          const translatedError = this.translateError(stderr);
          resolve({
            success: false,
            status: 'runtime_error',
            error: translatedError,
            output: stdout,
            execution_time_ms: executionTime
          });
        } else {
          // 成功时，将 stderr（包含 input 提示文本+输入值）和 stdout 分别返回
          // 输入部分和输出部分之间用换行分隔，便于学生区分
          // 规范化换行符，避免 Windows \r\n 导致多余空行
          const cleanStderr = (stderr || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const cleanStdout = (stdout || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          let displayOutput = '';
          if (cleanStderr && cleanStdout) {
            displayOutput = cleanStderr + '\n' + cleanStdout;
          } else if (cleanStderr) {
            displayOutput = cleanStderr;
          } else {
            displayOutput = cleanStdout;
          }
          resolve({
            success: true,
            status: 'success',
            output: displayOutput,
            printOutput: stdout || '',
            execution_time_ms: executionTime
          });
        }
      });

      python.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          status: 'runtime_error',
          error: '执行失败: ' + err.message,
          output: stdout,
          execution_time_ms: 0
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
