import type { HTTPResponse } from '@songloft/plugin-sdk';
import { jsonResponse } from '@songloft/plugin-sdk';

export function ok(data: unknown, warning?: string): HTTPResponse {
  return jsonResponse(warning ? { code: 0, msg: 'success', data, warning } : { code: 0, msg: 'success', data });
}

export function fail(message: string, statusCode = 500, data: unknown = null): HTTPResponse {
  return jsonResponse({ code: statusCode, msg: message, data }, statusCode);
}

export function errorMessage(error: unknown): string {
  return String((error as Error)?.message || error || 'unknown error');
}
