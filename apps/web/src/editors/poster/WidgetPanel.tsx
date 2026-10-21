import { confirmDialog } from '../../ui/dialog';
/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 左侧「模板 / 素材 / 文字 / 照片 / 工具箱 / 我的」面板。
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)：
 *   modules/panel/widgetPanel.vue          左侧竖向分类 + 内容区，可收起
 *   modules/panel/wrap/TextListWrap.vue    基础文字预设
 *   modules/panel/wrap/ToolsListWrap.vue   工具箱（二维码）
 *   modules/panel/wrap/UserWrap.vue        我的：资源管理 / 我的作品
 *   modules/panel/wrap/GraphListWrap.vue   素材（贴纸 / SVG / 遮罩）
 *
 * 数据来源差异：原项目的模板/素材/照片来自它自己的服务端，不随仓库分发；
 * 这里「照片」「我的资源」接 OpenDocs 素材库（/api/assets），
 * 「素材」使用内置矢量基础形状，「模板」使用内置版式。
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, assetApi, type UploadedAsset } from '../../api';
import { useAuth } from '../../lib/auth';
import { WIDGET_CLASSES, type WidgetClassKey } from './data';
import { makeImage, makeQrcode, makeSvg, makeText } from './defaults';
import { SHAPES, TEMPLATES, shapeToDataUrl } from './library';
import type { Widget } from './model';
import { usePosterStore } from './store';
import styles from './poster.module.scss';

/** 居中放置：对应各面板里的 `left = pageW/2 - w/2` */
function centered<T extends Widget>(widget: T): T {
  const page = usePosterStore.getState().page();
  return {
    ...widget,
    left: Math.round(page.width / 2 - widget.width / 2),
    top: Math.round(page.height / 2 - widget.height / 2),
  };
}

// --------------------------------------------------------------- 各分类

/** 文字：基础文字预设（TextListWrap.basicTextList） */
function TextPanel() {
  const addWidget = usePosterStore((s) => s.addWidget);
  const presets = [
    { label: '+ 添加文字', fontSize: 60, fontWeight: 'normal' },
    { label: '大标题', fontSize: 96, fontWeight: 'bold' },
    { label: '小标题', fontSize: 36, fontWeight: 'bold' },
    { label: '正文内容', fontSize: 28, fontWeight: 'normal' },
  ];

  return (
    <div className={styles.panelBody}>
      <div className={styles.textPresets}>
        {presets.map((item) => (
          <button
            key={item.label}
            type="button"
            className={styles.textPreset}
            style={{ fontSize: 14, fontWeight: item.fontWeight === 'bold' ? 700 : 400 }}
            onClick={() => {
              const text = '双击编辑文字';
              addWidget(
                centered(
                  makeText({
                    text,
                    fontSize: item.fontSize,
                    fontWeight: item.fontWeight,
                    width: item.fontSize * text.length,
                    height: Math.round(item.fontSize * 1.5),
                  })
                )
              );
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 素材：内置矢量基础形状（原项目为服务端 svg 分类） */
function MaterialPanel() {
  const addWidget = usePosterStore((s) => s.addWidget);
  return (
    <div className={styles.panelBody}>
      <div className={styles.panelTitle}>基础形状</div>
      <div className={styles.shapeGrid}>
        {SHAPES.map((shape) => (
          <button
            key={shape.name}
            type="button"
            className={styles.shapeItem}
            title={shape.name}
            onClick={() =>
              addWidget(
                centered(
                  makeSvg({
                    name: shape.name,
                    svgUrl: shapeToDataUrl(shape, '#3370ff'),
                    colors: ['#3370ff'],
                    width: shape.width,
                    height: shape.height,
                  })
                )
              )
            }
          >
            <img src={shapeToDataUrl(shape, '#86909c')} alt={shape.name} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** 照片 / 我的资源：OpenDocs 素材库 */
function AssetPanel({ title, hint }: { title: string; hint?: string }) {
  const { user } = useAuth();
  const addWidget = usePosterStore((s) => s.addWidget);
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await assetApi.list({ limit: 60 });
      setAssets(data.assets);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '素材加载失败');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const insert = (src: string) => addWidget(centered(makeImage({ imgUrl: src, width: 360, height: 360 })));

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const asset = await assetApi.upload(file);
      insert(asset.url);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const insertLocal = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => insert(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className={styles.panelBody}>
      <div className={styles.panelTitle}>{title}</div>
      {hint ? <p className={styles.panelHint}>{hint}</p> : null}

      <div className={styles.uploadRow}>
        <label className={styles.uploadButton}>
          {user ? (uploading ? '上传中…' : '上传图片') : '本地图片'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                if (user) void upload(file);
                else insertLocal(file);
              }
              event.target.value = '';
            }}
          />
        </label>
      </div>
      <div className={styles.urlRow}>
        <input
          placeholder="粘贴图片 URL 后回车"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && url.trim()) {
              insert(url.trim());
              setUrl('');
            }
          }}
        />
      </div>

      {!user ? <p className={styles.panelHint}>登录后可使用云端素材库，并在其他文档中复用。</p> : null}
      {error ? <p className={styles.panelError}>{error}</p> : null}
      {loading ? <p className={styles.panelHint}>加载中…</p> : null}

      <div className={styles.photoGrid}>
        {assets.map((asset) => (
          <button key={asset.id} type="button" className={styles.photoItem} onClick={() => insert(asset.url)}>
            <img src={asset.url} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {user && !loading && assets.length === 0 ? (
        <p className={styles.panelHint}>素材库还是空的，先上传一张图片。</p>
      ) : null}
    </div>
  );
}

/** 工具箱：二维码（ToolsListWrap） */
function ToolsPanel() {
  const addWidget = usePosterStore((s) => s.addWidget);
  return (
    <div className={styles.panelBody}>
      <div className={styles.panelTitle}>组件</div>
      <button type="button" className={styles.toolItem} onClick={() => addWidget(centered(makeQrcode()))}>
        <span className={styles.toolIcon}>QR</span>
        <span>
          <strong>二维码</strong>
          <small>在设计中使用风格化二维码</small>
        </span>
      </button>
    </div>
  );
}

/** 模板：内置版式（原项目为服务端模板库） */
function TemplatePanel() {
  const updatePage = usePosterStore((s) => s.updatePage);
  const addWidget = usePosterStore((s) => s.addWidget);
  const load = usePosterStore((s) => s.load);
  const widgets = usePosterStore((s) => s.layouts[s.currentPage].layers);

  const apply = async (index: number) => {
    const template = TEMPLATES[index];
    if (widgets.length > 0) {
      const ok = await confirmDialog('使用模板会替换当前画布内容，继续吗？', {
        danger: true,
        title: '应用模板',
        confirmText: '替换',
      });
      if (!ok) return;
    }
    load([{ global: { ...template.page }, layers: [] }]);
    updatePage({ ...template.page });
    for (const layer of template.layers()) addWidget(layer);
  };

  return (
    <div className={styles.panelBody}>
      <div className={styles.panelTitle}>版式模板</div>
      <div className={styles.templateGrid}>
        {TEMPLATES.map((template, index) => (
          <button key={template.name} type="button" className={styles.templateItem} onClick={() => void apply(index)}>
            <div
              className={styles.templateCover}
              style={{ aspectRatio: `${template.page.width} / ${template.page.height}` }}
            >
              <img src={template.cover()} alt={template.name} />
            </div>
            <span>{template.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- 入口

export function WidgetPanel() {
  const [active, setActive] = useState<WidgetClassKey>('text');
  const [open, setOpen] = useState(true);

  return (
    <div className={styles.widgetPanel}>
      <ul className={styles.classify}>
        {WIDGET_CLASSES.map((item) => (
          <li
            key={item.key}
            className={`${styles.classifyItem} ${active === item.key && open ? styles.classifyItemActive : ''}`}
            onClick={() => {
              setActive(item.key);
              setOpen(true);
            }}
          >
            <span className={styles.classifyIcon}>{item.name.slice(0, 1)}</span>
            <p>{item.name}</p>
          </li>
        ))}
      </ul>

      {open ? (
        <div className={styles.widgetWrap}>
          {active === 'template' ? <TemplatePanel /> : null}
          {active === 'material' ? <MaterialPanel /> : null}
          {active === 'text' ? <TextPanel /> : null}
          {active === 'photo' ? (
            <AssetPanel title="照片" hint="点击图片即可添加到画布；也可上传自己的图片。" />
          ) : null}
          {active === 'tools' ? <ToolsPanel /> : null}
          {active === 'user' ? <AssetPanel title="资源管理" /> : null}
          <button type="button" className={styles.collapse} title="收起侧边栏" onClick={() => setOpen(false)}>
            ‹
          </button>
        </div>
      ) : null}
    </div>
  );
}
