/**
 * LLM factory — centralises all Vercel AI SDK provider construction.
 *
 * Call `buildLanguageModel()` with the relevant config fields and get back a
 * typed `LanguageModelV1` instance ready for `generateText()` / `streamText()`.
 * Auth priority: HMAC > Gateway > plain API key.
 */
import crypto from 'crypto';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';

export type { LanguageModelV1 };

export interface LLMEndpointConfig {
  model: string;
  apiKey: string;
  baseURL?: string;
  /** HMAC-SHA256 credentials (highest priority when both keys are present). */
  hmacAccessKey?: string;
  hmacSecretKey?: string;
  /** Bearer-style gateway API key (used when HMAC keys are absent). */
  gatewayApiKey?: string;
}

/**
 * Returns a custom `fetch` that signs every request with HMAC-SHA256 headers
 * expected by internal API gateways.
 */
export function buildHmacFetch(accessKey: string, secretKey: string): typeof globalThis.fetch {
  return async (input, init) => {
    const bodyStr = init?.body ? String(init.body) : '';
    const digestHash = crypto.createHash('sha256').update(bodyStr).digest('base64');
    const digest = `SHA-256=${digestHash}`;
    const date = new Date().toUTCString();
    const parsedUrl = new URL(String(input));
    const requestPath = `${parsedUrl.pathname}${parsedUrl.search || ''}`;
    const requestLine = `POST ${requestPath} HTTP/1.1`;
    const host = parsedUrl.host;
    const signingData = `Digest: ${digest}\nX-Date: ${date}\nhost: ${host}\n${requestLine}`;
    const signature = crypto.createHmac('sha256', secretKey).update(signingData).digest('base64');
    const authorization = `hmac username="${accessKey}", algorithm="hmac-sha256", headers="Digest X-Date host request-line", signature="${signature}"`;
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    headers.set('X-Date', date);
    headers.set('Digest', digest);
    headers.set('Authorization', authorization);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Builds a `LanguageModelV1` from endpoint config.
 *
 * Auth resolution order:
 *   1. HMAC (hmacAccessKey + hmacSecretKey) — signs each request with SHA-256
 *   2. Gateway (gatewayApiKey) — adds x-gateway-apikey header
 *   3. Plain OpenAI-compatible key (apiKey)
 */
export function buildLanguageModel(cfg: LLMEndpointConfig): LanguageModelV1 {
  const { model, apiKey, baseURL, hmacAccessKey, hmacSecretKey, gatewayApiKey } = cfg;

  if (hmacAccessKey && hmacSecretKey) {
    if (!baseURL) throw new Error('HMAC auth requires baseURL');
    return createOpenAI({
      baseURL,
      apiKey: hmacAccessKey,
      fetch: buildHmacFetch(hmacAccessKey, hmacSecretKey),
    })(model);
  }

  if (gatewayApiKey) {
    if (!baseURL) throw new Error('Gateway auth requires baseURL');
    return createOpenAI({
      baseURL,
      apiKey: '',
      headers: {
        'x-gatewat-apikey': `Bearer ${gatewayApiKey}`,
        'x-gateway-apikey': `Bearer ${gatewayApiKey}`,
      },
    })(model);
  }

  return createOpenAI({ apiKey, baseURL })(model);
}
