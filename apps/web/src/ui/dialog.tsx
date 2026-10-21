import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import styles from './common.module.scss';

/**
 * 应用内弹窗服务：替代 window.alert / confirm / prompt。
 *
 * 原生弹窗在不同浏览器里样式各异、会阻塞渲染，也无法跟随站点主题，
 * 所以在 App 根节点挂一个 DialogHost，各处统一调用这里的函数。
 *
 * 用法（都是 Promise）：
 *   await alertDialog('已保存');
 *   if (!(await confirmDialog('确定删除？', { danger: true }))) return;
 *   const name = await promptDialog('重命名目录', { value: folder.name });
 */

type DialogKind = 'alert' | 'confirm' | 'prompt';

interface DialogRequest {
  kind: DialogKind;
  title: string;
  message: string;
  value?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  resolve: (value: boolean | string | null) => void;
}

export interface DialogOptions {
  title?: string;
  value?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

let pushRequest: ((request: DialogRequest) => void) | null = null;

function show(request: Omit<DialogRequest, 'resolve'>): Promise<boolean | string | null> {
  return new Promise((resolve) => {
    if (!pushRequest) {
      // 宿主没挂载（极少见）：退回原生实现，保证操作不会静默失败
      if (request.kind === 'alert') {
        window.alert(request.message);
        resolve(true);
        return;
      }
      if (request.kind === 'confirm') {
        resolve(window.confirm(request.message));
        return;
      }
      resolve(window.prompt(request.message, request.value ?? ''));
      return;
    }
    pushRequest({ ...request, resolve });
  });
}

export function alertDialog(message: string, options?: DialogOptions): Promise<void> {
  return show({ kind: 'alert', title: options?.title ?? '提示', message, ...options }).then(
    () => undefined
  );
}

export function confirmDialog(message: string, options?: DialogOptions): Promise<boolean> {
  return show({
    kind: 'confirm',
    title: options?.title ?? '请确认',
    message,
    ...options,
  }).then((value) => value === true);
}

export function promptDialog(message: string, options?: DialogOptions): Promise<string | null> {
  return show({
    kind: 'prompt',
    title: options?.title ?? '请输入',
    message,
    ...options,
  }).then((value) => (typeof value === 'string' ? value : null));
}

/** 挂在 App 根节点，全局只需要一个 */
export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    pushRequest = setRequest;
    return () => {
      pushRequest = null;
    };
  }, []);

  useEffect(() => {
    if (!request) return;
    setValue(request.value ?? '');
    if (request.kind === 'prompt') {
      // 等 Modal 渲染完成再聚焦，避免拿不到 ref
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [request]);

  if (!request) return null;

  const close = (result: boolean | string | null) => {
    request.resolve(result);
    setRequest(null);
  };

  const onConfirm = () => {
    if (request.kind === 'prompt') {
      const next = value.trim();
      if (!next) return;
      close(next);
      return;
    }
    close(true);
  };

  return (
    <Modal
      open
      title={request.title}
      onClose={() => close(request.kind === 'alert' ? true : false)}
      footer={
        <>
          {request.kind === 'alert' ? null : (
            <button
              type="button"
              className={styles.button}
              onClick={() => close(request.kind === 'prompt' ? null : false)}
            >
              {request.cancelText ?? '取消'}
            </button>
          )}
          <button
            type="button"
            className={`${styles.button} ${
              request.danger ? styles.buttonDanger : styles.buttonPrimary
            }`}
            onClick={onConfirm}
          >
            {request.confirmText ?? (request.kind === 'alert' ? '知道了' : '确定')}
          </button>
        </>
      }
    >
      <p className={styles.dialogMessage}>{request.message}</p>
      {request.kind === 'prompt' ? (
        <input
          ref={inputRef}
          className={styles.input}
          style={{ width: '100%', marginTop: 10 }}
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onConfirm();
            }
          }}
        />
      ) : null}
    </Modal>
  );
}
