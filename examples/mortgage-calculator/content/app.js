(function () {
  "use strict";
  const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money = (n) => (isFinite(n) ? fmt.format(Math.max(0, Math.round(n))) : "—");

  const form = document.getElementById("form");
  const out = {
    monthly: document.getElementById("monthly"),
    total: document.getElementById("total"),
    interest: document.getElementById("interest"),
  };

  function calculate() {
    const p = Number(document.getElementById("amount").value);
    const r = Number(document.getElementById("rate").value) / 100 / 12;
    const n = Number(document.getElementById("years").value) * 12;
    if (!(p > 0 && n > 0)) {
      out.monthly.textContent = out.total.textContent = out.interest.textContent = "—";
      return;
    }
    const monthly = r === 0 ? p / n : (p * r) / (1 - Math.pow(1 + r, -n));
    const total = monthly * n;
    out.monthly.textContent = money(monthly);
    out.total.textContent = money(total);
    out.interest.textContent = money(total - p);
  }

  form.addEventListener("input", calculate);
  calculate();
})();
