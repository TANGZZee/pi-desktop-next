<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { listen, type UnlistenFn } from '@tauri-apps/api/event'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'

  let { visible = false }: { visible?: boolean } = $props()

  let host: HTMLDivElement
  let term: Terminal
  let fit: FitAddon
  let ptyId: number | undefined
  let unlisten: UnlistenFn | undefined

  onMount(async () => {
    term = new Terminal({
      fontSize: 11,
      fontFamily: "'DM Mono', monospace",
      theme: { background: '#202622', foreground: '#c7d4c9' }
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    term.focus()

    const shell = localStorage.getItem('pdn.shell') || 'cmd'
    ptyId = await invoke<number>('pty_spawn', { shell })

    unlisten = await listen<{ id: number; data: string }>('pty-output', ({ payload }) => {
      if (payload.id === ptyId) term.write(payload.data)
    })

    term.onData((data) => {
      if (ptyId !== undefined) void invoke('pty_write', { id: ptyId, data }).catch(() => {})
    })

    const handleResize = () => fit.fit()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (ptyId !== undefined) void invoke('pty_kill', { id: ptyId }).catch(() => {})
      unlisten?.()
      term?.dispose()
    }
  })

  $effect(() => {
    if (visible && term && fit) fit.fit()
  })
</script>

<div class="terminal-host" bind:this={host}></div>
