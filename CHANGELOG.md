# Changelog

## Unreleased
- "Check for a new Cup" reads the published release feed on GitHub (the site feed only as a fallback) and compares versions properly; Cup also mentions a newer version when it starts.
- "Update Cup with Pour" installs the newest Cup with Pour even when this copy was not installed by Pour, and upgrades it when it was.
- Installed shows how much space each app and tool takes, the total on disk, and the size of a selection; the details sheet shows it too.
- The copy buttons now copy through the system clipboard, so the install command really lands on the clipboard.
- Drag down the checkboxes to select many rows; drag again to deselect them (Shift-click still selects a range).
- Releases register and switch on every app Cup lists in the ipconfig dashboard (CutFlow, Hone, Deft and any others it was missing).
- THIRD-PARTY-NOTICES.txt ships again with every installer; update.sh is kept in the repository.

## Cup 1.0.0 — 15-Oct-2026
- First release: a desktop app store and manager for the Pour package manager, under 1 MB.
- Discover: the creator's apps, popular apps and tools, 17 categories, shelves and a rotating pick.
- Apps and Tools: the whole Pour catalogue (about 16,000 packages) with instant search, categories and eight layouts.
- Installed: apps and tools with multi-select (shift-click ranges), upgrade, pour again, remove (with zap), leaves, and what Homebrew installed — with a one-click move to Pour.
- Updates: background checks, a Dock badge, upgrade one or everything, self-updating apps on request, clean-up after upgrades.
- Brewfile export and import with preview and plan, plus snapshots you can view, restore and delete.
- Taps: add and remove extra registries.
- Care: check-up, clean-up preview, index update, and Pour's own version and self-update.
- Log: every command with live output, line badges, counts, copy and stop.
- Command palette (⌘K), right-click menus everywhere, keyboard shortcuts, light/dark/auto themes, sounds with pictures, start-up animation.
- Installs Pour for you when it is missing.
- Sealed interface, proprietary licence: free for personal use; copying the code is not permitted.
