import { NextResponse } from "next/server";
import {
  createProjectFromFile,
  listProjects,
  MAX_UPLOAD_BYTES,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const name = form.get("name");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "FBX file is required" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "FBX exceeds the 100 MB Phase 1 limit" },
        { status: 413 },
      );
    }

    const project = await createProjectFromFile(
      file,
      typeof name === "string" ? name : undefined,
    );

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
