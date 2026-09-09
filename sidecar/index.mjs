#!/usr/bin/env node
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import readline from 'node:readline'
import os from 'node:os'
import path from 'node:path'

const sessions = new Map()
let runtime
let workspace = process.cwd()
const agentDir = path.join(os.homedir(), '.pi', 'agent')

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
function log(...args) {
  process.stderr.write(`[pi-sidecar] ${args.join(' ')}\n`)
}
function reply(id, result, error) {
  send({ type: 'response', id, ok: !error, result, error: error ? String(error?.message ?? error) : undefined })
}
function summarizeEvent(event) {
  if (!event || typeof event !== 'object') return event
  const copy = { ...event }
  // Keep the protocol small; the full assistant message is already rebuilt by the UI.
  if (copy.type === 'message_update' && copy.assistantMessageEvent) {
    const inner = copy.assistantMessageEvent
    copy.assistantMessageEvent = { type: inner.type, delta: inner.delta, text: inner.text, thinking: inner.thinking }
  }
  return copy
}

async function ensureRuntime() {
  if (!runtime) runtime = await ModelRuntime.create({ agentDir, refreshOnCreate: false })
  return runtime
}

async function createSession(id, cwd = workspace) {
  const modelRuntime = await ensureRuntime()
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    sessionManager: SessionManager.create(cwd, path.join(agentDir, 'sessions')),
  })
  const unsubscribe = session.subscribe((event) => send({ type: 'event', sessionId: id, event: summarizeEvent(event) }))
  sessions.set(id, { session, unsubscribe, cwd })
  return { id: session.sessionId, cwd }
}

async function handle(request) {
  const { id, type, payload = {} } = request
  try {
    if (type === 'init') {
      workspace = payload.cwd || workspace
      await ensureRuntime()
      reply(id, { ready: true, cwd: workspace, agentDir })
      return
    }
    if (type === 'list_models') {
      const models = (await ensureRuntime()).getModels().map((model) => ({ provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning }))
      reply(id, models)
      return
    }
    if (type === 'create_session') {
      reply(id, await createSession(payload.sessionId || `session-${Date.now()}`, payload.cwd || workspace))
      return
    }
    if (type === 'prompt') {
      let entry = sessions.get(payload.sessionId)
      if (!entry) {
        await createSession(payload.sessionId, payload.cwd || workspace)
        entry = sessions.get(payload.sessionId)
      }
      if (!entry) throw new Error('无法创建 Agent 会话')
      // Do not await the whole turn: the UI must remain available for steering and abort.
      void entry.session.prompt(payload.text, { streamingBehavior: payload.behavior || 'followUp' }).catch((error) => send({ type: 'event', sessionId: payload.sessionId, event: { type: 'error', message: error.message } }))
      reply(id, { accepted: true })
      return
    }
    if (type === 'abort') {
      await sessions.get(payload.sessionId)?.session.abort()
      reply(id, { aborted: true })
      return
    }
    throw new Error(`未知 sidecar 请求: ${type}`)
  } catch (error) {
    log(error)
    reply(id, null, error)
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  try { await handle(JSON.parse(line)) } catch (error) { log(error) }
}
