import { api } from './api'

export type ChatScope = { fundId: string; portcoId?: string | null }

export class ChatQueryError extends Error {
  readonly status: number

  constructor(action: string, status: number) {
    super(`Could not ${action} (status ${status}).`)
    this.name = 'ChatQueryError'
    this.status = status
  }
}

const scopeQuery = (scope: ChatScope) => ({
  fundId: scope.fundId,
  portcoId: scope.portcoId || undefined,
})

export async function createChat(scope: ChatScope, initialMessage: string) {
  const response = await api.chats.$post({
    json: { ...scope, initialMessage, portcoId: scope.portcoId ?? null },
  })
  if (!response.ok) throw new ChatQueryError('start chat', response.status)
  return response.json()
}

export async function fetchChats(scope: ChatScope) {
  const response = await api.chats.$get({ query: scopeQuery(scope) })
  if (!response.ok) throw new ChatQueryError('load chats', response.status)
  return response.json()
}

export async function fetchChat(scope: ChatScope, chatId: string) {
  const response = await api.chats[':chatId'].$get({ param: { chatId }, query: scopeQuery(scope) })
  if (!response.ok) throw new ChatQueryError('load chat', response.status)
  return response.json()
}

export async function answerChat(scope: ChatScope, chatId: string) {
  const response = await api.chats[':chatId'].answer.$post({
    param: { chatId },
    query: scopeQuery(scope),
  })
  if (!response.ok) throw new ChatQueryError('answer this question', response.status)
  return response.json()
}

export async function sendChatMessage(scope: ChatScope, chatId: string, content: string) {
  const response = await api.chats[':chatId'].messages.$post({
    param: { chatId },
    query: scopeQuery(scope),
    json: { content },
  })
  if (!response.ok) throw new ChatQueryError('answer this question', response.status)
  return response.json()
}
