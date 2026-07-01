# 3D Serwis

Interaktywna aplikacja Next.js do lokalnego podglądu modeli 3D. Viewer korzysta z Babylon.js,
pozwala wczytać model z folderu użytkownika (bez wysyłania plików na serwer), przełączać widok
z teksturą lub bez oraz pokazuje panel `Quality Report`.

## Wymagania

- Node.js 18.17 lub nowszy
- npm
- Przeglądarka z obsługą `File API` (Chrome, Edge, Firefox)

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

Modele **nie są** dołączone do repozytorium ani zapisywane w `public/models/`. Wczytujesz je lokalnie:

1. Kliknij **Wybierz folder** lub przeciągnij folder do strefy pod viewerem.
2. Folder musi zawierać **jeden** plik `.glb` lub `.gltf`.
3. Dla `.gltf` z zewnętrznymi teksturami dołącz cały folder (np. `textures/`, pliki `.bin`).
4. Pliki są ładowane w pamięci przeglądarki jako blob URL — nic nie trafia na serwer.

### Przełącznik materiałów

- **Textura** — oryginalne materiały PBR z modelu
- **Bez textury** — jednolity szary materiał podglądowy

### Przykład

Rozpakuj archiwum z modelem (np. `panzerjager-i.zip`) i wskaż folder zawierający plik `.glb`
lub `.gltf` wraz z teksturami.

## Build produkcyjny

```bash
npm run build
npm run start
```
