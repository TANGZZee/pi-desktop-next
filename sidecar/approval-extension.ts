// 审批内联扩展：ask 模式下拦截高危工具调用，经协议桥请 UI 确认
import { needsAskConfirm, summarizeToolCall } from './policy.ts'

export interface ApprovalDeps {
  getMode: () => string
  requestConfirm: (info: { sessionId: string; toolName: string; summary: string }) => Promise<boolean>
  sessionId: string
}

export function createApprovalExtension(deps: ApprovalDeps) {
  return {
    name: 'desktop-approval',
    factory: (pi: any) => {
      pi.on('tool_call', async (event: any) => {
        if (!needsAskConfirm(deps.getMode(), event.toolName)) return undefined
        const ok = await deps.requestConfirm({
          sessionId: deps.sessionId,
          toolName: event.toolName,
          summary: summarizeToolCall(event.toolName, event.input),
        })
        if (!ok) return { block: true, reason: '用户拒绝了此操作' }
        return undefined
      })
    },
  }
}
