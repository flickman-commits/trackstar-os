/**
 * One Vercel function serving many handlers (see scripts/gen-routes.js).
 *
 * vercel.json rewrites /api/orders/update to /api/app?__route=orders/update.
 * This puts the request back the way the handler expects it: req.url is the
 * original /api/orders/update?..., req.query has the original parameters and
 * no __route. The body is left alone: Vercel buffers it and parses req.body
 * only when a handler reads it, so the raw-body handlers (proof and bulk file
 * uploads, the Instagram webhook signature) still read the stream untouched.
 *
 * Handlers load on first use and stay cached for the life of the instance,
 * so a request only pays for the modules its own route needs.
 */
export function routeRequest(req) {
  const url = new URL(req.url || '/', 'http://x')
  let route = url.searchParams.get('__route')
  url.searchParams.delete('__route')
  if (!route) route = url.pathname.replace(/^\/api\//, '')
  route = route.replace(/^\/+|\/+$/g, '')
  const query = {}
  url.searchParams.forEach((v, k) => {
    const had = query[k]
    query[k] = had === undefined ? v : Array.isArray(had) ? [...had, v] : [had, v]
  })
  const search = url.searchParams.toString()
  return { route, query, url: `/api/${route}${search ? `?${search}` : ''}` }
}

export function makeRouter(table) {
  const loaded = Object.create(null)
  return async function router(req, res) {
    const { route, query, url } = routeRequest(req)
    const load = Object.hasOwn(table, route) ? table[route] : null
    if (!load) return res.status(404).json({ error: 'Not found' })
    req.url = url
    req.query = query
    loaded[route] ||= load().then(m => m.default)
    let handler
    try { handler = await loaded[route] } catch (err) {
      delete loaded[route]
      console.error(`[router] ${route} failed to load:`, err)
      return res.status(500).json({ error: 'Server error' })
    }
    return handler(req, res)
  }
}
