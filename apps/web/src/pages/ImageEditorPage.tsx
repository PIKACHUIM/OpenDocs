import { useEffect, useMemo, useRef, useState } from 'react';
import localforage from 'localforage';
import { ApiError, documentApi, type ImageContent } from '../api';
import { navigate } from '../lib/router';
import { AssetPicker } from '../ui/AssetPicker';
import styles from '../ui/common.module.scss';

type Align = 'left' | 'center' | 'right';

interface BaseLayer {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0–1，默认 1 */
  opacity?: number;
}

interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  color: string;
  fontSize: number;
  bold: boolean;
  align: Align;
}

interface ShapeLayer extends BaseLayer {
  type: 'rect' | 'ellipse';
  fill: string;
  radius: number;
}

interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string;
  /** 百分比，100 表示原样 */
  brightness?: number;
  contrast?: number;
  saturate?: number;
}

/** 把滤镜参数拼成 CSS/canvas 都能用的 filter 字符串 */
function filterOf(layer: ImageLayer): string | undefined {
  const parts: string[] = [];
  if (layer.brightness !== undefined) parts.push(`brightness(${layer.brightness}%)`);
  if (layer.contrast !== undefined) parts.push(`contrast(${layer.contrast}%)`);
  if (layer.saturate !== undefined) parts.push(`saturate(${layer.saturate}%)`);
  return parts.length ? parts.join(' ') : undefined;
}

type Layer = TextLayer | ShapeLayer | ImageLayer;

const PRESETS = [
  { label: '小红书 3:4', w: 1080, h: 1440 },
  { label: '方图 1:1', w: 1080, h: 1080 },
  { label: '竖屏 9:16', w: 1080, h: 1920 },
  { label: '横屏 16:9', w: 1920, h: 1080 },
];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `l_${Date.now()}_${Math.random()}`);

const IMAGE_DRAFT_KEY = 'opendocs_image_draft';

/**
 * 图片编辑（React 实现的首版）。
 *
 * 定位与 poster-design 一致：面向"快速做一张图"的场景——背景 + 文字 + 色块 + 图片，
 * 图层化编辑，导出 PNG。当前刻意不做素材库与模板市场：
 * 那部分依赖一整套后端素材体系，属于后续阶段。
 */
export function ImageEditorPage() {
  const [size, setSize] = useState({ w: 1080, h: 1440 });
  const [background, setBackground] = useState('#f5f6f8');
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(
    null
  );

  const current = useMemo(() => layers.find((layer) => layer.id === selected) ?? null, [layers, selected]);

  // 自动保存：图片编辑目前是独立工具页，草稿存浏览器（刷新/重开不丢）。
  // 云端文档化需要新增文档类型，属于后续改造。
  // 带 ?id= 时编辑云端文档；否则是本地草稿（免登录试用）
  const docId = useMemo(() => new URLSearchParams(window.location.search).get('id'), []);
  const versionRef = useRef(1);
  const [docTitle, setDocTitle] = useState('未命名图片');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (docId) {
        try {
          const data = await documentApi.get(docId);
          if (cancelled) return;
          const content = data.content as unknown as ImageContent;
          setSize({ w: content.width ?? 1080, h: content.height ?? 1440 });
          setBackground(content.background ?? '#f5f6f8');
          setLayers((content.layers ?? []) as Layer[]);
          setDocTitle(data.document.title);
          versionRef.current = data.document.version;
        } catch {
          // 加载失败退回空白画布
        }
      } else {
        const draft = await localforage.getItem<{
          size: { w: number; h: number };
          background: string;
          layers: Layer[];
        }>(IMAGE_DRAFT_KEY);
        if (cancelled) return;
        if (draft) {
          setSize(draft.size);
          setBackground(draft.background);
          setLayers(draft.layers);
        }
      }
      setDraftReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  useEffect(() => {
    if (!draftReady) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      if (docId) {
        const content: ImageContent = {
          type: 'image',
          version: 1,
          width: size.w,
          height: size.h,
          background,
          layers: layers as unknown[],
        };
        void documentApi
          .save(docId, { content, baseVersion: versionRef.current })
          .then((result) => {
            versionRef.current = result.document.version;
            setSaveState('saved');
          })
          .catch(() => setSaveState('idle'));
        return;
      }
      void localforage
        .setItem(IMAGE_DRAFT_KEY, { size, background, layers })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('idle'));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draftReady, docId, size, background, layers]);

  /** 把本地草稿另存为云端图片文档 */
  const saveToAccount = async () => {
    setCreating(true);
    try {
      const content: ImageContent = {
        type: 'image',
        version: 1,
        width: size.w,
        height: size.h,
        background,
        layers: layers as unknown[],
      };
      const data = await documentApi.create({ type: 'image', title: '未命名图片', content });
      navigate(`/image?id=${data.document.id}`);
    } catch (error) {
      window.alert(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setCreating(false);
    }
  };

  // 预览按容器宽度等比缩放
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const update = () => {
      const width = canvasRef.current?.parentElement?.clientWidth ?? 800;
      setScale(Math.min(1, Math.max(0.15, (width - 48) / size.w)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [size.w]);

  const patch = (id: string, next: Partial<Layer>) => {
    setLayers((prev) => prev.map((layer) => (layer.id === id ? ({ ...layer, ...next } as Layer) : layer)));
  };

  const addText = () => {
    const layer: TextLayer = {
      id: uid(),
      type: 'text',
      x: Math.round(size.w * 0.1),
      y: Math.round(size.h * 0.4),
      w: Math.round(size.w * 0.8),
      h: 120,
      text: '双击编辑文字',
      color: '#1b1f24',
      fontSize: 64,
      bold: true,
      align: 'center',
    };
    setLayers((prev) => [...prev, layer]);
    setSelected(layer.id);
  };

  /** 内置模板：给"从零开始"提供一个可用的起点 */
  const applyTemplate = (kind: 'cover' | 'quote' | 'list') => {
    const text = (partial: Partial<TextLayer> & Pick<TextLayer, 'x' | 'y' | 'w' | 'h' | 'text'>): TextLayer => ({
      id: uid(),
      type: 'text',
      color: '#1b1f24',
      fontSize: 56,
      bold: true,
      align: 'left',
      ...partial,
    });

    if (kind === 'cover') {
      setBackground('#f5f6f8');
      setLayers([
        {
          id: uid(),
          type: 'rect',
          x: Math.round(size.w * 0.08),
          y: Math.round(size.h * 0.08),
          w: Math.round(size.w * 0.84),
          h: Math.round(size.h * 0.84),
          fill: '#ffffff',
          radius: 24,
        },
        text({
          x: Math.round(size.w * 0.14),
          y: Math.round(size.h * 0.32),
          w: Math.round(size.w * 0.72),
          h: 200,
          text: '在这里写标题',
          fontSize: 88,
        }),
        text({
          x: Math.round(size.w * 0.14),
          y: Math.round(size.h * 0.5),
          w: Math.round(size.w * 0.72),
          h: 120,
          text: '一行副标题，说明这张图要讲什么',
          fontSize: 44,
          bold: false,
          color: '#4e5969',
        }),
      ]);
      return;
    }

    if (kind === 'quote') {
      setBackground('#1b1f24');
      setLayers([
        text({
          x: Math.round(size.w * 0.12),
          y: Math.round(size.h * 0.3),
          w: Math.round(size.w * 0.76),
          h: 320,
          text: '“一句值得被记住的话。”',
          fontSize: 76,
          color: '#ffffff',
          align: 'center',
        }),
        text({
          x: Math.round(size.w * 0.12),
          y: Math.round(size.h * 0.62),
          w: Math.round(size.w * 0.76),
          h: 80,
          text: '—— 出处',
          fontSize: 40,
          bold: false,
          color: '#a9b1bb',
          align: 'center',
        }),
      ]);
      return;
    }

    setBackground('#ffffff');
    setLayers([
      text({
        x: Math.round(size.w * 0.1),
        y: Math.round(size.h * 0.1),
        w: Math.round(size.w * 0.8),
        h: 120,
        text: '清单标题',
        fontSize: 72,
      }),
      text({
        x: Math.round(size.w * 0.1),
        y: Math.round(size.h * 0.28),
        w: Math.round(size.w * 0.8),
        h: Math.round(size.h * 0.5),
        text: '01  第一件事\n02  第二件事\n03  第三件事',
        fontSize: 52,
        bold: false,
        color: '#1b1f24',
      }),
    ]);
  };

  const addShape = (type: 'rect' | 'ellipse') => {
    const layer: ShapeLayer = {
      id: uid(),
      type,
      x: Math.round(size.w * 0.2),
      y: Math.round(size.h * 0.2),
      w: Math.round(size.w * 0.6),
      h: Math.round(size.h * 0.3),
      fill: '#3370ff',
      radius: 16,
    };
    setLayers((prev) => [...prev, layer]);
    setSelected(layer.id);
  };

  const addImageUrl = (src: string) => {
    const layer: ImageLayer = {
      id: uid(),
      type: 'image',
      x: Math.round(size.w * 0.1),
      y: Math.round(size.h * 0.1),
      w: Math.round(size.w * 0.8),
      h: Math.round(size.h * 0.5),
      src,
    };
    setLayers((prev) => [...prev, layer]);
    setSelected(layer.id);
  };

  const removeLayer = (id: string) => {
    setLayers((prev) => prev.filter((layer) => layer.id !== id));
    if (selected === id) setSelected(null);
  };

  const duplicateLayer = (id: string) => {
    const source = layers.find((layer) => layer.id === id);
    if (!source) return;
    const copy = { ...source, id: uid(), x: source.x + 24, y: source.y + 24 } as Layer;
    setLayers((prev) => [...prev, copy]);
    setSelected(copy.id);
  };

  /** 对齐到画布：poster-design 里最常用的一组操作 */
  const alignLayer = (
    id: string,
    axis: 'left' | 'centerX' | 'right' | 'top' | 'middle' | 'bottom'
  ) => {
    const layer = layers.find((item) => item.id === id);
    if (!layer) return;
    const offsets = {
      left: { x: 0 },
      centerX: { x: Math.round((size.w - layer.w) / 2) },
      right: { x: size.w - layer.w },
      top: { y: 0 },
      middle: { y: Math.round((size.h - layer.h) / 2) },
      bottom: { y: size.h - layer.h },
    } as const;
    patch(id, offsets[axis] as never);
  };

  const moveLayer = (id: string, direction: 1 | -1) => {
    setLayers((prev) => {
      const index = prev.findIndex((layer) => layer.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  };

  const onPointerDown = (event: React.PointerEvent, layer: Layer) => {
    event.stopPropagation();
    setSelected(layer.id);
    dragRef.current = {
      id: layer.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: layer.x,
      originY: layer.y,
    };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    patch(drag.id, {
      x: Math.round(drag.originX + (event.clientX - drag.startX) / scale),
      y: Math.round(drag.originY + (event.clientY - drag.startY) / scale),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const exportPng = async () => {
    setExporting(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器不支持 Canvas');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size.w, size.h);

      for (const layer of layers) {
        ctx.globalAlpha = layer.opacity ?? 1;
        if (layer.type === 'image') {
          const image = await loadImage(layer.src);
          const filter = filterOf(layer);
          if (filter) ctx.filter = filter;
          ctx.drawImage(image, layer.x, layer.y, layer.w, layer.h);
          ctx.filter = 'none';
          continue;
        }
        if (layer.type === 'rect' || layer.type === 'ellipse') {
          ctx.fillStyle = layer.fill;
          if (layer.type === 'rect') {
            roundRect(ctx, layer.x, layer.y, layer.w, layer.h, layer.radius);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.ellipse(
              layer.x + layer.w / 2,
              layer.y + layer.h / 2,
              layer.w / 2,
              layer.h / 2,
              0,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
          continue;
        }
        // 文字
        if (layer.type !== 'text') continue;
        ctx.fillStyle = layer.color;
        ctx.font = `${layer.bold ? '700' : '400'} ${layer.fontSize}px -apple-system, "PingFang SC", "Microsoft Yahei", sans-serif`;
        ctx.textBaseline = 'top';
        ctx.textAlign = layer.align;
        const anchorX =
          layer.align === 'center' ? layer.x + layer.w / 2 : layer.align === 'right' ? layer.x + layer.w : layer.x;
        const lines = wrapText(ctx, layer.text, layer.w);
        lines.forEach((line, index) => {
          ctx.fillText(line, anchorX, layer.y + index * layer.fontSize * 1.3);
        });
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('导出失败');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `opendocs-image-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles.imageEditor}>
      <div className={styles.imageToolbar}>
        <button type="button" className={`${styles.button} ${styles.buttonGhost}`} onClick={() => navigate('/')}>
          ← 返回
        </button>
        <span className={styles.imageTitle}>{docId ? docTitle : '图片编辑'}</span>
        <span className={styles.hint} style={{ marginLeft: 8 }}>
          {saveState === 'saving'
            ? '保存中…'
            : saveState === 'saved'
              ? docId
                ? '已保存到云端'
                : '已自动保存到本地'
              : ''}
        </span>
        <span className={styles.grow} />
        {docId ? null : (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={creating}
            onClick={saveToAccount}
          >
            {creating ? '保存中…' : '保存到我的文档'}
          </button>
        )}
        <button type="button" className={styles.button} onClick={() => applyTemplate('cover')}>
          封面模板
        </button>
        <button type="button" className={styles.button} onClick={() => applyTemplate('quote')}>
          引用模板
        </button>
        <button type="button" className={styles.button} onClick={() => applyTemplate('list')}>
          清单模板
        </button>
        <button type="button" className={styles.button} onClick={addText}>
          文字
        </button>
        <button type="button" className={styles.button} onClick={() => addShape('rect')}>
          矩形
        </button>
        <button type="button" className={styles.button} onClick={() => addShape('ellipse')}>
          圆形
        </button>
        <button type="button" className={styles.button} onClick={() => setPickerOpen(true)}>
          图片
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          disabled={exporting}
          onClick={exportPng}
        >
          {exporting ? '导出中…' : '导出 PNG'}
        </button>
      </div>

      <div className={styles.imageBody}>
        <div className={styles.imageStage} ref={canvasRef}>
          <div
            className={styles.imageCanvas}
            style={{
              width: size.w * scale,
              height: size.h * scale,
              background,
            }}
            onClick={() => setSelected(null)}
          >
            {layers.map((layer) => (
              <div
                key={layer.id}
                className={`${styles.imageLayer} ${selected === layer.id ? styles.imageLayerActive : ''}`}
                style={{
                  left: layer.x * scale,
                  top: layer.y * scale,
                  width: layer.w * scale,
                  height: layer.h * scale,
                  opacity: layer.opacity ?? 1,
                }}
                onPointerDown={(event) => onPointerDown(event, layer)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {layer.type === 'text' ? (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      color: layer.color,
                      fontSize: layer.fontSize * scale,
                      fontWeight: layer.bold ? 700 : 400,
                      textAlign: layer.align,
                      lineHeight: 1.3,
                      whiteSpace: 'pre-wrap',
                      overflow: 'hidden',
                      pointerEvents: 'none',
                    }}
                  >
                    {layer.text}
                  </div>
                ) : layer.type === 'image' ? (
                  <img
                    src={layer.src}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'fill',
                      pointerEvents: 'none',
                      filter: filterOf(layer),
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      background: layer.fill,
                      borderRadius: layer.type === 'rect' ? layer.radius * scale : '50%',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <aside className={styles.imageSidebar}>
          <div className={styles.field}>
            <span className={styles.label}>画布尺寸</span>
            <select
              className={styles.select}
              value={`${size.w}x${size.h}`}
              onChange={(event) => {
                const preset = PRESETS.find((item) => `${item.w}x${item.h}` === event.target.value);
                if (preset) setSize({ w: preset.w, h: preset.h });
              }}
            >
              {PRESETS.map((preset) => (
                <option key={preset.label} value={`${preset.w}x${preset.h}`}>
                  {preset.label}（{preset.w}×{preset.h}）
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>背景色</span>
            <input
              className={styles.input}
              type="color"
              value={background}
              onChange={(event) => setBackground(event.target.value)}
            />
          </div>

          {current ? (
            <>
              <div className={styles.field}>
                <span className={styles.label}>位置与大小</span>
                <div className={styles.imageGrid4}>
                  {(['x', 'y', 'w', 'h'] as const).map((key) => (
                    <label key={key} className={styles.imageNumber}>
                      <span>{key.toUpperCase()}</span>
                      <input
                        className={styles.input}
                        type="number"
                        value={Math.round(current[key])}
                        onChange={(event) => patch(current.id, { [key]: Number(event.target.value) } as never)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {current.type === 'text' ? (
                <>
                  <div className={styles.field}>
                    <span className={styles.label}>文字</span>
                    <textarea
                      className={styles.textarea}
                      value={current.text}
                      onChange={(event) => patch(current.id, { text: event.target.value } as never)}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>字号 / 颜色</span>
                    <div className={styles.row}>
                      <input
                        className={styles.input}
                        type="number"
                        value={current.fontSize}
                        onChange={(event) => patch(current.id, { fontSize: Number(event.target.value) } as never)}
                      />
                      <input
                        className={styles.input}
                        type="color"
                        value={current.color}
                        onChange={(event) => patch(current.id, { color: event.target.value } as never)}
                      />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>对齐</span>
                    <div className={styles.segmented}>
                      {(['left', 'center', 'right'] as Align[]).map((align) => (
                        <button
                          key={align}
                          type="button"
                          className={`${styles.segmentedItem} ${
                            current.align === align ? styles.segmentedItemActive : ''
                          }`}
                          onClick={() => patch(current.id, { align } as never)}
                        >
                          {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {current.type === 'image' ? (
                <div className={styles.field}>
                  <span className={styles.label}>滤镜</span>
                  {(
                    [
                      ['brightness', '亮度'],
                      ['contrast', '对比度'],
                      ['saturate', '饱和度'],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                    >
                      <span style={{ width: 44, color: '#86909c' }}>{label}</span>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={(current as ImageLayer)[key] ?? 100}
                        onChange={(event) =>
                          patch(current.id, { [key]: Number(event.target.value) } as never)
                        }
                        style={{ flex: 1 }}
                      />
                      <span style={{ width: 36, textAlign: 'right', color: '#86909c' }}>
                        {(current as ImageLayer)[key] ?? 100}%
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}

              {current.type === 'rect' || current.type === 'ellipse' ? (
                <div className={styles.field}>
                  <span className={styles.label}>颜色</span>
                  <input
                    className={styles.input}
                    type="color"
                    value={current.fill}
                    onChange={(event) => patch(current.id, { fill: event.target.value } as never)}
                  />
                </div>
              ) : null}

              <div className={styles.field}>
                <span className={styles.label}>对齐画布</span>
                <div className={styles.row}>
                  {(
                    [
                      ['left', '左'],
                      ['centerX', '水平居中'],
                      ['right', '右'],
                      ['top', '上'],
                      ['middle', '垂直居中'],
                      ['bottom', '下'],
                    ] as const
                  ).map(([axis, label]) => (
                    <button
                      key={axis}
                      type="button"
                      className={`${styles.button} ${styles.buttonSm}`}
                      onClick={() => alignLayer(current.id, axis)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.label}>不透明度</span>
                <input
                  className={styles.input}
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={current.opacity ?? 1}
                  onChange={(event) =>
                    patch(current.id, { opacity: Number(event.target.value) } as never)
                  }
                />
              </div>

              <div className={styles.row}>
                <button type="button" className={styles.button} onClick={() => moveLayer(current.id, -1)}>
                  下移
                </button>
                <button type="button" className={styles.button} onClick={() => moveLayer(current.id, 1)}>
                  上移
                </button>
                <button type="button" className={styles.button} onClick={() => duplicateLayer(current.id)}>
                  复制
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonDanger}`}
                  onClick={() => removeLayer(current.id)}
                >
                  删除
                </button>
              </div>
            </>
          ) : (
            <p className={styles.hint}>选中画布中的元素后可调整位置、大小与颜色。</p>
          )}

          <div className={styles.field} style={{ marginTop: 4 }}>
            <span className={styles.label}>图层（{layers.length}）</span>
            <div className={styles.layerList}>
              {layers.length === 0 ? (
                <p className={styles.hint}>还没有元素，用上方按钮添加。</p>
              ) : (
                [...layers]
                  .reverse()
                  .map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      className={`${styles.layerItem} ${
                        selected === layer.id ? styles.layerItemActive : ''
                      }`}
                      onClick={() => setSelected(layer.id)}
                    >
                      <span className={styles.layerItemText}>
                        {layer.type === 'text'
                          ? `文字：${layer.text.slice(0, 10) || '空'}`
                          : layer.type === 'image'
                            ? '图片'
                            : layer.type === 'rect'
                              ? '矩形'
                              : '圆形'}
                      </span>
                    </button>
                  ))
              )}
            </div>
          </div>

          <p className={styles.hint} style={{ marginTop: 16 }}>
            当前为图片编辑 v2：模板、图层管理与对齐已具备；素材库与模板市场需要后端素材体系，属于下一阶段。
          </p>
        </aside>
      </div>

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(asset) => addImageUrl(asset.url)}
      />
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (ctx.measureText(line + char).width > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}
