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
- [`001-smart-r6-solver-v2.md`](./001-smart-r6-solver-v2.md) — nova estratégia do retarget visual R6.
- [`bugs/BUG-001-standing-melee-combo-preview.md`](./bugs/BUG-001-standing-melee-combo-preview.md) — primeiro bug real observado em animação Mixamo.
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
validação em 0.25x / 1x
        ↓
merge
```

## Evidência recomendada para bugs de animação

Sempre que possível anexar ao issue/PR:

- nome do FBX;
- duração e FPS;
- vídeo/GIF de 5–10 s do comparador;
- timestamps problemáticos;
- screenshots de antecipação, impacto e recuperação;
- descrição curta do defeito (`pé flutua`, `torso gira`, `braço inverte`, etc.).

O arquivo FBX é a melhor evidência porque permite reproduzir o frame exato no solver.
