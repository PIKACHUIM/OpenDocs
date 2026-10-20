/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 右侧「设置 / 图层」面板。
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)：
 *   modules/panel/stylePanel.vue            设置 / 图层 双 tab，多选时显示「成组」
 *   modules/widgets/wText/wTextStyle.vue    位置尺寸 → 字体字号 → 样式图标 → 字距行距 → 颜色 → 图层/对齐 → 文本
 *   modules/widgets/wImage/wImageStyle.vue  位置尺寸 → 替换/裁剪 → 不透明/圆角 → 图层/对齐
 *   modules/layout/designBoard/pageStyle.vue  画布尺寸 → 背景设置
 *   modules/panel/components/layerList.vue  图层列表
 */
import { useState, type ReactNode } from 'react';
import { ALIGN_LIST, FONT_SIZES, PAGE_SIZES, TEXT_ALIGNS, TEXT_STYLE_TOGGLES } from './data';
import type { ImageWidget, PosterPage, QrcodeWidget, TextWidget, Widget } from './model';
import { usePosterStore } from './store';
import styles from './poster.module.scss';

// --------------------------------------------------------------- 通用控件

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={styles.section}>
      <button type="button" className={styles.sectionHead} onClick={() => setOpen(!open)}>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
        {title}
      </button>
      {open ? <div className={styles.sectionBody}>{children}</div> : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className={styles.numberField}>
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className={styles.sliderField}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className={styles.sliderValue}>{Math.round(value * 100) / 100}</span>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // 原项目颜色为 8 位十六进制（含透明度）；<input type=color> 只认 6 位
  const hex6 = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000';
  const alpha = /^#[0-9a-f]{8}$/i.test(value) ? value.slice(7) : 'ff';
  return (
    <label className={styles.colorField}>
      <span>{label}</span>
      <input
        type="color"
        value={hex6}
        onChange={(event) => onChange(`${event.target.value}${alpha}`)}
      />
      <code>{value}</code>
    </label>
  );
}

function IconRow({
  items,
}: {
  items: Array<{ tip: string; label: string; active?: boolean; onClick: () => void }>;
}) {
  return (
    <div className={styles.iconRow}>
      {items.map((item) => (
        <button
          key={item.tip}
          type="button"
          title={item.tip}
          className={`${styles.iconButton} ${item.active ? styles.iconButtonActive : ''}`}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const ALIGN_LABELS: Record<string, string> = {
  left: '⇤',
  ch: '↔',
  right: '⇥',
  top: '⤒',
  cv: '↕',
  bottom: '⤓',
};

function LayerAlign({ uuid }: { uuid: string }) {
  const moveLayer = usePosterStore((s) => s.moveLayer);
  const align = usePosterStore((s) => s.align);
  return (
    <>
      <IconRow
        items={[
          { tip: '上一层', label: '▲', onClick: () => moveLayer(uuid, 1) },
          { tip: '下一层', label: '▼', onClick: () => moveLayer(uuid, -1) },
        ]}
      />
      <IconRow
        items={ALIGN_LIST.map((item) => ({
          tip: item.tip,
          label: ALIGN_LABELS[item.value],
          onClick: () => align(item.value, uuid),
        }))}
      />
    </>
  );
}

// --------------------------------------------------------------- 位置尺寸

function PositionSection({ widget }: { widget: Widget }) {
  const update = usePosterStore((s) => s.updateWidget);
  return (
    <Section title="位置尺寸">
      <div className={styles.grid2}>
        <NumberField label="X" value={widget.left} onChange={(left) => update(widget.uuid, { left })} />
        <NumberField label="Y" value={widget.top} onChange={(top) => update(widget.uuid, { top })} />
        <NumberField
          label="宽"
          value={widget.width}
          min={widget.record.minWidth}
          onChange={(width) => update(widget.uuid, { width })}
        />
        <NumberField
          label="高"
          value={widget.height}
          min={widget.record.minHeight}
          onChange={(height) => update(widget.uuid, { height })}
        />
        <NumberField
          label="旋转"
          value={widget.rotate}
          onChange={(rotate) => update(widget.uuid, { rotate })}
        />
      </div>
    </Section>
  );
}

// --------------------------------------------------------------- 各类型

function TextStyle({ widget }: { widget: TextWidget }) {
  const update = usePosterStore((s) => s.updateWidget);
  const toggle = (key: string, values: readonly string[]) => {
    const current = String((widget as unknown as Record<string, unknown>)[key]);
    update(widget.uuid, { [key]: current === values[1] ? values[0] : values[1] });
  };

  return (
    <>
      <PositionSection widget={widget} />
      <div className={styles.block}>
        <div className={styles.grid2}>
          <label className={styles.selectField}>
            <span>字体</span>
            <input
              value={widget.fontClass.alias}
              readOnly
              title="字体库需要后端字体接口，当前使用系统字体栈"
            />
          </label>
          <label className={styles.selectField}>
            <span>大小</span>
            <select
              value={FONT_SIZES.includes(widget.fontSize) ? widget.fontSize : ''}
              onChange={(event) => update(widget.uuid, { fontSize: Number(event.target.value) })}
            >
              {FONT_SIZES.includes(widget.fontSize) ? null : <option value="">{widget.fontSize}</option>}
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>

        <IconRow
          items={TEXT_STYLE_TOGGLES.map((item) => ({
            tip: item.tip,
            label: item.label,
            active:
              String((widget as unknown as Record<string, unknown>)[item.key]) === item.value[1],
            onClick: () => toggle(item.key, item.value),
          }))}
        />
        <IconRow
          items={TEXT_ALIGNS.map((item) => ({
            tip: item.tip,
            label: item.label,
            active: widget.textAlign === item.value,
            onClick: () => update(widget.uuid, { textAlign: item.value }),
          }))}
        />

        <SliderField
          label="字距"
          value={widget.letterSpacing}
          min={-widget.fontSize}
          max={widget.fontSize * 2}
          step={0.05}
          onChange={(letterSpacing) => update(widget.uuid, { letterSpacing })}
        />
        <SliderField
          label="行距"
          value={widget.lineHeight}
          min={0}
          max={2.5}
          step={0.05}
          onChange={(lineHeight) => update(widget.uuid, { lineHeight })}
        />
        <ColorField label="颜色" value={widget.color} onChange={(color) => update(widget.uuid, { color })} />
        <SliderField
          label="不透明"
          value={widget.opacity}
          onChange={(opacity) => update(widget.uuid, { opacity })}
        />

        <LayerAlign uuid={widget.uuid} />

        <label className={styles.textareaField}>
          <span>文本内容</span>
          <textarea
            value={widget.text}
            rows={4}
            onChange={(event) => update(widget.uuid, { text: event.target.value })}
          />
        </label>
      </div>
    </>
  );
}

function ImageStyle({
  widget,
  onReplace,
}: {
  widget: ImageWidget;
  onReplace: () => void;
}) {
  const update = usePosterStore((s) => s.updateWidget);
  const maxRadius = Math.min(widget.width, widget.height) / 2;
  return (
    <>
      <PositionSection widget={widget} />
      <Section title="设置">
        <button type="button" className={styles.wideButton} onClick={onReplace}>
          替换图片
        </button>
        <IconRow
          items={[
            {
              tip: '水平翻转',
              label: '⇋',
              active: widget.flip === 'x',
              onClick: () => update(widget.uuid, { flip: widget.flip === 'x' ? null : 'x' }),
            },
            {
              tip: '垂直翻转',
              label: '⥮',
              active: widget.flip === 'y',
              onClick: () => update(widget.uuid, { flip: widget.flip === 'y' ? null : 'y' }),
            },
          ]}
        />
        <SliderField
          label="不透明"
          value={widget.opacity}
          onChange={(opacity) => update(widget.uuid, { opacity })}
        />
        <SliderField
          label="圆角"
          value={widget.radius}
          min={0}
          max={Math.max(1, maxRadius)}
          step={1}
          onChange={(radius) => update(widget.uuid, { radius })}
        />
        <SliderField
          label="亮度"
          value={widget.brightness ?? 100}
          min={0}
          max={200}
          step={1}
          onChange={(brightness) => update(widget.uuid, { brightness })}
        />
        <SliderField
          label="对比度"
          value={widget.contrast ?? 100}
          min={0}
          max={200}
          step={1}
          onChange={(contrast) => update(widget.uuid, { contrast })}
        />
        <SliderField
          label="饱和度"
          value={widget.saturate ?? 100}
          min={0}
          max={200}
          step={1}
          onChange={(saturate) => update(widget.uuid, { saturate })}
        />
      </Section>
      <div className={styles.block}>
        <LayerAlign uuid={widget.uuid} />
      </div>
    </>
  );
}

const QR_DOT_TYPES: QrcodeWidget['dotType'][] = [
  'classy',
  'classy-rounded',
  'dots',
  'rounded',
  'extra-rounded',
  'square',
];

function QrStyle({ widget }: { widget: QrcodeWidget }) {
  const update = usePosterStore((s) => s.updateWidget);
  return (
    <>
      <PositionSection widget={widget} />
      <Section title="二维码设置">
        <label className={styles.textareaField}>
          <span>内容 / 链接</span>
          <textarea
            value={widget.value}
            rows={3}
            onChange={(event) => update(widget.uuid, { value: event.target.value })}
          />
        </label>
        <label className={styles.selectField}>
          <span>点样式</span>
          <select
            value={widget.dotType}
            onChange={(event) =>
              update(widget.uuid, { dotType: event.target.value as QrcodeWidget['dotType'] })
            }
          >
            {QR_DOT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.selectField}>
          <span>颜色模式</span>
          <select
            value={widget.dotColorType}
            onChange={(event) =>
              update(widget.uuid, {
                dotColorType: event.target.value as QrcodeWidget['dotColorType'],
              })
            }
          >
            <option value="single">单色</option>
            <option value="double">渐变</option>
          </select>
        </label>
        <ColorField label="颜色" value={widget.dotColor} onChange={(dotColor) => update(widget.uuid, { dotColor })} />
        {widget.dotColorType === 'double' ? (
          <>
            <ColorField
              label="颜色 2"
              value={widget.dotColor2}
              onChange={(dotColor2) => update(widget.uuid, { dotColor2 })}
            />
            <NumberField
              label="渐变角度"
              value={widget.dotRotation}
              onChange={(dotRotation) => update(widget.uuid, { dotRotation })}
            />
          </>
        ) : null}
        <SliderField
          label="不透明"
          value={widget.opacity}
          onChange={(opacity) => update(widget.uuid, { opacity })}
        />
      </Section>
      <div className={styles.block}>
        <LayerAlign uuid={widget.uuid} />
      </div>
    </>
  );
}

function GenericStyle({ widget }: { widget: Widget }) {
  const update = usePosterStore((s) => s.updateWidget);
  const ungroup = usePosterStore((s) => s.ungroup);
  return (
    <>
      <PositionSection widget={widget} />
      <div className={styles.block}>
        <SliderField
          label="不透明"
          value={widget.opacity}
          onChange={(opacity) => update(widget.uuid, { opacity })}
        />
        <LayerAlign uuid={widget.uuid} />
        {widget.type === 'w-group' ? (
          <button type="button" className={styles.wideButton} onClick={() => ungroup(widget.uuid)}>
            取消组合
          </button>
        ) : null}
      </div>
    </>
  );
}

// --------------------------------------------------------------- 画布设置

function PageStyle({ page, onPickBackground }: { page: PosterPage; onPickBackground: () => void }) {
  const updatePage = usePosterStore((s) => s.updatePage);
  const [mode, setMode] = useState<'颜色' | '图片'>(page.backgroundImage ? '图片' : '颜色');

  return (
    <>
      <Section title="画布尺寸">
        <label className={styles.selectField}>
          <span>预设</span>
          <select
            value=""
            onChange={(event) => {
              const preset = PAGE_SIZES.find((item) => item.name === event.target.value);
              if (preset) updatePage({ width: preset.width, height: preset.height });
            }}
          >
            <option value="">选择预设尺寸…</option>
            {PAGE_SIZES.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}（{item.width}×{item.height}）
              </option>
            ))}
          </select>
        </label>
        <div className={styles.grid2}>
          <NumberField
            label="宽"
            value={page.width}
            min={50}
            max={8000}
            onChange={(width) => updatePage({ width })}
          />
          <NumberField
            label="高"
            value={page.height}
            min={50}
            max={8000}
            onChange={(height) => updatePage({ height })}
          />
        </div>
      </Section>
      <Section title="背景设置">
        <div className={styles.tabs2}>
          {(['颜色', '图片'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`${styles.tab2} ${mode === item ? styles.tab2Active : ''}`}
              onClick={() => setMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {mode === '颜色' ? (
          <ColorField
            label="背景色"
            value={page.backgroundColor}
            onChange={(backgroundColor) => updatePage({ backgroundColor, backgroundGradient: '' })}
          />
        ) : (
          <>
            {page.backgroundImage ? (
              <img src={page.backgroundImage} alt="" className={styles.bgPreview} />
            ) : null}
            <button type="button" className={styles.wideButton} onClick={onPickBackground}>
              {page.backgroundImage ? '更换背景图' : '选择背景图'}
            </button>
            {page.backgroundImage ? (
              <button
                type="button"
                className={styles.wideButton}
                onClick={() => updatePage({ backgroundImage: '' })}
              >
                删除背景图
              </button>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}

// --------------------------------------------------------------- 图层列表

const TYPE_NAME: Record<string, string> = {
  'w-text': '文字',
  'w-image': '图片',
  'w-svg': '图形',
  'w-qrcode': '二维码',
  'w-group': '组合',
};

function LayerList() {
  const widgets = usePosterStore((s) => s.layouts[s.currentPage].layers);
  const selected = usePosterStore((s) => s.selected);
  const select = usePosterStore((s) => s.select);
  const lockToggle = usePosterStore((s) => s.lockToggle);

  const top = widgets.filter((item) => item.parent === '-1');
  // 图层列表自上而下 = 画布最上层在前
  const ordered = [...top].reverse();

  const renderItem = (widget: Widget, depth: number) => (
    <div key={widget.uuid}>
      <div
        className={`${styles.layerItem} ${selected.includes(widget.uuid) ? styles.layerItemActive : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={(event) => select(widget.uuid, event.shiftKey)}
      >
        <span className={styles.layerName}>
          {widget.type === 'w-text'
            ? ((widget as TextWidget).text || '文字').slice(0, 14)
            : (TYPE_NAME[widget.type] ?? widget.name)}
        </span>
        <button
          type="button"
          className={`${styles.layerLock} ${widget.lock ? styles.layerLockOn : ''}`}
          title={widget.lock ? '解锁' : '锁定'}
          onClick={(event) => {
            event.stopPropagation();
            lockToggle(widget.uuid);
          }}
        >
          {widget.lock ? '锁' : '·'}
        </button>
      </div>
      {widget.isContainer
        ? widgets
            .filter((item) => item.parent === widget.uuid)
            .reverse()
            .map((child) => renderItem(child, depth + 1))
        : null}
    </div>
  );

  return (
    <div className={styles.layerList}>
      {ordered.length === 0 ? (
        <p className={styles.empty}>还没有图层，从左侧添加文字、素材或工具。</p>
      ) : (
        ordered.map((widget) => renderItem(widget, 0))
      )}
    </div>
  );
}

// --------------------------------------------------------------- 入口

export function StylePanel({
  onReplaceImage,
  onPickBackground,
}: {
  onReplaceImage: (uuid: string) => void;
  onPickBackground: () => void;
}) {
  const [tab, setTab] = useState<'设置' | '图层'>('设置');
  const selected = usePosterStore((s) => s.selected);
  const page = usePosterStore((s) => s.layouts[s.currentPage].global);
  const widgets = usePosterStore((s) => s.layouts[s.currentPage].layers);
  const groupSelected = usePosterStore((s) => s.groupSelected);
  const align = usePosterStore((s) => s.align);

  const active = selected.length === 1 ? widgets.find((item) => item.uuid === selected[0]) : null;
  const multi = selected.length > 1;

  return (
    <div className={styles.stylePanel}>
      <div className={styles.styleTabs}>
        {(['设置', '图层'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`${styles.styleTab} ${tab === item ? styles.styleTabActive : ''}`}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className={styles.styleBody}>
        {tab === '图层' ? (
          <LayerList />
        ) : multi ? (
          <div className={styles.block}>
            <button type="button" className={styles.primaryWide} onClick={groupSelected}>
              成组
            </button>
            <IconRow
              items={ALIGN_LIST.map((item) => ({
                tip: item.tip,
                label: ALIGN_LABELS[item.value],
                onClick: () => selected.forEach((uuid) => align(item.value, uuid)),
              }))}
            />
          </div>
        ) : active?.type === 'w-text' ? (
          <TextStyle widget={active} />
        ) : active?.type === 'w-image' ? (
          <ImageStyle widget={active} onReplace={() => onReplaceImage(active.uuid)} />
        ) : active?.type === 'w-qrcode' ? (
          <QrStyle widget={active} />
        ) : active ? (
          <GenericStyle widget={active} />
        ) : (
          <PageStyle page={page} onPickBackground={onPickBackground} />
        )}
      </div>
    </div>
  );
}
