# LiveTrains

New Malden ⇄ London Waterloo arasında canlı tren kalkış tahtası.

Uygulama açıldığında New Malden'dan Waterloo'ya giden trenleri gösterir.
Üstteki düğmeye basınca Waterloo'dan New Malden'a giden trenlere (platform
ve saat bilgisiyle) geçer. Liste 30 saniyede bir otomatik yenilenir.

Veri kaynağı: önce [Huxley2](https://huxley2.azurewebsites.net) (National
Rail'in ücretsiz, anahtar gerektirmeyen proxy'si) denenir, çalışmazsa
[TransportAPI](https://developer.transportapi.com) hesabına düşer.

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

## Canlı veri nasıl güncelleniyor (anahtarları gizli tutarak)

GitHub Pages sadece statik dosya sunduğu için sayfanın kendisi hiçbir API
anahtarı taşımaz. Bunun yerine bir **GitHub Actions** iş akışı
(`.github/workflows/update-departures.yml`) her 5 dakikada bir çalışıp
`docs/data/departures.json` dosyasını günceller; sayfa da sadece bu dosyayı
okur. TransportAPI anahtarı yalnızca Actions'ın kendi ortamında, gizli
(secret) olarak tutulur ve siteye hiç sızmaz.

Kurmak için:

1. [developer.transportapi.com/signup](https://developer.transportapi.com/signup) adresinden ücretsiz kaydol, **My apps** sayfasından `app_id` ve `app_key` değerlerini al.
2. Depoda **Settings** &rarr; sol menüden **Secrets and variables** &rarr; **Actions**'a git.
3. **New repository secret** ile şu iki secret'ı ekle:
   - `TRANSPORTAPI_APP_ID`
   - `TRANSPORTAPI_APP_KEY`
4. **Actions** sekmesinden **Update live departures** iş akışını bul, **Run workflow** ile bir kez elle çalıştır (ilk veri hemen oluşsun diye).

Bundan sonra veri kendiliğinden her 5 dakikada bir tazelenir.
