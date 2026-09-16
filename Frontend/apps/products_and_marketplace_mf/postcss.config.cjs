/**
 * CSS isolation for products_mf remote app.
 *
 * Scopes every selector under `#products-mf-scope` and namespaces all `@keyframes`
 * to ensure complete isolation when rendered inside the host application.
 */

const SCOPE_ID = 'products-mf-scope';

function scopeKeyframes() {
  return {
    postcssPlugin: 'omniremit-scope-keyframes-products',
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
      ignoreFiles: [/\.module\.css$/, /tokens\.css$/],
      transform(prefix, selector, prefixedSelector) {
        if (selector === 'body' || selector === 'html' || selector === ':root') {
          return prefix;
        }
        if (selector.includes(prefix)) {
          return selector;
        }
        return `:where(${prefix}) ${selector}`;
      },
    }),
    scopeKeyframes(),
  ],
};
