# Тестове и разработка

Проектът е Node.js (ESM) със сървър на Express и интерфейс на Vue 3 с Tailwind, без стъпка за компилиране. Подробна карта „цел → файлове“ има в `PROJECT-HISTORY.md` в корена.

## Структура

| Път | Роля |
|---|---|
| `scripts/server.js` | Всички `/api/*` маршрути, статични файлове, защити. |
| `scripts/app.js`, `modes.js`, `app-control.js`, `hosts.js` | Стартер, режими, заявки към стартера, име на сайта. |
| `scripts/sandbox.js` | Клетка с bubblewrap (само вградени модули). |
| `scripts/viewer/app.js`, `index.html` | Компоненти и x-шаблони. |
| `scripts/viewer/help/` | Тази документация (`index.json` и `bg/`, `en/`). |
| `locales/`, `content/` | Преводи на интерфейса; езикови пакети на правилата и промптовете. |
| `tests/` | Тестове (`node:test`). |

## Тестове

```
npm test                 # във временно копие, с фалшив Claude
npm run i18n:check       # преводите на интерфейса
node --check scripts/viewer/app.js
```

Тестовете не харчат токени и не пипат библиотеката. При проект през `\\wsl.localhost` пускай от Linux или от локално копие (junction към UNC не работи).

## Правила

- Нов текст в интерфейса: `$t('English text')` и превод в `locales/bg.json` (`en.json` има ключа за ключ).
- Всеки не-GET `fetch` носи заглавка `x-library: 1`: ползвай `api()`.
- Файловете, които стартерът пуска извън изолацията (`app.js`, `modes.js`, `hosts.js`, `sandbox*.js`), ползват САМО вградени модули на Node.
- Нов запис в защитените данни (клетка): добави го към `WRITABLE_DIRS` или `WRITABLE_FILES` в `modes.js` и `sandbox.js`.

## Документация

Добави страница: файл `help/bg/<id>.md` и `help/en/<id>.md`, ред в `help/index.json`. Без дълго тире.

## Участие

Виж `CONTRIBUTING.md`. `main` е защитен: промените минават през заявка за сливане.
