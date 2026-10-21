/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 设计画布：渲染图层 + 选择/拖拽/缩放/旋转/吸附/框选。
 *
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)：
 *   components/modules/layout/designBoard    画布与背景
 *   components/business/moveable/Moveable.vue  react-moveable 的参数与事件处理
 *   components/business/moveable/Selecto.ts    框选
 * 原项目用 moveable / selecto，这里用同一作者的 react-moveable / react-selecto，
 * 参数（snapThreshold、renderDirections、keepRatio 规则等）原样保留。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Moveable, { type OnResize, type OnResizeEnd } from 'react-moveable';
import Selecto from 'react-selecto';
import { makeBrush } from './defaults';
import { Layer } from './Layer';
import { usePosterStore } from './store';
import type { TextWidget, Widget } from './model';

/** 不同元素类型显示的缩放手柄，对应 Moveable.vue 里的 renderDirections 分支 */
function directionsFor(widget: Widget | null): string[] {
  if (!widget) return [];
  switch (widget.type) {
    case 'w-text':
      return ['e', 'se'];
    case 'w-image':
    case 'w-svg':
      return ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
    default:
      return ['nw', 'ne', 'sw', 'se'];
  }
}

export interface PosterCanvasProps {
  /** 画笔模式：在画布上按住拖动即可绘制 */
  drawMode?: boolean;
  brushColor?: string;
  brushWidth?: number;
  /** 画完一笔后回调，通常用于退出画笔模式 */
  onStrokeDone?: () => void;
}

export function PosterCanvas({
  drawMode = false,
  brushColor = '#1b1f24',
  brushWidth = 4,
  onStrokeDone,
}: PosterCanvasProps = {}) {
  const layouts = usePosterStore((s) => s.layouts);
  const currentPage = usePosterStore((s) => s.currentPage);
  const selected = usePosterStore((s) => s.selected);
  const zoom = usePosterStore((s) => s.zoom);
  const guidelines = usePosterStore((s) => s.guidelines);

  const page = layouts[currentPage].global;
  const widgets = layouts[currentPage].layers;

  const addWidget = usePosterStore((s) => s.addWidget);
  const select = usePosterStore((s) => s.select);
  const selectMany = usePosterStore((s) => s.selectMany);
  const updateWidget = usePosterStore((s) => s.updateWidget);
  const setZoom = usePosterStore((s) => s.setZoom);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const moveableRef = useRef<Moveable | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // react-moveable 的 keepRatio 是受控 prop（原生 moveable 可在事件里直接改），
  // 因此「拖边缘时解除比例锁」要通过 state 驱动
  const [keepRatio, setKeepRatio] = useState(true);

  const scale = zoom / 100;
  const activeWidget = useMemo(
    () => (selected.length === 1 ? (widgets.find((item) => item.uuid === selected[0]) ?? null) : null),
    [selected, widgets]
  );

  // 适应窗口：首次与画布尺寸变化时按可视区计算缩放（对应 zoomControl 的 autoFit）
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      // 首帧可能还没完成布局（宽高为 0），此时不能按「最小 10%」兜底，
      // 否则会停在 10% 不再恢复；直接跳过，等 ResizeObserver 回调再算。
      if (width < 80 || height < 80) return;

      const padding = 48;
      // 底部预留缩放条高度（44px），避免遮住画布下沿
      const next = Math.min(
        (width - padding) / page.width,
        (height - padding - 44) / page.height
      );
      setZoom(Math.max(10, Math.round(next * 100)));
    };

    // 先等一帧，让左右面板的 flex 布局落定
    const raf = requestAnimationFrame(() => {
      fit();
      setReady(true);
    });
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    // 窗口尺寸变化时 ResizeObserver 在部分浏览器里不会立即回调，
    // 再挂一个 window resize 兜底，避免缩放停留在旧值
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
    // 只在画布尺寸变化时重新适配，缩放由用户控制
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.width, page.height]);

  // 图层元素的 DOM 选择器
  const targets = useMemo(
    () => selected.map((uuid) => `[id="${uuid}"]`).filter(Boolean),
    [selected]
  );
  const singleTarget = targets.length === 1 ? targets[0] : null;

  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [widgets, zoom, selected]);

  // 把缩放后的拖拽位移还原为设计坐标
  /** 当前笔画收集中的点（设计坐标） */
  const strokeRef = useRef<Array<[number, number]> | null>(null);

  const holdPosition = useRef<{ left: number; top: number } | null>(null);
  const resizeBase = useRef<{
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    width: number;
  } | null>(null);

  const background = page.backgroundGradient
    ? { backgroundImage: page.backgroundGradient }
    : { backgroundColor: page.backgroundColor };

  const isMulti = selected.length > 1;

  return (
    <div
      ref={stageRef}
      id="main"
      className="poster-stage"
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        setZoom(zoom + (event.deltaY < 0 ? 10 : -10));
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) select(null);
      }}
    >
      <div
        ref={boardRef}
        id="page-design-canvas"
        className="poster-board"
        style={{
          width: page.width,
          height: page.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
          marginTop: -22,
          opacity: page.opacity,
          ...background,
          backgroundImage: page.backgroundImage
            ? `url(${page.backgroundImage})`
            : background.backgroundImage,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          visibility: ready ? 'visible' : 'hidden',
        }}
        onMouseDown={(event) => {
          // 点击空白处取消选中
          if (event.target === event.currentTarget) select(null);
        }}
      >
        {widgets.map((widget) => {
          // 组合内元素相对容器定位，容器本身相对画布
          const parent =
            widget.parent !== '-1'
              ? (widgets.find((item) => item.uuid === widget.parent) ?? { left: 0, top: 0 })
              : { left: 0, top: 0 };
          return (
            <Layer
              key={widget.uuid}
              widget={widget}
              parent={parent}
              editingId={editingId}
              onDoubleClick={(uuid) => {
                const target = widgets.find((item) => item.uuid === uuid);
                if (target && !target.lock) setEditingId(uuid);
              }}
              onTextChange={(uuid, text) => updateWidget(uuid, { text })}
              onEditEnd={() => setEditingId(null)}
            />
          );
        })}

        {/* 画笔层：盖在图层之上收集笔画，画完转成一个画笔元素 */}
        {drawMode ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 30,
              cursor: 'crosshair',
              touchAction: 'none',
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              strokeRef.current = [
                [(event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale],
              ];
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!strokeRef.current) return;
              const rect = event.currentTarget.getBoundingClientRect();
              strokeRef.current.push([
                (event.clientX - rect.left) / scale,
                (event.clientY - rect.top) / scale,
              ]);
            }}
            onPointerUp={() => {
              const points = strokeRef.current;
              strokeRef.current = null;
              if (!points || points.length < 2) return;
              const xs = points.map(([x]) => x);
              const ys = points.map(([, y]) => y);
              const pad = brushWidth / 2 + 2;
              const left = Math.min(...xs) - pad;
              const top = Math.min(...ys) - pad;
              const width = Math.max(...xs) - Math.min(...xs) + pad * 2;
              const height = Math.max(...ys) - Math.min(...ys) + pad * 2;
              addWidget(
                makeBrush({
                  left: Math.round(left),
                  top: Math.round(top),
                  width: Math.max(2, Math.round(width)),
                  height: Math.max(2, Math.round(height)),
                  color: brushColor,
                  strokeWidth: brushWidth,
                  points: points.map(([x, y]) => [
                    Math.round((x - left) * 10) / 10,
                    Math.round((y - top) * 10) / 10,
                  ]),
                })
              );
              onStrokeDone?.();
            }}
          />
        ) : null}
      </div>

      {/* 选择框：点击选中，Shift 多选 */}
      <Selecto
        container={stageRef.current ?? undefined}
        dragContainer={stageRef.current ?? undefined}
        selectableTargets={['.w-text', '.w-layer']}
        hitRate={0}
        selectByClick
        selectFromInside={false}
        toggleContinueSelect={['shift']}
        ratio={0}
        onDragStart={(event) => {
          const inputTarget = event.inputEvent.target as HTMLElement;
          // 点在 moveable 控制点上、或正在编辑文字时不启动框选
          if (
            moveableRef.current?.isMoveableElement(inputTarget) ||
            inputTarget.closest('[contenteditable="plaintext-only"]')
          ) {
            event.stop();
          }
        }}
        onSelectEnd={(event) => {
          const ids = event.selected.map((element) => element.id).filter(Boolean);
          const filtered = ids.filter((id) => {
            const target = widgets.find((item) => item.uuid === id);
            // 组合内的子元素不单独参与框选，选中其容器
            return target && target.parent === '-1' && !target.lock;
          });
          if (filtered.length === 0) {
            select(null);
          } else if (filtered.length === 1) {
            select(filtered[0]);
          } else {
            selectMany(filtered);
          }
        }}
      />

      {/* 变换控制：与 Moveable.vue 的参数一致 */}
      <Moveable
        ref={moveableRef}
        target={isMulti ? targets : singleTarget}
        zoom={0.8}
        draggable
        throttleDrag={0}
        resizable
        throttleResize={0}
        keepRatio={keepRatio}
        rotatable={!isMulti}
        throttleRotate={0}
        renderDirections={isMulti ? [] : directionsFor(activeWidget)}
        pinchable
        origin={false}
        rotationPosition="bottom"
        snappable
        snapThreshold={4}
        isDisplaySnapDigit
        snapGap={false}
        snapDirections={{ top: true, left: true, bottom: true, right: true, center: false, middle: false }}
        elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
        elementGuidelines={widgets
          .filter((item) => item.parent === '-1' && !selected.includes(item.uuid))
          .map((item) => `[id="${item.uuid}"]`)}
        verticalGuidelines={guidelines.vertical}
        horizontalGuidelines={guidelines.horizontal}
        onDragStart={(event) => {
          if (activeWidget?.lock || editingId) event.stopDrag();
        }}
        onDrag={(event) => {
          event.target.style.left = `${event.left}px`;
          event.target.style.top = `${event.top}px`;
          holdPosition.current = { left: event.left, top: event.top };
        }}
        onDragEnd={() => {
          const held = holdPosition.current;
          if (held && activeWidget) {
            const parent =
              activeWidget.parent !== '-1'
                ? widgets.find((item) => item.uuid === activeWidget.parent)
                : null;
            updateWidget(activeWidget.uuid, {
              left: held.left + (parent?.left ?? 0),
              top: held.top + (parent?.top ?? 0),
            });
          }
          holdPosition.current = null;
        }}
        onDragGroup={(event) => {
          for (const item of event.events) {
            item.target.style.left = `${item.left}px`;
            item.target.style.top = `${item.top}px`;
          }
        }}
        onDragGroupEnd={(event) => {
          for (const item of event.events) {
            updateWidget(item.target.id, {
              left: parseFloat(item.target.style.left),
              top: parseFloat(item.target.style.top),
            });
          }
        }}
        onRotate={(event) => {
          event.target.style.transform = event.transform;
        }}
        onRotateEnd={(event) => {
          if (!activeWidget) return;
          const match = /rotate\(([-\d.]+)deg\)/.exec(event.target.style.transform);
          if (match) updateWidget(activeWidget.uuid, { rotate: Number(match[1]) });
        }}
        onResizeStart={(event) => {
          if (!activeWidget) return;
          const dir = String(event.direction);
          if (activeWidget.type === 'w-text') {
            const text = activeWidget as TextWidget;
            if (dir === '1,0') {
              // 文字侧边拖动只改宽度，不锁比例
              setKeepRatio(false);
            }
            if (dir === '1,1') {
              // 文字角点拖动：字号/字距/行距同比缩放，由 onResize 手动算
              setKeepRatio(false);
              resizeBase.current = {
                fontSize: text.fontSize,
                lineHeight: text.lineHeight,
                letterSpacing: text.letterSpacing,
                width: text.width,
              };
            }
          } else if (
            activeWidget.type === 'w-image' ||
            activeWidget.type === 'w-qrcode' ||
            activeWidget.type === 'w-svg'
          ) {
            // 图片/二维码/SVG：拖边缘自由拉伸，拖角点保持比例
            const edge = ['1,0', '0,-1', '-1,0', '0,1'];
            setKeepRatio(!edge.includes(dir));
          }
        }}
        onResize={(event: OnResize) => {
          const { target, width, height, drag } = event;
          target.style.width = `${width}px`;
          target.style.height = `${height}px`;
          target.style.left = `${drag.left}px`;
          target.style.top = `${drag.top}px`;
          const base = resizeBase.current;
          if (activeWidget?.type === 'w-text' && base && String(event.direction) === '1,1') {
            const ratio = width / base.width;
            target.style.fontSize = `${base.fontSize * ratio}px`;
            target.style.lineHeight = `${base.fontSize * base.lineHeight * ratio}px`;
            target.style.letterSpacing = `${((base.fontSize * base.letterSpacing) / 100) * ratio}px`;
          }
        }}
        onResizeEnd={(event: OnResizeEnd) => {
          if (!activeWidget) return;
          const { target } = event;
          const patch: Record<string, unknown> = {
            width: parseFloat(target.style.width),
            height: parseFloat(target.style.height),
            left: parseFloat(target.style.left),
            top: parseFloat(target.style.top),
          };
          const base = resizeBase.current;
          if (activeWidget.type === 'w-text' && base) {
            patch.fontSize = Math.round(parseFloat(target.style.fontSize) || base.fontSize);
          }
          resizeBase.current = null;
          setKeepRatio(true);
          updateWidget(activeWidget.uuid, patch);
        }}
      />
    </div>
  );
}
