import React, { useContext } from 'react';
import classNames from 'classnames';
import { MoonIcon, MonitorIcon, PaletteIcon, SunIcon, ThickCheckIcon } from '../../icons';
import { useI18n } from '../../../i18n';
import type { Translations } from '../../../i18n/types';
import Menu from '../../menu/menu';
import MenuItem from '../../menu/menu-item';
import { MenuContentPropsContext } from '../../menu/common';
import { EVENT } from '../../../constants';
import {
  COLOR_THEMES,
  COLOR_THEME_SWATCHES,
  useThemeMode,
  type ColorTheme,
} from '../../../hooks/use-theme-mode';
import './appearance-switcher-menu.scss';

const dispatchMenuItemSelect = (onSelect?: (event: Event) => void) => {
  const itemSelectEvent = new CustomEvent(EVENT.MENU_ITEM_SELECT, {
    bubbles: true,
    cancelable: true,
  });
  onSelect?.(itemSelectEvent);
};

export const AppearanceSwitcherMenu = () => {
  const { t } = useI18n();
  const { colorScheme, setColorScheme } = useThemeMode();
  const menuContentProps = useContext(MenuContentPropsContext);

  const triggerIcon =
    colorScheme === 'dark' ? MoonIcon : colorScheme === 'system' ? MonitorIcon : SunIcon;

  return (
    <MenuItem
      icon={triggerIcon}
      data-testid="appearance-switcher-button"
      onSelect={() => {
        // This will be handled by the submenu
      }}
      submenu={
        <Menu onSelect={() => dispatchMenuItemSelect(menuContentProps.onSelect)}>
          <MenuItem
            icon={SunIcon}
            onSelect={() => setColorScheme('light')}
            aria-label={t('appearance.light')}
            selected={colorScheme === 'light'}
          >
            {t('appearance.light')}
          </MenuItem>
          <MenuItem
            icon={MoonIcon}
            onSelect={() => setColorScheme('dark')}
            aria-label={t('appearance.dark')}
            selected={colorScheme === 'dark'}
          >
            {t('appearance.dark')}
          </MenuItem>
          <MenuItem
            icon={MonitorIcon}
            onSelect={() => setColorScheme('system')}
            aria-label={t('appearance.system')}
            selected={colorScheme === 'system'}
          >
            {t('appearance.system')}
          </MenuItem>
        </Menu>
      }
      aria-label={t('appearance.switcher')}
    >
      {t('appearance.switcher')}
    </MenuItem>
  );
};

AppearanceSwitcherMenu.displayName = 'AppearanceSwitcherMenu';

const COLOR_THEME_LABEL_KEYS: Record<ColorTheme, keyof Translations> = {
  blue: 'colorTheme.blue',
  violet: 'colorTheme.violet',
  green: 'colorTheme.green',
  orange: 'colorTheme.orange',
  pink: 'colorTheme.pink',
  teal: 'colorTheme.teal',
};

const ColorThemeSwatchGrid = () => {
  const { t } = useI18n();
  const { colorTheme, setColorTheme } = useThemeMode();
  const menuContentProps = useContext(MenuContentPropsContext);

  return (
    <div
      className="color-theme-swatch-grid"
      role="radiogroup"
      aria-label={t('colorTheme.switcher')}
    >
      {COLOR_THEMES.map((item) => (
        <button
          key={item}
          type="button"
          role="radio"
          aria-checked={colorTheme === item}
          title={t(COLOR_THEME_LABEL_KEYS[item])}
          aria-label={t(COLOR_THEME_LABEL_KEYS[item])}
          className={classNames('color-theme-swatch', {
            'color-theme-swatch--active': colorTheme === item,
          })}
          style={{ '--swatch-color': COLOR_THEME_SWATCHES[item] } as React.CSSProperties}
          onClick={() => {
            setColorTheme(item);
            dispatchMenuItemSelect(menuContentProps.onSelect);
          }}
        >
          {colorTheme === item && (
            <span className="color-theme-swatch__check">{ThickCheckIcon}</span>
          )}
        </button>
      ))}
    </div>
  );
};

export const ColorThemeSwitcherMenu = () => {
  const { t } = useI18n();
  const menuContentProps = useContext(MenuContentPropsContext);

  return (
    <MenuItem
      icon={PaletteIcon}
      data-testid="color-theme-switcher-button"
      onSelect={() => {
        // This will be handled by the submenu
      }}
      submenu={
        <Menu onSelect={() => dispatchMenuItemSelect(menuContentProps.onSelect)}>
          <ColorThemeSwatchGrid />
        </Menu>
      }
      aria-label={t('colorTheme.switcher')}
    >
      {t('colorTheme.switcher')}
    </MenuItem>
  );
};

ColorThemeSwitcherMenu.displayName = 'ColorThemeSwitcherMenu';
