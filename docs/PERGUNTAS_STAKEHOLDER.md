# Perguntas para o stakeholder (reunião de kickoff)

## Respostas já registradas (2026-11-09)

| Tema | Resposta | Onde ficou registrado |
|---|---|---|
| Objetivo (#1) | Monitores e gestores identificam habilidades, criam tarefas, acompanham os feitos e dão badges | PLANEJAMENTO §0 |
| Quem desenvolve (#39) | Alunos de TI da Academia; o gestor do projeto é o sênior e revisor | PLANEJAMENTO §0 |
| Papéis e escopo (#5, #40) | Monitor → turma/equipe; gestor estadual → UF; gestor nacional → tudo | ADR 0002 |
| Proteção dos dados (#43) | Dados pessoais cifrados no banco; hash para unicidade | ADR 0003 |
| "Feitos" (#14) | Tarefas concluídas e validadas, não texto livre | MODELO_DADOS |
| Uso futuro | Outros usos como instâncias separadas do mesmo framework | ADR 0005 |
| Repositório | Público (permite proteger a `main` no plano gratuito) | — |
| O que é turma (#46) | Grupo com identidade (nome, bandeira, logo) que discute, propõe e realiza ações na sua região | ADR 0006 |
| Turma (#46, #57) | Turma = equipe. Grupo que se comunica, propõe e realiza. **Um aluno por turma**, mas pode ser movido | ADR 0006 §2 |
| WhatsApp (#6, #47) | Monitor vê ao clicar, com registro. **Colegas não veem**: o monitor cria o grupo de WhatsApp da turma; o oficial fica no portal | ADR 0002 |
| Nível entre estado e turma (#48) | Existe (região), mas é **opcional** | ADR 0005 |
| Mapa | Mapa de calor dos cadastrados por região | PLANEJAMENTO RF08 |
| Quem cria missões (#26, #49, #54) | Nacional ou monitor; a turma sugere. A missão mostra a origem: **Nacional** ou **Regional** | ADR 0006 §3 e §5 |
| Missão individual ou em equipe (#27, #49) | Os dois tipos | ADR 0006 §3 |
| Evidência (#28, #50) | Quem cria a missão define se exige evidência e de que tipo | ADR 0006 §3 |
| Badges (#32, #51) | Criados pela nacional ou pelo monitor | ADR 0006 §8 |
| Painéis (#52) | Feitos por turma, alunos sem feito há 30 dias, ranking de turmas; evolui com o uso | issue do painel |
| Pontos (#55) | Pontuação de turma **e** individual | ADR 0006 §4 |
| Placar (#33, #56) | Sim, para competição entre turmas | ADR 0006 §6 |
| Missões de saúde (#58) | O monitor decide como comprovar (sem upload de comprovante) | ADR 0006 §7 |
| Identidade (#59) | A turma cria logo, bandeira e redes sociais próprias; o nome é definido pelo monitor ou pela nacional [?] | ADR 0006 §2 |
| Licença (#61) | AGPL-3.0 | LICENSE |
| Orçamento (#36, #60) | **Custo zero.** Só planos gratuitos; qualquer custo exige aprovação explícita do gestor | ADR 0001, AGENTS R19 |
| Ações e gamificação (#25, #31) | Missões com etapas e pontos (ex.: lei escrita + bônus por protocolar), validadas, com badges | ADR 0006 |

## Respostas da reunião de kickoff (2026-11-09)

| Tema | Resposta | Onde ficou registrado |
|---|---|---|
| Uso depois da Academia | Ex-alunos formam **equipes** que apoiam porta-vozes em formação; a equipe é da organização e **roda** entre porta-vozes | ADR 0007 §1–2 |
| Uma pessoa em várias equipes? (#57) | **Não**: uma por vez, com rodízio por ciclos (3 a 5 meses [?]) e histórico preservado | ADR 0007 §2 |
| Quem cria medalhas (#51) | Nacional e coordenadores; **cada porta-voz tem a sua** ("trabalhou com"); medalhas de evento e de marco ("o primeiro a atingir dá o nome") | ADR 0007 §3 |
| Ranking | **Nenhum ranking que desestimule quem chega depois.** Medalha é registro de feito, não corrida | ADR 0007 §3 |
| Avaliação de desempenho | Sim, **reservada**: bronze/prata/ouro, invisível para a pessoa e para outros coordenadores; consulta só por pedido auditado [jurídico] | ADR 0007 §4 |
| Portfólio | Até 3 links com prévia (YouTube etc.); **a plataforma não guarda arquivos** | ADR 0007 §5 |
| Teste de personalidade | Fora do POC; triagem humana | ADR 0007 §6 |
| Dados do cadastro (#11–#13) | No máximo o celular; **município e bairro** escolhidos em lista; nada de CPF ou CEP | MODELO_DADOS |
| Base inicial | Cada pessoa se cadastra do zero; sem importar bases | ADR 0007 §6 |
| LGPD | Termo de consentimento validado pelo jurídico que já atende a equipe (o termo não tira a responsabilidade de proteger os dados) | issue do termo |
| Orçamento (#36, #60) | Meta continua **custo zero**; teto de **R$ 100/mês** aceito pelo stakeholder, só com ADR | ADR 0001 |
| Linguagem | TypeScript no front e no back; TDD; código que outra pessoa consiga manter depois | ADR 0001, AGENTS |
| Prazo | Alinhamento e arquitetura até o fim de novembro; plataforma pronta no **início de janeiro**; cadastro dos ex-alunos no **fim de janeiro**; atividades a partir de **março** | PLANEJAMENTO §0 |
| Canal | Os grupos de WhatsApp continuam; a plataforma direciona cada pessoa ao grupo certo | PLANEJAMENTO §0 |

### Perguntas que surgiram na reunião

62. **Ciclo de rodízio:** qual a duração padrão (3, 4 ou 5 meses)? Quem decide a troca?
63. **Porta-voz vê o WhatsApp da equipe?** Sugestão: não; o coordenador cria o grupo.
64. **Avaliação escondida da própria pessoa:** o jurídico aceita? (LGPD art. 18, II)
65. **Status na Academia:** guardar ano de turma e se concluiu? Sugestão: só o ano.
66. **Placar entre turmas** continua, dado o princípio "sem corrida"? Sugestão: placar só
    por período (mês), zerando, sem acumulado histórico.
67. **Quem é o primeiro público** do cadastro: só ex-alunos deste ano, ou também de anos
    anteriores?

## Respostas da reunião de 2026-11-17

| Tema | Resposta | Onde ficou registrado |
|---|---|---|
| Quem pode entrar (#26, #67) | Só quem está na **lista de autorizados** (e-mails dos ex-alunos); quem não está fica **em espera**. Sem integração com sistemas externos por enquanto | ADR 0008 §1 |
| Entrada | "Sabe o que quer fazer?" → escolhe atividades ou responde a um **questionário** → **casa** de formação → apresentação da casa → aceite → cadastro | ADR 0008 §2 |
| Casas | Quatro na instância piloto (porta-vozes, coordenação de equipe, intelectuais e produção); equipes misturam casas | ADR 0008 §2 |
| Hierarquia (substitui a do kickoff) | Nacional (prevista, não prioritária) → estadual → regional ("incubadora") → coordenador de casa e coordenador de equipe → membro | ADR 0008 §2 |
| Avaliação | **Dupla**: pelo coordenador da equipe e pelo da casa, ligada às missões. **Todos são avaliados**, inclusive porta-vozes e coordenadores. Continua interna | ADR 0008 §3 |
| Usabilidade | Simplicidade acima de aparência: botões grandes e evidentes; **nenhuma opção escondida** | PLANEJAMENTO §0 |
| Prazos | O time organiza as datas conforme a própria capacidade | ROADMAP |

### Perguntas que surgiram na reunião

68. ✅ *(gestor, 2026-11-19: o chat não entra em janeiro; fica para o M3)* **Conversa da equipe dentro da plataforma:** substitui o WhatsApp ou convive com ele?
    Exige moderação, guarda de mensagens e cuidado com LGPD. Sugestão: depois de janeiro.
69. **Prioridade de janeiro:** confirma cadastro + casa + habilidades + busca, com missões e
    avaliação em março?
70. **Formação das equipes por escolha** (o porta-voz escolhe o coordenador, que escolhe os
    membros numa ordem): a ordem pela avaliação cria um ranking interno. Quem o vê?
71. **Dados do perfil:** foto, formação e e-mail entram? A foto pode ser opcional? *(Hoje a
    foto de rosto está na lista de proibidos; mudar exige ADR.)*
72. **Casa de produção:** o que ela faz exatamente? A casa de coordenação é só de
    coordenadores de equipe?
73. **Questionário das casas:** a licença permite usá-lo na plataforma?
74. **Tamanho da equipe** (cerca de 12?) e **duração do ciclo** (4 meses?).

### Questionário das casas (chave nova de 2026-11-25, ADR 0014)

Chave recebida: 28 perguntas, quatro eixos (dois para a casa, dois para o totem) e
desempate só no eixo 1. As perguntas 75 a 78 da versão anterior (temperamentos) ficam
substituídas pelas abaixo.

75. ✅ *(chave de 2026-11-25)* **Chave de correção:** itens por eixo e a casa pela interseção dos
    eixos 1 e 2 estão no arquivo recebido. "As duas" conta para os dois polos.
76. ✅ *(stakeholder, itens 23 e 26 da chave; já na config privada)* **Itens de desempate do eixo 1:** respondida: o stakeholder indicou os itens 23 e 26,
    que ficam só na configuração privada.
77. [?] **Desempate dos eixos 2, 3 e 4:** há itens de desempate também nesses eixos? Sem regra,
    o empate deixa o resultado inconclusivo e abre um pedido de análise.
78. **Termo de consentimento:** podemos adaptá-lo assim?
    - **Resultado:** a pessoa vê só a casa. A plataforma guarda a casa sugerida e o totem (interno).
    - **Respostas:** vão ao servidor para o cálculo e só são guardadas se o resultado for
      inconclusivo, para a coordenação nacional analisar; são apagadas ao resolver ou em 30 dias.
      O texto atual não diz isso [?].
    - **Assinatura e e-mail:** dão lugar a um aceite na tela, registrado com data e versão.
    - **Desistência:** vira o botão "escolher outra casa".
79. **Licença:** quem detém os direitos das perguntas e da adaptação? Até a resposta, o texto
    fica fora do repositório público (pergunta 73).
80. **Colegas veem o perfil uns dos outros** (nome e habilidades)? Hoje não: só a própria pessoa
    e a coordenação do escopo veem o perfil (ADR 0002). *Recomendação:* manter assim no piloto,
    porque o contato já tem a regra própria (ADR 0010); abrir a visão entre colegas de equipe só
    se a coordenação sentir falta.
81. ✅ *(decisão do gestor, 2026-11-27)* **Quem vê o totem:** a própria pessoa (em "Baixar meus
    dados"), a coordenação nacional e o gestor de unidade (estadual, municipal) a quem a nacional
    **conceder**, para as pessoas ativas do escopo dele; a concessão é revogável e auditada.
    [?] Coordenadores de casa continuam sem ver. A delegação deve incluir **resolver** a fila?
    Hoje não (só a nacional).
82. [?] **Prazo para trocar de casa:** a pessoa pode escolher outra casa depois de aceitar? Depois
    de quanto tempo? Hoje, depois de aceitar, só a coordenação troca.
83. [?] **Quem resolve a fila de análise** (resultado inconclusivo): só a coordenação nacional?
    Em quanto tempo? E o que fazer com quem não quer esperar (hoje pode escolher a casa direto)?
84. [?] **Ids reais das casas:** a ligação das casas 1 a 4 aos polos usa os ids de `config/instance.ts`;
    falta a config real da instância para fechar o mapa do arquivo privado.

## Núcleos (decisão do gestor de 2026-11-24, aceita em 2026-11-27, ADR 0013)

O núcleo é um agrupamento de debate e de tarefas públicas, fora da árvore de território, com
pessoas de regiões diferentes, em árvore (núcleo e subnúcleos) e com cargos internos. A
**sugestão padrão** das perguntas em aberto vale até a resposta.

85. ✅ *(gestor, 2026-11-24)* **Um ou vários núcleos por pessoa?** Vários, com exatamente um
    principal.
86. ✅ *(gestor, 2026-11-24)* **Entrada:** a pessoa pede e o coordenador aprova ou recusa.
87. ✅ *(gestor, 2026-11-24)* **Diretório de núcleos** visível aos membros? Por enquanto não.
88. ✅ *(gestor, 2026-11-24)* **Relação com as casas:** independentes, sem vínculo.
89. ✅ *(gestor, 2026-11-24)* **Reuniões, pauta e presença** entram na plataforma.
90. ✅ *(gestor, 2026-11-24)* **A presença conta pontos**, além da medalha de presença.
91. **Quem cria núcleos de topo e designa o primeiro coordenador?** *Padrão: o gestor da raiz.*
92. **Para pedir um subnúcleo, é preciso ser membro do núcleo pai?** *Padrão: não.*
93. **Núcleos entram em algum placar** (de núcleos ou de turmas)? *Padrão: não.*

## Novas perguntas (após as definições)

46. ⛔ **O que é uma turma?** Tem monitor fixo, datas de início e fim? Um aluno pode estar em
    mais de uma turma? Uma equipe pertence sempre a uma turma, ou pode misturar turmas?
47. ⛔ **O monitor vê o WhatsApp dos alunos do seu escopo?** Sugestão: sim, ao clicar em
    "ver contato", com registro. **E os colegas de equipe se veem?**
48. **Existe nível entre o estado e a turma** (região metropolitana, município)? Se houver,
    é bom saber agora.
49. **Quem cria tarefas para quem?** O nacional cria para todos e o monitor para a sua turma?
    A tarefa é individual, da equipe inteira, ou ambos?
50. **A validação de um feito exige evidência** (um link)? Quem valida: o monitor da turma?
51. **Badges:** só o nacional cria badges, ou o estadual também? Monitor concede badge manual?
52. **Acompanhamento:** que painel cada nível quer ver? (Ex.: feitos por turma, alunos sem
    tarefa há 30 dias, ranking de equipes.)
54. ⛔ **Quem cria missões?** Só o nacional, ou também o estadual e o monitor? Quem publica
    as propostas das turmas?
55. ⛔ **Pontos:** só a turma pontua, ou cada participante também (para badges
    individuais)? Há tabela de pontos de referência (ex.: protocolar = 30)?
56. **Placar:** entre turmas de que recorte (cidade, estado, nacional)? Por mês, semestre ou
    acumulado? Há prêmio fora da plataforma?
57. **Uma pessoa pode estar em mais de uma turma?** E uma turma pode ter subequipes?
58. **Doação de sangue e missões de saúde:** basta autodeclaração validada pelo monitor?
    *Guardar comprovante é dado de saúde (sensível); a sugestão é não guardar.*
59. **Logo e bandeira:** cores + emblema de um catálogo bastam no piloto, ou o upload de
    imagem é essencial desde o início?
60. ~~**Orçamento:**~~ *Respondida: custo zero.* o protótipo original (Vguedess/Complexo42) menciona um limite de **R$ 100/mês**. O stakeholder definiu
    isso, ou o piloto é custo zero?
61. **Licença do código:** o repositório é público e ainda não tem licença. Sugestão:
    AGPL-3.0 (quem reusar e oferecer como serviço publica as mudanças) ou MIT (uso livre).
53. *(removida)*

As perguntas estão em ordem de prioridade. As marcadas com ⛔ **bloqueiam o desenvolvimento**:
sem resposta, o M1 não começa. Ao lado de cada uma está a **sugestão padrão**, que vale caso
ele não tenha preferência.

---

## A. Objetivo e sucesso

1. ⛔ **Qual problema dói mais hoje?** Não saber quem são os alunos, não saber onde estão,
   não conseguir montar times, ou não conseguir acompanhar o que os times fazem?
   *Define a ordem dos milestones.*
2. **Como saberemos que o piloto deu certo?** Sugestões: X% dos alunos cadastrados em 30 dias;
   N incubadoras formadas; N ações concluídas por mês.
3. **Qual a data-alvo** para o cadastro estar no ar? Há um evento ou turma associada?
4. **Quantos alunos existem hoje** na Academia e quantos estão na Região Metropolitana?
   (Dimensiona o piloto entre 50 e 2.000.)

## B. Quem usa e quem vê o quê (permissões)

5. ⛔ **Quais papéis existem?** Sugestão: *aluno*, *líder de equipe*, *coordenador regional*,
   *administrador*. Há mais algum, como mentor ou professor?
6. ⛔ **Quem pode ver o WhatsApp de um aluno?** Sugestão: só coordenadores e os membros da
   mesma equipe. **Nunca** público entre todos os alunos, porque é o dado mais visado num
   vazamento.
7. **Um aluno pode ver o perfil de outros alunos** (habilidades, cidade)? Ou só os coordenadores
   veem a base completa?
8. **O cadastro é aberto ou por convite?** Sugestão: por **link de convite** distribuído nos
   grupos da Academia, para evitar cadastros falsos e robôs.
9. **Quem aprova um cadastro?** Automático ou um coordenador confirma que a pessoa é aluna?
10. **Existe hoje uma lista de alunos** (planilha, formulário) para importar? Em que formato?

## C. Dados do cadastro (LGPD)

11. ⛔ **Login:** como o aluno entra na plataforma? Cada opção tem um custo:
    - **Conta Google:** grátis e simples, mas recebemos o e-mail (fica guardado só para login).
    - **Link mágico por e-mail:** grátis até um limite mensal, mas também guarda e-mail.
    - **Código por WhatsApp/SMS:** não guarda e-mail, mas **é pago** (cerca de US$ 0,05 a
      US$ 0,08 por mensagem; ~US$ 100 a US$ 160 para 2.000 pessoas).
    Sugestão: **Google + link mágico**, guardando o e-mail só na tabela de autenticação, nunca
    no perfil e nunca exibido.
12. **"Habilidades":** lista fechada (escolher de um catálogo) ou texto livre? Sugestão:
    **catálogo** com categorias (comunicação, design, programação, jurídico, eventos,
    captação…) mais um campo "outra". O catálogo é o que torna possível filtrar e montar times.
    Quem define a lista inicial?
13. **Nível de habilidade** importa (básico/intermediário/avançado) ou basta ter ou não ter?
14. **"Feitos":** o que significa exatamente? Conquistas fora da plataforma (cargo, projeto,
    mobilização) contadas pelo próprio aluno em texto livre? Ou só o que ele fez dentro da
    plataforma (que já viraria medalha)?
15. **Redes sociais:** quais? (Instagram, X, LinkedIn, TikTok, YouTube.) Quantos links no
    máximo? Elas ficam visíveis para quem?
16. **Localização:** município + bairro está bom? Para a capital, sugestão: **subprefeitura ou
    distrito** (lista fechada de 96 distritos) em vez de bairro livre. Evita a "maçaroca" de
    grafias diferentes e permite agrupar. Na Grande SP, município basta?
17. **Idade mínima:** podem existir alunos **menores de 18 anos**? Se sim, a LGPD (art. 14)
    exige consentimento dos pais. Sugestão: **só maiores de 18** no piloto, com uma caixa de
    declaração.
18. **Quem é o "controlador" dos dados** perante a LGPD? A Academia, a entidade por trás dela
    ou uma pessoa física? Quem será o contato (encarregado) para pedidos de exclusão?
19. **Qual texto de consentimento** o jurídico aprova? Podemos propor um rascunho.

> Observação para a reunião: nome + WhatsApp **já são dados pessoais** pela LGPD. Coletar
> pouco reduz o risco, mas não elimina a responsabilidade. Por isso o plano inclui termo de
> consentimento, exclusão de conta pelo próprio aluno e retenção limitada.
> Ponto sensível: num movimento político, **a própria lista de membros pode ser lida como
> opinião política** (dado sensível, LGPD art. 5º, II). Vale validar com o jurídico.

## D. Equipes (incubadoras)

20. ⛔ **Como as equipes são formadas?** Pelo coordenador (manual), com sugestão automática
    (por região e habilidades complementares), ou por inscrição do próprio aluno?
21. **Tamanho típico** de uma equipe? Um aluno pode estar em **mais de uma** equipe?
22. **Equipe tem líder?** O líder pode criar ações ou só o coordenador?
23. **Equipes são por região** (bairro/município) ou podem misturar regiões?
24. **O que é uma "incubadora"** além de um time? Tem duração, objetivo e encerramento?

## E. Ações (o "Trello")

25. ⛔ **Construir ou usar uma ferramenta pronta?** Trello, Notion e GitHub Projects são
    gratuitos e já existem. Construir só faz sentido porque **a medalha depende da ação
    concluída**. Sugestão: construir um quadro **simples** (A fazer / Fazendo / Feito), sem
    tentar replicar o Trello.
26. **Quem cria as ações?** Coordenação central (a mesma ação para todas as equipes, como uma
    mobilização), o líder da equipe, ou ambos?
27. **Uma ação é da equipe toda ou de pessoas específicas?**
28. **Como se comprova que uma ação foi feita?** Basta marcar, ou precisa de evidência (link,
    foto) e aprovação de líder ou coordenador? *Atenção: fotos aumentam custo de
    armazenamento e risco de dados pessoais de terceiros.*
29. **Precisa de prazo, comentários ou anexos?** (Cada item aumenta o escopo.)
30. **Notificações:** o aluno precisa ser avisado de ação nova? Por onde? (Notificação por
    WhatsApp é paga; e-mail e aviso dentro da plataforma são grátis.)

## F. Medalhas

31. ⛔ **Quais as regras das medalhas?** Exemplos: "1ª ação concluída", "10 ações", "ação de
    mobilização X", "membro fundador de incubadora". Medalha por ação individual, por conjunto de
    ações, ou ambas?
32. **Medalhas são automáticas** (o sistema concede ao cumprir a regra) **ou concedidas
    manualmente** por coordenador?
33. **Há ranking ou placar** entre alunos ou equipes? (Gamificação aumenta engajamento, mas
    também a tentação de fraudar.)
34. **As medalhas aparecem publicamente** (perfil compartilhável, imagem para redes sociais)?
35. Quem desenha as medalhas (arte/ícones)?

## G. Operação, custo e expansão

36. **"Gratuito" significa custo zero absoluto?** Ou aceita-se um custo pequeno (domínio
    ~R$ 40/ano; um plano pago de banco ~US$ 25/mês se o piloto crescer)?
37. **Há domínio próprio?** (ex.: `academia.algumacoisa.org`)
38. **Quem será o administrador técnico** responsável pelas chaves de produção? Sugestão: no
    máximo 2 pessoas.
39. **Quantos voluntários desenvolvedores** temos, com quanta disponibilidade por semana?
40. **Para a expansão (SP/Brasil):** haverá coordenadores regionais com acesso limitado à sua
    região? *Isso muda o modelo de permissões desde o início.*
41. **Celular ou computador?** Sugestão: **mobile-first**, pois a maioria acessará pelo celular
    vindo de um link no WhatsApp.
42. **Identidade visual:** existe manual de marca, logo e cores?

## H. Segurança

43. **"Sem risco de invasão"** não existe em nenhum sistema. O compromisso realista é:
    (a) guardar o mínimo, (b) proteger bem o que for guardado, (c) ter plano para um
    incidente. Ele concorda com essa formulação?
44. **Exportação de dados:** coordenadores podem baixar planilha com WhatsApp? *Cada planilha
    baixada é um vazamento em potencial fora do nosso controle.* Sugestão: exportar sem
    WhatsApp, ou só para administradores, com registro de quem exportou.
45. **Por quanto tempo guardar** dados de quem sai da Academia? Sugestão: excluir 30 dias após
    o pedido ou 12 meses de inatividade.
