import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { assetApi, type EmbeddedMindmap, type MarkdownContent } from '../../api';
import { createEmbeddedMindmap, EmbeddedMindmapEditor } from '../shared/EmbeddedMindmapEditor';
import styles from '../../ui/common.module.scss';
import mdStyles from './markdown.module.scss';

export interface MarkdownEditorProps {
  content: MarkdownContent;
  canWrite: boolean;
  documentId: string | null;
  shareToken: string | null;
  onChange: (content: MarkdownContent) => void;
}

const MINDMAP_TOKEN = /\[\[mindmap:([\w-]+)\]\]/g;

function renderHtml(markdown: string, mindmaps: Record<string, EmbeddedMindmap>, canWrite: boolean): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  const withMindmaps = raw.replace(MINDMAP_TOKEN, (_match, id: string) => {
    const mindmap = mindmaps[id];
    const count = mindmap?.elements?.length ?? 0;
    return `<div class="${mdStyles.embeddedMindmap}" data-mindmap-id="${id}">🧠 内嵌思维导图 · ${count} 个节点（点击${canWrite ? '编辑' : '查看'}）</div>`;
  });
  return DOMPurify.sanitize(withMindmaps, {
    ADD_ATTR: ['data-mindmap-id', 'class'],
  });
}

export function MarkdownEditor({ content, canWrite, documentId, shareToken, onChange }: MarkdownEditorProps) {
  const [editingMindmapId, setEditingMindmapId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mindmaps = content.mindmaps ?? {};
  const html = useMemo(() => renderHtml(content.markdown, mindmaps, canWrite), [content.markdown, mindmaps, canWrite]);

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    const current = content.markdown;
    if (!textarea) {
      onChange({ ...content, markdown: `${current}\n${text}` });
      return;
    }
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
    onChange({ ...content, markdown: next });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const insertMindmap = () => {
    const mindmap = createEmbeddedMindmap();
    insertAtCursor(`\n[[mindmap:${mindmap.id}]]\n`);
    onChange({ ...content, mindmaps: { ...mindmaps, [mindmap.id]: mindmap } });
    setEditingMindmapId(mindmap.id);
  };

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const asset = await assetApi.upload(file, {
        documentId: documentId ?? undefined,
        shareToken: shareToken ?? undefined,
      });
      insertAtCursor(`![${file.name}](${asset.url})`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const onPreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest('[data-mindmap-id]');
    const id = target?.getAttribute('data-mindmap-id');
    if (id) setEditingMindmapId(id);
  };

  const activeMindmap = editingMindmapId ? mindmaps[editingMindmapId] : null;

  return (
    <div className={mdStyles.wrap}>
      {canWrite ? (
        <div className={mdStyles.toolbar}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSm}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? '上传中…' : '🖼️ 插入图片'}
          </button>
          <button type="button" className={`${styles.button} ${styles.buttonSm}`} onClick={insertMindmap}>
            🧠 插入思维导图
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImageUpload(file);
              event.target.value = '';
            }}
          />
        </div>
      ) : null}

      <div className={mdStyles.panes}>
        {canWrite ? (
          <>
            <div className={mdStyles.pane}>
              <textarea
                ref={textareaRef}
                className={mdStyles.source}
                value={content.markdown}
                placeholder="开始输入 Markdown…"
                onChange={(event) => onChange({ ...content, markdown: event.target.value })}
              />
            </div>
            <div className={mdStyles.divider} />
          </>
        ) : null}
        <div className={mdStyles.pane} onClick={onPreviewClick}>
          <div
            className={mdStyles.preview}
            data-export-target="markdown-preview"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>

      {activeMindmap ? (
        <EmbeddedMindmapEditor
          open
          mindmap={activeMindmap}
          canWrite={canWrite}
          onClose={() => setEditingMindmapId(null)}
          onSave={(updated) => {
            onChange({ ...content, mindmaps: { ...mindmaps, [updated.id]: updated } });
          }}
        />
      ) : null}
    </div>
  );
}
