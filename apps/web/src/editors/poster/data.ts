/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 编辑器静态数据。
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)：
 *   src/assets/data/{PageSizeData,AlignListData,LayerIconList,TextIconsData,WidgetClassifyList}.ts
 * 数值与顺序保持原样；图标由 iconfont 字体改为内联 SVG 路径。
 */
import type { AlignKind } from './store';

/** 画布尺寸预设（PageSizeData） */
export const PAGE_SIZES = [
  { name: '手机海报', width: 1242, height: 2208 },
  { name: '横版海报', width: 900, height: 500 },
  { name: '公众号首图', width: 900, height: 383 },
  { name: '公众号次图', width: 500, height: 500 },
  { name: '小红书配图', width: 1242, height: 1660 },
  { name: '商品主图', width: 800, height: 800 },
  { name: '电商详情页', width: 750, height: 1000 },
  { name: '电商竖版海报', width: 750, height: 950 },
  { name: '电商横版海报', width: 750, height: 390 },
  { name: '小程序封面', width: 520, height: 416 },
  { name: '壁纸 / PPT(16:9)', width: 1920, height: 1080 },
] as const;

/** 对齐（AlignListData） */
export const ALIGN_LIST: Array<{ value: AlignKind; tip: string }> = [
  { value: 'left', tip: '左对齐' },
  { value: 'ch', tip: '水平居中对齐' },
  { value: 'right', tip: '右对齐' },
  { value: 'top', tip: '上对齐' },
  { value: 'cv', tip: '垂直居中对齐' },
  { value: 'bottom', tip: '下对齐' },
];

/** 文字样式切换（TextIconsData.styleIconList1）：value = [关闭值, 开启值] */
export const TEXT_STYLE_TOGGLES = [
  { key: 'fontWeight', tip: '加粗', label: 'B', value: ['normal', 'bold'] },
  { key: 'fontStyle', tip: '斜体', label: 'I', value: ['normal', 'italic'] },
  { key: 'textDecoration', tip: '下划线', label: 'U', value: ['none', 'underline'] },
  { key: 'textDecoration', tip: '删除线', label: 'S', value: ['none', 'line-through'] },
  { key: 'writingMode', tip: '竖版文字', label: '竖', value: ['horizontal-tb', 'vertical-rl'] },
] as const;

/** 文字对齐（TextIconsData.styleIconList2） */
export const TEXT_ALIGNS = [
  { value: 'left', tip: '左对齐', label: '左' },
  { value: 'center', tip: '居中对齐', label: '中' },
  { value: 'right', tip: '右对齐', label: '右' },
  { value: 'justify', tip: '两端对齐', label: '齐' },
] as const;

/** 字号候选（wTextStyle.fontSizeList） */
export const FONT_SIZES = [
  12, 14, 24, 26, 28, 30, 36, 48, 60, 72, 96, 108, 120, 140, 180, 200, 250, 300, 400, 500,
];

/** 左侧分类（WidgetClassifyList），「背景」在原项目中被注释掉，保持一致 */
export const WIDGET_CLASSES = [
  { key: 'template', name: '模板' },
  { key: 'material', name: '素材' },
  { key: 'text', name: '文字' },
  { key: 'photo', name: '照片' },
  { key: 'tools', name: '工具箱' },
  { key: 'user', name: '我的' },
] as const;

export type WidgetClassKey = (typeof WIDGET_CLASSES)[number]['key'];

/** 缩放档位（zoomControl/data.ts 的思路：常用百分比 + 适应） */
export const ZOOM_STEPS = [25, 50, 75, 100, 150, 200];
