import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './visual-overhaul.css'
import './map-observatory.css'
import './map-scan-effects.css'
import './observatory-shell.css'
import './playable.css'
import './rendering/standardOrbitControlsPolicy'
import './rendering/instancedMeshUploadPolicy'
import './rendering/rendererVisualPolicy'
import PlayableApp from './PlayableApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlayableApp />
  </StrictMode>,
)
