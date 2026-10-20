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
  /** Tiptap ProseMirror JSON 文档（历史格式；新文档仅作占位以满足后端校验） */
  doc: Record<string, unknown>;
  mindmaps?: Record<string, EmbeddedMindmap>;
  /** 编辑器引擎标记：新文档为 univer，历史文档没有该字段（走 Tiptap） */
  engine?: 'univer';
  /** Univer 文档快照（IDocumentData） */
  univer?: unknown;
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

/** 元素级动画类型（对应 OpenPPT 的进入动画） */
export type SlideAnimationType =
  | 'none'
  | 'fadeIn'
  | 'flyInLeft'
  | 'flyInRight'
  | 'flyInTop'
  | 'flyInBottom'
  | 'zoomIn'
  | 'wipeIn';

export interface SlideAnimation {
  type: SlideAnimationType;
  /** 毫秒 */
  duration: number;
  /** 延迟，毫秒 */
  delay: number;
}

interface SlideElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 进入动画：放映时生效 */
  animation?: SlideAnimation;
}

export interface SlideTextElement extends SlideElementBase {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  /** 行高倍数，默认 1.35 */
  lineHeight?: number;
  /** 是否显示项目符号 */
  bullet?: boolean;
  /** 文本框内边距（设计稿像素） */
  padding?: number;
}

/** 形状种类，对应 OpenPPT 的形状池（去掉需要复杂路径的高阶形状） */
export type SlideShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'pentagon'
  | 'chevron'
  | 'star'
  | 'line';

export interface SlideShapeElement extends SlideElementBase {
  type: SlideShapeKind;
  fill: string;
  radius?: number;
  /** 描边色；为空表示无描边 */
  lineColor?: string;
  lineWidth?: number;
  opacity?: number;
  /** 线条末端箭头（仅 line 生效） */
  arrow?: boolean;
}

export interface SlideImageElement extends SlideElementBase {
  type: 'image';
  src: string;
  /** 圆角与裁切方式 */
  radius?: number;
  objectFit?: 'cover' | 'contain' | 'fill';
  /** 0–100，100 为原样 */
  brightness?: number;
  contrast?: number;
  saturate?: number;
}

export interface SlideTableElement extends SlideElementBase {
  type: 'table';
  /** 二维文本，第一行作为表头 */
  rows: string[][];
  fontSize: number;
  color: string;
  headerFill: string;
  borderColor: string;
}

export type SlideChartType =
  | 'column'
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'ring'
  | 'radar'
  | 'scatter';

export interface SlideChartElement extends SlideElementBase {
  type: 'chart';
  chartType: SlideChartType;
  data: {
    labels: string[];
    series: Array<{ name: string; values: number[] }>;
  };
  themeColors: string[];
  showLegend: boolean;
  showValue: boolean;
  /** 图表标题，空则不显示 */
  title?: string;
}

export interface SlideLatexElement extends SlideElementBase {
  type: 'latex';
  latex: string;
  fontSize: number;
  color: string;
}

export interface SlideVideoElement extends SlideElementBase {
  type: 'video';
  src: string;
  poster?: string;
  autoplay: boolean;
}

export interface SlideAudioElement extends SlideElementBase {
  type: 'audio';
  src: string;
  name: string;
  autoplay: boolean;
}

export interface SlideIframeElement extends SlideElementBase {
  type: 'iframe';
  src: string;
}

export type SlideElement =
  | SlideTextElement
  | SlideShapeElement
  | SlideImageElement
  | SlideTableElement
  | SlideChartElement
  | SlideLatexElement
  | SlideVideoElement
  | SlideAudioElement
  | SlideIframeElement;

/** 页面切换动画 */
export type SlideTransitionType = 'none' | 'fade' | 'slide' | 'zoom' | 'wipe';

export interface SlideTransition {
  type: SlideTransitionType;
  /** 毫秒 */
  duration: number;
}

export interface PptContentTheme {
  themeColors: string[];
  fontColor: string;
  fontName: string;
  backgroundColor: string;
}

export interface PptSlide {
  id: string;
  background?: string;
  backgroundImage?: string;
  /** 演讲者备注 */
  notes?: string;
  /** 切换动画 */
  transition?: SlideTransition;
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
  /** 主题：形状与图表取色、默认字体色 */
  theme?: PptContentTheme;
}

/** 幻灯片设计尺寸（16:9），画布与导出共用同一坐标系 */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

export interface ImageContent {
  type: 'image';
  version: number;
  /** v2（poster-design 移植版）：多页，每页 { global, layers } */
  layouts?: unknown[];
  /** v1（自研简易版）的单页字段，仅用于读取旧文档时迁移 */
  width?: number;
  height?: number;
  background?: string;
  layers?: unknown[];
}

export type DocumentContent =
  | MindmapContent
  | MarkdownContent
  | WordContent
  | ExcelContent
  | PptContent
  | ImageContent;

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
        engine: 'univer',
      };
    case 'excel':
      return {
        type,
        version: 1,
        sheets: [{ id: 'sheet-1', name: 'Sheet1', celldata: [], row: 84, column: 26 }],
      };
    case 'image':
      return {
        type,
        version: 2,
        layouts: [
          {
            global: {
              name: '新画板',
              type: 'page',
              uuid: '-1',
              left: 0,
              top: 0,
              width: 1920,
              height: 1080,
              backgroundColor: '#ffffffff',
              backgroundGradient: '',
              backgroundImage: '',
              backgroundTransform: {},
              opacity: 1,
              tag: 0,
              record: {},
            },
            layers: [],
          },
        ],
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
