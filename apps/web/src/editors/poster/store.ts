/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 图片/海报编辑器状态。
 *
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)：
 *   store/design/canvas       → 画布缩放、标尺线、页面
 *   store/design/widget       → dWidgets / dLayouts / 选中 / 多选 / 复制粘贴
 *   store/design/widget/actions/{align,layer,group,clone,select,widget,resize}
 *   store/design/history      → 基于 immer patches 的差量撤销栈（不是整份快照）
 *
 * 数据结构保持一致：扁平的 widgets 数组 + parent 指针 + w-group 容器。
 */
import { enablePatches, applyPatches, produceWithPatches, type Patch } from 'immer';
import { customAlphabet } from 'nanoid/non-secure';
import { create } from 'zustand';
import {
  pageDefault,
  type PosterLayout,
  type PosterPage,
  type Widget,
} from './model';

enablePatches();

const nanoid = customAlphabet('1234567890abcdef', 12);
export const newUuid = () => nanoid();

export type AlignKind = 'left' | 'ch' | 'right' | 'top' | 'cv' | 'bottom';

interface HistoryStack {
  changes: Patch[][];
  inverseChanges: Patch[][];
  pointer: number;
}

const MAX_HISTORY = 50;

interface PosterState {
  layouts: PosterLayout[];
  currentPage: number;
  /** 当前选中的图层 uuid 集合；空数组 = 选中画布本身 */
  selected: string[];
  zoom: number;
  copied: Widget[];
  history: HistoryStack;
  /** 辅助线（标尺拖出的参考线） */
  guidelines: { vertical: number[]; horizontal: number[] };
  dirty: number;

  // 派生
  page: () => PosterPage;
  widgets: () => Widget[];
  active: () => Widget | PosterPage;

  // 载入/导出
  load: (layouts: PosterLayout[]) => void;
  serialize: () => PosterLayout[];

  // 选择
  select: (uuid: string | null, additive?: boolean) => void;
  selectMany: (uuids: string[]) => void;

  // 图层增删改
  addWidget: (widget: Widget) => void;
  addGroup: (group: Widget[]) => void;
  updateWidget: (uuid: string, patch: Partial<Widget> | Record<string, unknown>) => void;
  updatePage: (patch: Partial<PosterPage>) => void;
  deleteSelected: () => void;
  copySelected: () => void;
  paste: () => void;
  duplicateSelected: () => void;

  // 排列
  align: (kind: AlignKind, uuid?: string) => void;
  moveLayer: (uuid: string, value: number) => void;
  lockToggle: (uuid: string) => void;
  groupSelected: () => void;
  ungroup: (uuid: string) => void;

  // 历史
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // 画布
  setZoom: (zoom: number) => void;
  setGuidelines: (g: { vertical: number[]; horizontal: number[] }) => void;
}

const emptyHistory = (): HistoryStack => ({ changes: [], inverseChanges: [], pointer: -1 });

/** 让 immer 产生 patch：对 layouts 做一次纯函数修改并写入历史栈 */
function mutate(
  set: (partial: Partial<PosterState> | ((s: PosterState) => Partial<PosterState>)) => void,
  get: () => PosterState,
  recipe: (draft: PosterLayout[]) => void,
  options?: { record?: boolean }
) {
  const { layouts, history } = get();
  const [next, patches, inverse] = produceWithPatches(layouts, recipe);
  if (patches.length === 0) return;

  if (options?.record === false) {
    set({ layouts: next, dirty: get().dirty + 1 });
    return;
  }

  const pointer = history.pointer + 1;
  const changes = history.changes.slice(0, pointer);
  const inverseChanges = history.inverseChanges.slice(0, pointer);
  changes[pointer] = patches;
  inverseChanges[pointer] = inverse;

  // 超出上限时丢弃最旧的一条
  if (changes.length > MAX_HISTORY) {
    changes.shift();
    inverseChanges.shift();
  }

  set({
    layouts: next,
    history: { changes, inverseChanges, pointer: changes.length - 1 },
    dirty: get().dirty + 1,
  });
}

export const usePosterStore = create<PosterState>((set, get) => ({
  layouts: [{ global: pageDefault(), layers: [] }],
  currentPage: 0,
  selected: [],
  zoom: 50,
  copied: [],
  history: emptyHistory(),
  guidelines: { vertical: [], horizontal: [] },
  dirty: 0,

  page: () => get().layouts[get().currentPage].global,
  widgets: () => get().layouts[get().currentPage].layers,
  active: () => {
    const { selected } = get();
    if (selected.length === 1) {
      const found = get().widgets().find((item) => item.uuid === selected[0]);
      if (found) return found;
    }
    return get().page();
  },

  load: (layouts) =>
    set({
      layouts: layouts.length ? layouts : [{ global: pageDefault(), layers: [] }],
      currentPage: 0,
      selected: [],
      history: emptyHistory(),
    }),

  serialize: () => get().layouts,

  // ---------------------------------------------------------------- 选择

  select: (uuid, additive) => {
    if (uuid === null || uuid === '-1') {
      set({ selected: [] });
      return;
    }
    const widget = get().widgets().find((item) => item.uuid === uuid);
    if (!widget) return;
    // 组合内的子元素点击时选中其容器，行为与原项目一致
    const target = widget.parent !== '-1' ? widget.parent : uuid;
    if (additive) {
      const { selected } = get();
      set({
        selected: selected.includes(target)
          ? selected.filter((item) => item !== target)
          : [...selected, target],
      });
    } else {
      set({ selected: [target] });
    }
  },

  selectMany: (uuids) => set({ selected: uuids }),

  // ---------------------------------------------------------------- 图层

  addWidget: (widget) => {
    const page = get().page();
    const next: Widget = { ...widget, uuid: newUuid() };

    // 超出画布时等比缩小并居中（constrainToCanvas）
    const w = Number(next.width);
    const h = Number(next.height);
    if (w && h && (w > page.width || h > page.height)) {
      const ratio = Math.min(page.width / w, page.height / h);
      next.width = Math.round(w * ratio);
      next.height = Math.round(h * ratio);
      next.left = page.width / 2 - next.width / 2;
      next.top = page.height / 2 - next.height / 2;
    }

    mutate(set, get, (draft) => {
      draft[get().currentPage].layers.push(next);
    });
    set({ selected: [next.uuid] });
  },

  addGroup: (group) => {
    const page = get().page();
    const cloned: Widget[] = JSON.parse(JSON.stringify(group));

    // constrainGroupToCanvas：以包围盒整体缩放
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of cloned) {
      minX = Math.min(minX, item.left);
      minY = Math.min(minY, item.top);
      maxX = Math.max(maxX, item.left + item.width);
      maxY = Math.max(maxY, item.top + item.height);
    }
    const gw = maxX - minX;
    const gh = maxY - minY;
    if (gw && gh && (gw > page.width || gh > page.height)) {
      const ratio = Math.min(page.width / gw, page.height / gh);
      const cx = minX + gw / 2;
      const cy = minY + gh / 2;
      for (const item of cloned) {
        item.left = Math.round(page.width / 2 + (item.left - cx) * ratio);
        item.top = Math.round(page.height / 2 + (item.top - cy) * ratio);
        item.width = Math.round(item.width * ratio);
        item.height = Math.round(item.height * ratio);
        if (item.type === 'w-text') item.fontSize = Math.round(item.fontSize * ratio);
      }
    }

    // 重设 id 与父子关系
    const container = cloned.find((item) => item.type === 'w-group');
    const idMap = new Map<string, string>();
    for (const item of cloned) {
      const fresh = newUuid();
      idMap.set(item.uuid, fresh);
      item.uuid = fresh;
    }
    for (const item of cloned) {
      item.parent = !item.isContainer && container ? container.uuid : '-1';
    }

    mutate(set, get, (draft) => {
      draft[get().currentPage].layers.push(...cloned);
    });
    set({ selected: [container?.uuid ?? cloned[cloned.length - 1].uuid] });
  },

  updateWidget: (uuid, patch) => {
    mutate(set, get, (draft) => {
      const layers = draft[get().currentPage].layers;
      const target = layers.find((item) => item.uuid === uuid);
      if (!target) return;

      // 容器移动时，子元素同步位移（updateWidgetData 的 isContainer 分支）
      const record = patch as Record<string, unknown>;
      if (target.isContainer) {
        const dx = typeof record.left === 'number' ? record.left - target.left : 0;
        const dy = typeof record.top === 'number' ? record.top - target.top : 0;
        if (dx || dy) {
          for (const child of layers) {
            if (child.parent === target.uuid) {
              child.left += dx;
              child.top += dy;
            }
          }
        }
      }
      Object.assign(target, patch);

      // 子元素变化后重算所在组合的包围盒（updateGroupSize）
      if (target.parent !== '-1') {
        const group = layers.find((item) => item.uuid === target.parent);
        if (group) {
          const children = layers.filter((item) => item.parent === group.uuid);
          const left = Math.min(...children.map((item) => item.left));
          const top = Math.min(...children.map((item) => item.top));
          const right = Math.max(...children.map((item) => item.left + item.width));
          const bottom = Math.max(...children.map((item) => item.top + item.height));
          group.left = left;
          group.top = top;
          group.width = right - left;
          group.height = bottom - top;
        }
      }
    });
  },

  updatePage: (patch) => {
    mutate(set, get, (draft) => {
      Object.assign(draft[get().currentPage].global, patch);
    });
  },

  deleteSelected: () => {
    const { selected } = get();
    if (selected.length === 0) return;
    mutate(set, get, (draft) => {
      const layer = draft[get().currentPage];
      layer.layers = layer.layers.filter(
        (item) => !selected.includes(item.uuid) && !selected.includes(item.parent)
      );
    });
    set({ selected: [] });
  },

  copySelected: () => {
    const { selected } = get();
    if (selected.length === 0) return;
    const widgets = get().widgets();
    const picked: Widget[] = [];
    for (const uuid of selected) {
      const found = widgets.find((item) => item.uuid === uuid);
      if (!found) continue;
      picked.push(found);
      if (found.isContainer) {
        picked.push(...widgets.filter((item) => item.parent === uuid));
      }
    }
    set({ copied: JSON.parse(JSON.stringify(picked)) });
  },

  paste: () => {
    const { copied } = get();
    if (copied.length === 0) return;
    const items: Widget[] = JSON.parse(JSON.stringify(copied));
    const container = items.find((item) => item.isContainer);
    for (const item of items) {
      const fresh = newUuid();
      item.uuid = fresh;
      item.parent = container && item !== container ? container.uuid : '-1';
      item.left += 30;
      item.top += 30;
    }
    // 子元素的 parent 需要指向新容器 uuid
    if (container) {
      for (const item of items) {
        if (item !== container) item.parent = container.uuid;
      }
    }
    mutate(set, get, (draft) => {
      draft[get().currentPage].layers.push(...items);
    });
    set({
      selected: container ? [container.uuid] : items.map((item) => item.uuid),
      // 连续粘贴时位置继续错开（pasteWidget 末尾再次 copy）
      copied: JSON.parse(JSON.stringify(items)),
    });
  },

  duplicateSelected: () => {
    get().copySelected();
    get().paste();
  },

  // ---------------------------------------------------------------- 排列

  align: (kind, uuid) => {
    const target = uuid ?? get().selected[0];
    if (!target) return;
    const page = get().page();
    mutate(set, get, (draft) => {
      const layers = draft[get().currentPage].layers;
      const widget = layers.find((item) => item.uuid === target);
      if (!widget) return;

      let left = widget.left;
      let top = widget.top;
      switch (kind) {
        case 'left':
          left = 0;
          break;
        case 'ch':
          left = page.width / 2 - widget.width / 2;
          break;
        case 'right':
          left = page.width - widget.width;
          break;
        case 'top':
          top = 0;
          break;
        case 'cv':
          top = page.height / 2 - widget.height / 2;
          break;
        case 'bottom':
          top = page.height - widget.height;
          break;
      }

      if (widget.isContainer) {
        const dx = left - widget.left;
        const dy = top - widget.top;
        for (const child of layers) {
          if (child.parent === widget.uuid) {
            child.left += dx;
            child.top += dy;
          }
        }
      }
      widget.left = left;
      widget.top = top;
    });
  },

  moveLayer: (uuid, value) => {
    // 简化 updateLayerIndex：容器连同子元素整体搬移
    mutate(set, get, (draft) => {
      const layers = draft[get().currentPage].layers;
      const index = layers.findIndex((item) => item.uuid === uuid);
      if (index < 0) return;
      const widget = layers[index];

      const block = widget.isContainer
        ? [widget, ...layers.filter((item) => item.parent === uuid)]
        : [widget];
      const rest = layers.filter((item) => !block.includes(item));

      // 在「只含顶层元素」的序列上移动，避免跑进别的组合内部
      const topIndexes = rest
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => item.parent === '-1' || widget.parent !== '-1');
      const currentTop = topIndexes.findIndex(({ i }) => i >= index - (layers.length - rest.length));
      const target = Math.max(0, Math.min(topIndexes.length, (currentTop < 0 ? 0 : currentTop) + value));
      const insertAt = target >= topIndexes.length ? rest.length : topIndexes[target].i;

      rest.splice(insertAt, 0, ...block);
      draft[get().currentPage].layers = rest;
    });
  },

  lockToggle: (uuid) => {
    mutate(set, get, (draft) => {
      const widget = draft[get().currentPage].layers.find((item) => item.uuid === uuid);
      if (widget) widget.lock = !widget.lock;
    });
  },

  groupSelected: () => {
    const { selected } = get();
    if (selected.length < 2) return;
    mutate(set, get, (draft) => {
      const layers = draft[get().currentPage].layers;
      const members = layers.filter((item) => selected.includes(item.uuid) && !item.isContainer);
      if (members.length < 2) return;
      const left = Math.min(...members.map((item) => item.left));
      const top = Math.min(...members.map((item) => item.top));
      const right = Math.max(...members.map((item) => item.left + item.width));
      const bottom = Math.max(...members.map((item) => item.top + item.height));
      const uuid = newUuid();
      const group: Widget = {
        type: 'w-group',
        name: '组合',
        uuid,
        left,
        top,
        width: right - left,
        height: bottom - top,
        rotate: 0,
        opacity: 1,
        parent: '-1',
        isContainer: true,
        record: { width: right - left, height: bottom - top, minWidth: 10, minHeight: 10 },
      };
      const first = layers.findIndex((item) => item.uuid === members[0].uuid);
      for (const member of members) member.parent = uuid;
      layers.splice(first, 0, group);
      set({ selected: [uuid] });
    });
  },

  ungroup: (uuid) => {
    mutate(set, get, (draft) => {
      const layers = draft[get().currentPage].layers;
      const index = layers.findIndex((item) => item.uuid === uuid);
      if (index < 0) return;
      layers.splice(index, 1);
      for (const item of layers) {
        if (item.parent === uuid) item.parent = '-1';
      }
    });
    set({ selected: [] });
  },

  // ---------------------------------------------------------------- 历史

  commit: () => {
    // 拖拽结束时调用：历史在 mutate 内已逐次写入，这里仅作为外部显式落点
    set({ dirty: get().dirty + 1 });
  },

  undo: () => {
    const { history, layouts } = get();
    if (history.pointer < 0) return;
    const next = applyPatches(layouts, history.inverseChanges[history.pointer]);
    set({
      layouts: next,
      history: { ...history, pointer: history.pointer - 1 },
      selected: [],
      dirty: get().dirty + 1,
    });
  },

  redo: () => {
    const { history, layouts } = get();
    if (history.pointer >= history.changes.length - 1) return;
    const nextPointer = history.pointer + 1;
    const next = applyPatches(layouts, history.changes[nextPointer]);
    set({
      layouts: next,
      history: { ...history, pointer: nextPointer },
      selected: [],
      dirty: get().dirty + 1,
    });
  },

  canUndo: () => get().history.pointer >= 0,
  canRedo: () => get().history.pointer < get().history.changes.length - 1,

  // ---------------------------------------------------------------- 画布

  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(400, Math.round(zoom))) }),
  setGuidelines: (guidelines) => set({ guidelines }),
}));
