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
