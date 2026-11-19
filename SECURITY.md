# Política de segurança

## Reportar uma vulnerabilidade

**Não abra issue pública.** Use a aba *Security → Report a vulnerability* do GitHub
(reporte privado) ou fale diretamente com um mantenedor.

Inclua: o que é afetado, como reproduzir e qual o impacto. Responderemos em até 72 horas.

## Incidente (suspeita de vazamento)

1. Avise os mantenedores imediatamente.
2. Troque as chaves expostas (Supabase, hospedagem).
3. Registre o que aconteceu, quando e quais dados foram afetados.
4. Avalie com a coordenação a comunicação aos titulares e à ANPD (LGPD, art. 48).

Detalhes em [`docs/LGPD_E_SEGURANCA.md`](docs/LGPD_E_SEGURANCA.md).

## Dado vazado: como remover o registro

**Regra de ouro:** apagar não desfaz um vazamento. Primeiro **contenha** (troque a chave, revogue o
acesso). Depois **remova**. Por fim, **registre** o que aconteceu.

### No repositório (segredo ou dado pessoal num commit)

O repositório é público. O que entra num commit pode ter sido copiado em minutos, por forks,
clones e robôs que varrem o GitHub.

1. **Troque o segredo na hora:** chave, senha ou token. Só isso resolve de verdade.
2. **Tire o valor do código** por um PR normal.
3. **Se for dado pessoal ou precisar sumir do histórico:**
   - o mantenedor libera temporariamente o force-push na proteção da `main`;
   - reescreve o histórico com `git filter-repo`;
   - envia com force-push;
   - **religa a proteção**.
4. **Peça ao suporte do GitHub** para remover as cópias em cache e as referências de PR, que o
   force-push não apaga. Forks já feitos ficam com o dado.
5. **O gitleaks e o GitGuardian no CI** existem para que isso não chegue à `main`.

### No banco (registro com dado que não deveria estar lá)

1. **Corrija o código** que gravou o dado, para parar o vazamento.
2. **Apague ou corrija o registro por uma migration revisada**, executada pelo operador.
   - O `audit_log` não aceita alteração nem exclusão, nem do dono do banco.
   - Num incidente, a migration desliga o trigger que protege o log, apaga ou mascara a linha e
     religa o trigger, tudo na mesma transação.
   - A própria migration fica registrada no repositório como prova do que foi feito.
3. **Backups:** o dado continua nos backups cifrados até eles expirarem, em até cerca de 35 dias
   (7 diários e 4 semanais). Se o dado for grave, apague também os backups afetados, no servidor
   e no destino externo, e faça um backup novo, limpo.
4. **Avalie** com a coordenação a comunicação aos titulares e à ANPD (LGPD, art. 48).
