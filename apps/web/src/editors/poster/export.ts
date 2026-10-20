/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 浏览器端导出（PNG / JPG）：把 w-text / w-image / w-svg / w-qrcode / w-group 逐层绘制到 canvas。
 *
 * 与 poster-design 的差异：原项目通过服务端无头浏览器截图（service/ + puppeteer）出图，
 * OpenDocs 运行在 Workers 上无法使用无头浏览器，因此改为前端 canvas 合成。
 * 取舍：文字特效（渐变填充 / 描边 / 阴影）已支持，复杂 CSS 排版（竖排、两端对齐）以近似方式绘制。
 */
import QRCodeStyling from 'qr-code-styling';
import type { ImageWidget, PosterPage, QrcodeWidget, SvgWidget, TextWidget, Widget } from './model';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图片加载失败：${src.slice(0, 80)}`));
    image.src = src;
  });
}

/** 8 位十六进制颜色转 canvas 可用的 rgba（浏览器的 canvas 也支持 #rrggbbaa，但统一转换更稳） */
function toCssColor(value: string): string {
  if (/^#[0-9a-f]{8}$/i.test(value)) {
    const r = parseInt(value.slice(1, 3), 16);
    const g = parseInt(value.slice(3, 5), 16);
    const b = parseInt(value.slice(5, 7), 16);
    const a = parseInt(value.slice(7, 9), 16) / 255;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  return value;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function drawImageLayer(ctx: CanvasRenderingContext2D, widget: ImageWidget | SvgWidget) {
  const src = widget.type === 'w-image' ? widget.imgUrl : widget.svgUrl;
  if (!src) return;
  const image = await loadImage(src);
  ctx.save();
  if (widget.radius) {
    roundedRect(ctx, 0, 0, widget.width, widget.height, widget.radius);
    ctx.clip();
  }
  if (widget.type === 'w-image') {
    const filters: string[] = [];
    if (widget.brightness !== undefined) filters.push(`brightness(${widget.brightness}%)`);
    if (widget.contrast !== undefined) filters.push(`contrast(${widget.contrast}%)`);
    if (widget.saturate !== undefined) filters.push(`saturate(${widget.saturate}%)`);
    if (filters.length) ctx.filter = filters.join(' ');
    if (widget.flip === 'x') {
      ctx.translate(widget.width, 0);
      ctx.scale(-1, 1);
    } else if (widget.flip === 'y') {
      ctx.translate(0, widget.height);
      ctx.scale(1, -1);
    }
  }
  ctx.drawImage(image, 0, 0, widget.width, widget.height);
  ctx.restore();
}

async function drawQrcode(ctx: CanvasRenderingContext2D, widget: QrcodeWidget) {
  const size = Math.round(Math.min(widget.width, widget.height));
  const dotsOptions =
    widget.dotColorType === 'double'
      ? {
          type: widget.dotType,
          gradient: {
            type: 'linear' as const,
            rotation: (widget.dotRotation * Math.PI) / 180,
            colorStops: [
              { offset: 0, color: widget.dotColor },
              { offset: 1, color: widget.dotColor2 },
            ],
          },
        }
      : { type: widget.dotType, color: widget.dotColor };
  const qr = new QRCodeStyling({
    width: size,
    height: size,
    type: 'canvas',
    data: widget.value || ' ',
    margin: 0,
    dotsOptions,
    backgroundOptions: { color: 'transparent' },
  });
  const raw = await qr.getRawData('png');
  if (!raw) return;
  const blob = raw instanceof Blob ? raw : new Blob([raw as BlobPart]);
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    ctx.drawImage(image, 0, 0, widget.width, widget.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 按宽度折行（逐字符测量，兼容中英文混排） */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, letterSpacing: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      const next = line + char;
      const width = ctx.measureText(next).width + letterSpacing * next.length;
      if (width > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawText(ctx: CanvasRenderingContext2D, widget: TextWidget) {
  const style = `${widget.fontStyle === 'italic' ? 'italic ' : ''}${widget.fontWeight === 'bold' ? 'bold ' : ''}`;
  ctx.font = `${style}${widget.fontSize}px '${widget.fontClass.value}', ${widget.fontFamily}, sans-serif`;
  ctx.textBaseline = 'top';
  const letterSpacing = (widget.fontSize * widget.letterSpacing) / 100;
  const lineHeight = widget.fontSize * widget.lineHeight;
  const lines = wrapLines(ctx, widget.text, widget.width, letterSpacing);

  if (widget.backgroundColor) {
    ctx.fillStyle = toCssColor(widget.backgroundColor);
    ctx.fillRect(0, 0, widget.width, widget.height);
  }

  const paint = (effect?: TextWidget['textEffects'] extends (infer E)[] | undefined ? E : never) => {
    lines.forEach((line, index) => {
      const width = ctx.measureText(line).width + letterSpacing * line.length;
      let x = 0;
      if (widget.textAlign === 'center') x = (widget.width - width) / 2;
      else if (widget.textAlign === 'right') x = widget.width - width;
      const y = index * lineHeight + (lineHeight - widget.fontSize) / 2;

      ctx.save();
      if (effect?.offset?.enable) ctx.translate(effect.offset.x, effect.offset.y);
      if (effect?.shadow?.enable) {
        ctx.shadowOffsetX = effect.shadow.offsetX;
        ctx.shadowOffsetY = effect.shadow.offsetY;
        ctx.shadowBlur = effect.shadow.blur;
        ctx.shadowColor = toCssColor(effect.shadow.color);
      }
      const fill = effect?.filling?.enable ? toCssColor(effect.filling.color) : toCssColor(widget.color);
      ctx.fillStyle = effect?.filling?.enable && effect.filling.type !== 0 ? toCssColor(widget.color) : fill;

      // 字距：逐字绘制
      let cursor = x;
      for (const char of line) {
        if (effect?.stroke?.enable) {
          ctx.lineWidth = effect.stroke.width;
          ctx.strokeStyle = toCssColor(effect.stroke.color);
          ctx.strokeText(char, cursor, y);
        }
        ctx.fillText(char, cursor, y);
        cursor += ctx.measureText(char).width + letterSpacing;
      }

      const lineW = cursor - x - letterSpacing;
      if (widget.textDecoration === 'underline') ctx.fillRect(x, y + widget.fontSize + 2, lineW, Math.max(1, widget.fontSize / 16));
      if (widget.textDecoration === 'line-through') ctx.fillRect(x, y + widget.fontSize / 2, lineW, Math.max(1, widget.fontSize / 16));
      ctx.restore();
    });
  };

  if (widget.textEffects && widget.textEffects.length) {
    for (const effect of widget.textEffects) paint(effect);
  } else {
    paint();
  }
}

async function drawWidget(ctx: CanvasRenderingContext2D, widget: Widget, parent: { left: number; top: number }) {
  if (widget.type === 'w-group') return;
  ctx.save();
  const x = widget.left - parent.left;
  const y = widget.top - parent.top;
  ctx.globalAlpha = widget.opacity;
  // 旋转以图层中心为原点
  ctx.translate(x + widget.width / 2, y + widget.height / 2);
  if (widget.rotate) ctx.rotate((widget.rotate * Math.PI) / 180);
  ctx.translate(-widget.width / 2, -widget.height / 2);

  if (widget.type === 'w-brush') {
    if (widget.points.length >= 2) {
      ctx.beginPath();
      widget.points.forEach(([px, py], index) => {
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = toCssColor(widget.color);
      ctx.lineWidth = widget.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (widget.type === 'w-text') drawText(ctx, widget);
  else if (widget.type === 'w-image' || widget.type === 'w-svg') await drawImageLayer(ctx, widget);
  else if (widget.type === 'w-qrcode') await drawQrcode(ctx, widget);
  ctx.restore();
}

export async function renderPoster(
  page: PosterPage,
  widgets: Widget[],
  options?: { scale?: number; format?: 'png' | 'jpeg' }
): Promise<Blob> {
  const scale = options?.scale ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas');
  ctx.scale(scale, scale);

  // JPG 不支持透明，先铺白底
  if (options?.format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
  }
  ctx.save();
  ctx.globalAlpha = page.opacity;
  if (page.backgroundGradient) {
    // 线性渐变简单解析：linear-gradient(<deg>, c1, c2, ...)
    const match = /linear-gradient\(([-\d.]+)deg,\s*(.+)\)/.exec(page.backgroundGradient);
    if (match) {
      const angle = ((Number(match[1]) - 90) * Math.PI) / 180;
      const cx = page.width / 2;
      const cy = page.height / 2;
      const r = Math.hypot(page.width, page.height) / 2;
      const gradient = ctx.createLinearGradient(
        cx - Math.cos(angle) * r,
        cy - Math.sin(angle) * r,
        cx + Math.cos(angle) * r,
        cy + Math.sin(angle) * r
      );
      const stops = match[2].split(/,(?![^(]*\))/).map((item) => item.trim());
      stops.forEach((stop, index) => gradient.addColorStop(index / Math.max(1, stops.length - 1), stop.split(' ')[0]));
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = toCssColor(page.backgroundColor);
    }
  } else {
    ctx.fillStyle = toCssColor(page.backgroundColor);
  }
  ctx.fillRect(0, 0, page.width, page.height);
  if (page.backgroundImage) {
    const image = await loadImage(page.backgroundImage);
    // background-size: cover
    const ratio = Math.max(page.width / image.width, page.height / image.height);
    const w = image.width * ratio;
    const h = image.height * ratio;
    ctx.drawImage(image, (page.width - w) / 2, (page.height - h) / 2, w, h);
  }
  ctx.restore();

  for (const widget of widgets) {
    const parent =
      widget.parent !== '-1'
        ? (widgets.find((item) => item.uuid === widget.parent) ?? { left: 0, top: 0 })
        : { left: 0, top: 0 };
    // 组合内子元素在 Layer 里已按相对容器定位，这里统一用绝对坐标绘制
    await drawWidget(ctx, widget, widget.parent !== '-1' ? { left: 0, top: 0 } : parent);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('导出失败'))),
      options?.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      0.92
    );
  });
}
