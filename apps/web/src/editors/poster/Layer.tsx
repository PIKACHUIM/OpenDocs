/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 图层渲染。
 *
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)
 * 的 components/modules/widgets/{wText,wImage,wSvg,wQrcode,wGroup}：
 * 行高 = fontSize × lineHeight、字距 = fontSize × letterSpacing / 100、
 * 文字特效（描边/阴影/渐变填充/偏移）按多层叠加的方式渲染，保持与原项目一致。
 */
import QRCodeStyling from 'qr-code-styling';
import { memo, useEffect, useRef, type CSSProperties } from 'react';
import type {
  GroupWidget,
  ImageWidget,
  QrcodeWidget,
  SvgWidget,
  TextEffect,
  TextWidget,
  Widget,
} from './model';

interface LayerProps {
  widget: Widget;
  /** 组合内的元素相对容器定位 */
  parent: { left: number; top: number };
  /** 编辑中的文字 uuid（双击进入） */
  editingId: string | null;
  onTextChange: (uuid: string, text: string) => void;
  onEditEnd: () => void;
  onDoubleClick: (uuid: string) => void;
}

/** 文字特效里渐变填充的 background-image，对应原项目 getGradientOrImg */
function fillImage(effect: TextEffect): string | undefined {
  const { filling } = effect;
  if (!filling.enable || filling.type === 0) return undefined;
  return filling.color.includes('gradient') ? filling.color : `url(${filling.color})`;
}

function TextLayer({
  widget,
  editing,
  onTextChange,
  onEditEnd,
}: {
  widget: TextWidget;
  editing: boolean;
  onTextChange: (text: string) => void;
  onEditEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // 进入编辑：先把当前文本写进 DOM，再聚焦并全选。
  // 编辑过程中由浏览器自己维护 DOM（不再经 React 重写 innerHTML），
  // 否则每次输入都会重置光标，导致后续字符插在最前面、文字顺序颠倒。
  useEffect(() => {
    const node = ref.current;
    if (!editing || !node) return;
    node.innerText = widget.text;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // 只在进入编辑态时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const family = `'${widget.fontClass.value}', ${widget.fontFamily}, sans-serif`;
  const textStyle: CSSProperties = { fontFamily: family };

  const commit = () => {
    const node = ref.current;
    if (node) onTextChange(node.innerText);
    onEditEnd();
  };

  return (
    <>
      {!editing && widget.textEffects
        ? widget.textEffects.map((effect, index) => (
            <div
              key={index}
              className="edit-text effect-text"
              style={{
                ...textStyle,
                position: 'absolute',
                inset: 0,
                color:
                  effect.filling?.enable && effect.filling.type === 0
                    ? effect.filling.color
                    : 'transparent',
                WebkitTextStroke: effect.stroke?.enable
                  ? `${effect.stroke.width}px ${effect.stroke.color}`
                  : undefined,
                textShadow: effect.shadow?.enable
                  ? `${effect.shadow.offsetX}px ${effect.shadow.offsetY}px ${effect.shadow.blur}px ${effect.shadow.color}`
                  : undefined,
                backgroundImage: fillImage(effect),
                WebkitBackgroundClip: fillImage(effect) ? 'text' : undefined,
                transform: effect.offset?.enable
                  ? `translate(${effect.offset.x}px, ${effect.offset.y}px)`
                  : undefined,
              }}
            >
              {widget.text}
            </div>
          ))
        : null}
      {editing ? (
        // 编辑态：不带 React 子节点，内容完全交给浏览器
        <div
          ref={ref}
          className="edit-text"
          style={{ ...textStyle, outline: 'none', position: 'relative' }}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={commit}
        />
      ) : (
        <div className="edit-text" style={{ ...textStyle, position: 'relative' }}>
          {widget.text}
        </div>
      )}
    </>
  );
}

function SvgLayer({ widget }: { widget: SvgWidget }) {
  // 原项目会按 colors 数组替换 SVG 里的 fill；这里直接作为 <img>，颜色替换在 svg 文本阶段完成
  return (
    <img
      src={widget.svgUrl}
      alt=""
      draggable={false}
      style={{ width: '100%', height: '100%', borderRadius: widget.radius, pointerEvents: 'none' }}
    />
  );
}

function QrLayer({ widget }: { widget: QrcodeWidget }) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    node.innerHTML = '';
    const size = Math.max(40, Math.round(Math.min(widget.width, widget.height)));
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
      type: 'svg',
      data: widget.value || ' ',
      margin: 0,
      dotsOptions,
      backgroundOptions: { color: 'transparent' },
    });
    qr.append(node);
  }, [
    widget.value,
    widget.dotType,
    widget.dotColorType,
    widget.dotColor,
    widget.dotColor2,
    widget.dotRotation,
    widget.width,
    widget.height,
  ]);

  return (
    <div
      ref={host}
      style={{
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        borderRadius: widget.radius,
        overflow: 'hidden',
      }}
    />
  );
}

function ImageLayer({ widget }: { widget: ImageWidget }) {
  const filters: string[] = [];
  if (widget.brightness !== undefined) filters.push(`brightness(${widget.brightness}%)`);
  if (widget.contrast !== undefined) filters.push(`contrast(${widget.contrast}%)`);
  if (widget.saturate !== undefined) filters.push(`saturate(${widget.saturate}%)`);

  return (
    <img
      src={widget.imgUrl}
      alt=""
      draggable={false}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'fill',
        borderRadius: widget.radius,
        pointerEvents: 'none',
        filter: filters.length ? filters.join(' ') : undefined,
        transform: widget.flip === 'x' ? 'scaleX(-1)' : widget.flip === 'y' ? 'scaleY(-1)' : undefined,
      }}
    />
  );
}

function GroupLayer(_: { widget: GroupWidget }) {
  return null;
}

/**
 * 一个图层。id 取 uuid，react-moveable 通过 `[id="uuid"]` 选择器定位目标，
 * 与原项目 Moveable.vue 里的 `[id="${val.uuid}"]` 完全一致。
 */
function LayerImpl({ widget, parent, editingId, onTextChange, onEditEnd, onDoubleClick }: LayerProps) {
  const base: CSSProperties = {
    position: 'absolute',
    left: widget.left - parent.left,
    top: widget.top - parent.top,
    width: widget.width,
    height: widget.height,
    opacity: widget.opacity,
    transform: widget.rotate ? `rotate(${widget.rotate}deg)` : undefined,
    pointerEvents: widget.lock ? 'none' : undefined,
  };

  if (widget.type === 'w-text') {
    const w = widget;
    const style: CSSProperties = {
      ...base,
      minWidth: w.fontSize,
      minHeight: w.fontSize * w.lineHeight,
      lineHeight: `${w.fontSize * w.lineHeight}px`,
      letterSpacing: `${(w.fontSize * w.letterSpacing) / 100}px`,
      fontSize: w.fontSize,
      color: w.color,
      textAlign: w.textAlign,
      fontWeight: w.fontWeight,
      fontStyle: w.fontStyle,
      textDecoration: w.textDecoration,
      backgroundColor: w.backgroundColor || undefined,
      writingMode: w.writingMode,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      cursor: editingId === w.uuid ? 'text' : undefined,
      userSelect: editingId === w.uuid ? 'text' : 'none',
    };
    return (
      <div
        id={w.uuid}
        className={`w-text${w.lock ? ' layer-lock' : ''}`}
        style={style}
        onDoubleClick={() => onDoubleClick(w.uuid)}
      >
        <TextLayer
          widget={w}
          editing={editingId === w.uuid}
          onTextChange={(text) => onTextChange(w.uuid, text)}
          onEditEnd={onEditEnd}
        />
      </div>
    );
  }

  return (
    <div id={widget.uuid} className={`w-layer${widget.lock ? ' layer-lock' : ''}`} style={base}>
      {widget.type === 'w-image' ? <ImageLayer widget={widget} /> : null}
      {widget.type === 'w-svg' ? <SvgLayer widget={widget} /> : null}
      {widget.type === 'w-qrcode' ? <QrLayer widget={widget} /> : null}
      {widget.type === 'w-group' ? <GroupLayer widget={widget} /> : null}
    </div>
  );
}

export const Layer = memo(LayerImpl);
