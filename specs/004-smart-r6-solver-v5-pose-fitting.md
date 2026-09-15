# 004 — Smart R6 Solver v5: pose fitting com membros R6 nativos

Status: **implementado / validação visual do usuário pendente**

## Contexto

O `preview-v4.1` estabilizou contato e continuidade, mas o WebM `mixamo-com-preview-v4.1-comparison.webm` e a medição offline no `Standing Melee Combo Attack Ver. 1.fbx` mostraram:

1. pernas presas ao **root**, não ao Torso: quando o torso inclinava, o quadril R6 "descolava" do bloco;
2. o IK exato do pé de apoio **re-mirava a perna inteira** para o anchor, e o root XZ ficava preso em 0.7 stud enquanto a fonte anda ~4 unidades para frente (dois passos) — a perna perdia a silhueta (erro médio de perna subiu de 0.24 → 0.40 stud do v4 para o v4.1);
3. o canto do bloco da perna afundava até 0.6 stud no chão, e `keepOtherFootAboveGround` não levantava de fato (recalculava o mesmo endpoint);
4. braço ≈ só o upper arm (peso 0.8–0.98), perdendo mão/antebraço em socos e guardas;
5. a última amostra (`t === duration`) fazia o `AnimationMixer` voltar ao frame 0.

## Objetivo

Tratar o retarget como **pose fitting**: cada bloco R6 é o bastão rígido que minimiza um custo de erro contra a pose da fonte, respeitando a estrutura R6 real — membros giram no próprio encaixe do Torso (Motor6D) e o quanto giram vem do movimento da animação, não de copiar bones.

## Não-objetivos

- articulações que o R6 não tem (cotovelo, joelho, coluna);
- export FBX / bake Blender;
- mudanças em upload, API de storage ou GIF além de registrar a versão;
- machine learning ou otimizador numérico pesado.

## O que foi preservado do v4.1

- pose track pré-amostrada a 30 FPS e interpolada no runtime (scrub determinístico);
- contact state machine (`assignContactStates`, histerese, `smoothSpeeds`, probe estável toe/foot) — reaproveitada sem mudança de comportamento, agora como camada de classificação/diagnóstico;
- continuidade de quaternion (mesmo hemisfério) e continuidade do plano cotovelo/joelho;
- proteção contra penetração no chão (agora correta);
- GIF e WebM usam a mesma pose track;
- `preview-v4.1` continua selecionável no viewer (botão **Solver**) para comparação no mesmo timestamp.

## Arquitetura

```text
Mixamo @30 FPS ──► landmarks (hips, ombros, cotovelos, mãos, quadris, joelhos, pés, toes, cabeça)
                    │
                    ├─ torso: frame rígido (corda pelve→ombros, twist 90% ombros / 10% pelve)
                    ├─ braços/pernas: fit fechado por membro (custo linear na direção)
                    ├─ pernas em contato: azimute da coxa + queda vinda da altura do quadril
                    └─ root: média ponderada dos roots que os pés em contato implicam
                    ▼
               pose track R6 (Root, Torso, Head, Left/Right Arm, Left/Right Leg)
```

Hierarquia do rig v5: `Root → Torso → {Head, Left Arm, Right Arm, Left Leg, Right Leg}` (hips no Torso, como Motor6D do R6).

### 1. Fit de membro (braços e pernas)

Todo termo é uma distância ao quadrado entre um ponto do bloco rígido (`pivot + t·2·d`) e um alvo, então o custo é linear na direção unitária `d`: `custo = const − 2·d·g` e o ótimo é `d = g/|g|`. Termos:

| termo | braço | perna | significado |
|---|---|---|---|
| silhueta `∫‖t·d − m(t)‖²` | 1.0 | 1.0 | bastão × polilinha normalizada ombro→cotovelo→mão→nó dos dedos / quadril→joelho→tornozelo |
| direção do segmento superior | 1.0 | 1.0 | upper arm / coxa decidem para onde o membro aponta |
| endpoint na cadeia | 0.5 | 0.6 | mão / tornozelo relativos ao próprio ombro/quadril |
| mão no espaço do corpo | 0.3 | — | posição da mão em relação ao peito (lateral normalizada: linha média→linha média, ombro→pivot R6) |
| temporal | 0.1 | 0.1 | desempate em cadeias degeneradas, não suavização |

Roll: normal do plano `upper × lower`, com confiança `sin(dobra)/sin(20°)`; membro quase reto herda o plano anterior (sem twist de 180°).

### 2. Pernas em contato — "acompanhamento R6"

Perna R6 não dobra. Joelho dobrado na fonte vira **perna aberta** a partir do quadril:

- **azimute** = direção horizontal do fit (coxa pesa) — joelho para frente ⇒ perna R6 para frente;
- **queda vertical** = altura do quadril da fonte acima do próprio contato, escalada (`2 studs ↔ quadril com a perna estendida`, percentil 95 do clip). Agachou ⇒ quadril R6 desce e a perna abre;
- compromisso `CROUCH_TRANSFER = 0.6` entre essa queda e a que mantém o pé na âncora (perna quase vertical transforma um pequeno "bob" do quadril em grande deslocamento horizontal do pé);
- o pé toca o chão pelo canto mais baixo do bloco 1×2×1.

### 3. Contato e root

- nível de contato contínuo `c = 1 − lift/0.39` (0 no exit height da state machine) — nenhuma troca binária;
- alvo do pé = `probe da fonte × escala + offset fixo do clip`: pé plantado na fonte ⇒ alvo fixo; clip in-place (pé desliza na fonte) ⇒ desliza igual; nada acumula entre passos;
- root = média ponderada dos roots implicados pelos pés (peso `(|g|/4)·c⁴`) + prior fraco (root anterior + movimento da pelve da fonte) que só decide sem contato (salto);
- root motion segue a fonte (escala da perna). O viewer centraliza cada personagem na própria câmera.

### 4. Torso e cabeça

Torso = corda pelve→ombros (inclinação real do tronco) com twist 90% ombros / 10% pelve (alavancas R6: ombros a 1.5 stud, quadris a 0.5). Sem clamp. Root recebe só yaw. Cabeça = `Head → HeadTop_End` no espaço do torso, limitada a 50°.

## Diagnóstico

Botão **Debug Solver** no viewer:

- Mixamo: landmarks (rosa);
- R6: alvos projetados da cadeia (azul), endpoint do bloco (amarelo), vetor de erro (vermelho), alvo da mão no espaço do corpo (roxo), alvo do pé carregado (verde) e do outro pé (laranja), eixos do torso (vermelho right, verde up, azul forward);
- HUD: state, lock, plant err (deslize por frame do pé carregado), root Y/XZ, lift, erro por braço/perna (RMS em studs), torso (°), total, nível de contato.

O WebM grava a mesma linha de diagnóstico por frame no rodapé; com Debug ligado o overlay vai junto no vídeo.

## Critérios de aceitação

- [ ] nenhum flip de 180° (maior passo angular de membro por frame < 90°; medido: 48° no melee, igual à fonte);
- [ ] nenhum braço trocando de lado / perna invertendo;
- [ ] ataque no chão não flutua (pé carregado no chão, canto do bloco ≥ −0.1 stud);
- [ ] salto real continua airborne (root sobe com a pelve da fonte);
- [ ] pé de apoio não desliza livremente (plant err ≈ 0 enquanto a fonte mantém o pé);
- [ ] torso não gira aleatoriamente;
- [ ] joelho dobrado/lunge aparece como perna R6 aberta a partir do quadril;
- [ ] mesmo timestamp = mesma pose (independe da direção do scrub);
- [ ] GIF e WebM funcionam; WebM a 30 FPS com diagnóstico por frame.

## Evidências

Mesma métrica para os dois solvers (`Standing Melee Combo Attack Ver. 1`, 141 amostras):

| métrica | v4.1 | v5 |
|---|---|---|
| erro braço E/D (stud RMS, médio) | 0.43 / 0.46 | 0.28 / 0.28 |
| erro perna E/D (máx) | 1.23 / 1.05 | 0.65 / 0.76 |
| canto do pé de apoio (Y médio) | −0.34 (afunda) | +0.03 |
| penetração do outro pé (pior) | −1.11 | −0.03 |
| deslize do outro pé em duplo apoio (pior) | 0.95 | 0.32 |
| inclinação da perna vs fonte (° médio) | 7.1 | 6.1 |
| trocas de lado detectadas | 6 | 2* |

\* as 2 restantes são pernas que seguem a coxa para frente enquanto o pé da fonte fica atrás (comportamento pedido).

Também verificados: `Standing Melee Combo Attack Ver. 3`, `Standing Taunt Chest Thump`, `Sheathing Sword`, e variantes sintéticas do melee com salto (15 frames airborne) e in-place (R6 fica no lugar: root final z 0.14 vs 3.54 com root motion). `node scripts/check-solver.mjs "<fbx>"` valida determinismo, scrub, flips e chão.

## Limitações / próximos passos

- em duplo apoio os dois pés dividem a correção: o pé "de apoio" pode deslizar ~4 cm/frame quando a fonte dobra/estica o joelho com os dois pés no chão (R6 rígido não tem outra saída);
- giro sobre um pé orbita o corpo em torno do quadril de apoio (quadris R6 a 1 stud);
- proporções R6 ≠ humano: stance ~25% mais aberto que a fonte escalada;
- pivots do preview ainda são "centro do topo do bloco"; offsets reais de Motor6D (C0/C1) entram no export Blender;
- o `preview-v4.1` mantém o bug antigo da última amostra (frame 0) para não alterar a baseline de comparação;
- WebM usa `MediaRecorder` em tempo real: com a aba em segundo plano o navegador estrangula timers e o vídeo sai em câmera lenta.
