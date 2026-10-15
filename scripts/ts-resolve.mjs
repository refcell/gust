// Lets Node (>= 22.15 / 24, native TypeScript type stripping) run scripts that import src/lib
// modules with extension-less specifiers (`./geo`), as Vite and tsc ("bundler" resolution) allow.
// Usage: node --import ./scripts/ts-resolve.mjs scripts/infer-sectors.ts
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (!relative || e?.code !== 'ERR_MODULE_NOT_FOUND' || /\.[cm]?[jt]s$/.test(specifier)) throw e;
      return next(specifier + '.ts', context);
    }
  },
});
