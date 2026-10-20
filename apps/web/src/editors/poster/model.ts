/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 图片/海报编辑器的数据模型。
 *
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)
 * 的 src/store/design/{canvas,widget}：字段名、默认值、父子（w-group 容器）约定保持一致，
 * 以便沿用其图层语义；状态管理由 Pinia 改为 zustand。
 */

/** 画布（页面）。type 固定为 'page'，uuid 固定为 '-1'，与原项目一致 */
export interface PosterPage {
  name: string;
  type: 'page';
  uuid: '-1';
  left: number;
  top: number;
  width: number;
  height: number;
  backgroundColor: string;
  /** 兼容渐变背景 */
  backgroundGradient: string;
  backgroundImage: string;
  backgroundTransform: { x?: number; y?: number };
  opacity: number;
  tag: number;
  record: Record<string, never>;
}

export const pageDefault = (): PosterPage => ({
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
});

export interface WidgetRecord {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  dir?: string;
}

/** 所有图层共有字段 */
export interface WidgetBase {
  name: string;
  uuid: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
  opacity: number;
  /** 父容器 uuid；'-1' 表示直接在画布上 */
  parent: string;
  /** 是否为容器（w-group） */
  isContainer?: boolean;
  lock?: boolean;
  record: WidgetRecord;
  /** 旧版 CSS transform 字符串，保留以兼容原项目导出的模板 */
  transform?: string;
}

export interface TextEffect {
  filling: { enable: boolean; type: number; color: string };
  stroke: { enable: boolean; width: number; color: string };
  shadow: { enable: boolean; offsetY: number; offsetX: number; blur: number; color: string };
  offset: { enable: boolean; x: number; y: number };
}

export interface TextWidget extends WidgetBase {
  type: 'w-text';
  text: string;
  editable: boolean;
  lineHeight: number;
  letterSpacing: number;
  fontSize: number;
  zoom: number;
  fontClass: { alias: string; id: number; value: string; url: string };
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  writingMode: 'horizontal-tb' | 'vertical-rl';
  textDecoration: string;
  color: string;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  backgroundColor: string;
  textEffects?: TextEffect[];
}

export interface ImageWidget extends WidgetBase {
  type: 'w-image';
  imgUrl: string;
  /** 圆角 */
  radius: number;
  zoom: number;
  mask: string;
  flip: string | null;
  cropEdit?: boolean;
  isNinePatch?: boolean;
  sliceData?: { ratio: number; left: number };
  /** 滤镜（OpenDocs 扩展，原项目在图片样式面板里以 CSS filter 实现） */
  brightness?: number;
  contrast?: number;
  saturate?: number;
}

export interface SvgWidget extends WidgetBase {
  type: 'w-svg';
  svgUrl: string;
  colors: string[];
  radius: number;
}

export interface QrcodeWidget extends WidgetBase {
  type: 'w-qrcode';
  /** 二维码内容（原项目字段名 value） */
  value: string;
  zoom: number;
  radius: number;
  /** qr-code-styling 的 DotType，默认 classy */
  dotType: 'dots' | 'rounded' | 'classy' | 'classy-rounded' | 'square' | 'extra-rounded';
  /** single = 单色，double = 渐变 */
  dotColorType: 'single' | 'double';
  dotRotation: number;
  dotColor: string;
  dotColor2: string;
  url?: string;
}

export interface GroupWidget extends WidgetBase {
  type: 'w-group';
  isContainer: true;
}

export type Widget = TextWidget | ImageWidget | SvgWidget | QrcodeWidget | GroupWidget;
export type WidgetType = Widget['type'];

/** 一页：画布设置 + 图层列表（原项目 dLayouts[i]） */
export interface PosterLayout {
  global: PosterPage;
  layers: Widget[];
}

/** 云端存储的内容结构（documents.content，type = 'image'） */
export interface PosterContent {
  type: 'image';
  version: number;
  /** 多页，对应原项目的 dLayouts */
  layouts: PosterLayout[];
  /** 兼容旧版（v1 自研编辑器）的单页字段，读取时迁移 */
  width?: number;
  height?: number;
  background?: string;
  layers?: unknown[];
}
