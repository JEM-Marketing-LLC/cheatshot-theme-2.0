/* ==========================================================================
   Cheat Shot — theme behaviour
   Vanilla custom elements. No framework, no build step.
   ========================================================================== */

/* ---------- Click-to-play hero video ----------
   The video element carries no src until the visitor clicks. That keeps the
   poster image as the only media cost on first paint, which protects LCP. */
class ClickToPlayVideo extends HTMLElement {
  connectedCallback() {
    this.button = this.querySelector('[data-play-button]');
    this.videoWrapper = this.querySelector('[data-video-wrapper]');
    this.template = this.querySelector('template');
    if (!this.button || !this.videoWrapper || !this.template) return;

    this.button.addEventListener('click', () => this.play());
  }

  play() {
    if (this.dataset.played === 'true') return;
    this.dataset.played = 'true';

    this.videoWrapper.appendChild(this.template.content.cloneNode(true));
    const media = this.videoWrapper.querySelector('video, iframe');
    if (!media) return;

    this.setAttribute('data-playing', 'true');

    if (media.tagName === 'VIDEO') {
      media.play().catch(() => {
        /* Autoplay policies can still refuse; native controls remain available. */
      });
      media.addEventListener('ended', () => this.removeAttribute('data-playing'));
    }

    // Move focus into the player so keyboard users land on the controls.
    media.setAttribute('tabindex', '-1');
    media.focus({ preventScroll: true });
  }
}
customElements.define('click-to-play-video', ClickToPlayVideo);

/* ---------- Hero video autoplay ----------
   Mobile browsers refuse autoplay unless the element is muted and inline, and
   they sometimes refuse the first attempt anyway. Retry once the metadata is
   there and again on the visitor's first interaction. */
document.addEventListener('DOMContentLoaded', () => {
  const videos = document.querySelectorAll('video[data-autoplay-video]');
  if (!videos.length) return;

  const kick = (video) => {
    video.muted = true;
    const attempt = video.play();
    if (attempt && attempt.catch) attempt.catch(() => {});
  };

  videos.forEach((video) => {
    kick(video);
    video.addEventListener('loadeddata', () => kick(video), { once: true });
    video.addEventListener('canplay', () => kick(video), { once: true });
  });

  const onFirstTouch = () => {
    videos.forEach((video) => {
      if (video.paused) kick(video);
    });
  };
  ['touchstart', 'pointerdown', 'scroll'].forEach((event) =>
    window.addEventListener(event, onFirstTouch, { once: true, passive: true })
  );
});

/* ---------- Mobile navigation ---------- */
class MobileNav extends HTMLElement {
  connectedCallback() {
    this.toggle = this.querySelector('[data-nav-toggle]');
    this.panel = this.querySelector('[data-nav-panel]');
    if (!this.toggle || !this.panel) return;

    // Always start closed, whatever state the markup was cached in.
    this.panel.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');


    this.toggle.addEventListener('click', () => {
      const open = this.toggle.getAttribute('aria-expanded') === 'true';
      this.toggle.setAttribute('aria-expanded', String(!open));
      this.panel.hidden = open;
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.toggle.getAttribute('aria-expanded') === 'true') {
        this.toggle.setAttribute('aria-expanded', 'false');
        this.panel.hidden = true;
        this.toggle.focus();
      }
    });
  }
}
customElements.define('mobile-nav', MobileNav);

/* ---------- Variant picker ----------
   Swaps the selected variant, price, availability, and the ?variant= URL
   without a page reload. Reads variant data from an embedded JSON script. */
class VariantPicker extends HTMLElement {
  connectedCallback() {
    this.form = this.closest('form');
    this.dataScript = this.querySelector('[data-variant-json]');
    if (!this.dataScript) return;

    try {
      this.variants = JSON.parse(this.dataScript.textContent);
    } catch (error) {
      return;
    }

    this.addEventListener('change', () => this.onChange());
  }

  get selectedOptions() {
    return Array.from(this.querySelectorAll('input[type="radio"]:checked, select')).map(
      (input) => input.value
    );
  }

  onChange() {
    const selected = this.selectedOptions;
    const variant = this.variants.find((candidate) =>
      candidate.options.every((option, index) => option === selected[index])
    );

    this.updateIdInput(variant);
    this.updatePrice(variant);
    this.updateButton(variant);
    this.updateUrl(variant);
  }

  updateIdInput(variant) {
    const input = this.form && this.form.querySelector('input[name="id"]');
    if (input && variant) input.value = variant.id;
  }

  updatePrice(variant) {
    const target = document.querySelector('[data-price-target]');
    if (!target) return;
    if (!variant) {
      target.textContent = '';
      return;
    }
    target.innerHTML = formatMoney(variant.price);

    const compare = document.querySelector('[data-compare-target]');
    if (compare) {
      const showCompare = variant.compare_at_price && variant.compare_at_price > variant.price;
      compare.hidden = !showCompare;
      if (showCompare) compare.innerHTML = formatMoney(variant.compare_at_price);
    }
  }

  updateButton(variant) {
    const button = this.form && this.form.querySelector('[data-add-button]');
    if (!button) return;
    const label = button.querySelector('[data-add-label]');
    const available = variant && variant.available;
    button.disabled = !available;
    if (label) {
      label.textContent = !variant ? 'Unavailable' : available ? 'Add to cart' : 'Sold out';
    }
  }

  updateUrl(variant) {
    if (!variant || this.dataset.updateUrl === 'false') return;
    window.history.replaceState({}, '', `${window.location.pathname}?variant=${variant.id}`);
  }
}
customElements.define('variant-picker', VariantPicker);

/* ---------- Add to cart, routed through the Cart Ajax API ---------- */
class ProductForm extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    if (!this.form) return;
    this.button = this.form.querySelector('[data-add-button]');
    this.errorTarget = this.querySelector('[data-cart-error]');

    this.form.addEventListener('submit', (event) => this.onSubmit(event));
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!this.button || this.button.disabled) return;

    this.setLoading(true);
    this.clearError();

    try {
      const response = await fetch(`${window.CheatShot.routes.cart_add_url}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(serializeForm(this.form))
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.description || payload.message || 'Could not add to cart.');
      }

      document.dispatchEvent(new CustomEvent('cheatshot:cart:refresh', { detail: { open: true } }));
    } catch (error) {
      this.showError(error.message);
    } finally {
      this.setLoading(false);
    }
  }

  setLoading(loading) {
    this.button.classList.toggle('is-loading', loading);
    this.button.setAttribute('aria-busy', String(loading));
  }

  showError(message) {
    if (!this.errorTarget) return;
    this.errorTarget.textContent = message;
    this.errorTarget.hidden = false;
  }

  clearError() {
    if (!this.errorTarget) return;
    this.errorTarget.hidden = true;
    this.errorTarget.textContent = '';
  }
}
customElements.define('product-form', ProductForm);

/* ---------- Cart drawer ---------- */
class CartDrawer extends HTMLElement {
  connectedCallback() {
    this.panel = this.querySelector('[data-drawer-panel]');
    this.content = this.querySelector('[data-drawer-content]');
    this.countTargets = document.querySelectorAll('[data-cart-count]');

    this.querySelectorAll('[data-drawer-close]').forEach((element) =>
      element.addEventListener('click', () => this.close())
    );

    document.addEventListener('cheatshot:cart:refresh', (event) => {
      this.refresh(Boolean(event.detail && event.detail.open));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    this.addEventListener('click', (event) => this.onLineAction(event));
  }

  open() {
    this.setAttribute('data-open', 'true');
    document.body.style.overflow = 'hidden';
    const closeButton = this.querySelector('[data-drawer-close]');
    if (closeButton) closeButton.focus();
  }

  close() {
    this.removeAttribute('data-open');
    document.body.style.overflow = '';
  }

  async onLineAction(event) {
    const trigger = event.target.closest('[data-line-change]');
    if (!trigger) return;
    event.preventDefault();

    const line = trigger.dataset.line;
    const quantity = trigger.dataset.quantity;

    await fetch(`${window.CheatShot.routes.cart_change_url}.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ line: Number(line), quantity: Number(quantity) })
    });

    this.refresh(true);
  }

  async refresh(shouldOpen) {
    try {
      const response = await fetch(`${window.CheatShot.routes.cart_url}?section_id=cart-drawer-content`);
      const markup = await response.text();
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      const fresh = parsed.querySelector('[data-drawer-content]');
      if (fresh && this.content) this.content.innerHTML = fresh.innerHTML;

      const cart = await fetch(`${window.CheatShot.routes.cart_url}.js`).then((res) => res.json());
      this.countTargets.forEach((target) => {
        target.textContent = cart.item_count;
        target.hidden = cart.item_count === 0;
      });
    } catch (error) {
      /* Leave the current drawer contents in place on a network failure. */
    }

    if (shouldOpen) this.open();
  }
}
customElements.define('cart-drawer', CartDrawer);

/* ---------- Accordion (FAQ / ingredients) ---------- */
class DisclosureList extends HTMLElement {
  connectedCallback() {
    if (this.dataset.exclusive !== 'true') return;
    this.addEventListener('toggle', (event) => {
      if (!event.target.open) return;
      this.querySelectorAll('details[open]').forEach((item) => {
        if (item !== event.target) item.open = false;
      });
    });
  }
}
customElements.define('disclosure-list', DisclosureList);

/* ---------- Scroll reveal ---------- */
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute('data-revealed', 'true');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -10% 0px' }
  );

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));
  });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-reveal]').forEach((element) =>
      element.setAttribute('data-revealed', 'true')
    );
  });
}

/* ---------- Helpers ---------- */
function serializeForm(form) {
  const data = new FormData(form);
  const payload = {};
  data.forEach((value, key) => {
    payload[key] = value;
  });
  return payload;
}

function formatMoney(cents) {
  const format = window.CheatShot.moneyFormat || '${{amount}}';
  const amount = (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return format.replace(/\{\{\s*amount[^}]*\s*\}\}/, amount);
}
