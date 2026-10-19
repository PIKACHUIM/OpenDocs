import type { ExcelContent } from '../../api';

export interface ExcelEditorProps {
  content: ExcelContent;
  canWrite: boolean;
  onChange: (content: ExcelContent) => void;
}
