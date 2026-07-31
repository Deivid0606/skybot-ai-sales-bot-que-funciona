const GRAPH = "https://graph.facebook.com/v21.0";

export type WhatsAppConn = {
  phone_number_id: string | null;
  access_token: string | null;
};

export async function sendWhatsAppText(conn: WhatsAppConn, to: string, body: string) {
  if (!conn.phone_number_id || !conn.access_token) {
    throw new Error("La conexión de WhatsApp no está configurada");
  }
  const res = await fetch(`${GRAPH}/${conn.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4000) },
    }),
  });
  const json = (await res.json()) as {
    messages?: { id: string }[];
    error?: { message: string };
  };
  if (!res.ok) throw new Error(json.error?.message ?? "Error enviando mensaje a WhatsApp");
  return json.messages?.[0]?.id ?? null;
}

export async function sendWhatsAppMedia(
  conn: WhatsAppConn,
  to: string,
  link: string,
  type: "image" | "video" | "audio" | "document",
  caption?: string,
) {
  if (!conn.phone_number_id || !conn.access_token) {
    throw new Error("La conexión de WhatsApp no está configurada");
  }
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type,
    [type]: caption && type !== "audio" ? { link, caption } : { link },
  };
  const res = await fetch(`${GRAPH}/${conn.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "Error enviando media a WhatsApp");
  return json.messages?.[0]?.id ?? null;
}

export async function downloadWhatsAppMediaUrl(mediaId: string, accessToken: string) {
  const res = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { url?: string };
  return json.url ?? null;
}
