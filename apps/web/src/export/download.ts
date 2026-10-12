export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, mimeType = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mimeType }), filename);
}

/** 统一处理同名重叠字符，供导出文件名使用 */
export function safeFileName(title: string, extension: string): string {
  const trimmed = (title || '未命名文档').replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${trimmed || '未命名文档'}.${extension}`;
}
