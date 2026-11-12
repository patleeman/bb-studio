export const FORK_PIERRE_CSS = `[data-gutter] { --diffs-bg: var(--fork-diffs-gutter-bg, light-dark(var(--diffs-light-bg, #fff), var(--diffs-dark-bg, #000))); }`;

export function withForkPierreCSS<TOptions extends { unsafeCSS?: string }>(
  options: TOptions | undefined,
): TOptions | undefined {
  if (options === undefined) return undefined;
  const unsafeCSS =
    options.unsafeCSS === undefined
      ? FORK_PIERRE_CSS
      : `${FORK_PIERRE_CSS}\n${options.unsafeCSS}`;
  return { ...options, unsafeCSS };
}
