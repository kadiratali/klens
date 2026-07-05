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

### Çalışma şekli

Her milestone ayrı branch + PR olarak ilerler (`faz1/m1-interaction`,
`faz1/m2-live-mode`, `faz1/m3-locators`); commit'ler İngilizce.
