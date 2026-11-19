export {
  buildOwnDataExport,
  exportFilename,
  exportFormatVersion,
  isSameOrigin,
  MY_DATA_PATH,
  MY_DATA_STATUS_PARAM,
  myDataStatuses,
  parseMyDataStatus,
  type MyDataStatus,
  ownDataRowsSchema,
  serializeExport,
  type BuildExportInput,
  type CipherContext,
  type DecryptFn,
  type OwnDataExport,
  type OwnDataRows,
} from "./domain/export";
export {
  authAgeSeconds,
  CONFIRMATION_WORD,
  DELETE_ACCOUNT_PATH,
  DELETE_ACCOUNT_STATUS_PARAM,
  deleteAccountFormSchema,
  isRecentLogin,
  parseDeleteAccountStatus,
  REAUTH_WINDOW_SECONDS,
  type DeleteAccountStatus,
} from "./domain/delete-account";
export {
  CONSENT_PATH,
  CONSENT_PENDING_COOKIE,
  consentFormSchema,
  consentGate,
  consentPendingMaxAgeSeconds,
  parseConsentTerm,
  type ConsentFormState,
  type ConsentGate,
  type ConsentTerm,
} from "./domain/consent";
export { ConsentForm } from "./components/consent-form";
export { ConsentTermView } from "./components/consent-term-view";
export { acceptConsent, readConsentVersion } from "./server/consent";
export { deleteOwnAccount, type DeleteDeps } from "./server/delete-account";
export { exportOwnData, type ExportDeps } from "./server/export";
export type { AcceptConsentResult, ConsentDbClient, DeleteOwnAccountResult, ExportOwnDataResult, PrivacyDbClient } from "./types";
