# LiveTrains

New Malden ⇄ London Waterloo arasında canlı tren kalkış tahtası.

Uygulama açıldığında New Malden'dan Waterloo'ya giden trenleri gösterir.
Üstteki düğmeye basınca Waterloo'dan New Malden'a giden trenlere (platform
ve saat bilgisiyle) geçer. Liste 30 saniyede bir otomatik yenilenir.

Veri kaynağı: [Huxley2](https://huxley2.azurewebsites.net), National
Rail'in ücretsiz, anahtar gerektirmeyen proxy'si.

## Çalıştırma

```bash
npm install
npm start
```

Sonra tarayıcıda `http://localhost:3000` adresini aç.

## GitHub Pages ile yayınlama

`docs/` klasörü sunucusuz (backend'siz) çalışan statik bir kopyayı içerir.
GitHub'ın web arayüzünden yayınlamak için:

1. GitHub'da bu deponun sayfasına git.
2. **Settings** &rarr; sol menüden **Pages**'e tıkla.
3. **Build and deployment** altında **Source** olarak **Deploy from a branch**'i seç.
4. **Branch** kısmında `main` branch'ini ve klasör olarak `/docs`'u seç, **Save**'e bas.
5. Birkaç dakika içinde sayfa `https://<kullanıcı-adın>.github.io/LiveTrains/` adresinde yayınlanır (adres, Pages ekranının üstünde de gösterilir).

## Canlı veri nasıl güncelleniyor

GitHub Pages sadece statik dosya sunduğu için sayfanın kendisi hiçbir canlı
API'ye istek atmaz. Bunun yerine bir **GitHub Actions** iş akışı
(`.github/workflows/update-departures.yml`) her 5 dakikada bir çalışıp
Huxley2'den veri çekip `docs/data/departures.json` dosyasını günceller;
sayfa da sadece bu dosyayı okur. Huxley2 anahtar gerektirmediği için bu
otomatik iş akışı hiçbir gizli bilgiye ihtiyaç duymuyor.

Huxley2 o an geçici olarak yanıt vermezse (ücretsiz demo servisinin kendi
belirttiği bir risk), sistem birkaç kez tekrar dener; yine olmazsa mevcut
veri korunur, bir dahaki 5 dakikalık çalıştırmada tekrar denenir. Hatalar
`docs/data/errors.txt` dosyasına (zaman damgasıyla) yazılır, bu adrese
tarayıcından doğrudan bakabilirsin: `https://<kullanıcı-adın>.github.io/LiveTrains/data/errors.txt`.

`server.js` (yerelde `npm start` ile çalışan sürüm) isteğe bağlı olarak
`TRANSPORTAPI_APP_ID` / `TRANSPORTAPI_APP_KEY` ortam değişkenleri
tanımlanırsa Huxley2 başarısız olduğunda TransportAPI'ye düşebiliyor, ama
bu sadece yerel/manuel kullanım için, otomatik GitHub Actions akışında
**kullanılmıyor** (TransportAPI'nin ücretsiz planı günde sadece 30 istekle
sınırlı, günde 288 kez çalışan bir otomasyon için uygun değil).
