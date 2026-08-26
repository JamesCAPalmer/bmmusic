/**
 * Minimal Anthropic Messages API client (raw fetch — no SDK, to keep the Worker
 * within the estate's "no dependencies beyond Hono and wrangler" rule, and to
 * keep the bundle small).
 *
 * Used by one thing: reading a photograph of a parcel label into fields a human
 * then checks (`src/extract.ts`).
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** The model the brief specifies for label reading. */
export const SONNET = "claude-sonnet-5";

export class AnthropicError extends Error {}

/** Raised when ANTHROPIC_API_KEY is unset — the caller falls back to manual entry. */
export class NotConfiguredError extends Error {}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

interface MessagesRequest {
  apiKey: string;
  model: string;
  system?: string;
  content: ContentBlock[];
  maxTokens?: number;
  /** JSON schema for structured output (output_config.format). */
  jsonSchema?: Record<string, unknown>;
}

interface MessagesResponse {
  content: { type: string; text?: string }[];
  stop_reason: string | null;
}

async function callMessages(req: MessagesRequest): Promise<MessagesResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    messages: [{ role: "user", content: req.content }],
  };
  if (req.system) body.system = req.system;
  if (req.jsonSchema) {
    body.output_config = { format: { type: "json_schema", schema: req.jsonSchema } };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": req.apiKey,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // The status and a short excerpt go in the message for the logs; the routes
    // never show it to a user (see `userMessage` in src/index.ts).
    throw new AnthropicError(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as MessagesResponse;
}

/** Concatenate all text blocks of the response. */
function textOf(res: MessagesResponse): string {
  return res.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/** Structured-output completion: returns the parsed JSON matching jsonSchema. */
export async function completeJson<T>(
  req: MessagesRequest & { jsonSchema: Record<string, unknown> }
): Promise<T> {
  const res = await callMessages(req);
  const text = textOf(res);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AnthropicError("The model did not return valid JSON.");
  }
}

/** Build a content block from an uploaded file (PDF → document, image → image). */
export function toContentBlock(filename: string, bytes: Uint8Array): ContentBlock | null {
  const b64 = bytesToBase64(bytes);
  const lower = filename.toLowerCase();
  const isPdf =
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ||
    lower.endsWith(".pdf");
  if (isPdf) {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } };
  }
  const mediaType = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".webp")
      ? "image/webp"
      : lower.endsWith(".gif")
        ? "image/gif"
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? "image/jpeg"
          : null;
  if (!mediaType) return null;
  return { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
