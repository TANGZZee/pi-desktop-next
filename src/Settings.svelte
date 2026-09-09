<script lang="ts">
  import { onMount } from 'svelte'
  import { version } from '../package.json'

  type ProviderInfo = { provider: string; modelCount: number; configured: boolean }
  type UsageStats = { sessions: number; turns: number; activeDays: number; totals: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; costUsd: number; costKnown: boolean; byModel: Array<{ model: string; tokens: number; turns: number }> }
  type SettingsInfo = { node: string; sdk: string; agentDir: string; sessionDir: string; authProviders: string[]; providers?: ProviderInfo[] }

  export let open = false
  export let connected = false
  export let info: SettingsInfo | null = null
  export let onclose: () => void = () => {}
  export let openDir: (path: string) => void = () => {}
  export let workspacePath: string | undefined = undefined
  export let onChooseWorkspace: (() => void) | undefined = undefined
  export let onOpenRepo: (() => void) | undefined = undefined
  export let providers: ProviderInfo[] | undefined = undefined
  export let usageStats: UsageStats | null = null
  export let onRefreshProviders: (() => void) | undefined = undefined
  export let onRefreshUsage: (() => void) | undefined = undefined

  type Tab = 'general' | 'models' | 'usage' | 'about'
  const TABS: Array<[Tab, string]> = [
    ['general', '通用'],
    ['models', '模型'],
    ['usage', '用量'],
    ['about', '关于']
  ]

  const SHELLS: Array<[string, string, string]> = [
    ['cmd', 'cmd', 'Windows 命令提示符'],
    ['powershell', 'powershell', 'Windows PowerShell'],
    ['pwsh', 'pwsh', 'PowerShell Core']
  ]

  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const THINKING_LABELS: Record<string, string> = { off: 'off', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' }
  const HIDDEN_PROVIDERS_KEY = 'pdn.hidden-providers'

  let tab: Tab = 'general'
  let autoName = localStorage.getItem('pdn.autoname') !== '0'
  let shell = localStorage.getItem('pdn.shell') || 'cmd'
  let thinking = 'medium'
  let hiddenProviders: string[] = []

  onMount(() => {
    const stored = localStorage.getItem('pdn.thinking')
    if (stored && THINKING_LEVELS.includes(stored)) thinking = stored
    hiddenProviders = readHiddenProviders()
  })

  function readHiddenProviders(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(HIDDEN_PROVIDERS_KEY) || '[]')
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  function setAutoName(checked: boolean) {
    autoName = checked
    localStorage.setItem('pdn.autoname', checked ? '1' : '0')
  }

  function setShell(value: string) {
    shell = value
    localStorage.setItem('pdn.shell', value)
  }

  function setThinking(value: string) {
    thinking = value
    localStorage.setItem('pdn.thinking', value)
  }

  function isProviderShown(provider: string) {
    return !hiddenProviders.includes(provider)
  }

  function setProviderShown(provider: string, shown: boolean) {
    const next = new Set(hiddenProviders)
    if (shown) next.delete(provider)
    else next.add(provider)
    hiddenProviders = [...next]
    localStorage.setItem(HIDDEN_PROVIDERS_KEY, JSON.stringify(hiddenProviders))
  }

  function formatTokens(value: number) {
    if (!value) return '0'
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
    return String(Math.round(value))
  }

  function workspaceBase() {
    if (!workspacePath || workspacePath === '.') return '未选择'
    return workspacePath.split(/[\\/]/).pop() || workspacePath
  }
</script>

<svelte:window on:keydown={(event) => { if (open && event.key === 'Escape') onclose() }} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="overlay" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) onclose() }}>
    <div class="card" role="dialog" aria-modal="true" aria-label="设置">
      <header class="head">
        <h2>设置</h2>
        <button class="close" aria-label="关闭" on:click={onclose}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
        </button>
      </header>

      <div class="main">
        <nav class="nav" aria-label="设置分类">
          {#each TABS as [value, label] (value)}
            <button class="nav-item" class:active={tab === value} on:click={() => (tab = value)}>{label}</button>
          {/each}
        </nav>

        <div class="content">
          {#if tab === 'general'}
            <section class="group">
              <h3>运行时与连接</h3>
              <div class="row">
                <span class="k">Sidecar</span>
                <span class="chip" class:on={connected}><i></i>{connected ? '已连接' : ''}</span>
              </div>
              <div class="row">
                <span class="k">当前工作区</span>
                <span class="path" title={workspacePath ?? ''}>{workspaceBase()}</span>
                {#if onChooseWorkspace}
                  <button on:click={onChooseWorkspace}>更换</button>
                {/if}
              </div>
            </section>

            <section class="group">
              <h3>对话</h3>
              <label class="think-row">
                <span>新会话默认思考档位</span>
                <input type="range" min="0" max="6" step="1" value={THINKING_LEVELS.indexOf(thinking)} on:input={(event) => setThinking(THINKING_LEVELS[Number((event.currentTarget as HTMLInputElement).value)])} />
                <span class="think-value">{THINKING_LABELS[thinking] ?? thinking}</span>
              </label>
              <p class="desc">新建会话时默认应用的思考档位，可随时在输入栏调整。</p>
              <label class="check-row">
                <input type="checkbox" checked={autoName} on:change={(event) => setAutoName((event.currentTarget as HTMLInputElement).checked)} />
                <span>自动命名会话</span>
              </label>
              <p class="desc">新会话首次发送消息时，自动用内容前 20 字命名。</p>
            </section>

            <section class="group">
              <h3>终端</h3>
              <div class="radio-list">
                {#each SHELLS as [value, label, desc] (value)}
                  <label class="radio-row">
                    <input type="radio" name="shell" value={value} checked={shell === value} on:change={() => setShell(value)} />
                    <span class="radio-copy"><strong>{label}</strong><small>{desc}</small></span>
                  </label>
                {/each}
              </div>
              <p class="desc">新建终端时使用的默认 shell。</p>
            </section>
          {:else if tab === 'usage'}
            <section class="group usage-group">
              <div class="section-head"><div><h3>Pi Agent 用量统计</h3><p class="desc">按当前工作区的 Pi 会话统计，不包含 DeepSeek Harness。</p></div><button class="ghost" on:click={() => onRefreshUsage?.()}>刷新</button></div>
              <div class="usage-cards">
                <div class="usage-card"><small>总 Token</small><strong>{formatTokens(usageStats?.totals.total ?? 0)}</strong><span>输入 {formatTokens(usageStats?.totals.input ?? 0)}</span></div>
                <div class="usage-card"><small>会话数</small><strong>{usageStats?.sessions ?? 0}</strong><span>活跃 {usageStats?.activeDays ?? 0} 天</span></div>
                <div class="usage-card"><small>对话轮次</small><strong>{usageStats?.turns ?? 0}</strong><span>当前工作区</span></div>
                <div class="usage-card"><small>费用估算</small><strong>{usageStats?.costKnown ? `$${(usageStats.costUsd ?? 0).toFixed(2)}` : '—'}</strong><span>{usageStats?.costKnown ? '按模型费率' : '暂无费率数据'}</span></div>
              </div>
            </section>
            <section class="group">
              <h3>模型用量</h3>
              {#if usageStats?.byModel?.length}
                <div class="usage-table"><div class="usage-table-head"><span>模型</span><span>Token</span><span>轮次</span></div>{#each usageStats.byModel as item (item.model)}<div class="usage-table-row"><span title={item.model}>{item.model}</span><span>{formatTokens(item.tokens)}</span><span>{item.turns}</span></div>{/each}</div>
              {:else}
                <p class="muted">暂无用量记录</p>
              {/if}
            </section>
          {:else if tab === 'models'}
            <section class="group">
              <div class="section-head">
                <p class="hint-line">模型目录来自 SDK 内置数据与本地缓存</p>
                {#if onRefreshProviders}
                  <button class="ghost" on:click={onRefreshProviders}>刷新</button>
                {/if}
              </div>
              <div class="provider-list">
                {#if providers?.length}
                  {#each providers as item (item.provider)}
                    <div class="provider-row">
                      <span class="provider-name">{item.provider}</span>
                      <span class="provider-count">{item.modelCount} 个模型</span>
                      <span class="badge" class:on={item.configured}><i></i>{item.configured ? '已配置' : '未配置'}</span>
                      <label class="switch" title={isProviderShown(item.provider) ? '在模型列表中显示' : '在模型列表中隐藏'}>
                        <input type="checkbox" checked={isProviderShown(item.provider)} aria-label={`显示 ${item.provider} 的模型`} on:change={(event) => setProviderShown(item.provider, (event.currentTarget as HTMLInputElement).checked)} />
                        <span class="track"><span class="thumb"></span></span>
                      </label>
                    </div>
                  {/each}
                {:else}
                  <p class="muted">载入中…</p>
                {/if}
              </div>
            </section>
          {:else}
            <section class="group">
              <h3>关于</h3>
              <div class="row"><span class="k">版本</span><span class="v">v{version}</span></div>
              <div class="row"><span class="k">技术栈</span><span class="v">Tauri 2 · Svelte 5 · Pi SDK 0.84</span></div>
              <div class="row"><span class="k">Node 版本</span><span class="v">{info?.node ?? '—'}</span></div>
              <div class="row"><span class="k">Pi SDK 版本</span><span class="v">{info?.sdk ?? '—'}</span></div>
              <div class="row">
                <span class="k">Agent 目录</span>
                <span class="path" title={info?.agentDir}>{info?.agentDir ?? '—'}</span>
                <button disabled={!connected || !info?.agentDir} on:click={() => info && openDir(info.agentDir)}>打开</button>
              </div>
              <div class="row">
                <span class="k">会话目录</span>
                <span class="path" title={info?.sessionDir}>{info?.sessionDir ?? '—'}</span>
                <button disabled={!connected || !info?.sessionDir} on:click={() => info && openDir(info.sessionDir)}>打开</button>
              </div>
              <div class="row">
                <span class="k">仓库</span>
                <span class="v link">https://github.com/TANGZZee/pi-desktop-next</span>
                {#if onOpenRepo}
                  <button on:click={onOpenRepo}>打开</button>
                {/if}
              </div>
            </section>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:24px; background:rgba(35,40,35,.28); }
  .card { display:flex; flex-direction:column; width:min(880px, 92vw); height:min(600px, 86vh); overflow:hidden; background:#fbfbfa; border:1px solid #d7d9d6; border-radius:14px; box-shadow:0 22px 60px rgba(40,46,40,.25); }
  .head { flex:none; display:flex; align-items:center; justify-content:space-between; padding:15px 18px; border-bottom:1px solid #e8eae7; }
  .head h2 { margin:0; font-size:13px; font-weight:600; letter-spacing:-.2px; color:#3c413c; }
  .close { display:grid; place-items:center; width:26px; height:26px; border-radius:7px; background:transparent; color:#9a9d9a; }
  .close:hover { background:#eef0ed; color:#4a504a; }
  .main { flex:1; display:flex; min-height:0; }
  .nav { flex:none; width:160px; padding:10px 0; border-right:1px solid #e8eae7; background:#f7f8f6; display:flex; flex-direction:column; gap:2px; }
  .nav-item { position:relative; display:block; width:100%; padding:8px 16px; background:transparent; color:#9a9d9a; font-size:11px; text-align:left; }
  .nav-item:hover { color:#4a504a; background:#eef0ed; }
  .nav-item.active { color:#3c413c; font-weight:600; background:#fbfbfa; }
  .nav-item.active::before { content:""; position:absolute; top:7px; bottom:7px; left:0; width:2px; border-radius:0 2px 2px 0; background:#3c413c; }
  .content { flex:1; min-width:0; overflow:auto; padding:20px; }
  .group { padding:0 0 16px; border-bottom:1px solid #eceeeb; }
  .group + .group { margin-top:16px; }
  .group:last-child { padding-bottom:0; border-bottom:0; }
  .group h3 { margin:0 0 10px; color:#a0a49f; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; }
  .row { display:flex; align-items:center; gap:10px; min-height:26px; font-size:11px; color:#4c504c; }
  .row + .row { margin-top:6px; }
  .k { flex:none; width:132px; color:#8a908a; font-size:10px; white-space:nowrap; }
  .v { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .path { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#6c706d; font:10px/1.4 'DM Mono', monospace; }
  .row button { flex:none; padding:5px 10px; border-radius:6px; background:#eef1ed; color:#596659; font-size:9px; }
  .row button:hover:not(:disabled) { background:#e2e7e1; }
  .row button:disabled { opacity:.45; cursor:default; }
  .chip { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border:1px solid #e2e4e1; border-radius:999px; background:#fff; color:#6c706d; font-size:9px; }
  .chip i { width:6px; height:6px; border-radius:50%; background:#d0806f; }
  .chip.on i { background:#6da477; }
  .muted { margin:0; color:#a4aaa4; font-size:10px; }
  .check-row { display:flex; align-items:center; gap:8px; margin-top:12px; font-size:11px; color:#4c504c; }
  .check-row input { accent-color:#5f8466; }
  .desc { margin:7px 0 0; color:#a0a5a0; font-size:9.5px; line-height:1.5; }
  .radio-list { display:flex; flex-direction:column; gap:2px; }
  .radio-row { display:flex; align-items:center; gap:8px; padding:4px 0; font-size:11px; color:#4c504c; }
  .radio-row input { accent-color:#5f8466; }
  .radio-copy { display:flex; flex-direction:column; }
  .radio-copy strong { font-size:10px; font-weight:500; color:#484c48; }
  .radio-copy small { color:#a0a5a0; font-size:9px; }
  .link { color:#5b7a63; }
  .think-row { display:flex; align-items:center; gap:10px; font-size:11px; color:#4c504c; }
  .think-row input[type="range"] { -webkit-appearance:none; appearance:none; flex:1; height:16px; margin:0; background:transparent; cursor:pointer; }
  .think-row input[type="range"]::-webkit-slider-runnable-track { height:3px; border-radius:2px; background:#dfe3df; }
  .think-row input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:10px; height:10px; margin-top:-3.5px; border-radius:50%; background:#fff; border:1px solid #c6ccc6; box-shadow:0 1px 2px rgba(0,0,0,.12); }
  .think-value { flex:none; min-width:28px; text-align:right; color:#5b625b; font-size:10px; }
  .section-head { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .hint-line { flex:1; margin:0; color:#a0a5a0; font-size:10px; }
  .ghost { flex:none; padding:5px 10px; border-radius:6px; background:#eef1ed; color:#596659; font-size:9px; }
  .ghost:hover { background:#e2e7e1; }
  .usage-group .section-head { align-items:flex-start; }
  .usage-group .section-head h3 { margin-bottom:3px; }
  .usage-group .section-head .desc { margin:0; }
  .usage-cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin-top:14px; }
  .usage-card { min-width:0; padding:10px; border:1px solid #e1e4df; border-radius:8px; background:#f7f8f5; }
  .usage-card small, .usage-card span { display:block; color:#929991; font-size:9px; }
  .usage-card strong { display:block; margin:5px 0 4px; color:#3d443e; font-size:16px; font-weight:600; }
  .usage-table { border:1px solid #e1e4df; border-radius:7px; overflow:hidden; }
  .usage-table-head, .usage-table-row { display:grid; grid-template-columns:minmax(0,1fr) 74px 48px; gap:8px; align-items:center; padding:7px 9px; font-size:10px; }
  .usage-table-head { background:#f1f3ef; color:#8d958c; font-size:9px; }
  .usage-table-row { border-top:1px solid #eceeeb; color:#555d55; }
  .usage-table-row span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .usage-table-row span:not(:first-child), .usage-table-head span:not(:first-child) { text-align:right; font-variant-numeric:tabular-nums; }
  @media (max-width:620px) { .usage-cards { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  .provider-list { display:flex; flex-direction:column; }
  .provider-row { display:flex; align-items:center; gap:10px; min-height:32px; padding:6px 0; border-top:1px solid #f0f2ef; font-size:11px; color:#4c504c; }
  .provider-row:first-child { border-top:0; }
  .provider-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .provider-count { flex:none; color:#a0a5a0; font-size:10px; }
  .badge { flex:none; display:inline-flex; align-items:center; gap:5px; padding:2px 7px; border:1px solid #e2e4e1; border-radius:999px; background:#fff; color:#9a9d9a; font-size:9px; }
  .badge i { width:6px; height:6px; border-radius:50%; background:#c9ccc9; }
  .badge.on { color:#5f8466; }
  .badge.on i { background:#6da477; }
  .switch { position:relative; flex:none; display:inline-flex; align-items:center; cursor:pointer; }
  .switch input { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer; }
  .track { display:block; width:26px; height:15px; border-radius:999px; background:#dfe3df; transition:background .15s; }
  .thumb { position:absolute; top:2px; left:2px; width:11px; height:11px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.18); transition:transform .15s; }
  .switch input:checked + .track { background:#6da477; }
  .switch input:checked + .track .thumb { transform:translateX(11px); }
  .switch input:focus-visible + .track { box-shadow:0 0 0 2px #dce9dd; }
</style>
