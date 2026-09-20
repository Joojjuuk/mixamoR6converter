# 003 — Smart R6 Solver v4: temporal pose track + foot plant XYZ

Status: **implementing / validation required**

## Contexto

O `preview-v3` removeu a maior parte dos flips do torso e melhorou braços/pernas usando as cadeias completas do Mixamo. O teste em WebM ainda mostrou três limitações:

1. contato do pé era resolvido principalmente por frame e por Y;
2. trocas de apoio ainda podiam acontecer cedo demais;
3. a orientação do bloco R6 usava direção, mas não explorava de forma estável o plano formado por ombro→cotovelo→mão e quadril→joelho→pé.

## Objetivo

Transformar o preview em um solver temporal determinístico. A animação fonte é pré-amostrada a 30 FPS e convertida em uma pose track R6 antes do playback.

Prioridades:

1. contato com o chão;
2. coerência temporal;
3. silhueta;
4. direção e plano dos membros;
5. estabilidade ao scrub;
6. fidelidade fina.

## 1. Pré-processamento temporal

Antes de reproduzir, amostrar o clip inteiro a 30 FPS.

Cada amostra registra:

- root yaw;
- torso/head;
- quaternions dos quatro membros;
- posição dos probes de pé/toe;
- altura dos hips;
- velocidade dos pés;
- estado de contato;
- lado de apoio.

O runtime não recalcula decisões de contato com base na ordem do playback. Ele interpola uma pose track já resolvida.

## 2. Contact state machine

Estados:

```text
LEFT
RIGHT
DOUBLE
AIRBORNE
```

A entrada/saída de contato usa thresholds diferentes (histerese) para altura e velocidade do pé.

Troca de `left → right` ou `right → left` exige alguns frames consecutivos de evidência quando o suporte anterior ainda continua plausível.

`AIRBORNE` continua conservador: ambos os pés e os hips precisam subir juntos.

## 3. Foot plant XYZ

Quando existe suporte:

1. calcular o endpoint da perna R6 no início do segmento;
2. salvar esse ponto como `plantAnchor`;
3. nos frames seguintes, resolver a posição do root para manter o endpoint no anchor;
4. Y pertence ao contato e deve continuar exatamente no chão;
5. X/Z são limitados para não transformar uma animação in-place em root motion excessivo.

Na troca de apoio, o novo anchor nasce a partir da posição atual do root para evitar teleport horizontal.

## 4. Orientação por plano

### Braços

Usar:

```text
shoulder → elbow → hand
```

A direção principal continua sendo uma mistura entre upper-arm e alcance total, porém o quaternion também recebe o plano formado pelos dois segmentos.

### Pernas

Usar:

```text
hip → knee → foot
```

Mesma regra: direção + plano do joelho.

Quando a cadeia fica quase reta e o plano é degenerado, usar um eixo de referência estável do parent em vez de aceitar uma normal numérica aleatória.

## 5. Continuidade de quaternion

A pose track é construída sequencialmente.

Para cada track de quaternion:

- normalizar;
- manter o mesmo hemisfério (`dot(prev, current) >= 0`);
- limitar mudanças angulares absurdas por amostra;
- somente depois interpolar no runtime.

Isso torna o scrub determinístico e reduz flips de 180°.

## 6. Root temporal

Root recebe somente yaw. Pitch/roll continuam no torso.

A correção horizontal do foot plant possui limite de deslocamento e de passo por frame. Grounding em Y não deve ser sacrificado por smoothing horizontal.

## 7. GIF/WebM de diagnóstico

GIF e WebM devem usar o mesmo sampler temporal da tela. `renderAt(time)` precisa renderizar o timestamp solicitado diretamente, sem depender do estado anterior do playback.

### GIF

- comparação rápida e leve;
- original e R6 lado a lado;
- timestamp e solver no rodapé.

### WebM

Adicionar botão:

```text
Baixar WebM comparação
```

Requisitos:

- 30 FPS;
- resolução de diagnóstico maior que a do GIF;
- Original × R6 no mesmo frame;
- cabeçalho e rodapé com clip, solver e timestamp;
- codec `VP9`, com fallback `VP8` / WebM simples quando necessário;
- progresso visível durante geração;
- pausar playback durante export;
- restaurar timestamp e estado de playback ao finalizar;
- impedir GIF e WebM simultâneos.

Como `MediaRecorder` usa timestamps de relógio real, o WebM é gravado no ritmo real do clip para preservar a duração esperada.

Diagnóstico exibido:

- contact state;
- lado travado;
- plant error;
- root Y;
- deslocamento XZ;
- lift dos dois pés.

## Critérios de aceitação

### Temporal

- [ ] scrub para frente/trás produz a mesma pose no mesmo timestamp;
- [ ] nenhuma decisão de suporte depende da ordem em que o usuário visitou os frames;
- [ ] quaternions não dão flip instantâneo de 180°.

### Grounding

- [ ] melee grounded mantém o support foot em Y≈0;
- [ ] support foot não desliza livremente em X/Z durante o mesmo segmento;
- [ ] troca de apoio não flicka frame a frame;
- [ ] saltos reais continuam classificados como airborne;
- [ ] root horizontal continua limitado para animações in-place.

### Membros

- [ ] braço dobrado preserva melhor upper-arm e plano do cotovelo;
- [ ] perna preserva melhor direção e plano do joelho;
- [ ] cadeias quase retas não geram roll aleatório;
- [ ] esquerda/direita nunca são trocadas.

### Diagnóstico/export

- [ ] GIF, WebM e viewer usam a mesma pose track;
- [ ] UI mostra state, lock e plant error;
- [ ] GIF restaura o timestamp anterior;
- [ ] WebM gera um arquivo reproduzível com duração compatível com o clip;
- [ ] WebM contém Original × R6 sincronizados a 30 FPS;
- [ ] export WebM restaura timestamp e playback anterior;
- [ ] somente um export pode rodar por vez.

## Não-objetivos

- IK com joelhos/cotovelos reais;
- criar articulações inexistentes no R6;
- exportar FBX nesta fase;
- root motion completo;
- machine learning;
- foot plant cinematográfico sem qualquer drift em situações fisicamente incompatíveis com o R6.

## Validação obrigatória

Repetir `Standing Melee Combo Attack Ver. 1.fbx` e comparar v3 × v4 em 0.25x e 1x. Gerar preferencialmente o WebM de comparação para revisão frame a frame. Depois testar pelo menos `run`, `jump`, `dodge` e `sword slash` antes de portar o solver para Blender.