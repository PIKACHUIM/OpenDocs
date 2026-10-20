/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 各类图层的默认值。
 * 移植自 poster-design (https://github.com/palxiao/poster-design, AGPL-3.0-or-later)：
 *   widgets/wText/wTextSetting.ts、wImage/wImageSetting.ts、wSvg/wSvgSetting.ts、wQrcode/wQrcodeSetting.ts
 */
import type { BrushWidget, ImageWidget, QrcodeWidget, SvgWidget, TextWidget } from './model';

export function makeText(partial?: Partial<TextWidget>): TextWidget {
  return {
    name: '文本',
    type: 'w-text',
    uuid: '-1',
    editable: false,
    left: 0,
    top: 0,
    width: 360,
    height: 90,
    rotate: 0,
    opacity: 1,
    lineHeight: 1.5,
    letterSpacing: 0,
    fontSize: 24,
    zoom: 1,
    fontClass: {
      alias: '站酷快乐体',
      id: 543,
      value: 'zcool-kuaile-regular',
      url: 'https://lib.baomitu.com/fonts/zcool-kuaile/zcool-kuaile-regular.woff2',
    },
    fontFamily: 'SourceHanSansSC-Regular',
    fontWeight: 'normal',
    fontStyle: 'normal',
    writingMode: 'horizontal-tb',
    textDecoration: 'none',
    color: '#000000ff',
    textAlign: 'left',
    text: '',
    backgroundColor: '',
    parent: '-1',
    record: { width: 0, height: 0, minWidth: 0, minHeight: 0, dir: 'horizontal' },
    ...partial,
  };
}

export function makeImage(partial?: Partial<ImageWidget>): ImageWidget {
  return {
    name: '图片',
    type: 'w-image',
    uuid: '-1',
    width: 300,
    height: 300,
    left: 0,
    top: 0,
    zoom: 1,
    radius: 0,
    opacity: 1,
    rotate: 0,
    parent: '-1',
    imgUrl: '',
    mask: '',
    flip: '',
    isContainer: false,
    lock: false,
    record: { width: 0, height: 0, minWidth: 10, minHeight: 10, dir: 'all' },
    ...partial,
  };
}

export function makeSvg(partial?: Partial<SvgWidget>): SvgWidget {
  return {
    name: '矢量图形',
    type: 'w-svg',
    uuid: '-1',
    width: 200,
    height: 200,
    left: 0,
    top: 0,
    radius: 0,
    opacity: 1,
    rotate: 0,
    parent: '-1',
    svgUrl: '',
    colors: [],
    record: { width: 0, height: 0, minWidth: 10, minHeight: 10 },
    ...partial,
  };
}

export function makeBrush(partial?: Partial<BrushWidget>): BrushWidget {
  return {
    name: '画笔',
    type: 'w-brush',
    uuid: '-1',
    width: 100,
    height: 100,
    left: 0,
    top: 0,
    rotate: 0,
    opacity: 1,
    parent: '-1',
    points: [],
    color: '#1b1f24',
    strokeWidth: 4,
    record: { width: 0, height: 0, minWidth: 1, minHeight: 1 },
    ...partial,
  };
}

export function makeQrcode(partial?: Partial<QrcodeWidget>): QrcodeWidget {
  return {
    name: '二维码',
    type: 'w-qrcode',
    uuid: '-1',
    width: 300,
    height: 300,
    left: 0,
    top: 0,
    zoom: 1,
    radius: 0,
    opacity: 1,
    rotate: 0,
    parent: '-1',
    url: '',
    dotType: 'classy',
    dotColorType: 'single',
    dotRotation: 270,
    dotColor: '#35495E',
    dotColor2: '#35495E',
    value: 'https://example.com',
    record: { width: 0, height: 0, minWidth: 10, minHeight: 10, dir: 'all' },
    ...partial,
  };
}
