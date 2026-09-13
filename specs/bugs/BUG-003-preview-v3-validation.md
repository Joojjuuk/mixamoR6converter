# BUG-003 — preview-v3 validation pass

Status: **awaiting visual validation with real FBX**

The preview-v3 implementation passed dependency install, TypeScript typecheck and Next.js production build in CI.

This only validates compilation/integration. Visual acceptance still requires the same `Standing Melee Combo Attack Ver. 1.fbx` and the generated Original × R6 GIF.

Validation focus:

- support foot remains grounded during melee;
- false airborne classifications disappear;
- bent-arm poses preserve the upper-arm direction more closely;
- GIF export completes and restores previous playback state.