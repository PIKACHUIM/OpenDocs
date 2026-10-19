import { memo, useEffect, useRef, useState } from 'react';
import {
  createId,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type PptContent,
  type PptSlide,
  type SlideElement,
  type SlideShapeElement,
  type SlideTextElement,
} from '../../api';
import { AssetPicker } from '../../ui/AssetPicker';
import styles from './ppt.module.scss';

export interface PptEditorProps {
  content: PptContent;
  canWrite: boolean;
  documentId: string | null;
  onChange: (content: PptContent) => void;
}

/**
 * 把旧版「固定版式」幻灯片迁移成自由画布的 elements。
 * 只在新旧混用时执行一次，之后所有数据都是 elements。
 */
function migrateSlide(slide: PptSlide): SlideElement[] {
  if (slide.elements) return slide.elements;
  const elements: SlideElement[] = [];
  const layout = slide.layout ?? 'title-body';
  const text = (
    partial: Partial<SlideTextElement> & Pick<SlideTextElement, 'x' | 'y' | 'w' | 'h' | 'text'>
  ): SlideTextElement => ({
    id: createId('el'),
    type: 'text',
    fontSize: 28,
    color: '#1b1f24',
    bold: false,
    align: 'left',
    ...partial,
  });

  if (layout === 'title') {
    elements.push(
      text({
        x: 120,
        y: 250,
        w: 1040,
        h: 120,
        text: slide.title || '标题',
        fontSize: 64,
        bold: true,
        align: 'center',
      })
    );
    if (slide.body) {
      elements.push(
        text({
          x: 120,
          y: 390,
          w: 1040,
          h: 80,
          text: slide.body,
          color: '#86909c',
          align: 'center',
        })
      );
    }
  } else if (layout === 'two-column') {
    elements.push(
      text({ x: 80, y: 60, w: 1120, h: 90, text: slide.title || '标题', fontSize: 44, bold: true })
    );
    elements.push(text({ x: 80, y: 180, w: 540, h: 460, text: slide.body ?? '' }));
    elements.push(text({ x: 660, y: 180, w: 540, h: 460, text: slide.bodyRight ?? '' }));
  } else {
    elements.push(
      text({ x: 80, y: 60, w: 1120, h: 90, text: slide.title || '标题', fontSize: 44, bold: true })
    );
    if (slide.body) elements.push(text({ x: 80, y: 180, w: 1120, h: 460, text: slide.body }));
  }

  if (slide.imageUrl) {
    elements.push({
      id: createId('el'),
      type: 'image',
      x: 760,
      y: 360,
      w: 400,
      h: 260,
      src: slide.imageUrl,
    });
  }
  return elements;
}

export function PptEditor({ content, canWrite, documentId, onChange }: PptEditorProps) {
  const [active, setActive] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(0.5);
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: SlideElement;
  } | null>(null);

  const slides = content.slides;
  const slide = slides[Math.min(active, slides.length - 1)];
  const elements = slide?.elements ?? [];

  // 旧文档迁移一次
  useEffect(() => {
    if (content.slides.some((item) => !item.elements)) {
      onChange({
        ...content,
        slides: content.slides.map((item) => ({ ...item, elements: migrateSlide(item) })),
      });
    }
    // 只在挂载时迁移
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const calc = () => {
      const host = stageRef.current;
      if (!host) return;
      const width = host.clientWidth - 48;
      const height = host.clientHeight - 48;
      setScale(Math.max(0.15, Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT)));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    if (!canWrite) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        event.preventDefault();
        removeElement(selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canWrite, selectedId]);

  // 撤销 / 重做：只在「结构性操作」时记录快照，拖拽过程不记录
  const historyRef = useRef<PptSlide[][]>([]);
  const futureRef = useRef<PptSlide[][]>([]);
  const [, forceRender] = useState(0);

  const pushHistory = () => {
    historyRef.current.push(slides);
    if (historyRef.current.length > 60) historyRef.current.shift();
    futureRef.current = [];
  };

  const updateSlides = (next: PptSlide[], record = true) => {
    if (record) pushHistory();
    onChange({ ...content, slides: next });
    forceRender((value) => value + 1);
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current.push(slides);
    onChange({ ...content, slides: previous });
    forceRender((value) => value + 1);
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(slides);
    onChange({ ...content, slides: next });
    forceRender((value) => value + 1);
  };

  const patchSlide = (index: number, patch: Partial<PptSlide>, record = true) =>
    updateSlides(
      slides.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      record
    );

  const patchElement = (id: string, patch: Partial<SlideElement>, record = true) => {
    patchSlide(
      active,
      {
        elements: elements.map((item) =>
          item.id === id ? ({ ...item, ...patch } as SlideElement) : item
        ),
      },
      record
    );
  };

  const addElement = (element: SlideElement) => {
    patchSlide(active, { elements: [...elements, element] });
    setSelectedId(element.id);
  };

  const addText = () =>
    addElement({
      id: createId('el'),
      type: 'text',
      x: 160,
      y: 280,
      w: 960,
      h: 100,
      text: '双击右侧文本框编辑文字',
      fontSize: 40,
      color: '#1b1f24',
      bold: false,
      align: 'left',
    });

  const addShape = (type: 'rect' | 'ellipse' | 'triangle' | 'line') =>
    addElement({
      id: createId('el'),
      type,
      x: 420,
      y: type === 'line' ? 360 : 240,
      w: 440,
      h: type === 'line' ? 4 : 240,
      fill: '#3370ff',
      radius: 16,
    } as SlideShapeElement);

  const addImageUrl = (src: string) =>
    addElement({
      id: createId('el'),
      type: 'image',
      x: 340,
      y: 200,
      w: 600,
      h: 337,
      src,
    });

  const removeElement = (id: string) => {
    patchSlide(active, { elements: elements.filter((item) => item.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateElement = (id: string) => {
    const source = elements.find((item) => item.id === id);
    if (!source) return;
    const copy = { ...source, id: createId('el'), x: source.x + 24, y: source.y + 24 };
    patchSlide(active, { elements: [...elements, copy] });
    setSelectedId(copy.id);
  };

  const moveElement = (id: string, direction: 1 | -1) => {
    const index = elements.findIndex((item) => item.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= elements.length) return;
    const copy = [...elements];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    patchSlide(active, { elements: copy });
  };

  /** 元素对齐到幻灯片画布 */
  const alignElement = (
    id: string,
    axis: 'left' | 'centerX' | 'right' | 'top' | 'middle' | 'bottom'
  ) => {
    const element = elements.find((item) => item.id === id);
    if (!element) return;
    const offsets = {
      left: { x: 0 },
      centerX: { x: Math.round((SLIDE_WIDTH - element.w) / 2) },
      right: { x: SLIDE_WIDTH - element.w },
      top: { y: 0 },
      middle: { y: Math.round((SLIDE_HEIGHT - element.h) / 2) },
      bottom: { y: SLIDE_HEIGHT - element.h },
    } as const;
    patchElement(id, offsets[axis] as never);
  };

  const moveSlide = (direction: 1 | -1) => {
    const next = active + direction;
    if (next < 0 || next >= slides.length) return;
    const copy = [...slides];
    [copy[active], copy[next]] = [copy[next], copy[active]];
    updateSlides(copy);
    setActive(next);
  };

  const addSlide = () => {
    const next: PptSlide = {
      id: createId('slide'),
      background: '#ffffff',
      elements: [
        {
          id: createId('el'),
          type: 'text',
          x: 140,
          y: 300,
          w: 1000,
          h: 100,
          text: '新页面',
          fontSize: 56,
          color: '#1b1f24',
          bold: true,
          align: 'center',
        },
      ],
    };
    updateSlides([...slides, next]);
    setActive(slides.length);
    setSelectedId(null);
  };

  const duplicateSlide = () => {
    const source = slides[active];
    if (!source) return;
    const copy: PptSlide = {
      ...source,
      id: createId('slide'),
      elements: (source.elements ?? []).map((item) => ({ ...item, id: createId('el') })),
    };
    updateSlides([...slides.slice(0, active + 1), copy, ...slides.slice(active + 1)]);
    setActive(active + 1);
  };

  const removeSlide = () => {
    if (slides.length <= 1) return;
    updateSlides(slides.filter((_, i) => i !== active));
    setActive(Math.max(0, active - 1));
    setSelectedId(null);
  };

  const onPointerDown = (event: React.PointerEvent, element: SlideElement, mode: 'move' | 'resize') => {
    if (!canWrite) return;
    event.stopPropagation();
    setSelectedId(element.id);
    pushHistory();
    dragRef.current = {
      id: element.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...element },
    };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  // 拖拽用 rAF 节流：pointermove 频率可达 120Hz，每次都推一次内容
  // 会让整个幻灯片栏跟着重渲染，表现就是拖动时卡住。
  const rafRef = useRef<number | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);

  const applyPointerMove = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (clientX - drag.startX) / scale;
    const dy = (clientY - drag.startY) / scale;
    if (drag.mode === 'move') {
      let nextX = Math.round(drag.origin.x + dx);
      let nextY = Math.round(drag.origin.y + dy);
      let guideV: number | null = null;
      let guideH: number | null = null;

      // 吸附到画布左/中/右、上/中/下（阈值 6px），并显示参考线
      const snapX = [0, Math.round((SLIDE_WIDTH - drag.origin.w) / 2), SLIDE_WIDTH - drag.origin.w];
      const snapY = [0, Math.round((SLIDE_HEIGHT - drag.origin.h) / 2), SLIDE_HEIGHT - drag.origin.h];
      for (const target of snapX) {
        if (Math.abs(nextX - target) <= 6) {
          nextX = target;
          guideV = target + drag.origin.w / 2;
          break;
        }
      }
      for (const target of snapY) {
        if (Math.abs(nextY - target) <= 6) {
          nextY = target;
          guideH = target + drag.origin.h / 2;
          break;
        }
      }
      setGuides({ v: guideV, h: guideH });
      patchElement(drag.id, { x: nextX, y: nextY }, false);
    } else {
      patchElement(
        drag.id,
        { w: Math.max(40, Math.round(drag.origin.w + dx)), h: Math.max(30, Math.round(drag.origin.h + dy)) },
        false
      );
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    latestPointerRef.current = { x: event.clientX, y: event.clientY };
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const point = latestPointerRef.current;
      if (point) applyPointerMove(point.x, point.y);
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setGuides({ v: null, h: null });
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const selected = elements.find((item) => item.id === selectedId) ?? null;

  const renderElement = (element: SlideElement) => {
    if (element.type === 'text') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            color: element.color,
            fontSize: element.fontSize * scale,
            fontWeight: element.bold ? 700 : 400,
            textAlign: element.align,
            lineHeight: 1.35,
            whiteSpace: 'pre-wrap',
            pointerEvents: 'none',
          }}
        >
          {element.text}
        </div>
      );
    }
    if (element.type === 'image') {
      return (
        <img
          src={element.src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
        />
      );
    }
    if (element.type === 'triangle') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: element.fill,
            clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
            pointerEvents: 'none',
          }}
        />
      );
    }
    if (element.type === 'line') {
      return (
        <div
          style={{ width: '100%', height: '100%', background: element.fill, pointerEvents: 'none' }}
        />
      );
    }
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: element.fill,
          borderRadius: element.type === 'rect' ? (element.radius ?? 0) * scale : '50%',
          pointerEvents: 'none',
        }}
      />
    );
  };

  if (!slide) return <div className={styles.hint}>没有幻灯片</div>;

  const presentSlide = slides[Math.min(presentIndex, slides.length - 1)];

  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <div className={styles.topbarGroup}>
          <button type="button" className={styles.topbarButton} disabled={!canWrite} onClick={addText}>
            文本
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => addShape('rect')}
          >
            矩形
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => addShape('ellipse')}
          >
            圆形
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => addShape('triangle')}
          >
            三角
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => addShape('line')}
          >
            线条
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => setPickerOpen(true)}
          >
            图片
          </button>
        </div>

        <span className={styles.topbarDivider} />

        <div className={styles.topbarGroup}>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite || !selected}
            onClick={() => selected && moveElement(selected.id, 1)}
          >
            上移一层
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite || !selected}
            onClick={() => selected && moveElement(selected.id, -1)}
          >
            下移一层
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite || !selected}
            onClick={() => selected && duplicateElement(selected.id)}
          >
            复制
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite || !selected}
            onClick={() => selected && removeElement(selected.id)}
          >
            删除
          </button>
        </div>

        <span className={styles.topbarDivider} />

        <div className={styles.topbarGroup}>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite || !selected}
            onClick={() => selected && alignElement(selected.id, 'centerX')}
          >
            水平居中
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite || !selected}
            onClick={() => selected && alignElement(selected.id, 'middle')}
          >
            垂直居中
          </button>
        </div>

        <span className={styles.topbarDivider} />

        <div className={styles.topbarGroup}>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={historyRef.current.length === 0}
            onClick={undo}
          >
            撤销
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={futureRef.current.length === 0}
            onClick={redo}
          >
            重做
          </button>
        </div>

        <span style={{ flex: 1 }} />

        <button
          type="button"
          className={styles.topbarButton}
          onClick={() => {
            setPresentIndex(active);
            setPresenting(true);
          }}
        >
          放映
        </button>
      </div>

      <div className={styles.body}>
      <div className={styles.rail}>
        {slides.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.railItem} ${index === active ? styles.railItemActive : ''}`}
            onClick={() => {
              setActive(index);
              setSelectedId(null);
            }}
          >
            <span className={styles.railIndex}>{index + 1}</span>
            <div className={styles.railThumb} style={{ background: item.background ?? '#fff' }}>
              <MemoSlidePreview slide={item} />
            </div>
          </button>
        ))}
        {canWrite ? (
          <button type="button" className={styles.railAdd} onClick={addSlide}>
            + 新建页面
          </button>
        ) : null}
      </div>

      <div className={styles.stage} ref={stageRef} onClick={() => setSelectedId(null)}>
        <div
          className={styles.canvas}
          style={{
            width: SLIDE_WIDTH * scale,
            height: SLIDE_HEIGHT * scale,
            background: slide.background ?? '#ffffff',
          }}
        >
          {elements.map((element) => (
            <div
              key={element.id}
              className={`${styles.element} ${selectedId === element.id ? styles.elementActive : ''}`}
              style={{
                left: element.x * scale,
                top: element.y * scale,
                width: element.w * scale,
                height: element.h * scale,
              }}
              onPointerDown={(event) => onPointerDown(event, element, 'move')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedId(element.id);
              }}
            >
              {renderElement(element)}
              {canWrite && selectedId === element.id ? (
                <span
                  className={styles.handle}
                  onPointerDown={(event) => onPointerDown(event, element, 'resize')}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              ) : null}
            </div>
          ))}

          {guides.v !== null ? (
            <span className={styles.guideV} style={{ left: guides.v * scale }} />
          ) : null}
          {guides.h !== null ? (
            <span className={styles.guideH} style={{ top: guides.h * scale }} />
          ) : null}
        </div>
      </div>

      <aside className={styles.props}>
        {canWrite ? (
          <>
            <div className={styles.propActions} style={{ marginBottom: 12 }}>
              <button type="button" className={styles.propButton} onClick={addText}>
                文字
              </button>
              <button type="button" className={styles.propButton} onClick={() => addShape('rect')}>
                矩形
              </button>
              <button type="button" className={styles.propButton} onClick={() => addShape('ellipse')}>
                圆形
              </button>
              <button type="button" className={styles.propButton} onClick={() => setPickerOpen(true)}>
                图片
              </button>
            </div>

            <div className={styles.propField}>
              <span>背景色</span>
              <input
                className={styles.propInput}
                type="color"
                value={slide.background ?? '#ffffff'}
                onChange={(event) => patchSlide(active, { background: event.target.value })}
              />
            </div>
          </>
        ) : null}

        {selected ? (
          <>
            <div className={styles.propField}>
              <span>位置与大小</span>
              <div className={styles.propRow}>
                {(['x', 'y', 'w', 'h'] as const).map((key) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12 }}>{key.toUpperCase()}</span>
                    <input
                      className={styles.propInput}
                      type="number"
                      value={Math.round(selected[key])}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, { [key]: Number(event.target.value) } as never)
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            {canWrite ? (
              <div className={styles.propField}>
                <span>对齐画布</span>
                <div className={styles.propActions}>
                  {(
                    [
                      ['left', '左'],
                      ['centerX', '横中'],
                      ['right', '右'],
                      ['top', '上'],
                      ['middle', '纵中'],
                      ['bottom', '下'],
                    ] as const
                  ).map(([axis, label]) => (
                    <button
                      key={axis}
                      type="button"
                      className={styles.propButton}
                      onClick={() => alignElement(selected.id, axis)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {selected.type === 'text' ? (
              <>
                <div className={styles.propField}>
                  <span>文字</span>
                  <textarea
                    className={styles.propInput}
                    style={{ minHeight: 84, resize: 'vertical' }}
                    value={selected.text}
                    disabled={!canWrite}
                    onChange={(event) => patchElement(selected.id, { text: event.target.value } as never)}
                  />
                </div>
                <div className={styles.propField}>
                  <span>字号 / 颜色</span>
                  <div className={styles.propRow}>
                    <input
                      className={styles.propInput}
                      type="number"
                      value={selected.fontSize}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, { fontSize: Number(event.target.value) } as never)
                      }
                    />
                    <input
                      className={styles.propInput}
                      type="color"
                      value={selected.color}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, { color: event.target.value } as never)
                      }
                    />
                  </div>
                </div>
                <div className={styles.propActions}>
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <button
                      key={align}
                      type="button"
                      className={styles.propButton}
                      onClick={() => patchElement(selected.id, { align } as never)}
                    >
                      {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.propButton}
                    onClick={() => patchElement(selected.id, { bold: !selected.bold } as never)}
                  >
                    {selected.bold ? '取消加粗' : '加粗'}
                  </button>
                </div>
              </>
            ) : null}

            {selected.type === 'rect' || selected.type === 'ellipse' ? (
              <div className={styles.propField}>
                <span>填充色</span>
                <input
                  className={styles.propInput}
                  type="color"
                  value={selected.fill}
                  disabled={!canWrite}
                  onChange={(event) => patchElement(selected.id, { fill: event.target.value } as never)}
                />
              </div>
            ) : null}

            {canWrite ? (
              <div className={styles.propActions}>
                <button
                  type="button"
                  className={styles.propButton}
                  onClick={() => moveElement(selected.id, -1)}
                >
                  下移
                </button>
                <button
                  type="button"
                  className={styles.propButton}
                  onClick={() => moveElement(selected.id, 1)}
                >
                  上移
                </button>
                <button
                  type="button"
                  className={styles.propButton}
                  onClick={() => duplicateElement(selected.id)}
                >
                  复制
                </button>
                <button
                  type="button"
                  className={`${styles.propButton} ${styles.propButtonDanger}`}
                  onClick={() => removeElement(selected.id)}
                >
                  删除
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className={styles.hint}>选中画布中的元素后可调整位置与样式。</p>
        )}

        <div className={styles.propActions} style={{ marginTop: 14 }}>
          <button
            type="button"
            className={styles.propButton}
            onClick={() => {
              setPresentIndex(active);
              setPresenting(true);
            }}
          >
            放映
          </button>
          {canWrite ? (
            <>
              <button type="button" className={styles.propButton} onClick={() => moveSlide(-1)}>
                上移页
              </button>
              <button type="button" className={styles.propButton} onClick={() => moveSlide(1)}>
                下移页
              </button>
              <button type="button" className={styles.propButton} onClick={duplicateSlide}>
                复制页
              </button>
              <button
                type="button"
                className={`${styles.propButton} ${styles.propButtonDanger}`}
                onClick={removeSlide}
              >
                删除页
              </button>
            </>
          ) : null}
        </div>
      </aside>
      </div>

      {presenting ? (
        <div
          className={styles.present}
          onClick={() => setPresentIndex((index) => Math.min(slides.length - 1, index + 1))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setPresenting(false);
          }}
          tabIndex={-1}
          ref={(node) => node?.focus()}
        >
          <div
            className={styles.presentSlide}
            style={{ background: presentSlide.background ?? '#fff' }}
          >
            {(presentSlide.elements ?? []).map((element) => (
              <div
                key={element.id}
                style={{
                  position: 'absolute',
                  left: `${(element.x / SLIDE_WIDTH) * 100}%`,
                  top: `${(element.y / SLIDE_HEIGHT) * 100}%`,
                  width: `${(element.w / SLIDE_WIDTH) * 100}%`,
                  height: `${(element.h / SLIDE_HEIGHT) * 100}%`,
                }}
              >
                {renderElement({ ...element, x: 0, y: 0, w: 0, h: 0 } as SlideElement)}
              </div>
            ))}
          </div>
          <div className={styles.presentBar}>
            <span>
              {presentIndex + 1} / {slides.length}
            </span>
            <button
              type="button"
              className={styles.propButton}
              onClick={(event) => {
                event.stopPropagation();
                setPresenting(false);
              }}
            >
              退出
            </button>
          </div>
        </div>
      ) : null}

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(asset) => addImageUrl(asset.url)}
        documentId={documentId}
      />
    </div>
  );
}

/** 缩略图：用与原画布相同的比例渲染。memo 避免拖动某个元素时全部缩略图重渲染 */
const MemoSlidePreview = memo(SlidePreview);

function SlidePreview({ slide }: { slide: PptSlide }) {
  const elements = slide.elements ?? [];
  return (
    <>
      {elements.map((element) => (
        <div
          key={element.id}
          style={{
            position: 'absolute',
            left: `${(element.x / SLIDE_WIDTH) * 100}%`,
            top: `${(element.y / SLIDE_HEIGHT) * 100}%`,
            width: `${(element.w / SLIDE_WIDTH) * 100}%`,
            height: `${(element.h / SLIDE_HEIGHT) * 100}%`,
            overflow: 'hidden',
          }}
        >
          {element.type === 'text' ? (
            <span
              style={{
                display: 'block',
                fontSize: 6,
                color: element.color,
                textAlign: element.align,
                fontWeight: element.bold ? 700 : 400,
                lineHeight: 1.2,
              }}
            >
              {element.text}
            </span>
          ) : element.type === 'image' ? (
            <img src={element.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                background: element.fill,
                borderRadius: element.type === 'rect' || element.type === 'line' ? 2 : '50%',
                clipPath:
                  element.type === 'triangle'
                    ? 'polygon(50% 0%, 100% 100%, 0% 100%)'
                    : undefined,
              }}
            />
          )}
        </div>
      ))}
    </>
  );
}
