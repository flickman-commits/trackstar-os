/** What every Finance handler answers with when a domain call throws. */
export function answerError(res, error, tag) {
  if (error?.expose) return res.status(error.status || 400).json({ error: error.message })
  console.error(`[API ${tag}]`, error)
  return res.status(500).json({ error: 'Something went wrong. Try again, and tell Matt if it keeps happening.' })
}

export function body(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
}
