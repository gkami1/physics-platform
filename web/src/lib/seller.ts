// Who sells the passes. A самозанятый must show their name and ИНН to buyers, and the legal
// pages quote them. Set at build time (infra/.env → compose build args → PUBLIC_*); an unset
// value shows a bracketed placeholder so a missing setting is obvious on the page.
const env = import.meta.env;

export const seller = {
  name: (env.PUBLIC_SELLER_NAME as string | undefined) || '[ФИО продавца]',
  inn: (env.PUBLIC_SELLER_INN as string | undefined) || '[ИНН]',
  email: (env.PUBLIC_CONTACT_EMAIL as string | undefined) || '[email для связи]',
  site: (env.PUBLIC_SITE_NAME as string | undefined) || 'Физика ЕГЭ',
};

/** Bump with any change to the legal texts; payments and sign-ups record the version. */
export const LEGAL_VERSION = '2026-11-15';
export const LEGAL_DATE = '15 ноября 2026 г.';
