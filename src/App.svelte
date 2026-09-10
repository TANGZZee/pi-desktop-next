<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { open, confirm } from '@tauri-apps/plugin-dialog'
  import Terminal from './Terminal.svelte'
  import Settings from './Settings.svelte'
  import Atom from './Atom.svelte'
  import MarkdownView from './MarkdownView.svelte'
  import Pet from './Pet.svelte'
  import Live2DPet from './Live2DPet.svelte'
  import { petById, petModelUrl } from './pets'
  import { version } from '../package.json'
  import logoUrl from './assets/pi-my-logo.png'
  import { applyPrefsChrome, loadPrefs, patchPrefs } from './prefs'
  import { findAgent, loadAgents, wrapTask, type AgentDef } from './agents'
  import { cycleTodoStatus, loadTodos, newTodo, saveTodos, todoTree, type TodoItem, type TodoStatus } from './todos'

  type PanelTab = '文档' | '变更' | '终端' | '运行' | '待办'
  type Session = { id: string; title: string; time: string; file?: string; state?: 'active' | 'done'; model?: string; thinking?: string; mode?: string; pinned?: boolean; archived?: boolean; parentId?: string; readOnly?: boolean }
  type ModelInfo = { provider: string; id: string; name: string; reasoning: boolean }
  type GitChange = { code: string; path: string }
  type SidecarResponse = { type: 'response'; id: number; ok: boolean; result: unknown; error?: string }
  type SentMessage = { text: string; at: string }
  type SubRun = { id: string; agent: string; task: string; status: 'running' | 'done' | 'error'; reply: string }
  type Phase = 'idle' | 'thinking' | 'working' | 'writing' | 'waiting'
  type ProcessStep = { id: string; kind: 'think' | 'tool'; title: string; body: string; done: boolean }
  type RunSlot = { reply: string; thinking: string; tool: string; phase: Phase; running: boolean; queue: string[]; steer: string[]; sent: SentMessage[]; subRuns: SubRun[]; process: ProcessStep[]; processOpen: boolean; confirm?: { confirmId: string; toolName: string; summary: string } }
  type SettingsInfo = { node: string; sdk: string; agentDir: string; sessionDir: string; authProviders: string[]; providers?: Array<{ provider: string; modelCount: number; configured: boolean }> }
  type CtxStats = { currentContext: number; window: number; totals: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; costUsd: number; cacheHitRate: number }
  type UsageStats = { sessions: number; turns: number; activeDays: number; totals: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; costUsd: number; costKnown: boolean; byModel: Array<{ model: string; tokens: number; turns: number }>; byProject?: Array<{ project: string; tokens: number; turns: number }>; byDay?: Record<string, number> }
  type ImageGenConfig = { baseUrl: string; apiKey: string; model: string; size: string }
  const CTX_CIRC = 2 * Math.PI * 7
  const EMPTY_CTX: CtxStats = { currentContext: 0, window: 0, totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, cacheHitRate: 0 }

  let sessions: Session[] = []

  const appWindow = getCurrentWindow()
  let maximized = false

  function toggleMaximize() {
    void appWindow.toggleMaximize().then(() => appWindow.isMaximized().then((value) => (maximized = value)))
  }

  let activeSession = '新会话'
  let activeSessionId = ''
  let panel: PanelTab = '文档'
  let leftTab: 'Activity' | 'Chats' | 'Projects' = 'Projects'
  let showLeft = true
  let showRight = true
  let showSettings = false
  type LoginPrompt = { promptId: string; type: string; message: string; placeholder?: string; options?: Array<{ id: string; label: string }> }
  type LoginState = { provider: string; status: string; userCode?: string; verificationUri?: string; prompt?: LoginPrompt; value: string }
  let loginState: LoginState | null = null
  let petStatus: { base: string; pets: Array<{ id: string; model: string | null }> } = { base: '', pets: [] }
  let workspacePath = '.'
  let files: Array<{ path: string; kind: 'file' | 'directory' }> = []
  let selectedFile = ''
  let fileContent = ''
  let editingFile = false
  let gitChanges: GitChange[] = []
  let diffContent = ''
  let staged: Record<string, boolean> = {}
  let commitMessage = ''
  let gitError = ''
  let inputText = ''
  let query = ''
  let runState: Record<string, RunSlot> = {}
  let sidecarReady = false
  let models: ModelInfo[] = []
  let composerInput: HTMLTextAreaElement
  let modelOpen = false
  let modelMenuUp = false
  let modelQuery = ''
  let hiddenProviders: string[] = []
  let providers: Array<{ provider: string; modelCount: number; configured: boolean }> = []

  function loadHiddenProviders() {
    try { hiddenProviders = JSON.parse(localStorage.getItem('pdn.hidden-providers') ?? '[]') as string[] } catch { hiddenProviders = [] }
  }
  function refreshPrefs() {
    uiPrefs = loadPrefs()
    applyPrefsChrome()
    loadHiddenProviders()
    void refreshPetStatus()
  }
  function desktopNotify(title: string, body: string) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    try { new Notification(title, { body }) } catch { /* ignore */ }
  }
  let modelSearchInput: HTMLInputElement
  let modelButtonRef: HTMLButtonElement
  let settingsInfo: SettingsInfo | null = null
  let usageStats: UsageStats | null = null
  let ctxStats: CtxStats = EMPTY_CTX
  let ctxOpen = false
  let ctxMenuUp = false
  let ctxButtonRef: HTMLButtonElement
  let thinkingOpen = false
  let thinkingMenuUp = false
  let thinkingDraft = ''
  let thinkingHelp = false
  let thinkingButtonRef: HTMLButtonElement
  let modeOpen = false
  let modeMenuUp = false
  let modeButtonRef: HTMLButtonElement
  let kindOpen = false
  let kindButtonRef: HTMLButtonElement
  let moreOpen = false
  let uiPrefs = loadPrefs()
  let todos: TodoItem[] = []
  let todoDraft = ''
  let todoParentId = ''
  let agentDefs: AgentDef[] = loadAgents()
  let splitOpen = false
  let splitRows: Array<{ agent: string; task: string }> = [{ agent: 'scout', task: '' }]
  let viewingSub: SubRun | null = null
  let attachments: Array<{ kind: 'image' | 'text'; name: string; mimeType?: string; data?: string; content?: string }> = []
  let imageGenMode = false
  let imageGenBusy = false
  let imageGenError = ''
  let imageGenResult: { src: string; prompt: string } | null = null
  let imageGenConfig: ImageGenConfig = { baseUrl: '', apiKey: '', model: '', size: '1024x1024' }
  let attachError = ''
  let rightWidth = 280
  let sessionMenu: { session: Session; x: number; y: number } | null = null
  let dragging: 'left' | 'right' | null = null
  let dragStartX = 0
  let dragStartWidth = 0
  // 与 SDK 保持一致：THINKING_LEVEL_OPTIONS / DEFAULT_THINKING_LEVEL
  const MODEL_SEPARATOR = '\u0000'
  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const THINKING_LABELS: Record<string, string> = { off: '关', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' }
  const THINKING_HELP: Record<string, string> = { off: '不做额外思考', minimal: '最少推理，响应最快', low: '轻度推理，适合简单任务', medium: '均衡推理深度', high: '深入推理，适合复杂任务', xhigh: '更充分的推理与校验', max: '最深推理，耗时最长' }
  const DEFAULT_THINKING = 'medium'
  const MODE_LABELS: Record<string, string> = { plan: '计划', ask: '默认', full: '完全访问' }
  const MODE_OPTIONS: Array<{ value: string; label: string; desc: string }> = [
    { value: 'plan', label: '计划', desc: '只读探索，不改任何文件' },
    { value: 'ask', label: '默认', desc: '写与命令逐次确认' },
    { value: 'full', label: '完全访问', desc: '不拦截，仅建议可信项目' }
  ]
  const pending = new Map<number, (value: SidecarResponse) => void>()
  let requestSequence = 0

  $: openTabs = sessions.filter((item) => !item.archived && !item.parentId)
  $: filteredSessions = sessions.filter((item) => !item.archived && !item.parentId && item.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned))
  $: listedSessions = leftTab === 'Activity'
    ? filteredSessions.filter((item) => item.state === 'active' || slotFor(item.id).running)
    : filteredSessions
  $: filteredFiles = files.filter((item) => item.path.toLowerCase().includes(query.toLowerCase()))
  let openDirs: Record<string, boolean> = {}
  function fileName(path: string) {
    return path.split('/').pop() || path
  }
  function treeChildren(prefix: string) {
    const base = prefix ? `${prefix}/` : ''
    return filteredFiles.filter((item) => {
      const rest = prefix ? (item.path.startsWith(base) ? item.path.slice(base.length) : '') : item.path
      return rest !== '' && !rest.includes('/')
    })
  }
  function toggleDir(path: string) {
    openDirs = { ...openDirs, [path]: !openDirs[path] }
  }
  $: currentModelKey = modelChoice(models, sessions, activeSessionId)
  $: currentModel = models.find((item) => modelKey(item) === currentModelKey)
  $: currentModelLabel = currentModel ? currentModel.name : '选择模型'
  $: modelFilter = modelQuery.trim().toLowerCase()
  $: modelMatches = (modelFilter ? models.filter((item) => item.name.toLowerCase().includes(modelFilter) || item.provider.toLowerCase().includes(modelFilter)) : models).filter((item) => !hiddenProviders.includes(item.provider))
  $: modelDropdownGroups = modelGroups(modelMatches)
  $: currentThinking = thinkingChoice(sessions, activeSessionId)
  $: currentMode = sessionMode(sessions, activeSessionId)
  $: thinkingLevel = thinkingDraft || currentThinking
  $: thinkingIndex = Math.max(0, THINKING_LEVELS.indexOf(thinkingLevel))
  $: thinkingLabel = THINKING_LABELS[thinkingLevel] ?? thinkingLevel
  $: thinkingPercent = THINKING_LEVELS.length > 1 ? thinkingIndex / (THINKING_LEVELS.length - 1) : 0
  $: if (typeof document !== 'undefined') document.body.classList.toggle('resizing', dragging !== null)

  let processSeq = 0

  function emptySlot(): RunSlot {
    return { reply: '', thinking: '', tool: '', phase: 'idle', running: false, queue: [], steer: [], sent: [], subRuns: [], process: [], processOpen: false }
  }

  function brief(value: unknown) {
    if (value == null) return ''
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > 220 ? `${text.slice(0, 220)}…` : text
  }

  function liveLabel(slot: RunSlot) {
    if (!slot.running) return ''
    if (slot.confirm || slot.phase === 'waiting') return 'Waiting'
    if (slot.phase === 'thinking') return 'Thinking'
    if (slot.phase === 'writing') return 'Writing'
    return 'Working'
  }

  function processSummary(slot: RunSlot) {
    const thinks = slot.process.filter((step) => step.kind === 'think').length
    const tools = slot.process.filter((step) => step.kind === 'tool').length
    const parts = []
    if (thinks) parts.push(`思考 ${thinks}`)
    if (tools) parts.push(`工具 ${tools}`)
    return parts.length ? `过程 · ${parts.join(' · ')}` : '过程'
  }

  function closeOpenSteps(steps: ProcessStep[]) {
    return steps.map((step) => step.done ? step : { ...step, done: true })
  }

  function appendThink(id: string, text: string) {
    const slot = slotFor(id)
    const steps = [...slot.process]
    const last = steps[steps.length - 1]
    if (last?.kind === 'think' && !last.done) steps[steps.length - 1] = { ...last, body: last.body + text }
    else steps.push({ id: `think-${++processSeq}`, kind: 'think', title: '思考', body: text, done: false })
    patchSlot(id, { process: steps, processOpen: true, phase: 'thinking', thinking: slot.thinking + text })
  }

  function startToolStep(id: string, toolName: string, toolCallId: string, args: unknown) {
    const slot = slotFor(id)
    const steps = closeOpenSteps(slot.process)
    steps.push({ id: toolCallId || `tool-${++processSeq}`, kind: 'tool', title: toolName || '工具', body: brief(args), done: false })
    patchSlot(id, { process: steps, processOpen: true, phase: 'working', tool: `正在执行 ${toolName || '工具'}…` })
  }

  function endToolStep(id: string, toolName: string, toolCallId: string, result: unknown, isError?: boolean) {
    const slot = slotFor(id)
    const extra = brief(result)
    const steps = slot.process.map((step) => {
      const hit = (toolCallId && step.id === toolCallId) || (!toolCallId && step.kind === 'tool' && !step.done && step.title === (toolName || step.title))
      if (!hit) return step
      return { ...step, done: true, body: [step.body, extra].filter(Boolean).join(String.fromCharCode(10)) }
    })
    patchSlot(id, { process: steps, tool: `${toolName || '工具'}${isError ? ' 失败' : ' 已完成'}` })
  }

  function slotFor(id: string): RunSlot {
    return { ...emptySlot(), ...runState[id] }
  }

  // 整体替换 runState，保证 Svelte 检测到变化
  function patchSlot(id: string, patch: Partial<RunSlot>) {
    runState = { ...runState, [id]: { ...emptySlot(), ...runState[id], ...patch } }
  }

  $: if (activeSessionId) todos = loadTodos(activeSessionId)
  $: todoView = todoTree(todos)

  function persistTodos(next: TodoItem[]) {
    todos = next
    saveTodos(activeSessionId, next)
  }

  function addTodo(parentId?: string) {
    const content = todoDraft.trim()
    if (!content) return
    persistTodos([...todos, newTodo(content, parentId || undefined)])
    todoDraft = ''
    todoParentId = ''
  }

  function setTodoStatus(id: string, status: TodoStatus) {
    persistTodos(todos.map((item) => item.id === id ? { ...item, status } : item))
  }

  function removeTodo(id: string) {
    persistTodos(todos.filter((item) => item.id !== id && item.parentId !== id))
  }

  function finishSubRun(id: string, status: SubRun['status']) {
    const reply = slotFor(id).reply
    for (const [parentId, slot] of Object.entries(runState)) {
      if (!slot.subRuns?.some((run) => run.id === id)) continue
      patchSlot(parentId, {
        subRuns: slot.subRuns.map((run) => run.id === id ? { ...run, status, reply } : run)
      })
    }
    if (viewingSub?.id === id) viewingSub = { ...viewingSub, status, reply }
  }

  function recallMessage(index: number) {
    const slot = slotFor(activeSessionId)
    const message = slot.sent[index]
    if (!message) return
    if (slot.running) stop()
    inputText = message.text
    mention = null
    patchSlot(activeSessionId, { sent: slot.sent.slice(0, index), reply: '', thinking: '', tool: '', queue: [], process: [], processOpen: false, phase: 'idle' })
    window.setTimeout(() => composerInput?.focus(), 0)
  }

  async function spawnSubagent(agentName: string, task: string) {
    const def = findAgent(agentName) ?? findAgent('scout')
    if (!def || !task.trim()) return
    const parentId = ensureActiveId()
    const childId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const run: SubRun = { id: childId, agent: def.name, task: task.trim(), status: 'running', reply: '' }
    patchSlot(parentId, { subRuns: [...slotFor(parentId).subRuns, run] })
    sessions = [{ id: childId, title: `${def.name} · ${task.trim().slice(0, 24)}`, time: '刚刚', parentId, readOnly: true, mode: def.mode }, ...sessions]
    if (!sidecarReady) {
      window.setTimeout(() => finishSubRun(childId, 'done'), 800)
      return
    }
    try {
      const created = await request('create_session', { sessionId: childId, cwd: workspacePath, mode: def.mode, thinking: 'low' }) as { id: string; file?: string }
      remember(childId, { file: created.file, mode: def.mode, readOnly: true, parentId })
      await request('prompt', { sessionId: childId, text: wrapTask(def, task), cwd: workspacePath, behavior: 'steer', mode: def.mode })
    } catch {
      finishSubRun(childId, 'error')
    }
  }

  function runSplit() {
    const jobs = splitRows.map((row) => ({ agent: row.agent.trim() || 'scout', task: row.task.trim() })).filter((row) => row.task)
    splitOpen = false
    splitRows = [{ agent: 'scout', task: '' }]
    for (const job of jobs) void spawnSubagent(job.agent, job.task)
  }

  function markSession(id: string, state: 'active' | 'done') {
    sessions = sessions.map((item) => (item.id === id ? { ...item, state } : item))
  }

  // 记住会话级的模型 / 思考档位选择；无记录时建占位会话
  function remember(id: string, patch: Partial<Session>) {
    if (!id) return
    if (!sessions.some((item) => item.id === id)) sessions = [{ id, title: '新会话', time: '刚刚', ...patch }, ...sessions]
    else sessions = sessions.map((item) => (item.id === id ? { ...item, ...patch } : item))
  }

  function ensureActiveId() {
    if (!activeSessionId) {
      activeSessionId = `session-${Date.now()}`
      activeSession = '新会话'
    }
    return activeSessionId
  }

  function modelKey(model: ModelInfo) {
    return `${model.provider}${MODEL_SEPARATOR}${model.id}`
  }

  function modelGroups(list: ModelInfo[]) {
    const groups: Array<{ provider: string; items: ModelInfo[] }> = []
    for (const model of list) {
      const group = groups.find((item) => item.provider === model.provider)
      if (group) group.items.push(model)
      else groups.push({ provider: model.provider, items: [model] })
    }
    return groups
  }

  // 无会话记忆时回退到模型列表第一项
  function modelChoice(list: ModelInfo[], records: Session[], id: string) {
    const remembered = records.find((item) => item.id === id)?.model
    if (remembered && list.some((model) => modelKey(model) === remembered)) return remembered
    return list.length ? modelKey(list[0]) : ''
  }

  function thinkingChoice(records: Session[], id: string) {
    return records.find((item) => item.id === id)?.thinking ?? DEFAULT_THINKING
  }

  function sessionMode(records: Session[], id: string) {
    return records.find((item) => item.id === id)?.mode ?? 'ask'
  }

  function workspaceBase() {
    if (workspacePath === '.') return '当前目录'
    return workspacePath.split(/[\\/]/).pop() || workspacePath
  }

  function workspaceLabel() {
    return workspacePath === '.' ? '选择工作区' : workspaceBase()
  }

  function statusDotTitle(session: Session) {
    if (session.state === 'active') return '运行中'
    if (session.state === 'done') return '已完成'
    return '空闲'
  }

  function openSessionMenu(event: MouseEvent, session: Session) {
    event.preventDefault()
    const width = 190
    const height = 360
    sessionMenu = {
      session,
      x: Math.min(event.clientX, window.innerWidth - width - 8),
      y: Math.min(event.clientY, window.innerHeight - height - 8)
    }
  }

  function togglePin(session: Session) {
    sessions = sessions.map((item) => item.id === session.id ? { ...item, pinned: !item.pinned } : item)
    sessionMenu = null
  }

  async function renameSession(session: Session) {
    sessionMenu = null
    const name = window.prompt('重命名会话', session.title)?.trim()
    if (!name || name === session.title) return
    sessions = sessions.map((item) => item.id === session.id ? { ...item, title: name } : item)
    if (sidecarReady && session.file) await request('rename_session', { sessionId: session.id, name })
    if (activeSessionId === session.id) activeSession = name
  }

  function archiveSession(session: Session) {
    sessions = sessions.map((item) => item.id === session.id ? { ...item, archived: true } : item)
    if (activeSessionId === session.id) {
      const next = sessions.find((item) => !item.archived && !item.parentId && item.id !== session.id)
      if (next) void selectSession(next)
      else {
        activeSessionId = ''
        activeSession = '新会话'
      }
    }
    sessionMenu = null
  }

  function tabTitle(session: Session) {
    return session.title === '新会话' || !session.title ? 'Pi-My agent' : session.title
  }

  async function closeTab(session: Session) {
    if (slotFor(session.id).running) {
      if (sidecarReady) await request('abort', { sessionId: session.id }).catch(() => {})
      patchSlot(session.id, { running: false, phase: 'idle' })
    }
    const rest = sessions.filter((item) => item.id !== session.id)
    sessions = rest
    if (runState[session.id]) {
      const nextState = { ...runState }
      delete nextState[session.id]
      runState = nextState
    }
    if (activeSessionId !== session.id) return
    const next = rest.find((item) => !item.archived && !item.parentId)
    if (next) await selectSession(next)
    else {
      activeSessionId = ''
      activeSession = '新会话'
    }
  }

  function chooseSessionModel(session: Session) {
    sessionMenu = null
    void selectSession(session).then(() => { modelOpen = true })
  }

  function copySessionValue(value: string) {
    void navigator.clipboard?.writeText(value)
    sessionMenu = null
  }

  async function exportSession(session: Session) {
    let data = JSON.stringify({ id: session.id, title: session.title, file: session.file, workspace: workspacePath }, null, 2)
    if (sidecarReady && session.file) {
      const response = await requestRaw('export_session', { sessionId: session.id, file: session.file })
      if (response.ok && response.result && typeof response.result === 'object' && 'content' in response.result) {
        data = String((response.result as { content: unknown }).content)
      }
    }
    const blob = new Blob([data], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${session.title || session.id}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    sessionMenu = null
  }

  function isIdle(id: string) {
    const slot = slotFor(id)
    return !slot.sent.length && !slot.reply && !slot.running && !slot.queue.length && !slot.process.length
  }

  function documentStats() {
    if (!selectedFile) return ''
    const lines = fileContent ? fileContent.split('\n').length : 0
    const kb = Math.max(1, Math.ceil(new TextEncoder().encode(fileContent).length / 1024))
    return `${lines} 行 · ${kb} KB`
  }

  function clickOutside(node: HTMLElement) {
    function onMouseDown(event: MouseEvent) {
      if (!node.contains(event.target as Node)) modelOpen = false
    }
    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') modelOpen = false
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeydown)
    return {
      destroy() {
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('keydown', onKeydown)
      }
    }
  }

  function clickOutsideCtx(node: HTMLElement) {
    function onMouseDown(event: MouseEvent) {
      if (!node.contains(event.target as Node)) ctxOpen = false
    }
    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') ctxOpen = false
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeydown)
    return {
      destroy() {
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('keydown', onKeydown)
      }
    }
  }

  function clickOutsideThinking(node: HTMLElement) {
    function onMouseDown(event: MouseEvent) {
      if (!node.contains(event.target as Node)) thinkingOpen = false
    }
    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') thinkingOpen = false
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeydown)
    return {
      destroy() {
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('keydown', onKeydown)
      }
    }
  }

  function clickOutsideMode(node: HTMLElement) {
    function onMouseDown(event: MouseEvent) {
      if (!node.contains(event.target as Node)) modeOpen = false
    }
    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') modeOpen = false
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeydown)
    return {
      destroy() {
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('keydown', onKeydown)
      }
    }
  }

  function clickOutsideKind(node: HTMLElement) {
    function onMouseDown(event: MouseEvent) {
      if (!node.contains(event.target as Node)) kindOpen = false
    }
    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') kindOpen = false
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeydown)
    return {
      destroy() {
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('keydown', onKeydown)
      }
    }
  }

  function toggleKind() {
    kindOpen = !kindOpen
    if (kindOpen) {
      modeOpen = false
      modelOpen = false
      thinkingOpen = false
      ctxOpen = false
    }
  }

  function toggleMore() {
    moreOpen = !moreOpen
    if (moreOpen) { kindOpen = false; modeOpen = false; modelOpen = false; thinkingOpen = false; ctxOpen = false }
  }

  function clickOutsideMore(node: HTMLElement) {
    function onMouseDown(event: MouseEvent) {
      if (!node.contains(event.target as Node)) moreOpen = false
    }
    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') moreOpen = false
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeydown)
    return {
      destroy() {
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('keydown', onKeydown)
      }
    }
  }

  function setAgentKind(next: boolean) {
    imageGenMode = next
    imageGenError = ''
    kindOpen = false
  }

  function toggleMode() {
    modeOpen = !modeOpen
    if (modeOpen) {
      kindOpen = false
      modelOpen = false
      thinkingOpen = false
      ctxOpen = false
      const rect = modeButtonRef?.getBoundingClientRect()
      if (rect) modeMenuUp = window.innerHeight - rect.bottom < 220
    }
  }

  async function setMode(mode: string) {
    modeOpen = false
    if (!mode) return
    const id = ensureActiveId()
    remember(id, { mode })
    if (!sidecarReady || !sessions.some((item) => item.id === id && item.file)) return
    await request('set_mode', { sessionId: id, mode })
  }

  function toggleThinking() {
    thinkingOpen = !thinkingOpen
    thinkingDraft = ''
    if (thinkingOpen) {
      thinkingHelp = false
      modelOpen = false
      modeOpen = false
      ctxOpen = false
      kindOpen = false
      const rect = thinkingButtonRef?.getBoundingClientRect()
      if (rect) thinkingMenuUp = window.innerHeight - rect.bottom < 220
    }
  }

  function clampWidth(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
  }

  function startDrag(event: MouseEvent, side: 'right') {
    event.preventDefault()
    dragging = side
    dragStartX = event.clientX
    dragStartWidth = rightWidth
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', stopDrag)
  }

  function onDragMove(event: MouseEvent) {
    if (!dragging) return
    const delta = event.clientX - dragStartX
    rightWidth = clampWidth(dragStartWidth - delta, 240, 480)
  }

  function stopDrag() {
    dragging = null
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup', stopDrag)
  }

  function resetDrag(side: 'right') {
    rightWidth = 280
  }

  // 窗口变窄时收回侧栏宽度，避免左/右栏与聊天区合计超出窗口
  function clampToViewport() {
    if (window.innerWidth <= 1050) return
    const grid = document.querySelector('.window') as HTMLElement | null
    const total = grid?.clientWidth ?? window.innerWidth
    let left = showLeft ? 220 : 0
    let right = showRight ? rightWidth : 0
    let overflow = left + right + 430 - total
    if (overflow <= 0) return
    const rightCut = Math.min(overflow, Math.max(0, right - 240))
    right -= rightCut
    if (showRight) rightWidth = right
  }

  onDestroy(() => {
    stopDrag()
    window.removeEventListener('resize', clampToViewport)
    if (typeof document !== 'undefined') document.body.classList.remove('resizing')
  })

  function toggleCtx() {
    ctxOpen = !ctxOpen
    if (ctxOpen) {
      modelOpen = false
      thinkingOpen = false
      modeOpen = false
      kindOpen = false
      const rect = ctxButtonRef?.getBoundingClientRect()
      if (rect) ctxMenuUp = window.innerHeight - rect.bottom < 320
      void refreshCtxStats()
    }
  }

  async function refreshCtxStats() {
    if (!sidecarReady || !activeSessionId) return
    try {
      ctxStats = (await request('session_stats', { sessionId: activeSessionId }) as CtxStats) ?? { ...EMPTY_CTX }
    } catch {
      ctxStats = { ...EMPTY_CTX }
    }
  }

  function ctxProgress() {
    if (!ctxStats?.window) return 0
    return Math.max(0, Math.min(100, Math.round((ctxStats.currentContext / ctxStats.window) * 100)))
  }

  function ctxDash() {
    const length = (CTX_CIRC * ctxProgress()) / 100
    return `${length.toFixed(2)} ${CTX_CIRC.toFixed(2)}`
  }

  function fmtWan(value: number) {
    if (!Number.isFinite(value) || value < 10000) return String(value)
    return `${(value / 10000).toFixed(0)}万`
  }

  function toggleModel() {
    modelOpen = !modelOpen
    if (modelOpen) {
      thinkingOpen = false
      modeOpen = false
      ctxOpen = false
      kindOpen = false
      modelQuery = ''
      const rect = modelButtonRef?.getBoundingClientRect()
      if (rect) modelMenuUp = window.innerHeight - rect.bottom < 360
      window.setTimeout(() => modelSearchInput?.focus(), 0)
    }
  }

  async function setModel(value: string) {
    if (!value || !sidecarReady) return
    const id = ensureActiveId()
    remember(id, { model: value })
    if (!sessions.some((item) => item.id === id && item.file)) return
    const [provider, modelId] = value.split(MODEL_SEPARATOR)
    const result = await request('set_model', { sessionId: id, provider, modelId }) as { provider: string; id: string; thinkingLevel?: string } | null
    if (result) remember(id, { model: `${result.provider}${MODEL_SEPARATOR}${result.id}`, thinking: result.thinkingLevel ?? thinkingChoice(sessions, id) })
    else remember(id, { model: undefined })
  }

  function pickModel(model: ModelInfo) {
    modelOpen = false
    modelQuery = ''
    void setModel(modelKey(model))
  }

  async function setThinking(level: string) {
    if (!level || !sidecarReady) return
    const id = ensureActiveId()
    remember(id, { thinking: level })
    if (!sessions.some((item) => item.id === id && item.file)) return
    const result = await request('set_thinking', { sessionId: id, level }) as { level?: string } | null
    // setThinkingLevel 会按模型能力 clamp，以 sidecar 回传的实际档位为准
    remember(id, { thinking: result?.level })
  }

  // 拖动中只更新本地 draft，松手（change）才提交，避免频繁请求 sidecar
  function onThinkingInput(event: Event) {
    const level = THINKING_LEVELS[Number((event.currentTarget as HTMLInputElement).value)]
    if (level) thinkingDraft = level
  }

  function onThinkingChange(event: Event) {
    const level = THINKING_LEVELS[Number((event.currentTarget as HTMLInputElement).value)]
    thinkingDraft = ''
    if (level) void setThinking(level)
  }

  function toggleThinkingHelp() {
    thinkingHelp = !thinkingHelp
  }

  function request(type: string, payload = {}) {
    const id = ++requestSequence
    const promise = new Promise<unknown>((resolve) => pending.set(id, (res) => resolve(res.result)))
    void invoke('agent_request', { request: { id, type, payload } })
    return promise
  }

  function requestRaw(type: string, payload = {}) {
    const id = ++requestSequence
    const promise = new Promise<SidecarResponse>((resolve) => pending.set(id, resolve))
    void invoke('agent_request', { request: { id, type, payload } })
    return promise
  }

  onMount(async () => {
    loadImageGenConfig()
    refreshPrefs()
    window.addEventListener('resize', clampToViewport)
    clampToViewport()
    const unlisten = await listen<AgentEnvelope>('agent-message', ({ payload }) => {
      if (payload.type === 'response' && payload.id) {
        pending.get(payload.id)?.(payload)
        pending.delete(payload.id)
      }
      if (payload.type === 'confirm_request') {
        patchSlot(payload.sessionId || activeSessionId, { phase: 'waiting', confirm: { confirmId: String(payload.confirmId ?? ''), toolName: String(payload.toolName ?? ''), summary: String(payload.summary ?? '') } })
        if (loadPrefs().notifyConfirm) desktopNotify('Pi-My', '需要确认工具调用')
      }
      if (payload.type === 'login_event') {
        const ev = payload.event
        const provider = String(payload.provider ?? loginState?.provider ?? '')
        if (ev.type === 'device_code') {
          loginState = { provider, status: '等待授权…', userCode: String(ev.userCode ?? ''), verificationUri: String(ev.verificationUri ?? ''), value: '' }
          if (ev.verificationUri) openLoginUrl(String(ev.verificationUri))
        } else if (ev.type === 'auth_url') {
          loginState = { provider, status: String(ev.instructions || '请在浏览器完成授权'), value: '' }
          openLoginUrl(String(ev.url ?? ''))
        } else if (ev.type === 'progress' || ev.type === 'info') {
          loginState = { provider, status: String(ev.message ?? ''), userCode: loginState?.userCode, verificationUri: loginState?.verificationUri, value: loginState?.value ?? '' }
        }
      }
      if (payload.type === 'login_prompt') {
        const prompt = payload.prompt
        if (!prompt) return
        loginState = {
          provider: String(payload.provider ?? loginState?.provider ?? ''),
          status: '需要输入',
          userCode: loginState?.userCode,
          verificationUri: loginState?.verificationUri,
          prompt: { promptId: String(payload.promptId), type: String(prompt.type), message: String(prompt.message), placeholder: prompt.placeholder ? String(prompt.placeholder) : undefined, options: Array.isArray(prompt.options) ? prompt.options : undefined },
          value: ''
        }
      }
      if (payload.type === 'event') {
        const event = payload.event
        if (!event) return
        const id = payload.sessionId || activeSessionId
        const slot = slotFor(id)
        if (event.type === 'message_update') {
          if (event.thinking) appendThink(id, String(event.thinking))
          if (event.delta) {
            const current = slotFor(id)
            patchSlot(id, { reply: current.reply + event.delta, phase: 'writing', process: closeOpenSteps(current.process) })
          }
        }
        if (event.type === 'tool_execution_start') startToolStep(id, String(event.toolName || '工具'), String(event.toolCallId || ''), event.args)
        if (event.type === 'tool_execution_update' && event.partialResult) {
          const current = slotFor(id)
          const callId = String(event.toolCallId || '')
          patchSlot(id, {
            process: current.process.map((step) => step.id === callId || (!callId && step.kind === 'tool' && !step.done) ? { ...step, body: brief(event.partialResult) } : step)
          })
        }
        if (event.type === 'tool_execution_end') endToolStep(id, String(event.toolName || '工具'), String(event.toolCallId || ''), event.result, Boolean(event.isError))
        if (event.type === 'agent_start') { patchSlot(id, { running: true, phase: 'working', processOpen: true }); markSession(id, 'active') }
        if (event.type === 'agent_end' || event.type === 'error') {
          const current = slotFor(id)
          patchSlot(id, { running: false, phase: 'idle', tool: '', confirm: undefined, steer: [], process: closeOpenSteps(current.process), processOpen: false })
          markSession(id, 'done')
          finishSubRun(id, event.type === 'error' ? 'error' : 'done')
          void refreshCtxStats()
          if (event.type === 'agent_end' && loadPrefs().notifyDone && !sessions.find((item) => item.id === id)?.parentId) desktopNotify('Pi-My', '任务已完成')
          if (event.type === 'agent_end') window.setTimeout(() => drainQueue(id), 40)
        }
      }
    })
    try {
      const startup = loadPrefs()
      const startupCwd = startup.restoreWorkspace && startup.lastWorkspace ? startup.lastWorkspace : '.'
      await request('init', { cwd: startupCwd })
      if (startupCwd !== '.') workspacePath = startupCwd
      sidecarReady = true
      void refreshPetStatus()
      models = (await request('list_models') as ModelInfo[]) ?? []
      await loadFiles()
      await refreshGit()
      const loaded = await request('list_sessions', { cwd: startupCwd }) as Array<{ id: string; title: string; file: string; modifiedAt: number }>
      if (loaded?.length) {
        sessions = loaded.map((item) => ({ id: item.id, title: item.title, file: item.file, time: new Date(item.modifiedAt).toLocaleDateString() }))
        activeSessionId = sessions[0].id
        activeSession = sessions[0].title
      }
      void refreshCtxStats()

    } catch {
      // Browser preview mode remains useful without the native sidecar.
    }
    return unlisten
  })

  async function loadFiles(cwd = workspacePath) {
    if (!sidecarReady) return
    files = await request('list_files', { cwd }) as Array<{ path: string; kind: 'file' | 'directory' }>
  }

  async function chooseWorkspace() {
    const selected = await open({ directory: true, multiple: false, title: '选择 Pi Agent 项目' })
    if (typeof selected !== 'string') return
    workspacePath = selected
    selectedFile = ''
    fileContent = ''
    uiPrefs = patchPrefs({ lastWorkspace: selected })
    await request('set_workspace', { cwd: selected })
    await loadFiles(selected)
    await refreshGit()

  }

  async function refreshGit() {
    if (!sidecarReady) return
    gitChanges = await request('git_status', { cwd: workspacePath }) as GitChange[]
  }

  async function loadDiff(file: string) {
    if (!sidecarReady) return
    diffContent = await request('git_diff', { cwd: workspacePath, path: file }) as string
    panel = '变更'
  }

  function isStaged(code: string) {
    return code[0] !== ' ' && code[0] !== '?'
  }

  async function runGit(type: string, payload: Record<string, unknown>) {
    gitError = ''
    const res = await requestRaw(type, payload)
    if (!res.ok) {
      gitError = res.error || '操作失败'
      return false
    }
    commitMessage = ''
    staged = {}
    await refreshGit()
    return true
  }

  async function stageFiles() {
    const paths = gitChanges.filter((change) => (staged[change.path] ?? false) && !isStaged(change.code)).map((change) => change.path)
    if (!paths.length) return
    const ok = await confirm(`确认暂存勾选的 ${paths.length} 个文件？`, { title: '暂存更改', kind: 'warning' })
    if (!ok) return
    await runGit('git_add', { cwd: workspacePath, paths })
  }

  async function commitChanges() {
    const message = commitMessage.trim() || loadPrefs().gitTemplate.trim()
    if (!message) return
    const stagedCount = gitChanges.filter((change) => isStaged(change.code)).length
    const ok = await confirm(`确认提交「${message}」？将提交当前全部已暂存的 ${stagedCount} 个文件。`, { title: '提交更改', kind: 'warning' })
    if (!ok) return
    await runGit('git_commit', { cwd: workspacePath, message })
  }

  async function pushChanges() {
    const ok = await confirm('确认将本地提交推送到远程仓库？', { title: '推送', kind: 'warning' })
    if (!ok) return
    await runGit('git_push', { cwd: workspacePath })
  }

  async function saveFile() {
    if (!selectedFile || !sidecarReady) return
    await request('write_file', { cwd: workspacePath, path: selectedFile, content: fileContent })
    editingFile = false
    await refreshGit()
  }
  async function previewFile(file: string) {
    selectedFile = file
    editingFile = false
    if (sidecarReady) {
      const result = await request('read_file', { cwd: workspacePath, path: file }) as { content: string }
      fileContent = result.content
      panel = '文档'
    }
  }
  async function selectSession(session: Session) {
    if (session.parentId) {
      const run = slotFor(session.parentId).subRuns.find((item) => item.id === session.id)
      viewingSub = run ?? { id: session.id, agent: session.title, task: session.title, status: session.state === 'active' ? 'running' : 'done', reply: slotFor(session.id).reply }
      return
    }
    activeSessionId = session.id
    activeSession = session.title
    todos = loadTodos(session.id)
    if (sidecarReady && session.file) await request('open_session', { sessionId: session.id, file: session.file })
    void refreshCtxStats()
  }

  function openDir(path: string) {
    if (sidecarReady && path) void request('open_dir', { path })
  }

  function openLoginUrl(url: string) {
    if (!url) return
    if (sidecarReady) void request('open_url', { url })
    else window.open(url, '_blank')
  }

  function submitLoginPrompt() {
    if (!loginState?.prompt) return
    const { promptId } = loginState.prompt
    void request('login_prompt_response', { promptId, value: loginState.value })
    loginState = { ...loginState, prompt: undefined, value: '', status: '等待授权…' }
  }

  function cancelLogin() {
    if (loginState?.prompt) void request('login_prompt_response', { promptId: loginState.prompt.promptId, cancelled: true })
    loginState = null
  }

  async function refreshPetStatus() {
    if (!sidecarReady) return
    try { petStatus = await request('eco_pet_status', {}) as { base: string; pets: Array<{ id: string; model: string | null }> } } catch { petStatus = { base: '', pets: [] } }
  }

  function currentPetUrl() {
    if (!uiPrefs.petModel) return ''
    const pet = petById(uiPrefs.petModel)
    if (!pet) return ''
    const local = petStatus.pets.find((item) => item.id === pet.id)
    if (local?.model && petStatus.base) return `${petStatus.base}/${local.model}`
    return petModelUrl(pet)
  }

  async function addAttachments() {
    if (!sidecarReady) return
    attachError = ''
    const selected = await open({ multiple: true, title: '添加附件' })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    for (const path of paths) {
      const res = await requestRaw('read_attachment', { cwd: workspacePath, path })
      if (!res.ok) {
        attachError = res.error || '附件读取失败'
        continue
      }
      attachments = [...attachments, res.result as { kind: 'image' | 'text'; name: string; mimeType?: string; data?: string; content?: string }]
    }
  }

  function removeAttachment(index: number) {
    attachments = attachments.filter((_, itemIndex) => itemIndex !== index)
  }

  function loadImageGenConfig() {
    try { imageGenConfig = { ...imageGenConfig, ...JSON.parse(localStorage.getItem('pdn.imagegen') ?? '{}') } } catch { /* 使用空配置 */ }
  }

  function saveImageGenConfig(next: ImageGenConfig) {
    imageGenConfig = next
    localStorage.setItem('pdn.imagegen', JSON.stringify(next))
  }

  async function generateImage() {
    const prompt = inputText.trim()
    if (!prompt || imageGenBusy) return
    imageGenError = ''
    imageGenBusy = true
    try {
      const result = await request('generate_image', { ...imageGenConfig, prompt }) as { data?: string; mimeType?: string; url?: string }
      const src = result.data ? `data:${result.mimeType || 'image/png'};base64,${result.data}` : result.url
      if (!src) throw new Error('生图服务未返回图片')
      imageGenResult = { src, prompt }
      inputText = ''
    } catch (error) { imageGenError = error instanceof Error ? error.message : String(error) }
    finally { imageGenBusy = false }
  }


  function answerConfirm(ok: boolean) {
    const id = activeSessionId
    const confirm = runState[id]?.confirm
    if (!confirm) return
    patchSlot(id, { confirm: undefined })
    if (sidecarReady) void request('confirm_response', { confirmId: confirm.confirmId, ok })
  }

  async function refreshProviders() {
    if (!sidecarReady) return
    providers = await request('list_providers', {}) as typeof providers
    models = (await request('list_models') as ModelInfo[]) ?? models
  }

  async function refreshUsage() {
    if (!sidecarReady) return
    try { usageStats = await request('usage_stats', { cwd: workspacePath }) as UsageStats } catch { usageStats = null }
  }

  async function openSettings() {
    showSettings = true
    if (sidecarReady) {
      try {
        settingsInfo = await request('info') as SettingsInfo
        if (settingsInfo?.providers) providers = settingsInfo.providers
        await refreshUsage()
      } catch {
        settingsInfo = null
      }
    }
  }

  // 首次发送时用文本前 20 字自动命名「新会话」；返回新标题用于持久化。
  function maybeAutoTitle(id: string, text: string) {
    if (!loadPrefs().autoName) return null
    const session = sessions.find((item) => item.id === id)
    if (!session || (session.title && session.title !== '新会话')) return null
    const title = text.length > 20 ? `${text.slice(0, 20)}…` : text
    sessions = sessions.map((item) => (item.id === id ? { ...item, title } : item))
    if (activeSessionId === id) activeSession = title
    return title
  }

  function submit(behavior: 'steer' | 'followUp' = 'steer') {
    const text = inputText.trim()
    if (!text) return
    const scout = text.match(/^\/scout(?:\s+|$)(.*)$/i)
    if (scout) {
      inputText = ''
      mention = null
      if (scout[1].trim()) void spawnSubagent('scout', scout[1])
      else { splitOpen = true; agentDefs = loadAgents(); splitRows = [{ agent: 'scout', task: '' }] }
      return
    }
    const agentCmd = text.match(/^\/agent\s+(\S+)\s+(.+)$/i)
    if (agentCmd) {
      inputText = ''
      mention = null
      void spawnSubagent(agentCmd[1], agentCmd[2])
      return
    }
    const todoCmd = text.match(/^\/todo(?:\s+|$)(.*)$/i)
    if (todoCmd) {
      inputText = ''
      mention = null
      if (todoCmd[1].trim()) {
        persistTodos([...loadTodos(ensureActiveId()), newTodo(todoCmd[1])])
        panel = '待办'
        showRight = true
      } else { panel = '待办'; showRight = true }
      return
    }
    if (text === '/split') {
      inputText = ''
      mention = null
      splitOpen = true
      agentDefs = loadAgents()
      return
    }
    const slash = SLASH.find((item) => text === `/${item.id}` || text === `/${item.label}`)
    if (slash) {
      inputText = ''
      mention = null
      if (slash.id === 'new') void newSession()
      else if (slash.id === 'settings' || slash.id === 'login') void openSettings()
      else if (slash.id === 'todo') { panel = '待办'; showRight = true }
      else if (slash.id === 'plan') void setMode('plan')
      else if (slash.id === 'scout' || slash.id === 'split') { splitOpen = true; agentDefs = loadAgents() }
      else void chooseWorkspace()
      return
    }
    const id = ensureActiveId()
    const slot = slotFor(id)
    inputText = ''
    mention = null
    if (slot.running && behavior === 'followUp') {
      patchSlot(id, { queue: [...slot.queue, text] })
      return
    }
    if (slot.running && behavior === 'steer') {
      const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      patchSlot(id, { sent: [...slot.sent, { text, at }], steer: [...slot.steer, text] })
      if (sidecarReady) void request('prompt', { sessionId: id, text, cwd: workspacePath, behavior: 'steer' })
      return
    }
    dispatchTurn(id, text, behavior)
  }

  function dispatchTurn(id: string, text: string, behavior: 'steer' | 'followUp') {
    const slot = slotFor(id)
    const newTitle = maybeAutoTitle(id, text)
    patchSlot(id, {
      sent: [...slot.sent, { text, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }],
      reply: '',
      thinking: '',
      tool: '',
      running: true,
      phase: 'working',
      process: [],
      processOpen: true
    })
    if (sidecarReady) {
      const pendingFiles = attachments
      attachments = []
      attachError = ''
      void (async () => {
        const rec = sessions.find((item) => item.id === id)
        if (!rec?.file) {
          const defaults = loadPrefs()
          const rawThinking = rec?.thinking ?? defaults.thinking
          const payload: Record<string, unknown> = { sessionId: id, cwd: workspacePath, mode: rec?.mode ?? defaults.mode }
          if (rawThinking && THINKING_LEVELS.includes(rawThinking)) payload.thinking = rawThinking
          const created = await request('create_session', payload) as { id: string; file?: string } | null
          if (created?.file) remember(id, { file: created.file })
          const model = sessions.find((item) => item.id === id)?.model
          if (model) {
            const [provider, modelId] = model.split(MODEL_SEPARATOR)
            await request('set_model', { sessionId: id, provider, modelId })
          }
        }
        const extra = [] as typeof pendingFiles
        for (const name of [...text.matchAll(/(?:^|\s)@([^\s]+)/g)].map((item) => item[1])) {
          const hit = files.find((file) => file.kind === 'file' && (file.path === name || fileName(file.path) === name))
          if (!hit || extra.concat(pendingFiles).some((file) => file.name === fileName(hit.path))) continue
          const res = await requestRaw('read_attachment', { cwd: workspacePath, path: hit.path })
          if (res.ok) extra.push(res.result as typeof pendingFiles[number])
        }
        const outgoing = [...pendingFiles, ...extra]
        const bridged = [] as typeof pendingFiles
        for (const file of outgoing) {
          if (file.kind !== 'image' || !file.data) { bridged.push(file); continue }
          try {
            const vision = await request('vision_describe', { data: file.data, mimeType: file.mimeType }) as { skipped?: boolean; description?: string }
            if (vision?.skipped || !vision?.description) bridged.push(file)
            else bridged.push({ kind: 'text', name: `${file.name}.vision.txt`, content: `[视觉桥] ${file.name}\n${vision.description}` })
          } catch {
            bridged.push(file)
          }
        }
        await request('prompt', { sessionId: id, text, cwd: workspacePath, behavior, attachments: bridged })
      })()
        .then(() => { if (newTitle) void request('rename_session', { sessionId: id, name: newTitle }) })
        .catch(() => patchSlot(id, { running: false, phase: 'idle' }))
    } else {
      window.setTimeout(() => patchSlot(id, { running: false, phase: 'idle' }), 1400)
    }
  }

  function drainQueue(id: string) {
    const slot = slotFor(id)
    if (slot.running || !slot.queue.length) return
    const [text, ...rest] = slot.queue
    patchSlot(id, { queue: rest })
    dispatchTurn(id, text, 'steer')
  }

  function moveQueue(index: number, dir: -1 | 1) {
    const slot = slotFor(activeSessionId)
    const next = [...slot.queue]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    const swap = next[index]
    next[index] = next[target]
    next[target] = swap
    patchSlot(activeSessionId, { queue: next })
  }

  function removeQueue(index: number) {
    const slot = slotFor(activeSessionId)
    patchSlot(activeSessionId, { queue: slot.queue.filter((_, i) => i !== index) })
  }

  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
  }

  async function forkFrom(index: number) {
    const history = slotFor(activeSessionId).sent.slice(0, index + 1)
    if (!history.length) return
    await newSession()
    const id = activeSessionId
    const nl = String.fromCharCode(10)
    const brief = history.map((item) => `用户：${item.text}`).join(nl + nl)
    patchSlot(id, { sent: history.map((item) => ({ ...item })) })
    dispatchTurn(id, `从以下对话分叉继续，请按此上下文接着做：` + nl + nl + brief, 'steer')
  }

  function stop() {
    const id = activeSessionId
    if (!sidecarReady) { patchSlot(id, { running: false, phase: 'idle' }); return }
    void request('abort', { sessionId: id }).finally(() => patchSlot(id, { running: false, phase: 'idle' }))
  }

  function quickPrompt(text: string) {
    inputText = text
    composerInput?.focus()
  }

  async function newSession() {
    if (!sidecarReady) {
      const draftId = `draft-${Date.now()}`
      activeSession = '新会话'
      activeSessionId = draftId
      sessions = [{ id: draftId, title: '新会话', time: '刚刚' }, ...sessions]
      leftTab = 'Chats'
      return
    }
    const id = `session-${Date.now()}`
    const defaults = loadPrefs()
    const thinking = THINKING_LEVELS.includes(defaults.thinking) ? defaults.thinking : undefined
    const payload: Record<string, unknown> = { sessionId: id, cwd: workspacePath, mode: defaults.mode }
    if (thinking) payload.thinking = thinking
    const created = await request('create_session', payload) as { id: string; file?: string }
    activeSessionId = created.id
    activeSession = '新会话'
    sessions = [{ id: created.id, title: '新会话', time: '刚刚', thinking, mode: defaults.mode, file: created.file }, ...sessions]
    leftTab = 'Chats'
  }

  const SLASH = [
    { id: 'new', label: '新建会话', desc: '打开一个空白会话' },
    { id: 'settings', label: '打开设置', desc: '打开系统设置与配置管理' },
    { id: 'workspace', label: '选择工作区', desc: '更换当前项目目录' },
    { id: 'scout', label: '派 scout 侦察', desc: '只读探索，不改文件' },
    { id: 'split', label: '并行拆分子代理', desc: '把任务拆给多个子代理' },
    { id: 'todo', label: '添加待办', desc: '写入本会话待办列表' },
    { id: 'compact', label: '压缩上下文', desc: '压缩会话上下文' },
    { id: 'login', label: '订阅登录', desc: 'OAuth / API Key 登录（配置管理里）' },
    { id: 'export', label: '导出会话', desc: '导出会话记录' },
    { id: 'plan', label: '计划模式', desc: '切换只读探索' }
  ]
  let mention: { kind: 'file' | 'cmd'; query: string; index: number } | null = null
  $: mentionItems = mentionList(mention, files)
  function mentionList(current: typeof mention, list: typeof files) {
    if (!current) return []
    if (current.kind === 'cmd') return SLASH.filter((item) => item.id.startsWith(current.query) || item.label.includes(current.query))
    return list.filter((item) => item.kind === 'file' && item.path.toLowerCase().includes(current.query.toLowerCase())).slice(0, 8)
  }

  function refreshMention() {
    const slash = inputText.match(/^\/([^\s]*)$/)
    const at = inputText.match(/(^|\s)@([^\s]*)$/)
    if (slash) mention = { kind: 'cmd', query: slash[1], index: 0 }
    else if (at) {
      mention = { kind: 'file', query: at[2], index: 0 }
      if (!files.length) void loadFiles()
    } else mention = null
  }

  function applyMention(index = mention?.index ?? 0) {
    if (!mention || !mentionItems[index]) return
    const item = mentionItems[index]
    if (mention.kind === 'cmd') {
      inputText = ''
      mention = null
      const id = (item as { id: string }).id
      if (id === 'new') void newSession()
      else if (id === 'settings' || id === 'login') void openSettings()
      else if (id === 'scout') { inputText = '/scout '; mention = null }
      else if (id === 'split') { splitOpen = true; agentDefs = loadAgents() }
      else if (id === 'todo') { panel = '待办'; showRight = true }
      else if (id === 'plan') void setMode('plan')
      else void chooseWorkspace()
      return
    }
    const path = (item as { path: string }).path
    inputText = inputText.replace(/@[^\s]*$/, `@${path} `)
    mention = null
  }

  function handleKeydown(event: KeyboardEvent) {
    if (mention && mentionItems.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); mention = { ...mention, index: (mention.index + 1) % mentionItems.length }; return }
      if (event.key === 'ArrowUp') { event.preventDefault(); mention = { ...mention, index: (mention.index - 1 + mentionItems.length) % mentionItems.length }; return }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey)) { event.preventDefault(); applyMention(); return }
      if (event.key === 'Escape') { event.preventDefault(); mention = null; return }
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    const prefs = loadPrefs()
    const mod = event.ctrlKey || event.metaKey
    const shouldSend = prefs.sendShortcut === 'ctrl-enter' ? mod : !mod
    if (!shouldSend) return
    event.preventDefault()
    if (imageGenMode) { void generateImage(); return }
    const running = Boolean(runState[activeSessionId]?.running)
    submit(event.altKey ? 'followUp' : running ? prefs.busySend : 'steer')
  }

  function handleGlobalKey(event: KeyboardEvent) {
    if (showSettings) return
    const mod = event.ctrlKey || event.metaKey
    if (!mod) return
    const key = event.key.toLowerCase()
    if (key === ',') { event.preventDefault(); void openSettings(); return }
    if (key === 'n') { event.preventDefault(); void newSession(); return }
    if (key === 'b' && event.shiftKey) { event.preventDefault(); showRight = !showRight; return }
    if (key === 'b') { event.preventDefault(); showLeft = !showLeft }
  }
</script>

<svelte:head>
  <title>Pi-My</title>
</svelte:head>
<svelte:window on:keydown={handleGlobalKey} />

  <div class="desktop">
  <div class="window" class:left-on={showLeft} class:right-on={showRight} class:compact={uiPrefs.density === 'compact'} style={`--left-panel:${showLeft ? 220 : 0}px;--right-panel:${showRight ? rightWidth : 0}px`}>
    <div class="title-left" data-tauri-drag-region><div class="brand"><img class="brand-logo" src={logoUrl} alt="Pi-My" /><span>Pi-My</span></div></div>
    <div class="title-center" data-tauri-drag-region>
      <div class="top-tabs">
        {#each openTabs as session (session.id)}
          <div class="top-tab" class:on={session.id === activeSessionId} class:live={session.state === 'active' || slotFor(session.id).running}>
            <button class="top-tab-main" type="button" title={tabTitle(session)} on:click={() => void selectSession(session)}>{tabTitle(session)}</button>
            <button class="top-tab-close" type="button" aria-label={`关闭 ${tabTitle(session)}`} on:click={() => void closeTab(session)}>×</button>
          </div>
        {/each}
        <button class="top-session-plus" aria-label="新建会话" on:click={() => void newSession()}>＋</button>
      </div>
      <div class="title-actions">
        <span class="conn-chip" class:connected={sidecarReady}><i></i>{sidecarReady ? '已连接' : ''}</span>
        <div class="more-dropdown" use:clickOutsideMore>
          <button class="top-more" aria-label="更多选项" aria-expanded={moreOpen} on:click={toggleMore}>⋯</button>
          {#if moreOpen}
            <div class="more-menu">
              <button on:click={() => { moreOpen = false; void openSettings() }}>设置</button>
              <button on:click={() => { moreOpen = false; void chooseWorkspace() }}>选择工作区</button>
              <button on:click={() => { moreOpen = false; void newSession() }}>新建会话</button>
            </div>
          {/if}
        </div>
      </div>
    </div>
    <div class="title-right" data-tauri-drag-region>
      <div class="win-controls">
        <button class="win-btn" aria-label="最小化" title="最小化" on:click={() => void appWindow.minimize()}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1"/></svg></button>
        <button class="win-btn" aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原' : '最大化'} on:click={toggleMaximize}>{#if maximized}<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="1.5" y="3" width="5" height="5" stroke="currentColor" stroke-width="1"/><path d="M3.5 3V1.5h5v5H7" stroke="currentColor" stroke-width="1"/></svg>{:else}<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" stroke-width="1"/></svg>{/if}</button>
        <button class="win-btn close" aria-label="关闭" title="关闭" on:click={() => void appWindow.close()}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" stroke-width="1"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" stroke-width="1"/></svg></button>
      </div>
    </div>
    <button class="panel-toggle left" aria-label={showLeft ? '收起左侧栏' : '展开左侧栏'} on:click={() => (showLeft = !showLeft)}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.8"/><line x1={showLeft ? '5.5' : '10.5'} y1="3" x2={showLeft ? '5.5' : '10.5'} y2="13"/></svg></button>
    <button class="panel-toggle right" aria-label={showRight ? '收起右侧栏' : '展开右侧栏'} on:click={() => (showRight = !showRight)}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.8"/><line x1={showRight ? '10.5' : '5.5'} y1="3" x2={showRight ? '10.5' : '5.5'} y2="13"/></svg></button>
      <aside class="sidebar" class:collapsed={!showLeft}>
        <div class="sidebar-actions">
          <button class="sidebar-action" on:click={() => void newSession()}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><line x1="8" y1="5" x2="8" y2="11"/><line x1="5" y1="8" x2="11" y2="8"/></svg>新建会话</button>
        </div>

        <label class="search"><span>⌕</span><input placeholder="搜索会话" bind:value={query} /></label>
        <div class="sidebar-tabs">
          <button class:active={leftTab === 'Activity'} on:click={() => (leftTab = 'Activity')}>⌁ <span>活动</span></button>
          <button class:active={leftTab === 'Chats'} on:click={() => (leftTab = 'Chats')}>▱ <span>聊天</span></button>
          <button class:active={leftTab === 'Projects'} on:click={() => { leftTab = 'Projects'; void loadFiles() }}>▱ <span>项目</span></button>
        </div>

        {#if leftTab === 'Projects'}
          <div class="sidebar-section-heading"><span>项目</span><span><button aria-label="选择工作区" on:click={() => void chooseWorkspace()}>＋</button></span></div>
          <div class="project-list">
            {#if workspacePath !== '.'}
              <button class="project-item current"><span class="project-folder">□</span><span class="project-name">{workspaceBase()}</span></button>
            {:else}
              <div class="file-empty">选择项目目录后显示内容</div>
            {/if}
          </div>
        {:else}
          <div class="session-heading"><span>{leftTab === 'Activity' ? '活动' : '聊天'}</span><span class="session-count">{listedSessions.length}</span></div>
          <div class="sessions">
            {#each listedSessions as session}
              <button class:current={activeSessionId === session.id} class="session" on:click={() => void selectSession(session)} on:contextmenu={(event) => openSessionMenu(event, session)}>
                <span class:live={session.state === 'active'} class:complete={session.state === 'done'} class="status-dot" title={statusDotTitle(session)}></span>
                <span class="session-copy"><strong>{session.title}</strong><small>{session.time}</small></span>
              </button>
            {:else}
              <div class="file-empty">{leftTab === 'Activity' ? '没有运行中的会话' : '没有匹配的会话'}</div>
            {/each}
          </div>
        {/if}

        <div class="sidebar-footer">
          <button class="icon-button" aria-label="打开设置" on:click={() => void openSettings()}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true"><path d="M6.7 1.8h2.6l.4 1.7a4.9 4.9 0 0 1 1.2.7l1.7-.7 1.3 2.2-1.3 1.2a5 5 0 0 1 0 1.4l1.3 1.2-1.3 2.2-1.7-.7a4.9 4.9 0 0 1-1.2.7l-.4 1.7H6.7l-.4-1.7a4.9 4.9 0 0 1-1.2-.7l-1.7.7-1.3-2.2 1.3-1.2a5 5 0 0 1 0-1.4L2.1 5.7l1.3-2.2 1.7.7a4.9 4.9 0 0 1 1.2-.7l.4-1.7Z"/><circle cx="8" cy="8" r="2.1"/></svg>
          </button>
          <span class="version">v{version}</span>
        </div>
      </aside>

      {#if sessionMenu}
        <div class="session-menu-backdrop" role="presentation" on:click={() => (sessionMenu = null)}>
          <div class="session-menu" style={`left:${sessionMenu.x}px; top:${sessionMenu.y}px`} role="menu" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
            <button on:click={() => togglePin(sessionMenu!.session)}>{sessionMenu.session.pinned ? '取消置顶' : '置顶'}</button>
            <button on:click={() => void renameSession(sessionMenu!.session)}>重命名</button>
            <button on:click={() => archiveSession(sessionMenu!.session)}>归档</button>
            <div class="session-menu-divider"></div>
            <button on:click={() => { sessionMenu = null; void chooseWorkspace() }}>设置工作区</button>
            <button on:click={() => chooseSessionModel(sessionMenu!.session)}>设置模型</button>
            <button class="has-arrow" on:click={() => exportSession(sessionMenu!.session)}>导出 <span>›</span></button>
            <div class="session-menu-divider"></div>
            <button on:click={() => copySessionValue(`${window.location.origin}${window.location.pathname}#session=${sessionMenu!.session.id}`)}>复制会话链接</button>
            <button on:click={() => copySessionValue(sessionMenu!.session.id)}>复制会话 ID</button>
          </div>
        </div>
      {/if}

      <main class="chat">
        <div class="chat-header" class:empty={isIdle(activeSessionId)}>
          <div><h1>{activeSession}</h1><p><span class="online-dot" class:offline={!sidecarReady}></span> Pi Agent · {workspaceBase()}</p></div>
        </div>

        <div class="messages" class:centered={isIdle(activeSessionId)}>
          {#if imageGenError}<div class="imagegen-error">{imageGenError}</div>{/if}
          {#if imageGenResult}<div class="image-result"><img src={imageGenResult.src} alt={imageGenResult.prompt} /><small>{imageGenResult.prompt}</small></div>{/if}
          {#if isIdle(activeSessionId)}
            <div class="empty-state">
              <div class="empty-mark"><img src={logoUrl} alt="Pi-My" /></div>
              <button class="start-project" type="button" on:click={() => void chooseWorkspace()}><span>⌂</span><span>{workspaceBase()}</span><span>⌄</span></button>
              <div class="quick-chips" class:show={uiPrefs.showQuickChips}>
                <button on:click={() => quickPrompt('请分析当前项目的目录结构，梳理主要模块、入口文件和各部分职责，并给出简要说明。')}>分析当前项目结构</button>
                <button on:click={() => quickPrompt('请检查当前工作区的 Git 变更，总结改动内容、涉及的文件以及可能的风险点。')}>检查工作区变更</button>
                <button on:click={() => quickPrompt('请阅读并总结当前项目 README 的内容，提炼出项目定位、安装方式和核心用法。')}>总结 README</button>
              </div>
            </div>
          {:else}
            {#if todos.length}
              <button class="todo-chip" on:click={() => { panel = '待办'; showRight = true }}><span>待办 {todos.filter((item) => item.status === 'completed').length}/{todos.length}</span></button>
            {/if}
            {#each runState[activeSessionId]?.sent ?? [] as message, index}
              <div class="message user-message">
                <div class="user-bubble">{message.text}</div>
                <div class="user-meta"><time>{message.at}</time><button class="recall" type="button" on:click={() => void copyText(message.text)}>复制</button><button class="recall" type="button" on:click={() => recallMessage(index)}>撤回重发</button><button class="recall" type="button" on:click={() => void forkFrom(index)}>分叉</button></div>
              </div>
            {/each}
            {#if liveLabel(slotFor(activeSessionId))}
              <div class="message assistant-status">
                <div class="live-status" data-phase={slotFor(activeSessionId).phase}>
                  <Atom size={56} />
                  <strong>{liveLabel(slotFor(activeSessionId))}</strong>
                  {#if slotFor(activeSessionId).tool && slotFor(activeSessionId).phase === 'working'}<span>{slotFor(activeSessionId).tool}</span>{/if}
                </div>
              </div>
            {/if}
            {#if (runState[activeSessionId]?.process ?? []).length}
              <div class="process-card" class:open={runState[activeSessionId]?.processOpen || runState[activeSessionId]?.running}>
                <button class="process-head" type="button" on:click={() => patchSlot(activeSessionId, { processOpen: !slotFor(activeSessionId).processOpen })}>
                  <span>{processSummary(slotFor(activeSessionId))}</span>
                  <em>{runState[activeSessionId]?.running ? '进行中' : (runState[activeSessionId]?.processOpen ? '收起' : '展开')}</em>
                </button>
                {#if runState[activeSessionId]?.processOpen || runState[activeSessionId]?.running}
                  <div class="process-body">
                    {#each runState[activeSessionId].process as step (step.id)}
                      <div class="process-step" class:run={!step.done} class:tool={step.kind === 'tool'}>
                        <strong>{step.kind === 'think' ? '思考' : step.title}</strong>
                        {#if step.body}<pre>{step.body}</pre>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
            {#if runState[activeSessionId]?.reply}
              <div class="message assistant-message">
                {#if !runState[activeSessionId]?.running}
                  <div class="message-meta"><span class="assistant-avatar">π</span><strong>Pi Agent</strong><span>回复</span></div>
                {/if}
                <MarkdownView text={runState[activeSessionId]?.reply ?? ''} />
              </div>
            {/if}
            {#if runState[activeSessionId]?.confirm}
              <div class="confirm-card">
                <div class="confirm-head"><span class="confirm-tool">{runState[activeSessionId]?.confirm?.toolName}</span><span class="confirm-summary">{runState[activeSessionId]?.confirm?.summary}</span></div>
                <div class="confirm-actions"><button class="confirm-allow" on:click={() => answerConfirm(true)}>允许</button><button on:click={() => answerConfirm(false)}>拒绝</button></div>
              </div>
            {/if}
          {/if}
        </div>

        <div class="composer-wrap">
          {#if (runState[activeSessionId]?.steer ?? []).length}
            <div class="steer-bar">
              {#each runState[activeSessionId].steer as item, index (index)}
                <div class="steer-row"><span>{index === 0 ? '插话' : `#${index + 1}`}</span><em>{item}</em></div>
              {/each}
            </div>
          {/if}
          {#if (runState[activeSessionId]?.queue ?? []).length}
            <div class="queue-panel">
              <div class="queue-head"><strong>排队 {(runState[activeSessionId]?.queue ?? []).length} 条</strong><span>当前回合结束后按顺序发送 · 可上移/下移/移除</span></div>
              {#each runState[activeSessionId].queue as item, index (index)}
                <div class="queue-row">
                  <pre>{item}</pre>
                  <div class="queue-actions">
                    <button type="button" disabled={index === 0} on:click={() => moveQueue(index, -1)}>上移</button>
                    <button type="button" disabled={index === runState[activeSessionId].queue.length - 1} on:click={() => moveQueue(index, 1)}>下移</button>
                    <button type="button" on:click={() => removeQueue(index)}>移除</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          {#if currentMode === 'plan'}<div class="plan-hint">计划模式：Agent 只能读和搜索，不会修改文件</div>{/if}
          <div class="composer">
            {#if attachError}<div class="git-error attach-error">{attachError}</div>{/if}
            {#if attachments.length}<div class="attach-chips">{#each attachments as attachment, index (index)}<span class="attach-chip" class:image={attachment.kind === 'image'}>{#if attachment.kind === 'image'}<i></i>{/if}<span class="attach-name">{attachment.name}</span><button aria-label="移除附件" on:click={() => removeAttachment(index)}>×</button></span>{/each}</div>{/if}
            {#if mention && mentionItems.length}<div class="mention-menu">{#each mentionItems as item, i}<button class:on={i === mention.index} on:mousedown|preventDefault={() => applyMention(i)}>{mention.kind === 'cmd' ? `/${(item as { id: string }).id}  ${(item as { label: string }).label}${(item as { desc?: string }).desc ? `  ${(item as { desc?: string }).desc}` : ''}` : (item as { path: string }).path}</button>{/each}</div>{/if}
            <textarea bind:this={composerInput} bind:value={inputText} on:input={refreshMention} on:keydown={handleKeydown} placeholder={imageGenMode ? '描述要生成的图片…' : '输入消息，@ 引用文件，/ 运行命令'} rows="2"></textarea>
            <div class="composer-toolbar"><div class="composer-controls"><div class="kind-dropdown" use:clickOutsideKind><button class="kind-button" bind:this={kindButtonRef} aria-haspopup="true" aria-expanded={kindOpen} aria-label="输入模式" on:click={toggleKind}><img src={logoUrl} alt="" /><span>{imageGenMode ? '生图' : 'Pi'}</span><svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1.5 2.5 4 5l2.5-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>{#if kindOpen}<div class="kind-menu"><button class:selected={!imageGenMode} on:click={() => setAgentKind(false)}><img src={logoUrl} alt="" /><span>Pi</span></button><button class:selected={imageGenMode} on:click={() => setAgentKind(true)}><span>生图</span></button></div>{/if}</div><button class="attach-button" disabled={!sidecarReady} aria-label="添加附件" on:click={() => void addAttachments()}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg></button><div class="mode-dropdown" use:clickOutsideMode><button class="mode-button" class:plan={currentMode === 'plan'} bind:this={modeButtonRef} aria-haspopup="true" aria-expanded={modeOpen} aria-label="权限模式" on:click={toggleMode}><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 13.5 3.6v4.1c0 3.2-2.2 5.6-5.5 6.6-3.3-1-5.5-3.4-5.5-6.6V3.6L8 1.8Z"/></svg><span>{MODE_LABELS[currentMode] ?? currentMode}</span></button>{#if modeOpen}<div class="mode-menu" class:up={modeMenuUp}>{#each MODE_OPTIONS as option (option.value)}<button class="mode-option" class:selected={option.value === currentMode} on:click={() => void setMode(option.value)}><span class="mode-dot"></span><span class="mode-copy"><strong>{option.label}</strong><small>{option.desc}</small></span></button>{/each}</div>{/if}</div></div><div class="composer-model"><div class="model-dropdown" use:clickOutside><button class="model-button" bind:this={modelButtonRef} disabled={!models.length} aria-haspopup="listbox" aria-expanded={modelOpen} aria-label="模型" on:click={toggleModel}><span>{currentModelLabel}</span><svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1.5 2.5 4 5l2.5-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>{#if modelOpen}<div class="model-menu" class:up={modelMenuUp}><div class="model-search"><span>⌕</span><input bind:this={modelSearchInput} bind:value={modelQuery} placeholder="搜索模型…" aria-label="搜索模型" /></div><div class="model-list">{#each modelDropdownGroups as group (group.provider)}<div class="model-group-title">{group.provider}</div>{#each group.items as model (modelKey(model))}<button class="model-option" class:selected={modelKey(model) === currentModelKey} on:click={() => pickModel(model)}><span class="model-dot"></span><span class="model-name">{model.name}</span></button>{/each}{:else}<div class="model-empty">没有匹配的模型</div>{/each}</div></div>{/if}</div><div class="thinking-dropdown" use:clickOutsideThinking><button class="thinking-button" bind:this={thinkingButtonRef} disabled={!sidecarReady} aria-haspopup="true" aria-expanded={thinkingOpen} aria-label="思考深度" on:click={toggleThinking}><span class="thinking-label">思考：</span><span class="thinking-value">{thinkingLabel}</span><svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1.5 2.5 4 5l2.5-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>{#if thinkingOpen}<div class="thinking-menu"><div class="thinking-head"><strong>思考深度</strong><span>{thinkingLabel}</span><button class="thinking-help-button" class:on={thinkingHelp} aria-label="档位说明" aria-expanded={thinkingHelp} on:click={toggleThinkingHelp}>?</button></div><div class="thinking-ends"><span>更快</span><span>更聪明</span></div><div class="thinking-slider" style={`--p:${thinkingPercent}`}><div class="thinking-track"></div><div class="thinking-fill"></div><input class="thinking-range" type="range" min="0" max={THINKING_LEVELS.length - 1} step="1" value={thinkingIndex} disabled={!sidecarReady} aria-label="思考档位" on:input={onThinkingInput} on:change={onThinkingChange} /></div>{#if thinkingHelp}<ul class="thinking-help">{#each THINKING_LEVELS as level (level)}<li class:on={level === thinkingLevel}><b>{THINKING_LABELS[level]}</b><span>{THINKING_HELP[level]}</span></li>{/each}</ul>{/if}</div>{/if}</div></div><div class="composer-right"><div class="ctx-dropdown" use:clickOutsideCtx><button class="ctx-button" class:empty={!activeSessionId || !ctxStats?.window} bind:this={ctxButtonRef} disabled={!sidecarReady} aria-label="上下文用量" aria-haspopup="true" aria-expanded={ctxOpen} on:click={toggleCtx}><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2"/>{#if ctxStats?.window}<circle cx="9" cy="9" r="7" fill="none" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-dasharray={ctxDash()} transform="rotate(-90 9 9)"/>{/if}</svg></button>{#if ctxOpen}<div class="ctx-menu" class:up={ctxMenuUp}>{#if !activeSessionId}<div class="ctx-empty"><strong>本会话尚未开始</strong><small>发送第一条消息后显示用量</small></div>{:else if !ctxStats?.window}<div class="ctx-empty"><strong>暂无用量数据</strong><small>发送消息后显示上下文占用</small></div>{:else}<div class="ctx-head"><strong>上下文容量（估算）</strong><span>{ctxProgress()}%</span></div><div class="ctx-row"><span>当前上下文</span><span>{fmtWan(ctxStats.currentContext)}</span></div><div class="ctx-row"><span>可用容量</span><span>{fmtWan(Math.max(0, ctxStats.window - ctxStats.currentContext))}</span></div><div class="ctx-row"><span>上下文窗口</span><span>{fmtWan(ctxStats.window)}</span></div><div class="ctx-bar"><i style="width:{ctxProgress()}%"></i></div><div class="ctx-divider"></div><div class="ctx-sub">本会话累计</div><div class="ctx-row"><span>总 Token</span><span>{fmtWan(ctxStats.totals.total)}</span></div><div class="ctx-row"><span>输入</span><span>{fmtWan(ctxStats.totals.input)}</span></div><div class="ctx-row"><span>输出</span><span>{fmtWan(ctxStats.totals.output)}</span></div><div class="ctx-row"><span>缓存读取</span><span>{fmtWan(ctxStats.totals.cacheRead)}</span></div><div class="ctx-row"><span>缓存写入</span><span>{fmtWan(ctxStats.totals.cacheWrite)}</span></div><div class="ctx-divider"></div><div class="ctx-row"><span>本地费率估算</span><span>${ctxStats.costUsd.toFixed(2)}</span></div><div class="ctx-row"><span>平均缓存命中率</span><span>{(ctxStats.cacheHitRate * 100).toFixed(1)}%</span></div><div class="ctx-note">按本地模型费率估算，未提供费率则为 0</div>{/if}</div>{/if}</div><button class:imagegen-busy={imageGenBusy} class:stop={runState[activeSessionId]?.running} class="send" aria-label={imageGenMode ? '生成图片' : runState[activeSessionId]?.running ? '停止当前任务' : '发送消息'} title={imageGenMode ? '生成图片' : runState[activeSessionId]?.running ? '停止当前任务' : '发送消息'} on:click={imageGenMode ? generateImage : runState[activeSessionId]?.running ? stop : () => submit('steer')}>{#if imageGenBusy}<span class="send-dot"></span>{:else if runState[activeSessionId]?.running}<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="currentColor"/></svg>{:else}<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 12.5V3.5M8 3.5 4.5 7M8 3.5 11.5 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}</button></div></div>
          </div>
        </div>
      </main>

      <aside class="workspace" class:collapsed={!showRight}>
        <div class="workspace-rail" aria-label="工作区工具">
          <button class:active={panel === '文档'} aria-label="文件" on:click={() => (panel = '文档')}>▱</button>
          <button class:active={panel === '变更'} aria-label="变更" on:click={() => (panel = '变更')}>⌘</button>
          <button class:active={panel === '终端'} aria-label="终端" on:click={() => (panel = '终端')}>⌁</button>
          <button class:active={panel === '运行'} aria-label="运行" on:click={() => (panel = '运行')}>◌</button>
          <button class:active={panel === '待办'} aria-label="待办" on:click={() => (panel = '待办')}>☰</button>
        </div>
        <div class="workspace-content">
        {#if panel === '文档'}
          <div class="resource-head"><span>项目文件</span><button aria-label="刷新文件" on:click={() => void loadFiles()}>↻</button></div>
          <div class="resource-tree">
            {#snippet treeRows(prefix: string, depth: number)}
              {#each treeChildren(prefix) as file}
                <button class:file-directory={file.kind === 'directory'} class:file-selected={selectedFile === file.path} class:open={openDirs[file.path]} style={`padding-left:${6 + depth * 12}px`} on:click={() => file.kind === 'file' ? void previewFile(file.path) : toggleDir(file.path)}>
                  <span class="resource-chevron">{file.kind === 'directory' ? (openDirs[file.path] ? '▾' : '›') : ''}</span><span class="resource-icon">{file.kind === 'directory' ? '□' : '·'}</span><span>{fileName(file.path)}</span>
                </button>
                {#if file.kind === 'directory' && openDirs[file.path]}
                  {@render treeRows(file.path, depth + 1)}
                {/if}
              {:else}
                {#if depth === 0}<div class="resource-empty">选择工作区后显示文件</div>{/if}
              {/each}
            {/snippet}
            {@render treeRows('', 0)}
          </div>
          {#if selectedFile}
            <div class="resource-preview-head"><span class="doc-name">{selectedFile}</span><span class="doc-stats">{documentStats()}</span>{#if !editingFile}<button on:click={() => (editingFile = true)}>编辑</button>{:else}<button on:click={() => void saveFile()}>保存</button><button on:click={() => (editingFile = false)}>取消</button>{/if}</div>
            <article class="resource-preview">{#if editingFile}<textarea class="file-editor" bind:value={fileContent}></textarea>{:else}<pre class="file-preview">{fileContent}</pre>{/if}</article>
          {/if}
        {:else if panel === '变更'}
          <div class="git-panel">
            <div class="panel-content">
              <div class="panel-title"><div><strong>工作区变更</strong><small>{gitChanges.length} 个文件已修改</small></div><button class="primary-small" on:click={() => void refreshGit()}>刷新</button></div>
              <div class="git-changes">
                {#each gitChanges as change}
                  <div class="change-item" role="button" tabindex="0" on:click={() => void loadDiff(change.path)} on:keydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void loadDiff(change.path) } }}>
                    <input class="change-check" type="checkbox" checked={staged[change.path] ?? false} on:click={(event) => event.stopPropagation()} on:change={() => (staged = { ...staged, [change.path]: !(staged[change.path] ?? false) })} />
                    <span class="file-dot" class:modified={change.code.includes('M')} class:added={change.code.includes('A') || change.code.includes('?')}>{change.code.includes('A') || change.code.includes('?') ? 'A' : 'M'}</span>
                    <div class="change-meta"><strong>{change.path}</strong><small>{change.code}</small></div>
                  </div>
                {:else}
                  <div class="diff-placeholder">当前工作区没有未提交变更</div>
                {/each}
                {#if diffContent}<pre class="diff-content">{diffContent}</pre>{/if}
              </div>
            </div>
            <div class="git-actions">
              {#if gitError}<div class="git-error">{gitError}</div>{/if}
              <input class="commit-input" bind:value={commitMessage} placeholder={uiPrefs.gitTemplate || '提交信息…'} />
              <div class="git-actions-row">
                <button disabled={!sidecarReady} on:click={() => void stageFiles()}>暂存</button>
                <button disabled={!sidecarReady} on:click={() => void commitChanges()}>提交</button>
                <button disabled={!sidecarReady} on:click={() => void pushChanges()}>推送</button>
              </div>
            </div>
          </div>
        {:else if panel === '终端'}
          <Terminal visible={panel === '终端'} />
        {:else if panel === '待办'}
          <div class="todo-panel">
            <div class="resource-head"><span>任务清单</span><button type="button" on:click={() => { splitOpen = true; agentDefs = loadAgents() }}>拆分</button></div>
            <div class="todo-add"><input bind:value={todoDraft} placeholder={todoParentId ? '子任务…' : '添加任务，Enter'} on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTodo(todoParentId || undefined) } }} /><button type="button" on:click={() => addTodo(todoParentId || undefined)}>＋</button></div>
            {#if todoParentId}<div class="todo-hint">正在给「{todos.find((item) => item.id === todoParentId)?.content ?? ''}」添加子任务 <button type="button" on:click={() => (todoParentId = '')}>取消</button></div>{/if}
            <div class="todo-list">
              {#each todoView.roots as item (item.id)}
                <div class="todo-item" class:done={item.status === 'completed'} class:doing={item.status === 'in_progress'}>
                  <button class="todo-check" type="button" on:click={() => setTodoStatus(item.id, cycleTodoStatus(item.status))}>{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◐' : '○'}</button>
                  <span>{item.content}</span>
                  <button type="button" class="todo-mini" on:click={() => (todoParentId = item.id)}>子项</button>
                  <button type="button" class="todo-mini" on:click={() => removeTodo(item.id)}>×</button>
                </div>
                {#each todoView.children(item.id) as child (child.id)}
                  <div class="todo-item child" class:done={child.status === 'completed'} class:doing={child.status === 'in_progress'}>
                    <button class="todo-check" type="button" on:click={() => setTodoStatus(child.id, cycleTodoStatus(child.status))}>{child.status === 'completed' ? '✓' : child.status === 'in_progress' ? '◐' : '○'}</button>
                    <span>{child.content}</span>
                    <button type="button" class="todo-mini" on:click={() => removeTodo(child.id)}>×</button>
                  </div>
                {/each}
              {:else}
                <div class="resource-empty">还没有任务。用右侧添加，或发送 /todo 某件事。</div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="panel-content">
            <div class="panel-title"><div><strong>子代理</strong><small>{(runState[activeSessionId]?.subRuns ?? []).length} 个任务</small></div><button class="primary-small" on:click={() => { splitOpen = true; agentDefs = loadAgents() }}>并行拆分</button></div>
            {#if (runState[activeSessionId]?.subRuns ?? []).length}
              {#each runState[activeSessionId].subRuns as run (run.id)}
                <button class="sub-row block" type="button" on:click={() => (viewingSub = { ...run, reply: slotFor(run.id).reply || run.reply })}>
                  <i class:run={run.status === 'running'} class:bad={run.status === 'error'}></i>
                  <strong>{run.agent}</strong>
                  <span class="sub-task">{run.task}</span>
                  <em>{run.status === 'running' ? '运行中' : run.status === 'error' ? '失败' : '完成'}</em>
                </button>
              {/each}
            {:else}
              <div class="empty-panel"><span>◌</span><strong>暂无子代理</strong><small>/scout 任务 或点「并行拆分」</small></div>
            {/if}
          </div>
        {/if}
        </div>
      </aside>
      {#if showRight}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="drag-handle" class:dragging={dragging === 'right'} role="separator" aria-label="调整右侧栏宽度" on:mousedown={(event) => startDrag(event, 'right')} on:dblclick={() => resetDrag('right')}></div>
      {/if}
  </div>
  {#if splitOpen}
    <div class="overlay" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) splitOpen = false }}>
      <div class="split-card" role="dialog" aria-label="并行拆分子代理">
        <header><strong>并行拆分</strong><button type="button" on:click={() => (splitOpen = false)}>×</button></header>
        <p>内置 scout 只读侦察；也可选自定义 agent。最多一次发多条。</p>
        {#each splitRows as row, index (index)}
          <div class="split-row">
            <select bind:value={row.agent}>{#each agentDefs as def (def.name)}<option value={def.name}>{def.name}</option>{/each}</select>
            <input bind:value={row.task} placeholder="独立任务…" />
            <button type="button" on:click={() => (splitRows = splitRows.filter((_, i) => i !== index))}>×</button>
          </div>
        {/each}
        <div class="split-actions">
          <button type="button" on:click={() => (splitRows = [...splitRows, { agent: 'scout', task: '' }])}>＋ 任务</button>
          <button class="primary" type="button" on:click={runSplit}>开始</button>
        </div>
      </div>
    </div>
  {/if}
  {#if viewingSub}
    <div class="overlay" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) viewingSub = null }}>
      <div class="sub-view" role="dialog" aria-label="子会话">
        <header>
          <div><strong>{viewingSub.agent}</strong><small>{viewingSub.task}</small></div>
          <span class="chip">{viewingSub.status === 'running' ? '运行中' : viewingSub.status === 'error' ? '失败' : '完成'}</span>
          <button type="button" on:click={() => (viewingSub = null)}>关闭</button>
        </header>
        <div class="sub-body">
          {#each slotFor(viewingSub.id).sent as message}<div class="message user-message"><div class="user-bubble">{message.text}</div></div>{/each}
          {#if slotFor(viewingSub.id).process.length}
            <div class="process-card open">
              <div class="process-head"><span>{processSummary(slotFor(viewingSub.id))}</span></div>
              <div class="process-body">
                {#each slotFor(viewingSub.id).process as step (step.id)}
                  <div class="process-step" class:run={!step.done} class:tool={step.kind === 'tool'}><strong>{step.kind === 'think' ? '思考' : step.title}</strong>{#if step.body}<pre>{step.body}</pre>{/if}</div>
                {/each}
              </div>
            </div>
          {/if}
          {#if slotFor(viewingSub.id).reply || viewingSub.reply}<div class="message assistant-message"><div class="message-meta"><strong>{viewingSub.agent}</strong><span>只读</span></div><MarkdownView text={slotFor(viewingSub.id).reply || viewingSub.reply} copyable={false} /></div>{/if}
          {#if slotFor(viewingSub.id).running}<div class="live-status"><Atom size={56} /><strong>{liveLabel(slotFor(viewingSub.id)) || 'Working'}</strong></div>{/if}
        </div>
        <footer>只读检视，请在父会话继续对话。</footer>
      </div>
    </div>
  {/if}
  {#if loginState}
    <div class="overlay" role="presentation">
      <div class="login-card" role="dialog" aria-label="登录">
        <header><strong>{loginState.provider ? `登录 ${loginState.provider}` : '登录'}</strong><button type="button" on:click={cancelLogin}>×</button></header>
        <div class="login-body">
          {#if loginState.userCode}
            <p class="desc">已尝试自动打开浏览器。若未弹出，请点击下方按钮，并在网页输入代码完成授权。</p>
            <div class="device-code"><code>{loginState.userCode}</code><button type="button" on:click={() => void copyText(loginState.userCode ?? '')}>复制</button></div>
            {#if loginState.verificationUri}<button class="primary" type="button" on:click={() => openLoginUrl(loginState.verificationUri ?? '')}>打开浏览器</button>{/if}
          {/if}
          {#if loginState.prompt}
            <p class="desc">{loginState.prompt.message}</p>
            <input bind:value={loginState.value} placeholder={loginState.prompt.placeholder ?? ''} on:keydown={(event) => { if (event.key === 'Enter') submitLoginPrompt() }} />
            <div class="login-actions"><button class="primary" type="button" on:click={submitLoginPrompt}>提交</button><button type="button" on:click={cancelLogin}>取消</button></div>
          {:else}
            <p class="login-status">{loginState.status || '等待授权…'}</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}
  {#if uiPrefs.petEnabled}
    {#if uiPrefs.petModel && petById(uiPrefs.petModel)}
      {#key currentPetUrl()}
        <Live2DPet enabled url={currentPetUrl()} />
      {/key}
    {:else}
      <Pet enabled />
    {/if}
  {/if}
  <Settings open={showSettings} connected={sidecarReady} info={settingsInfo} usageStats={usageStats} imageGenConfig={imageGenConfig} onSaveImageGenConfig={saveImageGenConfig} onclose={() => { showSettings = false; refreshPrefs() }} openDir={openDir} workspacePath={workspacePath} onChooseWorkspace={chooseWorkspace} onOpenRepo={() => void request('open_url', { url: 'https://github.com/TANGZZee/pi-my' })} providers={providers} onRefreshProviders={refreshProviders} onRefreshUsage={refreshUsage} onPrefsChange={refreshPrefs} rpc={request} />
</div>
