# ClickCidade

Sistema online para receber FotoDenuncias de:

- Lixo
- Foco de dengue
- Terreno baldio

O projeto segue o mesmo modelo do ACE:

- GitHub Pages para as telas publicas.
- Google Apps Script para API.
- Google Sheets para armazenar denuncias.
- Google Drive para armazenar fotos.

## Estrutura

- `index.html`: tela simples do cidadao.
- `painel.html`: painel interno com login simples.
- `assets/`: CSS, JavaScript, logos e mapa territorial.
- `manifest.webmanifest` e `sw.js`: instalacao do formulario como aplicativo.
- `apps-script/Code.gs`: codigo para colar no Google Apps Script.
- `api.txt`: copia do `Code.gs`, no mesmo estilo do ACE.
- `ROTEIRO_CLICKCIDADE.txt`: roteiro e historico das alteracoes.
- `docs/INSTALACAO.txt`: passo a passo para publicar.

## Configuracao rapida

1. Crie ou abra a planilha `ClickCidade - Denuncias`.
2. Na propria planilha, abra `Extensoes > Apps Script`.
3. Cole o conteudo de `apps-script/Code.gs`.
4. Configure as Script Properties indicadas em `docs/INSTALACAO.txt`.
5. Publique como Web App.
6. Copie a URL do Web App para `assets/runtime-config.js`.
7. Suba a pasta no GitHub Pages.

Nunca coloque senha real dentro dos arquivos do GitHub.

## Recursos atuais

- Identificacao e telefone opcionais.
- Localizacao por GPS obrigatoria.
- Comprovante com protocolo para o cidadao.
- Mapa em ruas, relevo ou satelite.
- Fila de prioridade, prazos e tempo aberto.
- Foto de conclusao opcional.
- Relatorios por periodo, territorio e tipo.
- Tempo medio de resolucao, CSV e impressao/PDF.
