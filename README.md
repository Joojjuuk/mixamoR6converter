# Mixamo → Roblox R6 Converter

Web tool for uploading Mixamo FBX animations, previewing the source animation and projecting the pose onto a Roblox-style R6 rig side by side.

## Phase 1

This first implementation focuses on the product foundation:

- FBX upload and local persistence;
- project/history dashboard;
- Mixamo FBX preview in Three.js;
- live Smart R6 pose projection in the browser;
- synchronized original/R6 playback and timeline;
- saved conversion settings/metadata;
- architecture prepared for the Blender headless export worker.

> The browser preview is the first solver prototype. Exporting a Roblox-importable R6 `.fbx` is the next milestone and must be validated against a reference R6 rig exported from Roblox Studio before being treated as production-ready.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Uploaded projects are stored under `data/projects/` and are intentionally ignored by Git.

## Why preview before export?

Mixamo rigs contain spine, elbow, knee, hand and foot joints that do not exist on Roblox R6. A literal bone-name copy is therefore not enough. The Phase 1 viewer projects the animation's visual pose onto six blocky R6 body parts so we can evaluate the mapping before baking it into an FBX pipeline.

## Planned next milestone

1. Add a canonical R6 reference rig exported from Roblox Studio.
2. Port the tested pose projection to Blender/Python.
3. Bake keys at 30 FPS.
4. Export `converted_r6.fbx`.
5. Generate and persist a converted GLB/FBX preview.
6. Add versioned re-conversion instead of replacing earlier results.
