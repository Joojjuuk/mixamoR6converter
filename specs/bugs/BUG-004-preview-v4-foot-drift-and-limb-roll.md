# BUG-004 — preview-v4: foot drift residual e roll instável dos membros

Status: **corrigido em preview-v4.1 / validação necessária**

## Evidência

Arquivo analisado: `mixamo-com-preview-v4-comparison.webm`.

O vídeo mostrou que o v4 já eliminou os grandes flips do torso, porém ainda havia três diferenças perceptíveis:

1. o pé marcado como apoio podia continuar com pequeno drift porque o root era corrigido depois da orientação da perna, mas a perna não era resolvida novamente para fechar exatamente no anchor;
2. o probe de contato alternava entre `Foot` e `ToeBase` conforme qual estivesse mais baixo. Isso mantinha Y razoável, porém podia criar saltos artificiais de X/Z e velocidade;
3. em cadeias quase retas, o plano cotovelo/joelho podia trocar de sinal entre frames, causando roll/twist visualmente incoerente.

Também foi perceptível que, em ataques/crouches mais fortes, o R6 permanecia alto demais em alguns frames porque o foot plant não fechava geometricamente a distância fixa de 2 studs da perna R6.

## Correção preview-v4.1

### Support-foot IK exato

Após decidir o support foot e limitar X/Z do root:

1. calcular o hip pivot R6 em world space;
2. manter o `plantAnchor` fixo;
3. resolver a altura do root pela esfera de alcance da perna rígida de 2 studs;
4. recalcular o swing quaternion da perna para apontar exatamente hip → anchor;
5. validar `plantError` após essa correção.

Isso fecha o loop que faltava no v4.

### Probe estável

Quando `ToeBase` existir:

- X/Z vêm sempre do toe;
- Y usa `min(Foot.y, Toe.y)`.

Assim o ponto de contato não troca de bone durante o clip.

### Continuidade do plano

Cada cadeia mantém a normal do plano do frame anterior.

Se a normal atual tiver sinal oposto, ela é invertida. Se a cadeia estiver quase reta, reutiliza a normal anterior em vez de escolher um eixo arbitrário novo.

### Braços

O upper-arm ganhou mais peso na aproximação R6, porque um único bloco R6 representa melhor a leitura do ombro do que tentar perseguir demais a posição final da mão em poses com cotovelo dobrado.

## Critérios de validação

- [ ] `plantError` permanece próximo de zero durante um segmento plantado;
- [ ] pé de apoio não patina em X/Z;
- [ ] crouches/lunges baixam o root de forma mais compatível com a abertura das pernas;
- [ ] foot speed não apresenta spike apenas por troca Foot/Toe;
- [ ] braço/perna não fazem twist de 180° quando a cadeia passa por quase reta;
- [ ] WebM v4.1 mantém o timing do Mixamo e não introduz root motion excessivo.

## Próximo teste

Repetir o mesmo `Standing Melee Combo Attack Ver. 1.fbx`, gerar `Baixar WebM comparação` e comparar diretamente v4 × v4.1.