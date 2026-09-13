import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const CURRENT_SOLVER_VERSION = "preview-v2" as const;

export type ProjectStatus = "uploaded" | "preview_ready" | "failed";

export type ConversionSettings = {
  mode: "smart-r6";
  targetRig: "roblox-r6";
  fps: 30;
  rootMotion: "in_place";
  solverVersion: "preview-v1" | "preview-v2";
};

export type ProjectRecord = {
  id: string;
  name: string;
  originalFilename: string;
  originalSize: number;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  settings: ConversionSettings;
  error?: string;
};

const dataRoot = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

const projectsRoot = path.join(dataRoot, "projects");

function assertProjectId(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    throw new Error("Invalid project id");
  }
}

function projectDir(id: string) {
  assertProjectId(id);
  return path.join(projectsRoot, id);
}

function metadataPath(id: string) {
  return path.join(projectDir(id), "project.json");
}

export function originalFilePath(id: string) {
  return path.join(projectDir(id), "source", "original.fbx");
}

export async function ensureStorage() {
  await mkdir(projectsRoot, { recursive: true });
}

function cleanProjectName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Untitled animation";
  return trimmed.slice(0, 100);
}

function nameFromFilename(filename: string) {
  return filename.replace(/\.fbx$/i, "").replace(/[_-]+/g, " ").trim();
}

export async function createProjectFromFile(file: File, requestedName?: string) {
  if (!file.name.toLowerCase().endsWith(".fbx")) {
    throw new Error("Only .fbx files are supported in Phase 1");
  }

  if (file.size === 0) {
    throw new Error("The uploaded FBX is empty");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("FBX exceeds the 100 MB Phase 1 limit");
  }

  await ensureStorage();

  const id = randomUUID();
  const dir = projectDir(id);
  const sourceDir = path.join(dir, "source");
  await mkdir(sourceDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(originalFilePath(id), buffer);

  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id,
    name: cleanProjectName(requestedName || nameFromFilename(file.name)),
    originalFilename: path.basename(file.name),
    originalSize: file.size,
    createdAt: now,
    updatedAt: now,
    status: "uploaded",
    settings: {
      mode: "smart-r6",
      targetRig: "roblox-r6",
      fps: 30,
      rootMotion: "in_place",
      solverVersion: CURRENT_SOLVER_VERSION,
    },
  };

  await writeProject(project);
  return project;
}

export async function writeProject(project: ProjectRecord) {
  const dir = projectDir(project.id);
  await mkdir(dir, { recursive: true });
  await writeFile(metadataPath(project.id), JSON.stringify(project, null, 2), "utf8");
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  try {
    const raw = await readFile(metadataPath(id), "utf8");
    return JSON.parse(raw) as ProjectRecord;
  } catch {
    return null;
  }
}

export async function markPreviewReady(
  id: string,
  solverVersion: ConversionSettings["solverVersion"] = CURRENT_SOLVER_VERSION,
) {
  const project = await getProject(id);
  if (!project) return null;

  const updated: ProjectRecord = {
    ...project,
    status: "preview_ready",
    settings: {
      ...project.settings,
      solverVersion,
    },
    updatedAt: new Date().toISOString(),
    error: undefined,
  };
  await writeProject(updated);
  return updated;
}

export async function markProjectFailed(id: string, error: string) {
  const project = await getProject(id);
  if (!project) return null;

  const updated: ProjectRecord = {
    ...project,
    status: "failed",
    updatedAt: new Date().toISOString(),
    error: error.slice(0, 1000),
  };
  await writeProject(updated);
  return updated;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  await ensureStorage();
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => getProject(entry.name)),
  );

  return projects
    .filter((project): project is ProjectRecord => Boolean(project))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
