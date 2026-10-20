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

  /** 行内包裹：加粗、斜体、行内代码等；无选中时插入占位文本并选中它 */
  const applyInline = (before: string, after: string, placeholder: string) => {
    const textarea = textareaRef.current;
    const current = content.markdown;
    if (!textarea) {
      insertAtCursor(`${before}${placeholder}${after}`);
      return;
    }
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const selected = current.slice(start, end) || placeholder;
    const next = `${current.slice(0, start)}${before}${selected}${after}${current.slice(end)}`;
    onChange({ ...content, markdown: next });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  /** 行首加前缀：标题、引用、列表；对选中的每一行都生效 */
  const applyLinePrefix = (prefix: string) => {
    const textarea = textareaRef.current;
    const current = content.markdown;
    if (!textarea) {
      insertAtCursor(`\n${prefix}`);
      return;
    }
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const from = current.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const nextBreak = current.indexOf('\n', end);
    const to = nextBreak === -1 ? current.length : nextBreak;
    const block = current.slice(from, to);
    // 已经带该前缀则取消，实现「再点一次还原」
    const lines = block.split('\n');
    const allPrefixed = lines.every((line) => line.startsWith(prefix));
    const replaced = lines
      .map((line) => (allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`))
      .join('\n');
    onChange({ ...content, markdown: `${current.slice(0, from)}${replaced}${current.slice(to)}` });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(from, from + replaced.length);
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
          <select
            className={mdStyles.select}
            value=""
            title="段落样式"
            onChange={(event) => {
              const prefix = event.target.value;
              if (prefix) applyLinePrefix(prefix);
              event.target.value = '';
            }}
          >
            <option value="">段落样式</option>
            <option value="# ">标题 1</option>
            <option value="## ">标题 2</option>
            <option value="### ">标题 3</option>
            <option value="> ">引用</option>
          </select>

          <span className={mdStyles.divider} />

          <button type="button" className={mdStyles.tool} title="加粗 (Ctrl+B)" onClick={() => applyInline('**', '**', '粗体')}>
            <strong>B</strong>
          </button>
          <button type="button" className={mdStyles.tool} title="斜体 (Ctrl+I)" onClick={() => applyInline('*', '*', '斜体')}>
            <em>I</em>
          </button>
          <button type="button" className={mdStyles.tool} title="删除线" onClick={() => applyInline('~~', '~~', '删除线')}>
            <s>S</s>
          </button>
          <button type="button" className={mdStyles.tool} title="行内代码" onClick={() => applyInline('`', '`', 'code')}>
            {'</>'}
          </button>

          <span className={mdStyles.divider} />

          <button type="button" className={mdStyles.tool} title="无序列表" onClick={() => applyLinePrefix('- ')}>
            • 列表
          </button>
          <button type="button" className={mdStyles.tool} title="有序列表" onClick={() => applyLinePrefix('1. ')}>
            1. 列表
          </button>
          <button type="button" className={mdStyles.tool} title="任务清单" onClick={() => applyLinePrefix('- [ ] ')}>
            ☐ 待办
          </button>

          <span className={mdStyles.divider} />

          <button type="button" className={mdStyles.tool} title="插入链接" onClick={() => applyInline('[', '](https://)', '链接文字')}>
            链接
          </button>
          <button
            type="button"
            className={mdStyles.tool}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="插入图片"
          >
            {uploading ? '上传中…' : '图片'}
          </button>
          <button type="button" className={mdStyles.tool} title="插入表格" onClick={() => insertAtCursor('\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n')}>
            表格
          </button>
          <button type="button" className={mdStyles.tool} title="代码块" onClick={() => insertAtCursor('\n```\n// 代码\n```\n')}>
            代码块
          </button>
          <button type="button" className={mdStyles.tool} title="分割线" onClick={() => insertAtCursor('\n---\n')}>
            分割线
          </button>

          <span className={mdStyles.divider} />

          <button type="button" className={mdStyles.tool} onClick={insertMindmap} title="插入可编辑的思维导图">
            思维导图
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
