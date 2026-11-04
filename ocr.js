(() => {
  const get = id => document.getElementById(id);
  const dialog = get('ocr-modal');
  const types = new Set(['image/png', 'image/jpeg', 'image/webp']);
  let selectedFile = null;
  let previewURL = null;
  let busy = false;
  let task = 0;
  let worker = null;
  let rejectRun = null;
  let runTimer = null;
  let selection = 0;

  function status(text, error = false) {
    get('ocr-status').textContent = text;
    get('ocr-status').classList.toggle('error', error);
  }

  function controls() {
    get('ocr-file').disabled = busy;
    get('ocr-read').disabled = busy || !selectedFile;
    get('ocr-read').textContent = busy ? '読み取り中…' : '文字を読み取る';
    get('ocr-use').disabled = busy || !get('ocr-text').value.trim();
    dialog.setAttribute('aria-busy', String(busy));
    get('ocr-progress').hidden = !busy;
  }

  function releaseImage() {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = null;
    get('ocr-preview').removeAttribute('src');
    get('ocr-preview').hidden = true;
    selectedFile = null;
  }

  function stop() {
    task++;
    clearTimeout(runTimer);
    runTimer = null;
    if (worker) worker.terminate();
    if (rejectRun) rejectRun(new Error('cancelled'));
    rejectRun = null;
    worker = null;
    busy = false;
    controls();
  }

  async function selectImage(file) {
    if (busy || !file) return;
    const current = ++selection;
    releaseImage();
    get('ocr-result').hidden = true;
    get('ocr-text').value = '';
    controls();
    if (!types.has(file.type)) {
      status('PNG・JPEG・WebPの画像を選んでください。PDFやHEICはスクショにして取り込めます。', true);
      return;
    }
    if (file.size > 15 * 1024 * 1024 || file.size === 0) {
      status('15MB以下の画像を選んでください。長いスクショは分けて取り込んでください。', true);
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      if (current !== selection || !dialog.open) return;
      if (image.naturalWidth * image.naturalHeight > 25_000_000) {
        status('画像が大きすぎます。ESの文章部分を切り取るか、数枚に分けてください。', true);
        return;
      }
      selectedFile = file;
      previewURL = url;
      get('ocr-preview').src = url;
      get('ocr-preview').hidden = false;
      status('画像を確認して「文字を読み取る」を押してください。');
    } catch {
      if (current === selection) status('画像を開けませんでした。別のスクショを選んでください。', true);
    } finally {
      if (previewURL !== url) URL.revokeObjectURL(url);
      controls();
    }
  }

  async function recognize() {
    if (!selectedFile || busy) return;
    busy = true;
    const current = ++task;
    get('ocr-progress').value = 0;
    get('ocr-result').hidden = true;
    get('ocr-text').value = '';
    status('読み取りの準備中です。初回は読み取り用データの取得に時間がかかります。');
    controls();
    runTimer = setTimeout(() => {
      if (current !== task) return;
      stop();
      status('読み取りに時間がかかっています。画像の文章部分を切り取って、もう一度お試しください。', true);
    }, 180_000);
    let activeWorker;
    try {
      // A dedicated controller owns the OCR worker, so cancellation also stops
      // initialization, downloads and any nested worker immediately.
      const text = (await new Promise((resolve, reject) => {
        rejectRun = reject;
        activeWorker = new Worker(new URL('ocr-task.js', document.baseURI));
        worker = activeWorker;
        activeWorker.onerror = event => {
          event.preventDefault();
          reject(new Error('worker-error'));
        };
        activeWorker.onmessage = ({ data }) => {
          if (current !== task) return;
          if (data.type === 'result') resolve(data.text);
          else if (data.type === 'error') reject(new Error('recognition-error'));
          else if (data.status === 'recognizing text') {
            const percentage = Math.round(data.progress * 100);
            get('ocr-progress').value = percentage;
            status(`文字を読み取り中… ${percentage}%`);
          } else if (data.status === 'loading language traineddata') {
            status('日本語・英語の読み取り用データを準備しています…');
          }
        };
        activeWorker.postMessage({ file: selectedFile });
      })).trim();
      if (current !== task) return;
      if (!text) {
        status('文字が見つかりませんでした。明るく鮮明な、横書きの文章部分を切り取ってお試しください。', true);
        return;
      }
      get('ocr-text').value = text;
      get('ocr-result').hidden = false;
      get('ocr-text').focus();
      status('読み取りが完了しました。誤字・改行を確認して修正してください。');
    } catch {
      if (current === task) status('読み取れませんでした。通信状態を確認し、別の画像でもう一度お試しください。', true);
    } finally {
      if (activeWorker) activeWorker.terminate();
      if (current === task) {
        clearTimeout(runTimer);
        runTimer = null;
        worker = null;
        rejectRun = null;
        busy = false;
        controls();
      }
    }
  }

  get('screenshot-import').addEventListener('click', () => {
    status('');
    dialog.showModal();
    controls();
  });
  get('ocr-file').addEventListener('change', event => selectImage(event.target.files[0]));
  get('ocr-read').addEventListener('click', recognize);
  get('ocr-text').addEventListener('input', controls);
  get('ocr-close').addEventListener('click', () => dialog.close());
  get('ocr-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    selection++;
    stop();
    releaseImage();
    get('ocr-file').value = '';
    get('ocr-text').value = '';
    get('ocr-result').hidden = true;
    controls();
  });
  get('ocr-use').addEventListener('click', () => {
    const text = get('ocr-text').value.trim();
    if (busy || !text) return;
    dialog.close();
    document.dispatchEvent(new CustomEvent('es:import', { detail: { answer: text } }));
  });
  const drop = get('ocr-drop');
  drop.addEventListener('dragover', event => {
    event.preventDefault();
    if (!busy) drop.classList.add('dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('dragging');
    if (busy) return;
    const files = event.dataTransfer.files;
    if (files.length > 1) { status('画像は1枚ずつ取り込んでください。', true); return; }
    selectImage(files[0]);
  });
  dialog.addEventListener('paste', event => {
    const image = Array.from(event.clipboardData?.items || []).find(item => item.type.startsWith('image/'));
    if (!image || busy) return;
    event.preventDefault();
    selectImage(image.getAsFile());
  });
  controls();
})();
