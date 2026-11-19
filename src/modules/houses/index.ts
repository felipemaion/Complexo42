export { HouseFlow } from "./components/house-flow";
export { HousePresentation, type HouseView } from "./components/house-presentation";
export { formatProgress, initialFlow, nextFlow } from "./domain/flow";
export { houseIdFromUnitSlug, houseUnitSlug } from "./domain/link";
export type { FlowContext, FlowEvent, FlowState, HouseActionResult, HouseClient, HouseErrorCode, JoinMethod, Step } from "./types";
// Só no servidor (server-only): a página lê a casa aceita e o questionário.
export { readAcceptedHouse } from "./server/houses";
export { getQuestionnaire } from "./server/questionnaire";
export { sessionHouseClient } from "./server/session";
