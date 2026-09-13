"""Blender headless analyzer for Mixamo FBX files.

Usage:
    blender --background --python worker/analyze_mixamo.py -- \
      --input /path/to/animation.fbx \
      --output /path/to/analysis.json

This is intentionally analysis-only in Phase 1. The bake/export worker will reuse the
same detection rules after a canonical Roblox R6 reference rig is added and validated.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


REQUIRED_MIXAMO_SUFFIXES = {
    "hips": "hips",
    "torso": "spine",
    "head": "head",
    "left_arm": "leftarm",
    "left_hand": "lefthand",
    "right_arm": "rightarm",
    "right_hand": "righthand",
    "left_leg": "leftupleg",
    "left_foot": "leftfoot",
    "right_leg": "rightupleg",
    "right_foot": "rightfoot",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(argv)


def normalize(name: str) -> str:
    return "".join(character for character in name.lower().replace("mixamorig", "") if character.isalnum())


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_fbx(source: Path) -> None:
    bpy.ops.import_scene.fbx(filepath=str(source))


def find_armature():
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        return None
    return max(armatures, key=lambda armature: len(armature.data.bones))


def detect_mixamo(armature) -> tuple[bool, dict[str, str | None]]:
    names = {normalize(bone.name): bone.name for bone in armature.data.bones}
    mapped: dict[str, str | None] = {}

    for logical_name, suffix in REQUIRED_MIXAMO_SUFFIXES.items():
        exact = names.get(suffix)
        if exact:
            mapped[logical_name] = exact
            continue

        match = next(
            (original for normalized, original in names.items() if normalized.endswith(suffix)),
            None,
        )
        mapped[logical_name] = match

    # Spine variants differ between Mixamo exports; at least one spine bone is enough.
    torso_candidates = [
        bone.name
        for bone in armature.data.bones
        if normalize(bone.name) in {"spine", "spine1", "spine2"}
    ]
    if torso_candidates:
        mapped["torso"] = torso_candidates[-1]

    return all(mapped.values()), mapped


def animation_metadata(armature) -> dict:
    action = armature.animation_data.action if armature.animation_data else None
    scene = bpy.context.scene

    if not action:
        return {
            "found": False,
            "fps": scene.render.fps,
            "frame_start": None,
            "frame_end": None,
            "frame_count": 0,
            "duration_seconds": 0,
            "action": None,
        }

    frame_start, frame_end = action.frame_range
    fps = scene.render.fps / scene.render.fps_base
    frame_count = max(int(round(frame_end - frame_start)) + 1, 1)

    return {
        "found": True,
        "fps": fps,
        "frame_start": frame_start,
        "frame_end": frame_end,
        "frame_count": frame_count,
        "duration_seconds": (frame_end - frame_start) / fps if fps else 0,
        "action": action.name,
    }


def main() -> int:
    args = parse_args()
    source = Path(args.input).resolve()
    output = Path(args.output).resolve()

    if not source.exists() or source.suffix.lower() != ".fbx":
        raise SystemExit(f"Invalid FBX source: {source}")

    clear_scene()
    import_fbx(source)

    armature = find_armature()
    if armature is None:
        result = {
            "ok": False,
            "source": str(source),
            "error": "No armature found in FBX",
        }
    else:
        is_mixamo, mapping = detect_mixamo(armature)
        result = {
            "ok": True,
            "source": str(source),
            "rig": {
                "armature": armature.name,
                "bone_count": len(armature.data.bones),
                "mixamo_detected": is_mixamo,
                "mapping": mapping,
            },
            "animation": animation_metadata(armature),
        }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
