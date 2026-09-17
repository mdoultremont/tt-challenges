import { api } from './api'

export async function fetchFunds() {
  const response = await api.funds.$get()
  if (!response.ok) throw new Error(`Could not load funds (status ${response.status}).`)
  return response.json()
}

export async function fetchPortcos(fundId: string) {
  const response = await api.funds[':fundId'].portcos.$get({ param: { fundId } })
  if (!response.ok)
    throw new Error(`Could not load portfolio companies (status ${response.status}).`)
  return response.json()
}
