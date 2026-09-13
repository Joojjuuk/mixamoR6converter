import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimationComparison } from "@/components/AnimationComparison";
import { getProject } from "@/lib/storage";

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
          <a className="secondaryButton" href={`/api/projects/${project.id}/source`} download={project.originalFilename}>
            Baixar original
          </a>
        </div>
      </div>

      <AnimationComparison
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
          <strong>{project.settings.solverVersion}</strong>
        </div>
        <div className="panel infoCard">
          <span>Sampling target</span>
          <strong>{project.settings.fps} FPS</strong>
        </div>
        <div className="panel infoCard">
          <span>Root Motion</span>
          <strong>In place</strong>
        </div>
      </div>

      <p className="hint">
        Nesta fase o R6 é uma projeção visual em tempo real. O próximo marco é bakear exatamente este solver sobre um rig R6 de referência e gerar o FBX importável pelo Roblox Studio.
      </p>
    </>
  );
}
