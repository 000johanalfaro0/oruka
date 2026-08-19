import { useEffect, useState } from 'react'
import * as ai from './ai'
import * as repo from './repository'
import { buildAgentPrompt, formatOrganized } from './agentPrompt'
import {
  STATUS_LABEL,
  type Idea,
  type OrganizedResult,
  type Project,
  type ProjectStatus,
} from './types'

type Tab = 'crudas' | 'organizado'

type Organize =
  | { state: 'idle' | 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; result: OrganizedResult }

/** Detalle de un proyecto: sus ideas crudas y el resultado organizado. */
export function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [tab, setTab] = useState<Tab>('crudas')
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<ProjectStatus>(project.status)
  const [organize, setOrganize] = useState<Organize>({ state: 'idle' })
  const [pasting, setPasting] = useState(false)
  const [rawChat, setRawChat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    repo
      .listIdeas(project.id)
      .then(setIdeas)
      .catch((e) => setError(String(e)))
  }, [project.id])

  const addIdea = async (content: string, extra?: Parameters<typeof repo.createIdea>[2]) => {
    const clean = content.trim()
    if (!clean) return
    setBusy(true)
    try {
      const idea = await repo.createIdea(project.id, clean, extra)
      setIdeas((prev) => [...prev, idea])
      setDraft('')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const removeIdea = async (id: string) => {
    try {
      await repo.deleteIdea(id)
      setIdeas((prev) => prev.filter((i) => i.id !== id))
    } catch (e) {
      setError(String(e))
    }
  }

  const runOrganize = async () => {
    setOrganize({ state: 'loading' })
    setTab('organizado')
    try {
      setOrganize({ state: 'done', result: await ai.organize(project, ideas) })
    } catch (e) {
      setOrganize({ state: 'error', message: String(e) })
    }
  }

  const importChat = async () => {
    const raw = rawChat.trim()
    if (!raw) return
    setBusy(true)
    try {
      const text = await ai.formatChat(raw)
      await addIdea(text, { source_label: 'chat pegado' })
      setRawChat('')
      setPasting(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (next: ProjectStatus) => {
    setStatus(next)
    await repo.setStatus(project.id, next).catch((e) => setError(String(e)))
  }

  return (
    <div className="ipd">
      <header className="ipd__head">
        <button className="ipd__back" onClick={onBack} title="Volver a la lista">
          <i className="codicon codicon-arrow-left" aria-hidden="true" />
        </button>
        <h2 className="ipd__title">{project.title}</h2>
        <select
          className="ipd__status"
          value={status}
          onChange={(e) => void changeStatus(e.target.value as ProjectStatus)}
        >
          {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          className="ipd__agent"
          onClick={() =>
            void navigator.clipboard.writeText(buildAgentPrompt({ ...project, status }, ideas))
          }
          title="Copia el bloc de notas completo como prompt, listo para pegar donde quieras"
        >
          <i className="codicon codicon-copy" aria-hidden="true" />
          <span>Copiar prompt</span>
        </button>
      </header>

      <div className="ipd__tabs" role="tablist">
        {(['crudas', 'organizado'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`ipd__tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'crudas' ? `Ideas crudas (${ideas.length})` : 'Organizado'}
          </button>
        ))}
        <div className="ipd__spacer" />
        <button className="ipd__action" onClick={() => setPasting((v) => !v)}>
          <i className="codicon codicon-clippy" aria-hidden="true" />
          <span>Pegar chat</span>
        </button>
        <button
          className="ipd__action"
          onClick={() => void runOrganize()}
          disabled={ideas.length === 0 || organize.state === 'loading'}
        >
          <i className="codicon codicon-sparkle" aria-hidden="true" />
          <span>Organizar con IA</span>
        </button>
      </div>

      {error && <p className="ideas__error">{error}</p>}

      {pasting && (
        <div className="ipd__paste">
          <textarea
            value={rawChat}
            onChange={(e) => setRawChat(e.target.value)}
            placeholder="Pega aquí la conversación en crudo. La IA la reconstruye en turnos sin resumir nada."
            rows={6}
          />
          <div className="ipd__paste-actions">
            <button onClick={() => setPasting(false)}>Cancelar</button>
            <button className="is-primary" onClick={() => void importChat()} disabled={busy}>
              {busy ? 'Procesando…' : 'Añadir como idea'}
            </button>
          </div>
        </div>
      )}

      {tab === 'crudas' ? (
        <div className="ipd__body">
          <ul className="ipd__ideas">
            {ideas.map((idea) => (
              <li key={idea.id} className="idea">
                <div className="idea__meta">
                  <span>{new Date(idea.created_at).toLocaleDateString()}</span>
                  {idea.type !== 'text' && <span className="idea__badge">{idea.type}</span>}
                  {idea.source_label && <span className="idea__badge">{idea.source_label}</span>}
                  <button
                    className="idea__del"
                    onClick={() => void removeIdea(idea.id)}
                    title="Borrar idea"
                  >
                    <i className="codicon codicon-trash" aria-hidden="true" />
                  </button>
                </div>
                <p className="idea__text">{idea.content}</p>
              </li>
            ))}
            {ideas.length === 0 && (
              <li className="ideas__pending">Este proyecto aún no tiene ideas.</li>
            )}
          </ul>

          <form
            className="ipd__new"
            onSubmit={(e) => {
              e.preventDefault()
              void addIdea(draft)
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escribe una idea. Ctrl+Enter para guardarla."
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void addIdea(draft)
                }
              }}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              Añadir
            </button>
          </form>
        </div>
      ) : (
        <div className="ipd__body">
          {organize.state === 'idle' && (
            <p className="ideas__pending">
              Pulsa Organizar con IA para agrupar tus ideas en temas.
            </p>
          )}
          {organize.state === 'loading' && <p className="ideas__pending">Organizando…</p>}
          {organize.state === 'error' && <p className="ideas__error">{organize.message}</p>}
          {organize.state === 'done' && (
            <div className="org">
              <p className="org__summary">{organize.result.summary}</p>
              {organize.result.themes.map((theme) => (
                <section key={theme.title} className="org__theme">
                  <h3>{theme.title}</h3>
                  <ul>
                    {theme.ideas.map((i, n) => (
                      <li key={n}>{i.refined || i.original}</li>
                    ))}
                  </ul>
                </section>
              ))}
              {organize.result.direction && (
                <section className="org__theme">
                  <h3>Dirección sugerida</h3>
                  <p>{organize.result.direction}</p>
                </section>
              )}
              {organize.result.connections.length > 0 && (
                <section className="org__theme">
                  <h3>Conexiones</h3>
                  <ul>
                    {organize.result.connections.map((c, n) => (
                      <li key={n}>{c}</li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="org__actions">
                <button
                  onClick={() =>
                    void navigator.clipboard.writeText(formatOrganized(organize.result))
                  }
                >
                  Copiar
                </button>
                <button
                  className="is-primary"
                  onClick={() => void addIdea(formatOrganized(organize.result))}
                >
                  Guardar como idea
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
