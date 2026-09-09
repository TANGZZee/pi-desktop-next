<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { open, confirm } from '@tauri-apps/plugin-dialog'
  import Terminal from './Terminal.svelte'
  import Settings from './Settings.svelte'
  import { version } from '../package.json'

  type PanelTab = '文档' | '变更' | '终端' | '运行'
  type Session = { id: string; title: string; time: string; file?: string; state?: 'active' | 'done'; model?: string; thinking?: string }
  type ModelInfo = { provider: string; id: string; name: string; reasoning: boolean }
  type GitChange = { code: string; path: string }
  type SidecarResponse = { type: 'response'; id: number; ok: boolean; result: unknown; error?: string }
  type SentMessage = { text: string; at: string }
  type RunSlot = { reply: string; thinking: string; tool: string; running: boolean; queue: string[]; sent: SentMessage[] }
  type SettingsInfo = { node: string; sdk: string; agentDir: string; sessionDir: string; authProviders: string[] }

  let sessions: Session[] = [{ id: 'main', title: '新会话', time: '刚刚' }]

  let activeSession = '新会话'
  let activeSessionId = 'main'
  let panel: PanelTab = '文档'
  let leftTab: 'Chats' | 'Files' = 'Chats'
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
  let modelSearchInput: HTMLInputElement
  let modelButtonRef: HTMLButtonElement
  let settingsInfo: SettingsInfo | null = null
  // 与 SDK 保持一致：THINKING_LEVEL_OPTIONS / DEFAULT_THINKING_LEVEL
  const MODEL_SEPARATOR = '\u0000'
  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const THINKING_LABELS: Record<string, string> = { off: '关', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' }
  const DEFAULT_THINKING = 'medium'
  const pending = new Map<number, (value: SidecarResponse) => void>()
  let requestSequence = 0

  $: filteredSessions = sessions.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
  $: filteredFiles = files.filter((item) => item.path.toLowerCase().includes(query.toLowerCase()))
  $: currentModelKey = modelChoice(models, sessions, activeSessionId)
  $: currentModel = models.find((item) => modelKey(item) === currentModelKey)
  $: currentModelLabel = currentModel ? (currentModel.name.length > 14 ? `${currentModel.name.slice(0, 14)}…` : currentModel.name) : '选择模型'
  $: modelFilter = modelQuery.trim().toLowerCase()
  $: modelMatches = modelFilter ? models.filter((item) => item.name.toLowerCase().includes(modelFilter) || item.provider.toLowerCase().includes(modelFilter)) : models
  $: modelDropdownGroups = modelGroups(modelMatches)
  $: currentThinking = thinkingChoice(sessions, activeSessionId)
  $: thinkingIndex = Math.max(0, THINKING_LEVELS.indexOf(currentThinking))
  $: thinkingLabel = THINKING_LABELS[currentThinking] ?? currentThinking

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

  // 记住会话级的模型 / 思考档位选择
  function remember(id: string, patch: Partial<Session>) {
    sessions = sessions.map((item) => (item.id === id ? { ...item, ...patch } : item))
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

  function workspaceBase() {
    if (workspacePath === '.') return '当前目录'
    return workspacePath.split(/[\\/]/).pop() || workspacePath
  }

  function workspaceLabel() {
    return workspacePath === '.' ? '选择工作区' : workspaceBase()
  }

  function statusText() {
    if (!sidecarReady) return '未连接'
    const running = Object.values(runState).filter((slot) => slot.running).length
    return running > 0 ? `运行中 · ${running} 个会话` : '就绪'
  }

  function statusDotTitle(session: Session) {
    if (session.state === 'active') return '运行中'
    if (session.state === 'done') return '已完成'
    return '空闲'
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

  function toggleModel() {
    modelOpen = !modelOpen
    if (modelOpen) {
      modelQuery = ''
      const rect = modelButtonRef?.getBoundingClientRect()
      if (rect) modelMenuUp = window.innerHeight - rect.bottom < 360
      window.setTimeout(() => modelSearchInput?.focus(), 0)
    }
  }

  async function setModel(value: string) {
    if (!value || !sidecarReady) return
    const [provider, modelId] = value.split(MODEL_SEPARATOR)
    remember(activeSessionId, { model: value })
    const result = await request('set_model', { sessionId: activeSessionId, provider, modelId }) as { provider: string; id: string; thinkingLevel?: string } | null
    if (result) remember(activeSessionId, { model: `${result.provider}${MODEL_SEPARATOR}${result.id}`, thinking: result.thinkingLevel ?? thinkingChoice(sessions, activeSessionId) })
    else remember(activeSessionId, { model: undefined })
  }

  function pickModel(model: ModelInfo) {
    modelOpen = false
    modelQuery = ''
    void setModel(modelKey(model))
  }

  async function setThinking(level: string) {
    if (!level || !sidecarReady) return
    remember(activeSessionId, { thinking: level })
    const result = await request('set_thinking', { sessionId: activeSessionId, level }) as { level?: string } | null
    // setThinkingLevel 会按模型能力 clamp，以 sidecar 回传的实际档位为准
    remember(activeSessionId, { thinking: result?.level })
  }

  function chooseThinking(event: Event) {
    const index = Number((event.currentTarget as HTMLInputElement).value)
    const level = THINKING_LEVELS[index]
    if (!level) return
    void setThinking(level)
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
    const unlisten = await listen<AgentEnvelope>('agent-message', ({ payload }) => {
      if (payload.type === 'response' && payload.id) {
        pending.get(payload.id)?.(payload)
        pending.delete(payload.id)
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
        if (event.type === 'agent_end' || event.type === 'error') { patchSlot(id, { running: false, tool: '' }); markSession(id, 'done') }
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
  }

  function openDir(path: string) {
    if (sidecarReady && path) void request('open_dir', { path })
  }

  async function openSettings() {
    showSettings = true
    if (sidecarReady) {
      try {
        settingsInfo = await request('info') as SettingsInfo
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
    const id = activeSessionId
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
      void request('prompt', { sessionId: id, text, cwd: '.', behavior })
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
      submit(event.altKey ? 'followUp' : 'steer')
    }
  }
</script>

<svelte:head>
  <title>Pi Agent</title>
</svelte:head>

<div class="desktop">
  <div class="window">
    <header class="titlebar">
      <button class="panel-toggle" class:toggled={!showLeft} aria-label="切换左侧栏" on:click={() => (showLeft = !showLeft)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2.5"/><line x1="5.5" y1="2.5" x2="5.5" y2="13.5"/></svg>
      </button>
      <div class="brand"><span class="brand-mark">π</span><span>Pi Agent</span></div>
      <div class="title-actions">
        <button class="panel-toggle" class:toggled={!showRight} aria-label="切换右侧栏" on:click={() => (showRight = !showRight)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2.5"/><line x1="10.5" y1="2.5" x2="10.5" y2="13.5"/></svg>
        </button>
        <span class="conn-chip" class:connected={sidecarReady}><i></i>{sidecarReady ? '已连接' : '未连接'}</span>
      </div>
    </header>

    <div class="app-grid">
      <aside class="sidebar" class:collapsed={!showLeft}>
        <div class="sidebar-head">
          <button class="new-button" on:click={async () => {
            if (!sidecarReady) {
              const draftId = `draft-${Date.now()}`
              activeSession = '新会话'
              activeSessionId = draftId
              sessions = [{ id: draftId, title: '新会话', time: '刚刚' }, ...sessions]
              return
            }
            const id = `session-${Date.now()}`
            const created = await request('create_session', { sessionId: id, cwd: '.' }) as { id: string }
            activeSessionId = created.id
            activeSession = '新会话'
            sessions = [{ id: created.id, title: '新会话', time: '刚刚', state: 'active' }, ...sessions]
          }}><span>＋</span> 新建会话</button>
          <button class="workspace-button" title={workspacePath} on:click={chooseWorkspace}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l2 2h5A1.5 1.5 0 0 1 14.5 6v6.5A1.5 1.5 0 0 1 13 14H3A1.5 1.5 0 0 1 1.5 12.5V4Z"/></svg>
            <span class="workspace-label">{workspaceLabel()}</span>
          </button>
        </div>

        <div class="segmented">
          <button class:selected={leftTab === 'Chats'} on:click={() => (leftTab = 'Chats')}>Chats</button><button class:selected={leftTab === 'Files'} on:click={() => { leftTab = 'Files'; void loadFiles() }}>Files</button>
        </div>

        <label class="search"><span>⌕</span><input placeholder={leftTab === 'Chats' ? '搜索会话' : '搜索文件'} bind:value={query} /></label>

        {#if leftTab === 'Chats'}
          <div class="session-heading"><span>会话</span><span class="session-count">{filteredSessions.length}</span></div>
          <div class="sessions">
            {#each filteredSessions as session}
              <button class:current={activeSessionId === session.id} class="session" on:click={() => void selectSession(session)}>
                <span class:live={session.state === 'active'} class:complete={session.state === 'done'} class="status-dot" title={statusDotTitle(session)}></span>
                <span class="session-copy"><strong>{session.title}</strong><small>{session.time}</small></span>
              </button>
            {:else}
              <div class="file-empty">没有匹配的会话</div>
            {/each}
          </div>
        {:else}
          <div class="file-list">
            {#if filteredFiles.length}
              {#each filteredFiles as file}
                <button class:file-folder={file.kind === 'directory'} on:click={() => file.kind === 'file' && void previewFile(file.path)}><span>{file.kind === 'directory' ? '▸' : '·'}</span>{file.path}</button>
              {/each}
            {:else if files.length}
              <div class="file-empty">没有匹配的文件</div>
            {:else}
              <div class="file-empty">选择项目目录后显示文件</div>
            {/if}
          </div>
        {/if}

        <div class="sidebar-footer">
          <button class="icon-button" aria-label="打开设置" on:click={() => void openSettings()}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.4"/><path d="M8 1.7v2M8 12.3v2M14.3 8h-2M3.7 8h-2M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4M12.5 12.5l-1.4-1.4M4.9 4.9 3.5 3.5"/></svg>
          </button>
          <span class="version">v{version}</span>
        </div>
      </aside>

      <main class="chat">
        <div class="chat-header">
          <div><h1>{activeSession}</h1><p><span class="online-dot" class:offline={!sidecarReady}></span> Pi Agent · {workspaceBase()}</p></div>
        </div>

        <div class="messages" class:centered={isIdle(activeSessionId)}>
          {#if isIdle(activeSessionId)}
            <div class="empty-state">
              <div class="empty-mark">π</div>
              <h2>向 Pi Agent 描述任务</h2>
              <p>Enter 发送并插话 · Alt+Enter 排队 · 运行中可随时停止</p>
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
            {#if runState[activeSessionId]?.running}<div class="running-line"><span class="spinner"></span> Agent 正在处理…</div>{/if}
          {/if}
        </div>

        <div class="composer-wrap">
          <div class="composer">
            <textarea bind:this={composerInput} bind:value={inputText} on:keydown={handleKeydown} placeholder="输入消息…" rows="2"></textarea>
            <div class="composer-toolbar"><div class="composer-left"><div class="model-dropdown" use:clickOutside><button class="model-button" bind:this={modelButtonRef} disabled={!models.length} aria-haspopup="listbox" aria-expanded={modelOpen} aria-label="模型" on:click={toggleModel}><span>{currentModelLabel}</span><svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1.5 2.5 4 5l2.5-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>{#if modelOpen}<div class="model-menu" class:up={modelMenuUp}><div class="model-search"><span>⌕</span><input bind:this={modelSearchInput} bind:value={modelQuery} placeholder="搜索模型…" aria-label="搜索模型" /></div><div class="model-list">{#each modelDropdownGroups as group (group.provider)}<div class="model-group-title">{group.provider}</div>{#each group.items as model (modelKey(model))}<button class="model-option" class:selected={modelKey(model) === currentModelKey} on:click={() => pickModel(model)}><span class="model-dot"></span><span class="model-name">{model.name}</span></button>{/each}{:else}<div class="model-empty">没有匹配的模型</div>{/each}</div></div>{/if}</div><label class="thinking-slider"><span class="thinking-label">思考</span><input type="range" min="0" max={THINKING_LEVELS.length - 1} step="1" value={thinkingIndex} disabled={!sidecarReady} aria-label="思考档位" on:change={chooseThinking} /><span class="thinking-value">{thinkingLabel}</span></label></div><div class="composer-right"><span class="hint">Enter 插话 · Alt+Enter 排队</span><button class:stop={runState[activeSessionId]?.running} class="send" on:click={runState[activeSessionId]?.running ? stop : () => submit('steer')}>{runState[activeSessionId]?.running ? '停止' : '发送'} <span>{runState[activeSessionId]?.running ? '■' : '↑'}</span></button></div></div>
          </div>
          <div class="composer-note">Pi Agent 可以读取和修改当前工作区中的文件</div>
        </div>
      </main>

      <aside class="workspace" class:collapsed={!showRight}>
        <div class="workspace-tabs">{#each ['文档', '变更', '终端', '运行'] as tab}<button class:active={panel === tab} on:click={() => (panel = tab as PanelTab)}>{tab}{#if tab === '变更' && gitChanges.length}<span class="badge">{gitChanges.length}</span>{/if}</button>{/each}</div>
        {#if panel === '文档'}
          <div class="document-toolbar">
            {#if selectedFile}
              <span class="doc-name">{selectedFile}</span><span class="doc-stats">{documentStats()}</span>
            {:else}
              <span class="doc-name doc-empty-label">未选择文件</span>
            {/if}
            {#if selectedFile}
              <span class="doc-actions">
                {#if !editingFile}<button on:click={() => (editingFile = true)}>编辑</button>{:else}<button on:click={() => void saveFile()}>保存</button><button on:click={() => (editingFile = false)}>取消</button>{/if}
              </span>
            {/if}
          </div>
          <article class="document">
            {#if selectedFile}
              {#if editingFile}<textarea class="file-editor" bind:value={fileContent}></textarea>{:else}<pre class="file-preview">{fileContent}</pre>{/if}
            {:else}
              <div class="doc-empty">从左侧文件列表选择文件以预览</div>
            {/if}
          </article>
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
      </aside>
    </div>
    <footer class="statusbar"><span title={workspacePath}>{workspaceBase()}</span><span>{statusText()}</span><span>{sessions.length} 个会话 · 保存至 ~/.pi/agent/sessions</span></footer>
  </div>
  <Settings open={showSettings} connected={sidecarReady} info={settingsInfo} onclose={() => (showSettings = false)} openDir={openDir} />
</div>
