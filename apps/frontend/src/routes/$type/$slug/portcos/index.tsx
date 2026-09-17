import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { fetchPortcos } from '../../../../lib/fund-queries'
import { Route as ScopeRoute } from '../route'

export const Route = createFileRoute('/$type/$slug/portcos/')({ component: PortcoList })

function PortcoList() {
  const { type } = Route.useParams()
  const { fund, portco } = ScopeRoute.useLoaderData()
  const portcos = useQuery({
    queryKey: ['funds', fund?.id, 'portcos'],
    queryFn: () => fetchPortcos(fund!.id),
    enabled: Boolean(fund),
  })

  if (type !== 'fund' || portco) throw notFound()
  if (portcos.isPending) return <ListState>Loading portfolio companies…</ListState>
  if (portcos.isError) return <ListState error>{portcos.error.message}</ListState>

  return (
    <main className="mx-auto w-[min(940px,calc(100%-40px))] py-12 max-[720px]:w-full max-[720px]:px-5 max-[720px]:py-6">
      <header className="max-w-[620px]">
        <p className="m-0 text-[0.83rem] text-muted">
          <Link to="/$type/$slug" params={{ type: 'fund', slug: fund.slug }}>
            {fund.name}
          </Link>
        </p>
        <h1 className="my-[18px] mb-3 font-serif text-[clamp(2.7rem,7vw,4.8rem)] font-normal leading-[0.98] tracking-[-0.055em]">
          Portfolio companies
        </h1>
        <p className="text-[1.05rem] leading-[1.65] text-muted">
          Choose a company to work within its scoped record.
        </p>
      </header>
      <table className="mt-16 w-full border-collapse text-left">
        <caption className="mb-3 text-left text-[0.85rem] text-muted">
          {fund.name} portfolio companies
        </caption>
        <thead>
          <tr>
            <th className="border-b border-ink py-2.5 pr-3 text-[0.75rem] font-semibold text-muted">
              Code
            </th>
            <th className="border-b border-ink py-2.5 pr-3 text-[0.75rem] font-semibold text-muted">
              Company
            </th>
            <th className="border-b border-ink py-2.5 pr-0 text-[0.75rem] font-semibold text-muted">
              Workspace
            </th>
          </tr>
        </thead>
        <tbody>
          {portcos.data.data.map((portco) => (
            <tr key={portco.id}>
              <td className="border-b border-rule py-[18px] pr-3">{portco.code}</td>
              <td className="border-b border-rule py-[18px] pr-3">{portco.name}</td>
              <td className="border-b border-rule py-[18px] pr-0">
                <Link
                  className="text-[0.9rem] text-accent underline decoration-accent/35 underline-offset-[3px]"
                  to="/$type/$slug"
                  params={{ type: 'portco', slug: portco.slug }}
                >
                  Open company
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

function ListState({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <main className="mx-auto w-[min(940px,calc(100%-40px))] py-12 max-[720px]:w-full max-[720px]:px-5 max-[720px]:py-6">
      <p className={`mt-16 border-t border-rule py-5 ${error ? 'text-failure' : 'text-muted'}`}>
        {children}
      </p>
    </main>
  )
}
