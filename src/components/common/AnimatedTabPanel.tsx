import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export function useTabDirection<T extends string>(
  activeTab: T,
  order: readonly T[]
): 1 | -1 {
  const trackerRef = useRef<{ prevTab: T; direction: 1 | -1 }>({
    prevTab: activeTab,
    direction: 1,
  });

  if (trackerRef.current.prevTab !== activeTab) {
    const prevIdx = order.indexOf(trackerRef.current.prevTab);
    const nextIdx = order.indexOf(activeTab);
    const direction: 1 | -1 =
      prevIdx !== -1 && nextIdx !== -1 && nextIdx < prevIdx ? -1 : 1;
    trackerRef.current = { prevTab: activeTab, direction };
  }

  return trackerRef.current.direction;
}

const HORIZONTAL_VARIANTS = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction >= 0 ? 14 : -14,
  }),
  center: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.18,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction >= 0 ? -10 : 10,
    transition: {
      duration: 0.09,
      ease: [0.4, 0, 1, 1] as const,
    },
  }),
};

const VERTICAL_VARIANTS = {
  enter: (direction: number) => ({
    opacity: 0,
    y: direction >= 0 ? 10 : -10,
  }),
  center: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.18,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: direction >= 0 ? -8 : 8,
    transition: {
      duration: 0.09,
      ease: [0.4, 0, 1, 1] as const,
    },
  }),
};

export interface AnimatedTabPanelProps {
  activeKey: string;
  direction?: 1 | -1;
  axis?: 'x' | 'y';
  className?: string;
  wrapperClassName?: string;
  children: React.ReactNode;
}

export const AnimatedTabPanel: React.FC<AnimatedTabPanelProps> = ({
  activeKey,
  direction = 1,
  axis = 'x',
  className = '',
  wrapperClassName = 'overflow-x-clip',
  children,
}) => {
  const variants = axis === 'y' ? VERTICAL_VARIANTS : HORIZONTAL_VARIANTS;

  return (
    <div className={wrapperClassName}>
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={activeKey}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          className={className}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
