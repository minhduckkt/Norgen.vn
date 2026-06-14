(function () {
  const html = document.documentElement;
  const base = html.dataset.base || "";
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
  const count = document.querySelector("[data-search-count]");
  const forms = document.querySelectorAll("[data-search-form]");
  let indexPromise = null;

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9\s\-_/\\.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compact(value) {
    return normalizeText(value).replace(/[\s\-_/\\.]/g, "");
  }

  function tolerant(value) {
    return compact(value)
      .replace(/o/g, "0")
      .replace(/[il]/g, "1")
      .replace(/s/g, "5");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cappedDistance(a, b, limit) {
    if (!a || !b) return limit + 1;
    if (Math.abs(a.length - b.length) > limit) return limit + 1;

    const prev = new Array(b.length + 1);
    const cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j += 1) prev[j] = j;

    for (let i = 1; i <= a.length; i += 1) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > limit) return limit + 1;
      for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j];
    }

    return prev[b.length];
  }

  function loadIndex() {
    if (!indexPromise) {
      const inline = document.getElementById("search-index-data");
      indexPromise = (inline
        ? Promise.resolve(JSON.parse(inline.textContent || "[]"))
        : fetch(`${base}assets/search-index.json`).then((response) => {
            if (!response.ok) throw new Error("Search index not found");
            return response.json();
          }))
        .then((records) =>
          records.map((record) => ({
            ...record,
            _text: normalizeText(
              `${record.itemNumber} ${record.title} ${record.categoryName} ${record.groupName} ${record.range || ""} ${record.series || ""}`
            ),
            _compact: compact(record.itemNumber),
            _tolerant: tolerant(record.itemNumber),
          }))
        );
    }
    return indexPromise;
  }

  function scoreRecord(record, query) {
    const qText = normalizeText(query);
    const qCompact = compact(query);
    const qTolerant = tolerant(query);
    if (!qText) return 0;

    let score = 0;
    if (normalizeText(record.itemNumber) === qText) score += 1200;
    if (record._compact === qCompact) score += 1050;
    if (record._tolerant === qTolerant) score += 950;
    if (record._compact.startsWith(qCompact)) score += 760;
    if (record._tolerant.startsWith(qTolerant)) score += 680;
    if (record._compact.includes(qCompact)) score += 520;
    if (record._text.includes(qText)) score += 310;

    if (qCompact.length >= 5) {
      const distance = Math.min(
        cappedDistance(record._compact, qCompact, 2),
        cappedDistance(record._tolerant, qTolerant, 2)
      );
      if (distance <= 2) score += 430 - distance * 110;
    }

    const tokens = qText.split(" ").filter(Boolean);
    for (const token of tokens) {
      if (token.length > 1 && record._text.includes(token)) score += 35;
    }

    return score;
  }

  function render(records, query) {
    if (!results) return;
    const matches = records
      .map((record) => ({ record, score: scoreRecord(record, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    if (count) {
      count.textContent = query
        ? `${matches.length} kết quả phù hợp nhất cho "${query}"`
        : "Nhập mã Norgren hoặc tên sản phẩm để tìm.";
    }

    if (!query) {
      results.innerHTML = "";
      return;
    }

    if (!matches.length) {
      results.innerHTML = `
        <div class="search-result">
          <div>
            <h3>Chưa thấy mã phù hợp</h3>
            <p>Hãy gửi mã, ảnh tem hoặc BOM cho Fast Group Engineering. Đội kỹ thuật sẽ kiểm tra và phản hồi phương án phù hợp nếu cần.</p>
          </div>
          <a class="button button-primary" href="${base}lien-he/index.html">Gửi yêu cầu</a>
        </div>`;
      return;
    }

    results.innerHTML = matches
      .map(({ record }) => {
        const image = record.image
          ? `<a class="search-thumb" href="${base}${record.path}"><img src="${base}${record.image}" alt="${escapeHtml(record.itemNumber)}" loading="lazy" /></a>`
          : `<a class="search-thumb" href="${base}${record.path}"><span>${escapeHtml(record.itemNumber)}</span></a>`;
        return `
          <article class="search-result">
            ${image}
            <div>
              <h3>${escapeHtml(record.itemNumber)}</h3>
              <p>${escapeHtml(record.title)}</p>
              <p>${escapeHtml(record.categoryName)} · ${escapeHtml(record.groupName)}</p>
            </div>
            <div class="search-actions">
              <a class="button button-secondary" href="${base}${record.path}">Xem chi tiết</a>
              <a class="button button-primary" href="${base}${record.path}#bao-gia">Mua ngay</a>
            </div>
          </article>`;
      })
      .join("");
  }

  forms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      const field = form.querySelector("input[name='q']");
      if (!field || !field.value.trim()) {
        event.preventDefault();
        field && field.focus();
      }
    });
  });

  if (input && results) {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("q") || "";
    input.value = initial;

    loadIndex().then((records) => {
      render(records, initial);
      input.addEventListener("input", () => render(records, input.value));
    });
  }

  document.querySelectorAll("[data-quote-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const part = data.get("part_number") || data.get("part") || "Norgren";
      const subject = encodeURIComponent(`Yeu cau bao gia Norgren ${part}`);
      const body = encodeURIComponent(
        [
          `Ma Norgren: ${part}`,
          `So luong: ${data.get("quantity") || ""}`,
          `Cong ty: ${data.get("company") || ""}`,
          `Nguoi lien he: ${data.get("name") || ""}`,
          `Dien thoai/Zalo: ${data.get("phone") || ""}`,
          `Email: ${data.get("email") || ""}`,
          `Noi dung: ${data.get("message") || ""}`,
        ].join("\n")
      );
      window.location.href = `mailto:sales@norgren.com.vn?subject=${subject}&body=${body}`;
    });
  });

  document.querySelectorAll("[data-protected-doc]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      try {
        const target = atob(link.getAttribute("data-protected-doc") || "");
        if (target) window.open(target, "_blank", "noopener");
      } catch (_error) {
        window.location.href = `${base}lien-he/index.html`;
      }
    });
  });
})();
