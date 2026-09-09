#!/usr/bin/env node
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import readline from 'node:readline'
import os from 'node:os'
import path from 'node:path'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const sessions = new Map()
let runtime
let workspace = process.cwd()
const agentDir = path.join(os.homedir(), '.pi', 'agent')
const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

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
  if (copy.type === 'message_update' && copy.assistantMessageEvent) {
    const inner = copy.assistantMessageEvent
    return { ...copy, delta: inner.delta, text: inner.text, thinking: inner.thinking, assistantMessageEvent: { type: inner.type, delta: inner.delta, text: inner.text, thinking: inner.thinking } }
  }
  if (copy.type === 'tool_execution_start' || copy.type === 'tool_execution_update' || copy.type === 'tool_execution_end') {
    return { type: copy.type, toolCallId: copy.toolCallId, toolName: copy.toolName, args: copy.args, partialResult: copy.partialResult, result: copy.result, isError: copy.isError }
  }
  return copy
}

async function ensureRuntime() {
  if (!runtime) runtime = await ModelRuntime.create({ agentDir, refreshOnCreate: false })
  return runtime
}

async function createSession(id, cwd = workspace, thinking) {
  const modelRuntime = await ensureRuntime()
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    sessionManager: SessionManager.create(cwd, path.join(agentDir, 'sessions')),
  })
  if (thinking) session.setThinkingLevel(thinking)
  const unsubscribe = session.subscribe((event) => send({ type: 'event', sessionId: id, event: summarizeEvent(event) }))
  sessions.set(id, { session, unsubscribe, cwd })
  return { id, sessionId: session.sessionId, cwd, file: session.sessionManager.getSessionFile() }
}

async function openSession(id, file) {
  const modelRuntime = await ensureRuntime()
  const sessionManager = SessionManager.open(file)
  const { session } = await createAgentSession({ cwd: sessionManager.getCwd() || workspace, agentDir, modelRuntime, sessionManager })
  const unsubscribe = session.subscribe((event) => send({ type: 'event', sessionId: id, event: summarizeEvent(event) }))
  sessions.set(id, { session, unsubscribe, cwd: sessionManager.getCwd() || workspace, file })
  return { id, sessionId: session.sessionId, cwd: sessionManager.getCwd() || workspace, file }
}

async function listSessions(cwd = workspace) {
  const infos = await SessionManager.list(cwd, path.join(agentDir, 'sessions'))
  return infos.map((info) => ({ id: info.id, title: info.name || '未命名会话', cwd: info.cwd || cwd, file: info.path, modifiedAt: info.modified.getTime() }))
}
async function listFiles(cwd = workspace) {
  const root = path.resolve(cwd)
  const output = []
  async function visit(dir, depth) {
    if (depth > 2 || output.length >= 300) return
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'target'].includes(entry.name)) continue
      const absolute = path.join(dir, entry.name)
      const relative = path.relative(root, absolute).replaceAll('\\', '/')
      if (entry.isDirectory()) { output.push({ path: relative, kind: 'directory' }); await visit(absolute, depth + 1) }
      else output.push({ path: relative, kind: 'file' })
    }
  }
  await visit(root, 0)
  return output
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 会话上下文与用量统计；任何字段缺失都兜底为 0，不抛错。
function sessionStats(entry) {
  const messages = Array.isArray(entry.session.messages) ? entry.session.messages : []
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  let currentContext = 0
  for (const message of messages) {
    if (!message || message.role !== 'assistant' || !message.usage) continue
    const usage = message.usage
    totals.input += num(usage.input)
    totals.output += num(usage.output)
    totals.cacheRead += num(usage.cacheRead)
    totals.cacheWrite += num(usage.cacheWrite)
    totals.total += num(usage.totalTokens)
    // 口径：最近一条 assistant 消息的 usage，input + output + cacheRead 之和。
    currentContext = num(usage.input) + num(usage.output) + num(usage.cacheRead)
  }
  const model = entry.session.model
  const cost = model?.cost ?? {}
  const costUsd =
    (totals.input * num(cost.input) +
      totals.output * num(cost.output) +
      totals.cacheRead * num(cost.cacheRead) +
      totals.cacheWrite * num(cost.cacheWrite)) /
    1e6
  const denominator = totals.input + totals.cacheRead
  const cacheHitRate = denominator > 0 ? totals.cacheRead / denominator : 0
  return {
    currentContext,
    window: num(model?.contextWindow),
    totals,
    costUsd,
    cacheHitRate,
  }
}

async function readWorkspaceFile(cwd, file) {
  const root = path.resolve(cwd)
  const absolute = path.resolve(root, file)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error('禁止读取工作区外的文件')
  const info = await stat(absolute)
  if (!info.isFile() || info.size > 512 * 1024) throw new Error('文件不存在或超过 512 KB')
  return { path: path.relative(root, absolute).replaceAll('\\', '/'), content: await readFile(absolute, 'utf8') }
}
async function writeWorkspaceFile(cwd, file, content) {
  const root = path.resolve(cwd)
  const absolute = path.resolve(root, file)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error('禁止写入工作区外的文件')
  if (Buffer.byteLength(content, 'utf8') > 512 * 1024) throw new Error('文件超过 512 KB')
  await writeFile(absolute, content, 'utf8')
  return { path: file }
}

// 仅暴露非破坏性 Git 写操作；reset / checkout / clean / stash 等一律不提供。
async function git(cwd, args, { throwOnFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: path.resolve(cwd), maxBuffer: 2 * 1024 * 1024, windowsHide: true })
    return stdout
  } catch (error) {
    if (error.code === 128 && !throwOnFailure) return ''
    throw error
  }
}

async function gitStatus(cwd = workspace) {
  const output = await git(cwd, ['status', '--porcelain=v1'])
  return output.split(/\r?\n/).filter(Boolean).map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }))
}

async function gitDiff(cwd, file) {
  return git(cwd, ['diff', '--no-ext-diff', '--', file])
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
    if (type === 'set_workspace') {
      workspace = path.resolve(payload.cwd || workspace)
      reply(id, { cwd: workspace, files: await listFiles(workspace) })
      return
    }
    if (type === 'list_files') {
      reply(id, await listFiles(payload.cwd || workspace))
      return
    }
    if (type === 'read_file') {
      reply(id, await readWorkspaceFile(payload.cwd || workspace, payload.path))
      return
    }
    if (type === 'write_file') {
      reply(id, await writeWorkspaceFile(payload.cwd || workspace, payload.path, payload.content || ''))
      return
    }
    if (type === 'git_status') {
      reply(id, await gitStatus(payload.cwd || workspace))
      return
    }
    if (type === 'git_diff') {
      reply(id, await gitDiff(payload.cwd || workspace, payload.path))
      return
    }
    if (type === 'git_add') {
      const paths = Array.isArray(payload.paths) ? payload.paths.filter((item) => typeof item === 'string') : []
      if (!paths.length) throw new Error('未指定要暂存的文件')
      await git(payload.cwd || workspace, ['add', '--', ...paths], { throwOnFailure: true })
      reply(id, { added: paths })
      return
    }
    if (type === 'git_commit') {
      const message = String(payload.message ?? '').trim()
      if (!message) throw new Error('提交信息不能为空')
      try {
        await git(payload.cwd || workspace, ['commit', '-m', message], { throwOnFailure: true })
        reply(id, { committed: true })
      } catch (error) {
        const extra = [error?.stdout, error?.stderr].filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).join('\n')
        throw new Error(extra || (error?.message ?? 'git commit 失败'))
      }
      return
    }
    if (type === 'git_push') {
      try {
        await git(payload.cwd || workspace, ['push'], { throwOnFailure: true })
        reply(id, { pushed: true })
      } catch (error) {
        const extra = [error?.stderr, error?.stdout].filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).join('\n')
        throw new Error(extra || (error?.message ?? 'git push 失败'))
      }
      return
    }
    if (type === 'create_session') {
      reply(id, await createSession(payload.sessionId || `session-${Date.now()}`, payload.cwd || workspace, payload.thinking))
      return
    }
    if (type === 'session_stats') {
      const entry = sessions.get(payload.sessionId)
      if (!entry) throw new Error(`会话不存在: ${payload.sessionId}`)
      reply(id, sessionStats(entry))
      return
    }
    if (type === 'list_sessions') {
      reply(id, await listSessions(payload.cwd || workspace))
      return
    }
    if (type === 'open_session') {
      reply(id, await openSession(payload.sessionId || payload.file, payload.file))
      return
    }
    if (type === 'rename_session') {
      const entry = sessions.get(payload.sessionId)
      if (!entry) throw new Error(`会话不存在: ${payload.sessionId}`)
      const name = String(payload.name ?? '').trim()
      if (!name) throw new Error('会话名称不能为空')
      entry.session.sessionManager.appendSessionInfo(name)
      reply(id, { sessionId: payload.sessionId, name })
      return
    }
    if (type === 'set_model') {
      const entry = sessions.get(payload.sessionId)
      if (!entry) throw new Error(`会话不存在: ${payload.sessionId}`)
      const model = (await ensureRuntime()).getModels().find((item) => item.provider === payload.provider && item.id === payload.modelId)
      if (!model) throw new Error(`模型不存在: ${payload.provider}/${payload.modelId}`)
      await entry.session.setModel(model)
      reply(id, { provider: model.provider, id: model.id, name: model.name, thinkingLevel: entry.session.thinkingLevel })
      return
    }
    if (type === 'set_thinking') {
      const entry = sessions.get(payload.sessionId)
      if (!entry) throw new Error(`会话不存在: ${payload.sessionId}`)
      if (!payload.level) throw new Error('缺少思考档位')
      entry.session.setThinkingLevel(payload.level)
      reply(id, { level: entry.session.thinkingLevel })
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
