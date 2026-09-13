import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimationComparisonV3 } from "@/components/AnimationComparisonV3";
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

      <AnimationComparisonV3
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
          <strong>{project.settings.fps} FPS</strong>
        </div>
        <div className="panel infoCard">
          <span>Root Motion</span>
          <strong>In place + support-foot lock</strong>
        </div>
      </div>

      <p className="hint">
        O preview-v3 usa a cadeia ombro → cotovelo → mão para reduzir braços soltos e trava no chão o mesmo pé de apoio detectado no Mixamo. O botão de GIF gera uma comparação sincronizada para registrar diferenças frame a frame.
      </p>
    </>
  );
}