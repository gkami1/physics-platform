// Who sells the passes. A самозанятый must show their name and ИНН to buyers, and the legal
// pages quote them. Deployments can override these public details at build time.
const env = import.meta.env;

export const seller = {
  name: (env.PUBLIC_SELLER_NAME as string | undefined) || 'Габдулхаков Булат Фанисович',
  inn: (env.PUBLIC_SELLER_INN as string | undefined) || '165810943388',
  email: (env.PUBLIC_CONTACT_EMAIL as string | undefined) || 'traektoriateam@yandex.ru',
  site: (env.PUBLIC_SITE_NAME as string | undefined) || 'Физика ЕГЭ',
};

/** Bump with any change to the legal texts; payments and sign-ups record the version. */
export const LEGAL_VERSION = '2026-11-24.1';
export const LEGAL_DATE = '24 ноября 2026 г.';
