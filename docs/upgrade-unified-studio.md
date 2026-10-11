# Upgrading to unified Studio

Studio Pages, Studio Talk, Studio Draw (`excalidraw`), Studio Artifacts and
Studio Design are built into Studio now. If you had any of them installed as
separate plugins, this is the one procedure that moves you to unified Studio
without losing anything. It works for any mix of the five, in one sitting,
and for installs pinned to a commit.

Each old add-on's last release (0.2.0) is an **upgrade bridge**: it has no UI
or agent tools of its own; it copies its items into Studio, forwards older
clients, and stays until you remove it. BB keeps each plugin's database,
settings and files separately, so nothing moves until a bridge copies it, and
the originals stay in the bridge until you remove it.

| Add-on | ID | Migrate command | What the bridge copies |
| --- | --- | --- | --- |
| Studio Pages | `pages` | `bb pages migrate` | Pages with their comments, versions, uploaded files, chats and checklist hand-offs; the Next row's click stats; Pages and Explore settings |
| Studio Talk | `talk` | `bb talk migrate` | Recordings and dictations with their audio and transcripts; Talk settings and model choices |
| Studio Draw | `excalidraw` | `bb excalidraw migrate` | Drawings with their images |
| Studio Artifacts | `artifacts` | `bb artifacts migrate` | Artifacts with every version |
| Studio Design | `design` | `bb design migrate` | Designs with their rounds, screens and comments; saved styles |

## The order, and why

**Update the old add-ons first, then Studio, then migrate.** BB lets only one
plugin register an agent tool name, and a plugin registers its tools when it
starts. The bridges register none, so once every old add-on is a bridge,
Studio starts holding `pages_*`, `talk_*`, `excalidraw_*`, `artifacts_*` and
`design_*`. If Studio starts first, while an old add-on still holds its
tools, Studio runs without them (its status in `bb plugin list` says
`tool "pages_read" is already registered by plugin "pages"`) until it's
reloaded. Earlier notes said to update Studio first; that order works too,
but needs a `bb plugin reload studio` at the end, so this guide doesn't use
it.

Between the two updates, for a minute, the old add-ons' items aren't listed
and their tools aren't available. Nothing is lost: each bridge retries its
copy until Studio answers, and `bb <id> migrate` runs it on demand.

## Before you start

1. **See what you have and how it's installed.**

   ```sh
   bb plugin list
   for id in studio pages talk excalidraw artifacts design; do bb plugin source "$id"; done
   ```

   `bb plugin source` shows each plugin's source. One that names a branch
   (`@stable` or `@main`) updates with `bb plugin update`. One pinned to a
   commit (a 40-character hash, as from `bb plugin install git:…@<commit>`)
   doesn't: `bb plugin update` reports it as up to date and skips it.

2. **Back up.** With the Studio you have now:

   ```sh
   bb studio backup --out ~/Desktop
   ```

   Old backups restore into unified Studio: the sections keep the old plugin
   ids (`pages`, `talk`, `excalidraw`, `artifacts`, `design`).

3. **Finish work in progress.** Stop any recording or dictation and wait for
   its pill to go away (its audio has uploaded; the recorder belongs to the
   Talk plugin until it's updated). Close pages you're editing so their last
   changes are saved.

4. **Note custom keyboard shortcuts** on *Talk:* commands (Settings →
   Keyboard shortcuts). Command ids are scoped by plugin, so they become
   Studio's commands and the shortcuts have to be set again.

## 1. Update the old add-ons to their bridges

For each old add-on you have, on a branch:

```sh
bb plugin update pages --yes
bb plugin update talk --yes
bb plugin update excalidraw --yes
bb plugin update artifacts --yes
bb plugin update design --yes
```

For one **pinned to a commit**, install the marketplace entry over it instead.
Installing a plugin id that's already installed replaces its code and keeps
its database, settings and files; don't `bb plugin remove` it first, which
deletes its settings, and for a bridge that hasn't copied yet, what it would
have copied:

```sh
bb plugin install pages@bb-studio --yes   # and talk@, excalidraw@, artifacts@, design@
```

That moves it to the marketplace's release branch (`stable`), so
`bb plugin update` works for it from then on. To stay pinned, install a
specific pushed commit the same way:
`bb plugin install git:github.com/patleeman/bb-studio@<commit> --plugin pages --yes`.

Check each one is the bridge: `bb plugin list` shows version 0.2.0 and a
description starting "Upgrade bridge".

## 2. Update Studio

```sh
bb plugin update studio --yes          # or, pinned: bb plugin install studio@bb-studio --yes
```

Then check Studio holds every tool and nothing failed:

```sh
bb plugin list
bb studio health
```

If Studio's status mentions `is already registered by plugin`, an old add-on
was still running when Studio started. Make sure step 1 finished for every
add-on, then:

```sh
bb plugin reload studio
```

## 3. Copy your items in

Run each bridge's copy and wait for "Migration complete" (each bridge also
copies on its own in the background; these run it now and report):

```sh
bb pages migrate
bb talk migrate
bb excalidraw migrate
bb artifacts migrate
bb design migrate
```

A rerun copies only what's left. If one says Studio isn't running, update and
turn on Studio, then run it again. Anything a bridge can't copy (a malformed
row) is listed by id with the reason, and stays in the bridge: copy what you
need from it before you remove the bridge.

## 4. Check

```sh
bb studio setup                      # every bridge under "Retired plugins", none blocked
bb studio list kind:page --all       # and kind:recording, kind:drawing, kind:artifact, kind:design
bb studio pages explore stats        # the Next row's click history came along
```

- Open an old link from a thread, such as `/plugins/pages/pages/<id>` or
  `/plugins/talk/recordings/<id>`: it opens the item as a Studio tab.
- Open a page that has an image or file you uploaded, and a page with an
  embedded drawing: both show.
- In **Settings → Studio**, your Talk, Pages and Explore settings are there.
- Set your keyboard shortcuts on Studio's *Talk:* commands again.

**Studio → Setup** shows the same, and its **Remove…** button for a bridge is
enabled only once its copy is complete.

## 5. Remove the bridges

Once Setup shows nothing blocking:

```sh
bb plugin remove pages
bb plugin remove talk
bb plugin remove excalidraw
bb plugin remove artifacts
bb plugin remove design
```

Removing a bridge deletes its copy of the data (Talk's original audio
included); Studio has its own. Keep a bridge for a while if you still use an
iOS build from before the merge: it forwards that build's calls to Studio.

## 6. Remove retired plugins

These have no bridge and nothing to copy. Remove any you still have:

```sh
bb plugin remove studio-tables      # export tables you need as CSV first; tables have no replacement
bb plugin remove thread-list-plus   # Studio Sidebar; threads stay in BB's sidebar
bb plugin remove studio-chat        # item chat is built into Studio
```

`bb studio setup` lists other retired plugins (Studio Navigation, Float,
Studio Teams) with what to do before removing them.

## If something goes wrong

- **Tools missing, or "already registered by plugin":** `bb plugin reload studio`
  after every old add-on is a bridge.
- **A migrate command fails:** it prints why (usually Studio not running or
  not updated). Fix that and rerun; it continues where it stopped.
- **Something looks missing after migrating:** don't remove the bridge.
  `bb plugin logs <id>` shows what it skipped and why; the originals are
  still in it. `bb studio restore <backup> --dry-run` shows what your backup
  would bring back.
