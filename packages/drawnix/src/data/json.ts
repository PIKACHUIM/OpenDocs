import { PlaitBoard } from '@plait/core';
import { MIME_TYPES, VERSIONS } from '../constants';
import { fileOpen, fileSave, type FileSystemHandle } from './filesystem';
import { DrawnixExportedData, DrawnixExportedType } from './types';
import { loadFromBlob, normalizeFile } from './blob';

export type DrawnixFileHandle = FileSystemHandle | null;

type FileWithHandle = File & {
  handle?: FileSystemHandle;
};

export const getDefaultName = () => {
  const time = new Date().getTime();
  return time.toString();
};

export const saveAsJSON = async (board: PlaitBoard, name: string = getDefaultName()) => {
  return saveJSON(board, null, name);
};

export const saveJSON = async (
  board: PlaitBoard,
  existingFileHandle: DrawnixFileHandle = null,
  name: string = getDefaultName()
) => {
  const serialized = serializeAsJSON(board);
  const blob = new Blob([serialized], {
    type: MIME_TYPES.drawnix,
  });

  const fileHandle = await fileSave(blob, {
    name,
    // 扩展名保持 .drawnix：这是文件格式标识，改了会破坏历史文件兼容
    extension: 'drawnix',
    description: 'OpenDocs 白板文件',
    fileHandle: existingFileHandle,
  });
  return { fileHandle };
};

export const loadFromJSON = async (board: PlaitBoard) => {
  const file = await fileOpen({
    description: 'OpenDocs 白板文件',
    // ToDo: Be over-permissive until https://bugs.webkit.org/show_bug.cgi?id=34442
    // gets resolved. Else, iOS users cannot open `.drawnix` files.
    // extensions: ["json", "drawnix", "png", "svg"],
  });
  const fileHandle = (file as FileWithHandle).handle || null;
  const data = await loadFromBlob(board, await normalizeFile(file));
  return { data, fileHandle };
};

export const isValidDrawnixData = (data?: any): data is DrawnixExportedData => {
  return (
    data &&
    data.type === DrawnixExportedType.drawnix &&
    Array.isArray(data.elements) &&
    typeof data.viewport === 'object'
  );
};

export const serializeAsJSON = (board: PlaitBoard): string => {
  const data = {
    type: DrawnixExportedType.drawnix,
    version: VERSIONS.drawnix,
    source: 'web',
    elements: board.children,
    viewport: board.viewport,
    theme: board.theme,
  };

  return JSON.stringify(data, null, 2);
};
