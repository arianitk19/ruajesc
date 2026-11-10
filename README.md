# Screenshot Organizer

Organizo, kërko dhe ruaj screenshot-et direkt në shfletues — me pamje dhe ndjesi aplikacioni iOS.
Organize, search and back up your screenshots in the browser, with the look and feel of a native iOS app.

- **OCR në pajisje** (shqip + anglisht) me Tesseract.js — asgjë nuk largohet nga pajisja.
- **Kërkim i menjëhershëm** pa theks (`ë` = `e`, `ç` = `c`), etiketa, koleksione, kategori automatike.
- **Duplikate** identike dhe të ngjashme (SHA-256 + pHash).
- **Kopje rezervë** ZIP / JSON / CSV dhe rikthim.
- **PWA**: instalohet në iPhone (Safari → Ndaj → Shto në ekranin kryesor), Android dhe kompjuter; punon offline.
- **Dizajn iOS**: SF Pro, ngjyrat e sistemit, shiriti lundrues i skedave, fletë (sheets) me grabber, temë e çelët/e errët.

## Zhvillimi

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # dist/
npm run preview
```

Kërkon Node 20+. Detajet teknike janë te [`docs/`](docs/ARCHITECTURE.md).
