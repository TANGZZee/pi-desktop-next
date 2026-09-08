// main.ts — mount minimal shell
import './app.css'
import App from './App.svelte'

// @ts-expect-error target non-null (ponytail: id=app always exists in index.html)
new App({ target: document.getElementById('app') })