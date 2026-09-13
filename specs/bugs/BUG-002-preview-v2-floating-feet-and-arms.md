# BUG-002 — preview-v2: pés ainda flutuam e braços perdem a leitura

Status: **fix candidate in preview-v3**

## Arquivo usado

`Standing Melee Combo Attack Ver. 1.fbx`

Duração observada no comparador: aproximadamente `4.67s`.

## Resultado observado

Após a correção do BUG-001, a animação melhorou de forma clara, mas ainda apresenta:

- ambos os pés visualmente afastados do chão em trechos de melee;
- root aparentemente elevado em poses que deveriam continuar grounded;
- braços R6 apontando para posições pouco naturais;
- perda da leitura da dobra de cotovelo do Mixamo;
- em alguns frames o personagem R6 parece estar suspenso em vez de transferindo peso entre as pernas.

## Hipótese de causa — pés

O preview-v2 mede contato usando principalmente os bones `Foot` e um ground global. O bone `Foot` do Mixamo representa região de ankle/foot e pode subir mesmo com toes ainda próximos do solo.

Além disso, o v2 aterra o menor endpoint resultante do R6, que não necessariamente corresponde ao mesmo pé de apoio da fonte.

## Hipótese de causa — braços

O R6 não possui cotovelo.

O preview-v2 reduz a cadeia:

```text
shoulder → elbow → hand
```

para somente:

```text
shoulder → hand
```

Em poses muito dobradas, especialmente ataques/guards com mãos próximas do tronco ou cabeça, esse vetor não representa bem a direção visual do upper arm.

## Correção proposta

Implementar `preview-v3` conforme `specs/002-smart-r6-solver-v3-and-gif-debug.md`:

- detectar `ForeArm` e `ToeBase`;
- usar direção ponderada do upper arm + alcance da mão;
- usar toe/foot como ground probe;
- exigir subida simultânea de pés + hips para airborne;
- travar em `y=0` o endpoint R6 do mesmo lado que serve de apoio no Mixamo;
- gerar GIF comparativo para validar a animação inteira.

## Como validar

1. abrir o mesmo projeto existente;
2. confirmar que a tela indica `preview-v3`;
3. reproduzir em `0.25x`;
4. clicar em `Baixar GIF comparação`;
5. revisar principalmente transferências de peso e poses com cotovelo bem dobrado;
6. se restarem defeitos, anotar timestamp diretamente a partir do GIF.

## Aceitação

- [ ] pé de apoio não fica visivelmente suspenso durante melee grounded;
- [ ] `airborne` só aparece quando corpo e dois pés realmente sobem;
- [ ] braços deixam de apontar de forma extrema apenas por causa da posição da mão;
- [ ] GIF consegue reproduzir e compartilhar o defeito residual.