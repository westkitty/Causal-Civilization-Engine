import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './visual-overhaul.css'
import './map-observatory.css'
import './map-scan-effects.css'
import './observatory-shell.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
