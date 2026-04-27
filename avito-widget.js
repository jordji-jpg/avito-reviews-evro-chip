/**
 * Виджет отзывов с Авито — самодостаточный JS, без зависимостей.
 *
 * Подключение:
 *   <link rel="stylesheet" href="/widget/avito-widget.css">
 *   <div id="avito-reviews-widget" data-brand="Haval" data-model="jolion"></div>
 *   <script src="/widget/avito-widget.js" defer></script>
 *
 * Опции (data-атрибуты на контейнере):
 *   data-source       URL JSON-файла (по умолчанию: /widget/data/avito-reviews.json)
 *   data-brand        Каноническое имя марки ("Haval"). Опционально.
 *   data-model        Slug модели ("jolion"). Опционально.
 *   data-limit        Сколько максимум отзывов (по умолчанию 10).
 *   data-auto         "url" — пытаться определить brand/model из URL страницы.
 *   data-source-url   Ссылка для кнопки "Оставить отзыв" (если override).
 */
(function () {
  "use strict";

  const DEFAULT_DATA_URL = "/widget/data/avito-reviews.json";
  const MIN_POOL_SIZE = 3;
  const DEFAULT_LIMIT = 10;
  const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов: пока кэш свежий — в сеть не ходим
  const CACHE_KEY_PREFIX = "aw-cache:v2:";
  const RU_MONTHS = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];

  function slugify(s) {
    if (!s) return "";
    const map = {
      "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e",
      "ж":"zh","з":"z","и":"i","й":"i","к":"k","л":"l","м":"m",
      "н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u",
      "ф":"f","х":"h","ц":"c","ч":"ch","ш":"sh","щ":"sch","ъ":"",
      "ы":"y","ь":"","э":"e","ю":"yu","я":"ya",
    };
    let out = "";
    for (const ch of s.toLowerCase()) {
      if (map[ch] !== undefined) out += map[ch];
      else if (/[a-z0-9]/.test(ch)) out += ch;
      else if (out && out[out.length - 1] !== "-") out += "-";
    }
    return out.replace(/^-+|-+$/g, "");
  }

  function formatDate(iso) {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    const day = parseInt(m[3], 10);
    const month = RU_MONTHS[parseInt(m[2], 10) - 1];
    return `${day} ${month} ${m[1]}`;
  }

  function escapeHTML(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[c]);
  }

  function pickFromUrl(meta) {
    /** Пытается найти brand_slug и model_slug в pathname текущей страницы. */
    const path = (location.pathname + " " + location.search).toLowerCase();
    const brandSlugs = Object.keys(meta.brand_counts || {});
    const modelKeys = Object.keys(meta.model_counts || {});

    let foundBrand = "";
    let foundModel = "";
    // Сначала ищем самую длинную модель (чтобы "land-cruiser" побеждал "cruiser")
    const modelsSorted = modelKeys
      .map(k => k.split("/"))
      .filter(([b, m]) => b && m)
      .sort((a, b) => (b[1].length + b[0].length) - (a[1].length + a[0].length));
    for (const [b, m] of modelsSorted) {
      const re = new RegExp(`(^|[^a-z0-9])${b}[^a-z0-9].*${m}(?![a-z0-9])`);
      const re2 = new RegExp(`(^|[^a-z0-9])${m}(?![a-z0-9]).*[^a-z0-9]${b}([^a-z0-9]|$)`);
      if (re.test(path) || re2.test(path)) {
        foundBrand = b;
        foundModel = m;
        break;
      }
    }
    if (!foundBrand) {
      // Нет полной пары — ищем хотя бы марку
      const brandsSorted = brandSlugs.sort((a, b) => b.length - a.length);
      for (const b of brandsSorted) {
        if (new RegExp(`(^|[^a-z0-9])${b}([^a-z0-9]|$)`).test(path)) {
          foundBrand = b;
          break;
        }
      }
    }
    return { brand: foundBrand, model: foundModel };
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderStars(rating) {
    const filled = Math.round(rating || 0);
    let html = '<span class="aw-stars" aria-label="Рейтинг ' + filled + ' из 5">';
    for (let i = 1; i <= 5; i++) {
      html += `<span class="aw-star ${i <= filled ? "aw-star--filled" : ""}">★</span>`;
    }
    html += '</span>';
    return html;
  }

  function renderHeader(meta) {
    const ratingTxt = meta.rating_avg.toFixed(1);
    // Приоритет: реальное число с Avito (если успели сскрапить); иначе наше собранное
    const total = meta.total_reviews_avito || meta.total_ratings || meta.five_star_count || 0;
    return `
      <div class="aw-header">
        <h3 class="aw-header__title">
          Отзывы о нас: рейтинг ${ratingTxt} на основании ${total} оценок
        </h3>
      </div>
    `;
  }

  function renderSummaryCard(meta, sourceUrl) {
    const ratingTxt = meta.rating_avg.toFixed(1);
    return `
      <div class="aw-summary">
        <div class="aw-summary__rating">${ratingTxt} из 5</div>
        ${renderStars(Math.round(meta.rating_avg))}
        <div class="aw-summary__brand">
          <svg class="aw-avito-logo" viewBox="0 0 80 24" xmlns="http://www.w3.org/2000/svg" aria-label="Avito">
            <circle cx="13" cy="12" r="6" fill="#965EEB"/>
            <circle cx="22" cy="6" r="3" fill="#0AF"/>
            <circle cx="22" cy="18" r="3" fill="#FF4053"/>
            <circle cx="6" cy="18" r="3" fill="#FFCB00"/>
            <text x="32" y="17" font-family="-apple-system, sans-serif" font-weight="700" font-size="16" fill="currentColor">Avito</text>
          </svg>
        </div>
        <a class="aw-summary__cta" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener nofollow">
          Оставить отзыв
        </a>
      </div>
    `;
  }

  function renderReviewCard(r) {
    const initial = (r.author || "?").trim().charAt(0).toUpperCase();
    return `
      <article class="aw-review">
        <header class="aw-review__head">
          <div class="aw-review__avatar" aria-hidden="true">${escapeHTML(initial)}</div>
          <div class="aw-review__meta">
            <div class="aw-review__author">
              ${escapeHTML(r.author || "Пользователь")}
              <span class="aw-review__verify" aria-label="Подтверждённый автор">✓</span>
            </div>
            ${renderStars(5)}
            <div class="aw-review__date">${escapeHTML(formatDate(r.date))}</div>
          </div>
        </header>
        ${r.title ? `<div class="aw-review__title">«${escapeHTML(r.title)}»</div>` : ""}
        <p class="aw-review__text">${escapeHTML(r.text)}</p>
        <button class="aw-review__more" type="button" aria-expanded="false" hidden>Читать полностью</button>
      </article>
    `;
  }

  function attachExpandable(container) {
    /** Для каждой карточки: если текст длинный — показываем «Читать полностью».
     *  По клику — разворачиваем/сворачиваем. */
    const cards = container.querySelectorAll(".aw-review");
    cards.forEach(card => {
      const textEl = card.querySelector(".aw-review__text");
      const btn = card.querySelector(".aw-review__more");
      if (!textEl || !btn) return;

      // Эвристика: если текст длиннее ~180 символов либо содержит >=3 переносов,
      // его 4-строчный clamp точно обрежет. Эту проверку CSS-метрикой делать
      // ненадёжно — у line-clamp'а scrollHeight нередко равен clientHeight.
      const t = textEl.textContent || "";
      const lineBreaks = (t.match(/\n/g) || []).length;
      const isLong = t.length > 180 || lineBreaks >= 3;
      if (isLong) btn.hidden = false;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const expanded = textEl.classList.toggle("aw-review__text--expanded");
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
        btn.textContent = expanded ? "Свернуть" : "Читать полностью";
      });
    });
  }

  function renderCarousel(reviews) {
    const slides = reviews.map(renderReviewCard).join("");
    return `
      <div class="aw-carousel">
        <div class="aw-carousel__track" role="region" aria-label="Отзывы">
          ${slides}
        </div>
        <div class="aw-carousel__nav">
          <button type="button" class="aw-nav aw-nav--prev" aria-label="Предыдущий">‹</button>
          <button type="button" class="aw-nav aw-nav--next" aria-label="Следующий">›</button>
          <div class="aw-progress"><div class="aw-progress__bar"></div></div>
        </div>
      </div>
    `;
  }

  function attachCarousel(container) {
    const track = container.querySelector(".aw-carousel__track");
    const prev = container.querySelector(".aw-nav--prev");
    const next = container.querySelector(".aw-nav--next");
    const bar = container.querySelector(".aw-progress__bar");
    if (!track || !prev || !next) return;

    function step() {
      const card = track.querySelector(".aw-review");
      if (!card) return 320;
      const style = getComputedStyle(track);
      const gap = parseFloat(style.columnGap || style.gap || "16");
      return card.getBoundingClientRect().width + gap;
    }

    function updateBar() {
      const max = track.scrollWidth - track.clientWidth;
      if (!bar || max <= 0) return;
      const pct = Math.min(100, Math.max(0, (track.scrollLeft / max) * 100));
      bar.style.width = pct + "%";
    }

    function nav(direction) {
      return (e) => {
        // Виджет может быть встроен внутри <a> или <form> — гасим всплытие,
        // чтобы клик по стрелке не вызывал переход/отправку формы.
        e.preventDefault();
        e.stopPropagation();
        track.scrollBy({ left: direction * step(), behavior: "smooth" });
      };
    }
    prev.addEventListener("click", nav(-1));
    next.addEventListener("click", nav(1));
    track.addEventListener("scroll", updateBar, { passive: true });
    window.addEventListener("resize", updateBar);
    updateBar();
  }

  function filterReviews(reviews, brandSlug, modelSlug) {
    const wantedBrand = slugify(brandSlug);
    const wantedModel = slugify(modelSlug);
    if (wantedBrand && wantedModel) {
      return reviews.filter(r => r.brand_slug === wantedBrand && r.model_slug === wantedModel);
    }
    if (wantedBrand) {
      return reviews.filter(r => r.brand_slug === wantedBrand);
    }
    return reviews.slice();
  }

  function selectPool(data, brandSlug, modelSlug, limit) {
    /** Каскадная склейка пула:
     *    1. Все отзывы по модели (отсортированы по score внутри JSON)
     *    2. Дополняем отзывами по марке (исключая уже добавленные)
     *    3. Дополняем общими отзывами (исключая уже добавленные)
     *  Всё ограничено limit'ом. scope = первая группа, в которой нашёлся хоть один отзыв.
     */
    const reviews = data.reviews;
    const wantedBrand = slugify(brandSlug);
    const wantedModel = slugify(modelSlug);

    const pool = [];
    const seen = new Set();
    let scope = "all";

    function appendFrom(list) {
      for (const r of list) {
        if (pool.length >= limit) return;
        // Уникальность: автор + дата + первые 50 символов текста
        const key = (r.author || "") + "|" + (r.date || "") + "|" + (r.text || "").slice(0, 50);
        if (seen.has(key)) continue;
        seen.add(key);
        pool.push(r);
      }
    }

    // 1. Точное совпадение по модели
    if (wantedBrand && wantedModel) {
      const modelHits = reviews.filter(r => r.brand_slug === wantedBrand && r.model_slug === wantedModel);
      if (modelHits.length > 0) scope = "model";
      appendFrom(modelHits);
    }

    // 2. Все остальные отзывы по марке
    if (pool.length < limit && wantedBrand) {
      const brandHits = reviews.filter(r => r.brand_slug === wantedBrand);
      if (scope === "all" && brandHits.length > 0) scope = "brand";
      appendFrom(brandHits);
    }

    // 3. Общие отзывы (топ по score)
    if (pool.length < limit) {
      appendFrom(reviews);
    }

    return { pool, scope };
  }

  function isValidData(data) {
    /** Минимальная валидация: должны быть meta-объект и непустой массив отзывов. */
    if (!data || typeof data !== "object") return false;
    if (!data.meta || typeof data.meta !== "object") return false;
    if (!Array.isArray(data.reviews) || data.reviews.length === 0) return false;
    return true;
  }

  function loadFromCache(jsonUrl) {
    /** Возвращает {data, age, source}|null. Никогда не бросает. */
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(CACHE_KEY_PREFIX + jsonUrl);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || !cached.data || !cached.timestamp) return null;
      if (!isValidData(cached.data)) return null;
      return { data: cached.data, age: Date.now() - cached.timestamp };
    } catch (e) {
      return null;
    }
  }

  function saveToCache(jsonUrl, data) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(
        CACHE_KEY_PREFIX + jsonUrl,
        JSON.stringify({ data, timestamp: Date.now() })
      );
    } catch (e) {
      // Quota exceeded или localStorage недоступен — игнорируем
    }
  }

  async function fetchFresh(jsonUrl) {
    /** Тянет JSON с сети. Бросает при ошибке/невалидной структуре. */
    const cacheBuster = Math.floor(Date.now() / 3600000); // меняется раз в час
    const url = jsonUrl + (jsonUrl.includes("?") ? "&" : "?") + "v=" + cacheBuster;
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!isValidData(data)) throw new Error("Invalid JSON shape");
    return data;
  }

  function renderWidget(container, data, ds) {
    /** Идемпотентный рендер — может вызываться несколько раз. Безопасный. */
    try {
      const limit = parseInt(ds.limit || "", 10) || DEFAULT_LIMIT;
      let brand = ds.brand || "";
      let model = ds.model || "";

      if ((!brand || !model) && (ds.auto === "url" || (!brand && !model))) {
        const guessed = pickFromUrl(data.meta);
        if (!brand) brand = guessed.brand;
        if (!model) model = guessed.model;
      }

      const { pool, scope } = selectPool(data, brand, model, limit);
      const sourceUrl = ds.sourceUrl || data.meta.source_url || "https://www.avito.ru";

      container.className = container.className.replace(/\baw-(widget|loading)\S*/g, "").trim();
      container.classList.add("aw-widget", "aw-widget--" + scope);
      container.dataset.scope = scope;
      if (brand) container.dataset.activeBrand = brand;
      if (model) container.dataset.activeModel = model;

      container.innerHTML = `
        ${renderHeader(data.meta)}
        <div class="aw-body">
          ${renderSummaryCard(data.meta, sourceUrl)}
          ${renderCarousel(pool)}
        </div>
      `;
      attachCarousel(container);
      attachExpandable(container);
      return true;
    } catch (e) {
      console.warn("[avito-widget] render error", e);
      return false;
    }
  }

  async function init(container) {
    /** Stale-while-revalidate:
     *  1. Если в localStorage есть валидные свежие данные (< TTL) — рендерим из них,
     *     в сеть не ходим. Это решает «не парсить при каждом открытии страницы».
     *  2. Если данные устарели — рендерим что есть, в фоне обновляем.
     *  3. Если сеть упала — оставляем последнее стабильное состояние из кэша.
     *  4. Только если ВООБЩЕ нет данных (первый визит + сеть не работает) — показываем ошибку.
     */
    const ds = container.dataset;
    const jsonUrl = ds.source || DEFAULT_DATA_URL;
    const cacheTTL = parseInt(ds.cacheTtl || "", 10) > 0
      ? parseInt(ds.cacheTtl, 10) * 1000
      : DEFAULT_CACHE_TTL_MS;

    // 1. Пытаемся показать из localStorage
    const cached = loadFromCache(jsonUrl);
    let renderedFromCache = false;
    if (cached) {
      renderedFromCache = renderWidget(container, cached.data, ds);
    } else {
      container.classList.add("aw-loading");
      container.innerHTML = '<div class="aw-status">Загружаем отзывы…</div>';
    }

    // 2. Если кэш свежий (моложе TTL) и рендер успешен — в сеть не идём
    if (cached && cached.age < cacheTTL && renderedFromCache) {
      return;
    }

    // 3. Идём за свежим JSON
    try {
      const fresh = await fetchFresh(jsonUrl);
      saveToCache(jsonUrl, fresh);
      renderWidget(container, fresh, ds);
    } catch (e) {
      console.warn("[avito-widget] fetch failed", e);
      // Если уже отрендерили из кэша — оставляем как есть (антихрупкость)
      if (renderedFromCache) return;
      // Пробуем подобрать ХОТЬ КАКИЕ-то данные из кэша (даже без TTL-проверки)
      if (cached && renderWidget(container, cached.data, ds)) return;
      // Совсем пусто — единственный случай, когда показываем ошибку
      container.classList.remove("aw-loading");
      container.innerHTML = '<div class="aw-status aw-status--error">Не удалось загрузить отзывы. Попробуйте позже.</div>';
    }
  }

  function autoInit() {
    const nodes = document.querySelectorAll("#avito-reviews-widget, [data-avito-widget]");
    nodes.forEach(el => init(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }

  // Экспортируем для ручной инициализации (если auto не подходит)
  window.AvitoReviewsWidget = { init };
})();
