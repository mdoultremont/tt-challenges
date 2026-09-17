import { createArtifactsModuleInternal } from './module.js';

export const createArtifactsModule = () => createArtifactsModuleInternal();

export {
  ArtifactModuleError,
  type ArtifactDetails,
  type ArtifactErrorCode,
  type ArtifactScope,
  type ArtifactSummary,
  type ArtifactsModule,
  type GenerateExecBriefInput,
} from './module.js';
export type {
  BriefClaim,
  BriefSection,
  BriefSource,
  EvidenceStrength,
  ExecBrief,
  ExecBriefSectionKey,
} from './brief.js';
