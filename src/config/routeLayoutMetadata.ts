export type SaasRouteMode =
  | 'INSTALLER'
  | 'LANDING'
  | 'AUTH'
  | 'SUPERADMIN'
  | 'TENANT_ACTIVE'
  | 'TENANT_SUSPENDED'
  | 'TENANT_EXPIRED'
  | 'TENANT_NOT_FOUND'
  | 'TENANT_ONBOARDING'
  | 'VERIFY_EMAIL';

export type RouteLayoutPreset = 'dashboard' | 'landing' | 'auth' | 'status' | 'wizard';

export interface RouteLayoutMetadata {
  preset: RouteLayoutPreset;
  showHeader: boolean;
  showSidebar: boolean;
  showFooter: boolean;
  centerMain: boolean;
  sidebarWidth: number;
  collapsedSidebarWidth: number;
  mainOverflowX: 'hidden' | 'clip' | 'visible' | 'auto';
}

export interface RouteLayoutResolutionOptions {
  tab?: string;
  isAuthenticated?: boolean;
  isLoginModalOpen?: boolean;
  isLoading?: boolean;
  overrides?: Partial<RouteLayoutMetadata>;
}

export const DEFAULT_SIDEBAR_WIDTH = 256;
export const DEFAULT_COLLAPSED_SIDEBAR_WIDTH = 72;

export const ROUTE_LAYOUT_METADATA: Record<SaasRouteMode, RouteLayoutMetadata> = {
  // Dashboard & authenticated store routes: Header + Sidebar + Main Content + Footer
  TENANT_ACTIVE: {
    preset: 'dashboard',
    showHeader: true,
    showSidebar: true,
    showFooter: true,
    centerMain: false,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    collapsedSidebarWidth: DEFAULT_COLLAPSED_SIDEBAR_WIDTH,
    mainOverflowX: 'hidden',
  },

  // SaaS Landing: Header + Main Content + Footer (NO sidebar)
  LANDING: {
    preset: 'landing',
    showHeader: true,
    showSidebar: false,
    showFooter: true,
    centerMain: false,
    sidebarWidth: 0,
    collapsedSidebarWidth: 0,
    mainOverflowX: 'clip',
  },

  // Authentication: Centered Main Content (NO sidebar), configurable public header/footer
  AUTH: {
    preset: 'auth',
    showHeader: true,
    showSidebar: false,
    showFooter: true,
    centerMain: true,
    sidebarWidth: 0,
    collapsedSidebarWidth: 0,
    mainOverflowX: 'hidden',
  },

  // SuperAdmin Control Plane: Header + Sidebar + Main Content + Footer when authenticated
  SUPERADMIN: {
    preset: 'dashboard',
    showHeader: true,
    showSidebar: true,
    showFooter: true,
    centerMain: false,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    collapsedSidebarWidth: DEFAULT_COLLAPSED_SIDEBAR_WIDTH,
    mainOverflowX: 'hidden',
  },

  // Other routes: Configurable layout visibility
  VERIFY_EMAIL: {
    preset: 'wizard',
    showHeader: true,
    showSidebar: false,
    showFooter: true,
    centerMain: true,
    sidebarWidth: 0,
    collapsedSidebarWidth: 0,
    mainOverflowX: 'hidden',
  },

  INSTALLER: {
    preset: 'wizard',
    showHeader: true,
    showSidebar: false,
    showFooter: true,
    centerMain: true,
    sidebarWidth: 0,
    collapsedSidebarWidth: 0,
    mainOverflowX: 'hidden',
  },

  TENANT_ONBOARDING: {
    preset: 'wizard',
    showHeader: true,
    showSidebar: false,
    showFooter: true,
    centerMain: false,
    sidebarWidth: 0,
    collapsedSidebarWidth: 0,
    mainOverflowX: 'hidden',
  },

  TENANT_SUSPENDED: {
    preset: 'status',
    showHeader: false,
    showSidebar: false,
    showFooter: false,
    centerMain: true,
    sidebarWidth: 0,
    collapsedSidebarWidth: 0,
    mainOverflowX: 'hidden',
  },

  TENANT_EXPIRED: {
    preset: 'status',
    showHeader: false,
    showSidebar: false,
    showFooter: false,
    centerMain: true,
    sidebarWidth: 0,
    collapsedSidebarWidth: 0,
    mainOverflowX: 'hidden',
  },

  TENANT_NOT_FOUND: {
    preset: 'status',
    showHeader: false,
    showSidebar: false,
    showFooter: false,
    centerMain: true,
    sidebarWidth: 0,
    collapsedSidebarWidth: 0,
    mainOverflowX: 'hidden',
  },
};

const SUB_ROUTE_LAYOUT_OVERRIDES: Record<string, Partial<RouteLayoutMetadata>> = {
  // Store tabs can override layout properties (e.g. custom sidebar width or overflow handling) if needed
  pos: {
    mainOverflowX: 'hidden',
  },
  assistant: {
    mainOverflowX: 'hidden',
  },
};

export function resolveRouteLayoutMetadata(
  mode: SaasRouteMode,
  options: RouteLayoutResolutionOptions = {}
): RouteLayoutMetadata {
  let base = ROUTE_LAYOUT_METADATA[mode] || ROUTE_LAYOUT_METADATA.LANDING;

  // Landing route showing auth modal resolves to Authentication layout (centered main, no sidebar)
  if (mode === 'LANDING' && options.isLoginModalOpen) {
    base = ROUTE_LAYOUT_METADATA.AUTH;
  }

  // SuperAdmin unauthenticated state uses Authentication layout (centered main, no sidebar)
  if (mode === 'SUPERADMIN' && options.isAuthenticated === false) {
    base = ROUTE_LAYOUT_METADATA.AUTH;
  }

  // Active loading transitions center the LoadingWindow without a sidebar
  if (options.isLoading) {
    base = {
      ...base,
      preset: 'auth',
      showHeader: true,
      showSidebar: false,
      showFooter: true,
      centerMain: true,
      sidebarWidth: 0,
      collapsedSidebarWidth: 0,
    };
  }

  const subOverride =
    options.tab && SUB_ROUTE_LAYOUT_OVERRIDES[options.tab]
      ? SUB_ROUTE_LAYOUT_OVERRIDES[options.tab]
      : undefined;

  return {
    ...base,
    ...subOverride,
    ...options.overrides,
  };
}
