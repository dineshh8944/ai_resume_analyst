// Optional FastAPI + MongoDB backend. The app works fully client-side without it; if the server is
// down/unreachable these helpers just return null and history features stay hidden.
const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

async function call(path, opts) {
  try {
    const r = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
export const backendHealth = () => call('/api/health')
export const saveVersion = (body) => call('/api/history', { method: 'POST', body: JSON.stringify(body) })
export const listHistory = (limit = 20) => call(`/api/history?limit=${limit}`)
export const getVersion = (id) => call(`/api/history/${id}`)
export const deleteVersion = (id) => call(`/api/history/${id}`, { method: 'DELETE' })

/** AI completion via backend if running. Returns {text, provider} or {error}. */
export async function aiBackend(prompt, temperature = 0.2, apiKey = '', provider = '') {
  try {
    const r = await fetch(BASE + '/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, temperature, api_key: apiKey, provider }),
      signal: AbortSignal.timeout(90000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { error: j.detail || `Backend returned ${r.status}` }
    return j.text ? j : { error: 'Backend returned an empty reply' }
  } catch { return { error: 'Backend is not running' } }
}
