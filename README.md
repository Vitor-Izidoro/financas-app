# Finanças

App de controle financeiro pessoal (PWA), feito para celular e instalável pelo navegador. Funciona 100% offline, e os dados ficam apenas no aparelho (localStorage).

## Funcionalidades
- **Várias contas** (bancos/carteiras), cada uma com o próprio saldo, mais transferências entre elas
- **Fixos mensais**: salário, aluguel etc. aparecem sozinhos todo mês (marcar pago, pular mês, encerrar)
- **Compras parceladas**: o valor é distribuído pelos meses seguintes ("3/10")
- **Cartões de crédito** vinculados a uma conta: fechamento/vencimento, fatura agrupada, limite usado e parcelas no cartão separadas
- **Meses futuros**: veja o que já está comprometido nos próximos 12 meses
- **Categorias** personalizáveis, com cor e limite mensal opcional
- **Anotação** em cada lançamento
- **Gráficos** em SVG: renda comprometida, gasto × dinheiro disponível, sobra após fixos e parcelas, gasto ao longo do mês, evolução do saldo, categorias, orçamento, gastos por conta/cartão e projeção de 6 meses. O gráfico da tela inicial pode ser escolhido.
- **Backup** manual (download ou compartilhar) e backup automático opcional

## Tecnologia
HTML, CSS e JavaScript puros, sem dependências e sem build. Service worker para uso offline e manifest para instalação.

## Instalar no celular
Abra o link do GitHub Pages no Chrome → menu ⋮ → **Adicionar à tela inicial / Instalar app**.

## Publicar atualizações
Ao alterar arquivos, aumente `VERSAO` em `sw.js` para que os celulares baixem a nova versão.
