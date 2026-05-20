const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramApiError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.code = code;
  }
}

async function callApi<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: params ? JSON.stringify(params) : undefined,
  });
  const data = (await res.json()) as TelegramApiResponse<T>;
  if (!data.ok || data.result === undefined) {
    throw new TelegramApiError(data.description || "Telegram API error", data.error_code);
  }
  return data.result;
}

export async function getMe(token: string): Promise<TelegramUser> {
  return callApi<TelegramUser>(token, "getMe");
}

export async function setWebhook(
  token: string,
  url: string,
  secretToken: string,
): Promise<boolean> {
  return callApi<boolean>(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
}

export async function deleteWebhook(token: string): Promise<boolean> {
  return callApi<boolean>(token, "deleteWebhook", { drop_pending_updates: true });
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  options?: { parse_mode?: "HTML" | "MarkdownV2"; disable_web_page_preview?: boolean },
): Promise<{ message_id: number }> {
  return callApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options?.parse_mode || "HTML",
    disable_web_page_preview: options?.disable_web_page_preview ?? false,
  });
}
