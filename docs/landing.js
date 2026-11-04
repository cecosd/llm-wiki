// Страница за продукта (docs/index.html): GitHub Pages и http://localhost:4321/product/.
// Текстовете са на два езика тук. Резултатите от тестовете идват от docs/test-results.json (npm run release:docs).
const REPO = 'https://github.com/cecosd/llm-wiki';

const REFS_COMMON = [
  ['Anthropic. (2026a).', 'Data usage', 'https://code.claude.com/docs/en/data-usage', '. Claude Code Docs. Retrieved November 4, 2026, from'],
  ['Anthropic. (2026b).', 'Is my data used for model training?', 'https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training', '. Anthropic Privacy Center. Retrieved November 4, 2026, from'],
  ['Anthropic. (2026c).', 'About the Development Partner Program', 'https://support.claude.com/en/articles/11174108-about-the-development-partner-program', '. Claude Help Center. Retrieved November 4, 2026, from'],
  ['Karpathy, A. (2026).', 'LLM Wiki', 'https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f', ' [GitHub Gist].'],
];

const CONTENT = {
  bg: {
    nav: { label: 'Раздели', switch: 'Switch to English', items: [['why', 'Защо'], ['features', 'Възможности'], ['start', 'Изисквания'], ['data', 'Данни'], ['security', 'Сигурност'], ['tests', 'Тестове'], ['maintenance', 'Поддръжка']] },
    hero: {
      eyebrow: 'Лична база знания с отворен код', version: 'версия',
      title: 'Библиотека, която сама подрежда прочетеното',
      sub: 'Качвате книги, статии, таблици и бележки от всяка област. Claude ги чете и изгражда свързана база знания на вашия компютър, а всяко твърдение води до източника и страницата му.',
      cta: 'Изтегли от GitHub', cta2: 'Кое работи и кое не', open: 'Към библиотеката',
      note: 'Работи локално. Лиценз GPL-3.0. Обработката с Claude изисква ваш акаунт в Claude.',
    },
    flow: {
      label: 'Как файловете стават свързана библиотека', in: 'Вашите файлове', step: 'Claude чете и свързва, след като потвърдите цената', out: 'Свързана библиотека',
      graph: 'Схема: понятие в средата, свързано с източници, личности и теми', n: ['Договор, 2021', 'Закон, чл. 12', 'Понятие', 'Автор', 'Тема'],
      cap: 'Едно понятие събира всичко, което различните източници казват за него.',
    },
    why: {
      title: 'Какъв проблем решава',
      lede: 'Хората събират повече, отколкото могат да поддържат. Проблемът не е да намерите файла, а да запазите разбирането, което вече веднъж сте постигнали.',
      points: [
        ['Прочетеното се разпилява', 'PDF файлове, отметки и бележки стоят в различни папки. След няколко месеца е трудно да кажете кой автор какво твърди и къде.'],
        ['Отговорите от чата изчезват', 'Всеки разговор с AI започва почти отначало. Добрият отговор остава в историята, а знанието не се натрупва.'],
        ['Търсенето намира думи, не връзки', 'То не показва, че два източника си противоречат или че ново заключение променя стара бележка. Това се вижда само когато материалът е свързан.'],
      ],
      reasonT: 'Защо съществува', reason: 'Личните бази знания обикновено умират от поддръжка: никой не обновява стотици връзки на ръка. Тук тази работа поема моделът, а човекът избира какво влиза и проверява важното. Резултатът са обикновени Markdown файлове, които остават ваши.',
      origin: 'Изградено е по модела LLM Wiki на Andrej Karpathy (Karpathy, 2026).',
      whoT: 'За кого е',
      who: ['Изследователи и студенти с много литература', 'Юристи, инженери, лекари и анализатори с голям обем документи', 'Журналисти и автори, които работят по дълги теми', 'Всеки, който учи системно нова област'],
    },
    features: {
      title: 'Какво получавате',
      items: [
        ['Обработка на източници', 'PDF, EPUB, DOCX, таблици и уеб страници стават страници с обобщение, глави, понятия и личности. Оригиналите не се променят.'],
        ['Цитат до страницата', 'Твърдението води към главата и PDF страницата. Четецът отваря точно нея, за да проверите сами.'],
        ['Въпроси и учене', 'Питате библиотеката и получавате пътека през източниците. Има и локален режим без Claude.'],
        ['Писане с библиотеката', 'Чернова на статия по тема, с библиография в APA 7. Може локално или с Claude на три нива.'],
        ['Карта на връзките и области', 'Виждате как се свързват понятията и можете да ограничите работата до избрана област.'],
        ['Цена преди действие', 'Преди всяка обработка виждате приблизителните токени и цена. Без потвърждение тя не тръгва.'],
        ['Връщане назад', 'Промените на Claude могат да се отменят с бутон, ако имате git.'],
        ['Езици', 'Интерфейс на български и английски. Нов език се добавя с един JSON файл, без промяна в кода.'],
      ],
    },
    start: {
      title: 'Какво ви трябва и какво се очаква да можете',
      lede: 'Продуктът се разпространява като код от GitHub, не като готова програма с инсталатор от магазин. Не е нужно да сте програмист, но трябва да се чувствате спокойно в терминала.',
      reqT: 'Изисквания',
      req: [
        ['Операционна система', 'Windows (препоръчително през WSL), macOS или Linux'],
        ['Node.js 20 или по-нова', 'Задължително. Изпълнява приложението.'],
        ['Claude Code', 'Задължително за обработка и въпроси. Четенето и локалните режими работят и без него.'],
        ['Акаунт в Claude', 'Платен план (Pro, Max) или API ключ на Anthropic. Разходът е ваш и зависи от обема.'],
        ['Интернет', 'За инсталация, за Claude и за „Добави статия“. Четенето работи офлайн.'],
        ['По желание', 'Git (обновяване и връщане назад), ocrmypdf (по-добър OCR), Obsidian'],
      ],
      skillT: 'Какво трябва да можете',
      skills: [
        'Да отворите терминал и да пуснете команда, като разбирате в коя папка се намирате.',
        'Да инсталирате програма (Node.js, Claude Code) и да влезете в акаунта си.',
        'Да свалите репото с git clone или като ZIP и да го обновявате.',
        'Да прочетете съобщение за грешка и да потърсите решение или да го споделите при заявка за помощ.',
        'Да правите резервни копия на папките raw и wiki: приложението не ги качва никъде.',
        'Да разбирате, че AI може да греши, и да проверявате важните твърдения в източника.',
        'Да знаете дали имате право да обработвате даден материал и да го пращате към външна услуга.',
      ],
      noT: 'Какво не е нужно', no: 'Програмиране, познаване на Vue или Express, сървър или домейн. Приложението работи само на вашия компютър.',
      installT: 'Инсталация', autoT: 'С инсталатор: проверява и пита преди всяка стъпка', handT: 'На ръка, вътре в папката', signin: 'влезте веднъж в акаунта', check: 'проверете кое работи при вас',
    },
    data: {
      title: 'Къде отиват вашите данни',
      lede: 'Когато пуснете съдържание за обработка, то отива към Anthropic. Claude не може да го прочете по друг начин. Въпросът е дали ще се ползва и за обучение на модели, а това зависи от плана и настройките ви.',
      flows: [
        ['Остава на компютъра ви', 'Оригиналите, страниците, черновите и настройките. Четене, търсене, карта на връзките, локални пътеки и локално писане не пращат нищо.'],
        ['Отива към Anthropic', 'При обработка: текстът на източника и прочетените страници. При въпрос или писане с Claude: подбраните страници и въпросът. Връзката е шифрована с TLS 1.2 или по-нова (Anthropic, 2026a).'],
        ['Отива другаде, само с ваше действие', '„Добави статия“ се свързва с doi.org и сайта на издателя. Проверката за обновления се свързва с GitHub и регистъра на npm. Библиотеката ви не се праща там.'],
      ],
      tableT: 'Кога данните обучават модели',
      head: ['Вид акаунт', 'Обучение на модели', 'Срок на пазене при Anthropic'],
      rows: [
        ['Free, Pro, Max, Ultra, настройката е включена', 'Да', '5 години'],
        ['Free, Pro, Max, Ultra, настройката е изключена', 'Не', '30 дни'],
        ['Team, Enterprise, API', 'Не по подразбиране, освен ако организацията сама се включи (например Development Partner Program)', '30 дни. Нулево пазене (ZDR) има за одобрени Enterprise акаунти.'],
      ],
      howT: 'Как да не обучавате моделите с вашите данни',
      how: [
        ['При Free, Pro, Max или Ultra: изключете настройката.', 'Отворете настройките за поверителност и изключете използването на данните ви за подобряване на моделите (model improvement). Изборът важи и за Claude Code (Anthropic, 2026a).'],
        ['Или ползвайте търговски условия.', 'С API ключ, Team или Enterprise обучението по подразбиране е изключено (Anthropic, 2026a). Проверете дали организацията ви не се е включила в Development Partner Program (Anthropic, 2026c).'],
        ['Не пращайте сесии като обратна връзка.', 'Преписите, изпратени през /feedback, /bug или /share, се пазят 5 години и може да се ползват за подобряване на продуктите. Оценката с палец може да се ползва и за обучение, дори при изключена настройка (Anthropic, 2026a, 2026b).'],
        ['Проверете плана си в приложението.', 'Страницата „Настройки“ показва при какви условия работите. Самата настройка в акаунта не може да се прочете отвън, затова проверката остава ваша.'],
        ['По желание намалете останалия трафик.', 'Следната променлива спира телеметрията, докладите за грешки и анкетите. Тя не засяга текста, който Claude трябва да получи, и не променя правилата за обучение (Anthropic, 2026a).'],
      ],
      envNote: 'телеметрия и анкети, не засяга обучението',
      limitT: 'Какво остава дори при изключено обучение.', limit: 'Текстът все пак стига до Anthropic и се пази до 30 дни при стандартни условия. Разговори, отбелязани за проверка по сигурността, може да се анализират за подобряване на защитите (Anthropic, 2026b). Claude Code пази и локални преписи като обикновен текст в ~/.claude/projects/ за 30 дни по подразбиране; срокът се сменя с cleanupPeriodDays (Anthropic, 2026a). Материал, който не бива да напуска компютъра ви, не обработвайте с Claude. Правилата на Anthropic може да се променят: проверявайте източниците долу.',
    },
    sec: {
      title: 'Доколко е сигурно',
      lede: 'Подходящо е за един човек на собствен компютър, с документи, на които има доверие. Не е предвидено за сървър, за споделен достъп или за работа с враждебни файлове, и не е минало независим одит на сигурността.',
      okT: 'Какво е защитено и се проверява с тестове',
      ok: [
        'Сървърът слуша само на 127.0.0.1: от мрежата не се достига.',
        'Заявки с чужд Host и команди от други сайтове се отказват.',
        'Файлове извън raw/ не се четат през адресите на приложението; качен файл не излиза от входящата папка.',
        '„Добави статия“ приема само https и отказва адреси от локалната мрежа.',
        'При обработка Claude пише само в wiki/ и outputs/ и няма обща обвивка или мрежови инструмент.',
        'Личните папки са изключени от публичното репо.',
      ],
      badT: 'Известни ограничения',
      bad: [
        'Текстът на страниците се показва без пречистване на HTML и без Content-Security-Policy. Вреден HTML, скрит в документ, може да изпълни код в страницата, ако Claude го пренесе в wiki.',
        'Вреден документ може да опита да подведе Claude (prompt injection). Инструментът Read не е ограничен до папката на проекта, затова Claude може да прочете и други файлове. Няма мрежов инструмент за изнасянето им, но текстът стига до Anthropic.',
        'Няма потребители и пароли, а файловете не са шифровани. Всеки с достъп до акаунта ви на компютъра вижда библиотеката.',
        'Защитата срещу вътрешни адреси проверява DNS преди връзката, което оставя тесен прозорец за DNS rebinding.',
        'Пакетите имат известни уязвимости (виж „Поддръжка“) и трябва да се следят.',
      ],
      adviceT: 'Препоръки',
      advice: [
        'Обработвайте файлове само от източници, на които имате доверие.',
        'Не излагайте приложението в мрежата, дори през обратен прокси или тунел.',
        'За чувствителни материали ползвайте шифроване на целия диск и търговски условия при Anthropic.',
        'Преди обработка на важна библиотека правете резервно копие.',
        'Намерена уязвимост съобщавайте по реда в SECURITY.md в репото.',
      ],
    },
    tests: {
      title: 'Кое работи и кое не',
      lede: 'Показваме резултатите такива, каквито са. Тестовете пускат истинския сървър във временна папка, със симулиран Claude: доказват поведението на приложението, не качеството на отговорите на модела.',
      none: 'Отчетът не може да се зареди. Пуснете npm test в папката на проекта или го вижте в страницата „Настройки“.',
      meta: 'Последно пускане:',
      s: ['работят', 'не работят', 'известни ограничения', 'нетествани'],
      marks: { pass: 'Работи', fail: 'Не работи', known: 'Известно ограничение', not_run: 'Не е пуснат' },
      nc: 'Извън автоматичните тестове',
      own: 'Отчетът е от една среда. Пуснете npm test или бутона в „Настройки“, за да проверите на своя компютър. Това не харчи токени и не пипа библиотеката ви.',
    },
    maint: {
      title: 'Поддръжка и обновяване',
      lede: 'Продуктът работи добре, но стои върху библиотеки на Node.js, а те имат свои зависимости. Те се променят независимо от него, затова версиите и уязвимостите трябва да се проверяват редовно.',
      depsT: 'Основни библиотеки', depsNote: 'Заедно със своите зависимости стават стотици пакети в node_modules.',
      deps: [
        ['express', 'локалният сървър'], ['vue', 'интерфейсът'], ['@tailwindcss/browser', 'оформлението'], ['marked', 'Markdown към HTML'], ['gray-matter', 'метаданни на страниците'],
        ['unpdf, pdfjs-dist', 'текст и изображение от PDF'], ['tesseract.js, @napi-rs/canvas', 'OCR на сканирани страници'], ['mammoth, adm-zip', 'DOCX и EPUB'], ['exceljs, papaparse', 'таблици'],
      ],
      nowT: 'Състояние при последния отчет',
      audit: (a) => (a.total ? `npm audit отчита ${a.total} уязвимости: критични ${a.critical}, високи ${a.high}, средни ${a.moderate}, ниски ${a.low}. Прегледайте ги преди употреба.` : 'npm audit не отчита уязвимости.'),
      outdated: (n) => (n ? `Пакети с по-нова версия: ${n}.` : 'Всички пакети са актуални.'),
      howT: 'Как се проверява',
      how: 'Страницата „Настройки“ в приложението проверява с един бутон дали в GitHub има нова версия на кода и кои пакети са остарели. Нищо не се инсталира само. Същото става и от терминала:',
      c1: 'какво е остаряло', c2: 'известни уязвимости', c3: 'безопасно обновяване', c4: 'проверка след това',
    },
    about: {
      title: 'Кой стои зад продукта',
      main: 'LLM Wiki е разработен от SDevelopers LTD (ЕсДевелопърс ЕООД) съвместно с Claude.',
      note: 'Claude, моделът на Anthropic, участва като AI сътрудник в разработката на кода и документацията и върши обработката на библиотеката при работа. Продуктът не е издаден и не е одобрен от Anthropic.',
      license: 'Свободен софтуер под лиценз GNU GPL 3.0 или по-нов, предоставя се без гаранции. Код:',
    },
    refs: { title: 'Източници', items: REFS_COMMON },
  },

  en: {
    nav: { label: 'Sections', switch: 'Превключи на български', items: [['why', 'Why'], ['features', 'Features'], ['start', 'Requirements'], ['data', 'Data'], ['security', 'Security'], ['tests', 'Tests'], ['maintenance', 'Maintenance']] },
    hero: {
      eyebrow: 'Open-source personal knowledge base', version: 'version',
      title: 'A library that keeps what you read in order',
      sub: 'Add books, articles, tables and notes from any field. Claude reads them and builds a linked knowledge base on your computer, and every claim leads back to its source and page.',
      cta: 'Get it on GitHub', cta2: 'What works and what does not', open: 'Open the library',
      note: 'Runs locally. GPL-3.0 license. Processing with Claude needs your own Claude account.',
    },
    flow: {
      label: 'How files become a linked library', in: 'Your files', step: 'Claude reads and links, after you confirm the cost', out: 'A linked library',
      graph: 'Diagram: a concept in the middle, linked to sources, people and topics', n: ['Contract, 2021', 'Statute, art. 12', 'Concept', 'Author', 'Topic'],
      cap: 'One concept gathers what the different sources say about it.',
    },
    why: {
      title: 'The problem it solves',
      lede: 'People collect more than they can maintain. The hard part is not finding the file, it is keeping the understanding you already reached once.',
      points: [
        ['What you read gets scattered', 'PDFs, bookmarks and notes sit in different folders. A few months later it is hard to say which author claims what, and where.'],
        ['Chat answers vanish', 'Each AI conversation starts almost from zero. A good answer stays in the history, and knowledge does not build up.'],
        ['Search finds words, not connections', 'It does not show that two sources disagree or that a new conclusion changes an old note. You see that only when the material is linked.'],
      ],
      reasonT: 'Why it exists', reason: 'Personal knowledge bases usually die of maintenance: nobody updates hundreds of links by hand. Here the model takes on that work, while the person chooses what goes in and checks what matters. The result is plain Markdown files that stay yours.',
      origin: 'It is built on the LLM Wiki pattern by Andrej Karpathy (Karpathy, 2026).',
      whoT: 'Who it is for',
      who: ['Researchers and students with a lot of literature', 'Lawyers, engineers, physicians and analysts with many documents', 'Journalists and authors working on long topics', 'Anyone learning a new field systematically'],
    },
    features: {
      title: 'What you get',
      items: [
        ['Source processing', 'PDF, EPUB, DOCX, tables and web pages become pages with a summary, chapters, concepts and people. The originals are never changed.'],
        ['Citations down to the page', 'A claim leads to the chapter and PDF page. The reader opens exactly that page, so you can check for yourself.'],
        ['Questions and learning', 'Ask the library and get a path through the sources. There is also a local mode without Claude.'],
        ['Writing with the library', 'A draft article on a topic, with an APA 7 bibliography. Locally or with Claude at three levels.'],
        ['Link map and areas', 'See how concepts connect, and limit the work to a chosen area.'],
        ['Cost before action', 'Before each processing run you see the estimated tokens and cost. It does not start without your confirmation.'],
        ['Undo', 'Claude’s changes can be undone with a button if you have git.'],
        ['Languages', 'Interface in Bulgarian and English. A new language is one JSON file, with no code changes.'],
      ],
    },
    start: {
      title: 'What you need and what you should be able to do',
      lede: 'The product is distributed as code from GitHub, not as a ready-made app from a store. You do not have to be a programmer, but you should be comfortable in a terminal.',
      reqT: 'Requirements',
      req: [
        ['Operating system', 'Windows (preferably through WSL), macOS or Linux'],
        ['Node.js 20 or newer', 'Required. It runs the application.'],
        ['Claude Code', 'Required for processing and questions. Reading and local modes work without it.'],
        ['Claude account', 'A paid plan (Pro, Max) or an Anthropic API key. The cost is yours and depends on volume.'],
        ['Internet', 'For installation, for Claude and for “Add an article”. Reading works offline.'],
        ['Optional', 'Git (updates and undo), ocrmypdf (better OCR), Obsidian'],
      ],
      skillT: 'What you should be able to do',
      skills: [
        'Open a terminal and run a command, knowing which folder you are in.',
        'Install a program (Node.js, Claude Code) and sign in to your account.',
        'Get the repository with git clone or as a ZIP, and keep it updated.',
        'Read an error message and look for a solution, or share it when asking for help.',
        'Back up the raw and wiki folders: the application does not upload them anywhere.',
        'Understand that AI can be wrong, and check important claims in the source.',
        'Know whether you may process a given material and send it to an outside service.',
      ],
      noT: 'What you do not need', no: 'Programming, knowledge of Vue or Express, a server or a domain. The application runs only on your computer.',
      installT: 'Installation', autoT: 'With the installer: it checks and asks before each step', handT: 'By hand, inside the folder', signin: 'sign in once', check: 'see what works on your machine',
    },
    data: {
      title: 'Where your data goes',
      lede: 'When you send content for processing, it goes to Anthropic. Claude cannot read it any other way. The question is whether it is also used to train models, and that depends on your plan and settings.',
      flows: [
        ['Stays on your computer', 'Originals, pages, drafts and settings. Reading, search, the link map, local paths and local writing send nothing.'],
        ['Goes to Anthropic', 'During processing: the text of the source and the pages read. With a question or writing with Claude: the selected pages and the question. The connection uses TLS 1.2 or newer (Anthropic, 2026a).'],
        ['Goes elsewhere, only when you act', '“Add an article” contacts doi.org and the publisher’s site. The update check contacts GitHub and the npm registry. Your library is not sent there.'],
      ],
      tableT: 'When data trains models',
      head: ['Account type', 'Model training', 'Retention at Anthropic'],
      rows: [
        ['Free, Pro, Max, Ultra, setting on', 'Yes', '5 years'],
        ['Free, Pro, Max, Ultra, setting off', 'No', '30 days'],
        ['Team, Enterprise, API', 'Not by default, unless the organization opts in (for example the Development Partner Program)', '30 days. Zero data retention (ZDR) is available to approved Enterprise accounts.'],
      ],
      howT: 'How to keep your data out of model training',
      how: [
        ['On Free, Pro, Max or Ultra: turn the setting off.', 'Open the privacy settings and turn off the use of your data for model improvement. The choice also applies to Claude Code (Anthropic, 2026a).'],
        ['Or use commercial terms.', 'With an API key, Team or Enterprise, training is off by default (Anthropic, 2026a). Check that your organization has not joined the Development Partner Program (Anthropic, 2026c).'],
        ['Do not send sessions as feedback.', 'Transcripts sent through /feedback, /bug or /share are kept for 5 years and may be used to improve the products. Thumbs ratings may also be used for training, even with the setting off (Anthropic, 2026a, 2026b).'],
        ['Check your plan in the application.', 'The Settings page shows which terms you work under. The account setting itself cannot be read from outside, so that check stays with you.'],
        ['Optionally reduce the remaining traffic.', 'This variable stops telemetry, error reports and surveys. It does not affect the text Claude must receive, and it does not change the training rules (Anthropic, 2026a).'],
      ],
      envNote: 'telemetry and surveys, does not affect training',
      limitT: 'What remains even with training off.', limit: 'The text still reaches Anthropic and is kept for up to 30 days under standard terms. Conversations flagged for safety review may be analyzed to improve safeguards (Anthropic, 2026b). Claude Code also keeps local transcripts as plain text in ~/.claude/projects/ for 30 days by default; change this with cleanupPeriodDays (Anthropic, 2026a). Do not process material with Claude if it must not leave your computer. Anthropic’s rules may change: check the sources below.',
    },
    sec: {
      title: 'How secure it is',
      lede: 'It suits one person on their own computer, with documents they trust. It is not designed for a server, for shared access or for hostile files, and it has not had an independent security audit.',
      okT: 'What is protected and checked by tests',
      ok: [
        'The server listens only on 127.0.0.1: it cannot be reached from the network.',
        'Requests with a foreign Host and commands from other websites are refused.',
        'Files outside raw/ cannot be read through the application’s addresses; an uploaded file cannot leave the inbox.',
        '“Add an article” accepts only https and refuses local network addresses.',
        'During processing Claude writes only in wiki/ and outputs/ and has no general shell or network tool.',
        'Personal folders are excluded from the public repository.',
      ],
      badT: 'Known limitations',
      bad: [
        'Page text is shown without HTML sanitizing and without a Content-Security-Policy. Harmful HTML hidden in a document can run code in the page if Claude carries it into the wiki.',
        'A harmful document can try to mislead Claude (prompt injection). The Read tool is not limited to the project folder, so Claude can read other files too. There is no network tool to carry them away, but the text reaches Anthropic.',
        'There are no users or passwords, and files are not encrypted. Anyone with access to your account on the computer can see the library.',
        'The protection against internal addresses checks DNS before connecting, which leaves a narrow window for DNS rebinding.',
        'The packages have known vulnerabilities (see Maintenance) and need watching.',
      ],
      adviceT: 'Recommendations',
      advice: [
        'Process files only from sources you trust.',
        'Do not expose the application to a network, not even through a reverse proxy or tunnel.',
        'For sensitive material use full-disk encryption and commercial terms with Anthropic.',
        'Make a backup before processing an important library.',
        'Report a vulnerability as described in SECURITY.md in the repository.',
      ],
    },
    tests: {
      title: 'What works and what does not',
      lede: 'We show the results as they are. The tests run the real server in a temporary folder with a simulated Claude: they prove how the application behaves, not the quality of the model’s answers.',
      none: 'The report could not be loaded. Run npm test in the project folder or see it on the Settings page.',
      meta: 'Last run:',
      s: ['work', 'do not work', 'known limitations', 'not tested'],
      marks: { pass: 'Works', fail: 'Does not work', known: 'Known limitation', not_run: 'Not run' },
      nc: 'Not covered by automatic tests',
      own: 'The report comes from one environment. Run npm test or use the button on the Settings page to check your own computer. This spends no tokens and does not touch your library.',
    },
    maint: {
      title: 'Maintenance and updates',
      lede: 'The product works well, but it stands on Node.js libraries, and they have their own dependencies. These change independently of it, so versions and vulnerabilities need regular checks.',
      depsT: 'Main libraries', depsNote: 'With their own dependencies they become hundreds of packages in node_modules.',
      deps: [
        ['express', 'the local server'], ['vue', 'the interface'], ['@tailwindcss/browser', 'the styling'], ['marked', 'Markdown to HTML'], ['gray-matter', 'page metadata'],
        ['unpdf, pdfjs-dist', 'text and images from PDF'], ['tesseract.js, @napi-rs/canvas', 'OCR of scanned pages'], ['mammoth, adm-zip', 'DOCX and EPUB'], ['exceljs, papaparse', 'tables'],
      ],
      nowT: 'Status at the last report',
      audit: (a) => (a.total ? `npm audit reports ${a.total} vulnerabilities: ${a.critical} critical, ${a.high} high, ${a.moderate} moderate, ${a.low} low. Review them before use.` : 'npm audit reports no vulnerabilities.'),
      outdated: (n) => (n ? `Packages with a newer version: ${n}.` : 'All packages are up to date.'),
      howT: 'How to check',
      how: 'The Settings page in the application checks with one button whether GitHub has a new version of the code and which packages are out of date. Nothing is installed by itself. The same from a terminal:',
      c1: 'what is out of date', c2: 'known vulnerabilities', c3: 'safe update', c4: 'check afterwards',
    },
    about: {
      title: 'Who is behind the product',
      main: 'LLM Wiki is developed by SDevelopers LTD (ЕсДевелопърс ЕООД) together with Claude.',
      note: 'Claude, the model by Anthropic, took part as an AI collaborator in writing the code and documentation, and it does the library processing at run time. The product is not published or endorsed by Anthropic.',
      license: 'Free software under the GNU GPL 3.0 or later, provided without warranty. Code:',
    },
    refs: { title: 'References', items: REFS_COMMON },
  },
};

const readLang = () => {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'bg' || q === 'en') return q;
  try { const s = localStorage.getItem('landing-lang'); if (s === 'bg' || s === 'en') return s; } catch { /* без запис */ }
  return (navigator.language || '').toLowerCase().startsWith('bg') ? 'bg' : 'en';
};

Vue.createApp({
  data: () => ({ lang: readLang(), report: null, repo: REPO, local: location.pathname.startsWith('/product') }),
  computed: {
    c() { return CONTENT[this.lang]; },
    stats() {
      const s = this.report.summary, l = this.c.tests.s;
      return [
        { label: l[0], value: s.pass, tone: 'text-sage-600 dark:text-sage-200' },
        { label: l[1], value: s.fail, tone: s.fail ? 'text-clay-600' : '' },
        { label: l[2], value: s.known, tone: 'text-clay-600 dark:text-clay-400' },
        { label: l[3], value: s.notCovered + s.notRun, tone: 'text-muted dark:text-night-muted' },
      ];
    },
    groups() {
      const r = this.report;
      return [...new Set(r.tests.map((t) => t.group))].map((key) => {
        const items = r.tests.filter((t) => t.group === key);
        return { key, items, title: this.pick(r.groups[key] || { en: key }), pass: items.filter((t) => t.status === 'pass').length, bad: items.filter((t) => t.status === 'fail' || t.status === 'known').length };
      });
    },
  },
  watch: { lang: { immediate: true, handler(v) { document.documentElement.lang = v; } } },
  async created() {
    try { const r = await fetch('test-results.json', { cache: 'no-store' }); if (r.ok) this.report = await r.json(); } catch { /* показва се бележка */ }
  },
  methods: {
    toggleLang() {
      this.lang = this.lang === 'bg' ? 'en' : 'bg';
      try { localStorage.setItem('landing-lang', this.lang); } catch { /* само за това посещение */ }
    },
    pick(o) { return (this.lang === 'bg' && o.bg) || o.en; },
    mark(t) {
      const label = this.c.tests.marks[t.status];
      return { pass: { sym: '✓', tone: 'text-sage-600 dark:text-sage-200', label }, fail: { sym: '✕', tone: 'text-clay-600', label }, known: { sym: '!', tone: 'text-clay-600 dark:text-clay-400', label }, not_run: { sym: '–', tone: 'text-muted', label } }[t.status];
    },
  },
}).mount('#app');
