<!-- App.svelte — three-panel macOS style layout placeholder -->
<script lang="ts">
  // ponytail: placeholder, real layout after first dev session
</script>

<div class="shell">
  <div class="sidebar">sidebar</div>
  <div class="main">main</div>
  <div class="sidepanel">side panel</div>
</div>

<style>
  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    margin: 0;
  }
  .shell { display: flex; height: 100vh; width: 100vw; }
  .sidebar { width: 260px; border-right: 1px solid #e5e7eb; padding: 1rem; }
  .main { flex: 1; padding: 1rem; overflow-y: auto; }
  .sidepanel { width: 300px; border-left: 1px solid #e5e7eb; padding: 1rem; }
</style>