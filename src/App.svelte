<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { open } from '@tauri-apps/plugin-dialog'

  type PanelTab = '文档' | '变更' | '终端' | '运行'
  type Session = { id: string; title: string; time: string; file?: string; state?: 'active' | 'done'; model?: string; thinking?: string }
  type ModelInfo = { provider: string; id: string; name: string; reasoning: boolean }
  type GitChange = { code: string; path: string }
  type RunSlot = { reply: string; thinking: string; tool: string; running: boolean; queue: string[]; sent: string[] }

  let sessions: Session[] = [
    { id: 'main', title: '设计 pi-agent 桌面端', time: '刚刚', state: 'active' },
    { id: 'memory', title: '优化 Percho 内存占用', time: '昨天', state: 'done' },
    { id: 'sidecar', title: '研究 Tauri sidecar 架构', time: '周一' },
    { id: 'git', title: '添加 Git 工作台', time: '上周' }
  ]

  let activeSession = sessions[0].title
  let activeSessionId = sessions[0].id
  let panel: PanelTab = '文档'
  let leftTab: 'Chats' | 'Files' = 'Chats'
  let workspacePath = '.'
  let files: Array<{ path: string; kind: 'file' | 'directory' }> = []
  let selectedFile = ''
  let fileContent = ''
  let editingFile = false
  let gitChanges: GitChange[] = []
  let diffContent = ''
  let inputText = ''
  let showThinking = false
  let runState: Record<string, RunSlot> = {}
  let sidecarReady = false
  let modelCount = 0
  let models: ModelInfo[] = []
  // 与 SDK 保持一致：THINKING_LEVEL_OPTIONS / DEFAULT_THINKING_LEVEL
  const MODEL_SEPARATOR = '\u0000'
  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const THINKING_LABELS: Record<string, string> = { off: '关', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' }
  const DEFAULT_THINKING = 'medium'
  const pending = new Map<number, (value: unknown) => void>()
  let requestSequence = 0

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

  async function chooseModel(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value
    if (!value || !sidecarReady) return
    const [provider, modelId] = value.split(MODEL_SEPARATOR)
    remember(activeSessionId, { model: value })
    const result = await request('set_model', { sessionId: activeSessionId, provider, modelId }) as { provider: string; id: string; thinkingLevel?: string } | null
    if (result) remember(activeSessionId, { model: `${result.provider}${MODEL_SEPARATOR}${result.id}`, thinking: result.thinkingLevel ?? thinkingChoice(sessions, activeSessionId) })
    else remember(activeSessionId, { model: undefined })
  }

  async function chooseThinking(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value
    if (!value || !sidecarReady) return
    remember(activeSessionId, { thinking: value })
    const result = await request('set_thinking', { sessionId: activeSessionId, level: value }) as { level?: string } | null
    // setThinkingLevel 会按模型能力 clamp，以 sidecar 回传的实际档位为准
    remember(activeSessionId, { thinking: result?.level })
  }

  function request(type: string, payload = {}) {
    const id = ++requestSequence
    const promise = new Promise<unknown>((resolve) => pending.set(id, resolve))
    void invoke('agent_request', { request: { id, type, payload } })
    return promise
  }

  onMount(async () => {
    const unlisten = await listen<AgentEnvelope>('agent-message', ({ payload }) => {
      if (payload.type === 'response' && payload.id) {
        pending.get(payload.id)?.(payload.result)
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
      modelCount = models.length
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

  function submit(behavior: 'steer' | 'followUp' = 'steer') {
    const text = inputText.trim()
    if (!text) return
    const id = activeSessionId
    const slot = slotFor(id)
    inputText = ''
    patchSlot(id, {
      sent: [...slot.sent, text],
      reply: '',
      thinking: '',
      running: true,
      queue: behavior === 'followUp' ? [...slot.queue, text] : slot.queue
    })
    if (sidecarReady) {
      void request('prompt', { sessionId: id, text, cwd: '.', behavior })
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
      <div class="traffic-lights" aria-label="窗口控制">
        <span class="light close"></span><span class="light minimize"></span><span class="light maximize"></span>
      </div>
      <div class="brand"><span class="brand-mark">π</span><span>Pi Agent</span></div>
      <div class="title-actions">
        <button class="workspace-button" on:click={chooseWorkspace}><span class="folder-icon">⌂</span> {workspacePath === '.' ? '选择工作区' : workspacePath.split(/[\\/]/).pop()} <span class="chevron">⌄</span></button>
        <button class="icon-button" aria-label="搜索">⌕</button>
        <button class="icon-button" aria-label="设置">⚙</button>
      </div>
    </header>

    <div class="app-grid">
      <aside class="sidebar">
        <div class="sidebar-head">
          <button class="new-button" on:click={async () => {
            if (!sidecarReady) { activeSession = '新会话'; activeSessionId = `draft-${Date.now()}`; return }
            const id = `session-${Date.now()}`
            const created = await request('create_session', { sessionId: id, cwd: '.' }) as { id: string }
            activeSessionId = created.id
            activeSession = '新会话'
            sessions = [{ id: created.id, title: '新会话', time: '刚刚', state: 'active' }, ...sessions]
          }}><span>＋</span> 新建会话</button>
          <button class="small-icon" aria-label="更多">•••</button>
        </div>

        <div class="project-card">
          <div class="project-icon">⌘</div>
          <div><strong>日常工作区</strong><small>~/Projects</small></div>
          <span class="chevron">⌄</span>
        </div>

        <div class="segmented">
          <button class:selected={leftTab === 'Chats'} on:click={() => (leftTab = 'Chats')}>Chats</button><button class:selected={leftTab === 'Files'} on:click={() => { leftTab = 'Files'; void loadFiles() }}>Files</button>
        </div>
        {#if leftTab === 'Chats'}

        <label class="search"><span>⌕</span><input placeholder="搜索会话" /></label>

        <div class="session-heading"><span>会话</span><button aria-label="排序">⇅</button></div>
        <div class="sessions">
          {#each sessions as session}
            <button class:current={activeSessionId === session.id} class="session" on:click={() => void selectSession(session)}>
              <span class:live={session.state === 'active'} class:complete={session.state === 'done'} class="status-dot"></span>
              <span class="session-copy"><strong>{session.title}</strong><small>{session.time}</small></span>
              {#if activeSessionId === session.id}<span class="more">•••</span>{/if}
            </button>
          {/each}
        </div>
        {:else}
          <div class="file-list">
            {#each files as file}
              <button class:file-folder={file.kind === 'directory'} on:click={() => file.kind === 'file' && void previewFile(file.path)}><span>{file.kind === 'directory' ? '▸' : '·'}</span>{file.path}</button>
            {:else}
              <div class="file-empty">选择项目目录后显示文件</div>
            {/each}
          </div>
        {/if}

        <div class="sidebar-bottom">
          <button><span>◈</span> 模型 <small>GLM 5.2</small></button>
          <button><span>✧</span> Skills <small>已加载 8</small></button>
          <button><span>◌</span> Plugins <small>管理</small></button>
        </div>
      </aside>

      <main class="chat">
        <div class="chat-header">
          <div><h1>{activeSession}</h1><p><span class="online-dot"></span> Pi Agent · 日常工作区</p></div>
          <div class="chat-header-actions"><button>历史记录</button><button>分支</button><button>•••</button></div>
        </div>

        <div class="messages">
          <div class="message user-message"><div class="user-bubble">我想做一个自己的 Pi Agent 桌面端，界面要高级、简约，像 macOS。</div><time>14:08</time></div>
          <div class="message assistant-message">
            <div class="message-meta"><span class="assistant-avatar">π</span><strong>Pi Agent</strong><span>GLM 5.2</span></div>
            <p>明白。我会以 Percho 的 Agent 能力为基础，吸收 pi-desktop 和 Zosma Cowork 的优点，重新组织成一个更轻量的桌面工作台。</p>
            <button class="process" on:click={() => (showThinking = !showThinking)}><span>{showThinking ? '⌄' : '›'}</span> Process details <em>· 4 个步骤</em></button>
            {#if showThinking}
              <div class="thinking-detail"><div><i></i>分析 Percho 现有功能边界</div><div><i></i>规划 Tauri + Node sidecar 通信</div><div><i></i>整理三栏工作台信息层级</div></div>
            {/if}
            {#if runState[activeSessionId]?.thinking}<div class="thinking-live"><span class="spinner"></span> {runState[activeSessionId]?.thinking}</div>{/if}
            {#if runState[activeSessionId]?.tool}<div class="tool-live"><span>◌</span> {runState[activeSessionId]?.tool}</div>{/if}
            {#if (runState[activeSessionId]?.queue ?? []).length}<div class="queue-live">⌁ 已排队 {(runState[activeSessionId]?.queue ?? []).length} 条消息（Alt+Enter）</div>{/if}
            <h2>第一版工作台结构</h2>
            <p>左侧管理项目和会话，中间负责与 Agent 工作，右侧用于查看文档、变更和运行结果。</p>
            <div class="feature-table"><div class="table-row table-head"><span>区域</span><span>职责</span><span>状态</span></div><div class="table-row"><span>会话栏</span><span>项目、Chats、Files</span><span class="muted">基础完成</span></div><div class="table-row"><span>Agent 区</span><span>思考、工具调用、插话</span><span class="blue">设计中</span></div><div class="table-row"><span>工作区</span><span>文档、Git、终端</span><span class="muted">待接入</span></div></div>
            <div class="tool-summary"><span class="tool-icon">✓</span><div><strong>已读取项目需求</strong><small>Percho · pi-desktop · Zosma Cowork</small></div><span class="tool-time">1.8s</span></div>
          </div>
          {#each runState[activeSessionId]?.sent ?? [] as message}
            <div class="message user-message"><div class="user-bubble">{message}</div><time>刚刚</time></div>
          {/each}
          {#if runState[activeSessionId]?.reply}<div class="message assistant-message"><div class="message-meta"><span class="assistant-avatar">π</span><strong>Pi Agent</strong><span>实时回复</span></div><p>{runState[activeSessionId]?.reply}</p></div>{/if}
          {#if runState[activeSessionId]?.running}<div class="running-line"><span class="spinner"></span> Agent 正在处理…</div>{/if}
        </div>

        <div class="composer-wrap">
          <div class="composer">
            <textarea bind:value={inputText} on:keydown={handleKeydown} placeholder="输入消息…  使用 @ 引用文件，/ 执行命令" rows="2"></textarea>
            <div class="composer-toolbar"><div class="composer-left"><button>＋</button><select class="picker" aria-label="模型" disabled={!models.length} value={modelChoice(models, sessions, activeSessionId)} on:change={chooseModel}>{#each modelGroups(models) as group (group.provider)}<optgroup label={group.provider}>{#each group.items as model (modelKey(model))}<option value={modelKey(model)}>{model.name}</option>{/each}</optgroup>{/each}</select><select class="picker" aria-label="思考档位" disabled={!sidecarReady} value={thinkingChoice(sessions, activeSessionId)} on:change={chooseThinking}>{#each THINKING_LEVELS as level (level)}<option value={level}>思考：{THINKING_LABELS[level] ?? level}</option>{/each}</select></div><div class="composer-right"><span class="hint">Enter 插话 · Alt+Enter 排队</span><button class:stop={runState[activeSessionId]?.running} class="send" on:click={runState[activeSessionId]?.running ? stop : () => submit('steer')}>{runState[activeSessionId]?.running ? '停止' : '发送'} <span>{runState[activeSessionId]?.running ? '■' : '↑'}</span></button></div></div>
          </div>
          <div class="composer-note">Pi Agent 可以读取和修改当前工作区中的文件</div>
        </div>
      </main>

      <aside class="workspace">
        <div class="workspace-tabs">{#each ['文档', '变更', '终端', '运行'] as tab}<button class:active={panel === tab} on:click={() => (panel = tab as PanelTab)}>{tab}{#if tab === '变更'}<span class="badge">3</span>{/if}</button>{/each}</div>
        {#if panel === '文档'}
          <div class="document-toolbar"><span>Markdown · 278 行</span><span class="live-label"><i></i> Live</span><button>Source</button><button class="preview">Preview</button></div>
          {#if selectedFile}
            <article class="document"><div class="eyebrow">FILE PREVIEW</div><h2>{selectedFile}</h2><div class="document-file-actions"><span>{editingFile ? '编辑文件' : '只读预览'}</span><div>{#if !editingFile}<button on:click={() => (editingFile = true)}>编辑</button>{:else}<button on:click={() => void saveFile()}>保存</button><button on:click={() => (editingFile = false)}>取消</button>{/if}</div></div>{#if editingFile}<textarea class="file-editor" bind:value={fileContent}></textarea>{:else}<pre class="file-preview">{fileContent}</pre>{/if}</article>
          {:else}
            <article class="document"><div class="eyebrow">PI AGENT 工作方案</div><h2>轻量化桌面 Agent<br />工作台</h2><p class="lead">基于 Percho 能力重构的个人 Pi Agent 桌面端，使用更轻量的 Tauri 壳和清晰的工作区布局。</p><div class="callout"><strong>设计原则</strong><p>让 Agent 的工作过程透明，让工作结果始终可审阅。</p></div><h3>一、核心定位</h3><p>它不是传统 IDE，也不是普通聊天软件，而是一个围绕 Agent 工作流设计的桌面应用。</p><h3>二、功能分区</h3><div class="mini-list"><div><b>01</b><span><strong>会话</strong><small>多项目、多会话、持久化历史</small></span></div><div><b>02</b><span><strong>过程</strong><small>Thinking、工具调用、插话与排队</small></span></div><div><b>03</b><span><strong>结果</strong><small>文档、Diff、终端与运行任务</small></span></div></div></article>
          {/if}
        {:else if panel === '变更'}
          <div class="panel-content"><div class="panel-title"><div><strong>工作区变更</strong><small>{gitChanges.length} 个文件已修改</small></div><button class="primary-small" on:click={() => void refreshGit()}>刷新</button></div>{#each gitChanges as change}<button class="change-item" on:click={() => void loadDiff(change.path)}><span class="file-dot" class:modified={change.code.includes('M')} class:added={change.code.includes('A') || change.code.includes('?')}>{change.code.includes('A') || change.code.includes('?') ? 'A' : 'M'}</span><div><strong>{change.path}</strong><small>{change.code}</small></div></button>{:else}<div class="diff-placeholder">当前工作区没有未提交变更</div>{/each}{#if diffContent}<pre class="diff-content">{diffContent}</pre>{/if}</div>
        {:else if panel === '终端'}
          <div class="terminal"><div><span>$</span> npm run dev</div><div class="terminal-muted">VITE v5.4.6 ready in 412 ms</div><div class="terminal-muted">➜ Local: http://localhost:5173/</div><div><span>$</span> pi --version</div><div>0.85.1</div><div class="cursor">▌</div></div>
        {:else}
          <div class="panel-content"><div class="panel-title"><div><strong>运行中的任务</strong><small>当前没有后台进程</small></div></div><div class="empty-panel"><span>◌</span><strong>暂无运行任务</strong><small>Agent 启动开发服务器后会显示在这里</small></div></div>
        {/if}
      </aside>
    </div>
    <footer class="statusbar"><span>⌘ 日常工作区</span><span>Ready</span><span>本地会话 · 自动保存</span></footer>
  </div>
</div>
