/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OpenDocs 内置素材：基础矢量形状与版式模板。
 *
 * 说明：poster-design 的素材/模板数据存放在它自己的服务端，不随开源仓库分发，
 * 因此这里是 OpenDocs 自行绘制的最小内置集，用于保证编辑器开箱即用。
 */
import { makeQrcode, makeSvg, makeText } from './defaults';
import type { PosterPage, Widget } from './model';
import { pageDefault } from './model';

export interface Shape {
  name: string;
  width: number;
  height: number;
  /** SVG 内部图形，使用 {c} 作为填充色占位 */
  body: string;
}

/** 24 个基础形状（viewBox 统一为 0 0 100 100，宽高比由 width/height 决定初始大小） */
export const SHAPES: Shape[] = [
  { name: '矩形', width: 240, height: 160, body: '<rect x="2" y="2" width="96" height="96" fill="{c}"/>' },
  { name: '圆角矩形', width: 240, height: 160, body: '<rect x="2" y="2" width="96" height="96" rx="16" fill="{c}"/>' },
  { name: '圆形', width: 200, height: 200, body: '<circle cx="50" cy="50" r="48" fill="{c}"/>' },
  { name: '椭圆', width: 260, height: 160, body: '<ellipse cx="50" cy="50" rx="48" ry="48" fill="{c}"/>' },
  { name: '三角形', width: 200, height: 180, body: '<polygon points="50,4 98,96 2,96" fill="{c}"/>' },
  { name: '直角三角形', width: 200, height: 180, body: '<polygon points="4,4 4,96 96,96" fill="{c}"/>' },
  { name: '菱形', width: 200, height: 200, body: '<polygon points="50,2 98,50 50,98 2,50" fill="{c}"/>' },
  { name: '平行四边形', width: 240, height: 140, body: '<polygon points="20,4 98,4 80,96 2,96" fill="{c}"/>' },
  { name: '梯形', width: 240, height: 140, body: '<polygon points="22,4 78,4 98,96 2,96" fill="{c}"/>' },
  { name: '五边形', width: 200, height: 200, body: '<polygon points="50,2 98,38 80,96 20,96 2,38" fill="{c}"/>' },
  { name: '六边形', width: 220, height: 190, body: '<polygon points="26,4 74,4 98,50 74,96 26,96 2,50" fill="{c}"/>' },
  { name: '八边形', width: 200, height: 200, body: '<polygon points="30,2 70,2 98,30 98,70 70,98 30,98 2,70 2,30" fill="{c}"/>' },
  { name: '五角星', width: 200, height: 200, body: '<polygon points="50,2 61,37 98,37 68,59 79,95 50,73 21,95 32,59 2,37 39,37" fill="{c}"/>' },
  { name: '四角星', width: 200, height: 200, body: '<polygon points="50,2 62,38 98,50 62,62 50,98 38,62 2,50 38,38" fill="{c}"/>' },
  { name: '爱心', width: 200, height: 180, body: '<path d="M50 92 C8 58 2 30 22 14 C36 4 48 12 50 24 C52 12 64 4 78 14 C98 30 92 58 50 92Z" fill="{c}"/>' },
  { name: '右箭头', width: 240, height: 140, body: '<polygon points="2,32 62,32 62,6 98,50 62,94 62,68 2,68" fill="{c}"/>' },
  { name: '左箭头', width: 240, height: 140, body: '<polygon points="98,32 38,32 38,6 2,50 38,94 38,68 98,68" fill="{c}"/>' },
  { name: '上箭头', width: 140, height: 240, body: '<polygon points="32,98 32,38 6,38 50,2 94,38 68,38 68,98" fill="{c}"/>' },
  { name: '下箭头', width: 140, height: 240, body: '<polygon points="32,2 32,62 6,62 50,98 94,62 68,62 68,2" fill="{c}"/>' },
  { name: '圆环', width: 200, height: 200, body: '<circle cx="50" cy="50" r="40" fill="none" stroke="{c}" stroke-width="16"/>' },
  { name: '半圆', width: 220, height: 120, body: '<path d="M2 98 A48 96 0 0 1 98 98Z" fill="{c}"/>' },
  { name: '十字', width: 200, height: 200, body: '<polygon points="36,2 64,2 64,36 98,36 98,64 64,64 64,98 36,98 36,64 2,64 2,36 36,36" fill="{c}"/>' },
  { name: '对话框', width: 240, height: 180, body: '<path d="M10 6 H90 A8 8 0 0 1 98 14 V64 A8 8 0 0 1 90 72 H42 L22 94 L26 72 H10 A8 8 0 0 1 2 64 V14 A8 8 0 0 1 10 6Z" fill="{c}"/>' },
  { name: '水平线', width: 300, height: 8, body: '<rect x="0" y="0" width="100" height="100" fill="{c}"/>' },
];

export function shapeToSvg(shape: Shape, color: string): string {
  const body = shape.body.replace(/\{c\}/g, color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${body}</svg>`;
}

export function shapeToDataUrl(shape: Shape, color: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shapeToSvg(shape, color))}`;
}

// --------------------------------------------------------------- 版式模板

export interface Template {
  name: string;
  page: PosterPage;
  layers: () => Widget[];
  cover: () => string;
}

const pageOf = (width: number, height: number, backgroundColor: string): PosterPage => ({
  ...pageDefault(),
  width,
  height,
  backgroundColor,
});

/** 为模板生成一个简易 SVG 封面（避免依赖外链图片） */
function coverOf(page: PosterPage, blocks: Array<{ x: number; y: number; w: number; h: number; c: string }>) {
  const body = blocks
    .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${b.c}"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${(page.height / page.width) * 100}"><rect width="100%" height="100%" fill="${page.backgroundColor.slice(0, 7)}"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const titleText = (text: string, y: number, size: number, color: string, page: PosterPage, bold = true) =>
  makeText({
    text,
    fontSize: size,
    fontWeight: bold ? 'bold' : 'normal',
    color,
    textAlign: 'center',
    left: Math.round(page.width * 0.08),
    top: y,
    width: Math.round(page.width * 0.84),
    height: Math.round(size * 1.5),
  });

const COVER_PAGE = pageOf(1242, 1660, '#f5f6f8ff');
const QUOTE_PAGE = pageOf(1080, 1080, '#1b1f24ff');
const SALE_PAGE = pageOf(750, 1000, '#fff4e8ff');
const INVITE_PAGE = pageOf(900, 500, '#eef3ffff');

export const TEMPLATES: Template[] = [
  {
    name: '小红书封面',
    page: COVER_PAGE,
    cover: () =>
      coverOf(COVER_PAGE, [
        { x: 10, y: 12, w: 80, h: 6, c: '#3370ff' },
        { x: 14, y: 40, w: 72, h: 10, c: '#1b1f24' },
        { x: 20, y: 56, w: 60, h: 5, c: '#86909c' },
      ]),
    layers: () => [
      makeSvg({
        name: '色块',
        svgUrl: shapeToDataUrl(SHAPES[0], '#3370ff'),
        colors: ['#3370ff'],
        left: 120,
        top: 200,
        width: 1002,
        height: 24,
      }),
      titleText('在这里写主标题', 620, 120, '#1b1f24ff', COVER_PAGE),
      titleText('一句话说明这张图想讲什么', 840, 52, '#86909cff', COVER_PAGE, false),
    ],
  },
  {
    name: '金句海报',
    page: QUOTE_PAGE,
    cover: () =>
      coverOf(QUOTE_PAGE, [
        { x: 12, y: 36, w: 76, h: 10, c: '#ffffff' },
        { x: 30, y: 58, w: 40, h: 4, c: '#86909c' },
      ]),
    layers: () => [
      titleText('“一句值得被记住的话。”', 380, 84, '#ffffffff', QUOTE_PAGE),
      titleText('—— 出处', 640, 40, '#a9b1bbff', QUOTE_PAGE, false),
    ],
  },
  {
    name: '促销海报',
    page: SALE_PAGE,
    cover: () =>
      coverOf(SALE_PAGE, [
        { x: 12, y: 10, w: 76, h: 12, c: '#f53f3f' },
        { x: 20, y: 40, w: 60, h: 14, c: '#1b1f24' },
        { x: 30, y: 70, w: 40, h: 8, c: '#f53f3f' },
      ]),
    layers: () => [
      titleText('限时特惠', 140, 110, '#f53f3fff', SALE_PAGE),
      titleText('全场 5 折起', 380, 72, '#1b1f24ff', SALE_PAGE),
      titleText('活动时间：即日起 – 月底', 520, 36, '#86909cff', SALE_PAGE, false),
      makeQrcode({ left: 275, top: 640, width: 200, height: 200, value: 'https://example.com' }),
    ],
  },
  {
    name: '活动邀请函',
    page: INVITE_PAGE,
    cover: () =>
      coverOf(INVITE_PAGE, [
        { x: 10, y: 18, w: 80, h: 12, c: '#3370ff' },
        { x: 20, y: 44, w: 60, h: 6, c: '#1b1f24' },
        { x: 25, y: 60, w: 50, h: 5, c: '#86909c' },
      ]),
    layers: () => [
      titleText('诚邀您出席', 100, 64, '#3370ffff', INVITE_PAGE),
      titleText('2026 产品发布会', 200, 56, '#1b1f24ff', INVITE_PAGE),
      titleText('时间：待定　地点：待定', 320, 30, '#86909cff', INVITE_PAGE, false),
    ],
  },
];
