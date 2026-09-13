# 001 — Smart R6 Solver v2

Status: **implementing**

## Problema observado no preview-v1

Em animações reais de combate, o preview R6 apresenta sintomas como:

- os dois pés saem do chão simultaneamente sem necessidade;
- torso/corpo parece “gosma” e perde rigidez;
- rotações parecem aleatórias;
- membros mudam de perspectiva/orientação de forma não plausível;
- a pose do R6 pode não se parecer com a silhueta do Mixamo apesar de usar os mesmos frames.

## Causa técnica do v1

O `preview-v1` calcula deltas entre vetores **em world space** do Mixamo e aplica esses quaternions diretamente em pivôs **local space** do R6. Esses espaços não são equivalentes.

Além disso:

- a pose no frame 0 da animação é tratada como bind pose mesmo quando não é uma T-pose;
- o torso usa a rotação absoluta de um único bone de coluna como referência para todo o tronco;
- pernas não são resolvidas em relação a um root estável;
- a altura do root é derivada apenas de `Hips.y`;
- não existe detecção de pé de apoio/grounding.

## Objetivo do v2

Produzir uma projeção R6 visualmente estável e determinística que preserve a leitura da animação sem tentar reproduzir articulações inexistentes.

Prioridades, nesta ordem:

1. estabilidade;
2. contato com o chão;
3. silhueta;
4. direção dos ataques;
5. fidelidade fina.

## Estratégia

### 1. Pose resolvida por posições, não por cópia de rotação

A cada frame obter posições mundiais de pontos anatômicos:

```text
Hips
Spine2 / Chest
Head
LeftShoulder / LeftArm
LeftHand
RightShoulder / RightArm
RightHand
LeftUpLeg
LeftFoot
RightUpLeg
RightFoot
```

A orientação R6 é reconstruída a partir dessas posições.

### 2. Root yaw separado do torso

O root recebe apenas a direção horizontal principal do personagem (yaw).

Pitch/roll e inclinação de ataque ficam no torso.

Isso evita que uma inclinação do peito seja interpretada como giro do personagem inteiro.

### 3. Torso como frame ortonormal estável

Construir um frame corporal usando:

- `up`: Hips → Chest;
- `right`: ombro esquerdo → ombro direito;
- `forward = right × up`;
- re-ortogonalizar os vetores antes de gerar o quaternion.

Depois separar:

```text
body world rotation
        ↓
root yaw
        +
torso local residual
```

### 4. Membros no espaço do pai

Para cada braço:

```text
shoulder → hand
```

Converter essa direção de world space para **torso local space** antes de orientar o pivô R6.

Para cada perna:

```text
hip → foot
```

Converter para **root local space**.

O eixo de repouso do membro R6 é explicitamente `DOWN (0,-1,0)`. O quaternion deve mapear `DOWN → targetDirectionLocal`, e não `bindDirection → currentDirection`.

### 5. Grounding

O root não deve simplesmente copiar `Hips.y`.

Calcular altura dos pés do Mixamo e identificar suporte:

- pé mais baixo tende a ser o pé de apoio;
- usar histerese para não trocar suporte a cada frame por ruído;
- manter o ponto mais baixo do R6 próximo de `y=0`;
- permitir saída do chão quando **os dois pés do Mixamo** realmente estão acima do nível de referência (salto).

No preview inicial do v2, a correção pode ser geométrica e sem IK completa.

### 6. Sem stretch

O R6 é rígido.

- torso mantém tamanho fixo;
- braços mantêm tamanho fixo;
- pernas mantêm tamanho fixo;
- nenhuma escala por frame.

### 7. Limites de segurança

Evitar poses degeneradas:

- se um vetor tiver comprimento quase zero, manter a rotação anterior;
- ortonormalizar frames;
- normalizar quaternions;
- evitar NaN/Infinity;
- limitar `root pitch/roll` a zero;
- opcionalmente limitar torso pitch/roll extremo no preview.

## Métricas/diagnóstico de preview

Exibir ou registrar:

- solver version;
- suporte atual: `left`, `right`, `airborne`;
- root height;
- root yaw;
- warning para frame degenerado.

Modo debug futuro:

- pontos de ombro/quadril/mão/pé;
- vetores de membros;
- eixo forward/right/up.

## Critérios de aceitação

Para uma animação de melee em solo:

- [ ] não há flips instantâneos de torso ou membros;
- [ ] ao menos um pé permanece visualmente próximo do chão quando o Mixamo está apoiado;
- [ ] os dois pés só deixam o chão juntos quando a fonte realmente salta;
- [ ] o root não recebe pitch/roll;
- [ ] torso continua rígido e com dimensões constantes;
- [ ] braço esquerdo/direito não troca de lado;
- [ ] a direção principal do golpe é reconhecível;
- [ ] scrub da timeline para frente/trás produz a mesma pose no mesmo timestamp;
- [ ] playback 0.25x não revela jitter grande ou flips.

## Não-objetivos desta versão

- IK de joelho/cotovelo;
- reprodução perfeita de mãos/pés;
- export FBX final;
- foot locking cinematográfico;
- machine learning;
- edição manual de keyframes.

## Próximos passos após validação

1. testar com melee combo, run, jump, dodge e sword slash;
2. calibrar grounding e limites;
3. adicionar rig R6 canônico do Roblox;
4. portar exatamente o solver aprovado para Blender/Python;
5. bake a 30 FPS;
6. exportar `converted_r6.fbx`.
