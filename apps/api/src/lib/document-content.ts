import { badRequest } from './http';
import type { DocumentType } from '../repos/types';

/**
 * 文档内容信封：五种编辑器共用同一套存取/分享/导出 API，
 * 内容形状按 type 区分，服务端只做「结构合法性」校验，不理解具体业务字段，
 * 这样新增文档类型时后端基本不用改。
 */
export interface DocumentContentEnvelope {
  type: DocumentType;
  version: number;
  [key: string]: unknown;
}

/** 业务层单文档内容体积上限：边缘函数请求体普遍只有 1~6MB，这里统一卡 8MB */
export const MAX_CONTENT_BYTES = 8 * 1024 * 1024;

const REQUIRED_FIELD: Record<DocumentType, string> = {
  mindmap: 'elements',
  markdown: 'markdown',
  word: 'doc',
  excel: 'sheets',
  ppt: 'slides',
};

export function normalizeDocumentContent(
  type: DocumentType,
  value: unknown
): DocumentContentEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('缺少合法的文档内容');
  }
  const candidate = value as Record<string, unknown>;
  const field = REQUIRED_FIELD[type];
  if (!(field in candidate)) {
    throw badRequest(`文档内容缺少字段 ${field}`);
  }
  return {
    ...candidate,
    type,
    version: typeof candidate.version === 'number' ? candidate.version : 1,
  } as DocumentContentEnvelope;
}

export function assertContentSize(serialized: string) {
  if (serialized.length > MAX_CONTENT_BYTES) {
    throw badRequest(
      `文档内容过大（${(serialized.length / 1024 / 1024).toFixed(2)}MB），` +
        `当前上限 ${(MAX_CONTENT_BYTES / 1024 / 1024).toFixed(0)}MB。`,
      'CONTENT_TOO_LARGE'
    );
  }
}

/** 粗略统计元素/字数，用于列表展示，不同类型取不同维度 */
export function summarizeContent(content: DocumentContentEnvelope): number {
  switch (content.type) {
    case 'mindmap':
      return Array.isArray(content.elements) ? content.elements.length : 0;
    case 'markdown':
      return typeof content.markdown === 'string' ? content.markdown.length : 0;
    case 'excel':
      return Array.isArray(content.sheets) ? content.sheets.length : 0;
    case 'ppt':
      return Array.isArray(content.slides) ? content.slides.length : 0;
    case 'word':
      return 0;
    default:
      return 0;
  }
}

export function emptyContentFor(type: DocumentType): DocumentContentEnvelope {
  switch (type) {
    case 'mindmap':
      return { type, version: 1, elements: [], viewport: { zoom: 1 } };
    case 'markdown':
      return { type, version: 1, markdown: '' };
    case 'word':
      return { type, version: 1, doc: { type: 'doc', content: [{ type: 'paragraph' }] } };
    case 'excel':
      return {
        type,
        version: 1,
        sheets: [{ name: 'Sheet1', id: 'sheet-1', celldata: [], row: 84, column: 26 }],
      };
    case 'ppt':
      return {
        type,
        version: 1,
        slides: [{ id: 'slide-1', title: '标题页', body: '', layout: 'title' }],
      };
    default:
      throw badRequest('未知的文档类型');
  }
}
