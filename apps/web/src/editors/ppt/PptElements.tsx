/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 演示文稿元素渲染。
 *
 * 结构参考 OpenPPT (https://github.com/YOOTeam/OpenPPT, GPL-3.0) 的
 * views/Editor/Canvas/Element{Text,Image,Shape,Line,Chart,Table,Latex,Video,Audio}，
 * 以及 views/Editor/Canvas/elements/* 的绘制方式，用 React + SVG 重新实现。
 *
 * 与上游的差异：
 * - 图表用内联 SVG 绘制（上游用 echarts）；已覆盖柱/条/折线/面积/饼/环/散点/雷达的常用形态
 * - 公式（LaTeX）用等宽斜体近似排版；上游引入 katex 做真实公式渲染
 */
import katex from 'katex';
import { useMemo } from 'react';
import 'katex/dist/katex.min.css';
import type {
  SlideAudioElement,
  SlideChartElement,
  SlideIframeElement,
  SlideImageElement,
  SlideLatexElement,
  SlideShapeElement,
  SlideVideoElement,
} from '../../api';

/** 图片滤镜，预览与导出共用同一组参数 */
export function imageFilterOf(element: SlideImageElement): string | undefined {
  const parts: string[] = [];
  if (element.brightness !== undefined) parts.push(`brightness(${element.brightness}%)`);
  if (element.contrast !== undefined) parts.push(`contrast(${element.contrast}%)`);
  if (element.saturate !== undefined) parts.push(`saturate(${element.saturate}%)`);
  return parts.length ? parts.join(' ') : undefined;
}

// ------------------------------------------------------------------ 形状

/** 非矩形形状用 clip-path 描述，坐标归一化到 0–100 */
const CLIP: Record<string, string> = {
  triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  pentagon: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
  chevron: 'polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%)',
  star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
};

export function ShapeView({ element, scale }: { element: SlideShapeElement; scale: number }) {
  const stroke = element.lineColor
    ? {
        border: `${(element.lineWidth ?? 1) * scale}px solid ${element.lineColor}`,
        boxSizing: 'border-box' as const,
      }
    : {};

  if (element.type === 'line') {
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative', pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            height: (element.lineWidth ?? 4) * scale,
            transform: 'translateY(-50%)',
            background: element.fill,
          }}
        />
        {element.arrow ? (
          <div
            style={{
              position: 'absolute',
              right: -1,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 0,
              height: 0,
              borderTop: `${((element.lineWidth ?? 4) * scale * 2.2) / 2}px solid transparent`,
              borderBottom: `${((element.lineWidth ?? 4) * scale * 2.2) / 2}px solid transparent`,
              borderLeft: `${(element.lineWidth ?? 4) * scale * 3}px solid ${element.fill}`,
            }}
          />
        ) : null}
      </div>
    );
  }

  const radius =
    element.type === 'ellipse'
      ? '50%'
      : element.type === 'roundRect'
        ? (element.radius ?? 16) * scale
        : 0;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: element.fill,
        borderRadius: radius,
        clipPath: CLIP[element.type],
        opacity: element.opacity ?? 1,
        ...stroke,
        pointerEvents: 'none',
      }}
    />
  );
}

// ------------------------------------------------------------------ 图表

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function arc(cx: number, cy: number, r: number, from: number, to: number, inner = 0): string {
  const point = (angle: number, radius: number) => [
    cx + radius * Math.cos(angle),
    cy + radius * Math.sin(angle),
  ];
  const [x1, y1] = point(from, r);
  const [x2, y2] = point(to, r);
  const large = to - from > Math.PI ? 1 : 0;
  if (inner > 0) {
    const [x3, y3] = point(to, inner);
    const [x4, y4] = point(from, inner);
    return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
  }
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
}

export function ChartView({ element, scale }: { element: SlideChartElement; scale: number }) {
  const width = element.w;
  const height = element.h;
  const padding = { top: 44, right: 20, bottom: 34, left: 48 };
  const innerW = Math.max(40, width - padding.left - padding.right);
  const innerH = Math.max(40, height - padding.top - padding.bottom);
  const { labels, series } = element.data;
  const colors = element.themeColors.length ? element.themeColors : ['#3370ff'];
  const fontSize = Math.max(9, 12 * scale);

  const maxValue = niceMax(
    Math.max(1, ...series.flatMap((item) => item.values.map((value) => Math.abs(value) || 0)))
  );

  const axis = (
    <g stroke="#d5d8de" strokeWidth={1}>
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + innerH} />
      <line
        x1={padding.left}
        y1={padding.top + innerH}
        x2={padding.left + innerW}
        y2={padding.top + innerH}
      />
    </g>
  );

  let body: React.ReactNode = null;

  if (element.chartType === 'pie' || element.chartType === 'ring') {
    const values = series[0]?.values ?? [];
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const cx = width / 2;
    const cy = padding.top + innerH / 2;
    const radius = Math.min(innerW, innerH) / 2 - 4;
    let angle = -Math.PI / 2;
    const slices = values.map((value, index) => {
      const sweep = (Math.max(0, value) / total) * Math.PI * 2;
      const path = arc(cx, cy, radius, angle, angle + sweep, element.chartType === 'ring' ? radius * 0.58 : 0);
      angle += sweep;
      return <path key={index} d={path} fill={colors[index % colors.length]} />;
    });
    body = (
      <g>
        {slices}
        {element.showLegend
          ? labels.map((label, index) => (
              <text
                key={label}
                x={cx + radius + 8}
                y={padding.top + 10 + index * (fontSize + 6)}
                fontSize={fontSize}
                fill="#4e5969"
              >
                {label}
              </text>
            ))
          : null}
      </g>
    );
  } else if (element.chartType === 'column' || element.chartType === 'bar') {
    const groupCount = labels.length || 1;
    const seriesCount = Math.max(1, series.length);
    const band = (element.chartType === 'column' ? innerW : innerH) / groupCount;
    const barSize = (band * 0.62) / seriesCount;
    body = (
      <g>
        {series.map((item, seriesIndex) =>
          item.values.map((value, index) => {
            const ratio = Math.max(0, value) / maxValue;
            const offset = band * 0.19 + seriesIndex * barSize;
            if (element.chartType === 'column') {
              const h = ratio * innerH;
              const x = padding.left + index * band + offset;
              const y = padding.top + innerH - h;
              return (
                <g key={`${seriesIndex}-${index}`}>
                  <rect
                    x={x}
                    y={y}
                    width={barSize * 0.92}
                    height={h}
                    fill={colors[seriesIndex % colors.length]}
                  />
                  {element.showValue ? (
                    <text
                      x={x + (barSize * 0.92) / 2}
                      y={y - 4}
                      fontSize={fontSize}
                      fill="#4e5969"
                      textAnchor="middle"
                    >
                      {value}
                    </text>
                  ) : null}
                </g>
              );
            }
            const w = ratio * innerW;
            const y = padding.top + index * band + offset;
            return (
              <g key={`${seriesIndex}-${index}`}>
                <rect
                  x={padding.left}
                  y={y}
                  width={w}
                  height={barSize * 0.92}
                  fill={colors[seriesIndex % colors.length]}
                />
                {element.showValue ? (
                  <text
                    x={padding.left + w + 6}
                    y={y + (barSize * 0.92) / 2 + fontSize / 3}
                    fontSize={fontSize}
                    fill="#4e5969"
                  >
                    {value}
                  </text>
                ) : null}
              </g>
            );
          })
        )}
        {labels.map((label, index) => (
          <text
            key={label}
            x={
              element.chartType === 'column'
                ? padding.left + index * band + band / 2
                : padding.left - 6
            }
            y={
              element.chartType === 'column'
                ? padding.top + innerH + fontSize + 6
                : padding.top + index * band + band / 2 + fontSize / 3
            }
            fontSize={fontSize}
            fill="#86909c"
            textAnchor={element.chartType === 'column' ? 'middle' : 'end'}
          >
            {label}
          </text>
        ))}
      </g>
    );
  } else if (element.chartType === 'scatter') {
    body = (
      <g>
        {series.map((item, seriesIndex) =>
          item.values.map((value, index) => {
            const x = padding.left + (index / Math.max(1, item.values.length - 1)) * innerW;
            const y = padding.top + innerH - (Math.max(0, value) / maxValue) * innerH;
            return (
              <circle
                key={`${seriesIndex}-${index}`}
                cx={x}
                cy={y}
                r={4}
                fill={colors[seriesIndex % colors.length]}
              />
            );
          })
        )}
      </g>
    );
  } else {
    // line / area / radar 用多段折线
    const isRadar = element.chartType === 'radar';
    body = (
      <g>
        {series.map((item, seriesIndex) => {
          const points = item.values.map((value, index) => {
            const ratio = Math.max(0, value) / maxValue;
            if (isRadar) {
              const angle = (index / Math.max(1, item.values.length)) * Math.PI * 2 - Math.PI / 2;
              const r = (innerH / 2) * ratio;
              return [width / 2 + r * Math.cos(angle), padding.top + innerH / 2 + r * Math.sin(angle)];
            }
            return [
              padding.left + (index / Math.max(1, item.values.length - 1)) * innerW,
              padding.top + innerH - ratio * innerH,
            ];
          });
          const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
          return (
            <g key={seriesIndex}>
              {element.chartType === 'area' ? (
                <path
                  d={`${d} L${padding.left + innerW},${padding.top + innerH} L${padding.left},${padding.top + innerH} Z`}
                  fill={colors[seriesIndex % colors.length]}
                  opacity={0.25}
                />
              ) : null}
              <path d={d} fill="none" stroke={colors[seriesIndex % colors.length]} strokeWidth={2} />
              {points.map(([x, y], index) => (
                <g key={index}>
                  <circle cx={x} cy={y} r={3} fill={colors[seriesIndex % colors.length]} />
                  {element.showValue ? (
                    <text x={x} y={y - 8} fontSize={fontSize} fill="#4e5969" textAnchor="middle">
                      {item.values[index]}
                    </text>
                  ) : null}
                </g>
              ))}
            </g>
          );
        })}
        {element.chartType !== 'radar'
          ? labels.map((label, index) => (
              <text
                key={label}
                x={padding.left + (index / Math.max(1, labels.length - 1)) * innerW}
                y={padding.top + innerH + fontSize + 6}
                fontSize={fontSize}
                fill="#86909c"
                textAnchor="middle"
              >
                {label}
              </text>
            ))
          : null}
      </g>
    );
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ pointerEvents: 'none', overflow: 'visible' }}
    >
      {element.title ? (
        <text x={width / 2} y={22} fontSize={16} fill="#1b1f24" textAnchor="middle" fontWeight={600}>
          {element.title}
        </text>
      ) : null}
      {axis}
      {body}
      {element.showLegend && element.chartType !== 'pie' && element.chartType !== 'ring' ? (
        <g>
          {series.map((item, index) => (
            <g key={item.name}>
              <rect
                x={padding.left + index * 96}
                y={height - 16}
                width={10}
                height={10}
                fill={colors[index % colors.length]}
              />
              <text
                x={padding.left + index * 96 + 14}
                y={height - 7}
                fontSize={fontSize}
                fill="#4e5969"
              >
                {item.name}
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  );
}

// ------------------------------------------------------------------ 公式

export function LatexView({ element, scale }: { element: SlideLatexElement; scale: number }) {
  // 用 katex 做真实公式排版；语法错误时降级为原文，避免整页渲染失败
  const html = useMemo(() => {
    try {
      return katex.renderToString(element.latex || ' ', {
        throwOnError: false,
        displayMode: true,
        output: 'html',
      });
    } catch {
      return element.latex;
    }
  }, [element.latex]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: element.fontSize * scale,
        color: element.color,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ------------------------------------------------------------------ 媒体

export function VideoView({ element }: { element: SlideVideoElement }) {
  const isEmbed = /youtube\.com|youtu\.be|bilibili\.com|vimeo\.com/.test(element.src);
  if (isEmbed) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1b1f24',
          color: '#fff',
          fontSize: 14,
          pointerEvents: 'none',
        }}
      >
        在线视频（放映时播放）
      </div>
    );
  }
  return (
    <video
      src={element.src}
      poster={element.poster}
      autoPlay={element.autoplay}
      muted
      loop
      controls={false}
      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
    />
  );
}

export function AudioView({ element, scale }: { element: SlideAudioElement; scale: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10 * scale,
        padding: 10 * scale,
        boxSizing: 'border-box',
        background: '#f2f3f5',
        borderRadius: 8 * scale,
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          width: 28 * scale,
          height: 28 * scale,
          borderRadius: '50%',
          background: '#3370ff',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12 * scale,
        }}
      >
        ▶
      </span>
      <span style={{ fontSize: 13 * scale, color: '#1b1f24', overflow: 'hidden' }}>
        {element.name || '音频'}
      </span>
      <audio src={element.src} controls={false} autoPlay={element.autoplay} style={{ display: 'none' }} />
    </div>
  );
}

export function IframeView({ element }: { element: SlideIframeElement }) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#f2f3f5' }}>
      <iframe
        src={element.src}
        title="embedded"
        sandbox="allow-scripts allow-same-origin allow-popups"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          // 编辑态不拦截鼠标，否则无法选中元素
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
