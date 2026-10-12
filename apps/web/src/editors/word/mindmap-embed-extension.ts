import { Node } from '@tiptap/core';

/**
 * 自定义节点：在 Word 文档里内嵌一份思维导图。
 * 节点本身只是一个不可编辑的占位 div（atom），真正的编辑在
 * EmbeddedMindmapEditor 弹窗里完成，数据存在文档内容的 `mindmaps` 字段里，
 * 这里只存一个 id 引用，保持 ProseMirror 文档结构简单。
 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mindmapEmbed: {
      insertMindmapEmbed: (mindmapId: string) => ReturnType;
    };
  }
}

export function createMindmapEmbedExtension(className: string) {
  return Node.create({
    name: 'mindmapEmbed',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        mindmapId: { default: null },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="mindmap-embed"]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        'div',
        {
          ...HTMLAttributes,
          'data-type': 'mindmap-embed',
          'data-mindmap-id': node.attrs.mindmapId,
          class: className,
        },
        '🧠 内嵌思维导图（点击编辑）',
      ];
    },

    addCommands() {
      return {
        insertMindmapEmbed:
          (mindmapId: string) =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { mindmapId } }),
      };
    },
  });
}
