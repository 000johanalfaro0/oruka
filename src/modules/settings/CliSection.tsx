import { useEffect, useState } from 'react'
import { detectClis, installCli, type DetectedCli } from '@/lib/agents'
import { nodeInstall, nodeStatus, type NodeStatus } from '@/lib/node'

/**
 * CLIs detectados en este sistema.
 *
 * Llama directamente al puente compartido, no al modulo Workspace: Ajustes y
 * Workspace no se conocen entre si.
 */
export function CliSection() {
  const [clis, setClis] = useState<DetectedCli[] | null>(null)
  const [node, setNode] = useState<NodeStatus | null>(null)
  const [instalandoNode, setInstalandoNode] = useState(false)
  const [instalando, setInstalando] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<DetectedCli | null>(null)
  const [salida, setSalida] = useState<{ id: string; texto: string; mal: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    setClis(null)
    detectClis().then(setClis).catch((e) => setError(String(e)))
    nodeStatus().then(setNode).catch(() => {})
  }

  const instalarNode = async () => {
    setInstalandoNode(true)
    setSalida(null)
    try {
      const texto = await nodeInstall()
      setSalida({ id: 'node', texto: texto.trim().slice(-400) || 'Node.js instalado correctamente.', mal: false })
      setNode(await nodeStatus())
      setClis(await detectClis())
    } catch (e) {
      setSalida({ id: 'node', texto: String(e).slice(-400), mal: true })
    } finally {
      setInstalandoNode(false)
    }
  }

  const instalar = async (c: DetectedCli) => {
    setConfirmar(null)
    setInstalando(c.id)
    setSalida(null)
    try {
      const texto = await installCli(c.id)
      setSalida({ id: c.id, texto: texto.trim().slice(-400) || 'Listo.', mal: false })
      setClis(await detectClis())
    } catch (e) {
      setSalida({ id: c.id, texto: String(e).slice(-400), mal: true })
    } finally {
      setInstalando(null)
    }
  }

  useEffect(refresh, [])

  return (
    <section>
      <div className="settings__head">
        <h2 className="settings__title">CLIs de IA</h2>
        <button className="settings__refresh" onClick={refresh} title="Volver a detectar">
          <i className="codicon codicon-refresh" aria-hidden="true" />
        </button>
      </div>
      <p className="settings__hint">
        Detectados en el PATH. Los que no aparecen simplemente no están instalados; Oruka
        funciona con los que haya.
      </p>

      {error && <p className="settings__error">{error}</p>}
      {!clis && !error && <p className="settings__pending">Detectando…</p>}

      <ul className="cli-list">
        {/* Node.js en la misma lista */}
        <li className={`cli${node?.installed ? ' is-found' : ''}`}>
          <i
            className={`codicon codicon-${node?.installed ? 'pass-filled' : 'circle-large-outline'}`}
            aria-hidden="true"
          />
          <span className="cli__name">Node.js (npm)</span>
          <span className="cli__version">{node?.version ?? ''}</span>
          <span className="cli__modes">
            <span className="cli__mode">base</span>
          </span>
          <span className="cli__path">
            {node?.installed ? 'gestor de paquetes' : 'no encontrado'}
          </span>
          {!node?.installed && (
            <button
              className="cli__install"
              disabled={instalando !== null || instalandoNode}
              onClick={() =>
                setConfirmar({
                  id: 'node',
                  name: 'Node.js (npm)',
                  icon: 'package',
                  found: false,
                  path: null,
                  version: null,
                  modes: [],
                  can_resume: false,
                  role: null,
                  usage: null,
                  install: {
                    command: navigator.userAgent.includes('Mac') ? 'brew' : 'winget',
                    args: navigator.userAgent.includes('Mac')
                      ? ['install', 'node']
                      : ['install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-source-agreements', '--accept-package-agreements'],
                  },
                })
              }
            >
              {instalandoNode ? 'Instalando…' : 'Instalar'}
            </button>
          )}
        </li>

        {clis?.map((cli) => (
          <li key={cli.id} className={`cli${cli.found ? ' is-found' : ''}`}>
            <i
              className={`codicon codicon-${cli.found ? 'pass-filled' : 'circle-large-outline'}`}
              aria-hidden="true"
            />
            <span className="cli__name">{cli.name}</span>
            <span className="cli__version">{cli.version ?? ''}</span>
            <span className="cli__modes">
              {cli.modes.map((m) => (
                <span key={m} className="cli__mode">
                  {m}
                </span>
              ))}
            </span>
            <span className="cli__path" title={cli.path ?? ''}>
              {cli.path ?? 'no encontrado'}
            </span>
            {cli.install && (
              <button
                className="cli__install"
                disabled={instalando !== null || (!node?.installed && cli.install.command === 'npm')}
                title={
                  !node?.installed && cli.install.command === 'npm'
                    ? 'Requiere instalar Node.js primero'
                    : undefined
                }
                onClick={() => setConfirmar(cli)}
              >
                {instalando === cli.id ? 'Instalando…' : cli.found ? 'Actualizar' : 'Instalar'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {confirmar && (
        <div className="setup__confirm">
          <p>Se va a ejecutar en tu equipo, y puede tardar unos minutos:</p>
          <code>
            {confirmar.install!.command} {confirmar.install!.args.join(' ')}
          </code>
          <div className="setup__confirm-acts">
            <button className="setup__cancel" onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              className="setup__go"
              onClick={() => {
                if (confirmar.id === 'node') {
                  setConfirmar(null)
                  void instalarNode()
                } else {
                  void instalar(confirmar)
                }
              }}
            >
              Ejecutar
            </button>
          </div>
        </div>
      )}

      {salida && (
        <pre className={`setup__salida${salida.mal ? ' is-mal' : ''}`}>{salida.texto}</pre>
      )}
    </section>
  )
}
