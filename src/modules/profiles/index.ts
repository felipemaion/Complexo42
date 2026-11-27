export {
  ProfileInputError,
  accessStatuses,
  parseProfileContactInput,
  parseProfileInput,
  profileContactInputSchema,
  profileInputSchema,
  profileLimits,
  profileStatuses,
  serializeSocialLinks,
} from "./domain/schema";
export {
  consentNotYetGiven,
  neighborhoodSentField,
  parseProfileForm,
  profileFormFields,
  socialLinkFormEntriesMax,
  socialLinksSentField,
  type ParsedProfileForm,
  type ProfileFormField,
} from "./domain/form";
export {
  normalizeSocialLink,
  socialLinkInputMaxLength,
  socialLinkRel,
  socialLinkView,
  socialLinkViews,
  type SocialLinkView,
} from "./domain/social";
export { brazilianWhatsappToE164, formatBrazilianWhatsapp } from "./domain/whatsapp";
export { filterMunicipalities, hasDistrictChoice } from "./domain/localities";
export {
  hasOwnProfile,
  listDistricts,
  listMunicipalitiesByState,
  loadOwnProfile,
  saveOwnProfile,
  type ProfileDeps,
} from "./server/profile";
export {
  CONTACT_VISIBILITY_PATH,
  CONTACT_VISIBILITY_STATUS_PARAM,
  contactKinds,
  contactScopes,
  contactVisibilityStatuses,
  defaultContactVisibility,
  describeContactView,
  parseContactVisibilityChoice,
  parseContactVisibilityStatus,
  visibilityFromRows,
  type ContactKind,
  type ContactScope,
  type ContactView,
  type ContactViewText,
  type ContactVisibility,
  type ContactVisibilityChoice,
  type ContactVisibilityStatus,
  type MemberContact,
} from "./domain/contact";
export {
  listContactViews,
  loadContactVisibility,
  setContactVisibility,
  viewMemberContact,
  type ContactDeps,
  type SetContactVisibilityResult,
  type ViewMemberContactResult,
} from "./server/contact";
export { ProfileForm } from "./components/profile-form";
export { SocialLinkList } from "./components/social-links";
export { ContactViewsList, ContactVisibilityChoices, type ContactVisibilityText } from "./components/contact-visibility";
export type {
  AccessStatus,
  DistrictOption,
  MunicipalityOption,
  OwnProfile,
  ProfileContactInput,
  ProfileDbClient,
  ProfileFormState,
  ProfileFormValues,
  ProfileInput,
  ProfileStatus,
  SaveProfileResult,
} from "./types";
