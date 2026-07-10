import type {
  SongloftJSEnvCall as SDKSongloftJSEnvCall,
  SongloftJSEnvResult as SDKSongloftJSEnvResult,
} from '@songloft/plugin-sdk';

declare global {
  type SongloftJSEnvCall = SDKSongloftJSEnvCall;
  type SongloftJSEnvResult = SDKSongloftJSEnvResult;

  interface BufferLike {
    readonly _hex: string;
    readonly length?: number;
    toString(encoding?: string): string;
  }

  interface BufferConstructor {
    from(data: string | ArrayLike<number> | ArrayBuffer | Uint8Array | BufferLike, encoding?: string): BufferLike;
    alloc(size: number): BufferLike;
    concat(list: BufferLike[]): BufferLike;
  }

  const Buffer: BufferConstructor;
}

export {};
