<script lang="ts">
  import { onDestroy, onMount } from 'svelte'

  export let size = 56

  let canvas: HTMLCanvasElement
  let raf = 0
  let observer: MutationObserver | undefined

  // 随主题/皮肤取色，避免深色下动画不可见
  let electronA = '#222'
  let electronB = '#6a6a6a'
  let nucleus = '#2a2a2a'
  let highlight = '#7a7a7a'

  function readColors() {
    const cs = getComputedStyle(document.documentElement)
    const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    electronA = read('--text', '#222')
    nucleus = read('--text', '#2a2a2a')
    electronB = read('--text-3', '#6a6a6a')
    highlight = read('--muted', '#7a7a7a')
  }

  const ORBITS = [
    { r: 0.26, ax: 0.20, ay: 1.15, speed: 1.15 },
    { r: 0.40, ax: 0.85, ay: 0.35, speed: -0.92 },
    { r: 0.54, ax: 0.45, ay: 1.05, speed: 0.78 },
    { r: 0.68, ax: 1.10, ay: 0.25, speed: -0.64 },
    { r: 0.82, ax: 0.30, ay: 0.95, speed: 0.52 }
  ]

  function draw(ctx: CanvasRenderingContext2D, s: number, t: number) {
    const c = s / 2
    const scale = s * 0.48
    ctx.clearRect(0, 0, s, s)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const yaw = t * 0.18
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)

    const project = (x: number, y: number, z: number) => {
      const x1 = x * cy + z * sy
      const z1 = -x * sy + z * cy
      return { x: c + x1, y: c - y * 0.92, z: z1 }
    }

    const dots: Array<{ x: number; y: number; z: number }> = []

    for (const orbit of ORBITS) {
      const radius = scale * orbit.r
      ctx.beginPath()
      const steps = 64
      for (let g = 0; g <= steps; g++) {
        const th = g / steps * Math.PI * 2
        const lx = Math.cos(th) * radius
        const ly = Math.sin(th) * radius
        const p = project(lx, ly * Math.cos(orbit.ax), ly * Math.sin(orbit.ax) * Math.cos(orbit.ay) + lx * Math.sin(orbit.ay) * 0.15)
        if (g === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.closePath()
      ctx.strokeStyle = 'rgba(70,70,70,.42)'
      ctx.lineWidth = Math.max(0.6, s * 0.012)
      ctx.stroke()

      const th = t * orbit.speed
      const lx = Math.cos(th) * radius
      const ly = Math.sin(th) * radius
      dots.push(project(lx, ly * Math.cos(orbit.ax), ly * Math.sin(orbit.ax) * Math.cos(orbit.ay) + lx * Math.sin(orbit.ay) * 0.15))
    }

    dots.sort((a, b) => a.z - b.z)
    const electronR = Math.max(1.1, s * 0.028)
    for (const p of dots) {
      ctx.fillStyle = p.z > 0 ? electronA : electronB
      ctx.beginPath()
      ctx.arc(p.x, p.y, electronR, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = nucleus
    ctx.beginPath()
    ctx.arc(c, c, Math.max(2.4, s * 0.055), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = highlight
    ctx.beginPath()
    ctx.arc(c - s * 0.012, c - s * 0.012, Math.max(0.8, s * 0.018), 0, Math.PI * 2)
    ctx.fill()
  }

  onMount(() => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    readColors()
    observer = new MutationObserver(readColors)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-appearance', 'data-density'] })
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const loop = (now: number) => {
      const px = Math.round(size * dpr)
      if (canvas.width !== px) {
        canvas.width = px
        canvas.height = px
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, size, now / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  })

  onDestroy(() => { cancelAnimationFrame(raf); observer?.disconnect() })
</script>

<canvas bind:this={canvas} class="atom" width={size} height={size} style={`width:${size}px;height:${size}px`} aria-hidden="true"></canvas>

<style>
  .atom { display: block; flex: none; }
</style>
