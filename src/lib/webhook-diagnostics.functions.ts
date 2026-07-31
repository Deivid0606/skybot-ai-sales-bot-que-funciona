import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WebhookCheck = {
  id: string;
  label: string;
  status: "ok" | "fail" | "warn";
  detail: string;
  httpStatus?: number;
  expected?: string;
  received?: string;
};

function isAllowedWebhookUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (!u.pathname.endsWith("/api/public/whatsapp/webhook")) return false;
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    return u.protocol === "https:" && /(^|\.)lovable\.app$/i.test(host);
  } catch {
    return false;
  }
}

async function probe(url: string, params: Record<string, string>) {
  const target = new URL(url);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  const started = Date.now();
  try {
    const res = await fetch(target.toString(), { method: "GET" });
    const body = (await res.text()).slice(0, 300).trim();
    return { ok: true as const, status: res.status, body, ms: Date.now() - started };
  } catch (e) {
    return {
      ok: false as const,
      status: 0,
      body: e instanceof Error ? e.message : "Error de red",
      ms: Date.now() - started,
    };
  }
}

/**
 * Ejecuta desde el servidor la misma secuencia de validación que hace Meta
 * (hub.mode / hub.verify_token / hub.challenge) y devuelve el detalle de cada paso.
 */
export const runWebhookDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string; token: string; workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    const checks: WebhookCheck[] = [];
    const url = data.url.trim();
    const token = data.token.trim();

    // 1. URL válida y pública
    if (!isAllowedWebhookUrl(url)) {
      checks.push({
        id: "url",
        label: "URL del webhook",
        status: "fail",
        detail:
          "La URL no es pública o no termina en /api/public/whatsapp/webhook. Meta solo acepta una URL https estable.",
        received: url,
      });
      return { checks, verified: false };
    }
    checks.push({
      id: "url",
      label: "URL del webhook",
      status: "ok",
      detail: "Formato válido y accesible públicamente por Meta.",
      received: url,
    });

    // 2. Token guardado en la base
    const { data: conn, error } = await context.supabase
      .from("whatsapp_connections")
      .select("verify_token")
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    if (error) {
      checks.push({
        id: "saved-token",
        label: "Token guardado",
        status: "fail",
        detail: `No se pudo leer la conexión guardada: ${error.message}`,
      });
    } else if (!conn?.verify_token) {
      checks.push({
        id: "saved-token",
        label: "Token guardado",
        status: "fail",
        detail:
          "No hay token de verificación guardado. Tocá “Guardar conexión” antes de validar en Meta.",
      });
    } else if (conn.verify_token.trim() !== token) {
      checks.push({
        id: "saved-token",
        label: "Token guardado",
        status: "fail",
        detail:
          "El token en pantalla no coincide con el guardado. Guardá la conexión o usá el token guardado en Meta.",
        expected: conn.verify_token.trim(),
        received: token || "(vacío)",
      });
    } else {
      checks.push({
        id: "saved-token",
        label: "Token guardado",
        status: "ok",
        detail: "El token de pantalla coincide con el almacenado en la base.",
      });
    }

    // 3. hub.mode
    const challenge = `botsky${Date.now()}`;
    const badMode = await probe(url, {
      "hub.mode": "unsubscribe",
      "hub.verify_token": token,
      "hub.challenge": challenge,
    });
    checks.push({
      id: "hub.mode",
      label: "hub.mode",
      status: badMode.status === 400 ? "ok" : badMode.status === 0 ? "fail" : "warn",
      detail:
        badMode.status === 400
          ? "El endpoint rechaza correctamente un modo distinto de “subscribe”."
          : badMode.status === 0
            ? `No se pudo alcanzar la URL: ${badMode.body}`
            : "El endpoint no rechazó un modo inválido; revisá el despliegue.",
      httpStatus: badMode.status,
      expected: "400 Invalid mode",
      received: `${badMode.status} ${badMode.body}`,
    });

    // 4. hub.verify_token incorrecto
    const badToken = await probe(url, {
      "hub.mode": "subscribe",
      "hub.verify_token": `${token || "x"}_invalido`,
      "hub.challenge": challenge,
    });
    checks.push({
      id: "hub.verify_token",
      label: "hub.verify_token",
      status: badToken.status === 403 ? "ok" : badToken.status === 0 ? "fail" : "warn",
      detail:
        badToken.status === 403
          ? "Un token incorrecto es rechazado con 403, tal como espera Meta."
          : badToken.status === 0
            ? `No se pudo alcanzar la URL: ${badToken.body}`
            : "Se esperaba 403 con un token inválido.",
      httpStatus: badToken.status,
      expected: "403 Forbidden",
      received: `${badToken.status} ${badToken.body}`,
    });

    // 5. hub.challenge faltante
    const noChallenge = await probe(url, {
      "hub.mode": "subscribe",
      "hub.verify_token": token,
    });
    checks.push({
      id: "hub.challenge.missing",
      label: "hub.challenge ausente",
      status: noChallenge.status === 400 ? "ok" : noChallenge.status === 0 ? "fail" : "warn",
      detail:
        noChallenge.status === 400
          ? "Sin hub.challenge el endpoint responde 400 correctamente."
          : noChallenge.status === 0
            ? `No se pudo alcanzar la URL: ${noChallenge.body}`
            : "Se esperaba 400 cuando falta hub.challenge.",
      httpStatus: noChallenge.status,
      expected: "400 Missing challenge",
      received: `${noChallenge.status} ${noChallenge.body}`,
    });

    // 6. Verificación real
    const real = await probe(url, {
      "hub.mode": "subscribe",
      "hub.verify_token": token,
      "hub.challenge": challenge,
    });
    const verified = real.status === 200 && real.body === challenge;
    checks.push({
      id: "verification",
      label: "Verificación completa (como Meta)",
      status: verified ? "ok" : "fail",
      detail: verified
        ? `Devolvió el hub.challenge exacto en ${real.ms} ms. Ya podés validar en Meta.`
        : real.status === 0
          ? `No se pudo alcanzar la URL: ${real.body}`
          : real.status === 403
            ? "El endpoint no reconoce el token: guardá la conexión y volvé a probar."
            : `Respuesta inesperada (${real.status}). El cuerpo debe ser exactamente el hub.challenge.`,
      httpStatus: real.status,
      expected: `200 ${challenge}`,
      received: `${real.status} ${real.body}`,
    });

    return { checks, verified };
  });
