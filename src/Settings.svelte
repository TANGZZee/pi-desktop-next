<script lang="ts">
  import { onMount } from 'svelte'
  import { version } from '../package.json'

  type SettingsInfo = { node: string; sdk: string; agentDir: string; sessionDir: string; authProviders: string[] }

  export let open = false
  export let connected = false
  export let info: SettingsInfo | null = null
  export let onclose: () => void = () => {}
  export let openDir: (path: string) => void = () => {}
  export let workspacePath: string | undefined = undefined
  export let onChooseWorkspace: (() => void) | undefined = undefined
  export let onOpenRepo: (() => void) | undefined = undefined

  const SHELLS: Array<[string, string, string]> = [
    ['cmd', 'cmd', 'Windows 命令提示符'],
    ['powershell', 'powershell', 'Windows PowerShell'],
    ['pwsh', 'pwsh', 'PowerShell Core']
  ]

  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const THINKING_LABELS: Record<string, string> = { off: 'off', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' }

  let autoName = localStorage.getItem('pdn.autoname') !== '0'
  let shell = localStorage.getItem('pdn.shell') || 'cmd'
  let thinking = 'medium'

  onMount(() => {
    const stored = localStorage.getItem('pdn.thinking')
    if (stored && THINKING_LEVELS.includes(stored)) thinking = stored
  })

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

      <div class="body">
        <section class="group">
          <h3>运行时与连接</h3>
          <div class="row">
            <span class="k">Sidecar</span>
            <span class="chip" class:on={connected}><i></i>{connected ? '已连接' : '未连接'}</span>
          </div>
          <div class="row">
            <span class="k">当前工作区</span>
            <span class="path" title={workspacePath ?? ''}>{workspaceBase()}</span>
            {#if onChooseWorkspace}
              <button on:click={onChooseWorkspace}>更换</button>
            {/if}
          </div>
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
        </section>

        <section class="group">
          <h3>模型与凭证</h3>
          <div class="row">
            <span class="k">auth.json 键名</span>
            <span class="keys">
              {#if info?.authProviders?.length}
                {#each info.authProviders as key (key)}<span class="key-chip">{key}</span>{/each}
              {:else}
                <span class="muted">无</span>
              {/if}
            </span>
          </div>
          <div class="row">
            <span class="k">models.json / auth.json</span>
            <span class="path" title={info?.agentDir}>{info?.agentDir ?? '—'}</span>
            <button disabled={!connected || !info?.agentDir} on:click={() => info && openDir(info.agentDir)}>打开</button>
          </div>
        </section>

        <section class="group">
          <h3>会话</h3>
          <label class="check-row">
            <input type="checkbox" checked={autoName} on:change={(event) => setAutoName((event.currentTarget as HTMLInputElement).checked)} />
            <span>自动命名会话</span>
          </label>
          <p class="desc">新会话首次发送消息时，自动用内容前 20 字命名。</p>
        </section>

        <section class="group">
          <h3>对话</h3>
          <label class="think-row">
            <span>新会话默认思考档位</span>
            <input type="range" min="0" max={THINKING_LEVELS.length - 1} step="1" value={THINKING_LEVELS.indexOf(thinking)} on:input={(event) => setThinking(THINKING_LEVELS[Number((event.currentTarget as HTMLInputElement).value)])} />
            <span class="think-value">{THINKING_LABELS[thinking] ?? thinking}</span>
          </label>
          <p class="desc">新建会话时默认应用的思考档位，可随时在输入栏调整。</p>
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

        <section class="group">
          <h3>关于</h3>
          <div class="row"><span class="k">版本</span><span class="v">v{version}</span></div>
          <div class="row"><span class="k">技术栈</span><span class="v">Tauri 2 · Svelte 5 · Pi SDK 0.84</span></div>
          <div class="row">
            <span class="k">仓库</span>
            <span class="v link">https://github.com/TANGZZee/pi-desktop-next</span>
            {#if onOpenRepo}
              <button on:click={onOpenRepo}>打开仓库</button>
            {/if}
          </div>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:24px; background:rgba(35,40,35,.28); }
  .card { width:min(420px, 100%); max-height:calc(100vh - 48px); overflow:auto; background:#fbfbfa; border:1px solid #d7d9d6; border-radius:14px; box-shadow:0 22px 60px rgba(40,46,40,.25); }
  .head { display:flex; align-items:center; justify-content:space-between; padding:15px 18px; border-bottom:1px solid #e8eae7; }
  .head h2 { margin:0; font-size:13px; font-weight:600; letter-spacing:-.2px; color:#3c413c; }
  .close { display:grid; place-items:center; width:26px; height:26px; border-radius:7px; background:transparent; color:#9a9d9a; }
  .close:hover { background:#eef0ed; color:#4a504a; }
  .body { padding:6px 18px 18px; }
  .group { padding:14px 0; border-bottom:1px solid #eceeeb; }
  .group:last-child { border-bottom:0; }
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
  .keys { flex:1; display:flex; flex-wrap:wrap; gap:5px; min-width:0; }
  .key-chip { padding:2px 7px; border-radius:5px; background:#f0f2ef; color:#5c635c; font:9px/1.5 'DM Mono', monospace; }
  .muted { color:#a4aaa4; font-size:10px; }
  .check-row { display:flex; align-items:center; gap:8px; font-size:11px; color:#4c504c; }
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
</style>
