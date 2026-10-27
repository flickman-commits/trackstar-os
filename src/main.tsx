import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// A deploy replaces the page files, so a tab opened before it asks for ones
// that no longer exist and the page it opens fails to load. Reload once to
// pick up the new build; the timestamp stops a loop if the file is truly gone.
window.addEventListener('vite:preloadError', (event) => {
  let last = 0
  try { last = Number(sessionStorage.getItem('reloadedForDeploy') || 0) } catch { /* private window */ }
  if (Date.now() - last < 60_000) return
  try { sessionStorage.setItem('reloadedForDeploy', String(Date.now())) } catch { /* fine */ }
  event.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
