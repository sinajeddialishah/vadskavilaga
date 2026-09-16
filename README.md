# Vad ska vi laga?

En privat, mobilanpassad receptbok för personlig användning.

## Lokal förhandsvisning

```bash
npm install
npm run dev
```

## Privat lagring och Google-inloggning

GitHub Pages hostar den statiska appen. Recept, anteckningar, favoriter och bilder sparas i ett eget Supabase-projekt med Row Level Security. Kör `supabase/schema.sql` i Supabase SQL Editor och lägg sedan in din egen Google-e-post i `private.allowed_emails` enligt kommentaren i filen. Aktivera Google som provider och lägg till GitHub Pages-adressen som redirect URL.

Fyll därefter `public/config.js` med Supabase project URL och publishable key. Lägg aldrig en `service_role`-nyckel i appen.

Tills konfigurationen är ifylld öppnas appen i en tydligt märkt förhandsvisning med fläskpannkaka som exempelrecept.
