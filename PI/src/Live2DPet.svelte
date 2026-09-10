<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import * as PIXI from 'pixi.js'
  import { Live2DModel } from 'pixi-live2d-display'

  export let enabled = false
  export let url = ''
  export let width = 200
  export let height = 260

  const CORE4 = 'https://cdn.jsdelivr.net/gh/wan-h/awesome-digital-human-live2d@main/web/lib/live2d/Core/live2dcubismcore.min.js'
  const CORE2 = 'https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js'

  let host: HTMLDivElement
  let app: PIXI.Application | undefined
  let model: Live2DModel | undefined
  let loading = false
  let error = ''

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = `pet-script:${src}`
      if (document.getElementById(id)) return resolve()
      const script = document.createElement('script')
      script.id = id
      script.src = src
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Live2D 核心加载失败'))
      document.head.appendChild(script)
    })
  }

  function fitModel(m: Live2DModel) {
    const scale = Math.min(width / (m.width || width), height / (m.height || height)) * 0.92
    m.scale.set(scale)
    m.anchor.set(0.5, 0.5)
    m.x = width / 2
    m.y = height / 2
  }

  async function init() {
    if (!url || !host) return
    loading = true
    error = ''
    try {
      await loadScript(CORE4)
      await loadScript(CORE2)
      Live2DModel.registerTicker(PIXI.Ticker)
      app = new PIXI.Application({ width, height, backgroundAlpha: 0, antialias: true, autoDensity: true })
      host.appendChild(app.view)
      model = await Live2DModel.from(url, { autoInteract: true })
      fitModel(model)
      app.stage.addChild(model)
    } catch (e) {
      error = e instanceof Error ? e.message : '加载失败'
    } finally {
      loading = false
    }
  }

  function destroy() {
    try { model?.destroy() } catch { /* ignore */ }
    try { app?.destroy(true, { children: true, texture: true }) } catch { /* ignore */ }
    model = undefined
    app = undefined
  }

  onMount(() => {
    if (enabled && url) void init()
  })

  onDestroy(destroy)
</script>

{#if enabled && url}
  <div class="live2d-pet" class:loading bind:this={host} title="桌宠（点击互动）">
    {#if loading}<span class="pet-status">加载中…</span>{/if}
    {#if error}<span class="pet-status error" title={error}>加载失败</span>{/if}
  </div>
{/if}

<style>
  .live2d-pet {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 40;
    width: 200px;
    height: 260px;
    pointer-events: auto;
  }
  .live2d-pet :global(canvas) {
    display: block;
    cursor: pointer;
  }
  .pet-status {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    color: #888;
    font-size: 12px;
    pointer-events: none;
  }
  .pet-status.error { color: #c42b1c; }
</style>
