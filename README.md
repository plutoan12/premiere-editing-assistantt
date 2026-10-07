# premiere-editing-assistantt

## Graphics Engine

The initial Graphics Engine implements template validation, caption styling, deterministic
rules and automatic placement, with a Premiere handoff-plan compiler.
See [the Graphics Engine guide](packages/graphics/README.md) for contracts, verification
and the remaining real-host integration requirements.

The [Premiere Graphics Preview panel](apps/premiere-graphics-panel/README.md) adds
real MOGRT insertion into a new sequence with exact timing readback. It previews the
original template; caption text/style/placement application remains unsupported.
