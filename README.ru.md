<p align="right">
  <img src="./assets/orcestr-logo.png" alt="Логотип Orcestr" width="42" height="42" align="left" />
  <a href="./README.md">English</a> · <strong>Русский</strong>
</p>

# Orcestr Media Transcriber

[![Validate](https://github.com/Artasov/orcestr-media-transcriber/actions/workflows/validate.yml/badge.svg)](https://github.com/Artasov/orcestr-media-transcriber/actions/workflows/validate.yml)
[![Release desktop apps](https://github.com/Artasov/orcestr-media-transcriber/actions/workflows/release-desktop.yml/badge.svg)](https://github.com/Artasov/orcestr-media-transcriber/actions/workflows/release-desktop.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Превращает локальные аудио и видеофайлы в MP3 и читаемые текстовые транскрипты через OpenAI.

Помогает founder, product owner, team lead и разработчикам обрабатывать созвоны, голосовые заметки, демо и интервью без ручной нарезки медиа. Можно вставить локальные пути до файлов, выбрать генерацию `.mp3`, `.txt` или обоих файлов, видеть прогресс по каждому и получить результаты рядом с исходным media с тем же базовым именем.

Длинные файлы конвертируются через `ffmpeg`, режутся на аудиочанки, по возможности выравниваются по тишине и отправляются в OpenAI параллельно с retry/backoff. UI получает live-прогресс через server-sent events.

Часть экосистемы [Orcestr](https://orcestr.com).

## Возможности

- Обработка нескольких локальных путей до audio/video файлов.
- Опциональная генерация `.mp3` рядом с исходным файлом.
- Опциональная генерация `.txt` рядом с исходным файлом.
- FastAPI backend с async upload streaming и in-memory job tracking.
- Предобработка через `ffmpeg`/`ffprobe`: извлечение аудио из видео, MP3-конвертация и чтение длительности.
- Планирование чанков с выравниванием по тишине для длинных файлов.
- Параллельные OpenAI-запросы с разнесённым стартом и retry/backoff.
- React/Vite UI с прогрессом, предпросмотром транскрипта, copy и download.
- Дополнительный upload-режим, который копирует файлы в `artifacts/uploads` перед обработкой.

## Требования

- Python 3.12
- Node.js 20+
- `uv`
- `ffmpeg` и `ffprobe` в `PATH`
- `OPENAI_API_KEY`

## Установка

Создай локальный env-файл:

```bash
copy .env.example .env
```

Заполни `OPENAI_API_KEY`.

Установи backend-зависимости:

```bash
cd backend
uv sync --extra dev
```

Установи frontend-зависимости:

```bash
cd ../frontend
npm install
```

## Запуск

Backend:

```bash
cd backend
uv run uvicorn media_transcriber.main:app --app-dir src --host 127.0.0.1 --port 3933
```

Frontend:

```bash
cd frontend
npm run dev
```

Открой URL, который напечатает `npm run dev`. Frontend по умолчанию запускается на `8933` и проксирует `/api` в `http://127.0.0.1:3933`.

Перетащи файлы в область загрузки или кликни по ней, чтобы выбрать несколько файлов, затем выбери outputs:

- `MP3` создаёт `same-name.mp3` рядом с исходным файлом.
- `TXT` создаёт `same-name.txt` рядом с исходным файлом.
- Если выбрать оба пункта, будут созданы оба файла. Если выбрать только `TXT`, backend может временно создать mp3 для транскрибации, но удалит его после завершения.

## Конфигурация

| Переменная | По умолчанию | Описание |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | OpenAI API key для транскрибации. |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Модель OpenAI для транскрибации. |
| `OPENAI_AUDIO_CHUNK_SECONDS` | `120` | Целевая длина чанка для длинных файлов. |
| `OPENAI_REQUEST_TIMEOUT_S` | `120` | HTTP timeout для OpenAI-запросов. |
| `TRANSCRIPTION_CONCURRENCY` | `2` | Сколько файлов обрабатывается параллельно. |
| `TRANSCRIPTION_UPLOAD_MAX_MB` | `10000` | Максимальный размер одного upload. |
| `ARTIFACTS_DIR` | `./artifacts` | Хранилище для optional upload-режима. Path-based обработка пишет результаты рядом с исходными файлами. |

## Разработка

Backend-проверки:

```bash
cd backend
uv run pytest
uv run ruff check src tests
uv run mypy
```

Frontend-проверки:

```bash
cd frontend
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

## Desktop-релизы

GitHub Actions автоматически собирает приложения по тегам `v*`:

- Windows x64: установщик `.exe`;
- macOS x64 и arm64: `.dmg`;
- Linux x64: `.deb` и `.AppImage`.

Приложение работает через Tauri 2 и включает production frontend, PyInstaller backend, `ffmpeg` и `ffprobe`. Пользователю не нужны Python, Node.js или отдельно установленный FFmpeg.

Локальная сборка:

```bash
npm install
cd frontend
npm install
cd ../backend
uv sync --extra package
cd ..
npm run package:desktop
```

Для локальной desktop-сборки также нужен stable Rust и системные зависимости из [документации Tauri](https://v2.tauri.app/start/prerequisites/). Готовые файлы появляются в `release/`.

CI-релиз создаётся после отправки тега:

```bash
git tag v0.0.1
git push origin v0.0.1
```

Общие PyCharm-конфигурации `release patch`, `release minor` и `release major` синхронно обновляют версии frontend, backend и Tauri, затем создают локальный release-коммит и тег `vX.Y.Z`. Чтобы запустить desktop CI, отправь commit и tag командами, которые напечатает release-helper.

На macOS используется ad-hoc подпись. До настройки publisher signing и Apple notarization операционные системы могут показывать предупреждения о доверии.

## Архитектура

Backend намеренно небольшой:

- `backend/src/media_transcriber/main.py` отдаёт REST и SSE API.
- `backend/src/media_transcriber/jobs.py` держит активные jobs в памяти и публикует progress events.
- `backend/src/media_transcriber/media.py` отвечает за upload storage, определение типа файла и MP3-конвертацию.
- `backend/src/media_transcriber/transcription.py` содержит chunk planning, silence alignment, OpenAI calls и retry logic.

Состояние jobs хранится в памяти и сбрасывается после рестарта backend. Path-based outputs остаются рядом с исходными файлами. Uploaded media остаётся в `artifacts/`.

## Безопасность

Не выставляй backend в недоверенную сеть. Это локальный инструмент, который принимает media uploads и пишет файлы на локальный диск.

Не коммить `.env`, API keys, загруженные записи и сгенерированные транскрипты.

Смотри [Security](./SECURITY.md).

## Ссылки

- [Сайт Orcestr](https://orcestr.com)
- [Orcestr overview](https://github.com/Artasov/orcestr-overview)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [License](./LICENSE)
