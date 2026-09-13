import Link from "next/link";
import { UploadCard } from "@/components/UploadCard";
import { listProjects } from "@/lib/storage";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function HomePage() {
  const projects = await listProjects();

  return (
    <>
      <section className="hero">
        <div>
          <h1>Mixamo → Roblox R6</h1>
          <p>
            Envie uma animação FBX, mantenha o original salvo e compare a pose do Mixamo com uma projeção R6 em tempo real antes de partir para o bake/export final.
          </p>
        </div>
      </section>

      <UploadCard />

      <div className="sectionTitle">
        <h2>Conversões salvas</h2>
        <span className="hint">{projects.length} projeto(s)</span>
      </div>

      {projects.length ? (
        <div className="projectGrid">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="panel projectCard">
              <div className="projectCardTop">
                <div>
                  <h3>{project.name}</h3>
                  <p>{project.originalFilename}</p>
                </div>
                <span className="status">{project.status.replace("_", " ")}</span>
              </div>
              <div className="projectMeta">
                <span>{formatBytes(project.originalSize)}</span>
                <span>{project.settings.mode}</span>
                <span>{project.settings.fps} FPS</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel empty">Nenhuma animação enviada ainda.</div>
      )}
    </>
  );
}
