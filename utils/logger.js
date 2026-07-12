const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const logsDir = path.join(__dirname, '../logs');
try {
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
} catch (e) {}

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function writeToFile(level, message) {
  try {
    const logFile = path.join(logsDir, `${new Date().toISOString().split('T')[0]}.log`);
    const entry = `[${getTimestamp()}] [${level}] ${message}\n`;
    fs.appendFileSync(logFile, entry, { flag: 'a' });
  } catch (err) {
    try {
      process.stderr.write(`[${getTimestamp()}] [${level}] ${message}\n`);
    } catch (e) {}
  }
}

function safeConsole(level, method, coloredMsg, plainMsg) {
  try {
    const streamOk = typeof process.stdout.fd === 'number' && process.stdout.fd >= 0;
    const methodOk = typeof console[method] === 'function';
    if (streamOk && methodOk) {
      console[method](coloredMsg);
    } else if (streamOk && typeof console.log === 'function') {
      console.log(plainMsg);
    }
  } catch (err) {}
}

const logger = {
  info: (message) => {
    const plain = `[${getTimestamp()}] [INFO] ${message}`;
    const msg = `${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.cyan}[INFO]${colors.reset} ${message}`;
    try { safeConsole('INFO', 'log', msg, plain); } catch (e) {}
    try { writeToFile('INFO', message); } catch (e) {}
  },

  success: (message) => {
    const plain = `[${getTimestamp()}] [SUCCESS] ${message}`;
    const msg = `${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.green}[SUCCESS]${colors.reset} ${message}`;
    try { safeConsole('SUCCESS', 'log', msg, plain); } catch (e) {}
    try { writeToFile('SUCCESS', message); } catch (e) {}
  },

  warn: (message) => {
    const plain = `[${getTimestamp()}] [WARN] ${message}`;
    const msg = `${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset} ${message}`;
    try { safeConsole('WARN', 'warn', msg, plain); } catch (e) {}
    try { writeToFile('WARN', message); } catch (e) {}
  },

  error: (message, stack) => {
    const fullMessage = stack ? `${message}\n${stack}` : message;
    const plain = `[${getTimestamp()}] [ERROR] ${fullMessage}`;
    const msg = `${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.red}[ERROR]${colors.reset} ${message}`;
    try { safeConsole('ERROR', 'error', msg, plain); } catch (e) {}
    try { writeToFile('ERROR', fullMessage); } catch (e) {}
  },

  debug: (message) => {
    const plain = `[${getTimestamp()}] [DEBUG] ${message}`;
    const msg = `${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.magenta}[DEBUG]${colors.reset} ${message}`;
    try { safeConsole('DEBUG', 'log', msg, plain); } catch (e) {}
    try { writeToFile('DEBUG', message); } catch (e) {}
  },

  command: (user, command, guild) => {
    const plain = `[${getTimestamp()}] [CMD] ${user} used /${command} in ${guild}`;
    const msg = `${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.blue}[CMD]${colors.reset} ${colors.bright}${user}${colors.reset} used ${colors.cyan}/${command}${colors.reset} in ${guild}`;
    try { safeConsole('CMD', 'log', msg, plain); } catch (e) {}
    try { writeToFile('CMD', plain); } catch (e) {}
  },

  criticalError: (message, stack = '') => {
    const fullMessage = stack ? `${message}\n${stack}` : message;
    const plain = `[${getTimestamp()}] [CRITICAL] ${fullMessage}`;
    try {
      writeToFile('CRITICAL', fullMessage);
    } catch (e) {
      try {
        process.stderr.write(plain + '\n');
      } catch (err) {}
    }
  },
};

module.exports = logger;