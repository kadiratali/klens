# klens Yol Haritası

## Faz 0 — Dayanıklı Inspector Temeli ✅ (2026-07-05)

Salt-okunur inspector + dayanıklılık katmanı. Detay: README.md.
Session yönetimi, screenshot/source endpoint'leri, health-check, crash detection,
exponential backoff'lu auto-reconnect, race condition guard, incremental diff,
React arayüzü (en-küçük-alan hit testing, çakışan aday listesi).

## Faz 1 — Etkileşimli Canlı Inspector (Android odaklı)

**Tema:** "bak"tan "dokun"a. Ana kullanım: manuel keşif/debug.
iOS kodu (parse/ölçekleme) korunur ama bu fazda doğrulanmaz.

### Milestone 1 — Etkileşim ✅

Backend (`/api/action/*`):
- `tap` — koordinata veya seçili elemente (bounds merkezine) W3C pointer actions ile
- `longpress` — basılı tutma süresi parametreli
- `swipe` — başlangıç/bitiş noktası + süre (drag jesti)
- `type` — seçili elemente sendKeys; `clear` desteğiyle
- `key` — Android donanım tuşları: back / home / recents (keycode 4, 3, 187)

Frontend:
- **Inspect / Interact mod anahtarı** (klavye kısayoluyla): Inspect'te tık = node seç;
  Interact'ta tık = cihaza gerçek tap, sürükleme = swipe
- Donanım tuşu butonları (header'da)
- Detay panelinde seçili elemente text gönderme alanı
- Her aksiyondan sonra otomatik `inspect?since` — diff altyapısı sayesinde aksiyonlar
  arası geçiş hızlı

Kabul kriteri: emülatörde bir uygulamada login akışı (alan doldur, buton tapla,
geri tuşu) yalnızca klens arayüzünden yürütülebilmeli; her adımda görüntü ve tree
kendiliğinden güncellenmeli.

### Milestone 2 — Canlı Mod ✅

- Otomatik polling toggle'ı: ~1.5 sn'de bir `inspect?since` (unchanged ise render yok,
  bant genişliği ~sıfır)
- Adaptif tempo: ekran uzun süre değişmiyorsa aralık uzar; etkileşim anında sıklaşır
- Aksiyon sırasında polling duraklatılır (çakışan istek yok)
- Header'da "live" göstergesi; race guard tutarsızlık uyarısı canlı modda da çalışır

Kabul kriteri: canlı mod açıkken emülatörde elle gezinirken klens görüntüsü
kullanıcı müdahalesi olmadan takip etmeli; ekran sabitken ağ trafiği unchanged
yanıtlarından ibaret olmalı.

### Milestone 3 — Locator Üretimi + Arama ✅

Backend:
- `GET /api/locators?path=` — seçili element için öneriler: accessibility-id
  (content-desc), resource-id, text, class+instance, optimize edilmiş kısa XPath
  (mutlak path değil). Her öneri için mevcut snapshot üzerinde **eşleşme sayısı**
  (cihaza gitmeden hesaplanır; 1 = benzersiz)
- `POST /api/search` — strateji (text / resource-id / xpath) + sorgu → eşleşen path listesi

Frontend:
- Tree panelinde arama çubuğu; eşleşmeler tree'de işaretlenir + screenshot'ta tüm
  rect'ler highlight edilir
- Detay panelinde "Suggested locators" tablosu: benzersizlik rozeti + tek tıkla kopyalama
- Tek satırlık kod snippet'i kopyalama (Java / Python / JS client)

Kabul kriteri: herhangi bir element seçildiğinde en az bir benzersiz locator önerisi
sunulmalı; XPath araması sonuçları screenshot üzerinde gösterilmeli.

### Faz 1 kapsam dışı (Faz 2+ backlog)

- Aksiyon kaydı → test kodu üretme (recorder)
- MJPEG / video stream (canlı mod polling yerine gerçek akış)
- Çoklu cihaz/session sekmeleri
- iOS simülatör/cihaz doğrulaması (class chain / predicate önerileri dahil)
- Tree filtreleme presetleri (yalnız clickable, yalnız görünür vb.)

## Faz 2 — Locator Kalitesi

**Tema:** M3'ün ürettiği adayları derinleştirmek — "hangi locator dayanıklı, neden."
Chroma/embedding/TF-IDF fikirleri değerlendirildi ve kanıtlanmamış ihtiyaç
oldukları için backlog'a alındı (bkz. altta); somut bir kullanım ortaya
çıkmadan eklenmeyecek.

### Milestone 1 — Robustluk skoru ✅

Tamamen deterministik, LLM yok. `server/src/locators.js`'e her locator adayı
için 0-100 puan + etiket (`robust` / `moderate` / `fragile`) + gerekçe listesi:
- resource-id: anlamlı isim mi yoksa derleyici tarafından üretilmiş hash/generic
  isim mi (`view7f0a013c`, `widget4` gibi desenler cezalandırılır)
- text: sayısal/tarih gibi dinamik içerik mi, çok uzun (>40 karakter, muhtemelen
  kullanıcı verisi) mi, değilse de lokalizasyon riski notu
- class-instance: aynı sınıftan kaç eleman var (fazlaysa sıralama/koşullu
  render riski daha yüksek, puan orantılı düşer)
- xpath: hangi temele oturuyor (resource-id / content-desc / text / benzersiz
  ata + göreli path / mutlak path) — mutlak path her zaman en düşük puan
- ayrıca: şu an benzersiz eşleşmiyorsa (`matches !== 1`) skor 20'yle sınırlanır
  (uniqueness ile robustluk ayrı eksenler ama biri sıfırsa diğeri anlamsızlaşır)

`suggestLocators` çıktısı artık önce benzersizliğe, sonra robustluk puanına göre
sıralanıyor — en iyi öneri her zaman ilk sırada. Frontend'de detay panelinde
renkli rozet (yeşil/sarı/kırmızı) + hover'da gerekçe listesi.

Kabul kriteri: anlamlı bir resource-id her zaman `robust` (≥70) çıkmalı;
otomatik üretilmiş id, dinamik text veya index-tabanlı locator `moderate`/
`fragile` olarak işaretlenmeli. Doğrulandı (mock + gerçek emülatör, Chrome
ikonu: accessibility-id/xpath 85 robust, class-instance 23 fragile).

### Milestone 2 — Opt-in LLM analizi (planlandı, henüz başlanmadı)

Otomatik değil — kullanıcı "Ask AI" gibi bir aksiyonla tetikler (maliyet/gecikme
nedeniyle her seçimde çağrılmaz). Girdi: seçili elementin attrs'ı + M1'in ürettiği
adaylar/puanlar + 1-2 seviye ata/kardeş bağlamı. Çıktı: hangi locator'ı seç,
neden, ve kural motorunun göremediği riskler (ör. "şu an unique ama üstünde
koşullu render olan bir banner var, görünürse index kayar", ya da framework'e
özgü otomatik-isim deseni tanıma). Kural motorunun ürettiği adaylardan seçim
yapıyor, sıfırdan XPath üretmiyor — halüsinasyon riskini azaltır.

Netleşmesi gereken: Anthropic API key nasıl sağlanacak (env var), maliyet kabul
edilebilir mi. İmplementasyona geçilince `claude-api` referans skill'i kullanılacak.

### Faz 2 kapsam dışı / backlog (kanıtlanmamış ihtiyaç)

- **Chroma + embedding ile locator geçmişi**: "farklı ekrandaki benzer elemente
  geçmiş öneriyi getir" gibi somut bir istek/şikayet çıkarsa değerlendirilir.
  Projede henüz hiç kalıcı depolama yok — bu eklenirse ilk persistence katmanı
  olur, hafife alınacak bir karar değil.
- **TF-IDF ön filtre**: yukarıdakinin var olduğu varsayımına dayanıyor. Asıl
  çözülmek istenen problem ("aynı elemente tekrar tekrar LLM'e sormamak")
  benzerlik araması değil, basit bir imza-tabanlı (tag+attrs+ata zinciri hash)
  cache ile çözülür — TF-IDF/embedding gerekmez.

## Masaüstü — Electron kabuğu

**Tema:** klens'i Appium Inspector gibi kurulup açılan bir masaüstü uygulamasına
dönüştürmek. Backend Node/Express olduğu için mevcut server ve React arayüzü
değiştirilmeden Electron kabuğunun içine alınır. Web (tarayıcı) sürümü korunur —
aynı build her iki hedefte de çalışır.

### Milestone 1 — Çalışan kabuk ✅

- Yeni `desktop/` workspace: `main.js` + `preload.js` (bkz. README "Masaüstü").
- Dev'de Electron penceresi Vite dev URL'ini yükler (HMR korunur); `waitForUrl`
  ile başlangıç yarışı önlenir. `npm run dev:desktop` ile açılır.
- Native menü + Cmd/Ctrl+I / Cmd/Ctrl+L kısayolları IPC (`menu-action`) ile mevcut
  `setMode`/`setLive` toggle'larına bağlanır; tarayıcıda no-op.
- Paketli çalışma için server'ı `ELECTRON_RUN_AS_NODE` ile başlatan kod yolu hazır.

Kabul kriteri: `npm run dev:desktop` masaüstü penceresini açmalı, arayüz web
sürümüyle birebir aynı çalışmalı; menü kısayolları modu/canlı modu değiştirmeli;
`npm run dev` (tarayıcı) regresyonsuz çalışmaya devam etmeli.

### Milestone 2 — Paketleme + indirme linki ✅

- `esbuild` ile server tek dosyaya (`desktop/build/server.cjs`) bundle'lanır;
  `web/dist` ile birlikte `extraResources` olarak gömülür (paketli app'te ayrı
  Node/`node_modules` gerekmez). Server `KLENS_DIST_DIR` env'iyle gömülü frontend'i
  bulur.
- electron-builder config (`desktop/package.json` → `build`): macOS `.dmg`
  (universal) + Windows `.exe` (NSIS). `npm run dist` yerelde üretir.
- GitHub Actions (`.github/workflows/release.yml`): `v*` tag push'unda mac + win
  runner'larında build edip GitHub Releases'e publish eder → kalıcı indirme linki.
- Doğrulama: arm64 `.dmg` yerelde üretildi; paketli `.app` çift tıkla açılıp gömülü
  server'ı (`ELECTRON_RUN_AS_NODE` → `server.cjs`) başlattı, gömülü `web-dist`'i
  servis etti, kapanışta server child temizlendi.

Kapsam dışı (sonraki): kod imzalama (Apple Developer ID + Windows sertifikası),
uygulama ikonu/marka görselleri, otomatik güncelleme (auto-update).

## Faz 3 — Cross-Version Diffing (planlandı, henüz başlanmadı)

**Tema:** İki farklı build'in XML dump'larını karşılaştırıp kırılan locator'ları
tespit etmek ve "muhtemelen şu elemente dönüştü" önerisi sunmak. Henüz kapsam
netleştirilmedi — detaylar tartışılacak.

### Çalışma şekli

Her milestone ayrı branch + PR olarak ilerler (`faz1/m1-interaction`,
`faz1/m2-live-mode`, `faz1/m3-locators`, `faz2/m1-robustness-score`, ...);
commit'ler İngilizce.
