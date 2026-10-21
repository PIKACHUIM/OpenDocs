import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './common.module.scss';

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
}

/**
 * 点击外部关闭的下拉菜单。
 *
 * 菜单通过 portal 渲染到 body，并按触发器的位置做 fixed 定位：
 * 列表行、卡片这类容器里的 absolute 菜单会被后续行盖住或被 overflow 裁掉，
 * 表现为「按钮点不动」。挂到 body 上就不受祖先层叠上下文影响。
 */
export function Dropdown({ trigger, children, align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; right: number } | null>(
    null
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 6,
      left: rect.left,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
    // 菜单可能很高，贴着视口底部时向上翻
    const menu = menuRef.current;
    if (menu && position) {
      const height = menu.getBoundingClientRect().height;
      if (position.top + height > window.innerHeight - 8) {
        const rect = anchorRef.current?.getBoundingClientRect();
        if (rect) {
          setPosition((prev) => (prev ? { ...prev, top: Math.max(8, rect.top - height - 6) } : prev));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  return (
    <div className={styles.dropdown} ref={anchorRef}>
      <span
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </span>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.dropdownMenu}
              style={{
                position: 'fixed',
                top: position.top,
                ...(align === 'left'
                  ? { left: position.left, right: 'auto' }
                  : { right: position.right, left: 'auto' }),
              }}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.dropdownItem} ${danger ? styles.dropdownItemDanger : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
