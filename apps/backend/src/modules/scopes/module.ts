import { asc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import { funds, portcos } from '../../db/schema.js';

export type FundSummary = { id: string; name: string; slug: string };
export type PortcoSummary = {
  id: string;
  fundId: string;
  code: string;
  name: string;
  slug: string;
};
export type ScopeSummary = {
  type: 'fund' | 'portco';
  fund: FundSummary;
  portco: PortcoSummary | null;
};
export type ScopeErrorCode = 'invalid_input' | 'not_found' | 'conflict';

export class ScopeModuleError extends Error {
  constructor(
    message: string,
    readonly code: ScopeErrorCode,
  ) {
    super(message);
    this.name = 'ScopeModuleError';
  }
}

type ScopeDatabase = typeof defaultDb;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertUuid = (value: string, label: string) => {
  if (!uuidPattern.test(value)) throw new ScopeModuleError(`Invalid ${label}`, 'invalid_input');
};

export const createScopesModuleInternal = ({ db = defaultDb }: { db?: ScopeDatabase } = {}) => {
  const listFunds = () =>
    db
      .select({ id: funds.id, name: funds.name, slug: funds.slug })
      .from(funds)
      .orderBy(asc(funds.name), asc(funds.id));
  const listPortcos = async (fundId: string) => {
    assertUuid(fundId, 'fund id');
    const [fund] = await db.select({ id: funds.id }).from(funds).where(eq(funds.id, fundId));
    if (!fund) throw new ScopeModuleError('Fund not found', 'not_found');
    return db
      .select({
        id: portcos.id,
        fundId: portcos.fundId,
        code: portcos.code,
        name: portcos.name,
        slug: portcos.slug,
      })
      .from(portcos)
      .where(eq(portcos.fundId, fundId))
      .orderBy(asc(portcos.code), asc(portcos.id));
  };
  const getScope = async ({ fundId, portcoId }: { fundId: string; portcoId?: string | null }) => {
    assertUuid(fundId, 'fund id');
    const [fund] = await db
      .select({ id: funds.id, name: funds.name, slug: funds.slug })
      .from(funds)
      .where(eq(funds.id, fundId));
    if (!fund) throw new ScopeModuleError('Fund not found', 'not_found');
    if (!portcoId) return { type: 'fund' as const, fund, portco: null };

    assertUuid(portcoId, 'portco id');
    const [portco] = await db
      .select({
        id: portcos.id,
        fundId: portcos.fundId,
        code: portcos.code,
        name: portcos.name,
        slug: portcos.slug,
      })
      .from(portcos)
      .where(eq(portcos.id, portcoId));
    if (!portco || portco.fundId !== fundId)
      throw new ScopeModuleError('Portco not found for fund', 'not_found');
    return { type: 'portco' as const, fund, portco };
  };
  const resolveScope = async (type: string, slug: string): Promise<ScopeSummary> => {
    if (type !== 'fund' && type !== 'portco')
      throw new ScopeModuleError('Invalid scope type', 'invalid_input');
    if (type === 'fund') {
      const [fund] = await db
        .select({ id: funds.id, name: funds.name, slug: funds.slug })
        .from(funds)
        .where(eq(funds.slug, slug));
      if (!fund) throw new ScopeModuleError('Fund not found', 'not_found');
      return { type, fund, portco: null };
    }
    const matches = await db
      .select({
        fund: { id: funds.id, name: funds.name, slug: funds.slug },
        portco: {
          id: portcos.id,
          fundId: portcos.fundId,
          code: portcos.code,
          name: portcos.name,
          slug: portcos.slug,
        },
      })
      .from(portcos)
      .innerJoin(funds, eq(portcos.fundId, funds.id))
      .where(eq(portcos.slug, slug));
    if (matches.length === 0)
      throw new ScopeModuleError('Portfolio company not found', 'not_found');
    if (matches.length > 1)
      throw new ScopeModuleError('Portfolio company slug is ambiguous', 'conflict');
    const match = matches[0];
    if (!match) throw new ScopeModuleError('Portfolio company not found', 'not_found');
    return { type, fund: match.fund, portco: match.portco };
  };
  return { listFunds, listPortcos, getScope, resolveScope };
};
export type ScopesModule = ReturnType<typeof createScopesModuleInternal>;
