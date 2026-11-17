import React from 'react';
import { Check } from 'lucide-react';
import {
  formatNotificationHeaderTitle,
  isCompletedTransactionNotification,
} from '../../utils/notificationFormatters.ts';

export interface NotificationHeaderTitleProps {
  title?: string | null;
  type?: string | null;
  itemType?: string | null;
  kind?: string | null;
  className?: string;
  titleClassName?: string;
}

export const NotificationHeaderTitle: React.FC<NotificationHeaderTitleProps> = ({
  title,
  type,
  itemType,
  kind,
  className = '',
  titleClassName = '',
}) => {
  const cleanTitle = formatNotificationHeaderTitle(title);
  const showSuccessCheck = isCompletedTransactionNotification({
    kind,
    type,
    itemType,
    title: cleanTitle,
  });

  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`.trim()}>
      {showSuccessCheck && (
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600"
          aria-hidden="true"
        >
          <Check className="h-4 w-4" />
        </span>
      )}
      <span className={titleClassName}>{cleanTitle}</span>
    </span>
  );
};
