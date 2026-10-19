# 🌙 NUR HATM — Қуръони Карим Хатми (Telegram Bot + Mini App)

Премиальный бесплатный проект **Quran Hatm Telegram Bot + Mini App** с мгновенным мульти-выбором пора без лимитов, 24-часовым таймером авто-освобождения и духовным рейтингом чтецов.

- **GitHub репозиторий**: `https://github.com/yusufali239/nur-hatm-bot.git`
- **Mini App URL (Vercel)**: `https://nur-hatm-bot.vercel.app`

---

## ✨ Ключевые особенности

1. **Только кнопками в Mini App (Zero Free-Text)**:
   - Никаких сообщений *«ёзиб қўйинг»* в чате. Любое текстовое сообщение боту мягко перенаправляет пользователя на кнопку открытия **Liquid Glass Mini App**.
   - **Мульти-выбор без лимитов**: можно отметить галочками сразу **1, 5, 10 или все 30 пора** и забронировать одним нажатием (также есть чипы быстрого выбора `+1`, `+5`, `+10`, `Ҳаммаси`).

2. **Умный 24-часовой Таймер (`Timer.tsx`) + Авто-освобождение**:
   - Как только пользователь берет пора, запускается обратный отсчет `24:00:00` (настраивается админом в панели).
   - В Mini App на каждой карточке и в верхней панели отображается живой таймер: `10-пора: 23:41:12 қолди`.
   - Когда остается **< 1 часа**, капсула таймера (`Timer.tsx`) становится **рубиново-красной с пульсацией**, а бот присылает напоминание.
   - Если пользователь нажал **[✅ Ўқидим]** вовремя — начисляется **+10 баллов** рейтинга (`total_juz` и `total_hatm` растут).
   - Если не успел за 24 часа — фоновый воркер автоматически освобождает пора для других чтецов и списывает штраф рейтинга (**-5 баллов**).

3. **Рейтинг и Топ-10 (`RatingBoard.tsx`)**:
   - Таблица `users`: `id`, `name`, `total_hatm`, `total_juz`, `rating_points`.
   - Лидерборд в Mini App: **Топ-10 «Жаннат боғининг энг фаоллари»** с золотым, серебряным и бронзовым подиумом, количеством хатмов, прочитанных пора и баллами.
   - В Telegram-канале под живой сводкой Хатма автоматически выводится строка лидера:
     `🏆 Top: Ҳумайро — 142 пора (1420 балл)`

4. **Дизайн iOS 26 Liquid Glass**:
   - Глубокий темный фон с градиентом `#0A0A0F -> #1A1A2E` и атмосферными световыми сферами.
   - Виджеты пора (`JuzCard.tsx`): `backdrop-filter: blur(20px)`, `border: 1px solid rgba(255,255,255,0.1)`, `border-radius: 16px`.
   - **Свободная пора**: матовое серое стекло с цифрой и чекбоксом.
   - **Занятая пора**: изумрудный стеклянный glow + имя чтеца + таймер + быстрая кнопка `[✅ Ўқидим]`.
   - **Прочитанная (`Done`)**: жидкое золотое стекло (`Liquid Gold Glass`) с иконкой `✅` и мягким золотым свечением.
   - Тактильная анимация при нажатии (`scale: 0.95` через Framer Motion) + нативная вибрация **Telegram Haptic Feedback API**.

5. **Мульти-Админка и Ручное Дуа (`AdminGlassPanel.tsx`)**:
   - Поддержка нескольких админов через `ADMIN_IDS` в `.env`, а также команда `/admins` (`add` / `remove`) для Super Admin и управление админами прямо внутри Mini App.
   - Кнопка **[🔔 Хатм Дуа қилиш]** — админ нажимает **ПО СВОЕЙ ВОЛЕ** в любой момент (даже если прочитано 15/30 пора), публикует Дуа и по желанию сразу открывает следующий круг Хатма.

6. **Защита и Надёжность**:
   - Защита от гонки (Race Condition) за одну и ту же пора: `UNIQUE(hatm_id, number)` + атомарный транзакционный `UPDATE ... WHERE status = 'free'`.
   - Дебаунс обновления поста в Telegram-канале **3 секунды** (`CHANNEL_DEBOUNCE_SECONDS=3`), чтобы при массовом бронировании не ловить FloodWait от Telegram.
   - Если пользователь заблокировал бота (`ChatMemberStatus.KICKED` / `TelegramForbiddenError`) — все его активные забронированные пора мгновенно освобождаются.
   - **Проверка личности**: каждый запрос Mini App несёт подписанные Telegram данные (`X-Telegram-Init-Data`). Бэкенд проверяет подпись по `BOT_TOKEN` и берёт ID и имя только из неё; админские эндпоинты доступны лишь админам, а список админов меняет только Super Admin. Если `BOT_TOKEN` не задан (локальная разработка в браузере), проверка отключается и работает демо-пользователь `777000`.

---

## 📁 Структура проекта

```text
HatmProekt/
├── backend/
│   ├── config.py            # Настройки (.env, Neon Postgres / SQLite)
│   ├── database.py          # Async SQLAlchemy 2.0 движок и сессии
│   ├── models.py            # Модели User, Hatm, Juz + UNIQUE(hatm_id, number)
│   ├── schemas.py           # Pydantic v2 схемы
│   ├── services.py          # Мульти-бронь, 24ч таймер воркер, рейтинг, дебаунс 3с
│   └── main.py              # FastAPI сервер + жизненный цикл Aiogram 3 бота
├── bot/
│   ├── handlers.py          # Кнопочный UX, /start, /admins, авто-освобождение при бане
│   └── channel_manager.py   # Живое табло в канале + 🏆 Top: Хумайро - 142 пора
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── JuzCard.tsx          # iOS 26 Liquid Glass виджет пора (blur 20px, radius 16px)
│   │   │   ├── RatingBoard.tsx      # Топ-10 "Жаннат боғининг энг фаоллари"
│   │   │   ├── Timer.tsx            # Капсула обратного отсчета (красная < 1ч)
│   │   │   ├── AdminGlassPanel.tsx  # Стеклянная админка + ручная кнопка [🔔 Хатм Дуа қилиш]
│   │   │   └── ui/glass-primitives.tsx
│   │   ├── lib/
│   │   │   ├── api.ts               # Клиент FastAPI
│   │   │   └── telegram.ts          # Telegram WebApp SDK + Haptic Feedback API
│   │   ├── App.tsx                  # Главный экран Mini App с мульти-выбором без лимитов
│   │   └── index.css                # Классы iOS 26 Liquid Glass
├── docker-compose.yml       # Локальный запуск одной командой (Postgres + Backend + Frontend)
├── Dockerfile.backend       # Docker-образ для Render.com / локалки
├── render.yaml              # Free Deploy конфиг для Render.com
├── vercel.json              # Free Deploy конфиг для Vercel
└── .env.example             # Шаблон переменных окружения
```

---

## 🚀 Как залить БЕСПЛАТНО за 5 минут (Neon.tech + Render.com + Vercel)

### Шаг 1. Бесплатная база данных PostgreSQL на [Neon.tech](https://neon.tech) (1 минута)
1. Зайдите на [neon.tech](https://neon.tech) (вход через GitHub) и нажмите **Create Project**.
2. Скопируйте строку подключения `Connection string` (вида `postgresql://user:pass@ep-...neon.tech/neondb?sslmode=require`).
3. Бэкенд автоматически преобразует её в `postgresql+asyncpg://...`.

### Шаг 2. Создайте бота в [@BotFather](https://t.me/BotFather) (1 минута)
1. Отправьте `/newbot` в `@BotFather` и скопируйте `BOT_TOKEN`.
2. Узнайте свой Telegram ID (например, через `@userinfobot`) для переменной `ADMIN_IDS`.
3. *(Опционально)* Добавьте бота администратором в ваш Telegram-канал и укажите ID канала в `CHANNEL_ID` (например `-1001234567890`).

### Шаг 3. Бесплатный хостинг Mini App на [Vercel](https://vercel.com) (1.5 минуты)
1. Загрузите этот репозиторий на свой GitHub.
2. Зайдите на [vercel.com](https://vercel.com) -> **Add New Project** -> выберите репозиторий.
3. Файл `vercel.json` уже настроен! В разделе **Environment Variables** добавьте:
   - `VITE_API_URL` = `https://ВАШ-БЭКЕНД.onrender.com/api`
4. Нажмите **Deploy**. Скопируйте полученный домен (например, `https://nur-hatm.vercel.app`).

### Шаг 4. Бесплатный хостинг Backend + Bot на [Render.com](https://render.com) (1.5 минуты)
1. Зайдите на [render.com](https://render.com) -> **New +** -> **Blueprint** (или **Web Service**) и подключите ваш GitHub-репозиторий.
2. Render автоматически прочитает `render.yaml`. Заполните переменные окружения:
   - `BOT_TOKEN` = токен от BotFather
   - `ADMIN_IDS` = ваш Telegram ID (или несколько через запятую: `1234567,7654321`)
   - `DATABASE_URL` = строка из Neon.tech
   - `WEBAPP_URL` = ссылка на ваш Vercel из Шага 3
   - `CHANNEL_ID` = ID вашего канала (или оставьте пустым)
3. Готово! Бот и API работают бесплатно 24/7.

---

## 💻 Локальный запуск (Docker Compose или напрямую)

### Вариант А: Через Docker Compose
```bash
cp .env.example .env
docker-compose up --build
```
- Frontend Mini App: `http://localhost:5173`
- Backend API & Swagger: `http://localhost:8000/docs`

### Вариант Б: Быстрый запуск без Docker (на встроенном SQLite)
```bash
# 1. Запуск Backend + Bot (порт 8000)
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# 2. Запуск Frontend Mini App (порт 5173)
cd frontend
npm install
npm run dev
```
