import type { ViteUserConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default <ViteUserConfig>{
  plugins: [svelte()],
  server: { port: 5173, watch: { ignored: ['**/src-tauri/**', '**/dist/**', '**/node_modules/**'] } },
  clearScreen: false
}
