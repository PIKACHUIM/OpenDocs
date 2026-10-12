import { Board, BoardChangeData, Wrapper } from '@plait-board/react-board';
import {
  PlaitBoard,
  PlaitBoardOptions,
  PlaitElement,
  PlaitPlugin,
  PlaitPointerType,
  PlaitTheme,
  BoardTransforms,
  Selection,
  ThemeColorMode,
  Viewport,
} from '@plait/core';
import React, { useState, useRef, useEffect } from 'react';
import { BoardCreationMode, setCreationMode, withGroup } from '@plait/common';
import { withDraw } from '@plait/draw';
import { MindThemeColors, withMind } from '@plait/mind';
import MobileDetect from 'mobile-detect';
import { withMindExtend } from './plugins/with-mind-extend';
import { withCommonPlugin } from './plugins/with-common';
import { CreationToolbar } from './components/toolbar/creation-toolbar';
import { ZoomToolbar } from './components/toolbar/zoom-toolbar';
import { PopupToolbar } from './components/toolbar/popup-toolbar/popup-toolbar';
import { AppToolbar } from './components/toolbar/app-toolbar/app-toolbar';
import classNames from 'classnames';
import './styles/index.scss';
import { buildDrawnixHotkeyPlugin } from './plugins/with-hotkey';
import { buildToolStateSyncPlugin } from './plugins/with-tool-state-sync';
import { withFreehand } from './plugins/freehand/with-freehand';
import { ThemeToolbar } from './components/toolbar/theme-toolbar';
import { buildPencilPlugin } from './plugins/with-pencil';
import {
  DrawnixBoard,
  DrawnixContext,
  DrawnixToolState,
  mergeToolState,
  type DrawnixState,
} from './hooks/use-drawnix';
import { ClosePencilToolbar } from './components/toolbar/pencil-mode-toolbar';
import { TTDDialog } from './components/ttd-dialog/ttd-dialog';
import { CleanConfirm } from './components/clean-confirm/clean-confirm';
import { buildTextLinkPlugin } from './plugins/with-text-link';
import { LinkPopup } from './components/popup/link-popup/link-popup';
import { I18nProvider, setBoardLanguage } from './i18n';
import type { Language } from './i18n/types';
import { Tutorial } from './components/tutorial';
import { LASER_POINTER_CLASS_NAME } from './utils/laser-pointer';
import { Toast, useToast } from './components/toast/toast';
import { ThemeModeContext, useThemeModeState } from './hooks/use-theme-mode';
import type { ColorScheme, ColorTheme } from './hooks/use-theme-mode';

export type DrawnixProps = {
  value: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
  initialToolState?: Partial<DrawnixToolState>;
  initialPreference?: {
    copyTransparent?: boolean;
    exportTransparent?: boolean;
  };
  initialLanguage?: Language;
  /** UI 外观：浅色 / 深色 / 跟随系统，未传入时会自动从 localStorage 恢复 */
  initialColorScheme?: ColorScheme;
  /** UI 主题色（品牌强调色），未传入时会自动从 localStorage 恢复 */
  initialColorTheme?: ColorTheme;
  onChange?: (value: BoardChangeData) => void;
  onSelectionChange?: (selection: Selection | null) => void;
  onValueChange?: (value: PlaitElement[]) => void;
  onViewportChange?: (value: Viewport) => void;
  onThemeChange?: (value: ThemeColorMode) => void;
  onToolStateChange?: (toolState: DrawnixToolState) => void;
  onPreferenceChange?: (preference: {
    copyTransparent: boolean;
    exportTransparent: boolean;
  }) => void;
  onLanguageChange?: (language: Language) => void;
  onColorSchemeChange?: (colorScheme: ColorScheme) => void;
  onColorThemeChange?: (colorTheme: ColorTheme) => void;
  afterInit?: (board: PlaitBoard) => void;
  tutorial?: boolean;
  /** 只读模式：用于分享出去、只允许查看的白板 */
  readonly?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>;

export type { DrawnixToolState } from './hooks/use-drawnix';
export type { ColorScheme, ColorTheme } from './hooks/use-theme-mode';
export { useThemeMode, COLOR_THEMES, COLOR_THEME_SWATCHES } from './hooks/use-theme-mode';

const applyToolStateToBoard = (board: PlaitBoard, toolState: DrawnixToolState) => {
  BoardTransforms.updatePointerType(board, toolState.pointer);
  if (
    toolState.pointer !== PlaitPointerType.hand &&
    toolState.pointer !== PlaitPointerType.selection
  ) {
    setCreationMode(board, BoardCreationMode.drawing);
  }
};

export const Drawnix: React.FC<DrawnixProps> = ({
  value,
  viewport,
  theme,
  initialToolState,
  initialPreference,
  initialLanguage,
  initialColorScheme,
  initialColorTheme,
  onChange,
  onSelectionChange,
  onViewportChange,
  onThemeChange,
  onValueChange,
  onToolStateChange,
  onPreferenceChange,
  onLanguageChange,
  onColorSchemeChange,
  onColorThemeChange,
  afterInit,
  tutorial = false,
  readonly = false,
}) => {
  const options: PlaitBoardOptions = {
    readonly,
    hideScrollbar: true,
    disabledScrollOnNonFocus: false,
    themeColors: MindThemeColors,
  };

  const themeMode = useThemeModeState({
    initialColorScheme,
    initialColorTheme,
    onColorSchemeChange,
    onColorThemeChange,
  });

  const [appState, setAppState] = useState<DrawnixState>(() => {
    const md = new MobileDetect(window.navigator.userAgent);
    return {
      toolState: mergeToolState(initialToolState),
      isMobile: md.mobile() !== null,
      isPencilMode: false,
      fileHandle: null,
      openDialogType: null,
      openCleanConfirm: false,
      copyTransparent: initialPreference?.copyTransparent ?? false,
      exportTransparent: initialPreference?.exportTransparent ?? false,
    };
  });

  const [board, setBoard] = useState<DrawnixBoard | null>(null);
  const [themeColorMode, setThemeColorMode] = useState<ThemeColorMode>(
    theme?.themeColorMode || ThemeColorMode.default
  );
  const { toast, showToast } = useToast();
  const lastKnownLanguageRef = useRef<Language>(initialLanguage ?? 'zh');

  if (board) {
    board.appState = appState;
    board.showToast = showToast;
  }

  useEffect(() => {
    if (!board) {
      return;
    }
    setBoardLanguage(board, lastKnownLanguageRef.current);
  }, [board]);

  const hasMountedToolStateRef = useRef(false);
  const onToolStateChangeRef = useRef(onToolStateChange);
  onToolStateChangeRef.current = onToolStateChange;

  useEffect(() => {
    if (!hasMountedToolStateRef.current) {
      hasMountedToolStateRef.current = true;
      return;
    }
    onToolStateChangeRef.current?.(appState.toolState);
  }, [appState.toolState]);

  const hasMountedPreferenceRef = useRef(false);
  const onPreferenceChangeRef = useRef(onPreferenceChange);
  onPreferenceChangeRef.current = onPreferenceChange;

  useEffect(() => {
    if (!hasMountedPreferenceRef.current) {
      hasMountedPreferenceRef.current = true;
      return;
    }
    onPreferenceChangeRef.current?.({
      copyTransparent: appState.copyTransparent,
      exportTransparent: appState.exportTransparent,
    });
  }, [appState.copyTransparent, appState.exportTransparent]);

  useEffect(() => {
    if (theme?.themeColorMode) {
      setThemeColorMode(theme.themeColorMode);
    }
  }, [theme?.themeColorMode]);

  const updateAppState = (newAppState: Partial<DrawnixState>) => {
    setAppState((currentAppState) => ({
      ...currentAppState,
      ...newAppState,
    }));
  };

  const syncBoardPointerToToolState = (pointer: DrawnixToolState['pointer']) => {
    setAppState((currentAppState) => {
      if (currentAppState.toolState.pointer === pointer) {
        return currentAppState;
      }
      return {
        ...currentAppState,
        toolState: {
          ...currentAppState.toolState,
          pointer,
        },
      };
    });
  };

  const plugins: PlaitPlugin[] = [
    withDraw,
    withGroup,
    withMind,
    withMindExtend,
    withCommonPlugin,
    buildDrawnixHotkeyPlugin(updateAppState),
    withFreehand,
    buildPencilPlugin(updateAppState),
    buildTextLinkPlugin(updateAppState),
    buildToolStateSyncPlugin(syncBoardPointerToToolState),
  ];

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <I18nProvider
      initialLanguage={initialLanguage}
      onLanguageChange={(language) => {
        lastKnownLanguageRef.current = language;
        if (board) {
          setBoardLanguage(board, language);
        }
        onLanguageChange?.(language);
      }}
    >
      <ThemeModeContext.Provider value={themeMode}>
      <DrawnixContext.Provider value={{ appState, setAppState, showToast }}>
        <div
          className={classNames('drawnix', {
            'drawnix--mobile': appState.isMobile,
            [`theme--${themeColorMode}`]: themeColorMode,
          })}
          data-theme={themeMode.resolvedColorScheme}
          data-color-theme={themeMode.colorTheme}
          ref={containerRef}
        >
          <Wrapper
            value={value}
            viewport={viewport}
            theme={theme}
            options={options}
            plugins={plugins}
            onChange={(data: BoardChangeData) => {
              onChange?.(data);
            }}
            onSelectionChange={onSelectionChange}
            onViewportChange={onViewportChange}
            onThemeChange={(value) => {
              setThemeColorMode(value);
              onThemeChange?.(value);
            }}
            onValueChange={onValueChange}
          >
            <Board
              afterInit={(board) => {
                const drawnixBoard = board as DrawnixBoard;
                applyToolStateToBoard(drawnixBoard, appState.toolState);
                setBoard(drawnixBoard);
                afterInit?.(board);
              }}
            >
              {tutorial && board && <Tutorial />}
            </Board>
            <AppToolbar></AppToolbar>
            <CreationToolbar></CreationToolbar>
            <ZoomToolbar></ZoomToolbar>
            <ThemeToolbar></ThemeToolbar>
            <PopupToolbar></PopupToolbar>
            <LinkPopup></LinkPopup>
            <ClosePencilToolbar></ClosePencilToolbar>
            <TTDDialog container={containerRef.current}></TTDDialog>
            <CleanConfirm container={containerRef.current}></CleanConfirm>
            <Toast toast={toast} container={containerRef.current}></Toast>
          </Wrapper>
          <canvas className={`${LASER_POINTER_CLASS_NAME} mouse-course-hidden`}></canvas>
        </div>
      </DrawnixContext.Provider>
      </ThemeModeContext.Provider>
    </I18nProvider>
  );
};
