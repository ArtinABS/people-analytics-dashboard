const MONTH_FORMAT = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

export function formatMonth(month) {
  return MONTH_FORMAT.format(new Date(`${month}-01T00:00:00Z`));
}

export function quarterLabel(quarter) {
  const [year, period] = quarter.split("-");
  return `${period} ${year}`;
}

export function formatPromotionMonth(period, monthsSincePromotion) {
  if (!Number.isInteger(monthsSincePromotion) || monthsSincePromotion < 0) return "Unavailable";
  const date = new Date(`${period.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - monthsSincePromotion);
  return MONTH_FORMAT.format(date);
}
