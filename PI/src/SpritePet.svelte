<script lang="ts">
  export let enabled = false
  export let url = ''
  export let frameW = 192
  export let frameH = 208
  export let frames = 6
  export let duration = 820

  let poke = false
  function jump() {
    poke = true
    window.setTimeout(() => (poke = false), 520)
  }
</script>

{#if enabled && url}
  <button
    class="sprite-pet"
    class:poke
    type="button"
    title="桌宠（点击互动）"
    aria-label="桌宠"
    on:click={jump}
    style={`width:${frameW}px;height:${frameH}px;background-image:url(${url});background-size:${frames * frameW}px ${frameH}px;animation-duration:${duration}ms`}
  ></button>
{/if}

<style>
  .sprite-pet {
    position: fixed;
    right: 24px;
    bottom: 20px;
    z-index: 40;
    padding: 0;
    border: 0;
    background-color: transparent;
    background-repeat: no-repeat;
    background-position: 0 0;
    animation: sprite-play 820ms steps(6) infinite;
    cursor: pointer;
  }
  .sprite-pet.poke { animation: sprite-play 820ms steps(6) infinite, hop .52s ease; }
  @keyframes sprite-play {
    from { background-position: 0 0; }
    to { background-position: -1152px 0; }
  }
  @keyframes hop {
    0%, 100% { transform: translateY(0); }
    40% { transform: translateY(-14px); }
  }
</style>
