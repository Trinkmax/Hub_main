/**
 * El worker de pdf.js no trae tipos. Solo se importa por lo que hace al cargarse: deja
 * `globalThis.pdfjsWorker` para que pdf.js corra en el hilo principal (ver `read-qr.ts`).
 */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs'
