import { NextResponse } from "next/server";
import {
  CURRENT_SOLVER_VERSION,
  getProject,
  markPreviewReady,
  type ConversionSettings,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type PatchBody = {
  status?: string;
  solverVersion?: ConversionSettings["solverVersion"];
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PatchBody | null;

  if (body?.status !== "preview_ready") {
    return NextResponse.json({ error: "Unsupported update" }, { status: 400 });
  }

  const solverVersion = body.solverVersion ?? CURRENT_SOLVER_VERSION;
  if (
    solverVersion !== "preview-v1" &&
    solverVersion !== "preview-v2" &&
    solverVersion !== "preview-v3" &&
    solverVersion !== "preview-v4" &&
    solverVersion !== "preview-v4.1" &&
    solverVersion !== "preview-v5"
  ) {
    return NextResponse.json({ error: "Unsupported solver version" }, { status: 400 });
  }

  const project = await markPreviewReady(id, solverVersion);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ project });
}
