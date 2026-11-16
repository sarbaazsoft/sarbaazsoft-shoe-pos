import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {defineConfig, type Plugin} from 'vite';

function serviceWorkerBuildPlugin(rootDir: string): Plugin {
  return {
    name: 'sarbaazsoft-sw-version-injector',
    apply: 'build',
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir
        ? path.resolve(rootDir, outputOptions.dir)
        : path.resolve(rootDir, 'dist');
      const swPath = path.join(outDir, 'sw.js');
      const indexHtmlPath = path.join(outDir, 'index.html');

      const swExists = fs.existsSync(swPath);
      let swSource = swExists ? fs.readFileSync(swPath, 'utf8') : '';

      let pkgVersion = '1.0.0';
      const pkgPath = path.join(rootDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg?.version) {
            pkgVersion = String(pkg.version);
          }
        } catch {
          // fallback version
        }
      }

      const hash = crypto.createHash('sha256');
      hash.update(pkgVersion);
      if (fs.existsSync(indexHtmlPath)) {
        hash.update(fs.readFileSync(indexHtmlPath));
      }
      if (swSource) {
        hash.update(swSource);
      }
      const buildVersion = `${pkgVersion}-${hash.digest('hex').slice(0, 10)}`;

      if (swExists) {
        swSource = swSource.replace(
          /const SW_BUILD_VERSION = ['"][^'"]*['"];/,
          `const SW_BUILD_VERSION = '${buildVersion}';`
        );
        fs.writeFileSync(swPath, swSource, 'utf8');
      }

      if (fs.existsSync(indexHtmlPath)) {
        let html = fs.readFileSync(indexHtmlPath, 'utf8');
        const metaTag = `<meta name="app-build-version" content="${buildVersion}" />`;
        if (html.includes('name="app-build-version"')) {
          html = html.replace(/<meta name="app-build-version"[^>]*>/i, metaTag);
        } else {
          html = html.replace('</head>', `    ${metaTag}\n  </head>`);
        }
        fs.writeFileSync(indexHtmlPath, html, 'utf8');
      }

      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify(
          {
            version: buildVersion,
            builtAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    },
  };
}

export default defineConfig(() => {
  const rootDir = path.resolve(import.meta.dirname || '.');

  return {
    plugins: [react(), tailwindcss(), serviceWorkerBuildPlugin(rootDir)],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    build: {
      rolldownOptions: {
        output: {
          entryFileNames: 'assets/js/[name]-[hash].js',
          chunkFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.names?.[0] || assetInfo.originalFileNames?.[0] || '';
            const ext = path.extname(name).toLowerCase();
            if (ext === '.css') {
              return 'assets/css/[name]-[hash][extname]';
            }
            if (['.woff2', '.woff', '.ttf', '.otf', '.eot'].includes(ext)) {
              return 'assets/fonts/[name]-[hash][extname]';
            }
            if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico'].includes(ext)) {
              return 'assets/media/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            const normalized = id.split(path.sep).join('/');
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(normalized)) {
              return 'vendor-react';
            }
            if (/\/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(normalized)) {
              return 'vendor-charts';
            }
            if (/\/node_modules\/(@?firebase)\//.test(normalized)) {
              return 'vendor-firebase';
            }
            if (/\/node_modules\/(motion|framer-motion)\//.test(normalized)) {
              return 'vendor-motion';
            }
            if (/\/node_modules\/(jspdf|html2canvas|dompurify|jsbarcode|fflate|canvg)\//.test(normalized)) {
              return 'vendor-export';
            }
            if (/\/node_modules\/lucide-react\//.test(normalized)) {
              return 'vendor-icons';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
