const DEFAULT_TIME_ZONE = "America/Asuncion";

export type CurrentTimeContext = {
  timeZone: string;
  date: string;
  time: string;
  weekday: string;
  hour: number;
  minute: number;
  period: "madrugada" | "mañana" | "tarde" | "noche";
  greeting: "Buenos días" | "Buenas tardes" | "Buenas noches";
};

export function getCurrentTimeContext(
  timeZone = DEFAULT_TIME_ZONE,
): CurrentTimeContext {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("es-PY", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";

  const hour = Number(getPart("hour"));
  const minute = Number(getPart("minute"));

  let period: CurrentTimeContext["period"];
  let greeting: CurrentTimeContext["greeting"];

  if (hour >= 5 && hour < 12) {
    period = "mañana";
    greeting = "Buenos días";
  } else if (hour >= 12 && hour < 19) {
    period = "tarde";
    greeting = "Buenas tardes";
  } else if (hour >= 19 || hour < 1) {
    period = "noche";
    greeting = "Buenas noches";
  } else {
    period = "madrugada";
    greeting = "Buenas noches";
  }

  const date = new Intl.DateTimeFormat("es-PY", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const time = new Intl.DateTimeFormat("es-PY", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);

  const weekday = new Intl.DateTimeFormat("es-PY", {
    timeZone,
    weekday: "long",
  }).format(now);

  return {
    timeZone,
    date,
    time,
    weekday,
    hour,
    minute,
    period,
    greeting,
  };
}

export function buildCurrentTimePrompt(
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const current = getCurrentTimeContext(timeZone);

  return [
    "FECHA Y HORA ACTUAL DEL NEGOCIO:",
    `- Zona horaria: ${current.timeZone}`,
    `- Día: ${current.weekday}`,
    `- Fecha: ${current.date}`,
    `- Hora actual: ${current.time}`,
    `- Momento del día: ${current.period}`,
    `- Saludo apropiado: ${current.greeting}`,
    "",
    "REGLAS TEMPORALES:",
    "- Usa esta fecha y hora como referencia actual.",
    "- No inventes otra hora ni fecha.",
    "- Si saludas al cliente, utiliza el saludo apropiado indicado arriba.",
    "- No menciones la hora en cada respuesta salvo que el cliente pregunte.",
    "- No repitas el saludo en todos los mensajes de la misma conversación.",
  ].join("\n");
}
