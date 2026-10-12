import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { assetApi, type WordContent } from '../../api';
import { createEmbeddedMindmap, EmbeddedMindmapEditor } from '../shared/EmbeddedMindmapEditor';
import { createMindmapEmbedExtension } from './mindmap-embed-extension';
import wordStyles from './word.module.scss';

export interface WordEditorProps {
  content: WordContent;
  canWrite: boolean;
  documentId: string | null;
  shareToken: string | null;
  onChange: (content: WordContent) => void;
}

const MindmapEmbed = createMindmapEmbedExtension(wordStyles.embeddedMindmap);

function ToolButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      className={`${wordStyles.toolButton} ${active ? wordStyles.toolButtonActive : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function WordEditor({ content, canWrite, documentId, shareToken, onChange }: WordEditorProps) {
  const [editingMindmapId, setEditingMindmapId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mindmaps = content.mindmaps ?? {};
  const mindmapsRef = useRef(mindmaps);
  mindmapsRef.current = mindmaps;

  const editor = useEditor({
    editable: canWrite,
    content: content.doc,
    extensions: [
      StarterKit,
      TextStyleKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Image,
      TableKit.configure({ table: { resizable: true } }),
      MindmapEmbed,
    ],
    onUpdate: ({ editor: instance }) => {
      onChange({ ...content, doc: instance.getJSON() });
    },
  });

  // 文档从远端重新加载（如切换路由）时，把最新内容同步进编辑器
  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(content.doc);
    if (current !== next) editor.commands.setContent(content.doc, { emitUpdate: false });
  }, [editor, content.doc]);

  useEffect(() => {
    editor?.setEditable(canWrite);
  }, [editor, canWrite]);

  if (!editor) return null;

  const insertMindmap = () => {
    const mindmap = createEmbeddedMindmap();
    editor.chain().focus().insertMindmapEmbed(mindmap.id).run();
    onChange({ ...content, doc: editor.getJSON(), mindmaps: { ...mindmaps, [mindmap.id]: mindmap } });
    setEditingMindmapId(mindmap.id);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const asset = await assetApi.upload(file, {
        documentId: documentId ?? undefined,
        shareToken: shareToken ?? undefined,
      });
      editor.chain().focus().setImage({ src: asset.url, alt: file.name }).run();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const onContentClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest('[data-mindmap-id]');
    const id = target?.getAttribute('data-mindmap-id');
    if (id) setEditingMindmapId(id);
  };

  const activeMindmap = editingMindmapId ? mindmaps[editingMindmapId] : null;

  return (
    <div className={wordStyles.wrap}>
      {canWrite ? (
        <div className={wordStyles.toolbar}>
          <ToolButton label="撤销" onClick={() => editor.chain().focus().undo().run()}>
            ↶
          </ToolButton>
          <ToolButton label="重做" onClick={() => editor.chain().focus().redo().run()}>
            ↷
          </ToolButton>
          <span className={wordStyles.toolDivider} />
          <ToolButton label="标题 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            H1
          </ToolButton>
          <ToolButton label="标题 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            H2
          </ToolButton>
          <ToolButton label="正文" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}>
            P
          </ToolButton>
          <span className={wordStyles.toolDivider} />
          <ToolButton label="粗体" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <b>B</b>
          </ToolButton>
          <ToolButton label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <i>I</i>
          </ToolButton>
          <ToolButton label="下划线" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <u>U</u>
          </ToolButton>
          <ToolButton label="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <s>S</s>
          </ToolButton>
          <ToolButton label="高亮" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight({ color: '#fff3a3' }).run()}>
            🖍
          </ToolButton>
          <span className={wordStyles.toolDivider} />
          <ToolButton label="左对齐" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
            ⟸
          </ToolButton>
          <ToolButton label="居中" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
            ⟺
          </ToolButton>
          <ToolButton label="右对齐" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
            ⟹
          </ToolButton>
          <span className={wordStyles.toolDivider} />
          <ToolButton label="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            •
          </ToolButton>
          <ToolButton label="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            1.
          </ToolButton>
          <ToolButton label="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            ❝
          </ToolButton>
          <span className={wordStyles.toolDivider} />
          <ToolButton label="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            ▦
          </ToolButton>
          <ToolButton label="插入图片" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            🖼️
          </ToolButton>
          <ToolButton label="插入思维导图" onClick={insertMindmap}>
            🧠
          </ToolButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadImage(file);
              event.target.value = '';
            }}
          />
        </div>
      ) : null}

      <div className={wordStyles.scroll} onClick={onContentClick}>
        <div className={wordStyles.page} data-export-target="word-page">
          <EditorContent editor={editor} className={wordStyles.prose} />
        </div>
      </div>

      {activeMindmap ? (
        <EmbeddedMindmapEditor
          open
          mindmap={activeMindmap}
          canWrite={canWrite}
          onClose={() => setEditingMindmapId(null)}
          onSave={(updated) => {
            onChange({ ...content, doc: editor.getJSON(), mindmaps: { ...mindmapsRef.current, [updated.id]: updated } });
          }}
        />
      ) : null}
    </div>
  );
}
