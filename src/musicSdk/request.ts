export interface HttpFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  form?: Record<string, unknown>;
  formData?: Record<string, unknown>;
  timeout?: number;
}

export interface HttpFetchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Accept: '*/*',
};

function encodeForm(form: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(form)) {
    const value = form[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  try { headers.forEach((v, k) => { result[k.toLowerCase()] = v; }); } catch { /* QuickJS Headers fallback */ }
  return result;
}

function parseBody(text: string, contentType: string): unknown {
  const trimmed = text.trim();
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

export function httpFetch(url: string, options: HttpFetchOptions = {}): { promise: Promise<HttpFetchResult>; cancelHttp: () => void } {
  let cancelled = false;
  const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...(options.headers || {}) };
  const method = String(options.method || (options.body || options.form || options.formData ? 'POST' : 'GET')).toUpperCase();
  let body: BodyInit | undefined;

  if (options.form) {
    body = encodeForm(options.form);
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (options.formData) {
    // 洛雪 musicSdk 的大多数 formData 实际都是纯文本字段；QuickJS 没有稳定的 FormData，退化为 URL encoded。
    body = encodeForm(options.formData);
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (options.body != null) {
    if (typeof options.body === 'string' || options.body instanceof Uint8Array) {
      body = options.body as BodyInit;
    } else {
      body = JSON.stringify(options.body);
      if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    }
  }

  const task = (async (): Promise<HttpFetchResult> => {
    const timeoutMs = Math.max(1000, options.timeout || 20000);
    let timer = 0;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`HTTP timeout after ${timeoutMs}ms: ${url}`)), timeoutMs);
    });
    try {
      const response = await Promise.race([fetch(url, { method, headers, body }), timeoutPromise]);
      if (cancelled) throw new Error('HTTP request cancelled');
      const text = await response.text();
      const responseHeaders = headersToObject(response.headers);
      return {
        statusCode: response.status,
        headers: responseHeaders,
        body: parseBody(text, responseHeaders['content-type'] || ''),
      };
    } finally {
      clearTimeout(timer);
    }
  })();

  return { promise: task, cancelHttp: () => { cancelled = true; } };
}
