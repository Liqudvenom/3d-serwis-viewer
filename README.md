# 3D Serwis

Interaktywna aplikacja Next.js do prezentacji modelu 3D przed i po naprawie. Viewer korzysta z Babylon.js,
pozwala przełączać wariant uszkodzony/naprawiony i pokazuje panel `Quality Report`.

## Wymagania

- Node.js 18.17 lub nowszy
- npm

## Instalacja

```bash
npm install
```

## Uruchomienie lokalne

```bash
npm run dev
```

Aplikacja będzie dostępna pod adresem pokazanym przez Next.js, zwykle `http://localhost:3000`.

## Modele 3D

Modele pochodzą z archiwum `panzerjager-i.zip` (Panzerjäger I, World of Tanks asset pack).

| Plik | Źródło | Opis |
|------|--------|------|
| `public/models/damaged.glb` | `source/G21_PanzerJager_I.glb` | Model uszkodzony (oryginał z ZIP) |
| `public/models/fixed.glb` | ten sam plik | **Placeholder** — kopia `damaged.glb` do czasu przygotowania wersji „naprawionej” |

Oba warianty to obecnie **ten sam plik** (~15,3 MB). GLB zawiera osadzone tekstury PBR (base color, normal, RMAO); osobne pliki PNG z folderu `textures/` nie są wymagane przez viewer.

Jeśli plików brakuje, aplikacja nadal się uruchomi, a komponent pokaże komunikat błędu ładowania modelu.

### Dodawanie modeli lokalnie

Jeśli katalog `public/models/` jest pusty (np. po klonowaniu repozytorium bez binariów), rozpakuj `panzerjager-i.zip` i skopiuj:

```bash
copy source\G21_PanzerJager_I.glb public\models\damaged.glb
copy source\G21_PanzerJager_I.glb public\models\fixed.glb
```

## Build produkcyjny

```bash
npm run build
npm run start
```
