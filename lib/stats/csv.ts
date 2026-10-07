// CSV writer mínimo: escapa quotes y wrapea cuando hay separador/quote/newline.
// Se mudó a `lib/csv/write.ts` (compartido con el kit y con Administración);
// este archivo queda para los imports de siempre, con el mismo comportamiento.
export { type CsvOptions, csvEscape, rowsToCsv } from '@/lib/csv/write'
