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

export function PosterCanvas() {
  const layouts = usePosterStore((s) => s.layouts);
  const currentPage = usePosterStore((s) => s.currentPage);
  const selected = usePosterStore((s) => s.selected);
  const zoom = usePosterStore((s) => s.zoom);
  const guidelines = usePosterStore((s) => s.guidelines);

  const page = layouts[currentPage].global;
  const widgets = layouts[currentPage].layers;

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
      const padding = 48;
      // 底部预留缩放条高度（44px），避免遮住画布下沿
      const next = Math.min(
        (stage.clientWidth - padding) / page.width,
        (stage.clientHeight - padding - 44) / page.height
      );
      setZoom(Math.max(0.1, next) * 100);
    };
    fit();
    setReady(true);
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
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
