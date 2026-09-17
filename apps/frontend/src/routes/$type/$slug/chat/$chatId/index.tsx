import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  ChatQueryError,
  answerChat,
  fetchChat,
  sendChatMessage,
  type ChatScope,
} from '../../../../../lib/chat-queries'
import { DocumentViewer } from '../../../../../modules/documents'
import { Route as ScopeRoute } from '../../route'

export const Route = createFileRoute('/$type/$slug/chat/$chatId/')({ component: ChatPage })

type Conversation = Awaited<ReturnType<typeof fetchChat>>['data']
type ChatMessage = Conversation['messages'][number]
type Citation = ChatMessage['citations'][number]
type GeneratedArtifact = NonNullable<ChatMessage['artifact']>

function ChatPage() {
  const { chatId } = Route.useParams()
  // Remount per chat so answer and follow-up state never leaks between conversations.
  return <ChatConversation key={chatId} chatId={chatId} />
}

function ChatConversation({ chatId }: { chatId: string }) {
  const { type, slug } = Route.useParams()
  const { fund, portco } = ScopeRoute.useLoaderData()
  const scope: ChatScope = { fundId: fund.id, portcoId: portco?.id }
  const queryClient = useQueryClient()
  const chatKey = ['chat', chatId, scope.fundId, scope.portcoId ?? null]
  const [draft, setDraft] = useState('')
  const autoAnswered = useRef(new Set<string>())
  const endOfThread = useRef<HTMLDivElement>(null)

  const chat = useQuery({ queryKey: chatKey, queryFn: () => fetchChat(scope, chatId) })

  const refreshConversation = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: chatKey }),
      queryClient.invalidateQueries({ queryKey: ['chats', scope.fundId, scope.portcoId ?? null] }),
    ])
  }

  const answer = useMutation({
    mutationFn: () => answerChat(scope, chatId),
    onSettled: refreshConversation,
  })
  const followUp = useMutation({
    mutationFn: (content: string) => sendChatMessage(scope, chatId, content),
    onMutate: () => {
      answer.reset()
      setDraft('')
    },
    onError: async (_error, content) => {
      await refreshConversation()
      // The question is saved before answering; only unsaved text goes back into the box.
      const latest = queryClient
        .getQueryData<Awaited<ReturnType<typeof fetchChat>>>(chatKey)
        ?.data.messages.at(-1)
      if (latest?.role !== 'user' || latest.content !== content.trim()) setDraft(content)
      // A saved question whose answer just failed waits for an explicit retry.
      else autoAnswered.current.add(latest.id)
    },
    onSettled: async (_data, error) => {
      if (!error) await refreshConversation()
    },
  })

  const messages = chat.data?.data.messages ?? []
  const unanswered = messages.at(-1)?.role === 'user' ? messages.at(-1) : undefined

  useEffect(() => {
    // A new chat, a reload after an interrupted answer, or a question added elsewhere is answered once.
    if (!unanswered || autoAnswered.current.has(unanswered.id)) return
    if (answer.isPending || followUp.isPending) return
    autoAnswered.current.add(unanswered.id)
    answer.mutate()
  }, [unanswered, answer, followUp])

  useEffect(() => {
    endOfThread.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages.length, followUp.isPending])

  if (chat.isPending) return <ChatState>Loading conversation…</ChatState>
  if (chat.isError) {
    if (chat.error instanceof ChatQueryError && chat.error.status === 404) throw notFound()
    return <ChatState error>{chat.error.message}</ChatState>
  }
  const conversation = chat.data.data
  const answering = answer.isPending || followUp.isPending
  const answerFailure = unanswered && !answering ? (answer.error ?? followUp.error) : null
  const composerFailure = !unanswered && !followUp.isPending ? followUp.error : null
  const canSend = !unanswered && !answering
  // A refetch during sending can already include the saved question; don't show it twice.
  const showSendingQuestion =
    followUp.isPending && unanswered?.content !== followUp.variables.trim()

  const submit = () => {
    const content = draft.trim()
    if (content && canSend) followUp.mutate(content)
  }

  return (
    <main className="mx-auto flex min-h-full w-[min(800px,calc(100%-40px))] flex-col py-12 max-[720px]:w-full max-[720px]:px-5 max-[720px]:py-6">
      <header className="border-b border-rule pb-6">
        <p className="m-0 text-[0.83rem] text-muted">
          <Link
            className="underline decoration-rule underline-offset-[3px]"
            to="/$type/$slug"
            params={{ type, slug }}
          >
            {portco?.name ?? fund.name}
          </Link>
        </p>
        <h1 className="my-4 font-serif text-3xl font-normal tracking-[-0.03em]">
          {conversation.title ?? 'Conversation'}
        </h1>
        <p className="m-0 text-[0.82rem] text-muted">
          {portco ? 'Portfolio company scope' : 'Fund-wide scope'}
        </p>
      </header>
      <ol className="m-0 grid list-none gap-7 p-0 py-8" aria-live="polite">
        {conversation.messages.map((message) => (
          <MessageItem key={message.id} message={message} scope={scope}>
            {message.artifact ? (
              <GeneratedDocumentAction
                artifact={message.artifact}
                scope={scope}
                onClose={refreshConversation}
              />
            ) : null}
            {message.id === unanswered?.id ? (
              <AnswerStatus
                answering={answering}
                failure={answerFailure}
                onRetry={() => {
                  followUp.reset()
                  answer.mutate()
                }}
              />
            ) : null}
          </MessageItem>
        ))}
        {showSendingQuestion ? (
          <MessageItem
            message={{ id: 'sending', role: 'user', content: followUp.variables }}
            scope={scope}
          >
            <AnswerStatus answering failure={null} onRetry={() => undefined} />
          </MessageItem>
        ) : null}
      </ol>
      <div ref={endOfThread} />
      <form
        className="mt-auto border-t border-rule pt-5"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="grid gap-2" htmlFor="follow-up-message">
          <span className="text-[0.9rem] font-semibold">Ask a follow-up</span>
          <textarea
            id="follow-up-message"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
            disabled={!canSend}
            placeholder={
              unanswered
                ? 'Waiting for an answer to the last question…'
                : 'What else should we look into?'
            }
            className="w-full resize-y rounded-none border border-rule bg-card p-3 font-inherit text-ink disabled:cursor-not-allowed disabled:opacity-70"
          />
        </label>
        {composerFailure ? (
          <p className="mt-2 text-sm text-failure" role="alert">
            {composerFailure instanceof ChatQueryError && composerFailure.status === 400
              ? 'That message could not be sent. Check its length and try again.'
              : 'Your message was not sent. Try again.'}
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="m-0 text-[0.76rem] text-muted">
            Answers only use documents in this scope. Enter to send, Shift+Enter for a new line.
          </p>
          <button
            type="submit"
            disabled={!draft.trim() || !canSend}
            className="border border-accent bg-accent px-3 py-[9px] text-[0.84rem] text-white disabled:cursor-not-allowed disabled:opacity-55"
          >
            {followUp.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </main>
  )
}

function MessageItem({
  message,
  scope,
  children,
}: {
  message: Pick<ChatMessage, 'id' | 'role' | 'content'> & { citations?: Citation[] }
  scope: ChatScope
  children?: React.ReactNode
}) {
  const isAssistant = message.role === 'assistant'
  return (
    <li
      className={
        isAssistant
          ? 'max-w-[720px] border-l-2 border-accent pl-4'
          : 'max-w-[720px] border-l-2 border-rule bg-rule/45 px-4 py-3'
      }
    >
      <p className="m-0 mb-2 text-[0.76rem] font-semibold text-muted">
        {isAssistant ? 'Second Brain' : 'You'}
      </p>
      {isAssistant ? (
        <AssistantAnswer
          messageId={message.id}
          content={message.content}
          citations={message.citations ?? []}
          scope={scope}
        />
      ) : (
        <p className="m-0 whitespace-pre-wrap text-[0.96rem] leading-[1.7] text-ink">
          {message.content}
        </p>
      )}
      {children}
    </li>
  )
}

function GeneratedDocumentAction({
  artifact,
  scope,
  onClose,
}: {
  artifact: GeneratedArtifact
  scope: ChatScope
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-rule bg-card px-3 py-2.5">
      <p className="m-0 min-w-0 text-[0.84rem]">
        <span className="block font-serif text-[1rem] text-ink">{artifact.title}</span>
        <span className="text-[0.74rem] text-muted">Saved to documents</span>
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-ink px-2.5 py-1 text-[0.8rem] text-ink hover:border-accent hover:text-accent"
      >
        Show document
      </button>
      {open ? (
        <DocumentViewer
          document={{ id: artifact.documentId, title: artifact.title }}
          scope={scope}
          onClose={() => {
            setOpen(false)
            // The brief may have been deleted from the viewer.
            onClose()
          }}
        />
      ) : null}
    </div>
  )
}

function AnswerStatus({
  answering,
  failure,
  onRetry,
}: {
  answering: boolean
  failure: Error | null
  onRetry: () => void
}) {
  if (answering) {
    return (
      <p className="mt-3 text-[0.8rem] text-muted" role="status">
        Searching the documents and drafting an answer…
      </p>
    )
  }
  if (!failure) return null
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-3 border-l-2 border-failure bg-card px-3 py-2"
      role="alert"
    >
      <p className="m-0 text-[0.82rem] text-failure">{failureMessage(failure)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="border border-ink px-2.5 py-1 text-[0.8rem] text-ink hover:border-accent hover:text-accent"
      >
        Retry
      </button>
    </div>
  )
}

const citationMarker = /\[(\d+)\]/g

function AssistantAnswer({
  messageId,
  content,
  citations,
  scope,
}: {
  messageId: string
  content: string
  citations: Citation[]
  scope: ChatScope
}) {
  const [openSources, setOpenSources] = useState<Set<number>>(() => new Set())
  const [viewing, setViewing] = useState<Citation | null>(null)
  const [showAllSources, setShowAllSources] = useState(false)
  const [revealing, setRevealing] = useState<number | null>(null)
  const sourceId = (number: number) => `source-${messageId}-${number}`
  const visibleCitations = showAllSources ? citations : citations.slice(0, 1)
  const hiddenCount = citations.length - visibleCitations.length

  useEffect(() => {
    // Scroll once the revealed source (possibly behind "show all") is rendered.
    if (revealing === null) return
    const target = document.getElementById(sourceId(revealing))
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    target?.querySelector('button')?.focus({ preventScroll: true })
    setRevealing(null)
  }, [revealing])

  const toggleSource = (number: number) =>
    setOpenSources((current) => {
      const next = new Set(current)
      if (next.has(number)) next.delete(number)
      else next.add(number)
      return next
    })

  const revealSource = (number: number) => {
    setOpenSources((current) => new Set(current).add(number))
    if (number > 1) setShowAllSources(true)
    setRevealing(number)
  }

  // Markers that match a stored citation become links; anything else stays as plain text.
  const linkedContent = content.replace(citationMarker, (marker, value: string) => {
    const number = Number(value)
    return number >= 1 && number <= citations.length
      ? `[\\[${number}\\]](#${sourceId(number)})`
      : marker
  })

  return (
    <>
      <div className="grid gap-3 text-[0.96rem] leading-[1.7] text-ink">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p className="m-0">{children}</p>,
            ul: ({ children }) => <ul className="m-0 list-disc pl-6">{children}</ul>,
            ol: ({ children }) => <ol className="m-0 list-decimal pl-6">{children}</ol>,
            a: ({ children, href }) => {
              const number = href?.startsWith(`#source-${messageId}-`)
                ? Number(href.split('-').at(-1))
                : null
              if (!number) {
                return (
                  <a className="text-accent underline" href={href}>
                    {children}
                  </a>
                )
              }
              const citation = citations[number - 1]
              return (
                <button
                  type="button"
                  onClick={() => revealSource(number)}
                  aria-label={`Source ${number}: ${citation?.documentTitle ?? 'document'}`}
                  className="mx-px align-super text-[0.7rem] font-semibold text-accent hover:underline"
                >
                  {children}
                </button>
              )
            },
          }}
        >
          {linkedContent}
        </ReactMarkdown>
      </div>
      {citations.length > 0 ? (
        <aside className="mt-4 border-t border-rule pt-3" aria-label="Sources">
          <p className="m-0 text-[0.72rem] font-semibold text-muted">
            Sources ({citations.length})
          </p>
          <ol className="m-0 mt-2 grid list-none gap-1 p-0">
            {visibleCitations.map((citation, index) => {
              const number = index + 1
              const open = openSources.has(number)
              return (
                <li key={citation.chunkId} id={sourceId(number)}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`${sourceId(number)}-excerpt`}
                    onClick={() => toggleSource(number)}
                    className="grid w-full grid-cols-[2rem_1fr_auto] items-baseline gap-2 py-1 text-left text-[0.8rem] hover:text-accent"
                  >
                    <span className="font-semibold text-accent">[{number}]</span>
                    <span className="min-w-0">
                      <span className="text-ink">{citation.documentTitle}</span>
                      <SourceLocation citation={citation} />
                    </span>
                    <span className="text-[0.72rem] text-muted" aria-hidden>
                      {open ? 'Hide' : 'Show'}
                    </span>
                  </button>
                  {open ? (
                    <div id={`${sourceId(number)}-excerpt`} className="mb-2 ml-8">
                      <blockquote className="m-0 whitespace-pre-wrap border-l-2 border-rule bg-card px-3 py-2 text-[0.8rem] leading-[1.55] text-ink">
                        {citation.excerpt}
                      </blockquote>
                      <button
                        type="button"
                        onClick={() => setViewing(citation)}
                        className="mt-1.5 text-[0.76rem] text-muted underline decoration-rule underline-offset-[3px] hover:text-accent"
                      >
                        Open document
                      </button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
          {citations.length > 1 ? (
            <button
              type="button"
              onClick={() => setShowAllSources((current) => !current)}
              aria-expanded={showAllSources}
              className="mt-1 ml-10 text-[0.76rem] text-muted underline decoration-rule underline-offset-[3px] hover:text-accent"
            >
              {showAllSources
                ? 'Show fewer sources'
                : `Show ${hiddenCount} more ${hiddenCount === 1 ? 'source' : 'sources'}`}
            </button>
          ) : null}
        </aside>
      ) : null}
      {viewing ? (
        <DocumentViewer
          document={{ id: viewing.documentId, title: viewing.documentTitle }}
          scope={scope}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  )
}

function SourceLocation({ citation }: { citation: Citation }) {
  const section = citation.headingPath.join(' › ')
  const lines =
    citation.startLine !== null
      ? citation.endLine !== null && citation.endLine !== citation.startLine
        ? `Lines ${citation.startLine}–${citation.endLine}`
        : `Line ${citation.startLine}`
      : null
  const details = [section, lines].filter(Boolean)
  if (!details.length) return null
  return <span className="text-muted"> · {details.join(' · ')}</span>
}

function failureMessage(error: Error) {
  if (error instanceof ChatQueryError) {
    if (error.status === 503) {
      return 'The answer service is unavailable right now. Your question is saved; retry in a moment.'
    }
    if (error.status === 409) return 'This conversation changed elsewhere. Retry to continue.'
  }
  return 'Something went wrong while answering. Retry to try again.'
}

function ChatState({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <main className="mx-auto w-[min(800px,calc(100%-40px))] py-12 text-muted max-[720px]:w-full max-[720px]:px-5 max-[720px]:py-6">
      <p className={error ? 'text-failure' : undefined}>{children}</p>
    </main>
  )
}
