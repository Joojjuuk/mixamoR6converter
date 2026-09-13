# 000 — Especificação original do produto

Status: **base**

## Prompt inicial do projeto

> Criar uma aplicação web capaz de receber animações `.fbx`, principalmente exportadas do Mixamo, converter automaticamente essas animações para um rig compatível com Roblox R6 e permitir que o usuário compare visualmente a animação original com a convertida antes de baixar o resultado.
>
> O sistema deve funcionar como uma biblioteca de conversões: todo arquivo enviado, configuração utilizada, resultado gerado e tentativa de conversão deve ficar salvo para consulta posterior.
>
> O objetivo técnico principal é preservar o movimento e a intenção visual da animação original mesmo com as limitações estruturais do R6.

## Fluxo alvo

```text
Dashboard
   ↓
Upload FBX
   ↓
Análise do rig
   ↓
Preview original
   ↓
Retarget Mixamo → R6
   ↓
Comparação sincronizada
   ↓
Aprovar / reconverter
   ↓
Bake
   ↓
Download FBX R6
```

## Requisitos base

- upload de `.fbx`;
- preservar o arquivo original;
- detectar esqueleto Mixamo;
- manter histórico por projeto;
- exibir original e R6 lado a lado;
- timeline/playback sincronizados;
- Smart Retarget orientado por pose/silhueta, não simples cópia de bones;
- worker Blender headless para análise e, futuramente, bake/export;
- nunca sobrescrever uma versão anterior.

## Princípio de fidelidade

Mixamo possui coluna, cotovelos, joelhos, mãos e pés articulados; R6 não. Portanto, fidelidade significa preservar principalmente:

1. timing;
2. silhueta;
3. direção dos golpes;
4. antecipação;
5. impacto;
6. recuperação;
7. contato visual plausível com o chão.

Não significa reproduzir literalmente todos os graus de liberdade do esqueleto Mixamo.

## Fases

### Phase 1

Provar o fluxo web e um retarget visual em tempo real.

### Phase 2

Estabilizar o solver com animações reais e um rig R6 canônico.

### Phase 3

Portar o solver validado para Blender/Python, bakear keyframes e exportar um FBX realmente importável no Roblox Studio.
