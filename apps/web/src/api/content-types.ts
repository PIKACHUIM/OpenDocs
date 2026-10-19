import type { PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import type { DocumentType } from './types';

/**
 * 五种文档类型的内容信封。与后端 `normalizeDocumentContent` 的约定一致：
 * 每种类型有一个「必填字段」用于最基础的结构校验，其余字段完全由前端定义。
 */

export interface MindmapContent {
  type: 'mindmap';
  version: number;
  elements: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
}

/** 内嵌思维导图块：直接存一份独立的 Drawnix 元素树，不依赖外部文档引用 */
export interface EmbeddedMindmap {
  id: string;
  elements: PlaitElement[];
  viewport?: Viewport;
  /** 缩略图（SVG 字符串），用于 Markdown/Word 渲染时的只读预览，避免每次都挂载完整画板 */
  previewSvg?: string;
}

export interface MarkdownContent {
  type: 'markdown';
  version: number;
  markdown: string;
  /** 内嵌思维导图块，key 对应正文里的 `[[mindmap:<id>]]` 占位符 */
  mindmaps?: Record<string, EmbeddedMindmap>;
}

export interface WordContent {
  type: 'word';
  version: number;
  /** Tiptap ProseMirror JSON 文档 */
  doc: Record<string, unknown>;
  mindmaps?: Record<string, EmbeddedMindmap>;
}

export interface ExcelSheet {
  id: string;
  name: string;
  celldata: Array<{ r: number; c: number; v: unknown }>;
  row: number;
  column: number;
  order?: number;
}

export interface ExcelContent {
  type: 'excel';
  version: number;
  /** 旧版（FortuneSheet）数据；仅用于兼容历史文档 */
  sheets: ExcelSheet[];
  /**
   * 新版（Univer）工作簿快照。
   * 与 sheets 并存：新文档只写 univer，历史文档只写 sheets，
   * 读取时按「有 univer 用 Univer，没有但有数据用 FortuneSheet」分派。
   */
  univer?: unknown;
}

/** 旧版版式（仅用于迁移历史文档） */
export type SlideLayout = 'title' | 'title-body' | 'two-column' | 'blank';

interface SlideElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlideTextElement extends SlideElementBase {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
}

export interface SlideShapeElement extends SlideElementBase {
  type: 'rect' | 'ellipse';
  fill: string;
  radius?: number;
}

export interface SlideImageElement extends SlideElementBase {
  type: 'image';
  src: string;
}

export type SlideElement = SlideTextElement | SlideShapeElement | SlideImageElement;

export interface PptSlide {
  id: string;
  background?: string;
  /** 自由画布元素；新文档使用 */
  elements?: SlideElement[];

  // ---- 以下为旧版字段，仅用于把历史文档迁移成 elements ----
  layout?: SlideLayout;
  title?: string;
  body?: string;
  bodyRight?: string;
  imageUrl?: string;
}

export interface PptContent {
  type: 'ppt';
  version: number;
  slides: PptSlide[];
}

/** 幻灯片设计尺寸（16:9），画布与导出共用同一坐标系 */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

export type DocumentContent = MindmapContent | MarkdownContent | WordContent | ExcelContent | PptContent;

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** 新建文档时的初始内容；与后端 emptyContentFor 的结构保持一致 */
export function emptyContentFor(type: DocumentType): DocumentContent {
  switch (type) {
    case 'mindmap':
      return { type, version: 1, elements: [], viewport: { zoom: 1 } };
    case 'markdown':
      return { type, version: 1, markdown: '', mindmaps: {} };
    case 'word':
      return {
        type,
        version: 1,
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        mindmaps: {},
      };
    case 'excel':
      return {
        type,
        version: 1,
        sheets: [{ id: 'sheet-1', name: 'Sheet1', celldata: [], row: 84, column: 26 }],
      };
    case 'ppt':
      return {
        type,
        version: 1,
        slides: [
          {
            id: createId('slide'),
            background: '#ffffff',
            elements: [
              {
                id: createId('el'),
                type: 'text',
                x: 140,
                y: 280,
                w: 1000,
                h: 120,
                text: '标题页',
                fontSize: 64,
                color: '#1b1f24',
                bold: true,
                align: 'center',
              },
              {
                id: createId('el'),
                type: 'text',
                x: 140,
                y: 410,
                w: 1000,
                h: 70,
                text: '点击右侧属性调整文字与样式',
                fontSize: 28,
                color: '#86909c',
                bold: false,
                align: 'center',
              },
            ],
          },
        ],
      };
    default:
      throw new Error(`未知的文档类型: ${type}`);
  }
}
