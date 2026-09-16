/**
 * CSS isolation for lead_mf remote app.
 *
 * Scopes every selector under `#lead-mf-scope` and namespaces all `@keyframes`
 * to ensure complete isolation when rendered inside the host application.
 */

const SCOPE_ID = 'lead-mf-scope';

function scopeKeyframes() {
  return {
    postcssPlugin: 'omniconnect-scope-keyframes-lead',
    OnceExit(root) {
      const declared = new Set();

      root.walkAtRules(/^(-\w+-)?keyframes$/, (atRule) => {
        if (atRule.params.startsWith(`${SCOPE_ID}-`)) {
          return;
        }
        declared.add(atRule.params);
        atRule.params = `${SCOPE_ID}-${atRule.params}`;
      });

      if (declared.size === 0) {
        return;
      }

      root.walkDecls(/^(-\w+-)?animation(-name)?$/, (decl) => {
        for (const name of declared) {
          const pattern = new RegExp(`(^|[^\\w-])${name}(?![\\w-])`, 'g');
          decl.value = decl.value.replace(pattern, `$1${SCOPE_ID}-${name}`);
        }
      });
    },
  };
}
scopeKeyframes.postcss = true;

module.exports = {
  plugins: [
    require('postcss-prefix-selector')({
      prefix: `#${SCOPE_ID}`,
      /*
       * CSS Modules must NOT be prefixed.
       *
       * Vite runs PostCSS before its CSS Modules transform, so a `#lead-mf-scope` injected here
       * gets treated as a local name and hashed along with everything else — the built rule comes
       * out as `#_lead-mf-scope_zeozl_1 ._container_zeozl_21`, which can never match the real
       * `<div id="lead-mf-scope">` in App.tsx. The styles are shipped and simply never apply.
       *
       * This was invisible until now only because this app had no `.module.css` files at all; every
       * rule lived in the global index.css, which is not a module and so keeps the literal id. It
       * would have silently broken every component stylesheet as soon as one was introduced.
       *
       * Excluding modules is also correct on the merits, not just a workaround: CSS Modules already
       * hash every class to something globally unique, which is exactly the isolation the prefix
       * exists to provide for global CSS. Prefixing them adds a redundant ancestor requirement and,
       * here, a fatal one.
       */
      /*
       * `.module.css` — CSS Modules already hash to globally-unique names, so the prefix is
       *   redundant, and Vite runs PostCSS BEFORE the modules transform, so an injected id gets
       *   hashed and the rule can never match (see the long note below).
       * `tokens.css` — the shared standalone token fallbacks must land on the real `:root`, not on
       *   the scope element. Anything this app PORTALS to document.body (the filter popover, the
       *   time-range dropdown, the host sidebar sub-nav) renders OUTSIDE the scope; with the tokens
       *   scoped, every `var(--omni-*)` in those subtrees resolved to nothing and they rendered
       *   with no background, border or radius at all.
       */
      ignoreFiles: [/\.module\.css$/, /tokens\.css$/],
      transform(prefix, selector, prefixedSelector) {
        if (selector === 'body' || selector === 'html' || selector === ':root') {
          return prefix;
        }
        // Never prefix a selector that already names the scope id — that yields `#SCOPE #SCOPE`,
        // a descendant selector requiring a nested scope element, so the rule never matches.
        if (selector.includes(prefix)) {
          return selector;
        }
        /*
         * SCOPE WITHOUT WEIGHT.
         *
         * The prefix exists to CONTAIN this app's global CSS, not to make it win arguments. Emitted
         * bare, `#SCOPE .form-input` scores 1-1-0 on the id, which outranks EVERY CSS-module class
         * in the app (0-1-0) — so a component stylesheet could never override a global one. There
         * are ~94 call sites in the two remotes that pair a global class with a module class
         * expecting the module to refine it, e.g.
         *
         *     className={`form-input ${shell.searchInput}`}
         *
         * where `.searchInput` sets `padding-left: 38px` to clear the search icon. `.form-input`'s
         * `padding: 0 14px` won on specificity, so the icon sat on top of the placeholder text in
         * the Lead Directory and the Customer 360 audit search. Every fix for that class of bug was
         * doomed to be a workaround.
         *
         * Wrapping the id in `:where()` contributes ZERO specificity, so a scoped global rule keeps
         * exactly the weight it was authored with (0-1-0 for a class) and containment is unchanged —
         * the rule still only matches inside the scope element. Module classes then win by source
         * order, and index.css is imported before any component stylesheet.
         */
        return `:where(${prefix}) ${selector}`;
      },
    }),
    scopeKeyframes(),
  ],
};
