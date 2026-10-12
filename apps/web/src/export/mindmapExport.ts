import type { MindmapContent } from '../api';
import { downloadText, safeFileName } from './download';

/**
 * 导出为 .drawnix 文件：与本地白板「打开文件」使用的格式完全一致
 * （见 packages/drawnix/src/data/json.ts 的 DrawnixExportedData），
 * 因此导出后可以直接拖回本地白板继续编辑。
 *
 * PNG/SVG 导出复用编辑器里 Drawnix 自带的工具栏菜单（需要拿到存活的 PlaitBoard 实例才能栅格化），
 * 不在这里重复实现。
 */
export function exportMindmapJson(content: MindmapContent, title: string) {
  const payload = {
    type: 'drawnix',
    version: content.version ?? 1,
    source: 'web',
    elements: content.elements,
    viewport: content.viewport ?? { zoom: 1 },
    theme: content.theme,
  };
  downloadText(JSON.stringify(payload, null, 2), safeFileName(title, 'drawnix'), 'application/vnd.drawnix+json');
}
