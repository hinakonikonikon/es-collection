// This controller and its child worker are terminated together on cancel.
// All OCR assets are local to the site. Files are only passed between workers.
importScripts(new URL('assets/ocr/tesseract.min.js', self.location.href).href);

self.onmessage = async ({ data: { file } }) => {
  let worker;
  try {
    worker = await Tesseract.createWorker('jpn+eng', 1, {
      workerPath: new URL('assets/ocr/worker.min.js', self.location.href).href,
      corePath: new URL('assets/ocr/', self.location.href).href,
      langPath: new URL('assets/ocr/lang/', self.location.href).href,
      workerBlobURL: false,
      cacheMethod: 'none',
      errorHandler: () => self.postMessage({ type: 'error' }),
      logger: ({ status, progress }) => self.postMessage({ type: 'progress', status, progress }),
    });
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(file);
    self.postMessage({ type: 'result', text: data.text });
  } catch {
    self.postMessage({ type: 'error' });
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
};
