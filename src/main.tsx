import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@/ui/base.css'

const root = document.getElementById('root')
if (!root) throw new Error('Falta el nodo #root en index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
