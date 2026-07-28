import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { parseQuery } from '@songloft/plugin-sdk';
import type { SourceManager } from '../source/manager';
import { parseMultipart } from '../source/multipart';
import { bodyToBytes, header, parseJSONBody } from './request';
import { errorMessage, fail, ok } from './response';

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8').decode(bytes); }
  catch { return Buffer.from(bytes).toString('utf8'); }
}

function getResponseHeader(response: Response, name: string): string {
  const headers = response.headers as unknown as {
    get?: (key: string) => string | null;
    [key: string]: unknown;
  };
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return String(headers[key] ?? '');
  }
  return '';
}

function normalizeRemoteSourceUrl(input: string): string {
  let url = input.trim();
  // GitHub 文件详情页不是原始脚本，自动转换为 raw.githubusercontent.com。
  url = url.replace(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
    'https://raw.githubusercontent.com/$1/$2/$3/$4',
  );
  // GitLab / Gitee 同类详情页也转为原始文件地址。
  url = url.replace(/^(https?:\/\/[^/]*gitlab[^/]*\/.+?)\/-\/blob\/(.+)$/i, '$1/-/raw/$2');
  url = url.replace(/^(https?:\/\/gitee\.com\/.+?)\/blob\/(.+)$/i, '$1/raw/$2');
  return url;
}

function remoteFilename(url: string): string {
  const raw = url.split('/').pop()?.split('?')[0] || 'remote-source.js';
  try { return decodeURIComponent(raw); }
  catch { return raw; }
}

function looksLikeHtml(text: string, contentType: string): boolean {
  return /text\/html/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text);
}

export function sourceHandlers(manager: SourceManager) {
  return {
    list: async (): Promise<HTTPResponse> => ok(manager.list()),

    importFile: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const rawBody = bodyToBytes(req.body);
        if (!rawBody.length) throw new Error('上传请求体为空');
        const files = parseMultipart(rawBody, header(req, 'content-type'));
        if (!files.length) throw new Error('未找到上传文件');
        const jsFiles = files.filter(file => /\.js$/i.test(file.filename)).map(file => ({ filename: file.filename, script: decodeUtf8(file.bytes) }));
        const zipFiles = files.filter(file => /\.zip$/i.test(file.filename));
        const imported: unknown[] = [];
        if (jsFiles.length === 1 && zipFiles.length === 0) imported.push(await manager.importScript(jsFiles[0], true));
        else if (jsFiles.length) imported.push(...await manager.importBatch(jsFiles));
        for (const zip of zipFiles) imported.push(...await manager.importZip(zip.bytes));
        if (!imported.length) throw new Error('只支持 .js 或 .zip 文件');
        return ok(imported, '音源已保存，正在后台初始化');
      } catch (error) { return fail(errorMessage(error), 400); }
    },

    importUrl: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<Record<string, unknown>>(req);
        const originalUrl = String(body.url || '').trim();
        if (!/^https?:\/\//i.test(originalUrl)) throw new Error('url 必须是 http/https 地址');
        const url = normalizeRemoteSourceUrl(originalUrl);
        const response = await fetch(url, { headers: { 'User-Agent': 'Songloft-LxBridge/0.2.0' } });
        if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);

        const contentType = getResponseHeader(response, 'content-type');
        const isZip = /\.zip(?:$|\?)/i.test(url) || /(?:application|binary)\/(?:x-)?zip/i.test(contentType);
        if (isZip) {
          const arrayBuffer = (response as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
          if (typeof arrayBuffer !== 'function') {
            throw new Error('当前 Songloft 运行时不支持远程 ZIP 二进制下载，请改用本地上传 ZIP');
          }
          const bytes = new Uint8Array(await arrayBuffer.call(response));
          return ok(await manager.importZip(bytes), 'ZIP 音源已保存，正在后台逐个初始化');
        }

        // JS 脚本直接按文本读取，避免不必要的二进制转换和编码损坏。
        const script = await response.text();
        if (!script.trim()) throw new Error('下载到的音源脚本为空');
        if (looksLikeHtml(script, contentType)) {
          throw new Error('该地址返回的是网页而不是音源脚本，请使用 .js 原始文件直链');
        }
        return ok(await manager.importScript({ filename: remoteFilename(url), script }, true), '音源已保存，正在后台初始化');
      } catch (error) { return fail(errorMessage(error), 400); }
    },

    remove: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const id = parseQuery(req.query).id || '';
        if (!id) throw new Error('id is required');
        await manager.remove(id);
        return ok({ id });
      } catch (error) { return fail(errorMessage(error), 400); }
    },

    toggle: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<Record<string, unknown>>(req);
        const id = String(body.id || '');
        if (!id) throw new Error('id is required');
        return ok(await manager.toggle(id, Boolean(body.enabled)));
      } catch (error) { return fail(errorMessage(error), 400); }
    },
  };
}
