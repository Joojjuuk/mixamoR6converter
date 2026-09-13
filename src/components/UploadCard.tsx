"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadCard() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as {
        project?: { id: string };
        error?: string;
      };

      if (!response.ok || !body.project) {
        throw new Error(body.error || "Upload failed");
      }

      router.push(`/projects/${body.project.id}`);
      router.refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      setSubmitting(false);
    }
  }

  return (
    <section className="panel uploadCard">
      <form className="uploadForm" onSubmit={submit}>
        <div className="field">
          <label htmlFor="name">Nome da animação</label>
          <input id="name" name="name" type="text" placeholder="Ex.: Katana Attack 01" />
        </div>
        <div className="field">
          <label htmlFor="file">Arquivo Mixamo FBX</label>
          <input
            id="file"
            name="file"
            className="fileInput"
            type="file"
            accept=".fbx,application/octet-stream"
            required
          />
        </div>
        <button className="primaryButton" type="submit" disabled={submitting}>
          {submitting ? "Enviando…" : "Enviar e comparar"}
        </button>
      </form>
      {error ? <p className="errorText">{error}</p> : null}
      <p className="hint">FBX · até 100 MB · Smart R6 preview · 30 FPS · Root Motion in-place</p>
    </section>
  );
}
