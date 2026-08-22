import { useState } from 'react'
import { CliSection } from './CliSection'
import { relaunchSetup } from '@/setup/QuickSetup'
import { McpMatrix } from '@/shared/McpMatrix'
import { GithubAccount } from '@/shared/GithubAccount'
import './settings.css'

type Section = 'workspace' | 'clis' | 'mcp' | 'github' | 'apariencia'

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'workspace', label: 'Carpetas de trabajo', icon: 'root-folder' },
  { id: 'clis', label: 'CLIs de IA', icon: 'terminal' },
  { id: 'mcp', label: 'MCP', icon: 'plug' },
  { id: 'github', label: 'GitHub', icon: 'github' },
  { id: 'apariencia', label: 'Apariencia', icon: 'symbol-color' },
]

/**
 * Modulo Ajustes.
 *
 * Todo lo que el Quick Setup configura la primera vez se puede volver a tocar
 * aqui, siempre. El setup es un atajo del primer arranque, no el unico camino:
 * ambos escriben sobre el mismo estado.
 */
export default function SettingsModule() {
  const [section, setSection] = useState<Section>('workspace')

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="Secciones de ajustes">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`settings__nav-item${section === s.id ? ' is-active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            <i className={`codicon codicon-${s.icon}`} aria-hidden="true" />
            <span>{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="settings__panel">
        {section === 'workspace' && (
          <Panel
            title="Carpetas de trabajo"
            hint="Las raíces donde Oruka busca proyectos. Puede haber más de una."
            pending="M1"
          />
        )}
        {section === 'clis' && <CliSection />}
        {section === 'workspace' && (
          <button className="settings__relaunch" onClick={relaunchSetup}>
            <i className="codicon codicon-debug-restart" aria-hidden="true" />
            <span>Volver a ejecutar el Quick Setup</span>
          </button>
        )}
        {section === 'mcp' && (
          <section>
            <h2 className="settings__title">Servidores MCP</h2>
            <p className="settings__hint">
              Un mismo servidor se reparte a los CLIs que elijas. Oruka enseña el diff antes de
              tocar cada archivo, guarda una copia previa y deja revertir.
            </p>
            <McpMatrix />
          </section>
        )}
        {section === 'github' && (
          <section>
            <h2 className="settings__title">GitHub</h2>
            <p className="settings__hint">
              Instala <code>gh</code> si falta y conecta tu cuenta sin salir de la app. Estaba solo
              en el Quick Setup, y quien ya lo hubiera pasado se quedaba sin forma de llegar.
            </p>
            <GithubAccount />
          </section>
        )}
        {section === 'apariencia' && (
          <Panel
            title="Apariencia"
            hint="Tema, tamaño de fuente de la terminal y densidad de la interfaz."
            pending="M5"
          />
        )}
      </div>
    </div>
  )
}

function Panel({ title, hint, pending }: { title: string; hint: string; pending: string }) {
  return (
    <section>
      <h2 className="settings__title">{title}</h2>
      <p className="settings__hint">{hint}</p>
      <p className="settings__pending">Pendiente ({pending})</p>
    </section>
  )
}
