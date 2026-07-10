import type { MusicInfo, PlatformId, ResolvedUrl, SourceMeta, SourceRuntimeInfo, SourceCapability } from '../types';
import { LX_PRELUDE_JS } from './lx_prelude';

function safeEnvName(id: string): string {
  let out = 'lx_';
  for (const ch of id) {
    if (/^[A-Za-z0-9_-]$/.test(ch)) out += ch;
    else {
      const cp = ch.codePointAt(0) || 0;
      out += `_u${cp.toString(16)}_`;
    }
  }
  return out.slice(0, 120);
}

function parseEventData(data: string): any {
  try { return JSON.parse(data); } catch { return data; }
}

function normalizeSources(value: unknown): Partial<Record<PlatformId, SourceCapability>> {
  const root = value && typeof value === 'object' ? value as Record<string, any> : {};
  const candidate = root.sources && typeof root.sources === 'object' ? root.sources : root;
  const result: Partial<Record<PlatformId, SourceCapability>> = {};
  for (const key of ['kw', 'kg', 'tx', 'wy', 'mg'] as PlatformId[]) {
    const item = candidate[key];
    if (Array.isArray(item)) {
      result[key] = { type: 'music', actions: ['musicUrl'], qualitys: item.map(String) };
    } else if (item && typeof item === 'object') {
      const capability = item as SourceCapability;
      result[key] = {
        ...capability,
        type: capability.type || 'music',
        actions: Array.isArray(capability.actions) ? capability.actions.map(String) : ['musicUrl'],
        qualitys: Array.isArray(capability.qualitys) ? capability.qualitys.map(String) : [],
      };
    }
  }
  return result;
}

function normalizeResolved(value: unknown): ResolvedUrl {
  if (typeof value === 'string') {
    if (!/^https?:\/\//i.test(value)) throw new Error('音源返回的不是 HTTP URL');
    return { url: value };
  }
  if (value && typeof value === 'object') {
    const item = value as Record<string, any>;
    const url = String(item.url || item.data?.url || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('音源返回对象缺少有效 url');
    const headers: Record<string, string> = {};
    if (item.headers && typeof item.headers === 'object') {
      for (const key of Object.keys(item.headers)) headers[key] = String(item.headers[key]);
    }
    return Object.keys(headers).length ? { url, headers } : { url };
  }
  throw new Error('音源未返回播放地址');
}

function toBase64Utf8(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function buildDecodedExpression(base64: string): string {
  return `Buffer.from(${JSON.stringify(base64)}, "base64").toString("utf8")`;
}

function formatRuntimeError(error: string, scriptLength: number): string {
  const message = String(error || 'unknown error');
  if (/unexpected end of string|unexpected end of input|unterminated string/i.test(message)) {
    return `音源脚本语法不完整或传输后被截断（${scriptLength} 字符）: ${message}`;
  }
  return message;
}

interface InitProbe {
  sources?: unknown;
  diagnostics?: Record<string, unknown>;
  requestHandler?: boolean;
}

export interface DispatchCallBuild {
  requestId: string;
  call: SongloftJSEnvCall;
}

export class SourceRuntime {
  readonly id: string;
  readonly envName: string;
  readonly meta: SourceMeta;
  readonly rawScript: string;
  sources: Partial<Record<PlatformId, SourceCapability>> = {};
  totalCalls = 0;
  successCalls = 0;
  lastError = '';
  private requestCounter = 0;
  private initialized = false;

  constructor(meta: SourceMeta, rawScript: string) {
    this.id = meta.id;
    this.meta = meta;
    this.rawScript = rawScript;
    this.envName = safeEnvName(meta.id);
  }

  private async probeInitState(): Promise<InitProbe> {
    const code = `JSON.stringify({sources:globalThis.lx&&globalThis.lx.sources,diagnostics:globalThis.lx&&globalThis.lx.__initDiagnostics,requestHandler:!!(globalThis.__lx_handlers&&typeof globalThis.__lx_handlers.request==="function")})`;
    const result = await songloft.jsenv.execute(this.envName, code, 3000);
    if (result.error || !result.result) return {};
    try { return JSON.parse(result.result) as InitProbe; }
    catch { return {}; }
  }

  private acceptSources(value: unknown): boolean {
    const normalized = normalizeSources(value);
    if (!Object.keys(normalized).length) return false;
    this.sources = normalized;
    this.initialized = true;
    return true;
  }

  async init(): Promise<void> {
    await songloft.jsenv.destroy(this.envName);
    await songloft.jsenv.create(this.envName, LX_PRELUDE_JS);

    const info = {
      name: this.meta.name,
      version: this.meta.version,
      description: this.meta.description,
      author: this.meta.author,
      homepage: this.meta.homepage,
      rawScript: this.rawScript,
    };

    // 不把原始脚本直接嵌入 JS 字符串。部分音源含 U+2028/U+2029、超长转义串或
    // 混淆字符，直接 JSON.stringify 后再作为代码传输会在某些 QuickJS 版本中被
    // 解析成 “unexpected end of string”。改用纯 ASCII Base64 安全传输。
    const infoBase64 = toBase64Utf8(JSON.stringify(info));
    const inject = `globalThis.lx.currentScriptInfo=JSON.parse(${buildDecodedExpression(infoBase64)});`;
    const injected = await songloft.jsenv.execute(this.envName, inject, 5000);
    if (injected.error) {
      await this.destroy();
      throw new Error(`注入音源信息失败: ${injected.error}`);
    }

    const scriptBase64 = toBase64Utf8(this.rawScript);
    const executeCode = `(0,eval)(${buildDecodedExpression(scriptBase64)});`;
    const result = await songloft.jsenv.executeWait(this.envName, executeCode, 30000, ['inited']);
    const initedEvents = result.events.filter(event => event.name === 'inited');

    // 有些混淆脚本在成功发送 inited 后还会因防调试代码抛异常。LX Music 此时已经
    // 完成初始化，所以这里优先采用有效的 inited 数据，而不是被后续异常误伤。
    for (const event of initedEvents) {
      const parsed = parseEventData(event.data);
      if (this.acceptSources(parsed)) return;
    }

    // 事件可能在宿主边界被遗漏，但 prelude 会同步把 inited.sources 缓存在 lx.sources。
    const probe = await this.probeInitState();
    if (this.acceptSources(probe.sources)) return;

    if (result.error) {
      await this.destroy();
      throw new Error(`音源初始化失败: ${formatRuntimeError(result.error, this.rawScript.length)}`);
    }

    const diagnostics = probe.diagnostics || {};
    const handlerRegistered = probe.requestHandler || diagnostics.requestHandler === true;
    const detail = handlerRegistered
      ? '脚本已注册 request 处理器，但没有调用 lx.send(EVENT_NAMES.inited, ...)。常见原因是加密/防篡改逻辑不兼容 QuickJS，建议使用同版本解密版音源。'
      : '脚本既未发送 inited，也未注册 request 处理器，可能不是完整的洛雪音源文件。';
    await this.destroy();
    throw new Error(`音源初始化超时：未发送 inited。${detail}`);
  }

  supports(platform: PlatformId): boolean {
    return this.initialized && Boolean(this.sources[platform]);
  }

  supportedQualities(platform: PlatformId): string[] {
    const q = this.sources[platform]?.qualitys;
    return Array.isArray(q) ? q.map(String) : [];
  }

  buildDispatchCall(platform: PlatformId, songInfo: MusicInfo, quality: string, waitForError = false): DispatchCallBuild {
    this.requestCounter += 1;
    const requestId = `${this.id}_${Date.now()}_${this.requestCounter}`;
    const payload = {
      source: platform,
      action: 'musicUrl',
      info: { musicInfo: songInfo, type: quality, quality },
    };
    const code = `globalThis.lx._dispatch(${JSON.stringify(requestId)}, "request", ${JSON.stringify(JSON.stringify(payload))});`;
    return {
      requestId,
      call: {
        name: this.envName,
        code,
        timeoutMs: 20000,
        waitEvents: waitForError ? ['dispatchResult', 'dispatchError'] : ['dispatchResult'],
      },
    };
  }

  extractResult(result: SongloftJSEnvResult, requestId: string): ResolvedUrl {
    if (result.error) throw new Error(result.error);
    for (const event of result.events) {
      if (event.name !== 'dispatchResult' && event.name !== 'dispatchError') continue;
      const payload = parseEventData(event.data) as Record<string, any>;
      if (String(payload?.id || '') !== requestId) continue;
      if (event.name === 'dispatchError') throw new Error(String(payload.error || '音源解析失败'));
      return normalizeResolved(payload.result);
    }
    throw new Error('音源没有返回匹配的 dispatchResult');
  }

  async resolve(platform: PlatformId, songInfo: MusicInfo, quality: string): Promise<ResolvedUrl> {
    if (!this.supports(platform)) throw new Error(`音源不支持平台 ${platform}`);
    this.totalCalls += 1;
    const built = this.buildDispatchCall(platform, songInfo, quality, true);
    try {
      const result = await songloft.jsenv.executeWait(built.call.name, built.call.code, built.call.timeoutMs || 20000, built.call.waitEvents || []);
      const resolved = this.extractResult(result, built.requestId);
      this.successCalls += 1;
      this.lastError = '';
      return { ...resolved, runtimeId: this.id };
    } catch (error) {
      this.lastError = String((error as Error)?.message || error);
      throw error;
    }
  }

  info(): SourceRuntimeInfo {
    return {
      id: this.id,
      envName: this.envName,
      sources: this.sources,
      totalCalls: this.totalCalls,
      successCalls: this.successCalls,
      lastError: this.lastError || undefined,
    };
  }

  async destroy(): Promise<void> {
    this.initialized = false;
    await songloft.jsenv.destroy(this.envName);
  }
}
