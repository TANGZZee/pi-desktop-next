<script lang="ts">
  type PanelTab = '文档' | '变更' | '终端' | '运行'
  type Session = { title: string; time: string; state?: 'active' | 'done' }

  const sessions: Session[] = [
    { title: '设计 pi-agent 桌面端', time: '刚刚', state: 'active' },
    { title: '优化 Percho 内存占用', time: '昨天', state: 'done' },
    { title: '研究 Tauri sidecar 架构', time: '周一' },
    { title: '添加 Git 工作台', time: '上周' }
  ]

  let activeSession = sessions[0].title
  let panel: PanelTab = '文档'
  let inputText = ''
  let showThinking = false
  let isRunning = false
  let sentMessages: string[] = []

  function submit() {
    const text = inputText.trim()
    if (!text) return
    sentMessages = [...sentMessages, text]
    inputText = ''
    isRunning = true
    window.setTimeout(() => (isRunning = false), 1400)
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      submit()
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
        <button class="workspace-button"><span class="folder-icon">⌂</span> 日常工作区 <span class="chevron">⌄</span></button>
        <button class="icon-button" aria-label="搜索">⌕</button>
        <button class="icon-button" aria-label="设置">⚙</button>
      </div>
    </header>

    <div class="app-grid">
      <aside class="sidebar">
        <div class="sidebar-head">
          <button class="new-button" on:click={() => (activeSession = '新会话')}><span>＋</span> 新建会话</button>
          <button class="small-icon" aria-label="更多">•••</button>
        </div>

        <div class="project-card">
          <div class="project-icon">⌘</div>
          <div><strong>日常工作区</strong><small>~/Projects</small></div>
          <span class="chevron">⌄</span>
        </div>

        <div class="segmented">
          <button class="selected">Chats</button><button>Files</button>
        </div>
        <label class="search"><span>⌕</span><input placeholder="搜索会话" /></label>

        <div class="session-heading"><span>会话</span><button aria-label="排序">⇅</button></div>
        <div class="sessions">
          {#each sessions as session}
            <button class:current={activeSession === session.title} class="session" on:click={() => (activeSession = session.title)}>
              <span class:live={session.state === 'active'} class:complete={session.state === 'done'} class="status-dot"></span>
              <span class="session-copy"><strong>{session.title}</strong><small>{session.time}</small></span>
              {#if activeSession === session.title}<span class="more">•••</span>{/if}
            </button>
          {/each}
        </div>

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
            <h2>第一版工作台结构</h2>
            <p>左侧管理项目和会话，中间负责与 Agent 工作，右侧用于查看文档、变更和运行结果。</p>
            <div class="feature-table"><div class="table-row table-head"><span>区域</span><span>职责</span><span>状态</span></div><div class="table-row"><span>会话栏</span><span>项目、Chats、Files</span><span class="muted">基础完成</span></div><div class="table-row"><span>Agent 区</span><span>思考、工具调用、插话</span><span class="blue">设计中</span></div><div class="table-row"><span>工作区</span><span>文档、Git、终端</span><span class="muted">待接入</span></div></div>
            <div class="tool-summary"><span class="tool-icon">✓</span><div><strong>已读取项目需求</strong><small>Percho · pi-desktop · Zosma Cowork</small></div><span class="tool-time">1.8s</span></div>
          </div>
          {#each sentMessages as message}
            <div class="message user-message"><div class="user-bubble">{message}</div><time>刚刚</time></div>
          {/each}
          {#if isRunning}<div class="running-line"><span class="spinner"></span> Agent 正在处理…</div>{/if}
        </div>

        <div class="composer-wrap">
          <div class="composer">
            <textarea bind:value={inputText} on:keydown={handleKeydown} placeholder="输入消息…  使用 @ 引用文件，/ 执行命令" rows="2"></textarea>
            <div class="composer-toolbar"><div class="composer-left"><button>＋</button><button>⌘ GLM 5.2 <span>⌄</span></button><button>思考：高 <span>⌄</span></button></div><div class="composer-right"><span class="hint">Enter 发送 · Alt+Enter 排队</span><button class:stop={isRunning} class="send" on:click={submit}>{isRunning ? '停止' : '发送'} <span>{isRunning ? '■' : '↑'}</span></button></div></div>
          </div>
          <div class="composer-note">Pi Agent 可以读取和修改当前工作区中的文件</div>
        </div>
      </main>

      <aside class="workspace">
        <div class="workspace-tabs">{#each ['文档', '变更', '终端', '运行'] as tab}<button class:active={panel === tab} on:click={() => (panel = tab as PanelTab)}>{tab}{#if tab === '变更'}<span class="badge">3</span>{/if}</button>{/each}</div>
        {#if panel === '文档'}
          <div class="document-toolbar"><span>Markdown · 278 行</span><span class="live-label"><i></i> Live</span><button>Source</button><button class="preview">Preview</button></div>
          <article class="document"><div class="eyebrow">PI AGENT 工作方案</div><h2>轻量化桌面 Agent<br />工作台</h2><p class="lead">基于 Percho 能力重构的个人 Pi Agent 桌面端，使用更轻量的 Tauri 壳和清晰的工作区布局。</p><div class="callout"><strong>设计原则</strong><p>让 Agent 的工作过程透明，让工作结果始终可审阅。</p></div><h3>一、核心定位</h3><p>它不是传统 IDE，也不是普通聊天软件，而是一个围绕 Agent 工作流设计的桌面应用。</p><h3>二、功能分区</h3><div class="mini-list"><div><b>01</b><span><strong>会话</strong><small>多项目、多会话、持久化历史</small></span></div><div><b>02</b><span><strong>过程</strong><small>Thinking、工具调用、插话与排队</small></span></div><div><b>03</b><span><strong>结果</strong><small>文档、Diff、终端与运行任务</small></span></div></div></article>
        {:else if panel === '变更'}
          <div class="panel-content"><div class="panel-title"><div><strong>工作区变更</strong><small>3 个文件已修改</small></div><button class="primary-small">提交变更</button></div><div class="change-item"><span class="file-dot modified">M</span><div><strong>src/App.svelte</strong><small>+42 −18</small></div></div><div class="change-item"><span class="file-dot modified">M</span><div><strong>src/app.css</strong><small>+118 −0</small></div></div><div class="change-item"><span class="file-dot added">A</span><div><strong>src/lib/agent.ts</strong><small>新文件</small></div></div><div class="diff-placeholder">选择文件查看 Diff</div></div>
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
