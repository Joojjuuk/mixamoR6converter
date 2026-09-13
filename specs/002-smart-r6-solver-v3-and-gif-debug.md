# 002 — Smart R6 Solver v3 + GIF de comparação

Status: **implementing / validation required**

## Contexto

O `preview-v2` corrigiu os maiores flips de espaço local/world e melhorou a rigidez do torso, porém o segundo teste real ainda mostrou dois defeitos relevantes:

1. os pés ainda podem sair do chão em poses de melee que visualmente deveriam permanecer apoiadas;
2. os braços R6 podem parecer soltos no ar porque um único bloco R6 estava sendo orientado apenas pelo vetor `shoulder → hand`, ignorando a orientação do braço superior e a dobra do cotovelo.

Também ficou claro que screenshots isoladas são insuficientes para comparar toda a animação. O comparador precisa gerar uma evidência portátil e sincronizada.

## Objetivos

- reduzir falsos `airborne` em animações de combate no solo;
- manter o mesmo lado de apoio do Mixamo no R6;
- representar melhor braços dobrados usando a cadeia completa do Mixamo;
- adicionar botão para baixar um GIF `Original × R6` da animação inteira;
- manter o resultado determinístico ao fazer scrub da timeline.

## 1. Cadeia de braço

O v2 usava principalmente:

```text
shoulder ---------------- hand
```

O v3 usa:

```text
shoulder → elbow → hand
```

Como o R6 possui apenas um bloco rígido para o braço, não é possível reproduzir cotovelo real. A direção final deve ser uma aproximação ponderada entre:

- direção do braço superior (`shoulder → elbow`);
- alcance total (`shoulder → hand`).

Quanto maior a dobra do cotovelo, maior deve ser o peso do braço superior. Isso evita que uma mão próxima da cabeça force o braço R6 inteiro para uma direção pouco plausível.

## 2. Cadeia de perna

Usar:

```text
hip → knee → foot
```

O alcance `hip → foot` continua importante para o pé, mas uma parcela da direção do thigh é mantida quando há grande dobra do joelho. O R6 continua rígido e não recebe IK de joelho nesta fase.

## 3. Ground probe com toes

Quando disponíveis, usar os bones:

```text
LeftToeBase
RightToeBase
```

junto dos bones `LeftFoot` / `RightFoot`.

O ankle do Mixamo pode subir durante uma pose sem o personagem realmente perder contato com o chão. O toe é um probe melhor para detectar contato.

## 4. Ground reference robusto

Não utilizar o menor valor absoluto de um único frame como chão global.

Amostragem do clip:

- 30 amostras/s até limite seguro;
- guardar alturas dos probes dos pés;
- usar percentil baixo para `sourceGroundY`;
- guardar altura dos hips e usar percentil baixo como `sourceHipsBaseY`.

Isso reduz a influência de outliers.

## 5. Detecção conservadora de airborne

Só classificar como `airborne` quando simultaneamente:

```text
left foot lift  > threshold
right foot lift > threshold
hips lift       > threshold
```

Movimento de tornozelo sozinho não pode produzir um salto falso.

## 6. Support-foot lock

Em frames grounded:

1. identificar qual probe do Mixamo está mais baixo;
2. considerar esse lado o suporte (`left` ou `right`);
3. calcular o endpoint da perna R6 correspondente;
4. deslocar o root em Y para colocar **esse endpoint** em `y = 0`.

Isto é diferente do v2, que podia aterrar simplesmente a perna R6 que resultasse mais baixa após a projeção, trocando visualmente o pé de apoio.

## 7. GIF de comparação

Adicionar botão:

```text
Baixar GIF comparação
```

O GIF deve conter:

```text
┌──────────────────────┬──────────────────────┐
│ ORIGINAL · Mixamo    │ CONVERTED · R6       │
│                      │                      │
│        viewport      │       viewport       │
│                      │                      │
└──────────────────────┴──────────────────────┘
clip · solver                  time / duration
```

Requisitos:

- câmeras sincronizadas;
- animações no mesmo timestamp;
- export determinístico, não screen recording dependente de FPS real;
- animação inteira;
- aproximadamente 10 FPS para clips curtos;
- no máximo 120 frames para não explodir CPU/memória;
- mostrar progresso no botão;
- restaurar o timestamp/playback anterior após exportar.

O GIF é ferramenta de diagnóstico, não formato final de animação.

## Critérios de aceitação

### Grounding

- [ ] em melee grounded, ao menos o pé de suporte permanece visualmente no chão;
- [ ] movimentos de tornozelo não geram `airborne` falso;
- [ ] saltos reais continuam podendo elevar os dois pés;
- [ ] o lado de suporte do R6 acompanha o lado mais baixo do Mixamo.

### Braços

- [ ] braços dobrados deixam de apontar apenas para a posição final da mão;
- [ ] a direção do upper arm permanece reconhecível;
- [ ] golpes acima da cabeça continuam possíveis;
- [ ] não há troca esquerda/direita.

### GIF

- [ ] botão gera `.gif` válido;
- [ ] original e R6 aparecem lado a lado;
- [ ] timestamps correspondem;
- [ ] arquivo contém clip e solver version no rodapé;
- [ ] UI não fica permanentemente em outro frame depois da exportação.

## Não-objetivos

- cotovelos/joelhos articulados no R6;
- foot IK completo;
- motion matching;
- export FBX;
- diferença matemática pixel a pixel;
- GIF em qualidade de vídeo.

## Próximo passo

Testar novamente o mesmo `Standing Melee Combo Attack Ver. 1.fbx` e enviar o GIF gerado pelo próprio comparador. A partir desse GIF, registrar timestamps residuais em `BUG-002` e calibrar pesos/thresholds sem alterar a arquitetura do solver.