/*
 * CSS Module typings.
 *
 * The apps get these from `vite/client`, but this package is consumed as source and is compiled by
 * whichever app imports it, so it needs its own declaration — otherwise every
 * `import styles from './X.module.css'` is an unresolved-module error under `tsc --noEmit`.
 */
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
