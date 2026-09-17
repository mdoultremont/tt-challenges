import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { DocumentImport, DocumentList } from '../../../modules/documents'
import { createChat, type ChatScope } from '../../../lib/chat-queries'
import { Route as ScopeRoute } from './route'

export const Route = createFileRoute('/$type/$slug/')({ component: ScopedOverview })

function ScopedOverview() {
  const routeParams = Route.useParams()
  const { fund, portco } = ScopeRoute.useLoaderData()
  const documentsScope = { fundId: fund.id, portcoId: portco?.id }
  const chatScope: ChatScope = documentsScope
  return (
    <main className="mx-auto w-[min(940px,calc(100%-40px))] py-12 max-[720px]:w-full max-[720px]:px-5 max-[720px]:py-6">
      <header>
        <p className="m-0 text-[0.83rem] text-muted">
          <Link
            className="underline decoration-rule underline-offset-[3px]"
            to="/$type/$slug"
            params={{ type: 'fund', slug: fund.slug }}
          >
            {fund.name}
          </Link>
          {portco ? ` / ${portco.code}` : ''}
        </p>
        <h1 className="my-[18px] mb-3 font-serif text-[clamp(2.7rem,7vw,4.8rem)] font-normal leading-[0.98] tracking-[-0.055em]">
          {portco?.name ?? fund.name}
        </h1>
        <p className="text-[1.05rem] leading-[1.65] text-muted">
          {portco ? 'Portfolio company scope' : 'Fund-wide scope'}
        </p>
      </header>
      <ChatPrompt scope={chatScope} type={routeParams.type} slug={routeParams.slug} />
      <section className="mb-10 mt-[46px]" aria-labelledby="documents-heading">
        <div className="flex items-baseline justify-between pb-3.5 max-[720px]:items-start max-[720px]:gap-4">
          <div>
            <h2 className="m-0 text-[0.9rem] font-semibold" id="documents-heading">
              Documents
            </h2>
            <p className="m-[5px_0_0] text-[0.82rem] leading-[1.45] text-muted">
              Source material available to this view.
            </p>
          </div>
          <DocumentImport scope={documentsScope} />
        </div>
        <DocumentList scope={documentsScope} />
      </section>
    </main>
  )
}

function ChatPrompt({ scope, type, slug }: { scope: ChatScope; type: string; slug: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const startChat = useMutation({
    mutationFn: () => createChat(scope, message),
    onSuccess: async ({ data }) => {
      await queryClient.invalidateQueries({
        queryKey: ['chats', scope.fundId, scope.portcoId ?? null],
      })
      void navigate({
        to: '/$type/$slug/chat/$chatId',
        params: { type, slug, chatId: data.id },
      })
    },
  })
  return (
    <form
      className="mt-14 border-y border-ink py-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (message.trim()) startChat.mutate()
      }}
    >
      <label className="grid gap-2" htmlFor="chat-message">
        <span className="text-[0.9rem] font-semibold">Ask about this scope</span>
        <textarea
          id="chat-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="What should we look into?"
          rows={3}
          disabled={startChat.isPending}
          className="w-full resize-y rounded-none border border-rule bg-card p-3 font-inherit text-ink"
        />
      </label>
      {startChat.isError ? (
        <p className="mt-2 text-sm text-failure">{startChat.error.message}</p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={!message.trim() || startChat.isPending}
          className="border border-accent bg-accent px-3 py-[9px] text-[0.84rem] text-white disabled:cursor-not-allowed disabled:opacity-55"
        >
          {startChat.isPending ? 'Starting…' : 'Start chat'}
        </button>
      </div>
    </form>
  )
}
