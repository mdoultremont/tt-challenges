import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { fetchFunds } from '../lib/fund-queries'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const funds = useQuery({ queryKey: ['funds'], queryFn: fetchFunds })

  return (
    <main className="mx-auto w-[min(760px,calc(100%-40px))] py-24 max-[720px]:py-14">
      <header className="max-w-[620px]">
        <p className="text-[0.9rem] font-semibold text-accent">Second Brain</p>
        <h1 className="my-[18px] mb-3 font-serif text-[clamp(2.7rem,7vw,4.8rem)] font-normal leading-[0.98] tracking-[-0.055em]">
          Workspaces
        </h1>
        <p className="text-[1.05rem] leading-[1.65] text-muted">Choose a fund.</p>
      </header>
      {funds.isPending ? (
        <p className="mt-16 border-t border-rule py-5 text-muted">Loading funds…</p>
      ) : null}
      {funds.isError ? (
        <p className="mt-16 border-t border-rule py-5 text-failure">{funds.error.message}</p>
      ) : null}
      {funds.data ? (
        <table className="mt-16 w-full border-collapse text-left">
          <caption className="mb-3 text-left text-[0.85rem] text-muted">Available funds</caption>
          <thead>
            <tr>
              <th className="border-b border-ink py-2.5 pr-3 text-[0.75rem] font-semibold text-muted">
                Fund
              </th>
              <th className="border-b border-ink py-2.5 pr-0 text-[0.75rem] font-semibold text-muted">
                Workspace
              </th>
            </tr>
          </thead>
          <tbody>
            {funds.data.data.map((fund) => (
              <tr key={fund.id}>
                <td className="border-b border-rule py-[18px] pr-3">{fund.name}</td>
                <td className="border-b border-rule py-[18px] pr-0">
                  <Link
                    className="text-[0.9rem] text-accent underline decoration-accent/35 underline-offset-[3px]"
                    to="/$type/$slug"
                    params={{ type: 'fund', slug: fund.slug }}
                  >
                    Open fund
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  )
}
