import { alertDialog } from '../../ui/dialog';
/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 图片/海报编辑器主页面。
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)：
 *   views/Draw.vue + components/modules/layout/designBoard、zoomControl
 *   mixins/shortcuts.ts + methods/{keyCodeOptions,dealWithCtrl}.ts  键盘快捷键
 *
 * 存储：登录后带 ?id= 时为云端文档（type = 'image'）；否则为本地草稿，可另存到账号。
 */
import localforage from 'localforage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, documentApi, type ImageContent } from '../../api';
import { useAuth } from '../../lib/auth';
import { navigate } from '../../lib/router';
import { AssetPicker } from '../../ui/AssetPicker';
import { TopBar } from '../../ui/TopBar';
import { makeImage } from './defaults';
import { renderPoster } from './export';
import { pageDefault, type PosterContent, type PosterLayout } from './model';
import { PosterCanvas } from './PosterCanvas';
import { usePosterStore } from './store';
import { StylePanel } from './StylePanel';
import { WidgetPanel } from './WidgetPanel';
import styles from './poster.module.scss';

const DRAFT_KEY = 'opendocs_poster_draft_v2';

/** 兼容 v1 自研编辑器的单页结构，迁移为 layouts */
function migrate(content: Partial<PosterContent> | undefined): PosterLayout[] {
  if (content?.layouts && content.layouts.length > 0) return content.layouts;
  const page = pageDefault();
  if (content?.width) page.width = content.width;
  if (content?.height) page.height = content.height;
  if (content?.background) page.backgroundColor = content.background;
  return [{ global: page, layers: [] }];
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function PosterEditor() {
  const { user } = useAuth();
  const docId = useMemo(() => new URLSearchParams(window.location.search).get('id'), []);

  const [title, setTitle] = useState('未命名图片');
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [exporting, setExporting] = useState(false);
  /** 画笔模式与笔刷参数 */
  const [drawMode, setDrawMode] = useState(false);
  const [brushColor, setBrushColor] = useState('#1b1f24');
  const [brushWidth, setBrushWidth] = useState(4);
  const [creating, setCreating] = useState(false);
  const [picker, setPicker] = useState<null | { mode: 'replace'; uuid: string } | { mode: 'background' }>(null);
  const versionRef = useRef(1);

  const zoom = usePosterStore((s) => s.zoom);
  const setZoom = usePosterStore((s) => s.setZoom);
  const dirty = usePosterStore((s) => s.dirty);
  const history = usePosterStore((s) => s.history);
  const undo = usePosterStore((s) => s.undo);
  const redo = usePosterStore((s) => s.redo);
  const load = usePosterStore((s) => s.load);

  const canUndo = history.pointer >= 0;
  const canRedo = history.pointer < history.changes.length - 1;

  // ---------------------------------------------------------------- 载入

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (docId) {
          const data = await documentApi.get(docId);
          if (cancelled) return;
          load(migrate(data.content as unknown as Partial<PosterContent>));
          setTitle(data.document.title);
          versionRef.current = data.document.version;
        } else {
          const draft = await localforage.getItem<PosterLayout[]>(DRAFT_KEY);
          if (cancelled) return;
          load(draft && draft.length ? draft : migrate(undefined));
        }
      } catch {
        load(migrate(undefined));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, load]);

  // ---------------------------------------------------------------- 自动保存

  useEffect(() => {
    if (!ready || dirty === 0) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      const layouts = usePosterStore.getState().serialize();
      if (docId) {
        const content: PosterContent = { type: 'image', version: 2, layouts };
        void documentApi
          .save(docId, { content: content as unknown as ImageContent, baseVersion: versionRef.current })
          .then((result) => {
            versionRef.current = result.document.version;
            setSaveState('saved');
          })
          .catch(() => setSaveState('error'));
      } else {
        void localforage
          .setItem(DRAFT_KEY, layouts)
          .then(() => setSaveState('saved'))
          .catch(() => setSaveState('error'));
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, ready, docId]);

  const saveToAccount = async () => {
    if (!user) {
      navigate('/login?redirect=%2Fimage');
      return;
    }
    setCreating(true);
    try {
      const content: PosterContent = {
        type: 'image',
        version: 2,
        layouts: usePosterStore.getState().serialize(),
      };
      const data = await documentApi.create({
        type: 'image',
        title,
        content: content as unknown as ImageContent,
      });
      navigate(`/image?id=${data.document.id}`);
    } catch (error) {
      void alertDialog(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setCreating(false);
    }
  };

  const rename = async () => {
    if (!docId) return;
    try {
      await documentApi.update(docId, { title: title.trim() || '未命名图片' });
    } catch {
      // 重命名失败不阻塞编辑
    }
  };

  // ---------------------------------------------------------------- 导出

  const exportAs = async (format: 'png' | 'jpeg') => {
    setExporting(true);
    try {
      const state = usePosterStore.getState();
      const blob = await renderPoster(state.page(), state.widgets(), { scale: 1, format });
      download(blob, `${title || 'poster'}.${format === 'jpeg' ? 'jpg' : 'png'}`);
    } catch (error) {
      void alertDialog(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // ---------------------------------------------------------------- 快捷键（shortcuts.ts / keyCodeOptions / dealWithCtrl）

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }
      const state = usePosterStore.getState();
      const withCtrl = event.ctrlKey || event.metaKey;

      if (withCtrl) {
        switch (event.key.toLowerCase()) {
          case 'g':
            event.preventDefault();
            state.groupSelected();
            return;
          case 'c':
            state.copySelected();
            return;
          case 'v':
            // 系统剪贴板里有图片时由 paste 事件处理；否则粘贴内部复制的图层
            if (state.copied.length > 0) state.paste();
            return;
          case 'z':
            event.preventDefault();
            if (event.shiftKey) state.redo();
            else state.undo();
            return;
          case 's':
            event.preventDefault();
            return;
          case '=':
          case '+':
            event.preventDefault();
            state.setZoom(state.zoom + 10);
            return;
          case '-':
            event.preventDefault();
            state.setZoom(state.zoom - 10);
            return;
        }
        return;
      }

      const range = event.shiftKey ? 10 : 1;
      const active = state.selected;
      if (active.length === 0) return;

      const move = (dx: number, dy: number) => {
        event.preventDefault();
        for (const uuid of active) {
          const widget = state.widgets().find((item) => item.uuid === uuid);
          if (widget && !widget.lock) {
            state.updateWidget(uuid, { left: widget.left + dx, top: widget.top + dy });
          }
        }
      };

      switch (event.key) {
        case 'ArrowUp':
          move(0, -range);
          break;
        case 'ArrowDown':
          move(0, range);
          break;
        case 'ArrowLeft':
          move(-range, 0);
          break;
        case 'ArrowRight':
          move(range, 0);
          break;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          state.deleteSelected();
          break;
      }
    },
    []
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  // 粘贴系统剪贴板里的图片（handlePaste.ts）
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image'));
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const state = usePosterStore.getState();
        const page = state.page();
        state.addWidget(
          makeImage({
            imgUrl: String(reader.result),
            width: 400,
            height: 400,
            left: page.width / 2 - 200,
            top: page.height / 2 - 200,
          })
        );
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // ---------------------------------------------------------------- 素材弹窗回调

  const handlePick = (url: string) => {
    const state = usePosterStore.getState();
    if (picker?.mode === 'replace') {
      state.updateWidget(picker.uuid, { imgUrl: url });
    } else if (picker?.mode === 'background') {
      state.updatePage({ backgroundImage: url });
    }
  };

  if (!ready) return <div style={{ padding: 40, color: '#86909c' }}>加载中…</div>;

  // 浏览模式：?mode=view 时只读，隐藏左右面板并禁用画布交互
  const readonly = new URLSearchParams(window.location.search).get('mode') === 'view';

  return (
    <div className={styles.editor}>
      <TopBar />
      <div className={styles.topbar}>
        <input
          className={styles.titleInput}
          value={title}
          placeholder="未命名的设计"
          readOnly={readonly}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={rename}
        />
        {readonly ? <span className={styles.status}>浏览模式</span> : null}
        <span className={styles.status}>
          {saveState === 'saving'
            ? '保存中…'
            : saveState === 'saved'
              ? docId
                ? '已保存到云端'
                : '已自动保存到本地'
              : saveState === 'error'
                ? '保存失败'
                : ''}
        </span>
        <span className={styles.grow} />

        <button type="button" className={`${styles.topButton} ${styles.topIcon}`} disabled={!canUndo} title="撤销 (Ctrl+Z)" onClick={undo}>
          ↶
        </button>
        <button
          type="button"
          className={`${styles.topButton} ${drawMode ? styles.topButtonPrimary : ''}`}
          title="画笔：在画布上拖动绘制，画完自动退出"
          onClick={() => setDrawMode((value) => !value)}
        >
          {drawMode ? '绘制中…' : '画笔'}
        </button>
        {drawMode ? (
          <>
            <input
              type="color"
              value={brushColor}
              title="画笔颜色"
              style={{ width: 30, height: 28, padding: 0, border: '1px solid #d5d8de', borderRadius: 6 }}
              onChange={(event) => setBrushColor(event.target.value)}
            />
            <input
              type="number"
              min={1}
              max={40}
              value={brushWidth}
              title="画笔粗细"
              style={{ width: 56, height: 28, padding: '0 6px', border: '1px solid #d5d8de', borderRadius: 6 }}
              onChange={(event) => setBrushWidth(Number(event.target.value) || 4)}
            />
          </>
        ) : null}
        <button type="button" className={`${styles.topButton} ${styles.topIcon}`} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" onClick={redo}>
          ↷
        </button>
        <span className={styles.divider} />
        {docId ? null : (
          <button
            type="button"
            className={`${styles.topButton} ${styles.topButtonPrimary}`}
            disabled={creating}
            onClick={saveToAccount}
          >
            {creating ? '保存中…' : user ? '保存到我的文档' : '登录后保存到云端'}
          </button>
        )}
        <button type="button" className={styles.topButton} disabled={exporting} onClick={() => void exportAs('jpeg')}>
          导出 JPG
        </button>
        <button
          type="button"
          className={`${styles.topButton} ${styles.topButtonPrimary}`}
          disabled={exporting}
          onClick={() => void exportAs('png')}
        >
          {exporting ? '导出中…' : '导出 PNG'}
        </button>
      </div>

      <div className={styles.body}>
        {readonly ? null : <WidgetPanel />}
        <div className={styles.stage}>
          {/* 包裹层必须始终撑满舞台：内层画布是 height:100%，
              如果这里高度为 auto，stage 会变成 0 高，自适应缩放会一直算成最小值 */}
          <div
            style={{
              width: '100%',
              height: '100%',
              pointerEvents: readonly ? 'none' : undefined,
            }}
          >
            <PosterCanvas
              drawMode={readonly ? false : drawMode}
              brushColor={brushColor}
              brushWidth={brushWidth}
              onStrokeDone={() => setDrawMode(false)}
            />
          </div>
          <div className={styles.zoomBar}>
            <button type="button" className={styles.zoomButton} onClick={() => setZoom(zoom - 10)}>
              −
            </button>
            <span className={styles.zoomValue}>{Math.round(zoom)}%</span>
            <button type="button" className={styles.zoomButton} onClick={() => setZoom(zoom + 10)}>
              +
            </button>
          </div>
        </div>
        {readonly ? null : (
          <StylePanel
            onReplaceImage={(uuid) => setPicker({ mode: 'replace', uuid })}
            onPickBackground={() => setPicker({ mode: 'background' })}
          />
        )}
      </div>

      <AssetPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={(asset) => handlePick(asset.url)}
        documentId={docId}
      />
    </div>
  );
}
