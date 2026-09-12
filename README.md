# Controle de Pintura

PWA (Progressive Web App) de controle de produção de pintura: programação de peças, logística de liberação, acompanhamento de pintura, histórico de finalizadas, cadastro de insumos e registro de retornos.

Aplicação 100% cliente — **sem backend e sem dependências**. Os dados ficam no `localStorage` do navegador. Pode ser servida de qualquer hospedagem estática (GitHub Pages, Vercel, Netlify, servidor próprio, etc.).

## Funcionalidades

- **Dashboard** — resultado do dia, metas, pintadas/recebidas/finalizadas, top peças, top cores, comparativo dos últimos 7 dias, tendência e diagnóstico da operação.
- **Programação** — cadastro e pré-cadastro de peças com PN, nome, cor, meta, data de entrada, observações e saldo extra.
- **Logística** — liberação de peças com botões +/− e barra de progresso. As liberadas caem automaticamente para a Pintura.
- **Pintura** — confirmação de entrega e registro de peças pintadas com +/−, indicação de atraso e botão para concluir a peça.
- **Histórico** — peças finalizadas por dia/semana/mês, agrupadas por PN.
- **Insumos** — consumo contabilizado por semana (segunda a domingo).
- **Retorno** — peças que voltaram à pintura (não contam como produção).
- **Exportação WhatsApp** — envio de relatórios formatados (logística, pintura, histórico e insumos) via WhatsApp.
- **PWA** — instalável, funcionamento offline via service worker.

## Fluxo de status

```
Programação → Logística → Pintura → Finalizadas (Entregue)
```

| Status | Descrição |
|--------|-----------|
| Programação | Peça cadastrada, aguardando liberação na logística |
| Logística | Liberada, aguardando confirmação da entrega |
| Pintura | Recebida, aguardando/em pintura |
| Finalizadas | Pintada e concluída/entregue |

Quando a programação é registrada sem meta fixa (meta = `0`, programação "livre"), a peça entra direto na Pintura como recebimento confirmado, sem depender da logística.

## Saldo extra

Peças com "Saldo Extra" ativado podem receber liberações/pinturas além da meta. O excedente fica **salvo por PN** e pode ser compensado (descontado da meta) em lançamentos futuros da mesma peça.

## Estrutura do projeto

```
index.html             Aplicação SPA (todas as telas)
css/style.css          Estilos (tema escuro, responsivo)
js/app.js              Lógica do app (estado, CRUD, dashboard, exportações)
sw.js                  Service worker (cache offline)
manifest.webmanifest   Manifesto PWA (instalação)
icon-192.png           Ícone 192px
icon-512.png           Ícone 512px
icon-maskable-512.png  Ícone maskable 512px
```

## Persistência (localStorage)

Os dados são armazenados localmente no navegador:

| Chave | Conteúdo |
|-------|----------|
| `controle_pintura_pecas` | Peças em produção e histórico |
| `controle_pintura_insumos` | Lançamentos de insumos |
| `controle_pintura_retornos` | Retornos de peças |

> Como os dados ficam no navegador, apagar o cache/dados do site remove os registros. Para uso compartilhado entre vários dispositivos, é necessário trocar a camada de persistência por um servidor.

### Modelo da peça

```
{
  id, partNumber, partName, cor,
  meta, dataEntrada, obs, extra, pre,
  liberadas, recebidas, pintadas,
  compensado, status,
  history: [{ status, data }]
}
```

- `meta`: programação do dia (0 = programação livre)
- `extra`: permite excedente além da meta (vira saldo extra salvo)
- `pre`: pré-cadastro (somente PN e nome vinculado)
- `compensado`: saldo extra aplicado no lançamento
- `status`: etapa atual (`0` a `3`)
- `history`: histórico das mudanças de etapa (usado para data de finalização)

## Executar localmente

Basta servir a pasta raiz com qualquer servidor estático:

```bash
python3 -m http.server 8080
```

Acesse `http://localhost:8080`.

## Deploy no GitHub Pages

1. Crie um repositório e envie o projeto:

   ```bash
   git init -b main
   git add -A
   git commit -m "Controle de Pintura"
   git remote add origin https://github.com/USUARIO/controle-pintura.git
   git push -u origin main
   ```

2. Ative o GitHub Pages em **Settings → Pages**:

   - Source: `Deploy from a branch`
   - Branch: `main`, pasta `/ (root)`

3. O site ficará disponível em `https://USUARIO.github.io/controle-pintura/`.

Depois de atualizar o service worker (`sw.js`), aumente a versão da constante `CACHE` para forçar a atualização do cache nos dispositivos instalados.

## Tecnologias

- HTML / CSS / JavaScript (vanilla, sem build e sem bibliotecas)
- Service Worker API para PWA offline

## Repositório

Projeto publicado em: https://github.com/andrejoaolopes1979-svg/controle-pintura