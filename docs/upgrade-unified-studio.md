# Upgrading from the separate add-ons

Studio Pages (`pages`), Studio Talk (`talk`), Studio Draw (`excalidraw`),
Studio Artifacts (`artifacts`) and Studio Design (`design`) are built into
Studio. Their last releases were upgrade bridges that copied an install's
items into Studio. The bridges and the Studio methods they called are no
longer in this repository or on `stable`.

If you still have one of the old add-ons with items in it, migrate from the
last commit that has the bridges,
`350e69857c0f79a173abfd60ff3d11b1b2a14f66`. Install Studio and each old
add-on you have from that commit, so Studio still accepts the copy:

```sh
bb plugin remove <id>    # note `bb plugin config <id>` first; removing deletes its settings
bb plugin install git:github.com/patleeman/bb-studio@350e69857c0f79a173abfd60ff3d11b1b2a14f66 --plugin <id>
bb plugin remove studio
bb plugin install git:github.com/patleeman/bb-studio@350e69857c0f79a173abfd60ff3d11b1b2a14f66 --plugin studio
bb <id> migrate          # wait for Migration complete
```

`<id>` is `pages`, `talk`, `excalidraw`, `artifacts` or `design`. Removing
Studio keeps its database. The full procedure is
[docs/upgrade-unified-studio.md at that commit](https://github.com/patleeman/bb-studio/blob/350e69857c0f79a173abfd60ff3d11b1b2a14f66/docs/upgrade-unified-studio.md).
When every migrate reports Migration complete, remove the old add-ons and
install Studio from the marketplace again
(`bb plugin remove studio && bb plugin install studio@bb-studio --yes`).

Old links keep working: `/plugins/pages/pages/<id>`,
`/plugins/talk/recordings/<id>`, `/plugins/excalidraw/drawings/<id>`,
`/plugins/artifacts/artifacts/<id>` and `/plugins/design/designs/<id>` open
the item in Studio, and items keep their `pages:`, `talk:`, `excalidraw:`,
`artifacts:` and `design:` ids.
