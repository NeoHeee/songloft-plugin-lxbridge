import type { SourceMeta } from '../types';

export interface ParsedSourceHeader {
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
}

function basename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1).replace(/\.js$/i, '') || '未命名音源';
}

export function parseSourceHeader(script: string, filename: string): ParsedSourceHeader {
  const block = script.match(/\/\*[*!][\s\S]*?\*\//)?.[0] || script.match(/\/\*\*[\s\S]*?\*\//)?.[0] || '';
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*\*?\s*@([A-Za-z][\w-]*)\s+(.+?)\s*$/);
    if (match) fields[match[1].toLowerCase()] = match[2].trim();
  }
  return {
    name: fields.name || basename(filename),
    version: fields.version || '0.0.0',
    description: fields.description || '',
    author: fields.author || '',
    homepage: fields.homepage || fields.repository || fields.url || '',
  };
}

export function slugifySourceName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
  return normalized || `source_${Date.now()}`;
}

export function makeSourceMeta(id: string, filename: string, script: string, enabled = true): SourceMeta {
  const header = parseSourceHeader(script, filename);
  const now = Date.now();
  return {
    id,
    name: header.name,
    version: header.version,
    description: header.description,
    author: header.author,
    homepage: header.homepage,
    filename,
    enabled,
    loading: false,
    createdAt: now,
    updatedAt: now,
  };
}
