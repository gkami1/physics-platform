// Public amounts rendered into static pages. Compose uses the same settings for checkout.
export const pricesKop = {
  month: Number(import.meta.env.PUBLIC_PRICE_MONTH_KOP || 79000),
  season: Number(import.meta.env.PUBLIC_PRICE_SEASON_KOP || 299000),
};

export const paidFairUseKop = Number(import.meta.env.PUBLIC_TUTOR_PAID_MONTHLY_BUDGET_KOP || 40000);
