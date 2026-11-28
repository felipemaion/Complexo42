export { HouseFlow } from "./components/house-flow";
export { OwnHouse } from "./components/own-house-card";
export { HousePresentation, type HouseView } from "./components/house-presentation";
export { formatProgress, initialFlow, nextFlow } from "./domain/flow";
export type { FlowContext, FlowEvent, FlowState, HouseActionResult, HouseClient, HouseErrorCode, JoinMethod, Step } from "./types";
// Só no servidor (server-only): a página lê a casa aceita e o questionário.
export { readAcceptedHouse, readTransferWindow } from "./server/houses";
export { getQuestionnaire } from "./server/questionnaire";
export { readChangeHouse } from "./server/change-house-session";
export { sessionHouseClient } from "./server/session";
export { requireCoordinationScreen, coordinationViewDeps, readCoordinationLinks } from "./server/coordination-session";
export { canSeeResults, choseOtherHouse, listCases, listDelegationCandidates, listDelegations, listResults, openCase, openResult } from "./server/coordination-views";
export { changeHouse, grantQuestionnaireAccess, setTransferWindow, resolveAnalysis, revokeQuestionnaireAccess } from "./server/coordination";
export type { CaseRow, CandidateRow, DelegationRow, ResultRow } from "./server/coordination-views";
export { readOwnHouseCard, type OwnHouseCard } from "./server/own-house";
export { readMemberTotems } from "./server/member-totems";
