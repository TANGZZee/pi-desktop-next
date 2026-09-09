<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { open, confirm } from '@tauri-apps/plugin-dialog'
  import Terminal from './Terminal.svelte'
  import Settings from './Settings.svelte'
  import { version } from '../package.json'
  import logoUrl from './assets/pi-my-logo.png'

  type PanelTab = '文档' | '变更' | '终端' | '运行'
  type Session = { id: string; title: string; time: string; file?: string; state?: 'active' | 'done'; model?: string; thinking?: string; mode?: string; pinned?: boolean; archived?: boolean }
  type ModelInfo = { provider: string; id: string; name: string; reasoning: boolean }
  type GitChange = { code: string; path: string }
  type SidecarResponse = { type: 'response'; id: number; ok: boolean; result: unknown; error?: string }
  type SentMessage = { text: string; at: string }
  type RunSlot = { reply: string; thinking: string; tool: string; running: boolean; queue: string[]; sent: SentMessage[]; confirm?: { confirmId: string; toolName: string; summary: string } }
  type SettingsInfo = { node: string; sdk: string; agentDir: string; sessionDir: string; authProviders: string[]; providers?: Array<{ provider: string; modelCount: number; configured: boolean }> }
  type CtxStats = { currentContext: number; window: number; totals: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; costUsd: number; cacheHitRate: number }
  type UsageStats = { sessions: number; turns: number; activeDays: number; totals: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; costUsd: number; costKnown: boolean; byModel: Array<{ model: string; tokens: number; turns: number }> }
  type ImageGenConfig = { baseUrl: string; apiKey: string; model: string; size: string }
  const CTX_CIRC = 2 * Math.PI * 7
  const EMPTY_CTX: CtxStats = { currentContext: 0, window: 0, totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, cacheHitRate: 0 }

  let sessions: Session[] = []

  let activeSession = '新会话'
  let activeSessionId = ''
  let panel: PanelTab = '文档'
  let leftTab: 'Activity' | 'Chats' | 'Projects' = 'Projects'
  let showLeft = true
  let showRight = true
  let showSettings = false
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

  $: filteredSessions = sessions.filter((item) => !item.archived && item.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned))
  $: filteredFiles = files.filter((item) => item.path.toLowerCase().includes(query.toLowerCase()))
  $: projectItems = files.filter((item) => item.kind === 'directory' && item.path.toLowerCase().includes(query.toLowerCase()))
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
  $: thinkingMax = thinkingLevel === THINKING_LEVELS[THINKING_LEVELS.length - 1]
  $: thinkingPercent = THINKING_LEVELS.length > 1 ? thinkingIndex / (THINKING_LEVELS.length - 1) : 0
  $: if (typeof document !== 'undefined') document.body.classList.toggle('resizing', dragging !== null)

  function emptySlot(): RunSlot {
    return { reply: '', thinking: '', tool: '', running: false, queue: [], sent: [] }
  }

  function slotFor(id: string): RunSlot {
    return runState[id] ?? emptySlot()
  }

  // 整体替换 runState，保证 Svelte 检测到变化
  function patchSlot(id: string, patch: Partial<RunSlot>) {
    runState = { ...runState, [id]: { ...emptySlot(), ...runState[id], ...patch } }
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

  function statusText() {
    if (!sidecarReady) return ''
    const running = Object.values(runState).filter((slot) => slot.running).length
    return running > 0 ? `运行中 · ${running} 个会话` : '就绪'
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
      const next = sessions.find((item) => !item.archived)
      if (next) void selectSession(next)
    }
    sessionMenu = null
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
    return !slot.sent.length && !slot.reply && !slot.running
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

  function toggleMode() {
    modeOpen = !modeOpen
    if (modeOpen) {
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
    loadHiddenProviders()
    window.addEventListener('resize', clampToViewport)
    clampToViewport()
    const unlisten = await listen<AgentEnvelope>('agent-message', ({ payload }) => {
      if (payload.type === 'response' && payload.id) {
        pending.get(payload.id)?.(payload)
        pending.delete(payload.id)
      }
      if (payload.type === 'confirm_request') {
        patchSlot(payload.sessionId || activeSessionId, { confirm: { confirmId: String(payload.confirmId ?? ''), toolName: String(payload.toolName ?? ''), summary: String(payload.summary ?? '') } })
      }
      if (payload.type === 'event') {
        const event = payload.event
        if (!event) return
        const id = payload.sessionId || activeSessionId
        const slot = slotFor(id)
        if (event.type === 'message_update' && (event.delta || event.thinking)) {
          const patch: Partial<RunSlot> = {}
          if (event.delta) patch.reply = slot.reply + event.delta
          if (event.thinking) patch.thinking = slot.thinking + event.thinking
          patchSlot(id, patch)
        }
        if (event.type === 'tool_execution_start') patchSlot(id, { tool: `正在执行 ${event.toolName || '工具'}…` })
        if (event.type === 'tool_execution_end') patchSlot(id, { tool: `${event.toolName || '工具'} 已完成` })
        if (event.type === 'agent_start') { patchSlot(id, { running: true }); markSession(id, 'active') }
        if (event.type === 'agent_end' || event.type === 'error') { patchSlot(id, { running: false, tool: '', confirm: undefined }); markSession(id, 'done'); void refreshCtxStats() }
      }
    })
    try {
      await request('init', { cwd: '.' })
      sidecarReady = true
      models = (await request('list_models') as ModelInfo[]) ?? []
      await loadFiles()
      await refreshGit()
      const loaded = await request('list_sessions', { cwd: '.' }) as Array<{ id: string; title: string; file: string; modifiedAt: number }>
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
    const message = commitMessage.trim()
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
    activeSessionId = session.id
    activeSession = session.title
    if (sidecarReady && session.file) await request('open_session', { sessionId: session.id, file: session.file })
    void refreshCtxStats()
  }

  function openDir(path: string) {
    if (sidecarReady && path) void request('open_dir', { path })
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
    if (localStorage.getItem('pdn.autoname') === '0') return null
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
    const id = ensureActiveId()
    const slot = slotFor(id)
    inputText = ''
    const newTitle = maybeAutoTitle(id, text)
    patchSlot(id, {
      sent: [...slot.sent, { text, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }],
      reply: '',
      thinking: '',
      running: true,
      queue: behavior === 'followUp' ? [...slot.queue, text] : slot.queue
    })
    if (sidecarReady) {
      const files = attachments
      attachments = []
      attachError = ''
      void (async () => {
        const rec = sessions.find((item) => item.id === id)
        if (!rec?.file) {
          const rawThinking = rec?.thinking ?? localStorage.getItem('pdn.thinking') ?? undefined
          const payload: Record<string, unknown> = { sessionId: id, cwd: workspacePath, mode: rec?.mode ?? 'ask' }
          if (rawThinking && THINKING_LEVELS.includes(rawThinking)) payload.thinking = rawThinking
          const created = await request('create_session', payload) as { id: string; file?: string } | null
          if (created?.file) remember(id, { file: created.file })
          const model = sessions.find((item) => item.id === id)?.model
          if (model) {
            const [provider, modelId] = model.split(MODEL_SEPARATOR)
            await request('set_model', { sessionId: id, provider, modelId })
          }
        }
        await request('prompt', { sessionId: id, text, cwd: workspacePath, behavior, attachments: files })
      })()
        .then(() => { if (newTitle) void request('rename_session', { sessionId: id, name: newTitle }) })
        .catch(() => patchSlot(id, { running: false }))
    } else {
      window.setTimeout(() => patchSlot(id, { running: false }), 1400)
    }
  }

  function stop() {
    const id = activeSessionId
    if (!sidecarReady) { patchSlot(id, { running: false }); return }
    void request('abort', { sessionId: id }).finally(() => patchSlot(id, { running: false }))
  }

  function quickPrompt(text: string) {
    inputText = text
    composerInput?.focus()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (imageGenMode) void generateImage()
      else submit(event.altKey ? 'followUp' : 'steer')
    }
  }
</script>

<svelte:head>
  <title>Pi-My</title>
</svelte:head>

  <div class="desktop">
  <div class="window" class:left-on={showLeft} class:right-on={showRight} style={`--left-panel:${showLeft ? 220 : 0}px;--right-panel:${showRight ? rightWidth : 0}px`}>
    <div class="title-left"><div class="brand"><img class="brand-logo" src={logoUrl} alt="Pi-My" /><span>Pi-My</span></div></div>
    <div class="title-center">
      <div class="top-session-tab"><span>{activeSession === '新会话' ? 'Pi-My agent' : activeSession}</span><button class="top-session-plus" aria-label="新建会话" on:click={() => { leftTab = 'Chats' }}>＋</button></div>
      <div class="title-actions">
        <span class="conn-chip" class:connected={sidecarReady}><i></i>{sidecarReady ? '已连接' : ''}</span>
        <button class="top-more" aria-label="更多选项">⋯</button>
      </div>
    </div>
    <div class="title-right"></div>
    <button class="panel-toggle left" aria-label={showLeft ? '收起左侧栏' : '展开左侧栏'} on:click={() => (showLeft = !showLeft)}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.8"/><line x1={showLeft ? '5.5' : '10.5'} y1="3" x2={showLeft ? '5.5' : '10.5'} y2="13"/></svg></button>
    <button class="panel-toggle right" aria-label={showRight ? '收起右侧栏' : '展开右侧栏'} on:click={() => (showRight = !showRight)}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.8"/><line x1={showRight ? '10.5' : '5.5'} y1="3" x2={showRight ? '10.5' : '5.5'} y2="13"/></svg></button>
      <aside class="sidebar" class:collapsed={!showLeft}>
        <div class="sidebar-actions">
          <button class="sidebar-action" on:click={async () => {
            if (!sidecarReady) {
              const draftId = `draft-${Date.now()}`
              activeSession = '新会话'
              activeSessionId = draftId
              sessions = [{ id: draftId, title: '新会话', time: '刚刚' }, ...sessions]
              leftTab = 'Chats'
              return
            }
            const id = `session-${Date.now()}`
            const rawThinking = localStorage.getItem('pdn.thinking')
            const thinking = rawThinking && THINKING_LEVELS.includes(rawThinking) ? rawThinking : undefined
            const payload: Record<string, unknown> = { sessionId: id, cwd: workspacePath }
            if (thinking) payload.thinking = thinking
            const created = await request('create_session', payload) as { id: string; file?: string }
            activeSessionId = created.id
            activeSession = '新会话'
            sessions = [{ id: created.id, title: '新会话', time: '刚刚', state: 'active', thinking, file: created.file }, ...sessions]
            leftTab = 'Chats'
          }}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><line x1="8" y1="5" x2="8" y2="11"/><line x1="5" y1="8" x2="11" y2="8"/></svg>新建会话</button>
        </div>

        <label class="search"><span>⌕</span><input placeholder="搜索会话" bind:value={query} /></label>
        <div class="sidebar-tabs">
          <button class:active={leftTab === 'Activity'} on:click={() => (leftTab = 'Activity')}>⌁ <span>活动</span></button>
          <button class:active={leftTab === 'Chats'} on:click={() => (leftTab = 'Chats')}>▱ <span>聊天</span></button>
          <button class:active={leftTab === 'Projects'} on:click={() => { leftTab = 'Projects'; void loadFiles() }}>▱ <span>项目</span></button>
        </div>

        {#if leftTab === 'Projects'}
          <div class="sidebar-section-heading"><span>项目</span><span><button aria-label="选择工作区" on:click={() => void chooseWorkspace()}>＋</button><button aria-label="项目选项">×</button></span></div>
          <div class="project-list">
            {#if projectItems.length}
              {#each projectItems as file}
                <button class="project-item" on:click={() => void chooseWorkspace()}><span class="project-chevron">›</span><span class="project-folder">□</span><span class="project-name">{file.path}</span></button>
              {/each}
            {:else}
              <div class="file-empty">选择项目目录后显示内容</div>
            {/if}
          </div>
        {:else}
          <div class="session-heading"><span>{leftTab === 'Activity' ? '活动' : '聊天'}</span><span class="session-count">{filteredSessions.length}</span></div>
          <div class="sessions">
            {#each filteredSessions as session}
              <button class:current={activeSessionId === session.id} class="session" on:click={() => void selectSession(session)} on:contextmenu={(event) => openSessionMenu(event, session)}>
                <span class:live={session.state === 'active'} class:complete={session.state === 'done'} class="status-dot" title={statusDotTitle(session)}></span>
                <span class="session-copy"><strong>{session.title}</strong><small>{session.time}</small></span>
              </button>
            {:else}
              <div class="file-empty">没有匹配的会话</div>
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
            <button class="has-arrow" disabled>移动到分类 <span>›</span></button>
            <button class="has-arrow" on:click={() => exportSession(sessionMenu!.session)}>导出 <span>›</span></button>
            <div class="session-menu-divider"></div>
            <button disabled>在新窗口打开</button>
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
              <div class="quick-chips">
                <button on:click={() => quickPrompt('请分析当前项目的目录结构，梳理主要模块、入口文件和各部分职责，并给出简要说明。')}>分析当前项目结构</button>
                <button on:click={() => quickPrompt('请检查当前工作区的 Git 变更，总结改动内容、涉及的文件以及可能的风险点。')}>检查工作区变更</button>
                <button on:click={() => quickPrompt('请阅读并总结当前项目 README 的内容，提炼出项目定位、安装方式和核心用法。')}>总结 README</button>
              </div>
            </div>
          {:else}
            {#each runState[activeSessionId]?.sent ?? [] as message}
              <div class="message user-message"><div class="user-bubble">{message.text}</div><time>{message.at}</time></div>
            {/each}
            {#if runState[activeSessionId]?.thinking && runState[activeSessionId]?.running}<div class="thinking-live"><span class="atom"><span class="nucleus"></span><span class="orbit orbit-1"><i></i></span><span class="orbit orbit-2"><i></i></span><span class="orbit orbit-3"><i></i></span></span> Thinking</div>{/if}
            {#if runState[activeSessionId]?.tool}<div class="tool-live"><span>◌</span> {runState[activeSessionId]?.tool}</div>{/if}
            {#if (runState[activeSessionId]?.queue ?? []).length}<div class="queue-live">⌁ 已排队 {(runState[activeSessionId]?.queue ?? []).length} 条消息（Alt+Enter）</div>{/if}
            {#if runState[activeSessionId]?.reply}<div class="message assistant-message"><div class="message-meta"><span class="assistant-avatar">π</span><strong>Pi Agent</strong><span>实时回复</span></div><p>{runState[activeSessionId]?.reply}</p></div>{/if}
            {#if runState[activeSessionId]?.confirm}
              <div class="confirm-card">
                <div class="confirm-head"><span class="confirm-tool">{runState[activeSessionId]?.confirm?.toolName}</span><span class="confirm-summary">{runState[activeSessionId]?.confirm?.summary}</span></div>
                <div class="confirm-actions"><button class="confirm-allow" on:click={() => answerConfirm(true)}>允许</button><button on:click={() => answerConfirm(false)}>拒绝</button></div>
              </div>
            {/if}
            {#if runState[activeSessionId]?.running}<div class="running-line"><span class="spinner"></span> Agent 正在处理…</div>{/if}
          {/if}
        </div>

        <div class="composer-wrap">
          {#if currentMode === 'plan'}<div class="plan-hint">计划模式：Agent 只能读和搜索，不会修改文件</div>{/if}
          <div class="composer">
            {#if attachError}<div class="git-error attach-error">{attachError}</div>{/if}
            {#if attachments.length}<div class="attach-chips">{#each attachments as attachment, index (index)}<span class="attach-chip" class:image={attachment.kind === 'image'}>{#if attachment.kind === 'image'}<i></i>{/if}<span class="attach-name">{attachment.name}</span><button aria-label="移除附件" on:click={() => removeAttachment(index)}>×</button></span>{/each}</div>{/if}
            <textarea bind:this={composerInput} bind:value={inputText} on:keydown={handleKeydown} placeholder={imageGenMode ? '描述要生成的图片…' : '输入消息…'} rows="2"></textarea>
            <div class="composer-toolbar"><div class="composer-controls"><button class="attach-button" disabled={!sidecarReady} aria-label="添加附件" on:click={() => void addAttachments()}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg></button><button class="imagegen-button" class:active={imageGenMode} aria-label="生图模式" on:click={() => { imageGenMode = !imageGenMode; imageGenError = '' }}><span>✦</span><b>生图</b></button><div class="mode-dropdown" use:clickOutsideMode><button class="mode-button" class:plan={currentMode === 'plan'} bind:this={modeButtonRef} aria-haspopup="true" aria-expanded={modeOpen} aria-label="权限模式" on:click={toggleMode}><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 13.5 3.6v4.1c0 3.2-2.2 5.6-5.5 6.6-3.3-1-5.5-3.4-5.5-6.6V3.6L8 1.8Z"/></svg><span>{MODE_LABELS[currentMode] ?? currentMode}</span></button>{#if modeOpen}<div class="mode-menu" class:up={modeMenuUp}>{#each MODE_OPTIONS as option (option.value)}<button class="mode-option" class:selected={option.value === currentMode} on:click={() => void setMode(option.value)}><span class="mode-dot"></span><span class="mode-copy"><strong>{option.label}</strong><small>{option.desc}</small></span></button>{/each}</div>{/if}</div><div class="model-dropdown" use:clickOutside><button class="model-button" bind:this={modelButtonRef} disabled={!models.length} aria-haspopup="listbox" aria-expanded={modelOpen} aria-label="模型" on:click={toggleModel}><span>{currentModelLabel}</span><svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1.5 2.5 4 5l2.5-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>{#if modelOpen}<div class="model-menu" class:up={modelMenuUp}><div class="model-search"><span>⌕</span><input bind:this={modelSearchInput} bind:value={modelQuery} placeholder="搜索模型…" aria-label="搜索模型" /></div><div class="model-list">{#each modelDropdownGroups as group (group.provider)}<div class="model-group-title">{group.provider}</div>{#each group.items as model (modelKey(model))}<button class="model-option" class:selected={modelKey(model) === currentModelKey} on:click={() => pickModel(model)}><span class="model-dot"></span><span class="model-name">{model.name}</span></button>{/each}{:else}<div class="model-empty">没有匹配的模型</div>{/each}</div></div>{/if}</div><div class="thinking-dropdown" use:clickOutsideThinking><button class="thinking-button" bind:this={thinkingButtonRef} disabled={!sidecarReady} aria-haspopup="true" aria-expanded={thinkingOpen} aria-label="思考深度" on:click={toggleThinking}><span class="thinking-label">思考：</span><span class="thinking-value">{thinkingLabel}</span><svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1.5 2.5 4 5l2.5-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>{#if thinkingOpen}<div class="thinking-menu" class:up={thinkingMenuUp}><div class="thinking-head"><strong>思考深度</strong><span class:max={thinkingMax}>{thinkingLabel}</span><button class="thinking-help-button" class:on={thinkingHelp} aria-label="档位说明" aria-expanded={thinkingHelp} on:click={toggleThinkingHelp}>?</button></div><div class="thinking-slider" style={`--p:${thinkingPercent}`}><div class="thinking-track"></div><div class="thinking-fill" class:max={thinkingMax}>{#if thinkingMax}<i class="thinking-pixel pixel-1"></i><i class="thinking-pixel pixel-2"></i><i class="thinking-pixel pixel-3"></i><i class="thinking-pixel pixel-4"></i><i class="thinking-pixel pixel-5"></i><i class="thinking-pixel pixel-6"></i><i class="thinking-pixel pixel-7"></i><i class="thinking-pixel pixel-8"></i>{/if}</div><input class="thinking-range" type="range" min="0" max={THINKING_LEVELS.length - 1} step="1" value={thinkingIndex} disabled={!sidecarReady} aria-label="思考档位" on:input={onThinkingInput} on:change={onThinkingChange} /></div><div class="thinking-ends"><span>更快</span><span>更聪明</span></div>{#if thinkingHelp}<ul class="thinking-help">{#each THINKING_LEVELS as level (level)}<li class:on={level === thinkingLevel}><b>{THINKING_LABELS[level]}</b><span>{THINKING_HELP[level]}</span></li>{/each}</ul>{/if}</div>{/if}</div><div class="ctx-dropdown" use:clickOutsideCtx><button class="ctx-button" class:empty={!activeSessionId || !ctxStats?.window} bind:this={ctxButtonRef} disabled={!sidecarReady} aria-label="上下文用量" aria-haspopup="true" aria-expanded={ctxOpen} on:click={toggleCtx}><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2"/>{#if ctxStats?.window}<circle cx="9" cy="9" r="7" fill="none" stroke="#5f8466" stroke-width="2" stroke-linecap="round" stroke-dasharray={ctxDash()} transform="rotate(-90 9 9)"/>{/if}</svg></button>{#if ctxOpen}<div class="ctx-menu" class:up={ctxMenuUp}>{#if !activeSessionId}<div class="ctx-empty"><strong>本会话尚未开始</strong><small>发送第一条消息后显示用量</small></div>{:else if !ctxStats?.window}<div class="ctx-empty"><strong>暂无用量数据</strong><small>发送消息后显示上下文占用</small></div>{:else}<div class="ctx-head"><strong>上下文容量（估算）</strong><span>{ctxProgress()}%</span></div><div class="ctx-row"><span>当前上下文</span><span>{fmtWan(ctxStats.currentContext)}</span></div><div class="ctx-row"><span>可用容量</span><span>{fmtWan(Math.max(0, ctxStats.window - ctxStats.currentContext))}</span></div><div class="ctx-row"><span>上下文窗口</span><span>{fmtWan(ctxStats.window)}</span></div><div class="ctx-bar"><i style="width:{ctxProgress()}%"></i></div><div class="ctx-divider"></div><div class="ctx-sub">本会话累计</div><div class="ctx-row"><span>总 Token</span><span>{fmtWan(ctxStats.totals.total)}</span></div><div class="ctx-row"><span>输入</span><span>{fmtWan(ctxStats.totals.input)}</span></div><div class="ctx-row"><span>输出</span><span>{fmtWan(ctxStats.totals.output)}</span></div><div class="ctx-row"><span>缓存读取</span><span>{fmtWan(ctxStats.totals.cacheRead)}</span></div><div class="ctx-row"><span>缓存写入</span><span>{fmtWan(ctxStats.totals.cacheWrite)}</span></div><div class="ctx-divider"></div><div class="ctx-row"><span>本地费率估算</span><span>${ctxStats.costUsd.toFixed(2)}</span></div><div class="ctx-row"><span>平均缓存命中率</span><span>{(ctxStats.cacheHitRate * 100).toFixed(1)}%</span></div><div class="ctx-note">按本地模型费率估算，未提供费率则为 0</div>{/if}</div>{/if}</div></div><div class="composer-right"><button class:imagegen-busy={imageGenBusy} class:stop={runState[activeSessionId]?.running} class="send" title={imageGenMode ? '生成图片' : runState[activeSessionId]?.running ? '停止当前任务' : '发送消息'} on:click={imageGenMode ? generateImage : runState[activeSessionId]?.running ? stop : () => submit('steer')}>{imageGenBusy ? '…' : imageGenMode ? '✦' : runState[activeSessionId]?.running ? '停止' : '发送'} <span>{imageGenBusy ? '' : imageGenMode ? '' : runState[activeSessionId]?.running ? '■' : '↑'}</span></button></div></div>
          </div>
        </div>
      </main>

      <aside class="workspace" class:collapsed={!showRight}>
        <div class="workspace-rail" aria-label="工作区工具">
          <button class:active={panel === '文档'} aria-label="文件" on:click={() => (panel = '文档')}>▱</button>
          <button class:active={panel === '变更'} aria-label="变更" on:click={() => (panel = '变更')}>⌘</button>
          <button class:active={panel === '终端'} aria-label="终端" on:click={() => (panel = '终端')}>⌁</button>
          <button class:active={panel === '运行'} aria-label="运行" on:click={() => (panel = '运行')}>◌</button>
          <span class="workspace-rail-spacer"></span>
          <button aria-label="刷新文件" on:click={() => void loadFiles()}>↻</button>
        </div>
        <div class="workspace-content">
        {#if panel === '文档'}
          <div class="resource-head"><span>项目文件</span><button aria-label="刷新文件" on:click={() => void loadFiles()}>↻</button></div>
          <div class="resource-tree">
            {#each filteredFiles as file}
              <button class:file-directory={file.kind === 'directory'} class:file-selected={selectedFile === file.path} on:click={() => file.kind === 'file' ? void previewFile(file.path) : void loadFiles()}>
                <span class="resource-chevron">{file.kind === 'directory' ? '›' : ''}</span><span class="resource-icon">{file.kind === 'directory' ? '□' : '·'}</span><span>{file.path}</span>
              </button>
            {:else}
              <div class="resource-empty">选择工作区后显示文件</div>
            {/each}
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
              <input class="commit-input" bind:value={commitMessage} placeholder="提交信息…" />
              <div class="git-actions-row">
                <button disabled={!sidecarReady} on:click={() => void stageFiles()}>暂存</button>
                <button disabled={!sidecarReady} on:click={() => void commitChanges()}>提交</button>
                <button disabled={!sidecarReady} on:click={() => void pushChanges()}>推送</button>
              </div>
            </div>
          </div>
        {:else if panel === '终端'}
          <Terminal visible={panel === '终端'} />
        {:else}
          <div class="panel-content"><div class="panel-title"><div><strong>运行中的任务</strong><small>当前没有后台进程</small></div></div><div class="empty-panel"><span>◌</span><strong>暂无运行任务</strong><small>Agent 启动开发服务器后会显示在这里</small></div></div>
        {/if}
        </div>
      </aside>
      {#if showRight}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="drag-handle" class:dragging={dragging === 'right'} role="separator" aria-label="调整右侧栏宽度" on:mousedown={(event) => startDrag(event, 'right')} on:dblclick={() => resetDrag('right')}></div>
      {/if}
    <footer class="statusbar"><span title={workspacePath}>{workspaceBase()}</span><span>{statusText()}</span><span>{sessions.length} 个会话 · 保存至 ~/.pi/agent/sessions</span></footer>
  </div>
  <Settings open={showSettings} connected={sidecarReady} info={settingsInfo} usageStats={usageStats} imageGenConfig={imageGenConfig} onSaveImageGenConfig={saveImageGenConfig} onclose={() => { showSettings = false; loadHiddenProviders() }} openDir={openDir} workspacePath={workspacePath} onChooseWorkspace={chooseWorkspace} onOpenRepo={() => void request('open_url', { url: 'https://github.com/TANGZZee/pi-desktop-next' })} providers={providers} onRefreshProviders={refreshProviders} onRefreshUsage={refreshUsage} />
</div>
