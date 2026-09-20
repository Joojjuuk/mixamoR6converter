import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ textAlign: "center", padding: "80px 20px" }}>
      <h2>Página não encontrada</h2>
      <p style={{ margin: "16px 0", color: "var(--muted)" }}>
        O recurso ou projeto solicitado não foi encontrado.
      </p>
      <Link href="/" className="primaryButton" style={{ display: "inline-block", textDecoration: "none", lineHeight: "44px" }}>
        Voltar para a página inicial
      </Link>
    </div>
  );
}
