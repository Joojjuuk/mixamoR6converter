# BUG-001 — Standing Melee Combo Attack Ver. 1

Status: **open**

## Arquivo

`Standing Melee Combo Attack Ver. 1.fbx`

Observado durante validação manual da Phase 1 em 2026-09-13.

## Sintomas

1. os dois pés deixam o chão simultaneamente em trechos onde a fonte aparenta estar apoiada;
2. o corpo perde rigidez e parece “gosma”;
3. torso/root rotacionam em direções que não correspondem visualmente ao Mixamo;
4. a leitura de perspectiva dos membros quebra durante o combo;
5. o R6 fica muito mais deformado visualmente do que a limitação natural do rig justificaria.

## Reprodução

1. iniciar aplicação;
2. enviar `Standing Melee Combo Attack Ver. 1.fbx`;
3. abrir a página de comparação;
4. ativar loop;
5. observar em `1x`;
6. repetir em `0.25x` e fazer scrub frame a frame.

## Resultado esperado

- R6 mantém corpo rígido;
- root gira somente em yaw;
- inclinações de ataque ficam principalmente no torso;
- pés preservam leitura de apoio quando a fonte está no chão;
- não existem flips/quebra repentina de perspectiva;
- golpe continua reconhecível como o mesmo combo.

## Hipótese de causa

O `preview-v1` mistura world-space da fonte com local-space do target e usa o frame 0 como bind pose. Ver `001-smart-r6-solver-v2.md`.

## Evidência adicional ideal

Para fechar este bug, anexar ao PR/issue:

- vídeo/GIF do comparador em 0.25x;
- timestamp de 2–4 frames ruins;
- FBX original para reprodução automatizada.

## Critério para fechar

Fechar somente depois de testar o mesmo arquivo no `preview-v2` e confirmar todos os critérios obrigatórios da spec 001.
