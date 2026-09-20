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
          <strong>Segue a fonte · contato contínuo</strong>
        </div>
      </div>

      <p className="hint">
        O preview-v5 trata o retarget como pose fitting: cada bloco R6 gira no próprio encaixe do Torso (ombro/quadril) e aponta para onde a cadeia Mixamo aponta (upper arm/coxa + mão/pé). Joelho dobrado vira perna aberta a partir do quadril e o corpo desce junto; os pés em contato seguem o próprio pé da fonte (parado quando ele está plantado). Use “Solver” para comparar com o preview-v4.1 e “Debug Solver” para ver alvos e erros.
      </p>
    </>
  );
}
