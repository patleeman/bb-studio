# Studio references

Use the helpers exported by `@bb-studio/kit/contract` when turning a mention or
link into `{ pluginId, id }`. These helpers run in both server and app bundles.

- `parseStudioItemReference("item:custom:part:50%2F")` returns the opaque ID
  `part:50%2F`. Explicit item references do not contain mention namespaces.
- `parseStudioMentionReference(pluginId, itemId, providers)` understands Studio
  Chat's cross-plugin `item:` wrapper, the existing suite mention namespaces,
  and each provider's `StudioKind.mentionProviderId`. Only a recognized prefix
  is removed. Colons and percent characters in the remaining ID stay intact.
- `parseStudioItemHref(href, options)` decodes each URL path segment exactly
  once. Invalid percent escapes return `null`. Only registered item routes
  are recognized; arbitrary plugin panels are not assumed to contain items.
- `studioTextReferences(text, options)` extracts explicit item references and
  known route links from Markdown links, angle links, and bare tokens. Use
  structured mentions for opaque IDs containing whitespace or Markdown syntax.
  This is a link extractor, not a full Markdown parser.

For a custom route, pass its path explicitly:

```ts
parseStudioItemHref("/plugins/custom/objects/a%3Ab", {
  routes: [{ pluginId: "custom", path: "/plugins/custom/objects/" }],
}); // { pluginId: "custom", id: "a:b" }
```

Routes can declare exact suffix patterns, such as `subpaths: ["view/:id"]`.
Provider mention metadata does not imply a panel URL layout.

Absolute and protocol-relative URLs require an explicit matching `origin`.
In the app, pass the trusted app origin. Servers without that information accept
root-relative paths and explicit item references only, so links to another BB
installation cannot silently become local relationships. Credentials in URLs
are rejected. A rejected URL's inner `/plugins/` path is never extracted.

Core thread-origin linking and Pages backlinks use these helpers. Core resolves
only unknown serialized mention namespaces from the thread's first input. It
coalesces requests, caches successful descriptions for 30 seconds, and imposes
a 1.5-second deadline even if a transport ignores abort. Known legacy mentions
need no lookup. On a lookup failure, legacy rules and opaque raw IDs remain the
fallback; no unknown prefix is guessed. Pages' explicit `item:` references
already carry canonical IDs and need no provider lookup.
