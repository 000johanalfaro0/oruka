import { useCallback, useEffect, useState } from 'react'
import { detectClis, type DetectedCli } from '@/lib/agents'
import { skillsApply, skillsCatalog, skillsPreview, skillsState, type CliSkillState, type Skill } from '@/lib/skills'
import './mcp-matrix.css'

interface Pending { cliId: string; skill: Skill; remove: boolean; diff: string }

export function SkillsMatrix() {
  const [catalog, setCatalog] = useState<Skill[]>([])
  const [clis, setClis] = useState<DetectedCli[]>([])
  const [states, setStates] = useState<CliSkillState[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (ids: string[]) => setStates(await skillsState(ids)), [])
  useEffect(() => { void (async () => {
    try {
      const [cat, detected] = await Promise.all([skillsCatalog(), detectClis()])
      const usable = detected.filter((c) => c.found)
      setCatalog(cat); setClis(usable); await refresh(usable.map((c) => c.id))
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
  const stateOf = (id: string) => states.find((s) => s.cli_id === id)

  if (!catalog.length) return <p className="mcp__pending">Cargando skills...</p>
  return <div className="mcp">
    <table className="mcp__table"><thead><tr><th className="mcp__corner">Skill</th>{clis.map((c) => <th key={c.id}>{c.name}</th>)}</tr></thead>
      <tbody>{catalog.map((skill) => <tr key={skill.id}><th className="mcp__row-head"><span className="mcp__name">{skill.id}</span><span className="mcp__desc">{skill.description}</span></th>
        {clis.map((c) => { const on = stateOf(c.id)?.installed.includes(skill.id) ?? false; return <td key={c.id}><button className={`mcp__cell${on ? ' is-on' : ''}`} disabled={busy || !!stateOf(c.id)?.unsupported} title={on ? 'Quitar de este CLI' : 'Instalar globalmente en este CLI'} onClick={() => void ask(c.id, skill, on)}><i className={`codicon codicon-${on ? 'check' : 'dash'}`} /></button></td> })}
      </tr>)}</tbody></table>
    {note && <p className="mcp__note">{note} Reinicia ese CLI para recargar su catálogo.</p>}
    {error && <p className="mcp__error">{error}</p>}
    {pending && <div className="mcp__modal" role="dialog" aria-label="Confirmar sincronización"><div className="mcp__modal-card">
      <h3 className="mcp__modal-title">{pending.remove ? 'Quitar' : 'Instalar'} {pending.skill.id} en {pending.cliId}</h3>
      <p className="mcp__modal-path">{stateOf(pending.cliId)?.target}</p><pre className="mcp__diff">{pending.diff}</pre>
      <div className="mcp__modal-actions"><button className="mcp__cancel" onClick={() => setPending(null)}>Cancelar</button><button className="mcp__confirm" disabled={busy} onClick={() => void confirm()}>{busy ? 'Sincronizando...' : 'Aplicar con copia previa'}</button></div>
    </div></div>}
  </div>
}
