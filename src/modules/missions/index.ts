export { normalizeEvidence, stepProgress, sumLedger, totalPoints, type StepProgress } from "./domain/progress";
export type {
  EvidenceType,
  MissionActionResult,
  MissionClient,
  MissionErrorCode,
  MissionListItem,
  MissionMode,
  MissionOrigin,
  MissionRun,
  MissionStep,
  MissionSummary,
  MissionsText,
  PendingReview,
  PublishableUnit,
  StepState,
  StepSubmission,
} from "./types";
// Só no servidor (server-only): leituras e ações com o JWT de quem está logado.
export {
  listMissions,
  parsePublishInput,
  publishMission,
  readMission,
  readMyRuns,
  readPendingReviews,
  readPoints,
  readPublishableUnits,
  readSubmissions,
  reviewSubmission,
  startRun,
  submitStep,
} from "./server/missions";
export { sessionMissionClient } from "./server/session";
// Propostas de missão pela equipe (#57).
export {
  decideProposal,
  proposeMission,
  readMyProposals,
  readPendingProposals,
  type MyProposal,
  type PendingProposal,
  type ProposalClient,
} from "./server/proposals";
export { MISSION_PUBLISH_PATH, MISSION_REVIEW_PATH, MISSIONS_PATH, missionPath } from "./paths";
export { MissionCard } from "./components/mission-card";
export { PublishForm } from "./components/publish-form";
export { ReviewItem } from "./components/review-item";
export { ProposalReview } from "./components/proposal-review";
export { StepItem } from "./components/step-item";
