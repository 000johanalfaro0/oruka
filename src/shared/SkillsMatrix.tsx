import { useCallback, useEffect, useState } from 'react'
import { detectClis, type DetectedCli } from '@/lib/agents'
import type { MissingRequirement } from '@/lib/mcp'
import {
  skillsApply,
  skillsCatalog,
  skillsInstallRequirement,
  skillsMissing,
  skillsPreview,
  skillsState,
  type CliSkillState,
  type Skill,
} from '@/lib/skills'
import './mcp-matrix.css'

interface Pending { cliId: string; skill: Skill; remove: boolean; diff: string }

export function SkillsMatrix() {
  const [catalog, setCatalog] = useState<Skill[]>([])
  const [clis, setClis] = useState<DetectedCli[]>([])
  const [states, setStates] = useState<CliSkillState[]>([])
  const [faltan, setFaltan] = useState<MissingRequirement[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  /** Que dependencia se esta instalando ahora, si hay alguna. */
  const [instalando, setInstalando] = useState<string | null>(null)
  /** Las que se acaban de instalar en esta sesion de la app. */
  const [reciente, setReciente] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (ids: string[]) => setStates(await skillsState(ids)), [])
  useEffect(() => { void (async () => {
    try {
      const [cat, detected, missing] = await Promise.all([
        skillsCatalog(),
        detectClis(),
        skillsMissing(),
      ])
      const usable = detected.filter((c) => c.found)
      setCatalog(cat); setClis(usable); setFaltan(missing); await refresh(usable.map((c) => c.id))
    } catch (e) { setError(String(e)) }
  })() }, [refresh])

  const ask = async (cliId: string, skill: Skill, remove: boolean) => {
    try { setPending({ cliId, skill, remove, diff: await skillsPreview(cliId, skill, remove) }) }
    catch (e) { setError(String(e)) }
  }
  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const backup = await skillsApply(pending.cliId, pending.skill, pending.remove)
      setNote(`Sincronizado. Copia previa: ${backup}`)
      await refresh(clis.map((c) => c.id)); setPending(null)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  /**
   * Instala el programa que la skill manda usar.
   *
   * No se vuelve a mirar el PATH al terminar: un proceso no se entera de que
   * su PATH ha cambiado mientras esta abierto, y redetectar aqui diria que
   * sigue faltando justo despues de instalarlo.
   */
  const instalarBase = async (m: MissingRequirement) => {
    setInstalando(m.item_id)
    setError(null)
    try {
      await skillsInstallRequirement(m.item_id)
      setReciente((prev) => [...prev, m.item_id])
    } catch (e) { setError(String(e)) } finally { setInstalando(null) }
  }

  const stateOf = (id: string) => states.find((s) => s.cli_id === id)
  const faltaDe = (skillId: string) => faltan.find((m) => m.item_id === skillId)

  if (!catalog.length) return <p className="mcp__pending">Cargando skills...</p>
  return <div className="mcp">
    <table className="mcp__table"><thead><tr><th className="mcp__corner">Skill</th>{clis.map((c) => <th key={c.id}>{c.name}</th>)}</tr></thead>
      <tbody>{catalog.map((skill) => <tr key={skill.id}><th className="mcp__row-head"><span className="mcp__name">{skill.id}</span><span className="mcp__desc">{skill.description}</span>
        {skill.requires && <span className="mcp__req">necesita <code>{skill.requires.bin}</code></span>}</th>
        {clis.map((c) => { const on = stateOf(c.id)?.installed.includes(skill.id) ?? false; return <td key={c.id}><button className={`mcp__cell${on ? ' is-on' : ''}`} disabled={busy || !!stateOf(c.id)?.unsupported} title={on ? 'Quitar de este CLI' : 'Instalar globalmente en este CLI'} onClick={() => void ask(c.id, skill, on)}><i className={`codicon codicon-${on ? 'check' : 'dash'}`} /></button></td> })}
      </tr>)}</tbody></table>

    {/* Una skill se escribe siempre bien: la casilla se pone verde aunque el
        programa que manda usar no exista. Sin este aviso el fallo aparecia
        mucho despues, dentro de una tarea, y parecia culpa del agente. */}
    {faltan.map((m) => {
      const listo = reciente.includes(m.item_id)
      return <div key={m.item_id} className={`mcp__falta${listo ? ' is-listo' : ''}`}>
        <i className={`codicon codicon-${listo ? 'check' : 'warning'}`} aria-hidden="true" />
        <span>
          <strong>{m.item_id}</strong>{' '}
          {listo
            ? <>ya tiene <code>{m.name}</code>. Reinicia Oruka para que lo vea: un programa no se entera de que su PATH ha cambiado mientras está abierto.</>
            : <>se instalará bien, pero no funcionará: le falta <code>{m.name}</code> en este equipo.</>}
        </span>
        {listo ? null : m.installable ? (
          <button className="mcp__falta-btn" disabled={instalando !== null} onClick={() => void instalarBase(m)}>
            {instalando === m.item_id ? 'Instalando…' : `Instalar ${m.name}`}
          </button>
        ) : (
          <a className="mcp__falta-btn" href={m.url} target="_blank" rel="noreferrer">Cómo instalarlo</a>
        )}
      </div>
    })}

    {note && <p className="mcp__note">{note} Reinicia ese CLI para recargar su catálogo.</p>}
    {error && <p className="mcp__error">{error}</p>}
    {pending && <div className="mcp__modal" role="dialog" aria-label="Confirmar sincronización"><div className="mcp__modal-card">
      <h3 className="mcp__modal-title">{pending.remove ? 'Quitar' : 'Instalar'} {pending.skill.id} en {pending.cliId}</h3>
      <p className="mcp__modal-path">{stateOf(pending.cliId)?.target}</p>
      {!pending.remove && faltaDe(pending.skill.id) && (
        <p className="mcp__modal-warn">
          Se escribirá igual, pero hasta que instales <code>{faltaDe(pending.skill.id)!.name}</code> el
          agente no podrá ejecutar lo que esta skill le pide.
        </p>
      )}
      <pre className="mcp__diff">{pending.diff}</pre>
      <div className="mcp__modal-actions"><button className="mcp__cancel" onClick={() => setPending(null)}>Cancelar</button><button className="mcp__confirm" disabled={busy} onClick={() => void confirm()}>{busy ? 'Sincronizando...' : 'Aplicar con copia previa'}</button></div>
    </div></div>}
  </div>
}
