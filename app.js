(() => {
  const get = id => document.getElementById(id);
  const storageKey = 'es-collection-v2';
  const legacyKey = 'es-collection-v1';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  let entries = [];
  let editing = null;
  let sequence = 0;
  let initialDraft = '';
  let loadFailed = false;
  let originalData = null;

  function normalize(entry) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.company !== 'string') {
      throw new Error('Invalid ES');
    }
    const questions = Array.isArray(entry.questions) ? entry.questions
      : [{ question: entry.question, answer: entry.answer ?? '' }];
    if (!questions.length || !questions.every(item => item
      && typeof item.question === 'string' && typeof item.answer === 'string')) {
      throw new Error('Invalid questions');
    }
    const { question, answer, ...rest } = entry;
    return { ...rest, questions: questions.map(item => ({ question: item.question, answer: item.answer })) };
  }

  try {
    // Keep v1 untouched as a recovery copy. An older open tab cannot overwrite
    // multi-question ES records written by this version.
    originalData = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyKey);
    const data = JSON.parse(originalData ?? '[]');
    if (!Array.isArray(data)) throw new Error('Invalid collection');
    entries = data.map(normalize);
  } catch {
    loadFailed = true;
    get('message').textContent = '保存データを読み込めませんでした。上書きを防ぐため保存を停止しています。「バックアップを保存」でデータを保管してください。';
  }

  function persist(next) {
    if (loadFailed) {
      get('form-error').textContent = '保存データの読み込みに失敗しているため、上書きできません。';
      return false;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      entries = next;
      get('form-error').textContent = '';
      render();
      return true;
    } catch {
      get('form-error').textContent = '保存できませんでした。ブラウザの保存容量・設定をご確認ください。入力内容はこの画面に残っています。';
      return false;
    }
  }

  function render() {
    const query = get('search').value.toLowerCase();
    const state = get('status').value;
    const list = entries.filter(entry => (state === 'all' || entry.state === state)
      && [entry.company, entry.industry, ...entry.questions.flatMap(item => [item.question, item.answer])]
        .some(value => String(value ?? '').toLowerCase().includes(query)));
    list.sort((a, b) => get('sort').value === 'deadline'
      ? (a.deadline || '9999').localeCompare(b.deadline || '9999') : b.updated - a.updated);
    get('total').textContent = entries.length;
    get('drafts').textContent = entries.filter(entry => entry.state === '下書き').length;
    get('done').textContent = entries.filter(entry => entry.state === '提出済み').length;
    get('results').textContent = ` / ${list.length}件`;
    get('cards').innerHTML = list.length ? list.map(entry => {
      const first = entry.questions[0];
      const answered = entry.questions.filter(item => item.answer.trim()).length;
      const characters = entry.questions.reduce((sum, item) => sum + Array.from(item.answer).length, 0);
      const otherQuestions = entry.questions.slice(1, 3);
      return `<article class="card">
        <div class="cardtop"><div class="companyicon">${escape(entry.company.slice(0, 1))}</div>
          <div><div class="company">${escape(entry.company)}</div><div class="industry">${escape(entry.industry || '応募情報未設定')}</div></div>
          <span class="badge ${entry.state === '提出済み' ? 'done' : ''}">${escape(entry.state)}</span></div>
        <div class="question-summary"><span class="question-total">${entry.questions.length}設問</span><span>回答済み ${answered} / ${entry.questions.length}</span></div>
        <h3>${escape(first.question)}</h3>
        <div class="preview">${escape(first.answer || 'まだ回答がありません。あなたの言葉を書き始めましょう。')}</div>
        ${otherQuestions.length ? `<div class="other-questions">${otherQuestions.map((item, index) => `<div>${index + 2}. ${escape(item.question)}</div>`).join('')}${entry.questions.length > 3 ? `<div>ほか${entry.questions.length - 3}設問</div>` : ''}</div>` : ''}
        <div class="cardfoot"><span>提出期限：${escape(entry.deadline || '未設定')} · 合計${characters}文字</span><button class="edit" data-id="${escape(entry.id)}">開く・編集 ↗</button></div>
      </article>`;
    }).join('') : `<div class="empty">${entries.length ? '条件に一致するESがありません。' : 'まだESがありません。<br><br>「＋ ESを追加」から、最初のエントリーシートを作りましょう。'}</div>`;
    document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button.dataset.filter === state));
  }

  function rows() { return Array.from(get('questions').children); }

  function count(row) {
    row.querySelector('.answer-count').textContent = `${Array.from(row.querySelector('[data-answer]').value).length}文字`;
  }

  function renumber() {
    const sections = rows();
    sections.forEach((row, index) => {
      row.querySelector('.question-number').textContent = `設問 ${index + 1}`;
      const remove = row.querySelector('[data-remove]');
      remove.disabled = sections.length === 1;
      remove.setAttribute('aria-label', `設問${index + 1}を削除`);
    });
    get('question-summary').textContent = `${sections.length}設問をこのESにまとめて保存します`;
  }

  function addQuestion(item = {}, focus = false) {
    const id = `question-${++sequence}`;
    const row = document.createElement('section');
    row.className = 'question-row';
    row.dataset.section = id;
    row.setAttribute('aria-labelledby', `${id}-heading`);
    row.innerHTML = `<div class="question-heading"><h3 class="question-number" id="${id}-heading"></h3><button type="button" class="remove-question" data-remove>削除</button></div>
      <label for="${id}-prompt">設問 <span aria-hidden="true">*</span></label>
      <textarea id="${id}-prompt" class="question-prompt" data-question rows="2" required placeholder="例：自己PRを教えてください"></textarea>
      <label for="${id}-answer">回答</label>
      <textarea id="${id}-answer" data-answer placeholder="この設問への回答を入力"></textarea>
      <div class="answer-tools"><button type="button" class="edit" data-scan>▧ スクショから回答を追加</button><span class="answer-count" aria-live="polite"></span></div>`;
    row.querySelector('[data-question]').value = item.question ?? '';
    row.querySelector('[data-answer]').value = item.answer ?? '';
    get('questions').appendChild(row);
    count(row);
    renumber();
    if (focus) row.querySelector('[data-question]').focus();
    return row;
  }

  function draft() {
    return {
      company: get('company').value,
      industry: get('industry').value,
      deadline: get('deadline').value,
      state: get('state').value,
      questions: rows().map(row => ({
        question: row.querySelector('[data-question]').value,
        answer: row.querySelector('[data-answer]').value,
      })),
    };
  }

  function openEditor(entry, importedAnswer) {
    editing = entry?.id ?? null;
    get('form').reset();
    get('questions').replaceChildren();
    get('form-error').textContent = '';
    for (const field of ['company', 'industry', 'deadline', 'state']) {
      get(field).value = entry?.[field] ?? (field === 'state' ? '下書き' : '');
    }
    const questions = entry?.questions ?? [{ question: '', answer: importedAnswer ?? '' }];
    questions.forEach(item => addQuestion(item));
    get('formtitle').textContent = editing ? 'ESを編集' : 'ESを追加';
    get('delete').hidden = !editing;
    initialDraft = JSON.stringify(draft());
    get('modal').showModal();
  }

  function requestClose() {
    if (initialDraft !== JSON.stringify(draft()) && !confirm('入力中の変更を保存せずに閉じますか？')) return;
    get('modal').close();
  }

  get('add').addEventListener('click', () => openEditor());
  get('add-question').addEventListener('click', () => addQuestion({}, true));
  get('cancel').addEventListener('click', requestClose);
  get('modal').addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  get('questions').addEventListener('input', event => {
    if (event.target.matches('[data-answer]')) count(event.target.closest('.question-row'));
  });
  get('questions').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const row = button.closest('.question-row');
    if (button.hasAttribute('data-remove') && rows().length > 1) {
      const hasText = row.querySelector('[data-question]').value || row.querySelector('[data-answer]').value;
      if (hasText && !confirm('この設問と回答を削除しますか？保存するまでは元のESには反映されません。')) return;
      const sections = rows();
      const next = sections[sections.indexOf(row) + 1] || sections[sections.indexOf(row) - 1];
      row.remove();
      renumber();
      next.querySelector('[data-question]').focus();
    }
    if (button.hasAttribute('data-scan')) {
      document.dispatchEvent(new CustomEvent('es:scan', { detail: { targetId: row.dataset.section } }));
    }
  });
  document.addEventListener('es:import', event => {
    const { answer, targetId } = event.detail;
    if (targetId) {
      const row = rows().find(section => section.dataset.section === targetId);
      if (!row || !get('modal').open) return;
      const textarea = row.querySelector('[data-answer]');
      textarea.value += `${textarea.value ? '\n\n' : ''}${answer}`;
      count(row);
      textarea.focus();
    } else openEditor(null, answer);
  });
  get('form').addEventListener('submit', event => {
    event.preventDefault();
    const values = draft();
    if (!values.company.trim()) {
      get('form-error').textContent = '企業名を入力してください。';
      get('company').focus();
      return;
    }
    const emptyRow = rows().find(row => !row.querySelector('[data-question]').value.trim());
    if (emptyRow) {
      get('form-error').textContent = 'すべての設問を入力してください。不要な設問は削除できます。';
      emptyRow.querySelector('[data-question]').focus();
      return;
    }
    const item = {
      id: editing ?? crypto.randomUUID(), updated: Date.now(),
      company: values.company.trim(), industry: values.industry.trim(),
      deadline: values.deadline, state: values.state,
      questions: values.questions.map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() })),
    };
    if (persist(editing ? entries.map(entry => entry.id === editing ? item : entry) : [...entries, item])) {
      get('modal').close();
    }
  });
  get('delete').addEventListener('click', () => {
    const entry = entries.find(item => item.id === editing);
    if (entry && confirm(`このESの全${entry.questions.length}設問と回答を削除しますか？`)
      && persist(entries.filter(item => item.id !== editing))) get('modal').close();
  });
  get('search').addEventListener('input', render);
  get('status').addEventListener('change', render);
  get('sort').addEventListener('change', render);
  document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => {
    get('status').value = button.dataset.filter;
    render();
  }));
  get('cards').addEventListener('click', event => {
    const button = event.target.closest('[data-id]');
    if (button) openEditor(entries.find(entry => entry.id === button.dataset.id));
  });
  get('export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([loadFailed ? originalData ?? '' : JSON.stringify(entries, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = loadFailed ? 'es-collection-recovery.json' : 'es-collection-backup.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  render();
})();
