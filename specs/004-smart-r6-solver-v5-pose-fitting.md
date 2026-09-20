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
- continuidade de quaternion (mesmo hemisfério); o roll pelo plano cotovelo/joelho saiu — virou swing sem twist;
- proteção contra penetração no chão (agora correta);
- GIF e WebM usam a mesma pose track;
- `preview-v4.1` continua selecionável no viewer (botão **Solver**) para comparação no mesmo timestamp.

## Arquitetura

```text
Mixamo @30 FPS ──► landmarks (hips, ombros, cotovelos, mãos, quadris, joelhos, pés, toes, cabeça)
                    │
                    ├─ torso: frame rígido (corda pelve→ombros, twist 90% ombros / 10% pelve)
                    ├─ braços/pernas: fit fechado por membro (custo linear na direção)
                    ├─ pés plantados: sola exatamente no alvo, perna aponta para o pé (IK)
                    └─ root: pelve da fonte projetada nas esferas de alcance dos pés plantados
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

Rotação só de **swing** (do bloco pendurado reto até a direção, sem giro no próprio eixo): nada de braço "girando como broca"; as faces do bloco ficam alinhadas com o torso como num R6 animado à mão. Perto de "reto para cima" (swing indefinido) a orientação do frame anterior é carregada, também sem twist.

### 2. Pés — plantado é restrição dura

- nível de contato contínuo `c = 1 − lift/0.39` (0 no exit height da state machine);
- alvo do pé = `probe da fonte × escala + offset fixo do clip`: pé plantado na fonte ⇒ alvo fixo (o pé R6 não desliza); clip in-place ⇒ desliza igual à fonte; nada acumula entre passos;
- o corpo quer ficar onde a pelve da fonte está (mesmo frame de chão), na altura do quadril da fonte escalada (`2 studs ↔ quadril com a perna estendida`, percentil 95 do clip);
- esse root desejado é projetado nas esferas de raio 2 studs em volta de cada pé plantado (pé mais carregado por último ⇒ sempre exato; dois pés plantados convergem para onde as duas pernas alcançam) e a perna aponta direto para o pé: **a sola (centro da base do bloco) fica exatamente no chão, no mesmo ponto**;
- com os pés sob o quadril a perna fica reta; quando a fonte abre base ou agacha, a perna R6 abre a partir do quadril e o corpo desce junto;
- pé saindo do chão mistura IK → fit pela carga; pé no ar balança pela coxa (joelho alto ⇒ perna R6 para frente);
- root motion segue a fonte. O viewer centraliza cada personagem na própria câmera.

### 3. Torso e cabeça

Torso = corda pelve→ombros (inclinação real do tronco) com twist 90% ombros / 10% pelve (alavancas R6: ombros a 1.5 stud, quadris a 0.5). Root recebe só yaw. Cabeça contida: 60% da inclinação `Head → HeadTop_End` relativa ao torso, limitada a 25°, sem giro no eixo.

## Diagnóstico

Botão **Debug Solver** no viewer:

- Mixamo: landmarks (rosa);
- R6: alvos projetados da cadeia (azul), endpoint do bloco (amarelo), vetor de erro (vermelho), alvo da mão no espaço do corpo (roxo), alvo do pé carregado (verde) e do outro pé (laranja), eixos do torso (vermelho right, verde up, azul forward);
- HUD: state, lock, plant err (deslize por frame do pé carregado), root Y/XZ, lift, erro por braço/perna (RMS em studs), torso (°), total, nível de contato.

O WebM grava a mesma linha de diagnóstico por frame no rodapé; com Debug ligado o overlay vai junto no vídeo.

## Critérios de aceitação

- [ ] nenhum flip de 180° (maior passo angular de membro por frame < 90°; medido: 63° no melee, golpe real da fonte);
- [ ] nenhum braço trocando de lado / perna invertendo;
- [ ] pé plantado: sola no chão, no mesmo ponto, sem flutuar (plant err ≈ 0, sola ≥ −0.05 stud);
- [ ] braço/perna sem giro no próprio eixo; cabeça sem rotação exagerada;
- [ ] salto real continua airborne (root sobe com a pelve da fonte);
- [ ] torso não gira aleatoriamente;
- [ ] joelho alto/lunge aparece como perna R6 aberta a partir do quadril;
- [ ] mesmo timestamp = mesma pose (independe da direção do scrub);
- [ ] GIF e WebM funcionam; WebM a 30 FPS com diagnóstico por frame.

## Evidências

Mesma métrica para os dois solvers (`Standing Melee Combo Attack Ver. 1`, 141 amostras):

| métrica | v4.1 | v5 |
|---|---|---|
| erro braço E/D (stud RMS, médio) | 0.43 / 0.46 | 0.28 / 0.28 |
| erro perna E/D (máx) | 1.23 / 1.05 | 0.64 / 0.63 |
| deslize do pé de apoio por frame (médio) | 0.006 | 0.003 |
| deslize do outro pé em duplo apoio (pior) | 0.95 | 0.06 |
| base R6 / base da fonte | 1.15 | 0.98 |
| trocas de lado detectadas | 6 | 0 |

Também verificados: `Standing Melee Combo Attack Ver. 3`, `Standing Taunt Chest Thump`, `Sheathing Sword`, e variantes sintéticas do melee com salto (15 frames airborne) e in-place (R6 fica no lugar: root final z 0.56 vs 3.96 com root motion). Teste no app real (upload pela UI, Chrome, scrub, Debug Solver, troca v5/v4.1, WebM gerado pelo botão). `node scripts/check-solver.mjs "<fbx>"` valida determinismo, scrub, flips e sola no chão.

## Limitações / próximos passos

- bloco rígido inclinado com a sola no chão: a quina da frente entra no grid (até ~0.4 stud em lunge profundo) — é o preço de sola no chão sem tornozelo;
- giro sobre um pé orbita o corpo em torno do quadril de apoio (quadris R6 a 1 stud);
- quando a fonte agacha com os pés sob o quadril, o R6 fica mais alto (perna rígida não encurta);
- pivots do preview ainda são "centro do topo do bloco"; offsets reais de Motor6D (C0/C1) entram no export Blender;
- o `preview-v4.1` mantém o bug antigo da última amostra (frame 0) para não alterar a baseline de comparação;
- WebM usa `MediaRecorder` em tempo real: com a aba em segundo plano o navegador estrangula timers e o vídeo sai em câmera lenta.
