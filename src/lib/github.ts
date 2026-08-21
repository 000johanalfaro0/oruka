import { invoke } from '@tauri-apps/api/core'

/**
 * Puente con GitHub.
 *
 * Todo pasa por `gh` en el backend: el front no habla HTTP ni ve el token. Si
 * algun dia se cambia `gh` por otra cosa, se cambia el lado Rust y esto sigue
 * igual.
 */

export interface GithubStatus {
  installed: boolean
  authenticated: boolean
  user: string | null
  scopes: string[]
  message: string | null
}

export interface Repo {
  name_with_owner: string
  description: string | null
  private: boolean
  fork: boolean
  url: string
  updated_at: string
  /** ADMIN, WRITE, READ... */
  permission: string | null
}

export interface PullRequest {
  number: number
  title: string
  author: string
  url: string
  draft: boolean
  review_decision: string | null
  updated_at: string
  branch: string
}

export interface Collaborator {
  login: string
  url: string
  permission: string | null
}

export interface Invitation {
  id: number
  repo: string
  inviter: string
  permission: string
  url: string
}

/** Los filtros del panel de PR. El backend entiende estos mismos ids. */
export type PrFilter = 'all' | 'mine' | 'assigned' | 'review'

export const githubStatus = () => invoke<GithubStatus>('github_status')

/** `shared` son los repos en los que solo se colabora. */
export const githubRepos = (shared: boolean) => invoke<Repo[]>('github_repos', { shared })

/** A que repo apunta el `origin` de una carpeta. `null` si no es de GitHub. */
export const githubRepoForPath = (path: string) =>
  invoke<string | null>('github_repo_for_path', { path })

export const githubPrs = (repo: string, filter: PrFilter) =>
  invoke<PullRequest[]>('github_prs', { repo, filter })

export const githubCollaborators = (repo: string) =>
  invoke<Collaborator[]>('github_collaborators', { repo })

export const githubInvitations = () => invoke<Invitation[]>('github_invitations')

/** Acepta o rechaza una invitacion. Se ve desde fuera: preguntar antes. */
export const githubRespondInvitation = (id: number, accept: boolean) =>
  invoke<void>('github_respond_invitation', { id, accept })

/** Una invitacion enviada desde un repo que sigue sin contestar. */
export interface SentInvitation {
  id: number
  invitee: string
  permission: string
  created_at: string
  url: string
}

/**
 * Los niveles de acceso de GitHub, en el orden en que crecen.
 *
 * Los ids son los que entiende la API; las etiquetas, lo que entiende una
 * persona. El backend valida contra esta misma lista.
 */
export const PERMISOS = [
  { id: 'pull', label: 'Lectura', hint: 'Ver y clonar' },
  { id: 'triage', label: 'Clasificar', hint: 'Además gestionar issues y PR' },
  { id: 'push', label: 'Escritura', hint: 'Además subir cambios' },
  { id: 'maintain', label: 'Mantener', hint: 'Además ajustes del repositorio' },
  { id: 'admin', label: 'Administrar', hint: 'Control total, incluido el acceso' },
] as const

export type Permiso = (typeof PERMISOS)[number]['id']

/**
 * Invita a alguien, o le cambia el permiso si ya colaboraba.
 *
 * Le llega un correo: preguntar antes de llamar.
 */
export const githubInvite = (repo: string, login: string, permission: Permiso) =>
  invoke<void>('github_invite', { repo, login, permission })

/** Le quita el acceso a alguien. Preguntar antes. */
export const githubRemoveCollaborator = (repo: string, login: string) =>
  invoke<void>('github_remove_collaborator', { repo, login })

export const githubSentInvitations = (repo: string) =>
  invoke<SentInvitation[]>('github_sent_invitations', { repo })

export const githubCancelInvitation = (repo: string, id: number) =>
  invoke<void>('github_cancel_invitation', { repo, id })

/** Un check de CI sobre un PR. */
export interface Check {
  name: string
  /** `pass`, `fail`, `pending`, `skipping` o `cancel`. */
  bucket: string
  state: string
  url: string
}

export interface Issue {
  number: number
  title: string
  url: string
  repo: string
  updated_at: string
  labels: string[]
}

/** En qué punto está la carpeta respecto a su remoto. */
export interface BranchStatus {
  branch: string
  /** `null` si la rama nunca se ha publicado. */
  upstream: string | null
  ahead: number
  behind: number
  dirty: boolean
}

/** Las tres formas de revisar. `approve` es la única que no exige texto. */
export type ReviewAction = 'approve' | 'request-changes' | 'comment'

export const githubPrDiff = (repo: string, number: number) =>
  invoke<string>('github_pr_diff', { repo, number })

export const githubPrChecks = (repo: string, number: number) =>
  invoke<Check[]>('github_pr_checks', { repo, number })

/** Revisar es público y va firmado con tu nombre: preguntar antes. */
export const githubPrReview = (repo: string, number: number, action: ReviewAction, body: string) =>
  invoke<void>('github_pr_review', { repo, number, action, body })

/** Abre un PR desde la rama actual de la carpeta. Devuelve su URL. */
export const githubPrCreate = (cwd: string, title: string, body: string, base: string) =>
  invoke<string>('github_pr_create', { cwd, title, body, base })

export const githubPrMerge = (
  repo: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase',
  deleteBranch: boolean,
) => invoke<void>('github_pr_merge', { repo, number, method, deleteBranch })

export const githubPrClose = (repo: string, number: number) =>
  invoke<void>('github_pr_close', { repo, number })

export const githubIssues = () => invoke<Issue[]>('github_issues')

export const githubReviewCount = () => invoke<number>('github_review_count')

export const githubBranchStatus = (path: string) =>
  invoke<BranchStatus | null>('github_branch_status', { path })

/** Abre un enlace de GitHub en el navegador del sistema. */
export const githubOpenUrl = (url: string) => invoke<void>('github_open_url', { url })

/**
 * Instala `gh` con el gestor de paquetes del sistema.
 *
 * Sin `gh` el modulo de GitHub entero esta apagado, asi que esto no es una
 * comodidad: es lo que separa tener una cuarta parte de la app o no tenerla.
 */
export const githubInstall = () => invoke<string>('github_install')

/**
 * Arranca la autenticacion dentro de la app.
 *
 * Abre el navegador y deja el codigo de un solo uso en el portapapeles, asi que
 * al usuario solo le queda pegarlo y aprobar. Esa parte no se puede quitar: es
 * GitHub quien exige que una persona apruebe el acceso.
 *
 * La salida llega por el mismo canal que la de un agente, con el id `gh-login`.
 */
export const githubLogin = () => invoke<void>('github_login')
