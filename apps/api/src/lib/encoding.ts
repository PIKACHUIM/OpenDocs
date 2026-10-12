/** 跨平台编解码工具：Cloudflare Workers 与 EdgeOne(Node 20) 都提供 btoa/atob/TextEncoder */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 注意 Uint8Array<ArrayBuffer> 这个显式类型参数：
 * TS 5.7+ 起 Uint8Array 是泛型的，默认的 Uint8Array<ArrayBufferLike> 不能直接传给
 * WebCrypto 的 BufferSource（它会拒绝 SharedArrayBuffer）。
 */
type Bytes = Uint8Array<ArrayBuffer>;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Bytes {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let index = 0; index < bytes.length; index += 1) {
    hex += bytes[index].toString(16).padStart(2, '0');
  }
  return hex;
}

export function utf8ToBytes(value: string): Bytes {
  return encoder.encode(value);
}

export function bytesToUtf8(bytes: ArrayBuffer | Uint8Array): string {
  return decoder.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function utf8ToBase64(value: string): string {
  return bytesToBase64(utf8ToBytes(value));
}

export function base64ToUtf8(value: string): string {
  return bytesToUtf8(base64ToBytes(value));
}
