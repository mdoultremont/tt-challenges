import { api } from './api'

export type ScopeType = 'fund' | 'portco'

export class ScopeQueryError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Could not load scope (status ${status}).`)
    this.name = 'ScopeQueryError'
    this.status = status
  }
}

export async function fetchScope(type: ScopeType, slug: string) {
  const response = await api.scopes[':type'][':slug'].$get({ param: { type, slug } })
  if (!response.ok) {
    throw new ScopeQueryError(response.status)
  }
  return response.json()
}
