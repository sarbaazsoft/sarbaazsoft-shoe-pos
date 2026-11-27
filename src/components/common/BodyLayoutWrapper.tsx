import React from 'react';
import {
  DEFAULT_SIDEBAR_WIDTH,
  type RouteLayoutMetadata,
} from '../../config/routeLayoutMetadata.ts';

export interface BodyLayoutWrapperProps {
  /** Top header slot */
  header?: React.ReactNode;
  /** Left sidebar slot */
  sidebar?: React.ReactNode;
  /** Bottom footer slot */
  footer?: React.ReactNode;
  /** Main content */
  children?: React.ReactNode;
  /** Route metadata controlling layout visibility, centering, overflow, and sidebar width */
  layoutMeta?: Partial<RouteLayoutMetadata>;
  /** Explicit header visibility override */
  showHeader?: boolean;
  /** Explicit sidebar visibility override */
  showSidebar?: boolean;
  /** Explicit footer visibility override */
  showFooter?: boolean;
  /** Center main content horizontally and vertically */
  centerMain?: boolean;
  /** Configurable desktop sidebar width (number in px or CSS length) */
  sidebarWidth?: number | string;
  /** Set true when child Sidebar component manages its own responsive width & mobile drawer */
  sidebarSelfSized?: boolean;
  /** Optional background/backdrop node (rendered behind header/body/footer) */
  backdrop?: React.ReactNode;
  /** Optional banner rendered directly beneath the header (full width) */
  topBanner?: React.ReactNode;
  /** Optional ref attached to <main> */
  mainRef?: React.Ref<HTMLElement>;
  /** Optional ref attached to outer wrapper */
  wrapperRef?: React.Ref<HTMLDivElement>;
  id?: string;
  role?: React.AriaRole;
  'aria-live'?: 'off' | 'polite' | 'assertive';
  'data-landing-theme'?: string;
  style?: React.CSSProperties;
  className?: string;
  headerContainerClassName?: string;
  bodyRowClassName?: string;
  sidebarContainerClassName?: string;
  mainClassName?: string;
  footerContainerClassName?: string;
}

function formatCssWidth(width: number | string | undefined): string {
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    return `${width}px`;
  }
  if (typeof width === 'string' && width.trim().length > 0) {
    return width.trim();
  }
  return `${DEFAULT_SIDEBAR_WIDTH}px`;
}

function getMainOverflowXClass(overflow?: RouteLayoutMetadata['mainOverflowX']): string {
  switch (overflow) {
    case 'clip':
      return 'overflow-x-clip';
    case 'visible':
      return 'overflow-x-visible';
    case 'auto':
      return 'overflow-x-auto';
    case 'hidden':
    default:
      return 'overflow-x-hidden';
  }
}

/**
 * Global Flexbox Body Layout Wrapper
 *
 * Structure:
 *  - Header at top (optional, controlled via route metadata or props)
 *  - Middle flex row (`flex-1 flex min-w-0`):
 *    - Left: Sidebar (optional, configurable width)
 *    - Right (`flex-1 min-w-0 min-h-0 flex flex-col justify-between`):
 *      - Main Content Area on top (`flex-1 min-w-0 flex flex-col`)
 *      - Footer at bottom (pins to bottom on short pages, follows content naturally on long pages)
 *  - Outer wrapper uses `min-h-[100dvh]` (`min-height: 100dvh`)
 */
export const BodyLayoutWrapper: React.FC<BodyLayoutWrapperProps> = ({
  header,
  sidebar,
  footer,
  children,
  layoutMeta,
  showHeader,
  showSidebar,
  showFooter,
  centerMain,
  sidebarWidth,
  sidebarSelfSized = false,
  backdrop,
  topBanner,
  mainRef,
  wrapperRef,
  id,
  role,
  'aria-live': ariaLive,
  'data-landing-theme': dataLandingTheme,
  style,
  className = '',
  headerContainerClassName = '',
  bodyRowClassName = '',
  sidebarContainerClassName = '',
  mainClassName = '',
  footerContainerClassName = '',
}) => {
  const resolvedShowHeader = showHeader ?? layoutMeta?.showHeader ?? Boolean(header);
  const resolvedShowSidebar = showSidebar ?? layoutMeta?.showSidebar ?? Boolean(sidebar);
  const resolvedShowFooter = showFooter ?? layoutMeta?.showFooter ?? Boolean(footer);
  const resolvedCenterMain = centerMain ?? layoutMeta?.centerMain ?? false;

  const hasHeader = Boolean(resolvedShowHeader && header);
  const hasSidebar = Boolean(resolvedShowSidebar && sidebar);
  const hasFooter = Boolean(resolvedShowFooter && footer);

  const effectiveSidebarWidth = formatCssWidth(
    sidebarWidth ?? (layoutMeta?.sidebarWidth && layoutMeta.sidebarWidth > 0 ? layoutMeta.sidebarWidth : undefined)
  );
  const overflowXClass = getMainOverflowXClass(layoutMeta?.mainOverflowX);

  return (
    <div
      ref={wrapperRef}
      id={id}
      role={role}
      aria-live={ariaLive}
      data-layout-wrapper="true"
      data-layout-preset={layoutMeta?.preset}
      data-has-header={hasHeader ? 'true' : 'false'}
      data-has-sidebar={hasSidebar ? 'true' : 'false'}
      data-has-footer={hasFooter ? 'true' : 'false'}
      data-center-main={resolvedCenterMain ? 'true' : 'false'}
      data-landing-theme={dataLandingTheme}
      style={{
        ...style,
        ...(hasSidebar
          ? ({ '--layout-sidebar-width': effectiveSidebarWidth } as React.CSSProperties)
          : {}),
      }}
      className={`min-h-[100dvh] w-full flex flex-col relative overflow-x-clip ${className}`}
    >
      {backdrop}

      {hasHeader && (
        <div
          data-layout-section="header"
          className={`shrink-0 sticky top-0 z-40 w-full ${headerContainerClassName}`}
        >
          {header}
        </div>
      )}

      {topBanner}

      <div
        data-layout-section="body"
        className={`relative flex-1 flex min-w-0 min-h-0 w-full ${bodyRowClassName}`}
      >
        {hasSidebar && (
          <div
            data-layout-section="sidebar"
            style={
              sidebarSelfSized
                ? undefined
                : ({
                    '--layout-sidebar-width': effectiveSidebarWidth,
                    width: effectiveSidebarWidth,
                  } as React.CSSProperties)
            }
            className={
              sidebarSelfSized
                ? `shrink-0 ${sidebarContainerClassName}`
                : `hidden lg:flex lg:flex-col shrink-0 ${sidebarContainerClassName}`
            }
          >
            {sidebar}
          </div>
        )}

        <div
          data-layout-section="content-column"
          className="flex-1 min-w-0 min-h-0 flex flex-col justify-between"
        >
          <main
            ref={mainRef}
            data-layout-section="main"
            className={`flex-1 min-w-0 flex flex-col ${overflowXClass} ${
              resolvedCenterMain ? 'items-center justify-center' : ''
            } ${mainClassName}`}
          >
            {children}
          </main>

          {hasFooter && (
            <div
              data-layout-section="footer"
              className={`shrink-0 w-full relative z-10 ${footerContainerClassName}`}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
