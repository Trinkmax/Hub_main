-- ============================================================
-- El techo del HTML de las landings sube de 512 KB a 2 MB
-- ============================================================
-- POR QUÉ: 512 KB alcanzaba para una landing "de manual", pero las que arma
-- marketing traen tipografías, animaciones y fotos pegadas adentro del propio
-- HTML (base64), y se pasaban del límite antes de terminar. El mensaje de error
-- era correcto pero inútil: el archivo ya estaba hecho.
--
-- POR QUÉ 2 MB Y NO MÁS: el HTML viaja entero en el body de la Server Action
-- que lo guarda y Vercel corta los requests en 4,5 MB — 2 M caracteres en UTF-8
-- real entran cómodos con el `bodySizeLimit: '4mb'` de next.config. Además la
-- página se sirve con `Cache-Control: no-store` (el contador de visitas tiene
-- que ver cada visita), así que cada apertura baja el documento entero: 2 MB en
-- datos móviles ya son varios segundos, y de ahí para arriba la gente cierra
-- antes de que cargue. Para bajar el peso está la galería de imágenes, que la
-- revisión rápida del editor recomienda cuando el código se va de mambo.
--
-- El número vive en TRES lugares y tienen que decir lo mismo:
--   · este CHECK (y el de landing_page_versions),
--   · LANDING_HTML_MAX_CHARS en lib/landings/schemas.ts,
--   · experimental.serverActions.bodySizeLimit en next.config.ts.
-- ============================================================

alter table public.landing_pages
  drop constraint if exists landing_pages_html_size_check;

alter table public.landing_pages
  add constraint landing_pages_html_size_check check (length(html) <= 2097152);

-- El historial guarda una copia por publicación: mismo techo, o restaurar una
-- versión grande fallaría contra su propio CHECK.
alter table public.landing_page_versions
  drop constraint if exists landing_page_versions_html_size_check;

alter table public.landing_page_versions
  add constraint landing_page_versions_html_size_check check (length(html) <= 2097152);

notify pgrst, 'reload schema';
