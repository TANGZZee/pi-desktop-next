const MAX_FETCHED_MODELS = 500
const NEWAPI_QUOTA_PER_DOLLAR = 500_000
export const APICLUB_ORIGIN = 'https://ai.apiclub.top'
export const APICLUB_BALANCE_PATH = '/v1/usage'

export function parseFetchedModels(payload) {
  const list = Array.isArray(payload) ? payload : payload?.data
  if (!Array.isArray(list)) throw new Error('模型列表响应格式不支持')
  const byId = new Map()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || byId.has(id)) continue
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined
    byId.set(id, { id, name })
    if (byId.size >= MAX_FETCHED_MODELS) break
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function asFinite(raw) {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isFinite(value) ? value : null
}

/** 只读 JSON 里的余额。兼容 New API 的 quota（≥1000 按 500000≈$1 换算）。 */
export function parseProviderBalance(payload, depth = 0) {
  if (depth > 3 || !payload || typeof payload !== 'object') return null
  const root = payload
  for (const key of ['balance', 'remain_balance', 'total_available']) {
    const value = asFinite(root[key])
    if (value != null) return value
  }
  for (const key of ['quota', 'remain_quota']) {
    const value = asFinite(root[key])
    if (value == null) continue
    return value >= 1000 ? value / NEWAPI_QUOTA_PER_DOLLAR : value
  }
  if (root.data) return parseProviderBalance(root.data, depth + 1)
  return null
}

export function normalizeBalanceUrl(raw) {
  const text = String(raw || '').trim()
  if (!text) return undefined
  let url
  try { url = new URL(text) } catch { throw new Error('余额查询 URL 无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('余额查询 URL 必须以 http(s):// 开头')
  if (url.username || url.password) throw new Error('余额查询 URL 不能包含账号或密码')
  url.hash = ''
  return url.toString()
}

export function defaultBalanceUrl(baseUrl) {
  try {
    if (new URL(baseUrl).origin === APICLUB_ORIGIN) return `${APICLUB_ORIGIN}${APICLUB_BALANCE_PATH}`
  } catch { /* ignore */ }
  return undefined
}

function leafId(id) {
  const normalized = String(id || '').trim().toLowerCase()
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(slash + 1) : normalized
}

function modelsDevLeaf(id) {
  return leafId(String(id || '').replace(/^[^/]+\//, ''))
}

/** 解析 models.dev api.json：provider.models[id] */
export function flattenModelsDev(payload) {
  if (!payload || typeof payload !== 'object') return []
  const out = []
  for (const provider of Object.values(payload)) {
    if (!provider || typeof provider !== 'object') continue
    const models = provider.models
    if (!models || typeof models !== 'object') continue
    for (const raw of Object.values(models)) {
      if (!raw || typeof raw !== 'object') continue
      const id = typeof raw.id === 'string' ? raw.id.trim() : ''
      if (!id) continue
      const modalities = raw.modalities
      const inputs = Array.isArray(modalities?.input) ? modalities.input : []
      const limit = raw.limit && typeof raw.limit === 'object' ? raw.limit : {}
      const costRaw = raw.cost && typeof raw.cost === 'object' ? raw.cost : null
      const cost = costRaw && asFinite(costRaw.input) != null && asFinite(costRaw.output) != null
        ? {
            input: asFinite(costRaw.input),
            output: asFinite(costRaw.output),
            cacheRead: asFinite(costRaw.cache_read) ?? asFinite(costRaw.cacheRead) ?? 0,
            cacheWrite: asFinite(costRaw.cache_write) ?? asFinite(costRaw.cacheWrite) ?? 0
          }
        : undefined
      out.push({
        id,
        reasoning: raw.reasoning === true,
        imageInput: inputs.includes('image') || raw.attachment === true,
        contextWindow: asFinite(limit.context) ?? undefined,
        maxTokens: asFinite(limit.output) ?? undefined,
        ...(cost && (cost.input > 0 || cost.output > 0) ? { cost } : {})
      })
    }
  }
  return out
}

export function matchModelsDev(modelId, catalog) {
  const leaf = modelsDevLeaf(modelId)
  const exact = catalog.find((model) => model.id.toLowerCase() === modelId.toLowerCase() || modelsDevLeaf(model.id) === leaf)
  if (!exact) return undefined
  return {
    id: modelId,
    reasoning: exact.reasoning,
    imageInput: exact.imageInput,
    ...(exact.contextWindow ? { contextWindow: exact.contextWindow } : {}),
    ...(exact.maxTokens ? { maxTokens: exact.maxTokens } : {}),
    ...(exact.cost ? { cost: exact.cost } : {})
  }
}
