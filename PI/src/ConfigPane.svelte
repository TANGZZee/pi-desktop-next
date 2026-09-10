<script lang="ts">
  import { onMount } from 'svelte'

  type Rpc = ((type: string, payload?: Record<string, unknown>) => Promise<unknown>) | undefined
  type ConfigNav = 'models' | 'auth' | 'settings' | 'raw'
  type RawKind = 'models' | 'auth' | 'settings'
  type Thinking = '' | 'xhigh' | 'max'
  type ModelCost = { input: number; output: number; cacheRead: number; cacheWrite: number }
  type ModelDraft = {
    id: string
    name: string
    reasoning: boolean
    contextWindow: number
    maxTokens: number
    thinking: Thinking
    image: boolean
    inputRate: string
    outputRate: string
    cacheReadRate: string
    cacheWriteRate: string
    extra: Record<string, unknown>
  }
  type ProviderDraft = {
    name: string
    baseUrl: string
    api: string
    apiKey: string
    userAgent: string
    balanceUrl: string
    supportsDeveloperRole: boolean
    supportsReasoningEffort: boolean
    models: ModelDraft[]
    extra: Record<string, unknown>
  }
  type AuthRow = { name: string; type: string; key: string; extra: Record<string, unknown> }
  type TestState = { busy?: boolean; ok?: boolean; message?: string; value?: number }
  type FetchedModel = { id: string; name?: string; reasoning?: boolean; imageInput?: boolean; contextWindow?: number; maxTokens?: number; cost?: ModelCost }

  export let open = false
  export let connected = false
  export let rpc: Rpc = undefined
  export let dirty = false
  export let saveHandler: { current: () => Promise<void> } = { current: async () => {} }
  export let onRefreshProviders: (() => void) | undefined = undefined
  export let onPrefsChange: () => void = () => {}

  const NAV: Array<[ConfigNav, string]> = [
    ['models', '模型'],
    ['auth', '认证'],
    ['settings', '设置'],
    ['raw', '源文件']
  ]
  const APIS = [
    'openai-completions',
    'anthropic-messages',
    'openai-responses',
    'openai-codex-responses',
    'google-generative-ai',
    'mistral-conversations'
  ]
  const AUTH_PRESETS = ['anthropic', 'openai', 'google', 'deepseek', 'openrouter', 'groq', 'mistral', 'xai', 'together', 'moonshot', 'minimax', 'zai']
  const HIDDEN_KEY = 'pdn.hidden-providers'
  const KNOWN_PROVIDER = new Set(['baseUrl', 'api', 'apiKey', 'headers', 'compat', 'models', 'balanceUrl'])
  const KNOWN_MODEL = new Set(['id', 'name', 'reasoning', 'contextWindow', 'maxTokens', 'thinkingLevelMap', 'input', 'cost'])

  let nav: ConfigNav = 'models'
  let providers: ProviderDraft[] = []
  let authRows: AuthRow[] = []
  let settingsMap: Array<[string, string, string]> = []
  let modelsSnap = '[]'
  let authSnap = '[]'
  let settingsSnap = '[]'
  let rawSnap = ''
  let rawKind: RawKind = 'models'
  let configRaw = ''
  let configPath = ''
  let configError = ''
  let saving = false
  let expanded = ''
  let adding = false
  let addDraft: ProviderDraft = emptyProvider()
  let showGuide = false
  let hiddenProviders: string[] = []
  let revealKey: Record<string, boolean> = {}
  let tests: Record<string, TestState> = {}
  let probes: Record<string, TestState> = {}
  let testModel: Record<string, string> = {}
  let fetching: Record<string, boolean> = {}
  let fetched: Record<string, FetchedModel[]> = {}
  let picked: Record<string, string[]> = {}
  let fetchError: Record<string, string> = {}
  let fetchQuery: Record<string, string> = {}
  let fillBusy: Record<string, boolean> = {}
  let fillError: Record<string, string> = {}
  let ratesOpen: Record<string, boolean> = {}
  let balances: Record<string, TestState> = {}
  let notice = ''
  let hydrated = false
  let addAuthName = ''

  $: modelsDirty = JSON.stringify(providers) !== modelsSnap
  $: authDirty = JSON.stringify(authRows) !== authSnap
  $: settingsDirty = JSON.stringify(settingsMap) !== settingsSnap
  $: rawDirty = configRaw !== rawSnap
  $: dirty = nav === 'models' ? modelsDirty : nav === 'auth' ? authDirty : nav === 'settings' ? settingsDirty : rawDirty
  $: saveHandler.current = saveCurrent
  $: if (open && connected && !hydrated) {
    hydrated = true
    void hydrate()
  }
  $: if (!open) hydrated = false

  onMount(() => {
    hiddenProviders = readHidden()
    try {
      const last = localStorage.getItem('pdn.config-nav') as ConfigNav | null
      if (last && NAV.some(([id]) => id === last)) nav = last
    } catch { /* ignore */ }
  })

  function emptyProvider(): ProviderDraft {
    return {
      name: '',
      baseUrl: '',
      api: 'openai-completions',
      apiKey: '',
      userAgent: '',
      balanceUrl: '',
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      models: [],
      extra: {}
    }
  }

  function emptyModel(): ModelDraft {
    return { id: '', name: '', reasoning: false, contextWindow: 0, maxTokens: 0, thinking: '', image: false, inputRate: '', outputRate: '', cacheReadRate: '', cacheWriteRate: '', extra: {} }
  }

  function parseRate(raw: string) {
    const text = raw.trim()
    if (!text) return null
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null
    const value = Number(text)
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  function roundUsd(value: number) {
    return Math.round(value * 1e6) / 1e6
  }

  function formatUsd(value: number) {
    const rounded = roundUsd(value)
    if (rounded === 0) return '$0'
    if (rounded >= 0.01) return `$${rounded.toFixed(2)}`
    return `$${rounded.toFixed(4).replace(/0+$/, '')}`
  }

  function readCost(model: ModelDraft): ModelCost | null {
    const parsed = [parseRate(model.inputRate), parseRate(model.outputRate), parseRate(model.cacheReadRate), parseRate(model.cacheWriteRate)]
    if (parsed.every((value) => value === null)) return null
    if (parsed.some((value) => value === null)) return null
    return { input: parsed[0] as number, output: parsed[1] as number, cacheRead: parsed[2] as number, cacheWrite: parsed[3] as number }
  }


  function costFromUnknown(raw: unknown): ModelCost | null {
    if (!raw || typeof raw !== 'object') return null
    const rec = raw as Record<string, unknown>
    const input = Number(rec.input)
    const output = Number(rec.output)
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null
    return {
      input,
      output,
      cacheRead: Number.isFinite(Number(rec.cacheRead)) ? Number(rec.cacheRead) : 0,
      cacheWrite: Number.isFinite(Number(rec.cacheWrite)) ? Number(rec.cacheWrite) : 0
    }
  }

  function ratesFromCost(cost: ModelCost | null) {
    if (!cost) return { inputRate: '', outputRate: '', cacheReadRate: '', cacheWriteRate: '' }
    return {
      inputRate: String(cost.input),
      outputRate: String(cost.output),
      cacheReadRate: String(cost.cacheRead),
      cacheWriteRate: String(cost.cacheWrite)
    }
  }

  function readHidden(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  function setNav(next: ConfigNav) {
    nav = next
    try { localStorage.setItem('pdn.config-nav', next) } catch { /* ignore */ }
    if (next === 'raw') void loadRaw(rawKind)
  }

  function parseModel(raw: unknown): ModelDraft {
    const rec = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const extra: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(rec)) if (!KNOWN_MODEL.has(key)) extra[key] = value
    const map = rec.thinkingLevelMap && typeof rec.thinkingLevelMap === 'object' ? rec.thinkingLevelMap as Record<string, unknown> : {}
    const input = Array.isArray(rec.input) ? rec.input.map(String) : []
    const thinking = map.xhigh === 'max' || map.xhigh === 'xhigh' ? map.xhigh : ''
    return {
      id: String(rec.id || rec.name || ''),
      name: String(rec.name || rec.id || ''),
      reasoning: Boolean(rec.reasoning),
      contextWindow: Number(rec.contextWindow) || 0,
      maxTokens: Number(rec.maxTokens) || 0,
      thinking,
      image: input.includes('image'),
      ...ratesFromCost(costFromUnknown(rec.cost)),
      extra
    }
  }

  function serializeModel(model: ModelDraft) {
    const out: Record<string, unknown> = { ...model.extra, id: model.id.trim(), name: (model.name || model.id).trim() }
    if (model.reasoning) out.reasoning = true
    else delete out.reasoning
    if (model.contextWindow) out.contextWindow = model.contextWindow
    else delete out.contextWindow
    if (model.maxTokens) out.maxTokens = model.maxTokens
    else delete out.maxTokens
    if (model.thinking) out.thinkingLevelMap = { xhigh: model.thinking }
    else delete out.thinkingLevelMap
    out.input = model.image ? ['text', 'image'] : ['text']
    const cost = readCost(model)
    if (cost) out.cost = cost
    else delete out.cost
    return out
  }

  function parseProviders(parsed: unknown): ProviderDraft[] {
    const bag = parsed && typeof parsed === 'object' ? (parsed as { providers?: Record<string, unknown> }).providers : undefined
    if (!bag || typeof bag !== 'object') return []
    return Object.entries(bag).map(([name, raw]) => {
      const rec = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      const extra: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(rec)) if (!KNOWN_PROVIDER.has(key)) extra[key] = value
      const headers = rec.headers && typeof rec.headers === 'object' ? rec.headers as Record<string, unknown> : {}
      const compat = rec.compat && typeof rec.compat === 'object' ? rec.compat as Record<string, unknown> : {}
      const markup = Number(rec.markup)
      const markupValue = Number.isFinite(markup) && markup > 0 ? markup : 1
      const models = Array.isArray(rec.models) ? rec.models.map((model) => parseModel(model, markupValue)) : []
      return {
        name,
        baseUrl: String(rec.baseUrl || ''),
        api: String(rec.api || 'openai-completions'),
        apiKey: String(rec.apiKey || ''),
        userAgent: String(headers['User-Agent'] || headers['user-agent'] || ''),
        markup: String(markupValue),
        balanceUrl: String(rec.balanceUrl || ''),
        supportsDeveloperRole: Boolean(compat.supportsDeveloperRole),
        supportsReasoningEffort: Boolean(compat.supportsReasoningEffort),
        models,
        extra
      }
    })
  }

  function serializeProviders() {
    const bag: Record<string, unknown> = {}
    for (const item of providers) {
      const headers = item.userAgent.trim() ? { 'User-Agent': item.userAgent.trim() } : undefined
      const markup = parseMarkup(item.markup) ?? 1
      const balanceUrl = item.balanceUrl.trim()
      bag[item.name] = {
        ...item.extra,
        baseUrl: item.baseUrl.trim(),
        api: item.api.trim() || 'openai-completions',
        ...(item.apiKey.trim() ? { apiKey: item.apiKey.trim() } : {}),
        ...(headers ? { headers } : {}),
        ...(markup > 0 ? { markup } : {}),
        ...(balanceUrl ? { balanceUrl } : {}),
        compat: {
          supportsDeveloperRole: item.supportsDeveloperRole,
          supportsReasoningEffort: item.supportsReasoningEffort
        },
        models: item.models.filter((model) => model.id.trim()).map((model) => serializeModel(model, markup))
      }
    }
    return { providers: bag }
  }

  function parseAuth(parsed: unknown): AuthRow[] {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return Object.entries(parsed as Record<string, unknown>).map(([name, raw]) => {
      const rec = raw && typeof raw === 'object' ? raw as Record<string, unknown> : { key: raw }
      const extra: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(rec)) if (key !== 'type' && key !== 'key') extra[key] = value
      return { name, type: String(rec.type || 'api_key'), key: String(rec.key || ''), extra }
    })
  }

  function serializeAuth() {
    const bag: Record<string, unknown> = {}
    for (const row of authRows) {
      if (!row.name.trim()) continue
      bag[row.name.trim()] = { ...row.extra, type: row.type || 'api_key', key: row.key }
    }
    return bag
  }

  function parseSettings(parsed: unknown): Array<[string, string, string]> {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
      const type = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string'
      return [key, type, type === 'string' ? String(value ?? '') : JSON.stringify(value)]
    })
  }

  function serializeSettings() {
    const obj: Record<string, unknown> = {}
    for (const [key, type, text] of settingsMap) {
      if (!key.trim()) continue
      if (type === 'boolean') obj[key] = text === 'true'
      else if (type === 'number') obj[key] = Number(text)
      else obj[key] = text
    }
    return obj
  }

  async function hydrate() {
    if (!rpc || !connected) return
    configError = ''
    notice = ''
    try {
      const models = await rpc('config_read', { file: 'models' }) as { parsed: unknown; path: string }
      providers = parseProviders(models.parsed)
      modelsSnap = JSON.stringify(providers)
    } catch (error) {
      configError = error instanceof Error ? error.message : '读取 models.json 失败'
      providers = []
      modelsSnap = '[]'
    }
    try {
      const auth = await rpc('config_read', { file: 'auth' }) as { parsed: unknown }
      authRows = parseAuth(auth.parsed)
      authSnap = JSON.stringify(authRows)
    } catch {
      authRows = []
      authSnap = '[]'
    }
    try {
      const settings = await rpc('config_read', { file: 'settings' }) as { parsed: unknown }
      settingsMap = parseSettings(settings.parsed)
      settingsSnap = JSON.stringify(settingsMap)
    } catch {
      settingsMap = []
      settingsSnap = '[]'
    }
    if (nav === 'raw') await loadRaw(rawKind)
  }

  async function loadRaw(kind: RawKind) {
    if (!rpc || !connected) return
    rawKind = kind
    configError = ''
    try {
      const result = await rpc('config_read', { file: kind }) as { raw: string; path: string }
      configRaw = result.raw
      configPath = result.path
      rawSnap = result.raw
    } catch (error) {
      configError = error instanceof Error ? error.message : '读取失败'
    }
  }

  async function writeFile(file: RawKind, raw: string) {
    if (!rpc) return
    JSON.parse(raw)
    await rpc('config_write', { file, raw })
  }

  async function saveCurrent() {
    saving = true
    configError = ''
    notice = ''
    try {
      if (nav === 'models') {
        const raw = `${JSON.stringify(serializeProviders(), null, 2)}\n`
        await writeFile('models', raw)
        modelsSnap = JSON.stringify(providers)
        onRefreshProviders?.()
        notice = '模型配置已保存并重载'
      } else if (nav === 'auth') {
        const raw = `${JSON.stringify(serializeAuth(), null, 2)}\n`
        await writeFile('auth', raw)
        authSnap = JSON.stringify(authRows)
        onRefreshProviders?.()
        notice = '认证已保存并重载'
      } else if (nav === 'settings') {
        const raw = `${JSON.stringify(serializeSettings(), null, 2)}\n`
        await writeFile('settings', raw)
        settingsSnap = JSON.stringify(settingsMap)
        notice = 'settings.json 已保存并重载'
      } else {
        JSON.parse(configRaw)
        await writeFile(rawKind, configRaw)
        rawSnap = configRaw
        if (rawKind === 'models') {
          providers = parseProviders(JSON.parse(configRaw))
          modelsSnap = JSON.stringify(providers)
        } else if (rawKind === 'auth') {
          authRows = parseAuth(JSON.parse(configRaw))
          authSnap = JSON.stringify(authRows)
        } else {
          settingsMap = parseSettings(JSON.parse(configRaw))
          settingsSnap = JSON.stringify(settingsMap)
        }
        onRefreshProviders?.()
        notice = `${rawKind}.json 已保存并重载`
      }
    } catch (error) {
      configError = error instanceof Error ? error.message : '保存失败'
    }
    saving = false
  }

  function confirmAdd() {
    const name = addDraft.name.trim()
    if (!name) { configError = '供应商名称不能为空'; return }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) { configError = '名称需以字母开头，只能含字母数字_-'; return }
    if (providers.some((item) => item.name === name)) { configError = '已有同名供应商'; return }
    providers = [...providers, { ...addDraft, name }]
    expanded = name
    adding = false
    addDraft = emptyProvider()
    configError = ''
  }

  function duplicateProvider(name: string) {
    const source = providers.find((item) => item.name === name)
    if (!source) return
    let next = `${name}-copy`
    let i = 2
    while (providers.some((item) => item.name === next)) next = `${name}-copy${i++}`
    providers = [...providers, { ...JSON.parse(JSON.stringify(source)), name: next }]
    expanded = next
  }

  function deleteProvider(name: string) {
    if (!confirm(`删除供应商 ${name}？未保存前可放弃更改。`)) return
    providers = providers.filter((item) => item.name !== name)
    if (expanded === name) expanded = ''
  }

  function patchProvider(name: string, partial: Partial<ProviderDraft>) {
    providers = providers.map((item) => item.name === name ? { ...item, ...partial } : item)
  }

  function patchModel(name: string, index: number, partial: Partial<ModelDraft>) {
    providers = providers.map((item) => {
      if (item.name !== name) return item
      const models = item.models.map((model, i) => i === index ? { ...model, ...partial } : model)
      return { ...item, models }
    })
  }

  function addModel(name: string) {
    providers = providers.map((item) => item.name === name ? { ...item, models: [...item.models, emptyModel()] } : item)
  }

  function deleteModel(name: string, index: number) {
    providers = providers.map((item) => item.name === name ? { ...item, models: item.models.filter((_, i) => i !== index) } : item)
  }

  function isHidden(name: string) {
    return hiddenProviders.includes(name)
  }

  function toggleHidden(name: string) {
    const next = new Set(hiddenProviders)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    hiddenProviders = [...next]
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenProviders))
    onPrefsChange()
  }

  async function copyText(value: string) {
    try { await navigator.clipboard.writeText(value) } catch { /* ignore */ }
  }

  async function testCard(item: ProviderDraft) {
    tests = { ...tests, [item.name]: { busy: true } }
    try {
      const result = await rpc?.('test_provider', {
        provider: item.name,
        baseUrl: item.baseUrl,
        apiKey: item.apiKey,
        model: testModel[item.name] || item.models[0]?.id || ''
      }) as { ok: boolean; message: string; latency?: number }
      tests = { ...tests, [item.name]: { busy: false, ok: result?.ok, message: result?.ok ? `${result.message}${result.latency ? ` · ${result.latency}ms` : ''}` : (result?.message || '失败') } }
    } catch (error) {
      tests = { ...tests, [item.name]: { busy: false, ok: false, message: error instanceof Error ? error.message : '失败' } }
    }
  }

  async function probeCard(name: string) {
    probes = { ...probes, [name]: { busy: true } }
    try {
      const result = await rpc?.('usage_probe', { provider: name }) as { ok: boolean; message: string }
      probes = { ...probes, [name]: { busy: false, ok: result?.ok, message: result?.message || '' } }
    } catch (error) {
      probes = { ...probes, [name]: { busy: false, ok: false, message: error instanceof Error ? error.message : '失败' } }
    }
  }

  async function queryBalance(item: ProviderDraft) {
    balances = { ...balances, [item.name]: { busy: true } }
    try {
      const result = await rpc?.('fetch_balance', {
        provider: item.name,
        baseUrl: item.baseUrl,
        apiKey: item.apiKey,
        balanceUrl: item.balanceUrl
      }) as { ok?: boolean; supported?: boolean; balance?: number; message?: string }
      balances = {
        ...balances,
        [item.name]: {
          busy: false,
          ok: Boolean(result?.ok),
          value: result?.balance,
          message: result?.message || (result?.ok ? '' : '查询失败')
        }
      }
    } catch (error) {
      balances = { ...balances, [item.name]: { busy: false, ok: false, message: error instanceof Error ? error.message : '查询失败' } }
    }
  }

  async function fetchModels(item: ProviderDraft) {
    fetching = { ...fetching, [item.name]: true }
    fetchError = { ...fetchError, [item.name]: '' }
    try {
      const result = await rpc?.('fetch_models', { baseUrl: item.baseUrl, apiKey: item.apiKey }) as { ok: boolean; message: string; models?: FetchedModel[] }
      if (!result?.ok) {
        fetchError = { ...fetchError, [item.name]: result?.message || '拉取失败' }
        fetched = { ...fetched, [item.name]: [] }
        picked = { ...picked, [item.name]: [] }
      } else {
        const list = result.models || []
        fetched = { ...fetched, [item.name]: list }
        picked = { ...picked, [item.name]: [] }
        fetchQuery = { ...fetchQuery, [item.name]: '' }
        if (!list.length) fetchError = { ...fetchError, [item.name]: result.message || '没有返回模型' }
      }
    } catch (error) {
      fetchError = { ...fetchError, [item.name]: error instanceof Error ? error.message : '拉取失败' }
    }
    fetching = { ...fetching, [item.name]: false }
  }

  function visibleFetched(name: string) {
    const query = (fetchQuery[name] || '').trim().toLowerCase()
    const list = fetched[name] || []
    if (!query) return list
    return list.filter((model) => model.id.toLowerCase().includes(query) || (model.name || '').toLowerCase().includes(query))
  }

  function togglePicked(name: string, id: string) {
    const cur = new Set(picked[name] || [])
    if (cur.has(id)) cur.delete(id)
    else cur.add(id)
    picked = { ...picked, [name]: [...cur] }
  }

  function selectVisible(name: string) {
    picked = { ...picked, [name]: visibleFetched(name).map((model) => model.id) }
  }

  function modelFromFetched(model: FetchedModel): ModelDraft {
    return {
      ...emptyModel(),
      id: model.id,
      name: model.name || model.id,
      reasoning: Boolean(model.reasoning),
      image: Boolean(model.imageInput),
      contextWindow: model.contextWindow || 0,
      maxTokens: model.maxTokens || 0,
      ...ratesFromCost(model.cost ?? null)
    }
  }

  function addFetched(name: string) {
    const item = providers.find((row) => row.name === name)
    const list = fetched[name] || []
    const selected = new Set(picked[name] || [])
    if (!item || !selected.size) return
    const existing = new Set(item.models.map((model) => model.id.trim()).filter(Boolean))
    const extra = list.filter((model) => selected.has(model.id) && !existing.has(model.id)).map(modelFromFetched)
    if (!extra.length) return
    patchProvider(name, { models: [...item.models, ...extra] })
  }

  function applyHint(model: ModelDraft, hint: FetchedModel): ModelDraft {
    return {
      ...model,
      reasoning: hint.reasoning === true,
      image: hint.imageInput === true,
      contextWindow: hint.contextWindow || model.contextWindow,
      maxTokens: hint.maxTokens || model.maxTokens,
      ...(hint.cost ? ratesFromCost(hint.cost) : {})
    }
  }

  async function fillHints(item: ProviderDraft) {
    const ids = item.models.map((model) => model.id.trim()).filter(Boolean)
    if (!ids.length) return
    fillBusy = { ...fillBusy, [item.name]: true }
    fillError = { ...fillError, [item.name]: '' }
    try {
      const result = await rpc?.('lookup_model_hints', { ids }) as { models?: FetchedModel[] }
      const hints = result?.models || []
      if (!hints.length) {
        fillError = { ...fillError, [item.name]: 'models.dev 没有匹配到这些模型 ID' }
      } else {
        const byId = new Map(hints.map((hint) => [hint.id.trim(), hint]))
        patchProvider(item.name, {
          models: item.models.map((model) => {
            const hint = byId.get(model.id.trim())
            return hint ? applyHint(model, hint) : model
          })
        })
      }
    } catch (error) {
      fillError = { ...fillError, [item.name]: error instanceof Error ? error.message : '填入失败' }
    }
    fillBusy = { ...fillBusy, [item.name]: false }
  }

  function pasteModelIds(name: string, index: number, text: string) {
    if (!/[\n,]/.test(text)) return false
    const ids = text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
    if (!ids.length) return false
    const item = providers.find((row) => row.name === name)
    if (!item) return false
    const next = [...item.models]
    const current = next[index]
    if (!current) return false
    if (current.id.trim()) {
      next.splice(index + 1, 0, ...ids.map((id) => ({ ...emptyModel(), id })))
    } else {
      next[index] = { ...current, id: ids[0] }
      next.splice(index + 1, 0, ...ids.slice(1).map((id) => ({ ...emptyModel(), id })))
    }
    patchProvider(name, { models: next })
    return true
  }

  function previewCost(model: ModelDraft, markupRaw: string) {
    const official = readCost(model)
    const markup = parseMarkup(markupRaw)
    if (!official || markup === null) return null
    return scaleCost(official, markup)
  }

  let oauthHint = ''
  async function loginOAuth(provider: string) {
    oauthHint = '正在打开登录…'
    try {
      const result = await rpc?.('oauth_login', { provider }) as { ok?: boolean; message?: string }
      oauthHint = result?.ok ? (result.message || '已登录') : `${result?.message || '登录失败'}`
    } catch (error) {
      oauthHint = error instanceof Error ? error.message : '失败'
    }
  }

  function addAuth() {
    const name = addAuthName.trim()
    if (!name) return
    if (authRows.some((row) => row.name === name)) { configError = '已有同名认证'; return }
    authRows = [...authRows, { name, type: 'api_key', key: '', extra: {} }]
    addAuthName = ''
    configError = ''
  }
</script>

<div class="wrap">
  <nav class="nav" aria-label="配置分类">
    <p class="nav-label">配置文件</p>
    {#each NAV as [id, label] (id)}
      <button class="nav-item" class:active={nav === id} on:click={() => setNav(id)}>
        {label}
        {#if (id === 'models' && modelsDirty) || (id === 'auth' && authDirty) || (id === 'settings' && settingsDirty) || (id === 'raw' && rawDirty)}
          <i class="dot"></i>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="content">
    {#if notice}<p class="banner ok">{notice}</p>{/if}
    {#if configError}<p class="banner warn">{configError}</p>{/if}

    {#if nav === 'models'}
      <div class="toolbar">
        <span class="count">{providers.length} 个供应商</span>
        <div class="toolbar-actions">
          <button class="ghost" disabled={saving} on:click={() => (adding = !adding)}>{adding ? '取消' : '+ 添加供应商'}</button>
          <button class="ghost" on:click={() => (showGuide = !showGuide)}>配置指南</button>
          <button class="save" disabled={saving || !modelsDirty} on:click={() => void saveCurrent()}>{saving ? '保存中' : '保存'}</button>
        </div>
      </div>
      <p class="hint">改完记得保存，保存后才会重载 Agent 运行时。</p>

      {#if showGuide}
        <section class="guide">
          <div class="guide-head">
            <strong>供应商配置指南</strong>
            <button class="icon" on:click={() => (showGuide = false)} aria-label="关闭指南">×</button>
          </div>
          <p>中转站填自定义 Base URL 和 API Key，再「拉取模型」勾选填入。中转倍率会在保存时乘进模型费率。常用 API 类型：</p>
          <div class="api-grid">
            <div><code>openai-completions</code><span>OpenAI 兼容 / 多数中转</span></div>
            <div><code>anthropic-messages</code><span>Claude 官方 Messages</span></div>
            <div><code>openai-responses</code><span>OpenAI Responses</span></div>
            <div><code>google-generative-ai</code><span>Gemini</span></div>
          </div>
          <p>兼容性：不支持 developer role 时勾选第一项；不支持 reasoning_effort 时勾选第二项，避免请求被拒。</p>
          <p class="hint">高级字段（oauth / headers 复杂结构）会保留，可在源文件里继续编辑。</p>
        </section>
      {/if}

      {#if adding}
        <section class="card add-card">
          <h3>新供应商</h3>
          <label class="field"><span>名称</span><input bind:value={addDraft.name} placeholder="openrouter" /></label>
          <label class="field"><span>Base URL</span><input bind:value={addDraft.baseUrl} placeholder="https://api.example.com/v1" /></label>
          <label class="field">
            <span>API 类型</span>
            <select bind:value={addDraft.api}>
              {#each APIS as api}<option value={api}>{api}</option>{/each}
            </select>
          </label>
          <label class="field"><span>API Key</span><input type="password" bind:value={addDraft.apiKey} placeholder="sk-…" /></label>
          <label class="field"><span>中转倍率</span><input bind:value={addDraft.markup} placeholder="1" /></label>
          <label class="field"><span>余额 URL</span><input bind:value={addDraft.balanceUrl} placeholder="https://ai.apiclub.top/v1/usage" /></label>
          <div class="row-actions">
            <button class="ghost" on:click={() => (adding = false)}>取消</button>
            <button class="save" on:click={confirmAdd}>添加</button>
          </div>
        </section>
      {/if}

      {#each providers as item (item.name)}
        <section class="card" class:open={expanded === item.name}>
          <div class="card-head">
            <button class="head-main" type="button" on:click={() => (expanded = expanded === item.name ? '' : item.name)}>
              <span class="chev">{expanded === item.name ? '▾' : '▸'}</span>
              <strong>{item.name}</strong>
              <em>{item.models.length} 模型</em>
              {#if balances[item.name]?.ok && balances[item.name].value != null}<em>余额 ${Number(balances[item.name].value).toFixed(2)}</em>{/if}
              {#if item.baseUrl}<span class="url">{item.baseUrl}</span>{/if}
            </button>
            <div class="head-actions">
              <button class="ghost" title={isHidden(item.name) ? '在模型列表中显示' : '从模型列表隐藏'} on:click={() => toggleHidden(item.name)}>{isHidden(item.name) ? '已隐藏' : '隐藏'}</button>
              <button class="ghost" title="复制供应商" on:click={() => duplicateProvider(item.name)}>复制</button>
              <button class="ghost danger" title="删除" on:click={() => deleteProvider(item.name)}>删除</button>
            </div>
          </div>

          {#if expanded === item.name}
            <div class="card-body">
              <div class="form">
                <label class="field">
                  <span>Base URL</span>
                  <div class="grow">
                    <input value={item.baseUrl} on:input={(event) => patchProvider(item.name, { baseUrl: (event.currentTarget as HTMLInputElement).value })} placeholder="https://api.openai.com/v1" />
                    <small>获取/测试会拼接 /models；会话请求走此处地址，建议填到 /v1。</small>
                  </div>
                </label>
                <label class="field">
                  <span>API 类型</span>
                  <select value={item.api} on:change={(event) => patchProvider(item.name, { api: (event.currentTarget as HTMLSelectElement).value })}>
                    {#each APIS as api}<option value={api}>{api}</option>{/each}
                    {#if item.api && !APIS.includes(item.api)}<option value={item.api}>{item.api}</option>{/if}
                  </select>
                </label>
                <label class="field">
                  <span>API Key</span>
                  <div class="secret">
                    <input type={revealKey[item.name] ? 'text' : 'password'} value={item.apiKey} on:input={(event) => patchProvider(item.name, { apiKey: (event.currentTarget as HTMLInputElement).value })} placeholder="sk-…" />
                    <button class="ghost" type="button" on:click={() => (revealKey = { ...revealKey, [item.name]: !revealKey[item.name] })}>{revealKey[item.name] ? '隐藏' : '显示'}</button>
                    <button class="ghost" type="button" on:click={() => void copyText(item.apiKey)}>复制</button>
                  </div>
                </label>
                <label class="field">
                  <span>User-Agent</span>
                  <input value={item.userAgent} on:input={(event) => patchProvider(item.name, { userAgent: (event.currentTarget as HTMLInputElement).value })} placeholder="留空则使用运行时默认" />
                </label>
                <label class="field">
                  <span>中转倍率</span>
                  <div class="grow">
                    <input value={item.markup} on:input={(event) => patchProvider(item.name, { markup: (event.currentTarget as HTMLInputElement).value })} placeholder="1" />
                    <small>提交时按「填写费率 × 倍率」写入实际估算费率，并持久化到 models.json。</small>
                  </div>
                </label>
                <label class="field">
                  <span>余额 URL</span>
                  <div class="grow">
                    <div class="secret">
                      <input value={item.balanceUrl} on:input={(event) => patchProvider(item.name, { balanceUrl: (event.currentTarget as HTMLInputElement).value })} placeholder="https://ai.apiclub.top/v1/usage" />
                      <button class="save" disabled={balances[item.name]?.busy} on:click={() => void queryBalance(item)}>{balances[item.name]?.busy ? '查询中' : '查余额'}</button>
                    </div>
                    <small>可选。GET 该地址并带 Bearer Key，读取 JSON 的 balance（兼容 New API quota）。apiclub 可留空，默认 /v1/usage。</small>
                  </div>
                </label>
                <label class="field">
                  <span>测试模型</span>
                  <div class="secret">
                    <input value={testModel[item.name] ?? item.models[0]?.id ?? ''} on:input={(event) => (testModel = { ...testModel, [item.name]: (event.currentTarget as HTMLInputElement).value })} placeholder={item.models[0]?.id || '模型 ID'} />
                    <button class="save" disabled={tests[item.name]?.busy} on:click={() => void testCard(item)}>{tests[item.name]?.busy ? '测试中' : '测试连接'}</button>
                    <button class="ghost" disabled={probes[item.name]?.busy} on:click={() => void probeCard(item.name)}>{probes[item.name]?.busy ? '查询中' : '用量'}</button>
                  </div>
                </label>
                {#if tests[item.name]?.message}<p class="hint" class:warn={tests[item.name]?.ok === false}>{tests[item.name].message}</p>{/if}
                {#if probes[item.name]?.message}<p class="hint">{probes[item.name].message}</p>{/if}
                {#if balances[item.name]?.message}<p class="hint" class:warn={balances[item.name]?.ok === false}>{balances[item.name].ok ? `余额 ${balances[item.name].message}` : balances[item.name].message}</p>{/if}
                <div class="field top">
                  <span>兼容性</span>
                  <div class="checks">
                    <label><input type="checkbox" checked={item.supportsDeveloperRole} on:change={(event) => patchProvider(item.name, { supportsDeveloperRole: (event.currentTarget as HTMLInputElement).checked })} /> 关闭 developer 角色</label>
                    <label><input type="checkbox" checked={item.supportsReasoningEffort} on:change={(event) => patchProvider(item.name, { supportsReasoningEffort: (event.currentTarget as HTMLInputElement).checked })} /> 关闭推理强度参数</label>
                  </div>
                </div>
              </div>

              <div class="models-head">
                <strong>模型列表</strong>
                <div class="toolbar-actions">
                  <button class="ghost" disabled={fetching[item.name] || !/^https?:\/\//i.test(item.baseUrl.trim())} on:click={() => void fetchModels(item)}>{fetching[item.name] ? '拉取中…' : '拉取模型'}</button>
                  <button class="ghost" disabled={fillBusy[item.name] || !item.models.some((model) => model.id.trim())} on:click={() => void fillHints(item)}>{fillBusy[item.name] ? '填入中…' : '填入信息'}</button>
                  <button class="ghost" on:click={() => addModel(item.name)}>+ 手动添加</button>
                </div>
              </div>
              <p class="hint">勾选后点「填入已选模型」写入编辑表，不会立刻保存。「填入信息」从 models.dev 补思考、图像、上下文、输出上限和厂商价。</p>
              {#if fetchError[item.name]}<p class="hint warn">{fetchError[item.name]}</p>{/if}
              {#if fillError[item.name]}<p class="hint warn">{fillError[item.name]}</p>{/if}
              {#if fetched[item.name]?.length}
                <div class="fetch-box">
                  <input class="search" placeholder="搜索模型 ID" value={fetchQuery[item.name] || ''} on:input={(event) => (fetchQuery = { ...fetchQuery, [item.name]: (event.currentTarget as HTMLInputElement).value })} />
                  <div class="fetch-actions">
                    <button class="ghost" type="button" on:click={() => selectVisible(item.name)}>全选</button>
                    <button class="ghost" type="button" on:click={() => (picked = { ...picked, [item.name]: [] })}>清空勾选</button>
                    <button class="save" type="button" disabled={!(picked[item.name] || []).length} on:click={() => addFetched(item.name)}>填入已选模型</button>
                  </div>
                  <div class="fetch-list">
                    {#each visibleFetched(item.name) as model (model.id)}
                      <label><input type="checkbox" checked={(picked[item.name] || []).includes(model.id)} on:change={() => togglePicked(item.name, model.id)} /> <span>{model.id}</span>{#if model.name && model.name !== model.id}<small>{model.name}</small>{/if}</label>
                    {/each}
                  </div>
                </div>
              {/if}
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>名称</th>
                      <th>上下文</th>
                      <th>最大 Token</th>
                      <th>推理</th>
                      <th>xhigh</th>
                      <th>图片</th>
                      <th>费率</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each item.models as model, index (`${item.name}-${index}`)}
                      <tr>
                        <td><input value={model.id} on:input={(event) => patchModel(item.name, index, { id: (event.currentTarget as HTMLInputElement).value })} on:paste={(event) => { const text = event.clipboardData?.getData('text') || ''; if (pasteModelIds(item.name, index, text)) event.preventDefault() }} /></td>
                        <td><input value={model.name} on:input={(event) => patchModel(item.name, index, { name: (event.currentTarget as HTMLInputElement).value })} /></td>
                        <td><input type="number" value={model.contextWindow || ''} on:input={(event) => patchModel(item.name, index, { contextWindow: Number((event.currentTarget as HTMLInputElement).value) || 0 })} /></td>
                        <td><input type="number" value={model.maxTokens || ''} on:input={(event) => patchModel(item.name, index, { maxTokens: Number((event.currentTarget as HTMLInputElement).value) || 0 })} /></td>
                        <td class="center"><input type="checkbox" checked={model.reasoning} on:change={(event) => patchModel(item.name, index, { reasoning: (event.currentTarget as HTMLInputElement).checked })} /></td>
                        <td>
                          <select value={model.thinking} on:change={(event) => patchModel(item.name, index, { thinking: (event.currentTarget as HTMLSelectElement).value as Thinking })}>
                            <option value="">关闭</option>
                            <option value="xhigh">xhigh</option>
                            <option value="max">max</option>
                          </select>
                        </td>
                        <td class="center"><input type="checkbox" checked={model.image} on:change={(event) => patchModel(item.name, index, { image: (event.currentTarget as HTMLInputElement).checked })} /></td>
                        <td class="center"><button class="ghost" type="button" on:click={() => (ratesOpen = { ...ratesOpen, [`${item.name}-${index}`]: !ratesOpen[`${item.name}-${index}`] })}>费率</button></td>
                        <td class="center"><button class="icon danger" on:click={() => deleteModel(item.name, index)}>×</button></td>
                      </tr>
                      {#if ratesOpen[`${item.name}-${index}`]}
                        <tr class="rate-row">
                          <td colspan="9">
                            <div class="rate-grid">
                              <label>输入<input value={model.inputRate} on:input={(event) => patchModel(item.name, index, { inputRate: (event.currentTarget as HTMLInputElement).value })} placeholder="$/M" /></label>
                              <label>输出<input value={model.outputRate} on:input={(event) => patchModel(item.name, index, { outputRate: (event.currentTarget as HTMLInputElement).value })} placeholder="$/M" /></label>
                              <label>缓存读<input value={model.cacheReadRate} on:input={(event) => patchModel(item.name, index, { cacheReadRate: (event.currentTarget as HTMLInputElement).value })} placeholder="$/M" /></label>
                              <label>缓存写<input value={model.cacheWriteRate} on:input={(event) => patchModel(item.name, index, { cacheWriteRate: (event.currentTarget as HTMLInputElement).value })} placeholder="$/M" /></label>
                            </div>
                            {#if previewCost(model, item.markup)}
                              {@const preview = previewCost(model, item.markup)}
                              <p class="hint">实际估算：输入 {formatUsd(preview.input)} · 输出 {formatUsd(preview.output)} · 缓存读 {formatUsd(preview.cacheRead)} · 缓存写 {formatUsd(preview.cacheWrite)} / 1M</p>
                            {/if}
                          </td>
                        </tr>
                      {/if}
                    {:else}
                      <tr><td colspan="9" class="empty">还没有模型。点「拉取模型」勾选填入，或手动添加。可粘贴逗号/换行分隔的 ID 列表。</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        </section>
      {:else}
        <p class="muted">{connected ? '还没有供应商。点右上角添加，或到源文件编辑 models.json。' : '未连接 sidecar'}</p>
      {/each}

    {:else if nav === 'auth'}
      <section class="card add-card">
        <h3>订阅登录</h3>
        <p class="hint">Claude / Codex 走 pi 官方 OAuth。点击后在弹窗里复制设备码，在浏览器完成授权。</p>
        <div class="toolbar-actions" style="margin:8px 0">
          <button class="ghost" on:click={() => void loginOAuth('anthropic')}>登录 Anthropic</button>
          <button class="ghost" on:click={() => void loginOAuth('openai')}>登录 OpenAI / Codex</button>
        </div>
        {#if oauthHint}<p class="hint">{oauthHint}</p>{/if}
      </section>
      <div class="toolbar">
        <span class="count">{authRows.length} 条认证</span>
        <button class="save" disabled={saving || !authDirty} on:click={() => void saveCurrent()}>{saving ? '保存中' : '保存'}</button>
      </div>
      <p class="hint">写入 ~/.pi/agent/auth.json。自定义供应商的 Key 也可以直接写在模型卡片里。</p>
      {#each authRows as row, index (`auth-${index}`)}
        <section class="card">
          <div class="card-body">
            <label class="field"><span>供应商</span><input bind:value={row.name} /></label>
            <label class="field">
              <span>类型</span>
              <select bind:value={row.type}>
                <option value="api_key">api_key</option>
                <option value="oauth">oauth</option>
              </select>
            </label>
            <label class="field">
              <span>Key</span>
              <div class="secret">
                <input type="password" bind:value={row.key} />
                <button class="ghost" on:click={() => void copyText(row.key)}>复制</button>
                <button class="icon danger" on:click={() => (authRows = authRows.filter((_, i) => i !== index))}>删除</button>
              </div>
            </label>
          </div>
        </section>
      {/each}
      <div class="toolbar" style="margin-top:12px">
        <select bind:value={addAuthName}>
          <option value="">选择预设…</option>
          {#each AUTH_PRESETS as name}<option value={name}>{name}</option>{/each}
        </select>
        <input bind:value={addAuthName} placeholder="或输入名称" />
        <button class="ghost" on:click={addAuth}>＋ 添加认证</button>
      </div>

    {:else if nav === 'settings'}
      <div class="toolbar">
        <span class="count">settings.json</span>
        <button class="save" disabled={saving || !settingsDirty} on:click={() => void saveCurrent()}>{saving ? '保存中' : '保存'}</button>
      </div>
      {#each settingsMap as row, index (index)}
        <div class="kv-row">
          <input bind:value={row[0]} placeholder="键" />
          <select bind:value={row[1]}><option value="string">文本</option><option value="number">数字</option><option value="boolean">布尔</option></select>
          {#if row[1] === 'boolean'}
            <select bind:value={row[2]}><option value="true">true</option><option value="false">false</option></select>
          {:else}
            <input bind:value={row[2]} placeholder="值" />
          {/if}
        </div>
      {/each}
      <button class="ghost" style="margin-top:8px" on:click={() => (settingsMap = [...settingsMap, ['', 'string', '']])}>＋ 字段</button>

    {:else}
      <div class="toolbar">
        <div class="choice-row">
          <button class="choice" class:on={rawKind === 'models'} on:click={() => void loadRaw('models')}>models.json</button>
          <button class="choice" class:on={rawKind === 'auth'} on:click={() => void loadRaw('auth')}>auth.json</button>
          <button class="choice" class:on={rawKind === 'settings'} on:click={() => void loadRaw('settings')}>settings.json</button>
        </div>
        <button class="save" disabled={saving || !rawDirty} on:click={() => void saveCurrent()}>{saving ? '保存中' : '保存'}</button>
      </div>
      <p class="hint">{configPath || '源文件'}{#if (rawKind === 'models' && modelsDirty) || (rawKind === 'auth' && authDirty) || (rawKind === 'settings' && settingsDirty)} · 可视化页有未保存草稿，这里是磁盘内容{/if}</p>
      <textarea class="json-editor" bind:value={configRaw} spellcheck="false"></textarea>
    {/if}
  </div>
</div>

<style>
  .wrap { display: flex; flex: 1; width: 100%; min-width: 0; min-height: 0; }
  .nav { flex: none; width: 168px; padding: 12px 10px; overflow: auto; border-right: 1px solid var(--hover); background: var(--surface); }
  .nav-label { margin: 0 8px 8px; color: var(--muted-2); font-size: 10px; font-weight: 700; letter-spacing: .08em; }
  .nav-item { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 32px; padding: 0 10px; border-radius: 6px; background: transparent; color: var(--text-3); font-size: 13px; text-align: left; }
  .nav-item:hover { background: var(--surface-3); color: var(--text-2); }
  .nav-item.active { background: var(--hover); color: var(--text); font-weight: 650; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #c9a227; }
  .content { flex: 1; min-width: 0; overflow: auto; padding: 16px 22px 28px; }
  .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .toolbar-actions, .row-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .count { color: var(--muted); font-size: 12px; }
  .hint { margin: 0 0 12px; color: var(--muted-2); font-size: 11px; line-height: 1.5; }
  .hint.warn, .banner.warn { color: #8a3b00; }
  .banner { margin: 0 0 10px; padding: 8px 10px; border-radius: 6px; background: var(--surface-3); font-size: 12px; }
  .banner.ok { background: var(--surface-3); color: var(--text-2); }
  .ghost, .choice { padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--raised); color: var(--text-2); font-size: 11px; }
  .ghost:hover, .choice:hover { background: var(--surface-3); }
  .ghost.danger { color: #8a1f1f; }
  .ghost.danger:hover { background: #f6eaea; }
  .choice.on { border-color: var(--text); color: var(--text); font-weight: 650; background: var(--surface-3); }
  .save { height: 30px; padding: 0 12px; border-radius: 6px; background: var(--accent); color: var(--accent-fg); font-size: 12px; }
  .save:disabled, .ghost:disabled { opacity: .45; }
  .choice-row { display: flex; gap: 6px; }
  .guide { margin-bottom: 14px; padding: 12px 14px; border: 1px solid var(--border-2); border-radius: 8px; background: var(--surface-3); color: var(--text-3); font-size: 12px; line-height: 1.55; }
  .guide-head { display: flex; align-items: center; margin-bottom: 8px; }
  .guide-head strong { color: var(--text); }
  .guide p { margin: 0 0 8px; }
  .api-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 8px 0 12px; }
  .api-grid div { display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 6px; background: var(--raised); }
  .api-grid code { color: var(--text); font-size: 11px; }
  .api-grid span { color: var(--muted); font-size: 10px; }
  .card { margin-bottom: 10px; overflow: hidden; border: 1px solid var(--border-2); border-radius: 8px; background: var(--raised); }
  .card.open { border-color: var(--border-3); box-shadow: 0 1px 0 var(--hover); }
  .add-card { padding: 12px 14px 14px; }
  .add-card h3 { margin: 0 0 10px; color: var(--text); font-size: 13px; }
  .card-head { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 8px 0 12px; }
  .head-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; background: transparent; text-align: left; }
  .head-main strong { color: var(--text); font-size: 13px; }
  .head-main em { flex: none; padding: 1px 7px; border: 1px solid var(--border-2); border-radius: 999px; color: var(--muted); font-size: 10px; font-style: normal; }
  .url { min-width: 0; overflow: hidden; color: var(--muted-2); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .chev { color: var(--muted-2); font-size: 11px; }
  .head-actions { display: flex; flex: none; gap: 2px; }
  .icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; background: transparent; color: var(--muted); font-size: 13px; }
  .icon:hover { background: var(--surface-3); color: var(--text); }
  .icon.danger:hover { color: #8a1f1f; background: #f6eaea; }
  .card-body { padding: 4px 14px 14px; border-top: 1px solid var(--surface-3); background: var(--surface-2); }
  .form { display: grid; gap: 10px; margin: 12px 0; padding: 12px; border: 1px solid var(--hover); border-radius: 8px; background: var(--raised); }
  .field { display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: center; gap: 10px; color: var(--text-3); font-size: 12px; }
  .field.top { align-items: start; }
  .field span { padding-top: 2px; }
  .grow, .secret, .checks { min-width: 0; }
  .secret { display: flex; gap: 6px; }
  .secret input { flex: 1; }
  .field input, .field select, .toolbar input, .toolbar select { min-width: 0; width: 100%; height: 32px; padding: 0 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--raised); color: var(--text-2); font-size: 12px; }
  .field small { display: block; margin-top: 4px; color: var(--muted-2); font-size: 10px; line-height: 1.4; }
  .checks { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
  .checks label { display: flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 12px; }
  .models-head { display: flex; align-items: center; gap: 10px; margin: 4px 0 8px; }
  .models-head strong { color: var(--text-2); font-size: 12px; }
  .fetch-box { margin-bottom: 10px; padding: 10px; border: 1px solid var(--hover); border-radius: 6px; background: var(--surface-2); }
  .fetch-box .search { width: 100%; height: 30px; margin-bottom: 8px; padding: 0 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--raised); font-size: 12px; }
  .fetch-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .fetch-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 10px; max-height: 180px; overflow: auto; }
  .fetch-list label { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--text-2); font-size: 11px; }
  .fetch-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fetch-list small { overflow: hidden; color: var(--muted-2); text-overflow: ellipsis; white-space: nowrap; }
  .rate-row td { background: var(--surface-2); }
  .rate-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .rate-grid label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 10px; }
  .rate-grid input { height: 30px; padding: 0 6px; border: 1px solid var(--active); border-radius: 4px; background: var(--raised); font-size: 11px; }
  .table-wrap { overflow: auto; border: 1px solid var(--border-2); border-radius: 8px; background: var(--raised); }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px; border-bottom: 1px solid var(--surface-3); text-align: left; }
  th { color: var(--muted); font-size: 10px; font-weight: 600; background: var(--surface-3); }
  td input, td select { width: 100%; height: 30px; padding: 0 6px; border: 1px solid var(--active); border-radius: 4px; background: var(--raised); font-size: 11px; }
  td.center { text-align: center; }
  .empty { padding: 14px; color: var(--muted-2); font-size: 12px; text-align: center; }
  .kv-row { display: grid; grid-template-columns: 1fr 88px 1fr; gap: 6px; margin-top: 6px; }
  .kv-row input, .kv-row select { height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--raised); }
  .json-editor { width: 100%; min-height: 420px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--raised); color: var(--text-2); font: 12px/1.5 ui-monospace, "Cascadia Mono", monospace; }
  .muted { color: var(--muted-2); font-size: 12px; }
</style>
