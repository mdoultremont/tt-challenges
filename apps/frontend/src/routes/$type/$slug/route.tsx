import {
  Link,
  Outlet,
  createFileRoute,
  notFound,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { ScopeSelect } from '../../../components/scope-select'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from '../../../components/ui/sidebar'
import { fetchScope, ScopeQueryError, type ScopeType } from '../../../lib/scope-queries'
import { fetchChats, type ChatScope } from '../../../lib/chat-queries'

export const Route = createFileRoute('/$type/$slug')({
  loader: async ({ params }) => {
    if (params.type !== 'fund' && params.type !== 'portco') throw notFound()
    try {
      const response = await fetchScope(params.type as ScopeType, params.slug)
      if (!response.data) throw notFound()
      return response.data
    } catch (error) {
      if (error instanceof ScopeQueryError && error.status === 404) throw notFound()
      throw error
    }
  },
  component: ScopedLayout,
})

function ScopedLayout() {
  const { fund, portco } = Route.useLoaderData()
  const { type, slug } = Route.useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const chatScope: ChatScope = { fundId: fund.id, portcoId: portco?.id }
  const chats = useQuery({
    queryKey: ['chats', chatScope.fundId, chatScope.portcoId ?? null],
    queryFn: () => fetchChats(chatScope),
  })

  return (
    <SidebarProvider style={{ '--sidebar-width': '17rem' } as CSSProperties}>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="gap-[5px] border-b border-rule p-[18px_20px_14px]">
          <ScopeSelect
            fundId={fund.id}
            fundName={fund.name}
            portcoId={portco?.id}
            onScopeChange={(nextScope) => {
              void navigate({
                to: '/$type/$slug',
                params: {
                  type: nextScope.portcoSlug ? 'portco' : 'fund',
                  slug: nextScope.portcoSlug ?? fund.slug,
                },
              })
            }}
          />
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <nav aria-label="Workspace" className="px-4 pt-4">
            <Link
              to="/$type/$slug"
              params={{ type, slug }}
              activeOptions={{ exact: true }}
              className="block border-l-2 border-transparent px-2 py-1.5 text-[0.84rem] text-muted no-underline hover:border-accent hover:text-ink"
              activeProps={{
                className:
                  'block border-l-2 border-accent bg-accent/10 px-2 py-1.5 text-[0.84rem] text-ink no-underline',
              }}
            >
              Home
            </Link>
          </nav>
          <section
            className="border-t border-rule px-4 py-5"
            aria-labelledby="latest-chats-heading"
          >
            <h2 id="latest-chats-heading" className="mb-3 text-[0.72rem] font-semibold text-muted">
              Latest chats
            </h2>
            {chats.isPending ? <p className="text-[0.78rem] text-muted">Loading chats…</p> : null}
            {chats.isError ? (
              <p className="text-[0.78rem] text-failure">{chats.error.message}</p>
            ) : null}
            {chats.data?.data.length === 0 ? (
              <p className="text-[0.78rem] text-muted">No chats yet.</p>
            ) : null}
            {chats.data?.data.length ? (
              <nav aria-label="Latest chats" className="grid gap-1">
                {chats.data.data.slice(0, 8).map((chat) => {
                  const href = `/${type}/${slug}/chat/${chat.id}`
                  return (
                    <Link
                      key={chat.id}
                      to="/$type/$slug/chat/$chatId"
                      params={{ type, slug, chatId: chat.id }}
                      className="block truncate border-l-2 border-transparent px-2 py-1.5 text-[0.8rem] text-muted no-underline hover:border-accent hover:text-ink"
                      activeProps={{
                        className:
                          'block truncate border-l-2 border-accent bg-accent/10 px-2 py-1.5 text-[0.8rem] text-ink no-underline',
                      }}
                      aria-current={location.pathname === href ? 'page' : undefined}
                    >
                      {chat.title?.trim() || 'Untitled conversation'}
                    </Link>
                  )
                })}
              </nav>
            ) : null}
          </section>
        </SidebarContent>
        <SidebarFooter className="border-t border-rule">
          <Link to="/" className="font-serif text-[1.3rem] text-accent no-underline">
            Second Brain
          </Link>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 bg-paper">
        <header className="flex min-h-10 items-center gap-2 border-b border-rule px-5 py-2.5 md:hidden">
          <SidebarTrigger aria-label="Open workspace navigation" />
          <span className="text-[0.84rem] text-muted">{portco?.name ?? fund.name}</span>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
