import React from 'react';
import { ShowroomBackground } from './ShowroomBackground.tsx';
import { PublicHeader, PublicHeaderProps } from './PublicHeader.tsx';
import { PublicFooter } from './PublicFooter.tsx';
import { BodyLayoutWrapper } from './BodyLayoutWrapper.tsx';
import type { RouteLayoutMetadata } from '../../config/routeLayoutMetadata.ts';

export interface PublicLayoutProps extends PublicHeaderProps {
  children: React.ReactNode;
  contentClassName?: string;
  layoutMeta?: Partial<RouteLayoutMetadata>;
}

/**
 * PublicLayout
 * Standard wrapper for public and onboarding routes (Loading, Auth, InstallWizard)
 * built on top of BodyLayoutWrapper with showroom background, global header, and global footer.
 */
export const PublicLayout: React.FC<PublicLayoutProps> = ({
  children,
  storeName,
  badgeText,
  badgeVariant,
  subtitle,
  dbText,
  contentClassName = '',
  layoutMeta,
  ...rest
}) => {
  return (
    <BodyLayoutWrapper
      layoutMeta={{
        preset: 'wizard',
        showHeader: true,
        showSidebar: false,
        showFooter: true,
        centerMain: true,
        ...layoutMeta,
      }}
      backdrop={<ShowroomBackground />}
      header={
        <PublicHeader
          storeName={storeName}
          badgeText={badgeText}
          badgeVariant={badgeVariant}
          subtitle={subtitle}
          dbText={dbText}
          {...rest}
        />
      }
      footer={<PublicFooter storeName={storeName} subtitle={subtitle} />}
      className="bg-slate-200 dark:bg-[#0A0E1A] text-slate-900 dark:text-slate-100 font-sans selection:bg-purple-600 selection:text-white transition-colors duration-200"
      mainClassName={`relative z-10 px-4 py-6 sm:px-8 sm:py-10 ${contentClassName}`}
    >
      {children}
    </BodyLayoutWrapper>
  );
};
