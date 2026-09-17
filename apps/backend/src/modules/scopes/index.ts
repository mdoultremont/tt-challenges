import { createScopesModuleInternal } from './module.js';

export const createScopesModule = () => createScopesModuleInternal();

export {
  ScopeModuleError,
  type FundSummary,
  type PortcoSummary,
  type ScopeSummary,
  type ScopesModule,
} from './module.js';
