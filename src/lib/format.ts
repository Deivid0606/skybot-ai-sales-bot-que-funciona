export const APP_TIMEZONE = "America/Asuncion";
export const APP_LOCALE = "es-PY";
export const APP_CURRENCY = "PYG";

/** Formatea un monto en guaraníes (sin decimales). */
export function formatGs(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return `₲ ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString(APP_LOCALE)}`;
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Fecha y hora en horario de Paraguay (Asunción). */
export function formatDateTime(value: string | number | Date): string {
  return toDate(value).toLocaleString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Fecha en horario de Paraguay (Asunción). */
export function formatDate(value: string | number | Date): string {
  return toDate(value).toLocaleDateString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Hora en horario de Paraguay (Asunción). */
export function formatTime(value: string | number | Date): string {
  return toDate(value).toLocaleTimeString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}
