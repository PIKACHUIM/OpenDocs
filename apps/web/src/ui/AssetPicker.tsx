import { useCallback, useEffect, useState } from 'react';
import { ApiError, assetApi, type UploadedAsset } from '../api';
import { Modal } from './Modal';
import styles from './common.module.scss';

interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: UploadedAsset) => void;
  /** 绑定到某个文档（图片仍会进入素材库） */
  documentId?: string | null;
  shareToken?: string | null;
}

/**
 * 素材库选择器：图片编辑器与演示文稿共用。
 *
 * 上传走 `/api/assets`，列表走 `GET /api/assets`——两者都是"当前用户的图片"，
 * 所以在一处上传后，另一个编辑器里也能直接选到。
 */
export function AssetPicker({ open, onClose, onSelect, documentId, shareToken }: AssetPickerProps) {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const data = await assetApi.list({ limit: 60 });
      setAssets(data.assets);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '素材加载失败');
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const asset = await assetApi.upload(file, {
        documentId: documentId ?? undefined,
        shareToken: shareToken ?? undefined,
      });
      onSelect(asset);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} title="素材库" onClose={onClose}>
      <div className={styles.row} style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <span className={styles.hint}>上传一次，图片编辑器与演示文稿都能复用。</span>
        <label className={`${styles.button} ${styles.buttonPrimary}`} style={{ cursor: 'pointer' }}>
          {uploading ? '上传中…' : '上传图片'}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {loading ? (
        <div className={styles.center} style={{ padding: 32 }}>
          加载中…
        </div>
      ) : assets.length === 0 ? (
        <div className={styles.empty} style={{ padding: 40 }}>
          还没有素材，先上传一张图片
        </div>
      ) : (
        <div className={styles.assetGrid}>
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className={styles.assetItem}
              onClick={() => {
                onSelect(asset);
                onClose();
              }}
            >
              <img src={asset.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
