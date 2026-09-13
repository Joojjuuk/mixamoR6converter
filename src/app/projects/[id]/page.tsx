import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimationComparisonV4 } from "@/components/AnimationComparisonV4";
import { CURRENT_SOLVER_VERSION, getProject } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <>
      <div className="projectHeader">
        <div>
          <Link href="/" className="hint">← Voltar para conversões</Link>
          <h1>{project.name}</h1>
          <p>{project.originalFilename} · {formatBytes(project.originalSize)}</p>
        </div>
        <div className="projectActions">
          <a
            className="secondaryButton"
            href={`/api/projects/${project.id}/source`}
            download={project.originalFilename}
          >
            Baixar original
          </a>
        </div>
      </div>

      <AnimationComparisonV4
        projectId={project.id}
        sourceUrl={`/api/projects/${project.id}/source`}
      />

      <div className="infoGrid">
        <div className="panel infoCard">
          <span>Target</span>
          <strong>Roblox R6</strong>
        </div>
        <div className="panel infoCard">
          <span>Solver</span>
          <strong>{CURRENT_SOLVER_VERSION}</strong>
        </div>
        <div className="panel infoCard">
          <span>Sampling target</span>
          <strong>{project.settings.fps} FPS temporal</strong>
        </div>
        <div className="panel infoCard">
          <span>Root Motion</span>
          <strong>In place + XYZ foot plant</strong>
        </div>
      </div>

      <p className="hint">
        O preview-v4 pré-processa o clip inteiro em uma pose track R6 de 30 FPS. Contato dos pés usa histerese e foot plant em XYZ; braços/pernas usam direção + plano de cotovelo/joelho; quaternions recebem continuidade temporal antes do playback.
      </p>
    </>
  );
}
