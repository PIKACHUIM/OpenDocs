import { useState } from 'react';
import { assetApi, createId, type PptContent, type PptSlide, type SlideLayout } from '../../api';
import commonStyles from '../../ui/common.module.scss';
import pptStyles from './ppt.module.scss';

export interface PptEditorProps {
  content: PptContent;
  canWrite: boolean;
  documentId: string | null;
  shareToken: string | null;
  onChange: (content: PptContent) => void;
}

const LAYOUT_LABEL: Record<SlideLayout, string> = {
  title: '标题页',
  'title-body': '标题 + 正文',
  'two-column': '左右两栏',
  blank: '空白 + 图片',
};

function newSlide(): PptSlide {
  return { id: createId('slide'), layout: 'title-body', title: '新幻灯片', body: '' };
}

export function PptEditor({ content, canWrite, documentId, shareToken, onChange }: PptEditorProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const slides = content.slides.length > 0 ? content.slides : [newSlide()];
  const active = slides[Math.min(activeIndex, slides.length - 1)];

  const updateSlides = (next: PptSlide[]) => onChange({ ...content, slides: next });

  const updateActive = (patch: Partial<PptSlide>) => {
    updateSlides(slides.map((slide, index) => (index === activeIndex ? { ...slide, ...patch } : slide)));
  };

  const addSlide = () => {
    const next = [...slides, newSlide()];
    updateSlides(next);
    setActiveIndex(next.length - 1);
  };

  const removeSlide = (index: number) => {
    if (slides.length <= 1) return;
    const next = slides.filter((_, i) => i !== index);
    updateSlides(next);
    setActiveIndex(Math.max(0, Math.min(activeIndex, next.length - 1)));
  };

  const moveSlide = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[index], next[target]] = [next[target], next[index]];
    updateSlides(next);
    setActiveIndex(target);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const asset = await assetApi.upload(file, {
        documentId: documentId ?? undefined,
        shareToken: shareToken ?? undefined,
      });
      updateActive({ imageUrl: asset.url });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={pptStyles.wrap}>
      <div className={pptStyles.sidebar}>
        <div className={pptStyles.slideList}>
          {slides.map((slide, index) => (
            <div
              key={slide.id}
              className={`${pptStyles.slideThumb} ${index === activeIndex ? pptStyles.slideThumbActive : ''}`}
              onClick={() => setActiveIndex(index)}
            >
              <div className={pptStyles.slideIndex}>{index + 1}</div>
              <div className={pptStyles.slideThumbInner}>
                <div className={pptStyles.slideThumbTitle}>{slide.title || '未命名幻灯片'}</div>
                <div className={pptStyles.slideThumbBody}>{slide.body}</div>
              </div>
            </div>
          ))}
        </div>
        {canWrite ? (
          <div className={pptStyles.sidebarFooter}>
            <button className={`${commonStyles.button} ${commonStyles.buttonSm}`} onClick={addSlide}>
              + 新建
            </button>
            <button
              className={`${commonStyles.button} ${commonStyles.buttonSm} ${commonStyles.buttonDanger}`}
              onClick={() => removeSlide(activeIndex)}
              disabled={slides.length <= 1}
            >
              删除
            </button>
            <button className={`${commonStyles.button} ${commonStyles.buttonSm}`} onClick={() => moveSlide(activeIndex, -1)}>
              ↑
            </button>
            <button className={`${commonStyles.button} ${commonStyles.buttonSm}`} onClick={() => moveSlide(activeIndex, 1)}>
              ↓
            </button>
          </div>
        ) : null}
      </div>

      <div className={pptStyles.main}>
        <div className={pptStyles.canvasArea}>
          <div
            className={pptStyles.slideCanvas}
            style={{
              background: active.background || '#fff',
              ...(active.layout === 'title' ? { alignItems: 'center', justifyContent: 'center', textAlign: 'center' } : {}),
            }}
          >
            {active.layout === 'title' ? (
              <>
                <div className={pptStyles.titleText}>{active.title || '标题'}</div>
                <div className={pptStyles.bodyText}>{active.body}</div>
              </>
            ) : active.layout === 'two-column' ? (
              <>
                <div className={pptStyles.titleText} style={{ fontSize: 22, marginBottom: 14 }}>
                  {active.title}
                </div>
                <div className={pptStyles.twoColumn}>
                  <div className={pptStyles.twoColumnPane}>{active.body}</div>
                  <div className={pptStyles.twoColumnPane}>{active.bodyRight}</div>
                </div>
              </>
            ) : active.layout === 'blank' ? (
              <div className={pptStyles.blankImage}>
                {active.imageUrl ? <img src={active.imageUrl} alt="" /> : <span style={{ color: '#9aa4b2' }}>暂无图片</span>}
              </div>
            ) : (
              <>
                <div className={pptStyles.titleText} style={{ fontSize: 24, marginBottom: 14 }}>
                  {active.title}
                </div>
                <div style={{ display: 'flex', gap: 20, flex: 1 }}>
                  <div className={pptStyles.bodyText} style={{ flex: 1 }}>
                    {active.body}
                  </div>
                  {active.imageUrl ? <img className={pptStyles.slideImage} src={active.imageUrl} alt="" /> : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {canWrite ? (
        <div className={pptStyles.propPanel}>
          <div className={commonStyles.field}>
            <span className={commonStyles.label}>布局</span>
            <select
              className={commonStyles.select}
              value={active.layout}
              onChange={(event) => updateActive({ layout: event.target.value as SlideLayout })}
            >
              {Object.entries(LAYOUT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className={commonStyles.field}>
            <span className={commonStyles.label}>标题</span>
            <input className={commonStyles.input} value={active.title} onChange={(event) => updateActive({ title: event.target.value })} />
          </div>

          {active.layout !== 'blank' ? (
            <div className={commonStyles.field}>
              <span className={commonStyles.label}>{active.layout === 'two-column' ? '左侧内容' : '正文'}</span>
              <textarea
                className={commonStyles.textarea}
                style={{ minHeight: 100 }}
                value={active.body}
                onChange={(event) => updateActive({ body: event.target.value })}
              />
            </div>
          ) : null}

          {active.layout === 'two-column' ? (
            <div className={commonStyles.field}>
              <span className={commonStyles.label}>右侧内容</span>
              <textarea
                className={commonStyles.textarea}
                style={{ minHeight: 100 }}
                value={active.bodyRight ?? ''}
                onChange={(event) => updateActive({ bodyRight: event.target.value })}
              />
            </div>
          ) : null}

          <div className={commonStyles.field}>
            <span className={commonStyles.label}>背景色</span>
            <input
              type="color"
              value={active.background || '#ffffff'}
              onChange={(event) => updateActive({ background: event.target.value })}
            />
          </div>

          {active.layout === 'blank' || active.layout === 'title-body' ? (
            <div className={commonStyles.field}>
              <span className={commonStyles.label}>图片</span>
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadImage(file);
                  event.target.value = '';
                }}
              />
              {active.imageUrl ? (
                <button className={`${commonStyles.button} ${commonStyles.buttonSm}`} onClick={() => updateActive({ imageUrl: undefined })}>
                  移除图片
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
