export async function callHostAPI<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const host = (await songloft.plugin.getHostUrl()).replace(/\/$/, '');
  const token = await songloft.plugin.getToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.headers) {
    const source = init.headers as Record<string, string>;
    for (const key of Object.keys(source)) headers[key] = source[key];
  }
  if (init.body != null && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${host}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!response.ok) {
    const detail = body && typeof body === 'object' ? String((body as Record<string, unknown>).error || (body as Record<string, unknown>).message || text) : text;
    throw new Error(`宿主 API ${response.status}: ${detail}`);
  }
  return body as T;
}
