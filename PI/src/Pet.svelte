<script lang="ts">
  export let enabled = false
  let poke = false
  function jump() {
    poke = true
    window.setTimeout(() => (poke = false), 520)
  }
</script>

{#if enabled}
  <button class="pet" class:poke type="button" title="桌宠" aria-label="桌宠" on:click={jump}>
    <span class="ear left"></span>
    <span class="ear right"></span>
    <span class="body">
      <span class="eye"></span>
      <span class="eye"></span>
      <span class="mouth"></span>
    </span>
  </button>
{/if}

<style>
  .pet {
    position: fixed;
    right: 28px;
    bottom: 28px;
    z-index: 40;
    width: 64px;
    height: 64px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .body {
    position: absolute;
    left: 8px;
    bottom: 0;
    width: 48px;
    height: 42px;
    border-radius: 22px 22px 16px 16px;
    background: #3a3a3a;
    box-shadow: 0 6px 16px rgb(0 0 0 / 18%);
  }
  .ear {
    position: absolute;
    top: 8px;
    width: 14px;
    height: 16px;
    border-radius: 8px 8px 2px 2px;
    background: #3a3a3a;
  }
  .ear.left { left: 12px; transform: rotate(-18deg); }
  .ear.right { right: 12px; transform: rotate(18deg); }
  .eye {
    position: absolute;
    top: 14px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f2f2f2;
    animation: blink 4.8s infinite;
  }
  .eye:first-child { left: 12px; }
  .eye:nth-child(2) { right: 12px; }
  .mouth {
    position: absolute;
    left: 18px;
    bottom: 10px;
    width: 12px;
    height: 5px;
    border-bottom: 2px solid #d0d0d0;
    border-radius: 0 0 8px 8px;
  }
  .pet.poke { animation: hop .52s ease; }
  @keyframes hop {
    0%, 100% { transform: translateY(0); }
    40% { transform: translateY(-14px); }
  }
  @keyframes blink {
    0%, 92%, 100% { transform: scaleY(1); }
    96% { transform: scaleY(.1); }
  }
  :global(html[data-theme="dark"]) .body, :global(html[data-theme="dark"]) .ear { background: #d8d8d8; }
  :global(html[data-theme="dark"]) .eye { background: #222; }
  :global(html[data-theme="dark"]) .mouth { border-bottom-color: #444; }
</style>
