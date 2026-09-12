import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminIcon } from './AdminIcon';

export interface RowActionItem {
  destructive?: boolean;
  label: string;
  onSelect: () => void;
}

interface RowActionsMenuProps {
  ariaLabel: string;
  items: RowActionItem[];
}

interface MenuPosition {
  left: number;
  top: number;
}

const viewportMargin = 8;
const anchorGap = 6;

export const RowActionsMenu = ({ ariaLabel, items }: RowActionsMenuProps): React.JSX.Element => {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;

    const updatePosition = () => {
      if (!button.current || !menu.current) return;
      const buttonBounds = button.current.getBoundingClientRect();
      const menuBounds = menu.current.getBoundingClientRect();
      const preferredLeft = buttonBounds.right - menuBounds.width;
      const left = Math.max(
        viewportMargin,
        Math.min(preferredLeft, window.innerWidth - menuBounds.width - viewportMargin),
      );
      const fitsBelow =
        buttonBounds.bottom + anchorGap + menuBounds.height <= window.innerHeight - viewportMargin;
      const preferredTop = fitsBelow
        ? buttonBounds.bottom + anchorGap
        : buttonBounds.top - menuBounds.height - anchorGap;
      const top = Math.max(
        viewportMargin,
        Math.min(preferredTop, window.innerHeight - menuBounds.height - viewportMargin),
      );
      setPosition({ left, top });
    };

    updatePosition();
    menu.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!button.current?.contains(event.target) && !menu.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        className="context-menu-trigger"
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <AdminIcon name="more" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            className="context-menu"
            role="menu"
            aria-label={ariaLabel}
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {items.map((item) => (
              <button
                className={`context-menu__item${item.destructive ? ' context-menu__item--danger' : ''}`}
                type="button"
                role="menuitem"
                key={item.label}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};
