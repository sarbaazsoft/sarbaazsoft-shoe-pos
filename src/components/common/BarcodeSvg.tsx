import React, { useEffect, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext.tsx';

let cachedJsBarcodePromise: Promise<any> | null = null;
function loadJsBarcode() {
  if (!cachedJsBarcodePromise) {
    cachedJsBarcodePromise = import('jsbarcode').then((m: any) => m.default || m);
  }
  return cachedJsBarcodePromise;
}

interface BarcodeSvgProps {
  value: string;
  format?: 'CODE128' | 'EAN13' | 'UPC';
  width?: number;
  height?: number;
  displayValue?: boolean;
  fontSize?: number;
  className?: string;
  lineColor?: string;
  forcePrintBlack?: boolean;
}

export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  format = 'CODE128',
  width = 1.6,
  height = 40,
  displayValue = true,
  fontSize = 12,
  className = '',
  lineColor,
  forcePrintBlack = false,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  let currentTheme = 'dark';
  try {
    const themeContext = useTheme();
    if (themeContext) currentTheme = themeContext.theme;
  } catch {
    // Fallback if rendered outside ThemeProvider
    if (typeof document !== 'undefined') {
      currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
  }

  useEffect(() => {
    if (!svgRef.current || !value) return;
    let cancelled = false;
    const cleanVal = String(value).trim();
    const isDark = currentTheme === 'dark';
    const resolvedLineColor = lineColor || (forcePrintBlack ? '#000000' : (isDark ? '#FFFFFF' : '#000000'));

    void loadJsBarcode()
      .then((JsBarcode) => {
        if (cancelled || !svgRef.current) return;
        const tryFormat = (fmt: string) => {
          JsBarcode(svgRef.current, cleanVal, {
            format: fmt as any,
            width,
            height,
            displayValue,
            fontSize,
            margin: 4,
            font: 'monospace',
            background: 'transparent',
            lineColor: resolvedLineColor,
          });
        };

        try {
          if (cleanVal.length === 13 && /^\d{13}$/.test(cleanVal)) {
            tryFormat('EAN13');
          } else {
            tryFormat(format);
          }
        } catch {
          try {
            tryFormat('CODE128');
          } catch (e2) {
            console.warn('JsBarcode render error for:', value, e2);
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [value, format, width, height, displayValue, fontSize, lineColor, currentTheme, forcePrintBlack]);

  if (!value) return null;

  return <svg ref={svgRef} className={className} />;
};

