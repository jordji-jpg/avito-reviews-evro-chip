# Виджет отзывов Авито

Этот репозиторий содержит файлы виджета, которые подключаются на сайт через jsDelivr CDN. Локально файлы лежат в `~/Мой диск/Claude/Feedback Avito/widget/` и обновляются скриптом `update_reviews.command`.

## Файлы

- `avito-widget.js` — JS виджета (vanilla, без зависимостей)
- `avito-widget.css` — стили
- `data/avito-reviews.json` — отзывы (обновляется автоматически)

## Подключение на сайт

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/USER/REPO@main/avito-widget.css">
<script src="https://cdn.jsdelivr.net/gh/USER/REPO@main/avito-widget.js" defer></script>
<div data-avito-widget
     data-source="https://cdn.jsdelivr.net/gh/USER/REPO@main/data/avito-reviews.json"
     data-auto="url"></div>
```

(Замените `USER/REPO` на свои.)

## Параметры виджета

| Атрибут | Значение |
|---|---|
| `data-source` | URL JSON с отзывами |
| `data-brand` | Каноническая марка (например `Haval`) — фильтрация |
| `data-model` | Slug модели (например `jolion`) |
| `data-auto="url"` | Автоматически определять brand/model из URL страницы |
| `data-limit` | Сколько карточек показать (по умолчанию 10) |

Внутри каждого scope (model > brand > all) отзывы сортируются по `quality_score` — лучшие сначала.
