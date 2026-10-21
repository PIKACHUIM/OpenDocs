import { confirmDialog, promptDialog } from '../../ui/dialog';
import { memo, useEffect, useRef, useState } from 'react';
import {
  createId,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type PptContent,
  type PptSlide,
  type SlideChartElement,
  type SlideChartType,
  type SlideElement,
  type SlideIframeElement,
  type SlideLatexElement,
  type SlideShapeElement,
  type SlideShapeKind,
  type SlideAnimationType,
  type SlideTextElement,
  type SlideTransitionType,
} from '../../api';
import { AssetPicker } from '../../ui/AssetPicker';
import {
  AudioView,
  ChartView,
  IframeView,
  LatexView,
  ShapeView,
  VideoView,
  imageFilterOf,
} from './PptElements';
import styles from './ppt.module.scss';

export interface PptEditorProps {
  content: PptContent;
  canWrite: boolean;
  documentId: string | null;
  onChange: (content: PptContent) => void;
}

/**
 * 画布内的可编辑文本。
 * 进入编辑时必须主动 focus 并全选，否则双击只切换了 contentEditable 属性，
 * 焦点仍在外层元素上，键入不会进入文本框。
 */
function EditableText({
  element,
  scale,
  editing,
  onCommit,
}: {
  element: SlideTextElement;
  scale: number;
  editing: boolean;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!editing || !node) return;
    node.innerText = element.text;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // 只在进入编辑态时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const body = element.bullet
    ? element.text
        .split('\n')
        .map((line) => (line.trim() ? `• ${line}` : line))
        .join('\n')
    : element.text;

  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    color: element.color,
    fontSize: element.fontSize * scale,
    fontWeight: element.bold ? 700 : 400,
    textAlign: element.align,
    lineHeight: element.lineHeight ?? 1.35,
    padding: (element.padding ?? 0) * scale,
    boxSizing: 'border-box',
    whiteSpace: 'pre-wrap',
    outline: editing ? '2px solid #3370ff' : 'none',
    cursor: editing ? 'text' : 'default',
    pointerEvents: editing ? 'auto' : 'none',
  };

  if (!editing) {
    return (
      <div style={style} suppressContentEditableWarning>
        {body}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={style}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(event) => onCommit(event.currentTarget.innerText)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') event.currentTarget.blur();
      }}
    />
  );
}

/**
 * 元素进入动画的 keyframes。
 * 用全局样式而不是 CSS Modules：动画名需要稳定，避免被哈希后无法在 inline style 里引用。
 */
const ANIMATION_CSS = `
@keyframes opd-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes opd-fly-left { from { opacity: 0; transform: translateX(-80px) } to { opacity: 1; transform: none } }
@keyframes opd-fly-right { from { opacity: 0; transform: translateX(80px) } to { opacity: 1; transform: none } }
@keyframes opd-fly-top { from { opacity: 0; transform: translateY(-80px) } to { opacity: 1; transform: none } }
@keyframes opd-fly-bottom { from { opacity: 0; transform: translateY(80px) } to { opacity: 1; transform: none } }
@keyframes opd-zoom-in { from { opacity: 0; transform: scale(0.6) } to { opacity: 1; transform: none } }
@keyframes opd-wipe-in { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
`;

const ANIMATION_LABEL: Record<SlideAnimationType, string> = {
  none: '无',
  fadeIn: '淡入',
  flyInLeft: '从左飞入',
  flyInRight: '从右飞入',
  flyInTop: '从上飞入',
  flyInBottom: '从下飞入',
  zoomIn: '放大',
  wipeIn: '擦除',
};

const ANIMATION_NAME: Record<Exclude<SlideAnimationType, 'none'>, string> = {
  fadeIn: 'opd-fade-in',
  flyInLeft: 'opd-fly-left',
  flyInRight: 'opd-fly-right',
  flyInTop: 'opd-fly-top',
  flyInBottom: 'opd-fly-bottom',
  zoomIn: 'opd-zoom-in',
  wipeIn: 'opd-wipe-in',
};

/** 把元素动画配置转成 inline style；未配置或 none 时返回空对象 */
function animationStyle(animation?: {
  type: SlideAnimationType;
  duration: number;
  delay: number;
}): React.CSSProperties {
  if (!animation || animation.type === 'none') return {};
  const name = ANIMATION_NAME[animation.type];
  if (!name) return {};
  return { animation: `${name} ${animation.duration}ms ease ${animation.delay}ms both` };
}

/** 形状类型守卫：属性面板里需要对联合类型做收窄 */
const SHAPE_KINDS = [
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'diamond',
  'pentagon',
  'chevron',
  'star',
  'line',
] as const;

function isShapeElement(element: SlideElement): element is SlideShapeElement {
  return (SHAPE_KINDS as readonly string[]).includes(element.type);
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
  // 多选：selectedIds 是真实状态，selectedId 只是「主选中项」的派生值，
  // 这样属性面板等既有代码不用改。
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds[0] ?? null;
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const [scale, setScale] = useState(0.5);
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  /** 正在画布内直接编辑的文本元素 */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 放映：黑屏 / 备注开关 */
  const [blackout, setBlackout] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  /** 画布内预览动画：tick 变化触发元素重新挂载，动画才会重播 */
  const [previewTick, setPreviewTick] = useState(0);
  const [previewing, setPreviewing] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: SlideElement;
    /** 成组移动时记录所有被拖元素的初始位置 */
    origins: Array<{ id: string; x: number; y: number }>;
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
    // 只监听 window resize 不够：右侧属性面板、左侧幻灯片栏的宽度变化
    // 都会改变可用区域，用 ResizeObserver 才能在布局稳定后重算，避免画布被裁掉
    const host = stageRef.current;
    const observer = host ? new ResizeObserver(calc) : null;
    if (host && observer) observer.observe(host);
    window.addEventListener('resize', calc);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', calc);
    };
  }, []);

  // 放映：监听全局键盘并进入全屏。放在 window 上而不是容器上，
  // 避免焦点被内部元素抢走后快捷键失效。
  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
      const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp'];
      if (event.key === 'Escape') {
        event.preventDefault();
        setPresenting(false);
        return;
      }
      if (nextKeys.includes(event.key)) {
        event.preventDefault();
        setPresentIndex((index) => Math.min(slides.length - 1, index + 1));
        return;
      }
      if (prevKeys.includes(event.key)) {
        event.preventDefault();
        setPresentIndex((index) => Math.max(0, index - 1));
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'b') setBlackout((value) => !value);
      if (key === 'n') setShowNotes((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    // 能进全屏就进；被浏览器拒绝（如缺少用户手势）时保持窗口内放映
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      window.removeEventListener('keydown', onKey);
      setBlackout(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, [presenting, slides.length]);

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
      text: '双击直接编辑文字',
      fontSize: 40,
      color: theme.fontColor,
      bold: false,
      align: 'left',
    });

  const addShape = (type: SlideShapeKind) =>
    addElement({
      id: createId('el'),
      type,
      x: 420,
      y: type === 'line' ? 360 : 240,
      w: 440,
      h: type === 'line' ? 4 : 240,
      fill: primary,
      radius: type === 'roundRect' ? 24 : 16,
      lineWidth: type === 'line' ? 4 : 0,
      lineColor: type === 'line' ? primary : undefined,
    } as SlideShapeElement);

  const addChart = (chartType: SlideChartType = 'column') =>
    addElement({
      id: createId('el'),
      type: 'chart',
      x: 200,
      y: 160,
      w: 760,
      h: 420,
      chartType,
      data: {
        labels: ['一月', '二月', '三月', '四月'],
        series: [
          { name: '系列 1', values: [32, 58, 41, 73] },
          { name: '系列 2', values: [21, 34, 52, 38] },
        ],
      },
      themeColors: theme.themeColors,
      showLegend: true,
      showValue: false,
      title: '图表标题',
    } as SlideChartElement);

  const addLatex = () =>
    addElement({
      id: createId('el'),
      type: 'latex',
      x: 340,
      y: 280,
      w: 600,
      h: 120,
      latex: 'E = mc^2',
      fontSize: 40,
      color: '#1b1f24',
    } as SlideLatexElement);

  const addIframe = () =>
    addElement({
      id: createId('el'),
      type: 'iframe',
      x: 240,
      y: 160,
      w: 800,
      h: 450,
      src: 'https://example.com',
    } as SlideIframeElement);

  const addMedia = (kind: 'video' | 'audio', src: string) =>
    addElement(
      kind === 'video'
        ? {
            id: createId('el'),
            type: 'video',
            x: 240,
            y: 120,
            w: 800,
            h: 450,
            src,
            autoplay: false,
          }
        : ({
            id: createId('el'),
            type: 'audio',
            x: 240,
            y: 300,
            w: 800,
            h: 80,
            src,
            name: '音频',
            autoplay: false,
          } as SlideElement)
    );

  const addTable = () =>
    addElement({
      id: createId('el'),
      type: 'table',
      x: 200,
      y: 200,
      w: 880,
      h: 320,
      rows: [
        ['表头 1', '表头 2', '表头 3'],
        ['', '', ''],
        ['', '', ''],
      ],
      fontSize: 24,
      color: '#1b1f24',
      headerFill: '#eef3ff',
      borderColor: '#d5d8de',
    } as SlideElement);

  /** 按版式新建页面：标题页 / 标题+内容 / 两栏 / 空白 */
  const addSlideLayout = (kind: 'title' | 'titleBody' | 'twoColumn' | 'blank') => {
    const text = (
      partial: Partial<SlideTextElement> & Pick<SlideTextElement, 'x' | 'y' | 'w' | 'h' | 'text'>
    ): SlideTextElement => ({
      id: createId('el'),
      type: 'text',
      fontSize: 28,
      color: theme.fontColor,
      bold: false,
      align: 'left',
      ...partial,
    });

    const elements: SlideElement[] = [];
    if (kind === 'title') {
      elements.push(
        text({
          x: 140,
          y: 270,
          w: 1000,
          h: 120,
          text: '标题',
          fontSize: 64,
          bold: true,
          align: 'center',
        }),
        text({
          x: 140,
          y: 400,
          w: 1000,
          h: 70,
          text: '副标题',
          fontSize: 28,
          align: 'center',
          color: '#86909c',
        })
      );
    } else if (kind === 'titleBody') {
      elements.push(
        text({ x: 100, y: 80, w: 1080, h: 90, text: '标题', fontSize: 44, bold: true }),
        text({
          x: 100,
          y: 200,
          w: 1080,
          h: 420,
          text: '要点一\n要点二\n要点三',
          fontSize: 28,
          bullet: true,
          lineHeight: 1.6,
        })
      );
    } else if (kind === 'twoColumn') {
      elements.push(
        text({ x: 100, y: 80, w: 1080, h: 90, text: '标题', fontSize: 44, bold: true }),
        text({
          x: 100,
          y: 200,
          w: 520,
          h: 420,
          text: '左栏内容',
          fontSize: 26,
          bullet: true,
          lineHeight: 1.6,
        }),
        text({
          x: 660,
          y: 200,
          w: 520,
          h: 420,
          text: '右栏内容',
          fontSize: 26,
          bullet: true,
          lineHeight: 1.6,
        })
      );
    }

    pushHistory();
    onChange({
      ...content,
      slides: [
        ...slides,
        { id: createId('slide'), background: theme.backgroundColor, elements },
      ],
    });
    setActive(slides.length);
    setSelectedId(null);
  };

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
    setSelectedIds((previous) => previous.filter((item) => item !== id));
  };

  /** 删除所有选中元素 */
  const removeSelected = () => {
    if (selectedIds.length === 0) return;
    patchSlide(active, { elements: elements.filter((item) => !selectedIds.includes(item.id)) });
    setSelectedIds([]);
  };

  /** 对齐所有选中元素 */
  const alignSelected = (
    axis: 'left' | 'centerX' | 'right' | 'top' | 'middle' | 'bottom'
  ) => {
    if (selectedIds.length === 0) return;
    pushHistory();
    onChange({
      ...content,
      slides: slides.map((item, index) => {
        if (index !== active) return item;
        return {
          ...item,
          elements: (item.elements ?? []).map((element) => {
            if (!selectedIds.includes(element.id)) return element;
            const offsets = {
              left: { x: 0 },
              centerX: { x: Math.round((SLIDE_WIDTH - element.w) / 2) },
              right: { x: SLIDE_WIDTH - element.w },
              top: { y: 0 },
              middle: { y: Math.round((SLIDE_HEIGHT - element.h) / 2) },
              bottom: { y: SLIDE_HEIGHT - element.h },
            } as const;
            return { ...element, ...offsets[axis] };
          }),
        };
      }),
    });
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
    // 正在编辑这段文字时，不启动拖拽：否则光标会被打断，输入内容会丢
    if (editingId === element.id) return;
    event.stopPropagation();

    // Shift 点击 = 加入/移出选区；未按 Shift 且点在选区外 = 单选
    let nextSelection = selectedIds;
    if (mode === 'move' && event.shiftKey) {
      nextSelection = selectedIds.includes(element.id)
        ? selectedIds.filter((id) => id !== element.id)
        : [...selectedIds, element.id];
      setSelectedIds(nextSelection);
    } else if (!selectedIds.includes(element.id)) {
      nextSelection = [element.id];
      setSelectedIds(nextSelection);
    }

    pushHistory();
    const groupIds = nextSelection.includes(element.id) ? nextSelection : [element.id];
    dragRef.current = {
      id: element.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...element },
      origins: elements
        .filter((item) => groupIds.includes(item.id))
        .map((item) => ({ id: item.id, x: item.x, y: item.y })),
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

      const deltaX = nextX - drag.origin.x;
      const deltaY = nextY - drag.origin.y;
      if (drag.origins.length > 1) {
        // 成组移动：一次性提交，避免每个元素各触发一次保存
        const originMap = new Map(drag.origins.map((item) => [item.id, item]));
        patchSlide(
          active,
          {
            elements: elements.map((item) => {
              const origin = originMap.get(item.id);
              return origin ? { ...item, x: origin.x + deltaX, y: origin.y + deltaY } : item;
            }),
          },
          false
        );
      } else {
        patchElement(drag.id, { x: nextX, y: nextY }, false);
      }
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

  /** 本页已设置进入动画的元素 */
  const animatedElements = elements.filter(
    (item) => item.animation && item.animation.type !== 'none'
  );

  /** 在画布内预览动画：重挂载元素以重播 */
  const playPreview = () => {
    setPreviewing(false);
    setPreviewTick((tick) => tick + 1);
    window.requestAnimationFrame(() => setPreviewing(true));
    window.setTimeout(() => setPreviewing(false), 5000);
  };

  const clearAnimations = () => {
    pushHistory();
    patchSlide(active, {
      elements: elements.map((item) => ({ ...item, animation: undefined }) as SlideElement),
    });
  };

  /** 主题：未设置时给一套默认配色，新建元素据此取色 */
  const theme = content.theme ?? {
    themeColors: ['#3370ff', '#14c9c9', '#ff7d00', '#f53f3f', '#722ed1'],
    fontColor: '#1b1f24',
    fontName: 'PingFang SC',
    backgroundColor: '#ffffff',
  };
  const primary = theme.themeColors[0] ?? '#3370ff';

  const patchTheme = (patch: Partial<typeof theme>) =>
    onChange({ ...content, theme: { ...theme, ...patch } });

  const renderElement = (element: SlideElement) => {
    if (element.type === 'text') {
      return (
        <EditableText
          element={element}
          scale={scale}
          editing={editingId === element.id && canWrite}
          onCommit={(text) => {
            setEditingId(null);
            if (text !== element.text) patchElement(element.id, { text });
          }}
        />
      );
    }
    if (element.type === 'image') {
      return (
        <img
          src={element.src}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: element.objectFit ?? 'cover',
            borderRadius: (element.radius ?? 0) * scale,
            filter: imageFilterOf(element),
            pointerEvents: 'none',
          }}
        />
      );
    }
    if (element.type === 'table') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${element.borderColor}`,
            fontSize: element.fontSize * scale,
            color: element.color,
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}
        >
          {element.rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              style={{
                flex: 1,
                display: 'grid',
                gridTemplateColumns: `repeat(${row.length}, 1fr)`,
                borderBottom:
                  rowIndex < element.rows.length - 1 ? `1px solid ${element.borderColor}` : undefined,
              }}
            >
              {row.map((cell, cellIndex) => (
                <div
                  key={cellIndex}
                  style={{
                    padding: 4 * scale,
                    overflow: 'hidden',
                    background: rowIndex === 0 ? element.headerFill : 'transparent',
                    fontWeight: rowIndex === 0 ? 600 : 400,
                    borderRight:
                      cellIndex < row.length - 1 ? `1px solid ${element.borderColor}` : undefined,
                  }}
                >
                  {cell}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (element.type === 'chart') return <ChartView element={element} scale={scale} />;
    if (element.type === 'latex') return <LatexView element={element} scale={scale} />;
    if (element.type === 'video') return <VideoView element={element} />;
    if (element.type === 'audio') return <AudioView element={element} scale={scale} />;
    if (element.type === 'iframe') return <IframeView element={element} />;

    // 其余都是形状（含线条）
    return <ShapeView element={element} scale={scale} />;
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
            onClick={() => addShape('roundRect')}
          >
            圆角矩形
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => addShape('diamond')}
          >
            菱形
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => addShape('star')}
          >
            星形
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={addTable}
          >
            表格
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => addChart('column')}
          >
            图表
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={addLatex}
          >
            公式
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={addIframe}
          >
            网页
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => {
              void promptDialog('视频地址（mp4 直链，或 YouTube / Bilibili 链接）', {
                title: '插入视频',
                placeholder: 'https://…',
                confirmText: '插入',
              }).then((src) => {
                if (src) addMedia('video', src.trim());
              });
            }}
          >
            视频
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite}
            onClick={() => {
              void promptDialog('音频地址（mp3 直链）', {
                title: '插入音频',
                placeholder: 'https://…',
                confirmText: '插入',
              }).then((src) => {
                if (src) addMedia('audio', src.trim());
              });
            }}
          >
            音频
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
            disabled={!canWrite || selectedIds.length === 0}
            onClick={removeSelected}
          >
            删除
          </button>
        </div>

        <span className={styles.topbarDivider} />

        <div className={styles.topbarGroup}>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite || selectedIds.length === 0}
            onClick={() => alignSelected('centerX')}
          >
            水平居中
          </button>
          <button
            type="button"
            className={styles.topbarButton}
            disabled={!canWrite || selectedIds.length === 0}
            onClick={() => alignSelected('middle')}
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

      <div className={styles.stage} ref={stageRef}>
        <div
          className={styles.canvas}
          style={{
            width: SLIDE_WIDTH * scale,
            height: SLIDE_HEIGHT * scale,
            background: slide.background ?? '#ffffff',
          }}
          onPointerDown={(event) => {
            if (!canWrite || event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const x = (event.clientX - rect.left) / scale;
            const y = (event.clientY - rect.top) / scale;
            setSelectedIds([]);
            setMarquee({ x0: x, y0: y, x1: x, y1: y });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!marquee) return;
            const rect = event.currentTarget.getBoundingClientRect();
            setMarquee({
              ...marquee,
              x1: (event.clientX - rect.left) / scale,
              y1: (event.clientY - rect.top) / scale,
            });
          }}
          onPointerUp={() => {
            if (!marquee) return;
            const left = Math.min(marquee.x0, marquee.x1);
            const right = Math.max(marquee.x0, marquee.x1);
            const top = Math.min(marquee.y0, marquee.y1);
            const bottom = Math.max(marquee.y0, marquee.y1);
            if (right - left > 4 && bottom - top > 4) {
              setSelectedIds(
                elements
                  .filter(
                    (item) =>
                      item.x < right &&
                      item.x + item.w > left &&
                      item.y < bottom &&
                      item.y + item.h > top
                  )
                  .map((item) => item.id)
              );
            }
            setMarquee(null);
          }}
        >
          {elements.map((element) => (
            <div
              key={previewing ? `${element.id}-p${previewTick}` : element.id}
              className={`${styles.element} ${
                selectedIds.includes(element.id) ? styles.elementActive : ''
              }`}
              style={{
                left: element.x * scale,
                top: element.y * scale,
                width: element.w * scale,
                height: element.h * scale,
                ...(previewing ? animationStyle(element.animation) : {}),
              }}
              onPointerDown={(event) => onPointerDown(event, element, 'move')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedId(element.id);
              }}
              onDoubleClick={(event) => {
                // 双击文本进入画布内编辑，与其他演示软件一致
                if (element.type !== 'text' || !canWrite) return;
                event.stopPropagation();
                setEditingId(element.id);
              }}
            >
              {renderElement(element)}
              {canWrite && selectedIds.length === 1 && selectedIds[0] === element.id ? (
                <span
                  className={styles.handle}
                  onPointerDown={(event) => onPointerDown(event, element, 'resize')}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              ) : null}
            </div>
          ))}

          {marquee ? (
            <span
              className={styles.marquee}
              style={{
                left: Math.min(marquee.x0, marquee.x1) * scale,
                top: Math.min(marquee.y0, marquee.y1) * scale,
                width: Math.abs(marquee.x1 - marquee.x0) * scale,
                height: Math.abs(marquee.y1 - marquee.y0) * scale,
              }}
            />
          ) : null}

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
                value={slide.background ?? theme.backgroundColor}
                onChange={(event) => patchSlide(active, { background: event.target.value })}
              />
            </div>

            {/* 母版主题：新建文字/形状/图表都从这里取色，保证整册一致 */}
            <div className={styles.propField}>
              <span>主题色（新建元素取色）</span>
              <div className={styles.propActions}>
                {theme.themeColors.map((color, index) => (
                  <input
                    key={index}
                    className={styles.propInput}
                    type="color"
                    value={color}
                    disabled={!canWrite}
                    style={{ width: 34, padding: 0 }}
                    onChange={(event) => {
                      const next = [...theme.themeColors];
                      next[index] = event.target.value;
                      patchTheme({ themeColors: next });
                    }}
                  />
                ))}
              </div>
            </div>

            <div className={styles.propField}>
              <span>正文字色 / 默认底色</span>
              <div className={styles.propRow}>
                <input
                  className={styles.propInput}
                  type="color"
                  value={theme.fontColor}
                  disabled={!canWrite}
                  onChange={(event) => patchTheme({ fontColor: event.target.value })}
                />
                <input
                  className={styles.propInput}
                  type="color"
                  value={theme.backgroundColor}
                  disabled={!canWrite}
                  onChange={(event) => patchTheme({ backgroundColor: event.target.value })}
                />
              </div>
            </div>

            <div className={styles.propField}>
              <span>把主题应用到全部页面</span>
              <button
                type="button"
                className={styles.propButton}
                disabled={!canWrite}
                onClick={() => {
                  void confirmDialog('将当前主题底色应用到所有页面？', {
                    title: '应用主题',
                    confirmText: '应用',
                  }).then((ok) => {
                    if (!ok) return;
                    pushHistory();
                    onChange({
                      ...content,
                      slides: slides.map((item) => ({
                        ...item,
                        background: item.background ?? theme.backgroundColor,
                      })),
                    });
                  });
                }}
              >
                应用主题
              </button>
            </div>

            <div className={styles.propField}>
              <span>新建页面（版式）</span>
              <div className={styles.propActions}>
                <button
                  type="button"
                  className={styles.propButton}
                  disabled={!canWrite}
                  onClick={() => addSlideLayout('title')}
                >
                  标题页
                </button>
                <button
                  type="button"
                  className={styles.propButton}
                  disabled={!canWrite}
                  onClick={() => addSlideLayout('titleBody')}
                >
                  标题+内容
                </button>
                <button
                  type="button"
                  className={styles.propButton}
                  disabled={!canWrite}
                  onClick={() => addSlideLayout('twoColumn')}
                >
                  两栏
                </button>
                <button
                  type="button"
                  className={styles.propButton}
                  disabled={!canWrite}
                  onClick={() => addSlideLayout('blank')}
                >
                  空白
                </button>
              </div>
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
                  <button
                    type="button"
                    className={styles.propButton}
                    onClick={() => patchElement(selected.id, { bullet: !selected.bullet } as never)}
                  >
                    {selected.bullet ? '取消项目符号' : '项目符号'}
                  </button>
                </div>

                <div className={styles.propField}>
                  <span>行高 / 内边距</span>
                  <div className={styles.propRow}>
                    <input
                      className={styles.propInput}
                      type="number"
                      step={0.05}
                      min={1}
                      max={3}
                      value={selected.lineHeight ?? 1.35}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, {
                          lineHeight: Number(event.target.value) || 1.35,
                        } as never)
                      }
                    />
                    <input
                      className={styles.propInput}
                      type="number"
                      min={0}
                      value={selected.padding ?? 0}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, {
                          padding: Number(event.target.value) || 0,
                        } as never)
                      }
                    />
                  </div>
                </div>
              </>
            ) : null}

            {selected.type === 'table' ? (
              <>
                <div className={styles.propField}>
                  <span>表格内容（每行一条，单元格用 | 分隔）</span>
                  <textarea
                    className={styles.propInput}
                    style={{ minHeight: 96, resize: 'vertical' }}
                    value={selected.rows.map((row) => row.join(' | ')).join('\n')}
                    disabled={!canWrite}
                    onChange={(event) => {
                      const rows = event.target.value
                        .split('\n')
                        .map((line) => line.split('|').map((cell) => cell.trim()));
                      patchElement(selected.id, { rows } as never);
                    }}
                  />
                </div>
                <div className={styles.propField}>
                  <span>字号 / 表头底色</span>
                  <div className={styles.propRow}>
                    <input
                      className={styles.propInput}
                      type="number"
                      min={8}
                      value={selected.fontSize}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, {
                          fontSize: Number(event.target.value) || 20,
                        } as never)
                      }
                    />
                    <input
                      className={styles.propInput}
                      type="color"
                      value={selected.headerFill}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, { headerFill: event.target.value } as never)
                      }
                    />
                  </div>
                </div>
              </>
            ) : null}

            {selected.type === 'chart' ? (
              <>
                <div className={styles.propField}>
                  <span>图表类型</span>
                  <select
                    className={styles.propInput}
                    value={selected.chartType}
                    disabled={!canWrite}
                    onChange={(event) =>
                      patchElement(selected.id, {
                        chartType: event.target.value as SlideChartType,
                      } as never)
                    }
                  >
                    {(
                      [
                        ['column', '柱状图'],
                        ['bar', '条形图'],
                        ['line', '折线图'],
                        ['area', '面积图'],
                        ['pie', '饼图'],
                        ['ring', '环形图'],
                        ['radar', '雷达图'],
                        ['scatter', '散点图'],
                      ] as const
                    ).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.propField}>
                  <span>标题</span>
                  <input
                    className={styles.propInput}
                    value={selected.title ?? ''}
                    disabled={!canWrite}
                    onChange={(event) =>
                      patchElement(selected.id, { title: event.target.value } as never)
                    }
                  />
                </div>
                <div className={styles.propField}>
                  <span>数据（首行为类别，每行一个系列：名称, 值1, 值2…）</span>
                  <textarea
                    className={styles.propInput}
                    style={{ minHeight: 96, resize: 'vertical' }}
                    disabled={!canWrite}
                    value={[
                      ['类别', ...selected.data.labels].join(', '),
                      ...selected.data.series.map((item) => [item.name, ...item.values].join(', ')),
                    ].join('\n')}
                    onChange={(event) => {
                      const lines = event.target.value
                        .split('\n')
                        .map((line) => line.split(',').map((cell) => cell.trim()))
                        .filter((line) => line.length > 0);
                      if (lines.length === 0) return;
                      const labels = lines[0].slice(1);
                      const series = lines.slice(1).map((line) => ({
                        name: line[0] || '系列',
                        values: line.slice(1).map((cell) => Number(cell) || 0),
                      }));
                      patchElement(selected.id, {
                        data: { labels, series: series.length ? series : [{ name: '系列 1', values: [] }] },
                      } as never);
                    }}
                  />
                </div>
                <div className={styles.propActions}>
                  <button
                    type="button"
                    className={styles.propButton}
                    onClick={() =>
                      patchElement(selected.id, { showLegend: !selected.showLegend } as never)
                    }
                  >
                    {selected.showLegend ? '隐藏图例' : '显示图例'}
                  </button>
                  <button
                    type="button"
                    className={styles.propButton}
                    onClick={() =>
                      patchElement(selected.id, { showValue: !selected.showValue } as never)
                    }
                  >
                    {selected.showValue ? '隐藏数值' : '显示数值'}
                  </button>
                </div>
              </>
            ) : null}

            {selected.type === 'latex' ? (
              <>
                <div className={styles.propField}>
                  <span>公式内容（LaTeX）</span>
                  <textarea
                    className={styles.propInput}
                    style={{ minHeight: 72, resize: 'vertical', fontFamily: 'monospace' }}
                    value={selected.latex}
                    disabled={!canWrite}
                    onChange={(event) =>
                      patchElement(selected.id, { latex: event.target.value } as never)
                    }
                  />
                </div>
                <div className={styles.propField}>
                  <span>字号 / 颜色</span>
                  <div className={styles.propRow}>
                    <input
                      className={styles.propInput}
                      type="number"
                      min={10}
                      value={selected.fontSize}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, { fontSize: Number(event.target.value) || 32 } as never)
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
              </>
            ) : null}

            {selected.type === 'video' || selected.type === 'audio' || selected.type === 'iframe' ? (
              <div className={styles.propField}>
                <span>
                  {selected.type === 'video' ? '视频地址' : selected.type === 'audio' ? '音频地址' : '网页地址'}
                </span>
                <input
                  className={styles.propInput}
                  value={selected.src}
                  disabled={!canWrite}
                  placeholder="https://…"
                  onChange={(event) =>
                    patchElement(selected.id, { src: event.target.value } as never)
                  }
                />
              </div>
            ) : null}

            {selected.type === 'image' ? (
              <>
                <div className={styles.propField}>
                  <span>圆角 / 裁切</span>
                  <div className={styles.propRow}>
                    <input
                      className={styles.propInput}
                      type="number"
                      min={0}
                      value={selected.radius ?? 0}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, { radius: Number(event.target.value) || 0 } as never)
                      }
                    />
                    <select
                      className={styles.propInput}
                      value={selected.objectFit ?? 'cover'}
                      disabled={!canWrite}
                      onChange={(event) =>
                        patchElement(selected.id, { objectFit: event.target.value } as never)
                      }
                    >
                      <option value="cover">裁切填充</option>
                      <option value="contain">完整显示</option>
                      <option value="fill">拉伸</option>
                    </select>
                  </div>
                </div>
                {(
                  [
                    ['brightness', '亮度'],
                    ['contrast', '对比度'],
                    ['saturate', '饱和度'],
                  ] as const
                ).map(([key, label]) => (
                  <div className={styles.propField} key={key}>
                    <span>{label}</span>
                    <div className={styles.propRow}>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={(selected[key] as number | undefined) ?? 100}
                        disabled={!canWrite}
                        style={{ flex: 1 }}
                        onChange={(event) =>
                          patchElement(selected.id, { [key]: Number(event.target.value) } as never)
                        }
                      />
                      <span style={{ width: 40, textAlign: 'right', fontSize: 12 }}>
                        {(selected[key] as number | undefined) ?? 100}%
                      </span>
                    </div>
                  </div>
                ))}
              </>
            ) : null}

            {isShapeElement(selected) ? (
              <>
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
                {selected.type === 'line' ? (
                  <div className={styles.propField}>
                    <span>线宽 / 箭头</span>
                    <div className={styles.propRow}>
                      <input
                        className={styles.propInput}
                        type="number"
                        min={1}
                        max={40}
                        value={selected.lineWidth ?? 4}
                        disabled={!canWrite}
                        onChange={(event) =>
                          patchElement(selected.id, { lineWidth: Number(event.target.value) || 1 } as never)
                        }
                      />
                      <button
                        type="button"
                        className={styles.propButton}
                        onClick={() =>
                          patchElement(selected.id, { arrow: !selected.arrow } as never)
                        }
                      >
                        {selected.arrow ? '去掉箭头' : '加箭头'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.propField}>
                    <span>描边色 / 线宽</span>
                    <div className={styles.propRow}>
                      <input
                        className={styles.propInput}
                        type="color"
                        value={selected.lineColor ?? '#1b1f24'}
                        disabled={!canWrite}
                        onChange={(event) =>
                          patchElement(selected.id, { lineColor: event.target.value } as never)
                        }
                      />
                      <input
                        className={styles.propInput}
                        type="number"
                        min={0}
                        max={20}
                        value={selected.lineWidth ?? 0}
                        disabled={!canWrite}
                        onChange={(event) =>
                          patchElement(selected.id, { lineWidth: Number(event.target.value) || 0 } as never)
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {/* 元素进入动画：放映时按顺序播放 */}
            <div className={styles.propField}>
              <span>进入动画</span>
              <div className={styles.propRow}>
                <select
                  className={styles.propInput}
                  value={selected.animation?.type ?? 'none'}
                  disabled={!canWrite}
                  onChange={(event) =>
                    patchElement(selected.id, {
                      animation: {
                        type: event.target.value as SlideAnimationType,
                        duration: selected.animation?.duration ?? 400,
                        delay: selected.animation?.delay ?? 0,
                      },
                    } as never)
                  }
                >
                  <option value="none">无</option>
                  <option value="fadeIn">淡入</option>
                  <option value="flyInLeft">从左飞入</option>
                  <option value="flyInRight">从右飞入</option>
                  <option value="flyInTop">从上飞入</option>
                  <option value="flyInBottom">从下飞入</option>
                  <option value="zoomIn">放大进入</option>
                  <option value="wipeIn">擦除进入</option>
                </select>
                <input
                  className={styles.propInput}
                  type="number"
                  min={100}
                  max={5000}
                  step={100}
                  title="时长（毫秒）"
                  value={selected.animation?.duration ?? 400}
                  disabled={!canWrite}
                  onChange={(event) =>
                    patchElement(selected.id, {
                      animation: {
                        type: selected.animation?.type ?? 'none',
                        duration: Number(event.target.value) || 400,
                        delay: selected.animation?.delay ?? 0,
                      },
                    } as never)
                  }
                />
                <input
                  className={styles.propInput}
                  type="number"
                  min={0}
                  max={10000}
                  step={100}
                  title="延迟（毫秒）"
                  value={selected.animation?.delay ?? 0}
                  disabled={!canWrite}
                  onChange={(event) =>
                    patchElement(selected.id, {
                      animation: {
                        type: selected.animation?.type ?? 'none',
                        duration: selected.animation?.duration ?? 400,
                        delay: Number(event.target.value) || 0,
                      },
                    } as never)
                  }
                />
              </div>
            </div>

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

        {/* 本页备注与切换动画：对应 OpenPPT 的备注区与「切换」面板 */}
        <div className={styles.propField} style={{ marginTop: 12 }}>
          <span>本页备注</span>
          <textarea
            className={styles.propInput}
            style={{ minHeight: 64, resize: 'vertical' }}
            placeholder="演讲者备注（放映时可见，不显示在画布上）"
            value={slide.notes ?? ''}
            disabled={!canWrite}
            onChange={(event) => patchSlide(active, { notes: event.target.value })}
          />
        </div>

        <div className={styles.propField}>
          <span>切换动画</span>
          <div className={styles.propRow}>
            <select
              className={styles.propInput}
              value={slide.transition?.type ?? 'none'}
              disabled={!canWrite}
              onChange={(event) =>
                patchSlide(active, {
                  transition: {
                    type: event.target.value as SlideTransitionType,
                    duration: slide.transition?.duration ?? 300,
                  },
                })
              }
            >
              <option value="none">无</option>
              <option value="fade">淡入</option>
              <option value="slide">滑动</option>
              <option value="zoom">缩放</option>
              <option value="wipe">擦除</option>
            </select>
            <input
              className={styles.propInput}
              type="number"
              min={100}
              max={3000}
              step={100}
              value={slide.transition?.duration ?? 300}
              disabled={!canWrite}
              onChange={(event) =>
                patchSlide(active, {
                  transition: {
                    type: slide.transition?.type ?? 'none',
                    duration: Number(event.target.value) || 300,
                  },
                })
              }
            />
          </div>
        </div>

        {/* 本页动画：列出已设置的动画，可定位元素、整体预览或清除 */}
        <div className={styles.propField} style={{ marginTop: 12 }}>
          <span>本页动画（{animatedElements.length}）</span>
          {animatedElements.length === 0 ? (
            <p className={styles.hint}>选中元素后可在上方设置「进入动画」。</p>
          ) : (
            <div className={styles.propActions}>
              {animatedElements.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.propButton}
                  onClick={() => setSelectedId(item.id)}
                >
                  {item.type === 'text' ? '文字' : item.type === 'image' ? '图片' : '元素'}·
                  {ANIMATION_LABEL[item.animation?.type ?? 'none']}
                </button>
              ))}
            </div>
          )}
          <div className={styles.propActions}>
            <button
              type="button"
              className={styles.propButton}
              disabled={animatedElements.length === 0}
              onClick={playPreview}
            >
              预览动画
            </button>
            <button
              type="button"
              className={styles.propButton}
              disabled={!canWrite || animatedElements.length === 0}
              onClick={clearAnimations}
            >
              清除全部
            </button>
          </div>
        </div>

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
        <div className={styles.present}>
          <style>{ANIMATION_CSS}</style>

          {/* 左侧 1/3 上一页、右侧 2/3 下一页，与常见放映器一致 */}
          <div
            className={styles.presentZonePrev}
            onClick={() => setPresentIndex((index) => Math.max(0, index - 1))}
          />
          <div
            className={styles.presentZoneNext}
            onClick={() =>
              setPresentIndex((index) => Math.min(slides.length - 1, index + 1))
            }
          />

          <div
            // key 带页码：翻页时重新挂载，元素动画才会重播
            key={`present-${presentIndex}`}
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
                  ...animationStyle(element.animation),
                }}
              >
                {renderElement({ ...element, x: 0, y: 0, w: 0, h: 0 } as SlideElement)}
              </div>
            ))}
          </div>

          {/* 黑屏：按 B 切换，讲解时常用 */}
          {blackout ? <div className={styles.presentBlackout} /> : null}

          {/* 演讲者备注：按 N 切换显示 */}
          {showNotes && presentSlide.notes ? (
            <div className={styles.presentNotes}>
              <strong>备注</strong>
              <span>{presentSlide.notes}</span>
            </div>
          ) : null}

          {/* 进度条 */}
          <div className={styles.presentProgress}>
            <span
              style={{
                width: `${((presentIndex + 1) / Math.max(1, slides.length)) * 100}%`,
              }}
            />
          </div>

          <div className={styles.presentBar}>
            <span>
              {presentIndex + 1} / {slides.length}
            </span>
            <span className={styles.presentHint}>← → 翻页 · B 黑屏 · N 备注 · Esc 退出</span>
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
          ) : element.type === 'table' ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                border: '1px solid #d5d8de',
                background: element.headerFill,
              }}
            />
          ) : element.type === 'image' ? (
            <img src={element.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : element.type === 'chart' ? (
            <ChartView element={element} scale={0.1} />
          ) : element.type === 'latex' ? (
            <LatexView element={element} scale={0.12} />
          ) : element.type === 'video' ? (
            <div style={{ width: '100%', height: '100%', background: '#1b1f24' }} />
          ) : element.type === 'audio' ? (
            <div style={{ width: '100%', height: '100%', background: '#f2f3f5' }} />
          ) : element.type === 'iframe' ? (
            <div style={{ width: '100%', height: '100%', background: '#e5e6eb' }} />
          ) : (
            <ShapeView element={element} scale={0.1} />
          )}
        </div>
      ))}
    </>
  );
}
