import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './common.module.scss';

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
}

/** 简单的点击外部关闭下拉菜单，用于卡片操作菜单等场景 */
export function Dropdown({ trigger, children, align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className={styles.dropdown} ref={ref}>
      <span
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </span>
      {open ? (
        <div
          className={styles.dropdownMenu}
          style={align === 'left' ? { right: 'auto', left: 0 } : undefined}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
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
