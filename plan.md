Algumas regras:


* Drag files here...
Sequência
123
Postar sua resposta
GB
226
101
Select file
хо
Responder
Upload from clipboard
XOV
Recent uploads
XY
About Rabbithole...
Check for updates
Settings
x/
Quit
xQ
Diego Fernandes @diegosf-8 de jan
No CSS
Não permita seleção de textos (user-select: none);
2 Retire estados de foco (outline: none):
3 font-size 14px;
4 border-radius de 7px;
5 font-family (ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont); 6 Não use "cursor: pointer" em botões e links;
01
12
♡ 36
2 mil
口
Diego Fernandes @diegosf-8 de jan
No Tauri
Utilize o plugin github.com/tauri-apps/win... como abaixo para criar o "glass effect" da janela, gerando a transparência e blur do conteúdo abaixo:
2 Utilize o plugin github.com/tauri-apps/tau... para posicionar a janela corretamente no tray menu.
(cretarget es "nacos")]
apply.vibrancy
effect:
VisualErrectatoriale,
state: Some(VisualEffectState: Active),
radius: Some(6.0)
).expect(sg:"supported platfors! 'apply vibrancy is only supported on cs");


Video1:

Summary of the Video Content on Tau-Based Desktop App Development
The video presents a detailed walkthrough of a desktop application project built using Tau, an emerging framework positioned as an alternative to Electron. Tau leverages Rust for backend/native features and standard web technologies like HTML, JavaScript, and React for the frontend interface. The project focuses on desktop platforms—Windows, Mac, and Linux—with mobile support planned but not yet available.

Project Overview: Upload Widget (“Rabbit Hole”)
Purpose: A lightweight desktop upload widget designed to quickly upload files and generate shareable links.
Key Feature: Uploaded files auto-delete after a set period (default suggested: 7 days), providing a simple, ephemeral file-sharing experience.
Use Case: Quickly share files (e.g., videos) with team members without relying on websites, aiming for simplicity and speed similar to services like e-transfer.
Application Type: Runs as a system tray app (tray application), appearing as an icon in the system’s notification area (Windows: near the clock).
User Interaction: Drag and drop files, select files via a file picker, or paste files from the clipboard.
Technical Architecture and Implementation
Frontend
Built with React and uses libraries like react-dropzone for drag-and-drop file handling and react-hotkeys-hook for keyboard shortcuts.
UI designed to resemble native MacOS applications using CSS tricks shared on the developer’s Twitter, including:
Text is not selectable inside the app.
Standard font size (14px) and border radius (7px).
Cursor styles set to default (not pointer) for buttons.
The app window does not close when clicking outside to enable drag-and-drop functionality.
Features a progress bar displayed on the tray icon, indicating upload progress even if the app window is closed.
Backend (Rust)
The Rust code handles the system tray interactions and native OS features.
The app launches as a tray application, not a fullscreen or persistent window app.
Uses Tau’s System Tray API to create and manage tray icons and menus.
Icon behavior adapts to system themes (dark/light) using a “template” icon approach.
Window configuration is highly customizable via tcf.json:
Defines window properties like size, resizability, visibility on startup, always-on-top behavior.
Enables MacOS-style glass blur effect (vibrancy) using the community plugin window-vibrancy.
Uses the Tau plugin positioner to position the main window relative to the tray icon (e.g., centered on the tray icon).
Event-driven communication between frontend and backend using Tau’s emit (frontend sends events) and listen (backend receives events).
Progress updates are sent as JSON payloads from frontend to backend, parsed in Rust via typed structs.
The upload progress bar updates by switching tray icon images based on progress percentages (10%, 20%, … 100%).
Key Highlights and Insights
Tau offers a compelling alternative to Electron, with simpler native integration using Rust and REST calls.
The project demonstrates the use of system tray applications for lightweight, always-accessible utilities.
Achieving native MacOS UI fidelity with web technologies is possible by adhering to strict CSS rules and leveraging Tau’s native windowing capabilities.
The glass blur (vibrancy) effect is straightforward with Tau and a plugin, contrasting with Electron’s complexity.
Event-based communication between frontend (React) and backend (Rust) is a core architectural pattern in Tau apps.
Using tray icons to display upload progress is an innovative UX approach for background apps.
The app avoids closing on outside clicks to maintain drag-and-drop usability, showing thoughtful UX design.
Timeline Table: Development Stages Covered
Time	Activity/Topic
00:00 - 01:00	Introduction to Tau and project concept
01:00 - 02:00	Project goals and intended functionality
02:00 - 03:50	Running the app, tray icon, drag-and-drop UI demo
03:50 - 05:50	Frontend React components and hotkey usage
05:50 - 07:40	Rust backend system tray setup and window config
07:40 - 09:50	MacOS vibrancy effect and window positioning
09:50 - 11:00	Frontend-backend communication via events and JSON
Definitions / Concepts Table
Term	Definition / Description
Tau	Framework for building cross-platform desktop (and future mobile) apps using Rust and web technologies.
System Tray App	A small app that runs in the OS notification area, accessible via an icon near the system clock.
Vibrancy	MacOS native window effect that creates a translucent blur background for app windows.
Emit / Listen	Event-based communication methods in Tau to send (emit) and receive (listen) messages between frontend and backend.
React-dropzone	React library to handle drag-and-drop file uploads.
React-hotkeys-hook	Library to add keyboard shortcut support in React apps.
Conclusion
This video showcases the development process of a MacOS-focused lightweight desktop upload widget using Tau, blending web UI with native Rust backend features. It highlights Tau’s strengths in creating native-like desktop apps with advanced UI effects and seamless event-driven communication. The project underscores the potential of Tau as a modern, efficient alternative to Electron, especially for tray applications requiring native OS integration and smooth UX.

Mobile support, backend upload storage details, and full production-ready features are not specified in this video.

00:00
Quero mostrar para vocês um projetinho que eu tô fazendo essa eh semana que é feito com taur tau não sei se todo mundo conhece o tau ele é uma alternativa ao electron ah feita com rest então ele é basicamente uma tecnologia que permite que a gente desenvolva aplicações multiplataforma eh hoje focado em apps desktop Windows Mac e Linux principalmente mas logo ele vai ter para mobile também por enquanto Vou me abster de falar sobre mobile mas paraa desktop eu já já era um tempo que eu queria testar ele e comecei a desenvolver meu primeiro aplicativo e a ideia é que ele funcione como um misto na verdade você CONSEG você usa tecnologias web para construir a interface HTML JavaScript react para construir a interface da aplicação porém a comunicação com features nativas do sistema ela é feita via rest então então Quero mostrar um pouquinho para vocês como é que tá ficando esse projeto Ah ele chama upload widget

01:06
Qual que é a ideia desse projeto né Desse widget ele eu sinto muita falta às vezes de ter um um appzinho onde eu possa fazer upload de arquivos rápidos para enviar esse arquivo para alguém o link desse arquivo porque às vezes eu gravo um vídeo aqui quero enviar para alguém do time e tal eu quero só ter um link mesmo que esse arquivo Se auto apague Depois de alguns dias e é a ideia desse aplicativo criar um widget Zinho Onde eu posso fazer arrastar o arquivo ele faz upload do arquivo para algum lugar que a gente ainda vai conversar sobre qual que é esse lugar e depois sei lá de sete dias o arquivo se apaga e acabou tudo bem é um link rápido assim como é o e-transfer lá né só que de uma maneira mais simples por isso eu criei um app desktop para não ser um site E aí vou mostrar basicamente o que que eu fiz até agora o quanto que eu toquei em Rust o quanto que envolveu de código Rust o quanto que envolveu de código frontend tá E aí

02:00
eu vou basicamente primeiro começar rodando o projeto para vocês verem então é ah eu tô usando Ban aqui para gerenciamento de dependências Mas você pode usar o que você quiser Ah então vou usar o bun Run Tower Dev ele vai levantar o meu servidor frontend que é o react que eu tô usando react aqui pro front Change da aplicação e vai levantar a aplicação Rust né então aqui ele tá pegando o cargo lá que é o package Manager do Rust vendo se eu tenho alguma dependência nova senão pronto minha aplicação já tá rodando só que que essa aqui é uma aplicação que a gente chama de Tray né a aplicação que ela roda no menu aqui que no Windows fica do lado do relógio né e tudo mais que é esse menuzinho aqui em cima então a aplicação é esse coelho aqui ó porque eu dei o nome da aplicação de ah Rabbit hole bura de coelho Então essa aqui é a aplicação então basicamente vai permitir que o usuário arraste um arquivo aqui para dentro ou selecione

02:56
um arquivo do computador cole um arquivo que já tá na clip dele e e acesse os uploads mais recentes dele e aqui tem algumas coisas que eu só coloquei para encher linguiça até como o Vitor falou o estilo dessa janela tá bem nativo Porque eu tive que seguir algumas regras que eu inclusive compartilhei no meu Twitter para que uma aplicação web se pareça o mais possível com uma aplicação é Mac OS Nativa E aí se vocês forem lá no meu Twitter ó compartilhe algumas dicas por tem várias dicas CSS que você que vale a pena você seguir por exemplo aplicações nativas o usuário não pode selecionar texto Então vocês vem que eu venho aqui ó arrasta o mouse eu não consigo selecionar o texto que tá ali dentro outra coisa não tem estado de foco o Font size 14 pixels padrão paraa Mac border Radio 7 pixels Font fine é não usar cursor Pointer então vocês vão ver que os botões aqui ó é tudo cursor default né então não teve clicar fora da

03:52
janela não deveria fechar ela então para essa aplicação eu penso que não porque se ela é uma aplicação de Drag and Drop eu vou ter que clicar fora para arrastar um arquivo se eu clicar fora para arrastar um arquivo ela fechar eu não consigo arrastar o arquivo então eu mantive assim mas o código para fechar ela com o clique fora tá comentado né porque eu tentei eu fiz e daí depois eu pensei cara não não faz muito sentido então basicamente isso aqui é aplicação é uma aplicação react como vocês bem podde ver aqui eu tenho um app tsx esse App é essa aplicação aqui então vocês vão ver que ela tem uma div aqui começa com uma div que é a parte de drag ó essa div aqui é o drag eu tô usando o react drop Zone que é uma uma Lib para lidar com Drag and Drop E aí já tá semi puncion a parte visual né então arrasta o arquivo aqui ó ele já dá um Highlight ali ó e daí ele mostra o nome da Imagem e eu fiz uma barrinha de progresso lá no ícone lá em cima

04:50
não sei se vocês conseguem ver mas quando eu arrasto Um item aqui ó ele gera um progresso lá em cima o iconz um progressinho porque assim se eu arrasto o item e fecho o menu ó o eu consigo mesmo assim ver o progresso de upload lá em cima pelo ícone e aqui a aplicação react como qualquer outra criei alguns componentes aqui por exemplo cada menu desses aqui eu criei um menu item porque aqui dentro Eu usei uma biblioteca chamada react Hot Keys Hook essa biblioteca aqui ela permite que eu dispare algum evento com alguma Hot Key então aqui por exemplo se eu Abre o menu e aperto control e Command O que é essa Hot Key aqui ó ele abre o file picker para eu ionar alguma algum arquivo para fazer upload e sim é ela vai servir para múltiplos arquivos né então se eu seleciono dois ó ele mostra ele também e aqui tem a Progress bar separator alguns componentes E aí tem a parte do Rust a parte do Rust como é que ela funciona esse aqui é

05:48
meu arquivo Rust o único arquivo que eu tenho por enquanto deixei tudo num arquivo só para ser mais fácil e aqui eu precisei customizar algumas coisas né parte desse código já vem pronto mas eu precisei customizar algumas coisas primeiro a aplicação que vem por padrão do Tau é a aplicação em janela assim como o vest code da vida não é uma aplicação Tray então eu tive que importar esse System Tray de dentro do T além de outras importações aqui do System Tray para criar o meu menu então aqui vocês vão ver que quando eu inicio a minha aplicação aqui eu tô iniciando a aplicação isso aqui vem junto já com o tau Eu uso esse System Tray e dou um System Tray New com o title Rabbit hole né então se eu passo o mouse por cima ele mostra Rabbit hole mas isso aqui é o que faz a minha aplicação são aparecer aqui em cima e aí o ícone da aplicação ele tá configurado aqui dentro desse tcf Jason aqui dentro Eu tenho o System Tray e eu passo

06:40
qual que é o ícone se o Icone ele deve se comportar como um template que que isso quer dizer template quer dizer ele vai deixar o icon Branco quando eu tiver no tema Dark ou vai deixar o tema e o icon preto quando eu tiver no tema Light E aí aqui dentro tem algumas coisas que são importantes a primeira aqui no tcf Jason eu consigo customizar as janelas as janelas quer dizer todas as janelas que a minha aplicação Pode abrir e eu só tenho uma janela que é essa aqui ó quando eu clico abre essa aqui é a minha janela principal o nome dela eu botei como menu bar eu defino se ela é Full Screen se ela é redimensionável a largura a altura se ela é visível por padrão então false né porque a aplicação inicia com ela é fechada se eu quero esconder o título se ela tem que ficar sempre à frente de outras janelas isso aqui é legal porque eu abro ela pode ver mesmo que eu clico no vest code ela se mantém na frente isso por causa desse Always

07:38
On Top como sendo true se ela é fechá se ela é minimiz se ela tem decorations né do Mac com as bordinhas e tal é se quando ela abrir tem que dar o Focus automático se ela deve ser transparente e aqui sim porque eu fiz para que a janela siga aquele padrão e de glass effect do do do Mac né então se tem alguma coisa passando atrás dela Olha ali ó ela dá esse efeito de Blur isso aqui é muito característico do Mac e aí como é que eu fiz né Essa questão do efeito de de Blur primeiro transparent como true isso aqui é a parte mais importante para que a janela seja transparente e aí lá na configuração do Tau Eu usei um plugin chamado Window vibrancy que é criado pela comunidade do Tau e ele tem uma função chamada apply vibrancy como esse widget eu tô criando somente para Mac eu uso somente essa função aqui porque eu vi vibrancy é o do Mac mas tem funções também para Windows e aqui eu faço o seguinte uma config se o sistema operacional

08:36
for Mac OS eu aplico essa função e aí essa função sozinha já faz na janela esse efeito de glass de quando eu passo uma coisa por trás dele ali ó ele fazer esse Blur igual as janelas do Mac Então cara eu achei muito massa do T isso no electron lembro que eu tentei fazer isso eu Nossa eu me ferrei bastante para conseguir chegar nesse resultado e outra coisa que eu tive que fazer é instalar essa extensão chamada T plugin positioner essa extensão permite eu posicionar a janela em locais comuns do sistema então aqui ó o que que eu faço aqui em cima quando eu dou um left click no meu Tray então aqui ó on System Tray event essa função dispara toda vez que houver um evento clique ou qualquer coisa no Tray que é o meu menu eu vou disparar se for um left Click vou mover a janela para o Tray Center que é bem no centro do meu botão tá vendo e aqui eu tenho outras opções como por exemplo Tray right E aí se eu salvo isso aqui agora o t vai reiniciar

09:42
e veja que quando eu clicar agora no meu iconeinstagram basicamente isso o o Rust é só isso aí como que a gente faz para comunicar o front end com o código Rust que é o que tem acesso digamos as funcionalidades nativas né lá no front end Isso é o que eu tô fazendo agora e vou fazer aqui em live nas próximas lives mas aqui dentro eu posso importar no front end tau apps barapi bar event E aí eu tenho emit para emitir um evento e tenho aqui no front ch também o Listen para eu ouvir um evento emitir e ouvir emitir e ouvir aqui no frontend eu quero por enquanto só emitir um evento aqui por exemplo eu emito um evento chamado Progress e posso enviar um Jason para dentro desse evento lá no rest eu faço um Listen Global o nome do evento Progress e lá dentro do payload é onde vai est os dados que eu tô enviando aqui que nesse caso é o progresso nesse caso aqui eu tô só utilizando o a biblioteca de Jason do Rust para converter uma string

10:56
em Jason né em dados e tô chpando Rust ele é uma uma linguagem tipada né então eu crio uma struct aqui em cima falando que o payload que é o conteúdo que eu tô enviando pro evento de progresso ele tem uma variável Progress que é um integer ah 32 então é basicamente isso E aí com Com base no Progress é que eu faço um Switch Case cada cada Progresso 10 20 30 40 50 80 100 eu vou trocando a imagem do ícone Essa foi a única forma que eu encontrei então é essa troca nessa exibição de progresso aqui em cima é basicamente uma troca de imagem eh repetidas vez


Video2:

Summary
The video documents the development process of a desktop file upload application built using Tauri, a Rust-based alternative to Electron. The developer focuses on finalizing the project, which enables users to drag and drop files into a system tray app and receive a shareable URL for the uploaded files. The backend is designed with a REST API structure to handle file uploads and downloads, while the frontend manages file selection, upload progress, and clipboard integration.

Key Features and Workflow
Technology stack:

Desktop app using Tauri (Rust-based framework).
Backend implemented with Node.js/TypeScript using Prisma ORM.
Axios library for HTTP requests on the frontend.
Docker Compose for managing backend services like Postgres.
Core app functionality:

Runs in the system tray (next to the clock).
User drags a single file into the app.
Uploads the file to the backend.
Receives a signed URL for file sharing.
URL can be copied to clipboard automatically.
Backend supports file upload and download routes.
Download route implements a redirect to a signed URL for file access.
Backend development highlights:

Initial backend was public; plans to implement authentication from scratch.
Backend split into multiple route handlers for clarity (upload, download).
CORS configured to allow frontend access.
Uses Prisma for database interactions to store file metadata.
Docker Compose used to start Postgres and backend server easily.
Frontend development highlights:

File input restricted to single file upload initially.
Axios POST request sends file metadata to backend to receive upload URL and file ID.
Actual file upload performed to signed URL.
Upload progress tracked and displayed via a progress bar.
Clipboard API integration to copy download URL automatically.
Progress updates also reflected in the tray icon.
Plans for global hotkeys to upload files directly from clipboard without opening the app.
Notification support added using Tauri’s notification API, with permission requests on app start.
Technical Challenges and Solutions
Challenge	Solution/Approach	Status
File upload progress tracking	Used Axios’ onUploadProgress event, mapped 0-1 to 0-100%	Implemented successfully
Clipboard access and permissions	Requested permissions on app start; used clipboard API	Partially implemented; some permissions issues remain
Notifications on MacOS	Used Tauri’s notification API; added permission request	Basic notification working; timing behavior noted
Authentication strategy	Planning to implement simple auth (not email/password)	Not specified
Backend API structure	Split routes by functionality; created upload and download endpoints	Completed
Handling multiple file uploads	Initially restricted to single file for simplicity	Implemented (single only for now)
Reflecting upload progress in tray	Emit events with progress percentage to update tray icon	Implemented
Development Timeline (Chronological)
Timecode	Activity/Event
00:00-00:51	Overview of project goal: desktop upload app with Tauri
00:51-01:40	Backend setup review; initial testing with web project; plans for auth
01:40-04:21	Backend route creation (upload/download); Prisma setup
04:21-06:07	Docker Compose to deploy backend services
06:07-08:52	Frontend setup: file upload logic, Axios request, progress tracking
08:52-11:28	Upload testing; debugging clipboard and alerts in Tauri
11:28-13:30	Implementing redirect on download route; testing URL access
13:30-15:43	Progress bar implementation and state management
15:43-18:19	Emitting progress events to tray icon; plans for global hotkey uploads
18:19-19:56	Clipboard read/write permission handling; notification permissions
19:56-end	Testing notifications; troubleshooting notification timing

00:00
vai fazer o que hoje Diegão vou continuar um projeto de um app desktop é para upload de arquivos minha ideia é finalizar esse projeto hoje mas esse App aqui ele não é feito com electron né Eu Já criei outros Apps com electron antes mas esse aqui ele é feito com com tau que é uma alternativa ao electron ah feita com Rust mas digamos o tanto de código e Rust que tu tem que mexer ela é muito muito pequeno né eu vou até rodar o projeto para vocês verem aqui ele é basicamente um app desktop que vai rodar em cima no na Tray né que é o o menuzinho que fica do lado do relógio basicamente a pessoa arrasta um arquivo aqui dentro e ela recebe uma uma URL para compartilhar aquele arquivo com outra pessoa aqui tinha mais algumas opções no menu eu removi para deixar o app mais simples possível agora nesse primeiro momento então só tem a opção de selecionar um arquivo e sair do do do software mas para frente eu quero adicionar algumas

00:51
outras coisas que vão tornar o processo muito mais muito mais rápido aqui para subir arquivo mas uma das coisas que eu não fiz eh semana passada a gente fez aqui na semana passada não semana retrasada a gente fez aqui na Twitch a parte do backend do app e até criou um projetinho web aqui na verdade só para testar a parte de upload Então esse projeto web aqui ele nada mais é do que simplesmente uma requisição axios aqui fazendo o upload do arquivo pra gente testar se isso aqui tava funcionando e funcionou Mas eu nem vou precisar mais desse projeto web aqui eu vou até Apagar ele daqui de dentro porque o que a gente precisa fazer aqui agora é finalizar o nosso backend para que ele suporte o restante das features né Então até tem um ridm aqui dentro que Ah eu tenho anotado as coisas que eu preciso criar uma das coisas até que não tá aqui mas que eu preciso fazer a parte de autenticação Porque hoje a minha api ela tá totalmente

01:40
pública né então a gente vai ter que criar a parte de autenticação aqui do total zero e aí eu vou ver como é que eu vou fazer porque como é um app desktop eu preciso pensar na maneira mais simples do mundo para fazer a autenticação de uma maneira que não me consuma muito trabalho né E aí eu não queria ir por uma estratégia de autenticação via e-mail e senha mas primeiro eu vou dar uma separada aqui no meu no meu backend então eu vou Create upload URL eu vou separar basicamente o meu meu projeto em em mais arquivos uma rota por arquivo aqui eu usando então tenho que codar da forma que ele que ele me pede aqui tá deixa eu ver os imports tá tudo certo Prisma tá o prisma conexão tava aqui eu vou mover ela PR Lib Prisma importo Prisma aqui dentro e vou criar minha outra rota que é para baixar um arquivo Create download ah adicionar os imports Ah e agora aqui dentro Create upload tá a gente vai precisar tô usando o qu pnpm aqui

04:21
T vai precisar configurar o cor porque essa aplicação backend vai vai ser acessada por uma aplicação Change né [Música] Tá por enquanto deixar tudo permitido vou primeiro integrar esse backend com esse frontend e depois eu vejo a parte de autenticação mas eu tenho algumas ideias de como que eu vou fazer a parte de autenticação só vou dar deixar isso e esfriar um pouco mais na minha cabeça mas aqui no projeto ó eu tenho um docker compose que é onde ficam as minhas informações aqui dos uploads que que eu vou fazer aqui [Música] ó eu vou dar um docker compose up menos D que ele vai subir o post e vou subir o servidor tá vou lá no meu frontend aqui e vou fazer o seguinte aqui handle start upload eu tenho os arquivos e aí que que eu vou fazer aqui dentro eu vou fazer o seguinte primeiro eu vou fazer com que essa parte rece um arquivo por vez Então vou tirar o múltiplo colocar ele como false para facilitar o meu primeiro

06:07
processo o processo aqui Inicial né eí que que eu vou fazer Olha só eu vou então eu vou ter um único [Música] arquivo vou fazer o seguinte const load URL vou instalar o axos aqui rapidinho Ah fazer um post para essa rota aqui ó de Create upload URL Ah então é post barra uploads aí eu envio para ela o nome do arquivo e o content Type então aqui eu mando name que vem de file pname e o content Type que vem de file Type e ela vai me retornar basicamente o objeto contendo signed url que é uma string e file id que é uma string também E aí eu faço o seguinte obtenho de dentro upload response melhor Create upload URL response ISO aqui vai me retornar a URL de upload e o ID do arquivo E aí eu vou fazer um API na minha URL passando o meu arquivo E aí eu passo um terceiro parâmetro que é o on upload Progress ele vai me retornar o evento do Progresso dentro desse evento eu tenho o progresso do upload só que esse esse progresso se eu não me engano

08:52
ele vem de zero até um Tá mas vamos dar um console log nesse Progresso aqui pra gente ver hum e aqui o eu vou tirar esse set timeout e aqui no final eu vou fazer o seguinte eu vou dar um alerta upload concluído eu não sei nem se o tau suporta alertas E aí eu tenho o file id só que ao invés de file id aqui o certo era aqui no front ch tá vou fazer const download URL htp local host 3333 bar uploads bar file id Navigator P clickboard pon WR text download URL Ou seja eu quero salvar o RL de download no meu clipboard E aí é isso ah o projeto já tá rodando então a gente pode direto pro teste eu vou abrir aqui um arquivo qualquer e vou arrastar aqui para dentro então vou pegar esse ícone aqui ó discord.png ah [Música] vamos a Prisma file Create Public file does not exist ã banco de dados tá zerado ia para acabar com com o peão tá tá deu certo a primeira ah a segunda deu certo também só que ele não deu Alerta eu acho que é porque o t não tem ap de

11:28
alerta é ele não tem permissão para dar Alerta não aqui ó eu não posso fazer o clipboard no t el Não Posso copiar direto clipboard provalmente eu vou ter que D alguma permissão Mas então vou dar um conso log na URL pra gente ver se pelo menos dessa forma funciona então deixa eu pegar aqui discord ó lá upload concluído e ele botou uma url aqui ó se eu acessar essa URL tá eu quero que aqui na rota de download do meu backend eu não retorne e sim faça um redirect então aqui dentro eu vou fazer um return reply ponto redirect signed URL e aqui eu posso passar ah é só isso status Ah eu posso passar status code no começo permanent redirect status code 30 tá então agora se eu acessar essa URL aqui dentro do meu navegador ele baixou a imagem do discord tá funcionando foi fácil demais era para ser tão fácil assim dá tudo certo de primeira programação é assim por que que ninguém me falou tá s Agora eu tenho que tirar esse negócio aqui

13:30
e tenho que fazer a questão do Progresso ali no meu frontend né então Ah aqui eu tenho uma barrinha de progresso que ela tá fixa que que eu vou fazer aqui ó con Progress set Progress use state zero quando eu iniciar o upload de um arquivo eu vou voltar o progresso para Z e aqui no progresso ó eu vou dar um set eu quero calcular o progresso da seguinte forma ou melhor aqui vai ser mais fácil né vou fazer simplesmente const Progress per iG math P round Progress ve 100 E aí dou set Progress Progress per ah é porque já tá definido aqui em cima undefined [Música] tá E aqui embaixo eu vou usar o progresso do upload e no final quando terminar de fazer o upload eu preciso copiar pro clip tá isso aí a gente ainda tem que fazer e aí eu tenho que limpar a fila tá então agora quando eu arrastar o arquivo ele vai fazer o Ah foi muito rápido cara mas da ele já limpa ó vou pegar um arquivo maior aqui ó ó lá ó Progresso já tá funcionando certinho

15:43
ó agora falta eu refleti esse Progresso aqui em cima no ícone só que aqui eu preciso o seguinte tyt tá Por que que eu quero isso aqui [Música] Porque aqui no progresso [Música] ó eu quero pegar esse percent passar para essa função e emitir o evento de progresso Vamos testar se tá funcionando agora então agora quando eu fizer upload de um arquivo pegar um arquivo mais pesado aqui ele tem que mostrar lá em cima também lá ó mesmo se eu fecho daí Olha só mostra o progresso lá em cima na barrinha brabo Agora eu preciso ver ta CP read SY Global J Então a gente tem que abrir o arquivo Jon procurar All e vamos botar aqui clip é enable All clipboard api sim porque mais pra frente é software eu preciso que ele Leia da clipboard também porque eu quero que o usuário possa fazer o seguinte olha só que massa ele dá um cont control c em algum arquivo E aí ele ele eu vou configurar uma uma Hot Key Global assim tipo sei lá control shift

18:19
qualquer coisa E aí ele vai automaticamente já fazer upload daquele arquivo sem a pessoa precisar nem arrastar o arquivo nem nada nem abrir o app o app vai ficar rodando em background Cara isso vai ficar muito massa muito massa Então vou salvar isso aqui agora ele vai resetar o app porque eu alterei as configs daí deixa eu ver aqui como é que eu faço PR ler tá eu tenho que abrir daqui ó Então agora eu vou lá no app E aí eu vou pegar WR Text e vou fazer aqui ó só deixa eu trocar o nome aqui WR to clipboard senão não vai ficar muito semântico aqui embaixo ait clipboard download E aí eu preciso de um alerta Como é que eu mando notificação no Mac ISO aqui I ser massa hein notification mic to send a notification a body you can specify the name of the sound you would like to play when the notification is show Hum mas eu não vou mexer nisso agora Ah permission tá Primeiro vamos importar Então a gente vai fazer o seguinte quando

19:56
o aplicativo abrir a use effect request permission a gente não tem permissão para enviar notificações eu vou pedir permissão E aí lá embaixo na hora que terminou aqui eu vou fazer o seguinte if const permission aqui const permission granted if permission granted eu vou enviar uma notificação send notification que eu preciso importar lá title upload body Card Dá para colocar ícone Também logo eu vou ver como é que faz isso salva e vamos testar eu vou abrir aqui vou arrastar o arquivo vou fechar [Música] aqui cara notificação deu maior rápido velho pelo menos a URL tá aqui no control V Mas por que que a notificação foi tão rápido olha só a notificação tá aqui ah é porque eu acho que eu tô com o app aberto né Deixa eu testar se é isso então eu vou arrastar e vou fechar o [Música] [Música] app

