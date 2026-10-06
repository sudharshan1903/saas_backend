// IMPORTANT: stdio-guard.js MUST be imported before any logger or stdio modules.
// MCP standard transport uses stdout for JSON-RPC messages.
// Any plain text printed to stdout (like console.log or dotenv output) will corrupt the MCP stream.
process.env.LOG_TO_STDERR = '1';

const originalLog = console.log;
const originalInfo = console.info;
const originalDebug = console.debug;

console.log = (...args) => console.error('[MCP LOG]', ...args);
console.info = (...args) => console.error('[MCP INFO]', ...args);
console.debug = (...args) => console.error('[MCP DEBUG]', ...args);

export { originalLog, originalInfo, originalDebug };
