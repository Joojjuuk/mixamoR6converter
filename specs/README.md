# Mixamo → Roblox R6 Converter — Specs

Este diretório é a fonte de verdade funcional/técnica do projeto.

## Regras

1. Toda mudança relevante de comportamento deve ter uma spec antes ou junto do código.
2. Bugs visuais/reprodutíveis ficam em `specs/bugs/`.
3. Cada spec deve declarar: problema, objetivo, não-objetivos, algoritmo/fluxo, critérios de aceitação e riscos.
4. Quando uma implementação divergir da spec, a spec deve ser atualizada no mesmo PR.
5. O solver deve ser versionado (`preview-v1`, `preview-v2`, etc.) para que comparações continuem reproduzíveis.

## Índice

- [`000-original-product-spec.md`](./000-original-product-spec.md) — prompt/especificação base do projeto.
- [`001-smart-r6-solver-v2.md`](./001-smart-r6-solver-v2.md) — estratégia de estabilização do primeiro retarget.
- [`002-smart-r6-solver-v3-and-gif-debug.md`](./002-smart-r6-solver-v3-and-gif-debug.md) — grounding por pé de apoio, cadeia de braços e export GIF de comparação.
- [`003-smart-r6-solver-v4-temporal-footplant.md`](./003-smart-r6-solver-v4-temporal-footplant.md) — pose track temporal, foot plant XYZ, histerese e orientação por plano.
- [`004-smart-r6-solver-v5-pose-fitting.md`](./004-smart-r6-solver-v5-pose-fitting.md) — pose fitting, membros R6 nativos (pernas no Torso), contato contínuo e Debug Solver.
- [`bugs/BUG-001-standing-melee-combo-preview.md`](./bugs/BUG-001-standing-melee-combo-preview.md) — primeiro bug real observado em animação Mixamo.
- [`bugs/BUG-002-preview-v2-floating-feet-and-arms.md`](./bugs/BUG-002-preview-v2-floating-feet-and-arms.md) — defeitos residuais de pés e braços após o v2.
- [`bugs/BUG-003-preview-v3-validation.md`](./bugs/BUG-003-preview-v3-validation.md) — checklist de validação visual do v3.
- [`TEMPLATE.md`](./TEMPLATE.md) — modelo para novas specs.

## Fluxo de uma mudança

```text
observação / arquivo FBX
        ↓
bug/spec
        ↓
critério de aceitação
        ↓
implementação
        ↓
comparação original x R6
        ↓
GIF/WebM + validação em 0.25x / 1x
        ↓
merge
```

## Evidência recomendada para bugs de animação

Sempre que possível anexar ao issue/PR:

- nome do FBX;
- duração e FPS;
- GIF gerado pelo botão `Baixar GIF comparação` ou WebM/MP4;
- timestamps problemáticos;
- screenshots de antecipação, impacto e recuperação;
- descrição curta do defeito (`pé flutua`, `torso gira`, `braço inverte`, etc.).

O arquivo FBX continua sendo a melhor evidência para reprodução exata. GIF/WebM sincronizado é a melhor evidência visual para revisão rápida.
