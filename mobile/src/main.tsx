import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@/ui/tokens.css'
import './mobile.css'

/**
 * Arranque de la web del telefono.
 *
 * Los colores salen de los mismos tokens que el escritorio: es la misma app
 * vista desde otro sitio, no un primo lejano con su propia paleta.
 */
const host = document.getElementById('root')
if (host) {
  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
