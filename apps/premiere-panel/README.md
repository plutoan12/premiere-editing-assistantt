# Premiere UXP panel

Minimal real panel surface for helper acceptance.

- Premiere 25.6+, manifest v5.
- Release manifest allows only HTTPS loopback helper endpoints.
- User explicitly selects both the helper bootstrap JSON and the footage/audio file. No full-filesystem permission.
- The panel sends the selected native media path to the authenticated helper, polls job state, supports cancellation, and displays canonical transcript text.
- It intentionally does not apply edits/captions to Premiere yet.

## Development

Load `apps/premiere-panel/manifest.json` in UXP Developer Tool 2.2+.

The checked-in release manifest rejects HTTP. For local server tests, use the protocol package and Node integration tests; do not weaken the release manifest just to make macOS development convenient.

## Packaging

Use Adobe UXP Developer Tool / UXP CLI to create the .ccx. Adobe recommends UDT packaging rather than manually renaming a ZIP.
