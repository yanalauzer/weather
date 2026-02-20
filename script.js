// конфигурация приложения
const CONFIG = {
  apiBaseUrl: "https://api.openweathermap.org/data/2.5",
  geocodingUrl: "https://api.openweathermap.org/geo/1.0/direct",
  reverseGeocodingUrl: "https://api.openweathermap.org/geo/1.0/reverse",
  apiKey: "cae189cf346108d22e9f6dfd7ebe7200",

  units: "metric",
  lang: "ru",

  limit: 5,
  forecastDays: 5,

  suggestionsLimit: 5,
  debounceDelay: 350,
  minQueryLength: 2,

  miniForecastDays: 2,
};

// ключи localStorage
const STORAGE_KEYS = {
  main: "lastCityInput",
  extra1: "extraCity1",
  extra2: "extraCity2",
  recentCities: "recentCities",
};

// ссылки на элементы
const dom = {
  cityInput: document.getElementById("city-input"),
  searchButton: document.getElementById("search-button"),
  refreshButton: document.getElementById("refresh-button"),
  suggestions: document.getElementById("search-suggestions"),

  summaryTemp: document.getElementById("search-summary-temp"),
  summaryCity: document.getElementById("search-summary-city"),

  currentCity: document.getElementById("current-city"),
  currentUpdated: document.getElementById("current-updated"),
  currentTemp: document.getElementById("current-temp"),
  currentDesc: document.getElementById("current-desc"),
  currentFeels: document.getElementById("current-feels"),
  currentHumidity: document.getElementById("current-humidity"),
  currentWind: document.getElementById("current-wind"),
  currentPressure: document.getElementById("current-pressure"),
  currentVisibility: document.getElementById("current-visibility"),
  forecastList: document.getElementById("forecast-list"),

  extra1Input: document.getElementById("city-extra-1"),
  extra2Input: document.getElementById("city-extra-2"),
  extra1Button: document.getElementById("search-extra-1"),
  extra2Button: document.getElementById("search-extra-2"),
  extraPanel1: document.getElementById("extra-panel-1"),
  extraPanel2: document.getElementById("extra-panel-2"),

  extra1Suggestions: document.getElementById("search-suggestions-extra-1"),
  extra2Suggestions: document.getElementById("search-suggestions-extra-2"),


  error: document.getElementById("app-error"),
  loader: document.getElementById("app-loader"),
};

// состояние приложения
const state = {
  currentCity: "",
  lastQuery: "",
  recentCities: [],
  debounceTimer: null,
};

// ===== утилиты UI =====

function setLoaderVisible(isVisible) {
  if (!dom.loader) return;
  dom.loader.classList.toggle("app-loader--visible", isVisible);
}

function showError(message) {
  if (!dom.error) return;
  dom.error.textContent = message;
  dom.error.classList.add("app-error--visible");
}

function clearError() {
  if (!dom.error) return;
  dom.error.textContent = "";
  dom.error.classList.remove("app-error--visible");
}

function debounce(fn, delay) {
  return function debounced(...args) {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => fn(...args), delay);
  };
}

function formatDateTime(timestampSeconds) {
  const options = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
  return new Date(timestampSeconds * 1000).toLocaleString("ru-RU", options);
}

function formatDay(timestampSeconds) {
  const options = { weekday: "short", day: "2-digit", month: "short" };
  return new Date(timestampSeconds * 1000).toLocaleDateString("ru-RU", options);
}

// ===== localStorage (недавние города) =====

function loadRecentCities() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.recentCities);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) state.recentCities = parsed;
  } catch {
    state.recentCities = [];
  }
}

function saveRecentCity(cityName) {
  const normalized = (cityName || "").trim();
  if (!normalized) return;

  const withoutCurrent = state.recentCities.filter(
    (item) => item.toLowerCase() !== normalized.toLowerCase()
  );
  state.recentCities = [normalized, ...withoutCurrent].slice(0, CONFIG.suggestionsLimit);

  localStorage.setItem(STORAGE_KEYS.recentCities, JSON.stringify(state.recentCities));
}

// ===== API =====

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// текущая погода по названию (как источник координат)
async function getCityCoordinates(cityName) {
  const trimmed = (cityName || "").trim();
  if (!trimmed) return null;

  // ВАЖНО: для автопоиска и ручного поиска используем один и тот же путь
  const url = `${CONFIG.apiBaseUrl}/weather?q=${encodeURIComponent(trimmed)}&appid=${CONFIG.apiKey}&lang=${CONFIG.lang}&units=${CONFIG.units}`;
  const data = await fetchJson(url);

  return {
    lat: data.coord.lat,
    lon: data.coord.lon,
    name: data.name,
    country: data.sys.country,
    rawCurrent: data,
  };
}

// reverse geocoding: имя города по координатам
async function getCityNameByCoords(lat, lon) {
  const url = `${CONFIG.reverseGeocodingUrl}?lat=${lat}&lon=${lon}&limit=1&appid=${CONFIG.apiKey}`;
  const data = await fetchJson(url);
  const first = Array.isArray(data) ? data[0] : null;
  return first?.local_names?.ru || first?.name || "Текущее местоположение";
}

// прогноз
async function getForecast(lat, lon) {
  const url = `${CONFIG.apiBaseUrl}/forecast?lat=${lat}&lon=${lon}&appid=${CONFIG.apiKey}&lang=${CONFIG.lang}&units=${CONFIG.units}`;
  return fetchJson(url);
}

// ===== основной рендер =====

function resetCurrentView() {
  if (!dom.currentCity) return;

  dom.currentCity.textContent = "Выберите город";
  dom.currentUpdated.textContent = "";
  dom.currentTemp.textContent = "--°C";
  dom.currentDesc.textContent = "Нет данных";
  dom.currentFeels.textContent = "Ощущается как: --°C";
  dom.currentHumidity.textContent = "--%";
  dom.currentWind.textContent = "-- м/с";
  dom.currentPressure.textContent = "-- гПа";
  dom.currentVisibility.textContent = "-- км";

  if (dom.summaryTemp) dom.summaryTemp.textContent = "--°C";
  if (dom.summaryCity) dom.summaryCity.textContent = "Город не выбран";
}

function renderCurrent(cityInfo, currentData) {
  const { name, country } = cityInfo;

  const main = currentData.main;
  const weather = currentData.weather && currentData.weather[0];
  const wind = currentData.wind || {};
  const visibilityMeters = currentData.visibility ?? null;

  dom.currentCity.textContent = `${name}, ${country}`;
  dom.currentUpdated.textContent = `Обновлено: ${formatDateTime(currentData.dt)}`;

  const temp = Math.round(main.temp);
  const feels = Math.round(main.feels_like);

  dom.currentTemp.textContent = `${temp}°C`;
  dom.currentDesc.textContent = weather ? weather.description : "Нет данных";
  dom.currentFeels.textContent = `Ощущается как: ${feels}°C`;
  dom.currentHumidity.textContent = `${main.humidity}%`;
  dom.currentWind.textContent = `${wind.speed ?? 0} м/с`;
  dom.currentPressure.textContent = `${main.pressure} гПа`;

  if (typeof visibilityMeters === "number") {
    dom.currentVisibility.textContent = `${(visibilityMeters / 1000).toFixed(1)} км`;
  } else {
    dom.currentVisibility.textContent = "-- км";
  }

  if (dom.summaryTemp) dom.summaryTemp.textContent = `${temp}°C`;
  if (dom.summaryCity) dom.summaryCity.textContent = `${name}, ${country}`;
}

function clearForecast() {
  if (!dom.forecastList) return;
  while (dom.forecastList.firstChild) dom.forecastList.removeChild(dom.forecastList.firstChild);
}

function renderForecast(forecastData) {
  if (!dom.forecastList || !forecastData || !forecastData.list) return;

  clearForecast();

  const byDay = new Map();
  forecastData.list.forEach((item) => {
    const dateKey = new Date(item.dt * 1000).toISOString().slice(0, 10);
    if (!byDay.has(dateKey)) byDay.set(dateKey, []);
    byDay.get(dateKey).push(item);
  });

  const days = Array.from(byDay.entries()).slice(0, CONFIG.forecastDays);
  days.forEach(([_, items]) => {
    const temps = items.map((entry) => entry.main.temp);
    const avgTemp = temps.reduce((acc, value) => acc + value, 0) / temps.length;

    const first = items[0];
    const weather = first.weather && first.weather[0];

    const card = document.createElement("article");
    card.className = "forecast-item";

    const dateEl = document.createElement("p");
    dateEl.className = "forecast-item__date";
    dateEl.textContent = formatDay(first.dt);

    const tempEl = document.createElement("p");
    tempEl.className = "forecast-item__temp";
    tempEl.textContent = `${Math.round(avgTemp)}°C`;

    const descEl = document.createElement("p");
    descEl.className = "forecast-item__desc";
    descEl.textContent = weather ? weather.description : "";

    card.appendChild(dateEl);
    card.appendChild(tempEl);
    card.appendChild(descEl);

    dom.forecastList.appendChild(card);
  });
}

// ===== подсказки =====

function closeSuggestions() {
  if (!dom.suggestions) return;

  dom.suggestions.classList.remove("search__suggestions--visible");
  while (dom.suggestions.firstChild) dom.suggestions.removeChild(dom.suggestions.firstChild);
}

function openSuggestions(cities) {
  if (!dom.suggestions || !cities || cities.length === 0) {
    closeSuggestions();
    return;
  }

  closeSuggestions();

  cities.forEach((city) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "search__suggestions-item";
    option.textContent = city;

    option.addEventListener("click", () => {
      dom.cityInput.value = city;
      closeSuggestions();
      handleSearch(true);
    });

    dom.suggestions.appendChild(option);
  });

  dom.suggestions.classList.add("search__suggestions--visible");
}

function closeSuggestionsBox(boxEl) {
  if (!boxEl) return;
  boxEl.classList.remove("search__suggestions--visible");
  while (boxEl.firstChild) boxEl.removeChild(boxEl.firstChild);
}

function openSuggestionsInBox(boxEl, inputEl, cities, onPick) {
  if (!boxEl || !cities || cities.length === 0) {
    closeSuggestionsBox(boxEl);
    return;
  }

  closeSuggestionsBox(boxEl);

  cities.forEach((city) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "search__suggestions-item";
    option.textContent = city;

    option.addEventListener("click", () => {
      if (inputEl) inputEl.value = city;
      closeSuggestionsBox(boxEl);
      if (typeof onPick === "function") onPick();
    });

    boxEl.appendChild(option);
  });

  boxEl.classList.add("search__suggestions--visible");
}


const RUSSIAN_CITIES = [
  "Москва",
  "Санкт-Петербург",
  "Новосибирск",
  "Екатеринбург",
  "Казань",
  "Нижний Новгород",
  "Челябинск",
  "Самара",
  "Омск",
  "Ростов-на-Дону",
  "Уфа",
  "Красноярск",
  "Воронеж",
  "Пермь",
  "Волгоград",
  "Краснодар",
  "Саратов",
  "Тюмень",
  "Тольятти",
  "Ижевск",
  "Барнаул",
  "Владимир",
  "Оренбург",
];

async function updateSuggestions(query) {
  const trimmed = (query || "").trim().toLowerCase();

  if (trimmed.length < CONFIG.minQueryLength) {
    closeSuggestions();
    return;
  }

  let suggestions = [];

  const russianMatch = RUSSIAN_CITIES.filter((city) => city.toLowerCase().includes(trimmed));
  suggestions.push(...russianMatch);

  if (suggestions.length < 3) {
    try {
      const url = `${CONFIG.geocodingUrl}?q=${encodeURIComponent(trimmed)}&limit=${CONFIG.limit}&appid=${CONFIG.apiKey}`;
      const apiCities = await fetchJson(url);

      if (Array.isArray(apiCities) && apiCities.length > 0) {
        const apiSuggestions = apiCities.map((city) => {
          const ruName = city.local_names?.ru || city.name;
          return `${ruName}, ${city.country}`;
        });
        suggestions.push(...apiSuggestions);
      }
    } catch {
      // игнорируем ошибку подсказок
    }
  }

  openSuggestions(suggestions.slice(0, CONFIG.suggestionsLimit));
}

async function updateSuggestionsExtra(query, boxEl, inputEl, onPick) {
  const trimmed = (query || "").trim().toLowerCase();

  if (trimmed.length < CONFIG.minQueryLength) {
    closeSuggestionsBox(boxEl);
    return;
  }

  let suggestions = [];

  const russianMatch = RUSSIAN_CITIES.filter((city) =>
    city.toLowerCase().includes(trimmed)
  );
  suggestions.push(...russianMatch);

  if (suggestions.length < 3) {
    try {
      const url = `${CONFIG.geocodingUrl}?q=${encodeURIComponent(trimmed)}&limit=${CONFIG.limit}&appid=${CONFIG.apiKey}`;
      const apiCities = await fetchJson(url);

      if (Array.isArray(apiCities) && apiCities.length > 0) {
        const apiSuggestions = apiCities.map((city) => {
          const ruName = city.local_names?.ru || city.name;
          return `${ruName}, ${city.country}`;
        });
        suggestions.push(...apiSuggestions);
      }
    } catch {
      // игнорируем ошибки подсказок
    }
  }

  openSuggestionsInBox(
    boxEl,
    inputEl,
    suggestions.slice(0, CONFIG.suggestionsLimit),
    onPick
  );
}

const handleInputChange = debounce((event) => {
  updateSuggestions(event.target.value);
}, CONFIG.debounceDelay);

// ===== основной поиск =====

async function handleSearch(force = false) {
  const query = dom.cityInput.value.trim();
  if (!query) {
    showError("Введите название города");
    return;
  }

  const normalizedQuery = query.toLowerCase();
  if (!force && normalizedQuery === state.lastQuery) return;

  clearError();
  setLoaderVisible(true);
  state.lastQuery = normalizedQuery;

  try {
    const cityInfo = await getCityCoordinates(query);
    if (!cityInfo) {
      resetCurrentView();
      showError("Город не найден");
      return;
    }

    const forecast = await getForecast(cityInfo.lat, cityInfo.lon);

    state.currentCity = `${cityInfo.name}, ${cityInfo.country}`;
    saveRecentCity(state.currentCity);

    renderCurrent(cityInfo, cityInfo.rawCurrent);
    renderForecast(forecast);

    localStorage.setItem(STORAGE_KEYS.main, dom.cityInput.value);
  } catch {
    resetCurrentView();
    showError("Не удалось загрузить данные. Попробуйте позже.");
  } finally {
    setLoaderVisible(false);
    if (dom.refreshButton) dom.refreshButton.disabled = false;
  }
}

// ===== погода по координатам (для гео) =====

async function getWeatherByCoords(lat, lon) {
  const currentUrl = `${CONFIG.apiBaseUrl}/weather?lat=${lat}&lon=${lon}&appid=${CONFIG.apiKey}&lang=${CONFIG.lang}&units=${CONFIG.units}`;
  const forecastUrl = `${CONFIG.apiBaseUrl}/forecast?lat=${lat}&lon=${lon}&appid=${CONFIG.apiKey}&lang=${CONFIG.lang}&units=${CONFIG.units}`;

  const rawCurrent = await fetchJson(currentUrl);
  const forecast = await fetchJson(forecastUrl);

  return {
    lat,
    lon,
    name: "Текущее местоположение",
    country: rawCurrent?.sys?.country || "",
    rawCurrent,
    forecast,
  };
}

// геолокация: подставить город и автозапустить handleSearch
async function tryGeolocation() {
  if (!navigator.geolocation) return false;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;

        try {
          // получаем город по координатам
          const cityName = await getCityNameByCoords(latitude, longitude);

          // вставляем город в input и запускаем обычный поиск (единый путь)
          if (dom.cityInput) dom.cityInput.value = cityName;

          localStorage.setItem(STORAGE_KEYS.main, cityName);

          state.lastQuery = "";
          await handleSearch(true);

          resolve(true);
        } catch {
          resolve(false);
        }
      },
      () => resolve(false),
      { timeout: 15000, enableHighAccuracy: true, maximumAge: 60000 }
    );
  });
}

// ===== доп. города (панели) + мини‑прогноз =====

function buildMiniForecast(forecastData, daysCount = 2) {
  if (!forecastData || !Array.isArray(forecastData.list)) return [];

  const byDay = new Map();
  forecastData.list.forEach((item) => {
    const dateKey = new Date(item.dt * 1000).toISOString().slice(0, 10);
    if (!byDay.has(dateKey)) byDay.set(dateKey, []);
    byDay.get(dateKey).push(item);
  });

  const days = Array.from(byDay.entries()).slice(0, daysCount);

  return days.map(([_, items]) => {
    const temps = items.map((x) => x.main.temp);
    const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;

    const first = items[0];
    const desc = first.weather?.[0]?.description || "";

    return {
      dayLabel: formatDay(first.dt),
      temp: Math.round(avgTemp),
      desc,
    };
  });
}

async function loadCityToPanel(cityName, panelEl) {
  if (!panelEl) return;

  const trimmed = (cityName || "").trim();
  if (!trimmed) {
    panelEl.replaceChildren();
    return;
  }

  panelEl.textContent = "Загрузка...";

  try {
    const cityInfo = await getCityCoordinates(trimmed);
    if (!cityInfo || !cityInfo.rawCurrent) {
      panelEl.textContent = "Город не найден";
      return;
    }

    const currentData = cityInfo.rawCurrent;
    const main = currentData.main || {};
    const weather = (currentData.weather && currentData.weather[0]) ? currentData.weather[0] : null;
    const wind = currentData.wind || {};
    const visibilityMeters = (typeof currentData.visibility === "number") ? currentData.visibility : null;

    // Header
    const header = document.createElement("header");
    header.className = "panelheader";

    const title = document.createElement("h2");
    title.className = "paneltitle";
    title.textContent = `${cityInfo.name}, ${cityInfo.country}`;

    header.appendChild(title);

    const mainWrap = document.createElement("div");
    mainWrap.className = "current-main";

    const left = document.createElement("div");
    left.className = "current-mainleft";

    const tempEl = document.createElement("p");
    tempEl.className = "current-maintemp";
    tempEl.textContent = `${Math.round(main.temp ?? 0)}°C`;

    const descEl = document.createElement("p");
    descEl.className = "current-maindesc";
    descEl.textContent = weather?.description || "—";

    const feelsEl = document.createElement("p");
    feelsEl.className = "current-mainfeels";
    feelsEl.textContent = `Ощущается как: ${Math.round(main.feels_like ?? 0)}°C`;

    left.appendChild(tempEl);
    left.appendChild(descEl);
    left.appendChild(feelsEl);

    mainWrap.appendChild(left);

    // Details (как у первой карточки)
    const details = document.createElement("dl");
    details.className = "current-details";

    const makeItem = (label, value) => {
      const item = document.createElement("div");
      item.className = "current-detailsitem";

      const dt = document.createElement("dt");
      dt.textContent = label;

      const dd = document.createElement("dd");
      dd.textContent = value;

      item.appendChild(dt);
      item.appendChild(dd);
      return item;
    };

    details.appendChild(makeItem("Влажность", `${main.humidity ?? "—"}%`));
    details.appendChild(makeItem("Ветер", `${wind.speed ?? "—"} м/с`));
    details.appendChild(makeItem("Давление", `${main.pressure ?? "—"} гПа`));
    details.appendChild(
      makeItem(
        "Видимость",
        visibilityMeters == null ? "— км" : `${(visibilityMeters / 1000).toFixed(1)} км`
      )
    );

    panelEl.replaceChildren(header, mainWrap, details);
  } catch (e) {
    panelEl.textContent = "Ошибка загрузки";
  }
}


async function handleExtraSearch(index) {
  const input = index === 1 ? dom.extra1Input : dom.extra2Input;
  const panel = index === 1 ? dom.extraPanel1 : dom.extraPanel2;
  const key = index === 1 ? STORAGE_KEYS.extra1 : STORAGE_KEYS.extra2;

  if (!input) return;

  const city = input.value.trim();
  if (!city) return;

  localStorage.setItem(key, city);
  await loadCityToPanel(city, panel);
}

// ===== события + init =====

function setupEvents() {
  const hasExtraSuggestionsHelpers =
    typeof closeSuggestionsBox === "function" &&
    typeof updateSuggestionsExtra === "function";

  if (dom.searchButton) {
    dom.searchButton.addEventListener("click", () => {
      closeSuggestions();
      if (hasExtraSuggestionsHelpers) {
        closeSuggestionsBox(dom.extra1Suggestions);
        closeSuggestionsBox(dom.extra2Suggestions);
      }
      handleSearch(false);
    });
  }

  if (dom.refreshButton) {
    dom.refreshButton.addEventListener("click", () => {
      handleSearch(true);
    });
  }

  if (dom.cityInput) {
    dom.cityInput.addEventListener("input", handleInputChange);

    dom.cityInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        closeSuggestions();
        if (hasExtraSuggestionsHelpers) {
          closeSuggestionsBox(dom.extra1Suggestions);
          closeSuggestionsBox(dom.extra2Suggestions);
        }
        handleSearch(true);
      }
    });
  }
  if (dom.extra1Input) {
    dom.extra1Input.addEventListener(
      "input",
      debounce(
        (event) =>
          updateSuggestionsExtra(
            event.target.value,
            dom.extra1Suggestions,
            dom.extra1Input,
            () => handleExtraSearch(1)
          ),
        CONFIG.debounceDelay
      )
    );
  }

  if (dom.extra2Input) {
    dom.extra2Input.addEventListener(
      "input",
      debounce(
        (event) =>
          updateSuggestionsExtra(
            event.target.value,
            dom.extra2Suggestions,
            dom.extra2Input,
            () => handleExtraSearch(2)
          ),
        CONFIG.debounceDelay
      )
    );
  }

  if (dom.extra1Button) dom.extra1Button.addEventListener("click", () => handleExtraSearch(1));
  if (dom.extra2Button) dom.extra2Button.addEventListener("click", () => handleExtraSearch(2));

  document.addEventListener("click", (event) => {
    const insideSearch = event.target.closest(".panel--search");
    if (!insideSearch) {
      closeSuggestions();
      if (hasExtraSuggestionsHelpers) {
        closeSuggestionsBox(dom.extra1Suggestions);
        closeSuggestionsBox(dom.extra2Suggestions);
      }
    }
  });
}


async function init() {
  loadRecentCities();
  resetCurrentView();
  setupEvents();

  // восстановление доп. городов
  const c1 = localStorage.getItem(STORAGE_KEYS.extra1);
  if (c1 && dom.extra1Input) {
    dom.extra1Input.value = c1;
    await loadCityToPanel(c1, dom.extraPanel1);
  }

  const c2 = localStorage.getItem(STORAGE_KEYS.extra2);
  if (c2 && dom.extra2Input) {
    dom.extra2Input.value = c2;
    await loadCityToPanel(c2, dom.extraPanel2);
  }

  // пробуем гео
  const geoSuccess = await tryGeolocation();

  // если гео не сработало — восстановим основной город и загрузим
  if (!geoSuccess) {
    const last = localStorage.getItem(STORAGE_KEYS.main);
    if (last && dom.cityInput) {
      dom.cityInput.value = last;
      state.lastQuery = "";
      await handleSearch(true);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});