// Portfólio por links (#70, ADR 0007 §5).
export { parsePortfolioLink, youtubeEmbedUrl } from "./domain/link";
export {
  addPortfolioItem,
  PORTFOLIO_KINDS,
  readPortfolio,
  removePortfolioItem,
  type PortfolioClient,
  type PortfolioError,
  type PortfolioItem,
  type PortfolioKind,
} from "./server/portfolio";
export { sessionPortfolioClient } from "./server/session";

export const PORTFOLIO_PATH = "/perfil/portfolio";
