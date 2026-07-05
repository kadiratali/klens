# klens — Mobile Inspector

Appium tabanlı mobil UI inspector. Faz 1: Appium Inspector paritesi + daha iyi element eşleştirme.

## Mimari

- **server/** — Node.js + Express (port 3100). Appium server'a W3C REST ile proxy yapar (WebdriverIO'suz):
  - `GET /api/inspect?since=<v>` → tek çağrıda screenshot (Base64) + hierarchy. Race guard'lı çekim
    (source → [screenshot ∥ source], hash eşleşmezse 3 deneme, sonra `consistent: false`).
    `since` istemcinin elindeki versiyonsa yalnızca **diff** döner (`added/removed/changed`),
    hierarchy hiç değişmediyse `unchanged: true`.
  - `GET /api/health` → session sağlık durumu (`ok | degraded | reconnecting | dead`), 4 sn'de bir
    `window/rect` ping'i. Session ölünce (UiAutomator2/WDA crash, session-dead) exponential backoff
    ile (1s→30s, en çok 8 deneme) aynı capabilities'le otomatik yeni session açılır; diff tabanı ve
    istemci state'i korunur.
  - `GET /api/screenshot`, `GET /api/source` — tekil endpoint'ler (parite).
  - `GET /api/sessions`, `POST /api/session`, `POST /api/session/attach` (attach öncesi doğrulama
    ping'i), `DELETE /api/session`, `POST /api/appium-url`.
  - Hatalar sınıflandırılır (`server/src/errors.js`): ham driver mesajı yerine anlamlı açıklama +
    stabil kod (`uia2-crash`, `wda-crash`, `session-dead`, `appium-unreachable`).
  - `POST /api/action/*` — etkileşim (Faz 1 / M1): `tap` ve `longpress` (koordinat veya element
    `path`'i — merkez snapshot'tan hesaplanır), `swipe` (from/to + süre, W3C pointer actions),
    `type` (XPath ile element bulup sendKeys, opsiyonel `clear`), `key` (back/home/recents).
- **web/** — Vite + React (dev: 5173, `/api` → 3100 proxy; `vite build` sonrası backend `web/dist`'i
  3100'den servis eder — tek port yeter). Screenshot + XML tree + element detay panelleri; header'da
  canlı sağlık göstergesi, reconnect/tutarsızlık uyarı barları. Node kimliği XPath olduğundan seçim
  refresh'ler arası korunur.
  - **Inspect / Interact modu** (`i` tuşuyla geçiş): Inspect'te tık element seçer; Interact'ta tık
    cihaza gerçek tap gönderir, sürükleme swipe olur, 600 ms+ basılı tutma long-press. Header'da
    back/home/recents tuşları; detay panelinde "Tap element" ve text yazma (Type / Clear & type).
    Her aksiyondan sonra görünüm otomatik tazelenir (diff ile).

## Çalıştırma

```sh
npm install
npm run dev        # server + web birlikte
```

Sonra `http://localhost:5173` → Appium URL'ini gir → **List sessions** → **Attach** (veya **New session…** ile capabilities JSON'u vererek yeni session aç) → **Refresh**.

Ortam değişkenleri: `APPIUM_URL` (varsayılan `http://127.0.0.1:4723`), `PORT` (backend, varsayılan 3100).

## Appium Inspector'dan farklar

- Tıklama eşleştirmesi en derin DFS node yerine **en küçük bounding box alanına** göre yapılır (overlay ve tam ekran container'larda çok daha isabetli).
- Aynı noktadaki **tüm çakışan adaylar** listelenir; detay panelindeki chip'lerle aralarında geçiş yapılır.
- `displayed="false"` / `visible="false"` elementler hit-test'ten elenir (tree'de görünmeye devam eder).
- Hover'da canlı highlight; tree ↔ screenshot seçimi iki yönlü senkron.

## Koordinat uzayları

- Android (uiautomator2): `bounds="[x1,y1][x2,y2]"` piksel cinsinden — screenshot pikselleriyle birebir.
- iOS (XCUITest): `x/y/width/height` point cinsinden; screenshot piksel olduğundan ölçekleme, hiyerarşinin toplam bounding box'ı (`boundsSpace`) üzerinden yüzdesel yapılır.
