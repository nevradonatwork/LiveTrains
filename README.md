# LiveTrains

New Malden ⇄ London Waterloo arasında canlı tren kalkış tahtası.

Uygulama açıldığında New Malden'dan Waterloo'ya giden trenleri gösterir.
Üstteki düğmeye basınca Waterloo'dan New Malden'a giden trenlere (platform
ve saat bilgisiyle) geçer. Liste 30 saniyede bir otomatik yenilenir.

Veri kaynağı: [Huxley2](https://huxley2.azurewebsites.net), National Rail'in
canlı kalkış tahtası servisinin ücretsiz, API anahtarı gerektirmeyen bir
proxy'si.

## Çalıştırma

```bash
npm install
npm start
```

Sonra tarayıcıda `http://localhost:3000` adresini aç.

## GitHub Pages ile yayınlama

`docs/` klasörü, sunucusuz (backend'siz) çalışan, canlı veriyi doğrudan
tarayıcıdan Huxley2'ye bağlanarak çeken statik bir kopyayı içerir. GitHub'ın
web arayüzünden yayınlamak için:

1. GitHub'da bu deponun sayfasına git.
2. **Settings** &rarr; sol menüden **Pages**'e tıkla.
3. **Build and deployment** altında **Source** olarak **Deploy from a branch**'i seç.
4. **Branch** kısmında `main` branch'ini ve klasör olarak `/docs`'u seç, **Save**'e bas.
5. Birkaç dakika içinde sayfa `https://<kullanıcı-adın>.github.io/LiveTrains/` adresinde yayınlanır (adres, Pages ekranının üstünde de gösterilir).
