import { useQuery } from '@tanstack/react-query'
import { fetchPortcos } from '../lib/fund-queries'

export type ScopeSelection = {
  portcoId?: string
  portcoSlug?: string
}

type ScopeSelectProps = {
  fundId: string
  fundName?: string
  portcoId?: string | null
  onScopeChange: (scope: ScopeSelection) => void
  disabled?: boolean
}

/**
 * A controlled selector for the two document scopes available within a fund:
 * the whole fund or one of its portfolio companies.
 */
export function ScopeSelect({
  fundId,
  fundName,
  portcoId,
  onScopeChange,
  disabled = false,
}: ScopeSelectProps) {
  const portcos = useQuery({
    queryKey: ['funds', fundId, 'portcos'],
    queryFn: () => fetchPortcos(fundId),
  })

  return (
    <label className="grid gap-[7px]">
      <span className="text-[0.82rem] font-semibold text-muted">Scope</span>
      <select
        className="w-full rounded-none border border-rule bg-card p-[10px_11px] font-[inherit] text-ink"
        value={portcoId ?? ''}
        disabled={disabled || portcos.isPending}
        onChange={(event) => {
          const selected = portcos.data?.data.find((portco) => portco.id === event.target.value)
          onScopeChange({
            portcoId: selected?.id,
            portcoSlug: selected?.slug,
          })
        }}
      >
        <option value="">{fundName ? `${fundName} — fund-wide` : 'Fund-wide'}</option>
        {portcos.data?.data.map((portco) => (
          <option key={portco.id} value={portco.id}>
            {portco.code} — {portco.name}
          </option>
        ))}
      </select>
      {portcos.isError ? (
        <small className="text-[0.78rem] text-failure">
          Portfolio companies could not be loaded.
        </small>
      ) : null}
    </label>
  )
}
