// Agent 权限三模式策略（纯函数，无 IO）
// plan = 只读探索；ask = 默认，高危工具逐次确认；full = 全放行
export const AGENT_MODES = ['plan', 'ask', 'full']
export const DEFAULT_MODE = 'ask'

// plan 模式只保留只读工具
export const PLAN_TOOLS = ['read', 'grep', 'find', 'ls']
// ask 模式下需要用户确认的工具
export const CONFIRM_TOOLS = ['bash', 'powershell', 'edit', 'write']

export function isAgentMode(value) {
  return AGENT_MODES.includes(value)
}

// ask/full：会话默认工具集；plan：只读
export function effectiveToolsForMode(mode, sessionTools) {
  if (mode === 'plan') return PLAN_TOOLS
  return sessionTools
}

export function needsAskConfirm(mode, toolName) {
  return mode === 'ask' && CONFIRM_TOOLS.includes(toolName)
}

export function summarizeToolCall(toolName, input = {}) {
  if (toolName === 'bash' || toolName === 'powershell') {
    const cmd = String(input.command ?? '')
    return `${toolName === 'bash' ? '$' : 'PS>'} ${cmd}`.slice(0, 160)
  }
  if (toolName === 'write') return `写入 ${input.path ?? '文件'}`
  if (toolName === 'edit') return `编辑 ${input.path ?? '文件'}`
  return toolName
}
